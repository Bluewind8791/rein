import { describe, expect } from "claude-code/testing"
import { DIR, grade, key, ran, relay, SPEC_TEXT, world, test, type Host } from "./world.ts"

// the user's comments on 1-mockup.html: the frame writes drafts to
// agent/comments.json, the hook hands them to the main session with the
// user's next prompt, the main session marks each with mcp__rein__comment,
// and spec's End waits until every one is marked.

const SPEC = `${DIR}/1-spec.md`
const FILE = `${DIR}/agent/comments.json`
const TRACE = `${DIR}/agent/trace.jsonl`

type Status = "draft" | "sent" | "done" | "declined"
const comment = (n: number, status: Status, more: Record<string, unknown> = {}) => ({ id: `c${n}`, n, screen: "order0101", el: "search.status", text: `코멘트 ${n}`, status, at: "2026-11-20T10:00:00.000Z", ...more })
const store = (...comments: unknown[]) => JSON.stringify({ comments })
const read = (files: Record<string, string>) => (JSON.parse(files[FILE]!) as { comments: Record<string, unknown>[] }).comments

// node renames the temp file into place, as RENAME_JS does.
const renaming = (files: Record<string, string>, more: Host = {}): Host => ({
  ...more,
  run: (argv, _cwd, _stdin, env) => {
    if (argv[0] !== "node" || env?.REIN_FROM === undefined || env.REIN_TO === undefined) return { exitCode: 0 }
    files[key(env.REIN_TO)] = files[key(env.REIN_FROM)]!
    delete files[key(env.REIN_FROM)]
    return { exitCode: 0 }
  },
})

// the context the prompt entered with, through the hook.
async function submit($: { prompt: { submit: (e: never) => Promise<unknown> } }): Promise<string[] | undefined> {
  return ((await $.prompt.submit({ text: "다음" } as never)) as { context?: string[] }).context
}

const mark = (n: unknown, status: unknown, note: unknown, agentId?: string) => ({ tool: "mcp__rein__comment", n, status, note, ...(agentId ? { agentId } : {}) }) as never
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })

describe("comments handed over with the user's prompt", () => {
  test("every draft goes as one context block and is set sent", async ($, on) => {
    const files: Record<string, string> = {
      [SPEC]: SPEC_TEXT,
      [FILE]: JSON.stringify({ next: 5, comments: [comment(1, "draft"), comment(2, "draft", { el: null, note: "상태 선택지에 보류를 더했다" }), comment(3, "sent"), comment(4, "done", { note: "반영" })] }),
    }
    world(on, files, () => undefined, undefined, renaming(files))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    const context = await submit($)
    expect(context).toHaveLength(1)
    const block = context![0]!
    expect(block).toContain(`The user left 2 comments on ${DIR}/1-mockup.html`)
    expect(block).toContain(`reflect it in ${DIR}/1-spec.md`)
    expect(block).toContain("line of `## 요구사항` ending with the element the comment is on, `[<data-id>]`")
    expect(block).toContain("have rein:sketcher draw again, then mark it with mcp__rein__comment")
    expect(block).toContain("#1 on order0101, element search.status:\n```text\n> 코멘트 1\n```")
    expect(block).toContain("#2 on order0101, the screen as a whole (reopened by the user; your last note: 상태 선택지에 보류를 더했다):")
    expect(block).not.toContain("#3")
    expect(block).not.toContain("#4")
    expect(block).not.toContain("근거")
    const after = read(files)
    expect(after.map(c => c.status)).toEqual(["sent", "sent", "sent", "done"])
    expect(after[0]!.sentAt).toBe(new Date(0).toISOString())
    // the frame's number counter stays
    expect((JSON.parse(files[FILE]!) as { next: number }).next).toBe(5)
    expect(Object.keys(files).filter(f => f.includes(".rein-tmp-"))).toEqual([])
    expect(files[TRACE]).toContain(`"ev":"comments-sent","stage":"spec","via":"prompt","comments":[1,2]`)
    // sent already: the next prompt carries nothing.
    expect(await submit($)).toBeUndefined()
  })

  test("a comment's basis box goes as a 근거 line: the text in it, else where it is", async ($, on) => {
    const files: Record<string, string> = {
      [SPEC]: SPEC_TEXT,
      [FILE]: store(
        comment(1, "draft", { basis: { doc: "brief/order.pdf", page: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.1, quote: "조회 기간:\n기본 `7일`" } }),
        comment(2, "draft", { basis: { doc: "brief/order.png", x: 0.125, y: 0, w: 0.5, h: 0.25, quote: "" } }),
      ),
    }
    world(on, files, () => undefined, undefined, renaming(files))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    const block = (await submit($))![0]!
    expect(block).toContain("A `근거:` line under a comment is the part of a planning document")
    expect(block).toContain("> 코멘트 1\n```\n근거: brief/order.pdf p.4 — \"조회 기간: 기본 '7일'\"")
    expect(block).toContain("> 코멘트 2\n```\n근거: brief/order.png — 상자 안 글자 없음, 쪽 왼쪽 위에서 x 12.5%, y 0%, 너비 50%, 높이 25%")
  })

  test("no drafts, no file: nothing is added or written", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => undefined, undefined, renaming(files))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    expect(await submit($)).toBeUndefined()
    expect(files[FILE]).toBeUndefined()
    files[FILE] = store(comment(1, "sent"))
    expect(await submit($)).toBeUndefined()
    expect(ran).toEqual([])
  })

  test("outside spec the drafts stay", async ($, on) => {
    const files: Record<string, string> = { [FILE]: store(comment(1, "draft")) }
    world(on, files, () => undefined, { stage: "plan", runId: "login-fix" }, renaming(files))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    expect(await submit($)).toBeUndefined()
    expect(read(files)[0]!.status).toBe("draft")
  })

  test("a failed write never holds the prompt back; the drafts go with a later one", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [FILE]: store(comment(1, "draft")) }
    let broken = true
    world(on, files, () => undefined, undefined, renaming(files, { writeFails: p => broken && p.includes(".rein-tmp-") }))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    expect(await submit($)).toBeUndefined()
    expect(read(files)[0]!.status).toBe("draft")
    expect(files[TRACE]).toContain(`"what":"comments"`)
    broken = false
    expect(await submit($)).toEqual([expect.stringContaining("#1 on order0101")])
  })

  test("a file that is not a comment list never holds the prompt back", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [FILE]: "{" }
    world(on, files, () => undefined, undefined, renaming(files))
    on("prompt.submit", async (_$, e) => ({ text: e.text, context: e.context }))
    expect(await $.prompt.submit({ text: "다음" } as never)).toEqual(expect.objectContaining({ text: "다음" }))
    expect(files[FILE]).toBe("{")
  })
})

