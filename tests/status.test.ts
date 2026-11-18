import { describe, expect, test } from "claude-code/testing"
import { DIR, grade, REIN, relay, SPEC_TEXT, store, toasts, world } from "./world.ts"

// G2: the read-only status tool shows the run the agent cannot read itself.

const STATUS = { tool: "mcp__rein__status" } as never
const RULE = `${REIN}/rules/api.md`

describe("status", () => {
  test("no run is a plain answer, not a refusal", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, null)
    expect(await $.tool.call(STATUS)).toEqual({ result: "No Rein run is open in this session." })
    expect(Object.keys(files)).toEqual([])
  })

  test("a v0.0.3 run shows its stage, no rules and no retries", async ($, on) => {
    world(on, {})
    const r = await $.tool.call(STATUS)
    expect(r).toEqual({ result: `runId: login-fix\nstage: spec\nrules: none frozen\nrun directory: ${DIR}` })
  })

  test("a run with a hidden count shows no retries line", async ($, on) => {
    world(on, {}, undefined, { v: 2, stage: "review", runId: "login-fix", rules: [], writes: [], retries: 1 })
    expect(((await $.tool.call(STATUS)) as { result: string }).result).not.toContain("retries:")
  })

  test("a failure-route stop shows its reason and file", async ($, on) => {
    const file = `${DIR}/agent/review.md`
    world(on, {}, undefined, { v: 2, stage: "review", runId: "login-fix", rules: [], writes: [], retries: 5, halt: { rule: "failure-route", reason: `implementation failure 5 since the design last passed; the failure is in ${file}`, file } })
    const shown = ((await $.tool.call(STATUS)) as { result: string }).result
    expect(shown).toContain(`halt: failure-route: implementation failure 5 since the design last passed; the failure is in ${file}`)
    expect(shown).not.toContain("retries:")
  })

  test("the fields that are set are shown and the run does not move", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, {
      v: 2,
      stage: "dev",
      runId: "login-fix",
      rules: [
        { name: "api", path: RULE, hash: "h", paths: ["src/api/**"] },
        { name: "all", path: `${REIN}/rules/all.md`, hash: "h", paths: null },
      ],
      planFiles: ["E:/proj/src/a.ts"],
      repos: ["E:/proj"],
      writes: ["E:/proj/src/a.ts"],
      retries: 1,
      failFile: `${DIR}/agent/review.md`,
      halt: { rule: "D100", reason: "production host" },
      e2e: {
        path: "aside",
        checks: [
          { name: "detail", minutes: 30, spent: 0, session: "ZNI0dDsPUJp8A4rj", observed: "우수회원만 체크", verdict: "통과" },
          { name: "stop", minutes: 40, spent: 10, runner: "agent-r1", session: "dAIZX30NAZGDxNXV" },
          { name: "slow", minutes: 10, spent: 10, over: true, session: "Qm3vX8sLr2NcTa0p" },
          { name: "grid", minutes: 30, spent: 0 },
        ],
      },
      heads: { "E:/proj": "abc123" },
    })
    const text = ((await $.tool.call(STATUS)) as { result: string }).result
    expect(text).toBe(
      [
        "runId: login-fix",
        "stage: dev",
        `failFile: ${DIR}/agent/review.md`,
        "planFiles:",
        "- E:/proj/src/a.ts",
        "repos:",
        "- E:/proj",
        "writes: the same files as planFiles",
        "rules:",
        `- ${RULE} (paths: src/api/**)`,
        `- ${REIN}/rules/all.md (no paths: list, always applies)`,
        "halt: D100: production host",
        "e2e: aside",
        "e2e check detail: 판정: 통과, 세션 ZNI0dDsPUJp8A4rj",
        "  관측: 우수회원만 체크",
        "e2e check stop: rein:e2e-runner agent-r1 on it, 세션 dAIZX30NAZGDxNXV, 10 of 40 minutes spent",
        "e2e check slow: ran past its 10 minutes and the hook stopped it, 세션 Qm3vX8sLr2NcTa0p",
        "e2e check grid: waiting for a runner, limit 30 minutes",
        "heads:",
        "- E:/proj: abc123",
        `run directory: ${DIR}`,
      ].join("\n"),
    )
    expect(((await $.tool.call(STATUS)) as { result: string }).result).toBe(text)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"tool":"mcp__rein__status"`)
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"ev":"stage"`)
  })

  test("writes are shown against planFiles, only where they differ", async ($, on) => {
    const run = { v: 2, stage: "dev", runId: "login-fix", rules: [], repos: ["E:/proj"], retries: 0 }
    world(on, {}, undefined, run)
    const record = store.get("runs:proj/login-fix") as Record<string, unknown>
    const shown = async (planFiles: string[] | undefined, writes: string[]) => {
      store.set("runs:proj/login-fix", { ...record, planFiles, writes })
      return ((await $.tool.call(STATUS)) as { result: string }).result
    }
    expect(await shown(["E:/proj/src/a.ts", "E:/proj/src/b.ts"], ["e:/proj/src/B.ts", "E:/proj/src/a.ts"])).toContain("writes: the same files as planFiles\nrules:")
    expect(await shown(["E:/proj/src/a.ts", "E:/proj/src/b.ts"], ["E:/proj/src/a.ts", "E:/proj/src/old.ts"])).toContain(
      "writes: the files of planFiles, with these differences:\n- not written: E:/proj/src/b.ts\n- written, not in planFiles: E:/proj/src/old.ts\nrules:",
    )
    expect(await shown(undefined, ["E:/proj/src/a.ts"])).toContain("writes:\n- E:/proj/src/a.ts\nrules:")
    expect(await shown(["E:/proj/src/a.ts"], [])).not.toContain("writes")
  })

  test("in review the changed files are not listed again under writes", async ($, on) => {
    const files = ["E:/proj/src/a.ts", "E:/proj/src/b.ts"]
    world(on, {}, undefined, { v: 2, stage: "review", runId: "login-fix", rules: [], planFiles: files, repos: ["E:/proj"], writes: files, retries: 0 })
    const text = ((await $.tool.call(STATUS)) as { result: string }).result
    expect(text).toContain("writes: the same files as planFiles\nrules: none frozen")
    expect(text).toContain("Changed files (D49 ③): those of writes, above.\nRules to check (D115): none.")
    expect(text.split("- E:/proj/src/a.ts").length).toBe(2)
  })

  // a failed trace write stops nothing; it toasts once and the record shows it.
  test("a failed trace write toasts once, marks the run and the run goes on", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { writeFails: p => p.endsWith("/trace.jsonl") })
    await grade($)
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    const text = ((await $.tool.call(STATUS)) as { result: string }).result
    expect(text).toContain("stage: plan")
    expect(text).toContain("trace broken (D109): a write to trace.jsonl failed at ")
    expect(text).toContain("); the trace misses lines from then, so it is an incomplete record")
    const at = (store.get("runs:proj/login-fix") as { traceBroken?: { at: string } }).traceBroken?.at
    expect(at).toBeDefined()
    await $.tool.call(STATUS)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/^Rein: login-fix의 trace\.jsonl 쓰기 실패 — 이 run의 기록은 여기서부터 빠짐 \(.+\)$/)
    expect((store.get("runs:proj/login-fix") as { traceBroken?: { at: string } }).traceBroken?.at).toBe(at)
    expect(files[`${DIR}/agent/trace.jsonl`]).toBeUndefined()
  })
})
