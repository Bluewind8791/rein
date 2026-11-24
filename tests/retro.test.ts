import { describe, expect } from "claude-code/testing"
import { relay, DIR, REIN, SPEC_TEXT, world, test } from "./world.ts"

// The retrospective after a run closes: the close names the rein:retro
// skill with the run folder and the main session's transcripts, and until
// a run opens the permission prompts for reading them and the domain rules
// and knowledge, and for writing retro.md and the domain knowledge, are
// answered allow.

const PARK = { tool: "mcp__rein__park", reason: "사용자가 그만하자고 함" } as never
const PROJECTS = "C:/Users/u/.claude/projects"
const NOW = `${PROJECTS}/E--proj/s1.jsonl`
const EARLIER = `${PROJECTS}/E--other/s0.jsonl`
const DONE = `${REIN}/complete/login-fix`
const DROP = `${REIN}/drop/login-fix`
const check = ($: { tool: { check: (e: never) => Promise<unknown> } }, tool: string, input: Record<string, unknown>) =>
  $.tool.check({ tool, input } as never)
const allow = expect.objectContaining({ decision: "allow" })
const ask = { decision: "ask" }

// a run folder whose trace holds the load line of an earlier session s0;
// the closing session is s1. Each has its transcript in another folder.
const files = (): Record<string, string> => ({
  [`${DIR}/1-spec.md`]: SPEC_TEXT,
  [`${DIR}/agent/trace.jsonl`]: '{"t":"x","ev":"load","session":"s0"}\n{"t":"x","ev":"resume","session":"../../evil"}\n',
  [NOW]: "{}\n",
  [EARLIER]: "{}\n",
  [`${PROJECTS}/E--proj/s9.jsonl`]: "{}\n",
})

describe("retro", () => {
  test("완료 names rein:retro with the folder and both sessions' transcripts; reads and retro.md are allowed", async ($, on) => {
    world(on, files(), () => "완료 (Rein 밖에서 반영함)", { stage: "review", runId: "login-fix" })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).toContain(`invoke the rein:retro skill. Run folder: ${DONE}. The main session's transcripts: ${EARLIER}, ${NOW}.`)
    expect(r.result).not.toContain("evil")
    expect(await check($, "Read", { file_path: `${DONE}/agent/trace.jsonl` })).toEqual(allow)
    expect(await check($, "Grep", { pattern: "x", path: DONE })).toEqual(allow)
    expect(await check($, "Grep", { pattern: "x", path: NOW })).toEqual(allow)
    expect(await check($, "Read", { file_path: EARLIER })).toEqual(allow)
    expect(await check($, "Grep", { pattern: "x", path: `${REIN}/knowledge` })).toEqual(allow)
    expect(await check($, "Read", { file_path: `${REIN}/rules/web/auth.md` })).toEqual(allow)
    expect(await check($, "Write", { file_path: `${REIN}/knowledge/web/new.md`, content: "x" })).toEqual(allow)
    expect(await check($, "Edit", { file_path: `${REIN}/knowledge/web/pages/notes.md`, old_string: "a", new_string: "b" })).toEqual(allow)
    expect(await check($, "Write", { file_path: `${REIN}/rules/web/auth.md`, content: "x" })).toEqual(ask)
    expect(await check($, "Write", { file_path: `${REIN}/knowledge/../rules/web/auth.md`, content: "x" })).toEqual(ask)
    expect(await check($, "Write", { file_path: `${DONE}/agent/retro.md`, content: "x" })).toEqual(allow)
    expect(await check($, "Edit", { file_path: `${DONE}/agent/retro.md`, old_string: "a", new_string: "b" })).toEqual(allow)
    // nothing else: another session's transcript, the folder's other files, a climb.
    expect(await check($, "Read", { file_path: `${PROJECTS}/E--proj/s9.jsonl` })).toEqual(ask)
    expect(await check($, "Write", { file_path: `${DONE}/1-spec.md`, content: "x" })).toEqual(ask)
    expect(await check($, "Read", { file_path: `${DONE}/../other/1-spec.md` })).toEqual(ask)
    expect(await check($, "Glob", { pattern: "../**", path: DONE })).toEqual(ask)
  })

  test("폐기 names rein:retro with the drop folder", async ($, on) => {
    world(on, files(), () => "폐기", { stage: "dev", runId: "login-fix" })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).toContain(`invoke the rein:retro skill. Run folder: ${DROP}.`)
    expect(await check($, "Write", { file_path: `${DROP}/agent/retro.md`, content: "x" })).toEqual(allow)
  })

  test("보류 names no retrospective and allows nothing", async ($, on) => {
    world(on, files(), () => "보류", { stage: "dev", runId: "login-fix" })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).not.toContain("rein:retro")
    expect(await check($, "Read", { file_path: NOW })).toEqual(ask)
    expect(await check($, "Write", { file_path: `${REIN}/defer/login-fix/retro.md`, content: "x" })).toEqual(ask)
  })

  test("without a transcript found it says so", async ($, on) => {
    world(on, { [`${DIR}/1-spec.md`]: SPEC_TEXT }, () => "폐기", { stage: "dev", runId: "login-fix" })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).toContain(`invoke the rein:retro skill. Run folder: ${DROP}. No transcript of the run's main session was found.`)
  })

  test("a new run ends the allowance", async ($, on) => {
    let parks = 0
    world(on, files(), () => (parks++ === 0 ? "폐기" : "보류"), { stage: "dev", runId: "login-fix" })
    await relay($, PARK)
    expect(await check($, "Read", { file_path: NOW })).toEqual(allow)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "next-task" } as never)
    await relay($, { tool: "mcp__rein__park", reason: "나중에" } as never)
    expect(await check($, "Read", { file_path: NOW })).toEqual(ask)
    expect(await check($, "Write", { file_path: `${DROP}/agent/retro.md`, content: "x" })).toEqual(ask)
  })
})
