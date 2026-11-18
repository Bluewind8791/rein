import { describe, expect, test } from "claude-code/testing"
import { E2E_SKIPPED, e2eSection, integrationGuard, withHistory } from "../hooks/stages/qaIntegration.ts"
import { relay, DIR, clock, gitSub, ran, spawned, store, world, type Host } from "./world.ts"

// Work qa and integration qa, with the aside
// path as impl-plan §6 measured it. process.run, http.fetch
// and the Bash tool are played by the host beneath the plugin.

const SPEC_LINE = "로그인에 세 번 실패하면 계정이 잠긴다"
const SPEC = `# 로그인 잠금\n\n## 문제\n\nx\n\n## 완료 판정\n\n${SPEC_LINE}\n\n## 참조\n\n없음\n`
const E2E = { url: "http://localhost:8090", account: "tester", production: ["app.example.com"], backends: ["localhost:8080"] }
const QA = `${DIR}/agent/qa.md`
const QAI = `${DIR}/agent/e2e.md`
const SESSION_ID = "ZNI0dDsPUJp8A4rj"
const RUN = {
  v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0,
  planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"], browser: "aside",
}

// a qa.md of a failed run, with the triage's judgment of the cause.
const QA_MD = (cause: string) => `## 검증 명령\n\n\`npm test\`: boom\n\n## 실패 원인\n\n원인: ${cause}\n\nlogin.ts:3\n`

const config = (extra: object = {}) => JSON.stringify({ qa: ["npm test", "cd sub && npm test"], ...extra })
const filesWith = (extra: object = {}): Record<string, string> => ({ "E:/proj/.rein/config.json": config(extra), [`${DIR}/1-spec.md`]: SPEC })

// Every shell command exits 0 unless named in `fail`; git rev-parse answers a
// HEAD; `aside session list` exits `aside`.
function host(fail: Record<string, string> = {}, aside = 1, more: Host = {}): Host {
  return {
    run: argv => {
      if (argv[0] === "aside") return { exitCode: aside }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      const cmd = argv[2] ?? ""
      return cmd in fail ? { exitCode: 1, stdout: "", stderr: fail[cmd] } : { exitCode: 0, stdout: "ok\n" }
    },
    ...more,
  }
}