describe("mcp__rein__comment", () => {
  test("marks a sent comment done or declined with its note", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [FILE]: store(comment(1, "sent"), comment(2, "sent"), comment(3, "draft")) }
    world(on, files, () => undefined, undefined, renaming(files))
    expect(await $.tool.call(mark(1, "done", "  상태 선택지에 보류를 더했다 "))).toEqual(expect.objectContaining({ result: "Marked comment #1 done. Still to mark: #2." }))
    expect(read(files)[0]).toEqual(expect.objectContaining({ status: "done", note: "상태 선택지에 보류를 더했다", doneAt: new Date(0).toISOString() }))
    expect(await $.tool.call(mark(2, "declined", "기획서가 정한 순서라 그대로 둔다"))).toEqual(expect.objectContaining({ result: "Marked comment #2 declined. Every comment handed to you is marked." }))
    expect(read(files).map(c => c.status)).toEqual(["done", "declined", "draft"])
    expect(files[TRACE]).toContain(`"ev":"comment","stage":"spec","n":2,"status":"declined","note":"기획서가 정한 순서라 그대로 둔다"`)
  })

  test("is refused for a comment not handed over or marked already, and for a bad input", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [FILE]: store(comment(1, "sent"), comment(2, "draft"), comment(3, "done", { note: "x" })) }
    world(on, files, () => undefined, undefined, renaming(files))
    const before = files[FILE]
    expect(await $.tool.call(mark(2, "done", "x"))).toEqual(refused("comment #2 has not been handed to you yet; it comes with the user's next message."))
    expect(await $.tool.call(mark(3, "declined", "x"))).toEqual(refused("comment #3 is already marked done; the user reopens it in the frame"))
    expect(await $.tool.call(mark(9, "done", "x"))).toEqual(refused("there is no comment #9 on 1-mockup.html."))
    expect(await $.tool.call(mark(1.5, "done", "x"))).toEqual(refused("n is the comment's number as it was handed to you"))
    expect(await $.tool.call(mark(1, "sent", "x"))).toEqual(refused("status is done (reflected in 1-spec.md) or declined (not reflected)."))
    expect(await $.tool.call(mark(1, "done", " "))).toEqual(refused("note is one line"))
    expect(await $.tool.call(mark(1, "done", "첫 줄\n둘째 줄"))).toEqual(refused("note is one line"))
    expect(await $.tool.call(mark(1, "done", "x", "agent-x"))).toEqual(refused("mcp__rein__comment is called only by the main session"))
    expect(files[FILE]).toBe(before)
    expect(files[TRACE]).toContain(`"tool":"mcp__rein__comment","decision":"deny"`)
  })

  test("is refused outside spec", async ($, on) => {
    const files: Record<string, string> = { [FILE]: store(comment(1, "sent")) }
    world(on, files, () => undefined, { stage: "plan", runId: "login-fix" }, renaming(files))
    expect(await $.tool.call(mark(1, "done", "x"))).toEqual(refused("comments on 1-mockup.html are marked in the spec stage only; the run is in plan."))
    expect(read(files)[0]!.status).toBe("sent")
  })

  test("is refused with no run open", async ($, on) => {
    world(on, {}, () => undefined, null)
    expect(await $.tool.call(mark(1, "done", "x"))).toEqual(refused("this session has no run open."))
  })
})

describe("spec's End with comments", () => {
  test("waits until every comment is marked, handing the drafts over", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [FILE]: store(comment(1, "sent"), comment(2, "draft"), comment(3, "declined", { note: "x" })) }
    world(on, files, () => undefined, undefined, renaming(files))
    await grade($)
    const first = (await $.tool.call({ tool: "mcp__rein__advance" } as never)) as { deny?: string }
    expect(first.deny).toContain("the user's comments on 1-mockup.html are not all marked yet (handed to you before and not marked: #1), so 1-spec.md does not go to the user for approval.")
    expect(first.deny).toContain("The user left 1 comment on")
    expect(first.deny).toContain("#2 on order0101, element search.status:")
    expect(read(files).map(c => c.status)).toEqual(["sent", "sent", "declined"])
    expect(files[TRACE]).toContain(`"via":"advance","comments":[2]`)
    // the approval through /rein:plan waits too.
    const approve = (await $.tool.call({ tool: "mcp__rein__advance", answer: "승인" } as never)) as { deny?: string }
    expect(approve.deny).toContain("not marked: #1, #2)")
    expect(approve.deny).not.toContain("The user left")
    await $.tool.call(mark(1, "done", "반영"))
    await $.tool.call(mark(2, "declined", "그대로"))
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual({ result: expect.stringContaining("1-spec.md가 승인을 기다립니다") })
  })
})
