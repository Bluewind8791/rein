import { describe, expect } from "claude-code/testing"
import { captureAside, isProduction } from "../hooks/lib/aside.ts"
import { checkConfig } from "../hooks/lib/parse.ts"
import { completionLine } from "../hooks/stages/qaIntegration.ts"
import { relay, DIR, gitSub, ran, spawned, world, type Host, test } from "./world.ts"

// The qa guards the chunk 4 review asked for: frozen configs, one judgment
// at a time, one aside run per entry, the production host match, the land set.

const SPEC_LINE = "로그인에 세 번 실패하면 계정이 잠긴다"
const SPEC = `# t\n\n## 완료 판정\n\n${SPEC_LINE}\n\n## 참조\n\n없음\n`
const QA = `${DIR}/agent/qa.md`
// a qa.md with the judgment of the cause, which the hook reads before it judges the run.
const QA_MD = "## 검증 명령\n\n`npm test`: boom\n\n## 실패 원인\n\n원인: 구현\n\nlogin.ts:3\n"
const QAI = `${DIR}/agent/e2e.md`
const SESSION_ID = "ZNI0dDsPUJp8A4rj"
const RUN = { v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0, planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"] }
const E2E = { url: "http://localhost:8090", production: [], backends: [] }
const CONFIG = JSON.stringify({ qa: ["npm test"], e2e: E2E })

const ADVANCE = { tool: "mcp__rein__advance" } as never
const write = (file_path: string, content: string) => ({ tool: "Write", file_path, content }) as never
const bash = (command: string, extra: object = {}) => ({ tool: "Bash", command, timeout: 600000, ...extra }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) =>
  ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result
const files = (config: string | null = CONFIG): Record<string, string> =>
  config === null ? { [`${DIR}/1-spec.md`]: SPEC } : { "E:/proj/.rein/config.json": config, [`${DIR}/1-spec.md`]: SPEC }

// aside is up; shell commands pass; git status shows the planned file.
const host = (more: Host = {}): Host => ({
  run: argv =>
    argv[0] === "aside" ? { exitCode: 0 }
      : argv[0] === "git" && gitSub(argv) === "status" ? { exitCode: 0, stdout: " M src/login.ts\0" }
        : argv[0] === "git" ? { exitCode: 0, stdout: "abc123\n" }
          : { exitCode: 0 },
  ...more,
})

// the completion check's rein:e2e-runner and its aside call.
const SPAWN_RUNNER = { tool_use_id: "r", prompt: "p", description: "d", subagentType: "rein:e2e-runner" } as never
const FOLDER = `${DIR}/agent/evidence/completion/1`
const EXEC = `timeout 10m aside exec --permission full-access 'Check it. Save screenshots in the folder ${FOLDER}, and nothing else there. End with 관측: and 판정:'`
const asRunner = (extra: object = {}) => bash(EXEC, { agentId: "agent-rein:e2e-runner", ...extra })

describe("frozen configs", () => {
  // advance in qa asks about a config problem before it runs anything.
  async function asked($: { tool: { call: (e: never) => Promise<unknown> } }, questions: string[]) {
    expect(await relay($, ADVANCE)).toEqual(refused("D50: the current configs are not approved (answer: 그대로). The run stays in qa."))
    expect(questions).toHaveLength(1)
    expect(ran.filter(x => x.argv[0] !== "git" && x.argv[1] === "-c")).toHaveLength(0)
    return questions[0]!
  }

  test("a config.json gone since plan keeps the run in qa; advance asks, nothing runs, no retry", async ($, on) => {
    const questions: string[] = []
    world(on, files(null), q => (questions.push(q), "그대로"), RUN, host())
    expect(await asked($, questions)).toContain("E:/proj/.rein/config.json (it does not exist)")
    const s = await status($)
    expect(s).toContain("stage: qa")
    expect(s).not.toContain("retries:")
  })

  test("a config.json changed since plan keeps the run in qa", async ($, on) => {
    const questions: string[] = []
    world(on, files(), q => (questions.push(q), "그대로"), { ...RUN, configHashes: { "E:/proj": "0".repeat(64) } }, host())
    expect(await asked($, questions)).toContain("it changed since plan passed")
  })

  test("a run with no repositories cannot pass qa", async ($, on) => {
    const questions: string[] = []
    world(on, files(), q => (questions.push(q), "그대로"), { ...RUN, repos: [] }, host())
    expect(await asked($, questions)).toContain("no repositories recorded")
  })

  test("checkConfig checks e2e", () => {
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "ftp://x", production: [] } }))).toContain("e2e.apps")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x" } }))).toContain("e2e.production")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [], backends: [], timeout: 61 } }))).toContain("from 1 to 60")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "https://x", production: ["a.com"], backends: ["api.x"], timeout: 60 } }))).toBeUndefined()
    // apps, each an http(s) url and an optional login sentence.
    const apps = (a: unknown) => checkConfig(JSON.stringify({ qa: ["t"], e2e: { apps: a, production: [], backends: [] } }))
    expect(apps({})).toContain("at least one")
    expect(apps({ admin: { url: "ftp://x" } })).toContain("e2e.apps.admin.url")
    expect(apps({ admin: { url: "http://x", login: 3 } })).toContain("e2e.apps.admin.login")
    expect(apps({ admin: { url: "http://x", login: "admin / pw" }, mobile: { url: "http://y" } })).toBeUndefined()
  })

  test("checkConfig requires e2e.backends, a list of host strings (D142)", () => {
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [] } }))).toContain("e2e.backends")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [], backends: "api.x" } }))).toContain("e2e.backends")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [], backends: [""] } }))).toContain("e2e.backends")
    expect(checkConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", production: [], backends: [] } }))).toBeUndefined()
    expect(checkConfig(JSON.stringify({ qa: ["t"] }))).toBeUndefined()
  })
})

