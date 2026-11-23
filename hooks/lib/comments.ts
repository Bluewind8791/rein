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
  basis?: Basis // the box the user drew on a planning document for it
}

// a box on a planning document: the file in brief/ (relative to the run
// folder), the PDF page (none on an image), the box as fractions of the page
// from its top left, and the text the frame read inside it ("" when none).
export type Basis = { doc: string; page?: number; x: number; y: number; w: number; h: number; quote: string }

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

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`

// the text of a planning document on one line: no line breaks, control,
// zero-width or bidi characters, or backticks, and capped
const oneLine = (t: string) => {
  const s = t.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\x60/g, "'").replace(/\s+/g, " ").trim()
  return s.length > 300 ? `${s.slice(0, 300)}…` : s
}

// the 근거 line of a comment with a basis box, or "" without one
export function basisLine(c: Comment): string {
  const b = c.basis
  if (!b || typeof b.doc !== "string") return ""
  const at = `${oneLine(b.doc)}${Number.isInteger(b.page) ? ` p.${b.page}` : ""}`
  const quote = typeof b.quote === "string" ? oneLine(b.quote) : ""
  const what = quote ? `"${quote}"` : `상자 안 글자 없음, 쪽 왼쪽 위에서 x ${pct(b.x)}, y ${pct(b.y)}, 너비 ${pct(b.w)}, 높이 ${pct(b.h)}`
  return `\n근거: ${at} — ${what}`
}

const where = (c: Comment) => `${c.screen}, ${c.el === null ? "the screen as a whole" : `element ${c.el}`}`

// what the main session reads when comments are handed over: each one, and
// what to do with them.
export function handOverText(dir: string, comments: Comment[]): string {
  const items = comments.map(c => `#${c.n} on ${where(c)}${c.note !== undefined ? ` (reopened by the user; your last note: ${c.note})` : ""}:\n${quoted(c.text)}${basisLine(c)}`)
  const basis = comments.some(c => basisLine(c) !== "")
    ? ` A \`근거:\` line under a comment is the part of a planning document (a file of ${dir}) the user boxed as its basis; read it there.`
    : ""
  return [
    `The user left ${comments.length} comment${comments.length === 1 ? "" : "s"} on ${dir}/1-mockup.html in the frame's comment panel; they are now sent to you. For each one: reflect it in ${dir}/1-spec.md (a requirement it adds, changes, puts off or leaves out becomes a line of \`## 요구사항\` ending with the element the comment is on, \`[<data-id>]\`: \`포함\`, \`변경: … (사용자, YYYY-MM-DD)\`, \`보류 (사용자, YYYY-MM-DD: …)\` or \`제외 (사용자, YYYY-MM-DD: …)\`), have rein:sketcher draw again, then mark it with mcp__rein__comment: done with one line on what changed, or declined with one line on why not. When a comment's meaning is unclear, ask the user in the chat before you mark it. advance refuses spec's End while a comment is unmarked.${basis}`,
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