const STATUS = { tool: "mcp__rein__status" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const VERIFIER = "agent-rein:reviewer"
const spawnVerifier = { tool_use_id: "t", prompt: "p", description: "d", subagentType: "rein:reviewer" } as never
const bash = (command: string, timeout?: number) => ({ tool: "Bash", command, timeout }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
// a gate called without the user's answer says what to ask; it refuses nothing.
const asks = (text: string) => expect.objectContaining({ result: expect.stringContaining(text) })
const ok = expect.objectContaining({ result: "ok" })
const completion = (quote: string, verdict: string) => `\n## 완료 판정 대조\n\n> ${quote}\n\n판정: ${verdict}\n`

async function status($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<string> {
  return ((await $.tool.call(STATUS)) as { result: string }).result
}

// a plan from before the checks has one aside check, the completion line;
// its rein:e2e-runner runs aside in the form the hook asks for and writes
// what aside said.
const SPAWN_RUNNER = { tool_use_id: "r", prompt: "p", description: "d", subagentType: "rein:e2e-runner" } as never
const RUNNER = "agent-rein:e2e-runner"
const FOLDER = (n = 1) => `${DIR}/agent/evidence/completion/${n}`
const EXEC = (minutes = 10, n = 1) => `timeout ${minutes}m aside exec --permission full-access 'Check it. Save screenshots in the folder ${FOLDER(n)}, and nothing else there. End with 관측: and 판정:'`
const asRunner = (command: string, timeout = 600000, agentId = RUNNER) => ({ tool: "Bash", command, timeout, agentId }) as never
const result = (verdict: string, n = 1, agentId = RUNNER) => write(`${FOLDER(n)}/result.md`, `세션: ${SESSION_ID}\n관측: 로그인 3회 실패 후 잠김 확인\n판정: ${verdict}\n`, agentId)
async function runCompletion($: { tool: { call: (e: never) => Promise<unknown> }; agent: { spawn: (e: never) => Promise<unknown> } }, verdict: string): Promise<unknown> {
  await $.agent.spawn(SPAWN_RUNNER)
  await $.tool.call(asRunner(EXEC()))
  return $.tool.call(result(verdict))
}

const ASIDE_OUT = (verdict: string) =>
  `\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m\n\x1b[36mopening http://localhost:8090\x1b[0m\n로그인 3회 실패 후 잠김 확인\n판정: ${verdict}\x1b[0m\n`

describe("work qa", () => {
  // the main session writes and runs what it likes in qa; the run's
  // qa commands still run only as the hook's, through advance.
  test("the main session writes and runs anything in qa; the hook alone runs the run's qa commands (D153)", async ($, on) => {
    world(on, filesWith(), () => "커밋", RUN, host())
    expect(await $.tool.call(write("E:/proj/.rein/tsc-changed.js", "x"))).toEqual(ok)
    for (const cmd of ["git status", "npm test", "cd sub && npm test", "git commit -m x"]) {
      expect([cmd, await relay($, bash(cmd))]).toEqual([cmd, ok])
    }
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    expect(await status($)).toContain("stage: qa\n")
  })

  test("a qa.md before any failed hook run is not judged: the hook runs the qa commands (D153)", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host())
    expect(context(await $.tool.call(write(QA, QA_MD("구현"))))).toContain("D153: qa.md was not judged")
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    expect(await status($)).toContain("stage: qa\n")
  })

  test("advance runs every qa command in the repository without asking; all pass writes qa.md and enters qa-integration (D153)", async ($, on) => {
    const files = filesWith()
    const questions: string[] = []
    world(on, files, q => (questions.push(q), undefined), RUN, host())
    const r = await relay($, ADVANCE)
    expect(questions).toHaveLength(0)
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toEqual([
      { argv: ["C:/Program Files/Git/bin/bash.exe", "-c", "npm test"], cwd: "E:/proj" },
      { argv: ["C:/Program Files/Git/bin/bash.exe", "-c", "cd sub && npm test"], cwd: "E:/proj" },
    ])
    expect(r).toEqual(expect.objectContaining({ result: "The hook ran the qa commands; all passed and it wrote qa.md." }))
    expect(files[QA]).toContain("- `npm test` (E:/proj) — exit 0")
    expect(files[QA]).toContain("(훅이 advance에서 돌림, D153)")
    expect(context(r)).toContain("D72: the qa commands passed; there is no e2e to run")
    expect(files[QAI]).toContain("판정: 통과")
    expect(await status($)).toContain("stage: qa-integration\n")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"rerun","stage":"qa"`)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"rule":"D153"`)
  })

  test("a failing qa command keeps the run in qa with the whole output in qa-output.log; qa.md then sends it to dev without running the commands again (D153)", async ($, on) => {
    const out = `EARLY LINE\n${"x".repeat(3000)}\nFAIL src/login.test.ts\n  expected 401`
    const files = filesWith()
    world(on, files, undefined, RUN, host({ "cd sub && npm test": out }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(refused("D153: the hook ran the qa commands and one failed:\n- `npm test` (E:/proj) — exit 0\n- `cd sub && npm test` (E:/proj) — exit 1"))
    expect(r).toEqual(refused("expected 401"))
    expect(r).toEqual(refused(`The whole output of the failing commands is in ${DIR}/agent/qa-output.log`))
    expect((r as { deny: string }).deny).not.toContain("EARLY LINE")
    expect(files[`${DIR}/agent/qa-output.log`]).toBe(`$ cd sub && npm test  (E:/proj) — exit 1\n${out}\n`)
    expect(files[QA]).toBeUndefined()
    let s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(s).not.toContain("retries:")
    expect(s).toContain("qa visit: no hook rerun passed yet, the last hook run failed, advance reruns: 0")

    ran.length = 0
    const w = await $.tool.call(write(QA, "## 검증 명령\n\n`cd sub && npm test`: expected 401\n\n## 실패 원인\n\n원인: 구현\n\nsub 테스트가 401을 기대함\n"))
    expect(context(w)).toContain("D153: qa.md reports the hook's failed run of the qa commands.")
    expect(context(w)).toContain(`came back from a failure (D61): the hook tells the worker to read ${QA}`)
    expect(context(w)).not.toContain("retry")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 1 })
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).toContain(`failFile: ${QA}`)
    expect(s).not.toContain("qa visit")
  })

  test("rein:triage is the main session's hand: its qa.md after a failed run sends the run to dev", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host({ "npm test": "FAIL" }))
    await relay($, ADVANCE)
    const spawn = { tool_use_id: "t", prompt: "triage", description: "triage", subagentType: "rein:triage", background: false }
    const { agentId } = (await $.agent.spawn(spawn as never)) as { agentId?: string }
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:triage", prompt: "triage" }))
    const w = await $.tool.call(write(QA, QA_MD("구현"), agentId))
    expect(context(w)).toContain("D153: qa.md reports the hook's failed run of the qa commands.")
    expect(await status($)).toContain("stage: dev")
  })

  test("a qa.md with 원인: 설계 goes to plan from the first failure", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host({ "npm test": "boom" }))
    expect(await relay($, ADVANCE)).toEqual(refused("D153: the hook ran the qa commands and one failed"))
    const r = await $.tool.call(write(QA, QA_MD("설계")))
    expect(context(r)).toContain("D62")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", d62: true, failFile: QA, retries: 0 })
  })

  test("a qa.md with 원인: 구현 goes to dev even with the old two retries spent", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, retries: 2 }, host({ "npm test": "boom" }))
    await relay($, ADVANCE)
    await $.tool.call(write(QA, QA_MD("구현")))
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "dev", retries: 3, failFile: QA })
  })

  test("at the hidden cap an implementation qa.md keeps the run in qa and stops it; a design qa.md still goes to plan", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, retries: 4 }, host({ "npm test": "boom" }))
    await relay($, ADVANCE)
    const held = await $.tool.call(write(QA, QA_MD("구현")))
    expect(context(held)).toContain("failure-route")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "qa", halt: { rule: "failure-route", file: QA } })
    const s = await status($)
    expect(s).toContain("halt: failure-route:")
    expect(s).not.toContain("retries:")
  })

  test("at the hidden cap a design qa.md still goes to plan", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, retries: 4 }, host({ "npm test": "boom" }))
    await relay($, ADVANCE)
    await $.tool.call(write(QA, QA_MD("설계")))
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", d62: true })
  })

  test("a qa.md without a usable 원인 line is not judged: the run stays in qa and the result says to write it again", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host({ "npm test": "boom" }))
    await relay($, ADVANCE)
    for (const bad of ["## 검증 명령\n\n`npm test`: boom\n", `${QA_MD("환경")}`, `${QA_MD("구현")}\n원인: 설계\n`]) {
      const w = await $.tool.call(write(QA, bad))
      expect(context(w)).toContain("## 실패 원인")
      expect(context(w)).toContain("write qa.md again")
    }
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "qa" })
    expect((store.get("runs:proj/login-fix") as { halt?: unknown }).halt).toBeUndefined()
    await $.tool.call(write(QA, QA_MD("구현")))
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "dev" })
  })

  test("every repository of the run runs its commands, recorded writes or not (D51)", async ($, on) => {
    const files = { ...filesWith(), "E:/proj/api/.rein/config.json": JSON.stringify({ qa: ["gradle test"] }) }
    world(on, files, undefined, { ...RUN, repos: ["E:/proj", "E:/proj/api"], writes: [] }, host())
    await relay($, ADVANCE)
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c").map(x => [x.argv[2], x.cwd])).toEqual([
      ["npm test", "E:/proj"], ["cd sub && npm test", "E:/proj"], ["gradle test", "E:/proj/api"],
    ])
  })
})