describe("qa writes", () => {
  // the main session is the qa agent and is not held to a row.
  test("the main session writes what it likes in qa", async ($, on) => {
    world(on, files(), undefined, RUN, host())
    const ok = expect.objectContaining({ result: "ok" })
    expect(await $.tool.call({ tool: "Edit", file_path: "E:/proj/src/login.ts", old_string: "a", new_string: "b" } as never)).toEqual(ok)
    expect(await $.tool.call({ tool: "NotebookEdit", notebook_path: "E:/proj/n.ipynb", new_source: "x" } as never)).toEqual(ok)
    expect(await $.tool.call(write("E:/proj/package.json", "{}"))).toEqual(ok)
  })

  test("qa.md is not judged until a hook run of the qa commands failed in this visit (D153)", async ($, on) => {
    world(on, files(), undefined, { ...RUN, qaVisit: { reruns: 0, passed: true } }, host())
    expect(context(await $.tool.call(write(QA, QA_MD)))).toContain("D153: qa.md was not judged")
    expect(await status($)).toContain("stage: qa\n")
  })

  test("while the hook runs the qa commands, a qa.md is not judged", async ($, on) => {
    world(on, files(), undefined, { ...RUN, busy: { what: "advance run", at: 0 }, qaVisit: { reruns: 0, failed: true } }, host())
    expect(context(await $.tool.call(write(QA, QA_MD)))).toContain("D56: qa.md was not judged")
    expect(await status($)).toContain("stage: qa\n")
  })
})

