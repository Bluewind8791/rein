import { describe, expect } from "claude-code/testing"
import { relay, DIR, grade, SPEC_TEXT, store, world, test } from "./world.ts"

// 1-spec.md as the person approved it and 2-plan.md as it passed,
// and the planned files as dev handed them on (the seal). The main session
// may change any of them; it is told once what changed, and the run stays
// where it is until it moves the run with goto.

const SPEC = `${DIR}/1-spec.md`
const PLAN = `${DIR}/2-plan.md`
const SRC = "E:/proj/src/login.ts"
const DEV_MD = "# dev 결과\n\n## 설계 항목\n\n- [x] src/login.ts\n"
const FROZEN_PLAN = "# plan (frozen)\n"
const WORKER = "worker-1"
const DEV_RUN = {
  v: 2, stage: "dev", runId: "login-fix", rules: [], planFiles: [SRC], repos: ["E:/proj"],
  writes: [SRC], retries: 1, worker: WORKER, frozen: { spec: SPEC_TEXT, plan: FROZEN_PLAN },
}
// A seal that differs from any real digest, so it is broken as found.
const QA_RUN = { ...DEV_RUN, stage: "qa", worker: undefined, sealed: { [SRC]: "stale" } }
const record = () => store.get("runs:proj/login-fix") as { stage: string; retries: number; keepRetries?: true; writes: string[]; frozen?: { spec?: string; plan?: string }; sealed?: Record<string, string> }
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const devMd = { tool: "Write", file_path: `${DIR}/agent/dev-items.md`, content: DEV_MD, agentId: WORKER } as never
const bash = { tool: "Bash", command: "ls" } as never

