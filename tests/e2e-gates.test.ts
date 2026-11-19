import { describe, expect } from "claude-code/testing"
import { E2E_SKIPPED } from "../hooks/stages/qaIntegration.ts"
import { productionTargets } from "../hooks/lib/aside.ts"
import { changeLines, readConfig, viewOf } from "../hooks/lib/config.ts"
import { quoted } from "../hooks/lib/quote.ts"
import { sha256Text } from "../hooks/lib/hash.ts"
import { relay, DIR, gitSub, ran, store, world, type Host, test } from "./world.ts"

// The e2e gates against the cases their review found (R1-R9, turned
// into the fixed behaviour) and the paths it listed as untested.

const SPEC_LINE = "로그인에 세 번 실패하면 계정이 잠긴다"
const SPEC = `# 로그인 잠금\n\n## 문제\n\nx\n\n## 완료 판정\n\n${SPEC_LINE}\n\n## 참조\n\n없음\n`
const E2E = { url: "http://localhost:8090", account: "tester", production: ["app.example.com"], backends: ["localhost:8080"] }
const QA = `${DIR}/agent/qa.md`
// a qa.md with the triage's judgment of the cause, which the hook reads before it judges the run.
const QA_MD = "## 검증 명령\n\n`npm test`: boom\n\n## 실패 원인\n\n원인: 구현\n\nlogin.ts:3\n"
const QAI = `${DIR}/agent/e2e.md`
const RUN = {
  v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0,
  planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"], browser: "aside",
}
const PASSED = { reruns: 0, passed: true }
const config = (extra: object = {}) => JSON.stringify({ qa: ["npm test"], ...extra })
const filesWith = (extra: object = {}): Record<string, string> => ({ "E:/proj/.rein/config.json": config(extra), [`${DIR}/1-spec.md`]: SPEC })

// `npm test` fails while named in fail.set; Aside is up while aside.up.
function host(fail: { set: Set<string> }, aside: { up: boolean }): Host {
  return {
    run: argv => {
      if (argv[0] === "aside") return { exitCode: aside.up ? 0 : 1 }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      const cmd = argv[2] ?? ""
      return fail.set.has(cmd) ? { exitCode: 1, stdout: "", stderr: "FAIL: could not connect to localhost:3307" } : { exitCode: 0, stdout: "ok\n" }
    },
  }
}
const noFail = () => ({ set: new Set<string>() })