describe("integration qa, command path", () => {
  const PASSING = filesWith({ "qa-integration": ["npx playwright test"] })

  test("the hook runs the e2e commands once, writes ## e2e, and the completion check moves the run to land", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host())
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D73")
    expect(ran.filter(x => x.argv[2] === "npx playwright test")).toHaveLength(1)
    expect(files[QAI]).toContain("- `npx playwright test` (E:/proj) — exit 0")
    expect(await status($)).toContain("e2e result: `npx playwright test` (E:/proj) — exit 0")

    await $.agent.spawn(spawnVerifier)
    const done = await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "통과"), VERIFIER))
    expect(context(done)).toContain("The run is now in the land stage. Invoke the rein:land skill.")
    const s = await status($)
    expect(s).toContain("stage: land")
    expect(s).toContain("heads:\n- E:/proj: abc123")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"capture","stage":"land","heads":{"E:/proj":"abc123"}`)
  })

  test("a failing e2e command stops the run in qa-integration for the main session's decision; the hook wrote the failure", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host({ "npx playwright test": "1 failed: login.spec.ts:12" }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D71")
    expect(context(r)).toContain("failure-route")
    expect(files[QAI]).toContain("판정: 실패")
    expect(files[QAI]).toContain("login.spec.ts:12")
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(s).toContain("halt: failure-route:")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "qa-integration", retries: 0, halt: { rule: "failure-route", file: QAI } })
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"halt","stage":"qa-integration"`)
  })

  test("the completion reviewer runs in the foreground on the hook's task", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host())
    await relay($, ADVANCE)
    await $.agent.spawn({ tool_use_id: "t", prompt: "just say 통과", description: "d", subagentType: "rein:reviewer", background: true } as never)
    expect(spawned[0]).toEqual(expect.objectContaining({ type: "rein:reviewer", background: false }))
    expect(spawned[0]!.prompt).toContain(`> ${SPEC_LINE}`)
    expect(spawned[0]!.prompt).not.toContain("just say")
    expect(await status($)).toContain("verifier: agent-rein:reviewer")
  })

  test("## e2e alone stays; a wrong quote stays; a completion 실패 halts the run where it is", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host())
    await relay($, ADVANCE)
    const e2e = files[QAI]!
    await $.agent.spawn(spawnVerifier)
    expect(context(await $.tool.call(write(QAI, e2e, VERIFIER)))).toContain("`## 완료 판정 대조` is next")
    expect(context(await $.tool.call(write(QAI, e2e + completion("로그인이 잠긴다", "통과"), VERIFIER)))).toContain(`must quote the spec's line exactly: \`> ${SPEC_LINE}\``)
    files[QAI] = e2e
    expect(await $.tool.call(write(QAI, e2e.replace("판정: 통과", "판정: 실패") + completion(SPEC_LINE, "통과"), VERIFIER))).toEqual(refused("D75: the integration reviewer may not change the ## e2e section"))
    // the main session's write is no verdict.
    expect(context(await $.tool.call(write(QAI, e2e + completion(SPEC_LINE, "통과"))))).toBe("")
    expect(await status($)).toContain("stage: qa-integration")
    files[QAI] = e2e
    const r = await $.tool.call(write(QAI, e2e + completion(SPEC_LINE, "실패"), VERIFIER))
    expect(context(r)).toContain("completion-failed: the completion check in e2e.md failed, so the run is halted in qa-integration.")
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(s).toContain("halt: completion-failed")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 0 })
    expect(await relay($, ADVANCE)).toEqual(refused("completion-failed: the completion check in e2e.md failed"))
    expect(await relay($, ADVANCE)).toEqual(refused("call mcp__rein__goto"))
  })

  test("after a failed completion check goto land accepts the evidence: land starts from the changed repositories' HEAD", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host())
    await relay($, ADVANCE)
    await $.agent.spawn(spawnVerifier)
    await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "실패"), VERIFIER))
    const r = await $.tool.call({ tool: "mcp__rein__goto", stage: "land", said: "해당 스크린샷 근거 승인" } as never)
    expect(r).toEqual(expect.objectContaining({ result: "The run is now in the land stage." }))
    expect(context(r)).toContain("Invoke the rein:land skill.")
    const s = await status($)
    expect(s).toContain("stage: land")
    expect(s).toContain("heads:\n- E:/proj: abc123")
    expect(s).not.toContain("halt:")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"from":"qa-integration","to":"land","tool":"mcp__rein__goto","said":"해당 스크린샷 근거 승인"`)
  })

  test("after a failed completion check goto qa-integration runs the entry again; goto plan sends it to plan with no approval held", async ($, on) => {
    const files = { ...PASSING }
    world(on, files, undefined, RUN, host())
    await relay($, ADVANCE)
    await $.agent.spawn(spawnVerifier)
    await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "실패"), VERIFIER))
    const again = await $.tool.call({ tool: "mcp__rein__goto", stage: "qa-integration" } as never)
    expect(context(again)).toContain("D73")
    expect(ran.filter(x => x.argv[2] === "npx playwright test")).toHaveLength(2)
    expect(ran.filter(x => x.argv[2] === "npm test")).toHaveLength(1)
    expect(await status($)).not.toContain("halt:")
    expect(files[QAI]!.split("## 이전 진입")[0]).not.toContain("완료 판정 대조")
    expect(files[QAI]).toContain("## 이전 진입\n\n### 1차 진입 — e2e\n")
    expect(files[QAI]).toContain("### 1차 진입 — 완료 판정 대조\n")
    const back = await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)
    expect(context(back)).toContain("The run is now in the plan stage. Invoke the rein:plan skill.")
    const s = await status($)
    expect(s).toContain("stage: plan")
    expect(s).not.toContain("d62")
  })

  test("goto is the main session's alone, and takes only a stage", async ($, on) => {
    world(on, { ...PASSING }, undefined, RUN, host())
    expect(await $.tool.call({ tool: "mcp__rein__goto", stage: "land", agentId: "agent-x" } as never)).toEqual(refused("is called only by the main session"))
    expect(await $.tool.call({ tool: "mcp__rein__goto", stage: "done" } as never)).toEqual(refused("stage takes one of spec, plan, dev, review, qa, qa-integration, land."))
    expect(await status($)).toContain("stage: qa\n")
  })

  test("goto land with no planned file changed is refused", async ($, on) => {
    const quiet: Host = { run: argv => (argv[0] === "git" && gitSub(argv) === "status" ? { exitCode: 0, stdout: "" } : { exitCode: 0, stdout: "abc123\n" }) }
    world(on, { ...PASSING }, undefined, RUN, quiet)
    expect(await $.tool.call({ tool: "mcp__rein__goto", stage: "land" } as never)).toEqual(refused("git status shows no planned file changed in any repository, so land has nothing to commit."))
    expect(await status($)).toContain("stage: qa\n")
  })
})

describe("integration qa, aside path", () => {
  const ASIDE = filesWith({ e2e: E2E, "qa-integration": ["npx playwright test"] })

  test("aside needs both the app and an e2e key", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host({}, 0))
    await relay($, ADVANCE)
    expect(await status($)).toContain("e2e: none")
  })

  test("without the app the command path runs instead", async ($, on) => {
    world(on, { ...ASIDE }, undefined, RUN, host({}, 1))
    await relay($, ADVANCE)
    expect(await status($)).toContain("e2e: playwright")
  })

  test("a production url halts the run before any command is built", async ($, on) => {
    const files = filesWith({ e2e: { ...E2E, url: "https://APP.example.com/login" } })
    world(on, files, undefined, RUN, host({}, 0))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D100: the run is in the qa-integration stage but halted")
    const s = await status($)
    expect(s).toContain("halt: D100")
    expect(s).not.toContain("e2e runners to spawn")
  })

  test("an url that does not answer halts the run", async ($, on) => {
    world(on, { ...ASIDE }, undefined, RUN, host({}, 0, { fetch: () => false }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D101")
    expect(await status($)).toContain("halt: D101: http://localhost:8090 did not answer")
  })

  test("the runner's task carries the check, the config's model and effort and the production hosts; its call runs under the full Bash timeout", async ($, on) => {
    const files = filesWith({ e2e: { ...E2E, model: "haiku", effort: "low", timeout: 5 } })
    world(on, files, undefined, RUN, host({}, 0, { bash: () => ({ result: { stdout: ASIDE_OUT("통과"), stderr: "" }, text: ASIDE_OUT("통과") }) }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("aside path")
    await $.agent.spawn(SPAWN_RUNNER)
    const task = spawned[0]!.prompt!
    expect(task).toContain("timeout 5m aside exec --permission full-access -m 'haiku' --effort 'low' '<prompt>'")
    expect(task).toContain(`- Task: Check whether this statement is true: ${SPEC_LINE}`)
    expect(task).toContain("- Log in: tester")
    expect(task).toContain("- Production hosts, never to be opened: app.example.com")
    expect(task).toContain("if the app sends requests to one of them, to stop at once, say so and end with 판정: 실패")
    expect(task).toContain("- Time limit: 5 minutes in all")
    expect(await $.tool.call(asRunner(EXEC(5), 120000))).toEqual(refused("run aside with the Bash timeout 600000"))
    expect(context(await $.tool.call(asRunner(EXEC(5))))).toContain(`The hook captured session ${SESSION_ID}; aside ended with 판정: 통과`)
    expect(context(await $.tool.call(result("통과")))).toContain("check completion: 판정: 통과. Every aside check passed")
    expect(await status($)).toContain(`e2e check completion: 판정: 통과, 세션 ${SESSION_ID}`)
  })

  test("the hook writes ## e2e from what it captured; then the completion check moves the run to land", async ($, on) => {
    const files = { ...ASIDE }
    world(on, files, undefined, RUN, host({}, 0, { bash: () => ({ result: { stdout: "", stderr: "" }, text: ASIDE_OUT("통과") }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(spawnVerifier)
    expect(context(await $.tool.call(write(QAI, (files[QAI] ?? "") + completion(SPEC_LINE, "통과"), VERIFIER)))).toContain("D79: e2e.md was saved but the run stays in qa-integration")
    files[QAI] = ""
    await runCompletion($, "통과")
    const e2e = files[QAI]!
    expect(e2e).toContain(`### completion\n\n- 할 일: Check whether this statement is true: ${SPEC_LINE}\n`)
    expect(e2e).toContain(`- 결과: 통과\n- aside 세션: ${SESSION_ID}\n`)
    expect(e2e).toContain("판정: 통과\n")
    // A ## e2e changed by hand is not what the hook wrote: the reviewer's write does not pass.
    files[QAI] = e2e.replace("세션", "session")
    expect(context(await $.tool.call(write(QAI, files[QAI]!, VERIFIER)))).toContain("must stay exactly as the hook wrote it")
    files[QAI] = e2e
    expect(context(await $.tool.call(write(QAI, e2e, VERIFIER)))).toContain("`## 완료 판정 대조` is next")
    const r = await $.tool.call(write(QAI, e2e + completion(SPEC_LINE, "통과"), VERIFIER))
    expect(context(r)).toContain("now in the land stage")
  })

  test("an aside 실패 halts the run for the user; dev로 보냄 sends it to dev and counts nothing (D173)", async ($, on) => {
    const files = { ...ASIDE }
    world(on, files, () => "dev로 보냄", RUN, host({}, 0, { bash: () => ({ result: { stdout: "", stderr: "" }, text: ASIDE_OUT("실패") }) }))
    await relay($, ADVANCE)
    const r = await runCompletion($, "실패")
    expect(context(r)).toContain("Every aside check has a verdict and these aside checks failed: completion")
    expect(files[QAI]).toContain("- 결과: 실패\n- aside 세션: ZNI0dDsPUJp8A4rj\n")
    expect(await status($)).toContain("halt: D173")
    const sent = await relay($, ADVANCE)
    expect(context(sent)).toContain("D173: the user judged the failed checks an implementation problem")
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).toContain(`failFile: ${QAI}`)
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "dev", retries: 0 })
  })

  test("the D173 question lists dev로 보냄 then plan으로 보냄, says nothing of retries, and plan으로 보냄 goes to plan as a design problem", async ($, on) => {
    const files = { ...ASIDE }
    let answer: string | undefined
    world(on, files, () => answer, RUN, host({}, 0, { bash: () => ({ result: { stdout: "", stderr: "" }, text: ASIDE_OUT("실패") }) }))
    await relay($, ADVANCE)
    await runCompletion($, "실패")
    const asked = (await $.tool.call(ADVANCE)) as { result: string }
    expect(asked.result).toContain(`"dev로 보냄", "plan으로 보냄", "실패 항목만 다시 돌리기"`)
    expect(asked.result).not.toContain("재시도")
    answer = "plan으로 보냄"
    const sent = await relay($, ADVANCE)
    expect(context(sent)).toContain("D173: the user judged the failed checks a design problem")
    expect(context(sent)).toContain("D62")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", d62: true, failFile: QAI, retries: 0 })
  })

  test("exit 124 past the check's limit halts the run and the hook stops the session the CLI left running", async ($, on) => {
    const timedOut = { result: "Error: Exit code 124\n", text: `Exit code 124\n\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m\nstill working`, isError: true }
    const run = (argv: string[]) => (argv[0] === "aside" && argv[2] === "list" ? { exitCode: 0, stdout: `${SESSION_ID}  running  ephemeral  x  2026-10-02T00:00:00.000Z\n` } : argv[0] === "aside" ? { exitCode: 0 } : { exitCode: 0, stdout: "ok\n" })
    const files = filesWith({ e2e: { ...E2E, timeout: 10 }, "qa-integration": ["npx playwright test"] })
    world(on, files, undefined, RUN, host({}, 0, { run, bash: c => (c.startsWith("timeout") ? timedOut : undefined) }))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    const r = await $.tool.call(asRunner(EXEC()))
    expect(context(r)).toContain(`check completion ran past its 10 minutes and is closed with no verdict. The hook stopped aside session ${SESSION_ID}. Write nothing.`)
    expect(context(r)).toContain("so the run is halted (D101); ")
    expect(files[QAI]).toContain("- 결과: 없음 — 판정 없이 닫힘 (시간 초과나 스페이스 유실)\n")
    expect(files[QAI]).toContain("판정: 미정\n")
    expect(ran.filter(x => x.argv.join(" ") === `aside session stop ${SESSION_ID}`)).toHaveLength(1)
    expect(await status($)).toContain("halt: D101")
    await $.agent.spawn(spawnVerifier)
    expect(await $.tool.call({ tool: "Bash", command: EXEC(), timeout: 600000, agentId: VERIFIER } as never)).toEqual(refused("D99: only commands that read"))
    expect(await $.tool.call(write(QAI, completion(SPEC_LINE, "통과"), VERIFIER))).toEqual(refused("D75: the integration reviewer may not change the ## e2e section"))
    const stay = await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "통과"), VERIFIER))
    expect(context(stay)).toContain("the run is halted")
    expect(await status($)).toContain("stage: qa-integration")
  })

  test("a stop that fails tells the user to stop the session", async ($, on) => {
    const timedOut = { result: "Error: Exit code 124\n", text: `Exit code 124\n\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m`, isError: true }
    const run = (argv: string[]) => (argv[0] === "aside" && argv[2] === "list" ? { exitCode: 0, stdout: `${SESSION_ID}  running  ephemeral  x  t\n` } : argv[0] === "aside" ? { exitCode: argv[2] === "stop" ? 1 : 0 } : { exitCode: 0, stdout: "ok\n" })
    world(on, filesWith({ e2e: { ...E2E, timeout: 10 }, "qa-integration": ["npx playwright test"] }), undefined, RUN, host({}, 0, { run, bash: c => (c.startsWith("timeout") ? timedOut : undefined) }))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    const r = await $.tool.call(asRunner(EXEC()))
    expect(context(r)).toContain(`The hook could not stop aside session ${SESSION_ID}, which may still be driving the browser: the user stops it (\`aside session stop ${SESSION_ID}\`).`)
    expect(await status($)).toContain("halt: D101")
  })

  test("a url that hangs counts as unreachable after the probe's timeout", async ($, on) => {
    world(on, { ...ASIDE }, undefined, RUN, host({}, 0, { fetch: () => "hang" }))
    const pending = relay($, ADVANCE)
    await clock.settle()
    await clock.advance(9000)
    expect(context(await pending)).toContain("D101")
    expect(await status($)).toContain("halt: D101")
  })

  test("advance releases a halt only when the user says so, and redoes the entry without a retry", async ($, on) => {
    const files = filesWith({ e2e: { ...E2E, url: "https://app.example.com" } })
    let answer = "그대로 멈춤"
    world(on, files, () => answer, { ...RUN, retries: 1 }, host({}, 0))
    await relay($, ADVANCE)
    expect(await status($)).toContain("halt: D100")
    const kept = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(kept).toEqual(refused("D100: the run stays halted"))
    files["E:/proj/.rein/config.json"] = config({ e2e: E2E })
    answer = "다시 돌리기"
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(context(r)).toContain("aside path")
    const s = await status($)
    expect(s).not.toContain("halt:")
    expect(s).toContain("e2e runners to spawn now: 1")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 1 })
    expect(s).toContain("stage: qa-integration")
  })

  test("after a timeout halt the rerun gives the check a new folder and a new runner", async ($, on) => {
    let calls = 0
    const bashAnswer = () => (++calls === 1
      ? { result: "Error: Exit code 124", text: `Exit code 124\n\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m`, isError: true }
      : { result: { stdout: "", stderr: "" }, text: ASIDE_OUT("통과") })
    world(on, filesWith({ e2e: { ...E2E, timeout: 10 } }), () => "다시 돌리기", RUN, host({}, 0, { bash: c => (c.startsWith("timeout") ? bashAnswer() : undefined) }))
    await relay($, ADVANCE)
    await runCompletion($, "통과")
    expect(await status($)).toContain("halt: D101")
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(await status($)).toContain("e2e check completion: waiting for a runner")
    await $.agent.spawn(SPAWN_RUNNER)
    const second = "agent-rein:e2e-runner-2"
    expect(spawned.at(-1)!.prompt).toContain(`- Screenshot folder: ${FOLDER(2)}`)
    expect(context(await $.tool.call(asRunner(EXEC(10, 2), 600000, second)))).toContain("aside ended with 판정: 통과")
    expect(context(await $.tool.call(result("통과", 2, second)))).toContain("Every aside check passed")
  })
})

