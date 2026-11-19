import { describe, expect } from "claude-code/testing"
import { DIR, REIN, relay, SPEC_TEXT, world, test } from "./world.ts"
import { TRACE_LIMIT } from "../hooks/lib/trace.ts"

// The trace keeps a written file's length and hash, not its text, and goes on
// in trace-2.jsonl, … once trace.jsonl would pass TRACE_LIMIT: the engine
// refuses a file over 4 MiB, and every line after that would be lost.

const STATUS = { tool: "mcp__rein__status" } as never
const write = (content: string) => ({ tool: "Write", file_path: `${DIR}/1-spec.md`, content }) as never
const edit = { tool: "Edit", file_path: `${DIR}/1-spec.md`, old_string: "로그인에", new_string: "로그인을" } as never

describe("trace", () => {
  test("a Write or Edit is traced with its contents' length and SHA-256 only", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    await $.tool.call(write("abc"))
    await $.tool.call(write(SPEC_TEXT))
    await $.tool.call(edit)
    const trace = files[`${DIR}/agent/trace.jsonl`] ?? ""
    expect(trace).toContain(`"content":{"length":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}`)
    expect(trace).toContain(`"old_string":{"length":4,"sha256":"`)
    expect(trace).not.toContain("로그인")
    expect(trace).toContain(`"file_path":"${DIR}/1-spec.md"`)
  })

  test("a line that would take trace.jsonl past the limit starts trace-2.jsonl, and the next lines go there", async ($, on) => {
    const full = `{"t":"x","ev":"pad","pad":"${"a".repeat(TRACE_LIMIT - 40)}"}\n`
    const files: Record<string, string> = { [`${DIR}/agent/trace.jsonl`]: full }
    world(on, files)
    await $.tool.call(STATUS)
    await $.tool.call(STATUS)
    expect(files[`${DIR}/agent/trace.jsonl`]).toBe(full)
    const next = (files[`${DIR}/agent/trace-2.jsonl`] ?? "").split("\n").filter(Boolean)
    expect(next.length).toBe(2)
    expect(next.every(l => l.includes(`"tool":"mcp__rein__status"`))).toBe(true)
    expect(files[`${DIR}/agent/trace-3.jsonl`]).toBeUndefined()
  })

  test("the retrospective finds the sessions that resumed the run in a later trace file", async ($, on) => {
    const PROJECTS = "C:/Users/u/.claude/projects"
    const files: Record<string, string> = {
      [`${DIR}/1-spec.md`]: SPEC_TEXT,
      [`${DIR}/agent/trace.jsonl`]: '{"t":"x","ev":"load","session":"s0"}\n',
      [`${DIR}/agent/trace-2.jsonl`]: '{"t":"x","ev":"resume","session":"s5"}\n',
      [`${PROJECTS}/E--proj/s0.jsonl`]: "{}\n",
      [`${PROJECTS}/E--proj/s5.jsonl`]: "{}\n",
      [`${PROJECTS}/E--proj/s1.jsonl`]: "{}\n",
    }
    world(on, files, () => "완료 (Rein 밖에서 반영함)", { stage: "review", runId: "login-fix" })
    const r = (await relay($, { tool: "mcp__rein__park", reason: "사용자가 그만하자고 함" } as never)) as { result: string }
    expect(r.result).toContain(`Run folder: ${REIN}/complete/login-fix. The main session's transcripts: ${PROJECTS}/E--proj/s0.jsonl, ${PROJECTS}/E--proj/s5.jsonl, ${PROJECTS}/E--proj/s1.jsonl.`)
  })
})