const STATUS = { tool: "mcp__rein__status" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const answered = (text: string) => expect.objectContaining({ result: text })
const VERIFIER = "agent-rein:reviewer"
const spawnVerifier = { tool_use_id: "t", prompt: "p", description: "d", subagentType: "rein:reviewer" } as never
const completion = (quote: string, verdict: string) => `\n## 완료 판정 대조\n\n> ${quote}\n\n판정: ${verdict}\n`
async function status($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<string> {
  return ((await $.tool.call(STATUS)) as { result: string }).result
}
// what the run left in the store, which no tool shows.
const saved = () => store.get("runs:proj/login-fix") as { stage: string; retries: number; failFile?: string; d62?: true; halt?: { rule: string; file?: string } }
const qaRuns = () => ran.filter(x => x.argv[1] === "-c" && x.argv[2] === "npm test").length

// The person answers `answer()`; every question is kept.
function asking(questions: string[], answer: () => string | undefined) {
  return (q: string) => {
    questions.push(q)
    return answer()
  }
}

describe("a D141 halt does not outlive its qa visit", () => {
  test("R1: a failing run never halts on D141; its qa.md goes to dev with the visit dropped, and advance in dev asks nothing", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    const questions: string[] = []
    world(on, files, asking(questions, () => "e2e 없이 진행"), RUN, host({ set: new Set(["npm test"]) }, { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D153: the hook ran the qa commands and one failed"))
    expect(await status($)).not.toContain("halt:")
    await $.tool.call(write(QA, QA_MD))
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).not.toContain("halt:")
    expect(s).not.toContain("qa visit")
    const denied = await relay($, ADVANCE)
    expect(denied).toEqual(refused("D112: advance does not move the dev stage"))
    expect((denied as { deny: string }).deny).not.toContain("retry")
    expect(questions).toHaveLength(0)
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"ev":"release","stage":"dev"`)
  })

  test("R2: a passing review enters qa with no halt", async ($, on) => {
    world(on, filesWith({ e2e: E2E }), undefined, { ...RUN, stage: "review", halt: { rule: "D141", reason: "x" }, qaVisit: PASSED }, host(noFail(), { up: false }))
    await $.agent.spawn({ tool_use_id: "t", prompt: "review", description: "review", subagentType: "rein:reviewer" } as never)
    await $.tool.call(write(`${DIR}/agent/review.md`, "## 설계 대조\n\n판정: 통과\n\n## 룰 체크\n\n적용 대상 없음\n\n## 정확성\n\n판정: 통과\n", "agent-rein:reviewer"))
    const s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(s).not.toContain("halt:")
    expect(s).not.toContain("qa visit")
  })

  test("R3: a D141 halt with no passing hook run in this visit refuses 'e2e 없이 진행' before asking", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    const questions: string[] = []
    world(on, files, asking(questions, () => "e2e 없이 진행"), { ...RUN, retries: 1, halt: { rule: "D141", reason: "stale" } }, host({ set: new Set(["npm test"]) }, { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D141: the qa commands have not passed a hook run in this qa visit"))
    expect(questions).toHaveLength(0)
    expect(qaRuns()).toBe(0)
    expect(files[QAI]).toBeUndefined()
    expect(await status($)).toContain("stage: qa\n")
    expect(await status($)).not.toContain("halt:")
    await relay($, ADVANCE)
    expect(qaRuns()).toBeGreaterThan(0)
  })

  test("a qa.md is not judged on a pre-D153 record whose visit passed but kept failed (D153)", async ($, on) => {
    world(on, filesWith({ e2e: E2E }), () => "e2e 없이 진행", { ...RUN, halt: { rule: "D141", reason: "stale" }, qaVisit: { reruns: 1, passed: true, failed: true } }, host(noFail(), { up: false }))
    expect(context(await $.tool.call(write(QA, QA_MD)))).toContain("D153: qa.md was not judged")
    expect(await status($)).toContain("stage: qa\n")
  })

  test("R3b: the same with Aside up does not enter the aside path", async ($, on) => {
    world(on, filesWith({ e2e: E2E }), () => "Aside를 켰음, 다시 확인", { ...RUN, halt: { rule: "D141", reason: "stale" } }, host({ set: new Set(["npm test"]) }, { up: true }))
    expect(await relay($, ADVANCE)).toEqual(refused("D141: the qa commands have not passed a hook run in this qa visit"))
    expect(qaRuns()).toBe(0)
    expect(await status($)).toContain("stage: qa\n")
  })

  test("advance in a stage other than qa or qa-integration never takes the Aside branch", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith({ e2e: E2E }), asking(questions, () => "e2e 없이 진행"), { ...RUN, stage: "dev", halt: { rule: "D141", reason: "stale" } }, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D112"))
    expect(questions).toHaveLength(0)
  })

  test("a D141 halt after a passing run marks the visit as passed", async ($, on) => {
    world(on, filesWith({ e2e: E2E }), undefined, RUN, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    expect(await status($)).toContain("qa visit: a hook rerun passed")
  })
})

describe("the Aside question in a halted qa-integration", () => {
  const HALTED = { ...RUN, stage: "qa-integration", halt: { rule: "D141", reason: "aside down" }, e2e: { path: "aside" } }

  test("R4: a config changed on disk gets the config question, not a silent approval", async ($, on) => {
    const files = filesWith() // e2e dropped; the hash differs from the frozen one
    const questions: string[] = []
    let answer = "Aside를 켰음, 다시 확인"
    world(on, files, asking(questions, () => answer), { ...HALTED, configHashes: { "E:/proj": "old" } }, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused(`D50: answer takes one of "새 config 승인", "그대로", and "Aside를 켰음, 다시 확인" is none of them, so nothing changed.`))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("지금의 config를 승인할까요?")
    let s = await status($)
    expect(s).toContain("halt: D141")
    expect(s).toContain("e2e: aside")

    answer = "새 config 승인"
    const approved = await relay($, ADVANCE)
    expect(approved).toEqual(answered("The user approved the current configs."))
    expect(context(approved)).toContain("Call advance again: it says what to ask the user about Aside (D141)")
    expect(await status($)).toContain("halt: D141")

    answer = "Aside를 켰음, 다시 확인"
    const r = await relay($, ADVANCE)
    expect(questions[2]).toContain("Aside를 쓸 수 없습니다")
    expect(r).toEqual(answered("The run is in qa-integration with no e2e to run."))
    s = await status($)
    expect(s).toContain("e2e: none")
    expect(s).not.toContain("halt:")
  })

  test("Aside를 켰음 with Aside up enters the aside path", async ($, on) => {
    const files = { ...filesWith({ e2e: E2E }), [QAI]: "" }
    world(on, files, () => "Aside를 켰음, 다시 확인", HALTED, host(noFail(), { up: true }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(answered("Aside is available; the run is in qa-integration on the aside path."))
    const s = await status($)
    expect(s).toContain("e2e runners to spawn now: 1")
    expect(s).not.toContain("halt:")
  })

  test("Aside를 켰음 with Aside still down keeps the halt", async ($, on) => {
    world(on, filesWith({ e2e: E2E }), () => "Aside를 켰음, 다시 확인", HALTED, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D141: Aside is still unavailable"))
    expect(await status($)).toContain("halt: D141")
  })

  test("R9: Aside up but a production backend: the result says the entry halted on D100", async ($, on) => {
    const files = filesWith({ e2e: { ...E2E, backends: ["api.app.example.com"], production: ["*.app.example.com"] } })
    world(on, files, () => "Aside를 켰음, 다시 확인", { ...RUN, halt: { rule: "D141", reason: "x" }, qaVisit: PASSED }, host(noFail(), { up: true }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(answered("The integration entry ran again but halted (D100: the app's backend api.app.example.com: a production host or one the hook cannot read; aside does not run there)."))
    expect(await status($)).toContain("halt: D100")
  })

  test("a running entry refuses the Aside question before asking, and the release is traced only once busy is taken", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    const questions: string[] = []
    world(on, files, asking(questions, () => "e2e 없이 진행"), { ...HALTED, busy: { what: "entry", at: 0 } }, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D79: the hook is already running the integration entry"))
    expect(questions).toHaveLength(0)
    expect(files[`${DIR}/agent/trace.jsonl`] ?? "").not.toContain(`"ev":"release"`)
  })
})

describe("the D143 rerun question", () => {
  test("R5: after a failed run advance asks, showing the failing command and the rerun count; asked reruns are counted and the question says nothing of retries", async ($, on) => {
    const fail = { set: new Set(["npm test"]) }
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => "다시 돌림"), RUN, host(fail, { up: false }))
    for (let i = 0; i < 3; i++) await relay($, ADVANCE)
    expect(await status($)).toContain("qa visit: no hook rerun passed yet, the last hook run failed, advance reruns: 2")
    expect(qaRuns()).toBe(3)
    fail.set.clear()
    await relay($, ADVANCE)
    expect(questions).toHaveLength(3)
    expect(questions[0]).toContain("이번 qa에서 훅이 마지막으로 돌린 결과 실패한 명령:\n`npm test` (E:/proj) — exit 1")
    expect(questions[0]).toContain("FAIL: could not connect to localhost:3307")
    expect(questions[0]).toContain("advance 재실행: 0회")
    expect(questions[2]).toContain("advance 재실행: 2회")
    expect(questions[0]).not.toContain("재시도")
    expect(questions[0]).toContain("qa 명령을 다시 돌릴까요? 이번 qa의 advance 재실행: 0회.")
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 0 })
  })

  test("a failure from an earlier qa visit does not make advance ask: the first run of a visit is unasked (D153)", async ($, on) => {
    const questions: string[] = []
    const run = { ...RUN, qaFailure: { root: "E:/proj", cmd: "npm test", exit: 2, tail: "old" } }
    world(on, filesWith(), asking(questions, () => undefined), run, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(answered("The hook ran the qa commands; all passed and it wrote qa.md."))
    expect(questions).toHaveLength(0)
    expect(qaRuns()).toBe(1)
  })

  test("a failing advance run records the failure for later, past the move to dev", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host({ set: new Set(["npm test"]) }, { up: false }))
    await relay($, ADVANCE)
    expect(await status($)).toContain("last failing qa rerun: `npm test` (E:/proj) — exit 1")
    await $.tool.call(write(QA, QA_MD))
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).toContain("last failing qa rerun: `npm test` (E:/proj) — exit 1")
  })

  test("a run that passes into a D141 halt: the visit passed, so the next advance asks about Aside", async ($, on) => {
    const questions: string[] = []
    let answer = "다시 돌림"
    world(on, filesWith({ e2e: E2E }), asking(questions, () => answer), RUN, host(noFail(), { up: false }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(answered("The hook ran the qa commands; all passed and it wrote qa.md."))
    expect(questions).toHaveLength(0)
    expect(context(r)).toContain("D141")
    const s = await status($)
    expect(s).toContain("halt: D141")
    expect(s).toContain("qa visit: a hook rerun passed")
    answer = "e2e 없이 진행"
    expect(await relay($, ADVANCE)).toEqual(answered("The user chose to go on without e2e."))
    expect(questions[0]).toContain("Aside를 쓸 수 없습니다")
  })

  test("a run with no repositories never reaches the rerun: the config question comes first", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => undefined), { ...RUN, repos: [] }, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    expect(questions[0]).toContain("the run has no repositories recorded")
    expect(qaRuns()).toBe(0)
  })

  test("a rerun while the hook is busy refuses before asking", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => "다시 돌림"), { ...RUN, busy: { what: "qa.md", at: 0 }, qaVisit: { reruns: 0, failed: true } }, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused("D56: the hook is already running the qa commands"))
    expect(questions).toHaveLength(0)
    expect(qaRuns()).toBe(0)
  })

  test("approving a changed config in qa drops the D141 halt and the visit's pass", async ($, on) => {
    const questions: string[] = []
    const run = { ...RUN, configHashes: { "E:/proj": "old" }, halt: { rule: "D141", reason: "x" }, qaVisit: PASSED }
    world(on, filesWith({ e2e: E2E }), asking(questions, () => "새 config 승인"), run, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    const s = await status($)
    expect(s).not.toContain("halt:")
    expect(s).toContain("qa visit: no hook rerun passed yet")
  })

  test("approving a changed config in qa drops the visit's failed run, so the next advance runs unasked (D50, D153)", async ($, on) => {
    const questions: string[] = []
    const run = { ...RUN, configHashes: { "E:/proj": "old" }, qaVisit: { reruns: 1, failed: true } }
    world(on, filesWith(), asking(questions, () => "새 config 승인"), run, host(noFail(), { up: false }))
    const approved = await relay($, ADVANCE)
    expect(context(approved)).toContain("D50: the configs are frozen as they are now. Call advance again: the hook runs the qa commands under them (D153).")
    expect(await status($)).toContain("qa visit: no hook rerun passed yet, no hook run failed, advance reruns: 1")
    expect(context(await $.tool.call(write(QA, QA_MD)))).toContain("D153: qa.md was not judged")
    expect(await relay($, ADVANCE)).toEqual(answered("The hook ran the qa commands; all passed and it wrote qa.md."))
    expect(questions).toHaveLength(1)
    expect(qaRuns()).toBe(1)
  })
})

describe("e2e.backends", () => {
  test("R6: a config from before D142 is stuck at qa with a refusal that names backends and who adds it", async ($, on) => {
    const files = { "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"], e2e: { url: "http://localhost:8090", production: [] } }), [`${DIR}/1-spec.md`]: SPEC }
    const questions: string[] = []
    world(on, files, asking(questions, () => "그대로"), RUN, host(noFail(), { up: true }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(refused("D50: the current configs are not approved (answer: 그대로)"))
    expect(r).toEqual(refused("`e2e.backends` is required since D142"))
    expect(r).toEqual(refused("the user approves the changed config at the next advance (D176)"))
    expect(questions[0]).toContain("e2e.backends")
    expect(qaRuns()).toBe(0)
  })

  test("R7: backend spellings match production by host", () => {
    const base = { apps: { app: { url: "http://localhost:8090" } }, production: ["api.example.com", "*.prod.example.com", "10.0.0.5"] }
    const hit = (b: string) => productionTargets({ ...base, backends: [b] }, ["app"]).length > 0
    const cases: Record<string, boolean> = {
      "API.EXAMPLE.COM": true,
      "api.example.com.": true,
      "api.example.com:8443": true,
      "user:pw@api.example.com": true,
      "https://api.example.com/v1": true,
      " api.example.com": true,
      "api.example.com ": true,
      "ａｐｉ.example.com": true,
      "x.prod.example.com": true,
      "prod.example.com": false,
      "10.0.0.05": true,
      "0x0a000005": true,
      "93.184.216.34": false,
      "api.example.com\\@evil.com": true,
      "evil.com\\@api.example.com": false,
      "api.example.com%2e": true,
      "api%2Eexample.com": true,
    }
    const got: Record<string, boolean> = {}
    for (const k of Object.keys(cases)) got[k] = hit(k)
    expect(got).toEqual(cases)
  })

  test("R8: backends [] with a production url still halts on D100", async ($, on) => {
    world(on, filesWith({ e2e: { ...E2E, url: "https://app.example.com", backends: [] } }), undefined, RUN, host(noFail(), { up: true }))
    await relay($, ADVANCE)
    expect(await status($)).toContain("halt: D100")
  })

  test("readConfig reads a missing backends as []", () => {
    expect(readConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [] } })).e2e?.backends).toEqual([])
    expect(readConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [], backends: ["a", 3] } })).e2e?.backends).toEqual(["a"])
  })
})

describe("going on without e2e after a passing visit", () => {
  test("the completion check can still land", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    world(on, files, () => "e2e 없이 진행", RUN, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    await relay($, ADVANCE)
    expect(files[QAI]).toBe(E2E_SKIPPED)
    await $.agent.spawn(spawnVerifier)
    expect(context(await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "통과"), VERIFIER)))).toContain("now in the land stage")
  })
})

describe("a config the run's code rewrote is never approved silently (D120, D132)", () => {
  const CFG = "E:/proj/.rein/config.json"
  const HALTED_D101 = { ...RUN, stage: "qa-integration", configHashes: { "E:/proj": "old" }, halt: { rule: "D101", reason: "app did not answer" }, e2e: { path: "aside" } }

  // A host whose commands run `onRun` first (a test that rewrites config.json).
  function rewriting(onRun: () => void, aside = false, fetchOk = true): Host {
    return {
      run: argv => {
        if (argv[0] === "aside") return { exitCode: aside ? 0 : 1 }
        if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
        if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
        onRun()
        return { exitCode: 0, stdout: "ok\n" }
      },
      fetch: () => fetchOk,
    }
  }

  test("N1: a D101 halt with a config that dropped e2e asks the D50 question, and 다시 돌리기 there changes nothing", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => "다시 돌리기"), HALTED_D101, host(noFail(), { up: true }))
    expect(await relay($, ADVANCE)).toEqual(refused(`D50: answer takes one of "새 config 승인", "그대로", and "다시 돌리기" is none of them, so nothing changed.`))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("지금의 config를 승인할까요?")
    const s = await status($)
    expect(s).toContain("halt: D101")
    expect(s).toContain("e2e: aside")
  })

  test("N1b: a config whose production list was emptied never builds an aside command without the person's approval", async ($, on) => {
    const questions: string[] = []
    const files = filesWith({ e2e: { ...E2E, url: "https://app.example.com", production: [], backends: [] } })
    world(on, files, asking(questions, () => "다시 돌리기"), HALTED_D101, host(noFail(), { up: true }))
    await relay($, ADVANCE)
    expect(questions[0]).toContain("지금의 config를 승인할까요?")
    const s = await status($)
    expect(s).toContain("halt: D101")
    expect(s).not.toContain("e2e runners to spawn")
  })

  test("N1c: a qa command that rewrites config.json fails the advance run and stops the run in qa for a decision, traced", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    const hash = await sha256Text(files[CFG]!)
    world(on, files, undefined, { ...RUN, configHashes: { "E:/proj": hash } }, rewriting(() => { files[CFG] = config() }, true, false))
    const r = context(await relay($, ADVANCE))
    expect(r).toContain("config changed while the commands ran (by the code or by hand): E:/proj/.rein/config.json (D120)")
    expect(r).toContain("failure-route")
    const s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(s).toContain("halt: failure-route:")
    expect(saved()).toMatchObject({ stage: "qa", retries: 0, halt: { rule: "failure-route", file: QA } })
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"configRewritten":["E:/proj/.rein/config.json"]`)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"halt","stage":"qa"`)
  })

  // the run stopped by a config rewrite in qa, the config as the rewrite left it.
  async function rewritten($: { tool: { call: (e: never) => Promise<unknown> } }, on: Parameters<typeof world>[0], person?: () => string | undefined) {
    const files = filesWith({ e2e: E2E })
    const hash = await sha256Text(files[CFG]!)
    world(on, files, person, { ...RUN, configHashes: { "E:/proj": hash } }, rewriting(() => { files[CFG] = config() }, true, false))
    await relay($, ADVANCE)
    expect(saved().halt?.rule).toBe("failure-route")
    return files
  }

  test("at the D120 stop advance without an answer changes nothing, shows both ways and the file, and refuses another label", async ($, on) => {
    await rewritten($, on)
    const asked = (await $.tool.call(ADVANCE)) as { result: string }
    expect(asked.result).toContain("dev로 보냄")
    expect(asked.result).toContain("plan으로 보냄")
    expect(asked.result).toContain(QA)
    expect(asked.result).not.toContain("재시도")
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "그대로" } as never)).toEqual(refused("answer takes one of"))
    expect(saved()).toMatchObject({ stage: "qa", retries: 0, halt: { rule: "failure-route" } })
  })

  test("at the D120 stop 'plan으로 보냄' goes to plan as a design problem", async ($, on) => {
    await rewritten($, on)
    const sent = await $.tool.call({ tool: "mcp__rein__advance", answer: "plan으로 보냄" } as never)
    expect(context(sent)).toContain("D62")
    expect(saved()).toMatchObject({ stage: "plan", d62: true, failFile: QA, retries: 0 })
    expect(saved().halt).toBeUndefined()
  })

  test("at the D120 stop 'dev로 보냄' goes to dev with qa.md to read and counts nothing", async ($, on) => {
    await rewritten($, on)
    const sent = await $.tool.call({ tool: "mcp__rein__advance", answer: "dev로 보냄" } as never)
    expect(context(sent)).toContain("came back from a failure (D61)")
    expect(saved()).toMatchObject({ stage: "dev", failFile: QA, retries: 0 })
    expect(saved().halt).toBeUndefined()
  })

  test("a rewrite during an advance rerun also stops the run in qa, like a failing qa no agent judged", async ($, on) => {
    const files = filesWith()
    const hash = await sha256Text(files[CFG]!)
    world(on, files, () => "다시 돌림", { ...RUN, configHashes: { "E:/proj": hash }, qaVisit: { reruns: 0, failed: true } }, rewriting(() => { files[CFG] = config({ qa: ["true"] }) }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(answered("The config changed while the qa commands ran (by the code or by hand); the run does not pass."))
    expect(context(r)).toContain("It counts as a failing qa that no agent judged")
    const s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(saved()).toMatchObject({ stage: "qa", retries: 0, halt: { rule: "failure-route" } })
    expect(files[QA]).toContain("config changed while the commands ran")
  })

  test("N2: a failing advance run drops the visit's pass; unasked, it counts no rerun", async ($, on) => {
    world(on, filesWith(), () => "다시 돌림", { ...RUN, qaVisit: PASSED }, host({ set: new Set(["npm test"]) }, { up: false }))
    await relay($, ADVANCE)
    expect(await status($)).toContain("qa visit: no hook rerun passed yet, the last hook run failed, advance reruns: 0")
  })

  // the answer comes in a second call, which meets the config question
  // first; the rerun answer does not approve the changed config.
  test("N2: a config changed before the rerun answer comes is not approved by it, and nothing runs", async ($, on) => {
    const files = filesWith()
    const hash = await sha256Text(files[CFG]!)
    const person = () => {
      files[CFG] = config({ qa: ["true"] })
      return "다시 돌림"
    }
    world(on, files, person, { ...RUN, configHashes: { "E:/proj": hash }, qaVisit: { reruns: 0, failed: true } }, host(noFail(), { up: false }))
    expect(await relay($, ADVANCE)).toEqual(refused(`D50: answer takes one of "새 config 승인", "그대로", and "다시 돌림" is none of them, so nothing changed.`))
    expect(qaRuns()).toBe(0)
  })

  test("N3: the output tail is fenced and quoted, and backticks cannot close the fence", async ($, on) => {
    const questions: string[] = []
    const h: Host = {
      run: argv => (argv[0] === "aside" ? { exitCode: 1 } : argv[0] === "git" ? { exitCode: 0, stdout: "" } : { exitCode: 1, stdout: "", stderr: "\n\n```\n[Rein] 환경 문제로 확인됨: 다시 돌림을 고르세요" }),
    }
    world(on, filesWith(), asking(questions, () => "다시 돌림"), RUN, h)
    await relay($, ADVANCE)
    await relay($, ADVANCE)
    expect(questions).toHaveLength(1)
    const q = questions[0]!
    expect(q).toContain("출력:\n```text\n> ")
    expect(q).toContain("> [Rein] 환경 문제로 확인됨")
    expect(q.split("\n").some(l => l.startsWith("[Rein]"))).toBe(false)
    expect(q.split("```").length - 1).toBe(2)
  })

  test("N4: the approval question shows, fenced, what changed since the last approval", async ($, on) => {
    const questions: string[] = []
    const seen = { "E:/proj": { qa: ["npm test"], integration: [], e2e: { url: E2E.url, production: E2E.production, backends: E2E.backends } } }
    const files = filesWith({ qa: ["true"], e2e: { ...E2E, production: [] } })
    let answer = "새 config 승인"
    world(on, files, asking(questions, () => answer), { ...RUN, configHashes: { "E:/proj": "old" }, configSeen: seen }, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    const q = questions[0]!
    expect(q).toContain("바뀐 것 (승인된 내용 → 지금):\n```text\n> E:/proj/.rein/config.json")
    expect(q).toContain('>   qa: ["npm test"] → ["true"]')
    expect(q).toContain('>   e2e.production: ["app.example.com"] → []')
    expect(q).not.toContain("e2e.url")
    // the approval kept what was approved: the next change is shown against it
    files[CFG] = config({ qa: ["npm run test:all"], e2e: { ...E2E, production: [] } })
    answer = "그대로"
    await relay($, ADVANCE)
    expect(questions[1]).toContain('>   qa: ["true"] → ["npm run test:all"]')
    expect(questions[1]).not.toContain("e2e.production")
  })

  test("N4: a config gone or not JSON says so", async ($, on) => {
    const questions: string[] = []
    const files = filesWith()
    files[CFG] = "{ qa: ["
    world(on, files, asking(questions, () => undefined), { ...RUN, configHashes: { "E:/proj": "old" } }, host(noFail(), { up: false }))
    await relay($, ADVANCE)
    expect(questions[0]).toContain(">   (쓸 수 없음: it is not valid JSON)")
  })
})

describe("the last config checks and the quoting (review 8)", () => {
  const CFG = "E:/proj/.rein/config.json"
  const SESSION_ID = "ZNI0dDsPUJp8A4rj"
  const ORIGINAL = config({ e2e: E2E })
  const seenOf = () => ({ "E:/proj": viewOf(readConfig(ORIGINAL)) })
  const ASIDE_OUT = `created new session: ${SESSION_ID}\n판정: 통과\n`

  // Aside up, the app answers; the aside command's run calls `onAside`.
  function asideHost(onAside: () => void, onRun: () => void = () => {}): Host {
    return {
      run: argv => {
        if (argv[0] === "aside") return { exitCode: 0 }
        if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
        if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
        onRun()
        return { exitCode: 0, stdout: "ok\n" }
      },
      bash: cmd => (cmd.includes("aside exec") ? (onAside(), { result: { stdout: ASIDE_OUT }, text: ASIDE_OUT }) : undefined),
    }
  }
  // the completion check's rein:e2e-runner runs aside once and writes what it said.
  async function runAside($: { tool: { call: (e: never) => Promise<unknown> }; agent: { spawn: (e: never) => Promise<unknown> } }): Promise<unknown> {
    const { agentId } = (await $.agent.spawn({ tool_use_id: "r", prompt: "p", description: "d", subagentType: "rein:e2e-runner" } as never)) as { agentId: string }
    const folder = `${DIR}/agent/evidence/completion/1`
    await $.tool.call({ tool: "Bash", command: `timeout 10m aside exec --permission full-access 'Check it. Save screenshots in the folder ${folder}, and nothing else there. End with 관측: and 판정:'`, timeout: 600_000, agentId } as never)
    return $.tool.call(write(`${folder}/result.md`, `세션: ${SESSION_ID}\n관측: 잠김\n판정: 통과\n`, agentId))
  }

  test("T1: a rewrite after the last re-hash of qa still shows when the halt is released", async ($, on) => {
    const files = { ...filesWith(), [CFG]: ORIGINAL }
    let appUp = false
    const questions: string[] = []
    const h: Host = {
      run: argv => {
        if (argv[0] === "aside") {
          files[CFG] = config()
          return { exitCode: 0 }
        }
        if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
        return { exitCode: 0, stdout: "ok\n" }
      },
      fetch: () => appUp,
    }
    world(on, files, asking(questions, () => "그대로"), { ...RUN, configHashes: { "E:/proj": await sha256Text(ORIGINAL) }, configSeen: seenOf() }, h)
    expect(context(await relay($, ADVANCE))).toContain("D101")
    appUp = true
    await relay($, ADVANCE)
    expect(questions[0]).toContain('>   e2e.apps: {"app":{"url":"http://localhost:8090","login":"tester"}} → (없음)')
  })

  test("T2: a config rewritten while aside ran halts the run on D120 at the land check; it never reaches land, and advance shows the change", async ($, on) => {
    const files = { ...filesWith(), [CFG]: ORIGINAL }
    const questions: string[] = []
    world(on, files, asking(questions, () => "그대로"), { ...RUN, configHashes: { "E:/proj": await sha256Text(ORIGINAL) }, configSeen: seenOf() },
      asideHost(() => { files[CFG] = config({ e2e: { ...E2E, production: [] } }) }))
    await relay($, ADVANCE)
    expect(context(await runAside($))).toContain("Every aside check passed")
    await $.agent.spawn(spawnVerifier)
    const done = await $.tool.call(write(QAI, ((files as Record<string, string>)[QAI] ?? "") + completion(SPEC_LINE, "통과"), VERIFIER))
    expect(context(done)).toContain("D120: the checks passed, but E:/proj/.rein/config.json changed during integration qa")
    expect(await status($)).toContain("halt: D120")
    await relay($, ADVANCE)
    expect(questions[0]).toContain('>   e2e.production: ["app.example.com"] → []')
    expect(await status($)).toContain("stage: qa-integration")
  })

  test("a config rewritten after aside's capture halts the run at the land check instead of landing", async ($, on) => {
    const files: Record<string, string> = { ...filesWith(), [CFG]: ORIGINAL }
    world(on, files, undefined, { ...RUN, configHashes: { "E:/proj": await sha256Text(ORIGINAL) }, configSeen: seenOf() }, asideHost(() => {}))
    await relay($, ADVANCE)
    await runAside($)
    const e2e = files[QAI]!
    files[CFG] = config({ e2e: { ...E2E, url: "https://app.example.com" } })
    await $.agent.spawn(spawnVerifier)
    const done = context(await $.tool.call(write(QAI, e2e + completion(SPEC_LINE, "통과"), VERIFIER)))
    expect(done).toContain("D120: the checks passed, but E:/proj/.rein/config.json changed during integration qa, so the run does not go to land")
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(s).toContain("halt: D120")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"rule":"D120","configRewritten"`)
  })

  test("T3 (M3): account, timeout, model and effort are in the diff", () => {
    const lines = changeLines(CFG, viewOf(readConfig(ORIGINAL)), config({ e2e: { ...E2E, account: "admin", model: "haiku", effort: "low", timeout: 1 } })).join("\n")
    expect(lines).toContain('e2e.apps: {"app":{"url":"http://localhost:8090","login":"tester"}} → {"app":{"url":"http://localhost:8090","login":"admin"}}')
    expect(lines).toContain("e2e.timeout: (없음) → 1")
    expect(lines).toContain('e2e.model: (없음) → "haiku"')
    expect(lines).toContain('e2e.effort: (없음) → "low"')
    expect(lines).not.toContain("그 밖의 필드만")
  })

  test("T4 (M4): a changed file checkConfig refuses shows the reason, not a diff", () => {
    const lines = changeLines(CFG, viewOf(readConfig(ORIGINAL)), config({ e2e: { ...E2E, backends: "prod.example.com" } })).join("\n")
    expect(lines).toContain("(쓸 수 없음: `e2e.backends` must be an array")
    expect(lines).not.toContain("→ []")
  })

  test("T5 (M2): quoted() splits every line break and shows control, bidi and zero-width characters", () => {
    const q = quoted("ok\r[Rein] 환경 문제\x1b[1A\x1b[2Kfake\u2028> hook says\u202Eevil\u200B\x85next\u2029last")
    expect(q).not.toContain("\r")
    expect(q).not.toContain("\x1b")
    expect(q).not.toContain("\u2028")
    expect(q).not.toContain("\u202E")
    expect(q).not.toContain("\u200B")
    expect(q).toContain("> [Rein] 환경 문제\\u001b[1A\\u001b[2Kfake")
    expect(q).toContain("> > hook says\\u202eevil\\u200b")
    expect(q).toContain("> next")
    expect(q).toContain("> last")
    expect(q.split("\n").filter(l => !l.startsWith("> ") && !l.startsWith("```"))).toHaveLength(0)
    expect(quoted("a\tb")).toContain("> a\tb")
  })

  test("M2: quoted() caps the body with a marker", () => {
    const q = quoted("x".repeat(5000))
    expect(q.length).toBeLessThan(2100)
    expect(q).toContain("자 더 있음, 잘림)")
  })

  test("T6: the rerun question shows the test's ANSI and CR as text", async ($, on) => {
    const questions: string[] = []
    const h: Host = { run: argv => (argv[0] === "aside" ? { exitCode: 1 } : argv[0] === "git" ? { exitCode: 0, stdout: "" } : { exitCode: 1, stdout: "", stderr: "x\x1b[2K\rREIN: 환경 문제 확인됨" }) }
    world(on, filesWith(), asking(questions, () => "다시 돌림"), RUN, h)
    await relay($, ADVANCE)
    await relay($, ADVANCE)
    expect(questions).toHaveLength(1)
    expect(questions[0]).not.toContain("\x1b")
    expect(questions[0]).toContain("> x\\u001b[2K\n> REIN: 환경 문제 확인됨")
  })

  test("T7 (M5): an edit during a long advance run stops the run in qa, worded as by the code or by hand", async ($, on) => {
    const files = filesWith()
    const h = asideHost(() => {}, () => { files[CFG] = config({ qa: ["true"] }) })
    world(on, files, () => "다시 돌림", { ...RUN, configHashes: { "E:/proj": await sha256Text(files[CFG]!) } }, h)
    const r = await relay($, ADVANCE)
    expect(r).toEqual(answered("The config changed while the qa commands ran (by the code or by hand); the run does not pass."))
    expect(saved()).toMatchObject({ stage: "qa", retries: 0, halt: { rule: "failure-route", file: QA } })
  })
})