describe("re-entry and the person's exits", () => {
  const OLD = `## e2e\n\n세션: OLDOLDOLDOLDOLDO\n\n판정: 통과\n${completion(SPEC_LINE, "실패")}`
  const KEPT = `## 이전 진입\n\n${OLD.trim().replace("## e2e", "### 1차 진입 — e2e").replace("## 완료 판정 대조", "### 1차 진입 — 완료 판정 대조")}\n`

  test("every integration entry starts e2e.md afresh, the last one kept under ## 이전 진입, and forgets the last reviewer and capture", async ($, on) => {
    const files = { ...filesWith({ e2e: E2E }), [QAI]: OLD }
    const halted = { ...RUN, stage: "qa-integration", verifier: "agent-old", halt: { rule: "D101", reason: "aside ran past 10 minutes" }, e2e: { path: "aside", command: "x", capture: { session: "OLDOLDOLDOLDOLDO" } } }
    world(on, files, () => "다시 돌리기", halted, host({}, 0))
    expect(context(await relay($, ADVANCE))).toContain("aside path")
    expect(files[QAI]).toBe(KEPT)
    // the reviewer may not drop or change what earlier entries left.
    files[QAI] = `## e2e\n\n판정: 통과\n\n${KEPT}`
    expect(withHistory(files[QAI], "## e2e\n\n판정: 실패\n", true)).toBe(`## e2e\n\n판정: 실패\n\n${KEPT.trimEnd()}\n\n### 2차 진입 — e2e\n\n판정: 통과\n`)
    expect(withHistory(files[QAI], "## e2e\n\n판정: 실패\n", false)).toBe(`## e2e\n\n판정: 실패\n\n${KEPT}`)
    expect(integrationGuard(files[QAI], `## e2e\n\n판정: 통과\n${completion(SPEC_LINE, "통과")}`)).toContain("may not change ## 이전 진입")
    expect(integrationGuard(files[QAI], `## e2e\n\n판정: 통과\n${completion(SPEC_LINE, "통과")}\n${KEPT}`)).toBeUndefined()
    const s = await status($)
    expect(s).not.toContain("verifier:")
    expect(s).not.toContain("e2e capture")
  })

  test("on the command path the entry leaves only the hook's ## e2e", async ($, on) => {
    const files = { ...filesWith({ "qa-integration": ["npx playwright test"] }), [QAI]: OLD }
    world(on, files, undefined, { ...RUN, verifier: "agent-old" }, host())
    await relay($, ADVANCE)
    expect(files[QAI].split("## 이전 진입")[0]).not.toContain("완료 판정 대조")
    expect(files[QAI]).toContain("- `npx playwright test` (E:/proj) — exit 0")
    expect(files[QAI].endsWith(`판정: 통과\n\n${KEPT}`)).toBe(true)
    expect(await status($)).not.toContain("verifier:")
  })

  test("a halted integration qa with an edited config.json asks the D50 question first; 다시 돌리기 comes on the next advance (D132, D50)", async ($, on) => {
    const files = filesWith({ e2e: E2E })
    const halted = { ...RUN, stage: "qa-integration", configHashes: { "E:/proj": "stale" }, halt: { rule: "D100", reason: "production" }, e2e: { path: "aside" } }
    const questions: string[] = []
    let answer = "새 config 승인"
    world(on, files, q => (questions.push(q), answer), halted, host({}, 0))
    files["E:/proj/.rein/config.json"] = JSON.stringify({ qa: [] })
    expect(await relay($, ADVANCE)).toEqual(refused("D50: the user approved, but the configs are still not usable: E:/proj/.rein/config.json (`qa` must be a non-empty array of command strings). The run stays in qa-integration."))
    expect(questions[0]).toContain("지금의 config를 승인할까요?")
    expect(await status($)).toContain("halt: D100")
    files["E:/proj/.rein/config.json"] = config({ e2e: E2E })
    const approved = await relay($, ADVANCE)
    expect(context(approved)).toContain("whether to run integration qa again (D132)")
    expect(await status($)).toContain("halt: D100")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"freeze","stage":"qa-integration"`)
    answer = "다시 돌리기"
    expect(context(await relay($, ADVANCE))).toContain("aside path")
    expect(questions[2]).toContain("통합 qa를 다시 돌릴까요?")
    expect(await status($)).not.toContain("halt:")
  })

  test("a config changed since plan: advance asks the user before running anything, and after their approval the next advance runs the qa commands (D50, D153)", async ($, on) => {
    const files = filesWith()
    let answer = "그대로"
    world(on, files, () => answer, { ...RUN, configHashes: { "E:/proj": "stale" } }, host())
    expect(await relay($, ADVANCE)).toEqual(refused("D50: the current configs are not approved (answer: 그대로)"))
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    answer = "새 config 승인"
    const r = await relay($, ADVANCE)
    expect(r).toEqual(expect.objectContaining({ result: "The user approved the current configs." }))
    expect(context(r)).toContain("Call advance again: the hook runs the qa commands under them (D153)")
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    expect(context(await relay($, ADVANCE))).toContain("the qa commands passed")
    expect(await status($)).toContain("stage: qa-integration")
    expect(await relay($, ADVANCE)).toEqual(refused("D112: advance does not move the qa-integration stage as the run stands."))
  })

  const nothing = (more: Host = {}) => host({}, 1, { run: argv => (gitSub(argv) === "status" ? { exitCode: 0, stdout: "" } : argv[0] === "git" ? { exitCode: 0, stdout: "abc123\n" } : { exitCode: 0 }), ...more })
  const NONE_RUN = { ...RUN, stage: "qa-integration", e2e: { path: "none", written: e2eSection(undefined) } }

  test("nothing to commit: the reviewer reports it; advance asks, and plan으로 되돌림 sends the run to plan (D95, D62)", async ($, on) => {
    const files = { ...filesWith(), [QAI]: e2eSection(undefined) }
    world(on, files, () => "plan으로 되돌림", NONE_RUN, nothing())
    await $.agent.spawn(spawnVerifier)
    const done = context(await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "통과"), VERIFIER)))
    expect(done).toContain("nothing to commit. Tell the user, then call mcp__rein__advance")
    expect(done).toContain("Report this to the main session and stop.")
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("nothing to commit (D95), so the run is back in the plan stage")
    expect(context(r)).toContain("invoke the rein:plan skill")
    const s = await status($)
    expect(s).toContain("stage: plan")
    expect(s).toContain("d62:")
  })

  test("nothing to commit: run 종료 ends the run without a commit (D95)", async ($, on) => {
    const files: Record<string, string> = { ...filesWith(), [QAI]: e2eSection(undefined) + completion(SPEC_LINE, "통과") }
    world(on, files, () => "run 종료", NONE_RUN, nothing())
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D95: the run ended without a commit")
    expect(await status($)).toBe("No Rein run is open in this session.")
    // the folder moved to complete/, the trace line with it.
    const done = DIR.replace("/active/", "/complete/")
    expect(context(r)).toContain(`Tell the user. After you tell the user, invoke the rein:retro skill. Run folder: ${done}.`)
    expect(files[`${DIR}/agent/trace.jsonl`]).toBeUndefined()
    expect(files[`${done}/agent/trace.jsonl`]).toContain(`"ev":"stage","from":"qa-integration","to":null,"answer":"run 종료","reason":"nothing to commit (D95)","state":"complete"`)
    expect(files[`${done}/1-spec.md`]).toBeDefined()
  })
})

describe("e2e without Aside, production backends, and the environment rerun (D141-D143)", () => {
  const E2E_ONLY = () => filesWith({ e2e: E2E })

  // A host whose Aside is up or down as the test says, mid-run.
  function switchable(aside: { up: boolean }, fail: Record<string, string> = {}): Host {
    const base = host(fail, 1).run!
    return { run: (argv, cwd) => (argv[0] === "aside" ? { exitCode: aside.up ? 0 : 1 } : base(argv, cwd)) }
  }

  // The person answers `answer()` and every question is kept.
  function asking(questions: string[], answer: () => string | undefined) {
    return (q: string) => {
      questions.push(q)
      return answer()
    }
  }

  test("e2e configured, Aside down, no command to run instead: the run halts in qa instead of passing (D141)", async ($, on) => {
    const files = E2E_ONLY()
    world(on, files, undefined, RUN, switchable({ up: false }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D141: the qa commands passed, but e2e is configured and Aside is unavailable, so the run is halted in qa")
    const s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(s).toContain("halt: D141")
    expect(files[QAI]).toBeUndefined()
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"halt","stage":"qa","halt":{"rule":"D141"`)
  })

  test("a run with no browser recorded runs its checks in ego, not Aside", async ($, on) => {
    const { browser: _, ...unchosen } = RUN
    world(on, E2E_ONLY(), undefined, unchosen, switchable({ up: true }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("ego-unavailable: the qa commands passed")
    expect(ran.filter(x => x.argv[0] === "aside")).toHaveLength(0)
  })

  test("Aside를 켰음 on a halt with no browser recorded runs Aside and keeps it for reruns", async ($, on) => {
    const { browser: _, ...unchosen } = RUN
    world(on, E2E_ONLY(), () => "Aside를 켰음, 다시 확인", { ...unchosen, halt: { rule: "D141", reason: "aside down" }, qaVisit: { reruns: 0, passed: true } }, switchable({ up: true }))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(expect.objectContaining({ result: "Aside is available; the run is in qa-integration on the aside path." }))
    expect((store.get("runs:proj/login-fix") as { browser?: string }).browser).toBe("aside")
  })

  test("Aside를 켰음: still down keeps the halt; up enters the aside path without a retry", async ($, on) => {
    const aside = { up: false }
    world(on, E2E_ONLY(), () => "Aside를 켰음, 다시 확인", { ...RUN, retries: 1 }, switchable(aside))
    await relay($, ADVANCE)
    expect(await relay($, ADVANCE)).toEqual(refused("D141: Aside is still unavailable"))
    expect(await status($)).toContain("halt: D141")
    aside.up = true
    const r = await relay($, ADVANCE)
    expect(r).toEqual(expect.objectContaining({ result: "Aside is available; the run is in qa-integration on the aside path." }))
    expect(context(r)).toContain("aside path")
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(s).not.toContain("halt:")
    expect(s).toContain("e2e runners to spawn now: 1")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 1 })
  })

  test("e2e 없이 진행: the hook writes an ## e2e that says so, and the completion check can still land", async ($, on) => {
    const files = E2E_ONLY()
    world(on, files, () => "e2e 없이 진행", RUN, switchable({ up: false }))
    await relay($, ADVANCE)
    const r = await relay($, ADVANCE)
    expect(r).toEqual(expect.objectContaining({ result: "The user chose to go on without e2e." }))
    expect(files[QAI]).toBe(E2E_SKIPPED)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"answer":"e2e 없이 진행"`)
    const s = await status($)
    expect(s).toContain("stage: qa-integration")
    expect(s).toContain("e2e: none")
    await $.agent.spawn(spawnVerifier)
    const done = await $.tool.call(write(QAI, files[QAI] + completion(SPEC_LINE, "통과"), VERIFIER))
    expect(context(done)).toContain("now in the land stage")
  })

  test("Aside down with no e2e configured changes nothing (D72)", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, switchable({ up: false }))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D72: the qa commands passed; there is no e2e to run")
    expect(files[QAI]).toBe(e2eSection(undefined))
  })

  test("a halted integration qa rerun that finds Aside gone halts under D141, and advance then asks about Aside", async ($, on) => {
    const questions: string[] = []
    let answer = "다시 돌리기"
    const halted = { ...RUN, stage: "qa-integration", halt: { rule: "D101", reason: "aside ran past 10 minutes" }, e2e: { path: "aside", command: "x" } }
    const files = { ...E2E_ONLY(), [QAI]: "## e2e\n\n세션: OLDOLDOLDOLDOLDO\n\n판정: 통과\n" }
    world(on, files, asking(questions, () => answer), halted, switchable({ up: false }))
    expect(context(await relay($, ADVANCE))).toContain("halted in qa-integration")
    expect(await status($)).toContain("halt: D141")
    const kept = "## 이전 진입\n\n### 1차 진입 — e2e\n\n세션: OLDOLDOLDOLDOLDO\n\n판정: 통과\n"
    expect(files[QAI]).toBe(kept)
    answer = "e2e 없이 진행"
    await relay($, ADVANCE)
    expect(questions[1]).toContain("Aside를 쓸 수 없습니다")
    expect(files[QAI]).toBe(`${E2E_SKIPPED.trimEnd()}\n\n${kept}`)
    expect(await status($)).not.toContain("halt:")
  })

  test("a production backend halts e2e like a production url (D142)", async ($, on) => {
    const files = filesWith({ e2e: { ...E2E, backends: ["localhost:8080", "https://API.example.com:443/v1"], production: ["*.example.com"] } })
    world(on, files, undefined, RUN, host({}, 0))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D100: the run is in the qa-integration stage but halted")
    const s = await status($)
    expect(s).toContain("halt: D100: the app's backend https://API.example.com:443/v1: a production host")
    expect(s).not.toContain("e2e runners to spawn")
  })

  test("the runner is told aside's prompt must stop and fail if the app talks to production", async ($, on) => {
    world(on, E2E_ONLY(), undefined, RUN, host({}, 0))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    expect(spawned[0]!.prompt).toContain("never to open the production hosts, and if the app sends requests to one of them, to stop at once, say so and end with 판정: 실패")
  })

  test("after a failed run and an environment fix advance asks, reruns the qa commands, and all pass writes qa.md and enters qa-integration (D143)", async ($, on) => {
    const files = filesWith()
    const fail: Record<string, string> = { "npm test": "Could not connect to localhost:3307" }
    const questions: string[] = []
    world(on, files, asking(questions, () => "다시 돌림"), RUN, host(fail))
    expect(await relay($, ADVANCE)).toEqual(refused("D153: the hook ran the qa commands and one failed"))
    expect(questions).toHaveLength(0)
    delete fail["npm test"]
    const r = await relay($, ADVANCE)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("qa 명령을 다시 돌릴까요?")
    expect(r).toEqual(expect.objectContaining({ result: "The hook ran the qa commands; all passed and it wrote qa.md." }))
    expect(context(r)).toContain("D72")
    expect(files[QA]).toContain("- `npm test` (E:/proj) — exit 0")
    expect(files[QA]).toContain("(사람이 환경을 고친 뒤 훅이 advance에서 다시 돌림, D143)")
    expect(await status($)).toContain("stage: qa-integration")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"answer":"다시 돌림","rule":"D143"`)
  })

  test("a failing advance keeps the run in qa and counts nothing; the next advance asks, and 취소 runs nothing (D153, D143)", async ($, on) => {
    let answer = "다시 돌림"
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => answer), { ...RUN, retries: 1 }, host({ "npm test": "Could not connect to localhost:3307" }))
    const r = await relay($, ADVANCE)
    expect(questions).toHaveLength(0)
    expect(r).toEqual(refused("D153: the hook ran the qa commands and one failed:\n- `npm test` (E:/proj) — exit 1"))
    expect(r).toEqual(refused("Could not connect to localhost:3307"))
    expect((r as { deny: string }).deny).not.toContain("no retry")
    expect(r).toEqual(refused(`The run stays in qa. Spawn rein:triage with this report, the path of that output and ${QA}: if the failure is the code's, it writes qa.md with its judgment of whether the code or the design must change (## 실패 원인)`))
    let s = await status($)
    expect(s).toContain("stage: qa\n")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 1 })
    const again = await relay($, ADVANCE)
    expect(questions).toHaveLength(1)
    expect(questions[0]).not.toContain("재시도")
    expect(again).toEqual(refused("D143: the hook ran the qa commands and one failed:\n- `npm test` (E:/proj) — exit 1"))
    s = await status($)
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 1 })
    expect(s).toContain("advance reruns: 1")
    answer = "취소"
    ran.length = 0
    expect(await relay($, ADVANCE)).toEqual(refused("D143: no rerun (answer: 취소)"))
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    expect(await status($)).toContain("advance reruns: 1")
  })

  test("in qa a changed config is asked first, even with a D141 halt", async ($, on) => {
    const questions: string[] = []
    const run = { ...RUN, configHashes: { "E:/proj": "stale" }, halt: { rule: "D141", reason: "aside down" } }
    world(on, E2E_ONLY(), asking(questions, () => undefined), run, switchable({ up: false }))
    expect(await relay($, ADVANCE)).toEqual(asks("D50: this needs a decision; nothing changed."))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("지금의 config를 승인할까요?")
  })

  test("in qa a D141 halt with the config unchanged asks about Aside", async ($, on) => {
    const questions: string[] = []
    world(on, E2E_ONLY(), asking(questions, () => undefined), { ...RUN, halt: { rule: "D141", reason: "aside down" }, qaVisit: { reruns: 0, passed: true } }, switchable({ up: false }))
    expect(await relay($, ADVANCE)).toEqual(asks("D141: this needs a decision; nothing changed."))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("Aside를 쓸 수 없습니다")
  })

  test("in qa with nothing else pending advance runs the qa commands without asking (D153)", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => undefined), RUN, host())
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "The hook ran the qa commands; all passed and it wrote qa.md." }))
    expect(questions).toHaveLength(0)
  })

  test("in qa after a failed hook run advance asks whether to rerun the qa commands, and runs nothing unanswered (D143)", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), asking(questions, () => undefined), { ...RUN, qaVisit: { reruns: 0, failed: true } }, host())
    expect(await relay($, ADVANCE)).toEqual(asks("D143: this needs a decision; nothing changed."))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("qa 명령을 다시 돌릴까요?")
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
  })

  test("in qa-integration a D100 halt still asks the G11 release question, not the Aside one", async ($, on) => {
    const questions: string[] = []
    const halted = { ...RUN, stage: "qa-integration", halt: { rule: "D100", reason: "production" }, e2e: { path: "aside" } }
    world(on, E2E_ONLY(), asking(questions, () => undefined), halted, host({}, 0))
    await relay($, ADVANCE)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("환경을 고쳤나요?")
  })
})
