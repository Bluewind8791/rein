// the user's comments on 1-mockup.html, kept in the run folder's
// agent/comments.json. The frame writes drafts (보내기 전); the hook hands
// them to the main session on the user's next prompt (보냄), and the main
// session marks each done (반영됨) or declined (반영 안 함) with a note.
import { quoted } from "./quote.ts"

export const COMMENTS_FILE = "agent/comments.json"

export type CommentStatus = "draft" | "sent" | "done" | "declined"

export type Comment = {
  id: string
  n: number
  screen: string
  el: string | null // the element's data-id, null for the screen as a whole
  text: string
  status: CommentStatus
  at: string
  sentAt?: string
  doneAt?: string
  note?: string // the main session's last line; kept on a reopened comment until it is marked again
}

// the comments of a comments.json; throws when it is not that shape.
export function parseComments(text: string): Comment[] {
  const data = JSON.parse(text) as { comments?: unknown }
  if (data === null || typeof data !== "object" || !Array.isArray(data.comments)) throw new Error("it has no comments list")
  for (const c of data.comments as Comment[]) {
    if (c === null || typeof c !== "object" || typeof c.n !== "number" || typeof c.text !== "string" || !["draft", "sent", "done", "declined"].includes(c.status)) {
      throw new Error("a comment in it lacks its number, text or status")
    }
  }
  return data.comments as Comment[]
}

// the file with these comments; `rest` is the file's other keys, kept as they are.
export const commentsJson = (comments: Comment[], rest: Record<string, unknown> = {}) => `${JSON.stringify({ ...rest, comments }, null, 2)}\n`

// every draft set sent at `at`.
export const sendDrafts = (comments: Comment[], at: string): Comment[] => comments.map(c => (c.status === "draft" ? { ...c, status: "sent", sentAt: at } : c))

const where = (c: Comment) => `${c.screen}, ${c.el === null ? "the screen as a whole" : `element ${c.el}`}`

// what the main session reads when comments are handed over: each one, and
// what to do with them.
export function handOverText(dir: string, comments: Comment[]): string {
  const items = comments.map(c => `#${c.n} on ${where(c)}${c.note !== undefined ? ` (reopened by the user; your last note: ${c.note})` : ""}:\n${quoted(c.text)}`)
  return [
    `The user left ${comments.length} comment${comments.length === 1 ? "" : "s"} on ${dir}/1-mockup.html in the frame's comment panel; they are now sent to you. For each one: reflect it in ${dir}/1-spec.md (a requirement it changes or leaves out becomes a \`변경: … (사용자, YYYY-MM-DD)\` or \`제외 (사용자, YYYY-MM-DD: …)\` line of \`## 기획서 대조\`), have rein:sketcher draw again, then mark it with mcp__rein__comment: done with one line on what changed, or declined with one line on why not. When a comment's meaning is unclear, ask the user in the chat before you mark it. advance refuses spec's End while a comment is unmarked.`,
    ...items,
  ].join("\n\n")
}

// the comment numbered n marked done or declined, or why not.
export function markOne(comments: Comment[], n: number, status: "done" | "declined", note: string, at: string): { ok: true; comments: Comment[] } | { ok: false; reason: string } {
  const c = comments.find(x => x.n === n)
  if (!c) return { ok: false, reason: `there is no comment #${n} on 1-mockup.html.` }
  if (c.status === "draft") return { ok: false, reason: `comment #${n} has not been handed to you yet; it comes with the user's next message.` }
  if (c.status !== "sent") return { ok: false, reason: `comment #${n} is already marked ${c.status}; the user reopens it in the frame when they want it looked at again.` }
  return { ok: true, comments: comments.map(x => (x.n === n ? { ...x, status, note, doneAt: at } : x)) }
}

// the numbers of the comments not marked yet, by status.
export const unmarked = (comments: Comment[], status: "draft" | "sent") => comments.filter(c => c.status === status).map(c => `#${c.n}`)