describe("frozen spec and plan (D160, D176)", () => {
  test("approval freezes 1-spec.md as the person saw it", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, () => "승인")
    await grade($)
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(record().frozen).toEqual({ spec: SPEC_TEXT })
  })

  test("a 1-spec.md changed after approval is told to the main session once; the run stays and the worker's file is judged", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: "# spec\n\n## 완료 판정\n\n아무거나\n", [PLAN]: FROZEN_PLAN, [SRC]: "x" }
    world(on, files, undefined, DEV_RUN)
    const r = await $.tool.call(devMd)
    expect(context(r)).not.toContain("changed after the user approved it")
    expect(record().stage).toBe("review")
    const told = await $.tool.call(bash)
    expect(context(told)).toContain(`${SPEC} changed after the user approved it`)
    expect(context(told)).toContain("call mcp__rein__goto with stage spec")
    expect(record().stage).toBe("review")
    expect(record().frozen).toEqual({ spec: SPEC_TEXT, plan: FROZEN_PLAN })
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"drift"`)
    expect(context(await $.tool.call(bash))).not.toContain("changed after")
  })

  test("a deleted 1-spec.md counts as changed", async ($, on) => {
    world(on, { [PLAN]: FROZEN_PLAN }, undefined, { ...DEV_RUN, stage: "qa" })
    expect(context(await $.tool.call(bash))).toContain(`${SPEC} changed after the user approved it`)
    expect(record().stage).toBe("qa")
  })

  test("a 2-plan.md changed after it passed is told; the run keeps the design it passed with", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [PLAN]: "# plan (edited)\n" }
    world(on, files, undefined, { ...DEV_RUN, stage: "qa" })
    const r = await $.tool.call(bash)
    expect(context(r)).toContain(`${PLAN} changed after it passed`)
    expect(context(r)).toContain("call mcp__rein__goto")
    expect(record()).toMatchObject({ stage: "qa", retries: 1, frozen: { plan: FROZEN_PLAN } })
  })

  test("untouched files are left alone and nothing is said", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }
    world(on, files, undefined, DEV_RUN)
    const r = await $.tool.call(devMd)
    expect(context(r)).not.toContain("D176")
    expect(record().stage).toBe("review")
  })

  test("in plan only 1-spec.md counts; 2-plan.md is still being written", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: "changed\n", [PLAN]: "# a new plan\n" }
    world(on, files, undefined, { ...DEV_RUN, stage: "plan" })
    const r = (await relay($, { tool: "mcp__rein__advance" } as never)) as { deny?: string }
    expect(r.deny).toContain(`${SPEC} changed after the user approved it`)
    expect(r.deny).not.toContain(`${PLAN} changed`)
    expect(record().stage).toBe("plan")
  })

  test("line endings alone are no change: an editor rewrote the CRLF of what was frozen as LF", async ($, on) => {
    const crlf = (s: string) => s.replace(/\n/g, "\r\n")
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }
    world(on, files, undefined, { ...DEV_RUN, frozen: { spec: crlf(SPEC_TEXT), plan: crlf(FROZEN_PLAN) } })
    const r = await $.tool.call(devMd)
    expect(context(r)).not.toContain("D176")
    expect(record().stage).toBe("review")
  })

  test("approving 1-spec.md again shows what changed since the last approval", async ($, on) => {
    const asked: string[] = []
    const now = SPEC_TEXT.replace("세 번", "다섯 번")
    world(on, { [SPEC]: now }, q => (asked.push(q), "승인"), { stage: "spec", runId: "login-fix", frozen: { spec: SPEC_TEXT } })
    await grade($)
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(asked[0]).toContain("바뀐 것 (승인된 내용 → 지금)")
    expect(asked[0]).toContain("> - 로그인에 세 번 실패하면 잠긴다\n> + 로그인에 다섯 번 실패하면 잠긴다")
    expect(asked[0]).not.toContain("## 영향 범위")
    expect(record().frozen).toEqual({ spec: now })
  })

  test("a first approval has nothing to compare and shows no changes", async ($, on) => {
    const asked: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (asked.push(q), "승인"))
    await grade($)
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(asked[0]).not.toContain("바뀐 것")
  })

  test("a run frozen before D160 is not measured", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: "changed\n", [PLAN]: "changed\n", [SRC]: "x" }
    world(on, files, undefined, { ...DEV_RUN, frozen: undefined })
    await $.tool.call(devMd)
    expect(record().stage).toBe("review")
  })

  test("the main session's own write of 1-spec.md is told at once; the run stays", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN }
    world(on, files, undefined, { ...DEV_RUN, stage: "qa" })
    const r = await $.tool.call({ tool: "Write", file_path: SPEC, content: `${SPEC_TEXT}\n더함\n` } as never)
    expect(r).not.toHaveProperty("deny")
    expect(context(r)).toContain(`${SPEC} changed after the user approved it`)
    expect(record().stage).toBe("qa")
  })
})

describe("the seal of what dev handed on (D176)", () => {
  test("dev-items.md seals the planned and handoff files", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }, undefined, DEV_RUN)
    await $.tool.call(devMd)
    expect(Object.keys(record().sealed ?? {})).toEqual([SRC])
  })

  test("a planned file the main session changes after dev is told; goto review has it reviewed again", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }
    world(on, files, undefined, { ...QA_RUN, writes: [] })
    const r = await $.tool.call({ tool: "Bash", command: "sed -i s/x/y/ src/login.ts" } as never)
    expect(r).not.toHaveProperty("deny")
    expect(context(r)).toContain(`these files changed after dev passed: ${SRC}`)
    expect(context(r)).toContain("mcp__rein__goto with stage review")
    expect(record()).toMatchObject({ stage: "qa", retries: 1, sealed: { [SRC]: "stale" } })
    const moved = await $.tool.call({ tool: "mcp__rein__goto", stage: "review" } as never)
    expect(context(moved)).toContain("rein:review")
    expect(record()).toMatchObject({ stage: "review", retries: 0, writes: [SRC] })
    expect(record().sealed?.[SRC]).not.toBe("stale")
  })

  test("a file off the design is the main session's environment and moves nothing", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }, undefined, DEV_RUN)
    await $.tool.call(devMd)
    store.set("runs:proj/login-fix", { ...record(), stage: "qa" })
    const r = await $.tool.call({ tool: "Write", file_path: "E:/proj/.rein/tsc-changed.js", content: "//" } as never)
    expect(r).not.toHaveProperty("deny")
    expect(context(r)).not.toContain("D176")
    expect(record().stage).toBe("qa")
  })

  test("advance tells what changed past a judgment along with its own answer", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [PLAN]: FROZEN_PLAN, [SRC]: "x" }, undefined, QA_RUN)
    const r = await $.tool.call({ tool: "mcp__rein__advance" } as never)
    expect(context(r)).toContain("these files changed after dev passed")
    expect((r as { result?: string }).result).toContain("D50: this needs a decision")
    expect(record().stage).toBe("qa")
  })
})