describe("aside runs", () => {
  const ASIDE_RUN = { ...RUN, browser: "aside" }

  test("a plan from before the checks gives its runner the completion line; its call runs in the foreground", async ($, on) => {
    world(on, files(), undefined, ASIDE_RUN, host({ bash: () => ({ result: { stdout: "", stderr: "", backgroundTaskId: "b1" }, text: "running in background" }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    expect(spawned[0]!.prompt).toContain(`- Task: Check whether this statement is true: ${SPEC_LINE}`)
    expect(await $.tool.call(asRunner({ run_in_background: true }))).toEqual(refused("run aside in the foreground"))
    const r = await $.tool.call(asRunner())
    expect(context(r)).toContain("aside went to the background, so the hook could not read its output")
    expect(await status($)).not.toContain("halt:")
  })

  test("an output with no session line leaves the check to its runner", async ($, on) => {
    world(on, files(), undefined, ASIDE_RUN, host({ bash: () => ({ result: { stdout: "x\n판정: 통과", stderr: "" }, text: "x\n판정: 통과" }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    const r = await $.tool.call(asRunner())
    expect(context(r)).toContain("The hook captured session (none in the output); aside ended with 판정: 통과")
    expect(await status($)).not.toContain("halt:")
    expect(ran.some(x => x.argv.includes("stop"))).toBe(false)
  })

  test("stdout is read before the text, and a persisted output file before both", async ($, on) => {
    const out = `created new session: ${SESSION_ID}\n판정: 통과`
    const f = files()
    f["C:/tmp/out.txt"] = out
    world(on, f, undefined, ASIDE_RUN, host({ bash: () => ({ result: { stdout: "cut", stderr: "", persistedOutputPath: "C:/tmp/out.txt" }, text: "cut" }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(SPAWN_RUNNER)
    expect(context(await $.tool.call(asRunner()))).toContain(`The hook captured session ${SESSION_ID}; aside ended with 판정: 통과`)
  })

  test("a missing completion line sends the run to plan for the user instead of halting (D36, D62)", async ($, on) => {
    const f = files()
    f[`${DIR}/1-spec.md`] = "# t\n\n## 완료 판정\n\n## 참조\n\n없음\n"
    world(on, f, undefined, ASIDE_RUN, host())
    const c = context(await relay($, ADVANCE))
    expect(c).toContain("1-spec.md has no line under ## 완료 판정, so integration qa has nothing to check it against (D36)")
    expect(c).toContain("invoke the rein:plan skill")
    const s = await status($)
    expect(s).toContain("stage: plan")
    expect(s).toContain("d62:")
    expect(s).not.toContain("halt:")
    expect(s).not.toContain("e2e runners to spawn")
  })

  test("session capture looks only before aside's agent writes (D179); host matching", () => {
    expect(captureAside(`Thinking: I'll open it\nrepl(title: 'open')\n > page says: created new session: AAAAAAAAAAAAAAAA\ncreated new session: AAAAAAAAAAAAAAAA\n판정: 통과`).session).toBeUndefined()
    expect(captureAside(`repl(title: 'open')\ncreated new session: AAAAAAAAAAAAAAAA\n판정: 통과`).session).toBeUndefined()
    expect(captureAside(`Warning: sign in again\n\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m\nThinking: x\ncreated new session: AAAAAAAAAAAAAAAA`).session).toBe(SESSION_ID)
    expect(captureAside(`Exit code 124\n\x1b[2mcreated new session: ${SESSION_ID}\x1b[0m`).session).toBe(SESSION_ID)
    expect(completionLine("## 완료 판정\n\n## 참조\n\n없음\n")).toBeUndefined()
    const prod = (url: string, production: string[]) => isProduction(url, production)
    expect(prod("https://app.example.com./", ["app.example.com"])).toBe(true)
    expect(prod("https://user:pw@APP.example.com:8443/x", ["app.example.com."])).toBe(true)
    expect(prod("https://eu.app.example.com", ["*.example.com"])).toBe(true)
    expect(prod("https://example.com", ["*.example.com"])).toBe(false)
    expect(prod("https://notexample.com", ["*.example.com"])).toBe(false)
    expect(prod("http://localhost:8090", ["app.example.com"])).toBe(false)
  })
})

describe("land entry", () => {
  const PASSING = JSON.stringify({ qa: ["npm test"] })
  const verifier = { tool_use_id: "t", prompt: "p", description: "d", subagentType: "rein:reviewer" } as never
  const done = (e2e: string) => `${e2e}\n## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n판정: 통과\n`

  test("an unborn HEAD is stored as empty, not as git's error text", async ($, on) => {
    const f = files(PASSING)
    world(on, f, undefined, RUN, host({ run: argv => (argv[0] === "aside" ? { exitCode: 1 } : gitSub(argv) === "status" ? { exitCode: 0, stdout: "?? src/login.ts\0" } : argv[0] === "git" ? { exitCode: 1, stdout: "" } : { exitCode: 0 }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(verifier)
    await $.tool.call({ tool: "Write", file_path: QAI, content: done(f[QAI]!), agentId: "agent-rein:reviewer" } as never)
    const s = await status($)
    expect(s).toContain("stage: land")
    expect(s).toContain("- E:/proj: \n")
  })

  test("a HEAD git cannot read keeps the run in qa-integration", async ($, on) => {
    const f = files(PASSING)
    world(on, f, undefined, RUN, host({ run: argv => (argv[0] === "aside" ? { exitCode: 1 } : gitSub(argv) === "status" ? { exitCode: 0, stdout: "?? src/login.ts\0" } : argv[0] === "git" ? { exitCode: 128, stderr: "fatal" } : { exitCode: 0 }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(verifier)
    const r = await $.tool.call({ tool: "Write", file_path: QAI, content: done(f[QAI]!), agentId: "agent-rein:reviewer" } as never)
    expect(context(r)).toContain("D95: the checks passed, but git cannot read HEAD of E:/proj")
    expect(await status($)).toContain("stage: qa-integration")
  })

  test("nothing changed in git status: the run cannot enter land", async ($, on) => {
    const f = files(PASSING)
    world(on, f, undefined, RUN, host({ run: argv => (argv[0] === "aside" ? { exitCode: 1 } : gitSub(argv) === "status" ? { exitCode: 0, stdout: "" } : { exitCode: 0, stdout: "abc\n" }) }))
    await relay($, ADVANCE)
    await $.agent.spawn(verifier)
    const r = await $.tool.call({ tool: "Write", file_path: QAI, content: done(f[QAI]!), agentId: "agent-rein:reviewer" } as never)
    expect(context(r)).toContain("nothing to commit")
    expect(await status($)).toContain("stage: qa-integration")
  })
})
