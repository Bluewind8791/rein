import { describe, expect } from "claude-code/testing"
import type { AgentStatus } from "claude-code"
import { captureAside, runnerCommand, runnerTask, sessionStatus, startable } from "../hooks/lib/aside.ts"
import { readConfig, viewOf } from "../hooks/lib/config.ts"
import { sha256Text } from "../hooks/lib/hash.ts"
import { checkConfig, judgeCover, parseChecks, parseCover } from "../hooks/lib/parse.ts"
import type { CheckRun } from "../hooks/lib/state.ts"
import { allChecked, asideSection, asideTick, carriedTick, egoTick, handChecked, parseImpact, tick, unchecked, UNSHOT } from "../hooks/stages/qaIntegration.ts"
import { relay, COVER, DIR, gitSub, planned, ran, SPEC_TEXT, spawned, store, world, type Host, test } from "./world.ts"

// 2-plan.md's aside checks and how they cover the
// completion line, config e2e.apps, one rein:e2e-runner agent per check, up
// to five side by side, each running its own aside session with resume past
// 10 minutes and writing its result, the ## e2e the hook writes, the
// person's choice on a failed check, and no handoff question before e2e.

const SPEC_LINE = "로그인에 세 번 실패하면 잠긴다"
const QAI = `${DIR}/agent/e2e.md`
const S1 = "OKWcCe6bYhKXDkt8"
const S2 = "dAIZX30NAZGDxNXV"
const APPS = { admin: { url: "http://localhost:8090", login: "tester / test-pass, 아이디·비밀번호로 직접 로그인" }, mobile: { url: "http://localhost:3000" } }
const E2E = { apps: APPS, production: ["app.example.com"], backends: ["localhost:8080"] }
const CHECKS = [
  { name: "detail", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "/member/detail에서 회원 테스트회원A를 검색해 회원유형을 본다", expect: "우수회원만 체크되고 비활성", saves: false },
  { name: "mobile", app: "mobile", todo: "/member에서 같은 회원을 열고 회원유형을 저장한 뒤 되돌린다", expect: "우수회원으로 표시", saves: true, minutes: 25 },
]
const RUN = {
  v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0,
  planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"], checks: CHECKS,
}
const config = (e2e: object = E2E) => JSON.stringify({ qa: ["npm test"], e2e })
const filesWith = (e2e: object = E2E): Record<string, string> => ({ "E:/proj/.rein/config.json": config(e2e), [`${DIR}/1-spec.md`]: SPEC_TEXT })

const STATUS = { tool: "mcp__rein__status" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
// a gate called without the user's answer says what to ask; it refuses nothing.
const asks = (text: string) => expect.objectContaining({ result: expect.stringContaining(text) })
const spawnVerifier = { tool_use_id: "t", prompt: "p", description: "d", subagentType: "rein:reviewer" } as never
const VERIFIER = "agent-rein:reviewer"

type Engine = { tool: { call: (e: never) => Promise<unknown> }; agent: { spawn: (e: never) => Promise<unknown> } }

async function status($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<string> {
  return ((await $.tool.call(STATUS)) as { result: string }).result
}

// work qa passes and the run waits for the user; they run /rein:e2e.
async function toAside($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<unknown> {
  await relay($, ADVANCE)
  return $.tool.call({ tool: "mcp__rein__advance", answer: "e2e 실행 (Aside)" } as never)
}

// The main session spawns a rein:e2e-runner; the hook picks its check.
const RUNNER = "rein:e2e-runner"
async function spawnRunner($: Engine): Promise<{ agentId?: string; deny?: string }> {
  return (await $.agent.spawn({ tool_use_id: "r", prompt: "run the next check", description: "e2e", subagentType: RUNNER } as never)) as { agentId?: string; deny?: string }
}
// a check's screenshot folder, as the hook names it.
const folderOf = (name: string, n = 1) => `${DIR}/agent/evidence/${name}/${n}`
// the aside command a runner writes for a check, its prompt its own.
const asideExec = (folder: string, minutes = 10, flags = "") =>
  `timeout ${minutes}m aside exec --permission full-access${flags} 'Open the app and do the task. Save screenshots (PNG) that show what you saw in the folder ${folder}, and nothing else there. End with two lines: 관측: <what you saw>, then 판정: 통과 or 판정: 실패.'`
const asideResume = (session: string, minutes = 10) => `timeout ${minutes}m aside session resume ${session} 'Write the last two lines again: 관측:, then 판정:'`
// a runner's Bash call, in the form the hook asks for.
const runAs = (agentId: string, command: string, more: object = {}) => ({ tool: "Bash", command, timeout: 600_000, agentId, ...more }) as never
// a runner's result file for its check.
const report = (agentId: string, folder: string, session: string, observed: string, verdict: string) =>
  ({ tool: "Write", file_path: `${folder}/result.md`, content: `세션: ${session}\n관측: ${observed}\n판정: ${verdict}\n`, agentId }) as never

// one check from its runner's spawn to its result: the runner runs aside once
// and writes what aside said.
async function runCheck($: Engine, name: string, session: string, observed: string, verdict: string, n = 1): Promise<unknown> {
  const { agentId } = await spawnRunner($)
  await $.tool.call(runAs(agentId!, asideExec(folderOf(name, n))))
  return $.tool.call(report(agentId!, folderOf(name, n), session, observed, verdict))
}

// What aside printed: its first line, page text, and the two closing lines.
const out = (session: string, observed: string, verdict: string, first = "created new session") =>
  `\x1b[2m${first}: ${session}\x1b[0m\npage text\n관측: ${observed}\n판정: ${verdict}\x1b[0m\n`
const ok = (text: string) => ({ result: { stdout: text, stderr: "" }, text })
const timedOut = (session: string, first = "created new session") => ({ result: "Error: Exit code 124\n", text: `Exit code 124\n\x1b[2m${first}: ${session}\x1b[0m\nstill working`, isError: true })

// Aside up and every app answering; `aside session list` shows `listed`; each
// `timeout ...` Bash call takes the next answer of `answers`.
function host(answers: Record<string, unknown>[], listed: () => string = () => "", more: Host = {}): Host {
  return {
    run: argv => {
      if (argv[0] === "aside" && argv[2] === "list") return { exitCode: 0, stdout: listed() }
      if (argv[0] === "aside") return { exitCode: 0 }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      return { exitCode: 0, stdout: "ok\n" }
    },
    bash: c => (c.startsWith("timeout") ? answers.shift() : undefined),
    ...more,
  }
}

describe("2-plan.md's checks and cover (D168, D169)", () => {
  const PLAN = (extra: string) => `## 접근 방법\n\na\n\n## 상세 설계\n\n### src/login.ts\n- 고친다\n- 테스트: tests/login.test.ts\n\n### tests/login.test.ts\n- 본다\n- 테스트: tests/login.test.ts\n${extra}`
  const CHECK_SECTION = "\n## e2e 확인\n\n### detail\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: /member/detail에서 본다\n- 기대: 우수회원\n- 저장: 없음\n\n### stop-member\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: 회원을 정지했다 되돌린다\n- 기대: 일반, 우수회원\n- 저장: 있음\n- 시간: 40\n"
  const REPO = (e2e?: object) => ({ "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["t"], ...(e2e ? { e2e } : {}) }), [`${DIR}/1-spec.md`]: SPEC_TEXT })
  const said = (r: unknown) => context(r)

  test("parseChecks reads the checks, 없음, and names what is wrong", () => {
    expect(parseChecks(CHECK_SECTION)).toEqual({
      checks: [
        { name: "detail", title: "t", kind: "변경", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "/member/detail에서 본다", expect: "우수회원", saves: false },
        { name: "stop-member", title: "t", kind: "변경", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "회원을 정지했다 되돌린다", expect: "일반, 우수회원", saves: true, minutes: 40 },
      ],
    })
    expect(parseChecks("## e2e 확인\n\n없음\n")).toEqual({ checks: [] })
    expect(parseChecks("## x\n")).toBeUndefined()
    const reason = (text: string) => (parseChecks(text) as { reason?: string }).reason ?? ""
    expect(reason("## e2e 확인\n\n")).toContain("no `### <name>` check and no line `없음`")
    expect(reason("## e2e 확인\n\n### Detail\n- 제목: t\n- 구분: 변경\n- 앱: admin\n")).toContain("not a slug: `### Detail`")
    expect(reason("## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: x\n- 기대: y\n- 저장: 없음\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n")).toContain("more than once: a")
    expect(reason("## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 기대: y\n")).toContain("a needs exactly one non-empty line of `- 페이지:`, `- 경로:`, `- 할 일:`, `- 저장:`")
    expect(reason("## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: x\n- 기대: y\n- 저장: 가끔\n")).toContain("`- 저장: 가끔`, not 없음 or 있음")
    expect(reason("## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: x\n- 기대: y\n- 저장: 없음\n- 시간: 61\n")).toContain("1 to 60")
  })

  test("a check may name the account it logs in as, on one non-empty line", () => {
    const one = "## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: x\n- 기대: y\n- 저장: 없음\n"
    expect(parseChecks(`${one}- 계정: tester2\n`)).toEqual({ checks: [{ name: "a", title: "t", kind: "변경", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "x", expect: "y", saves: false, account: "tester2" }] })
    const reason = (text: string) => (parseChecks(text) as { reason?: string }).reason ?? ""
    expect(reason(`${one}- 계정: tester2\n- 계정: tester3\n`)).toContain("a needs at most one non-empty `- 계정:` line")
    expect(reason(`${one}- 계정:\n`)).toContain("a needs at most one non-empty `- 계정:` line")
  })

  test("a check gives its steps and expectation as indented items, its kind as 변경 or 대조, and why its data was chosen", () => {
    const listed = "## e2e 확인\n\n### a\n- 제목: 정상 회원\n- 구분: 대조\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원상세\n- 할 일:\n  1. /member를 연다\n  2. 회원 - 정상을 본다\n- 기대:\n  - 일반\n  - 앱: 그대로\n- 참고: 정상 회원은 1001\n- 저장: 없음\n"
    expect(parseChecks(listed)).toEqual({ checks: [{ name: "a", title: "정상 회원", kind: "대조", app: "admin", page: "회원상세", route: "회원 > 회원상세", todo: "/member를 연다\n회원 - 정상을 본다", expect: "일반\n앱: 그대로", reference: "정상 회원은 1001", saves: false }] })
    const reason = (text: string) => (parseChecks(text) as { reason?: string }).reason ?? ""
    expect(reason(listed.replace("- 구분: 대조", "- 구분: 비교"))).toContain("a says `- 구분: 비교`, not 변경 or 대조")
    expect(reason(listed.replace("  1. /member를 연다\n  2. 회원 - 정상을 본다\n", ""))).toContain("a needs exactly one non-empty line of `- 할 일:`")
    expect(reason(listed.replace("- 제목: 정상 회원\n", ""))).toContain("a needs exactly one non-empty line of `- 제목:`")
    expect(reason(listed.replace("- 참고: 정상 회원은 1001", "- 참고:"))).toContain("a needs at most one non-empty `- 참고:` line")
  })

  test("a check may name the files its screen runs on, on one line or more", () => {
    const one = "## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: x\n- 기대: y\n- 저장: 없음\n"
    expect(parseChecks(`${one}- 파일: \`src/login.ts\`, src/view.ts\n- 파일: fix.sql\n`)).toEqual({ checks: [{ name: "a", title: "t", kind: "변경", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "x", expect: "y", saves: false, files: ["src/login.ts", "src/view.ts", "fix.sql"] }] })
    expect((parseChecks(`${one}- 파일: src/login.ts,\n`) as { reason?: string }).reason).toContain("a has an empty file on a `- 파일:` line")
  })

  test("parseCover and judgeCover: parts of the line, checks of the section, test files that are items or exist", () => {
    const text = `## 완료 판정 덮기\n\n- "세 번 실패하면" — e2e: detail, stop-member\n- “잠긴다” — 테스트: \`tests/login.test.ts\`\n- "로그인에" - 확인 불가: 화면이 없음\n`
    const cover = parseCover(text)
    expect(cover).toEqual({
      cover: [
        { part: "세 번 실패하면", by: "e2e", checks: ["detail", "stop-member"] },
        { part: "잠긴다", by: "테스트", file: "tests/login.test.ts" },
        { part: "로그인에", by: "확인 불가", reason: "화면이 없음" },
      ],
    })
    const all = (cover as { cover: Parameters<typeof judgeCover>[0] }).cover
    expect(judgeCover(all, SPEC_LINE, ["detail", "stop-member"], ["E:/proj/tests/login.test.ts"], [], "E:/proj")).toBeUndefined()
    expect(judgeCover(all, SPEC_LINE, ["detail", "stop-member"], [], ["E:/proj/tests/login.test.ts"], "E:/proj")).toBeUndefined()
    const wrong = judgeCover(all, "로그인에 두 번 실패하면 잠긴다", ["detail"], [], [], "E:/proj") ?? ""
    expect(wrong).toContain('"세 번 실패하면" is not part of the completion line')
    expect(wrong).toContain('"세 번 실패하면" names stop-member, not a check of `## e2e 확인`')
    expect(wrong).toContain('"잠긴다" names the test tests/login.test.ts, which is neither')
    expect((parseCover("## 완료 판정 덮기\n\n- 잠긴다 — 확인함\n") as { reason: string }).reason).toContain("not in the form: 잠긴다 — 확인함")
    expect((parseCover("## 완료 판정 덮기\n\n없음\n") as { reason: string }).reason).toContain("has no line")
    expect(judgeCover([{ part: "잠긴다", by: "확인 불가", reason: "" }], SPEC_LINE, [], [], [], "E:/proj")).toContain("gives no reason")
  })

  test("a config with e2e needs ## e2e 확인, its checks naming its apps; then the plan passes and keeps them", async ($, on) => {
    const files: Record<string, string> = REPO(E2E)
    world(on, files, undefined, { stage: "plan", runId: "login-fix" })
    expect(await planned($, PLAN(COVER))).toContain("D168: 2-plan.md does not pass yet, so the run stays in plan: a repository's config has e2e, so 2-plan.md needs `## e2e 확인`")
    const stray = CHECK_SECTION.replace("- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: 회원을 정지", "- 앱: shop\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: 회원을 정지")
    expect(await planned($, PLAN(stray + COVER))).toContain("these checks name an app config e2e.apps does not have: stop-member (shop). The apps are: admin, mobile.")
    expect(await planned($, PLAN(CHECK_SECTION))).toContain("D169: 2-plan.md does not pass yet, so the run stays in plan: 2-plan.md has no `## 완료 판정 덮기`")
    const off = '\n## 완료 판정 덮기\n\n- "잠긴다" — e2e: detail, grid\n'
    expect(await planned($, PLAN(CHECK_SECTION + off))).toContain('"잠긴다" names grid, not a check of `## e2e 확인`')
    const cover = '\n## 완료 판정 덮기\n\n- "세 번 실패하면 잠긴다" — e2e: detail, stop-member\n- "로그인에" — 테스트: tests/old.test.ts\n'
    expect(await planned($, PLAN(CHECK_SECTION + cover))).toContain("tests/old.test.ts, which is neither")
    files["E:/proj/tests/old.test.ts"] = "it()"
    expect(await planned($, PLAN(CHECK_SECTION + cover))).toContain("now in the dev stage")
    const run = store.get("runs:proj/login-fix") as { checks?: { name: string; minutes?: number }[] }
    expect(run.checks?.map(k => [k.name, k.minutes])).toEqual([["detail", undefined], ["stop-member", 40]])
  })

  test("a check's files are design items or handoff files, kept as the seal names them", async ($, on) => {
    world(on, REPO(E2E), undefined, { stage: "plan", runId: "login-fix" })
    const filed = (files: string) => CHECK_SECTION.replace("- 저장: 없음\n", `- 저장: 없음\n- 파일: ${files}\n`)
    const handoff = "\n## 넘길 것\n\n### fix.sql\n- DB에 적용한다\n"
    const cover = '\n## 완료 판정 덮기\n\n- "잠긴다" — e2e: detail\n'
    expect(await planned($, PLAN(filed("src/login.ts, src/nowhere.ts") + cover))).toContain("D168: 2-plan.md does not pass yet, so the run stays in plan: these checks name a file on `- 파일:` that is neither a `### <path>` item of `## 상세 설계` nor an item of `## 넘길 것`: detail (src/nowhere.ts).")
    expect(await planned($, PLAN(filed("src/login.ts, FIX.sql") + handoff + cover))).toContain("now in the dev stage")
    const run = store.get("runs:proj/login-fix") as { planFiles: string[]; checks: { name: string; files?: string[] }[] }
    expect(run.checks.map(k => [k.name, k.files])).toEqual([["detail", [run.planFiles.find(f => f.endsWith("src/login.ts")), `${DIR}/handoff/fix.sql`]], ["stop-member", undefined]])
  })

  test("without e2e in the config: no section, or 없음, passes; checks that would never run do not", async ($, on) => {
    world(on, REPO(), undefined, { stage: "plan", runId: "login-fix" })
    expect(await planned($, PLAN(CHECK_SECTION + COVER))).toContain("no repository's config has e2e, so these checks would never run: detail, stop-member")
    expect(await planned($, PLAN("\n## e2e 확인\n\n없음\n" + COVER))).toContain("now in the dev stage")
    expect((store.get("runs:proj/login-fix") as { checks?: unknown[] }).checks).toEqual([])
  })

  test("the old config form reads as one app named app; its account is the login (D170)", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: { url: "http://x", account: "tester", production: [], backends: [] } })).e2e
    expect(e2e?.apps).toEqual({ app: { url: "http://x", login: "tester" } })
  })
})

describe("one rein:e2e-runner per check, up to five at once", () => {
  const check = (name: string, over: Partial<CheckRun> = {}): CheckRun => ({ name, minutes: 30, spent: 0, app: "admin", ...over })

  test("startable keeps 2-plan.md's order: side by side only checks that save nothing on one app as one account, five at most", () => {
    const names = (ks: CheckRun[]) => startable(ks).map(k => k.name)
    expect(names(["a", "b", "c", "d", "e", "f"].map(n => check(n)))).toEqual(["a", "b", "c", "d", "e"])
    expect(names([check("a"), check("b", { saves: true }), check("c")])).toEqual(["a"])
    expect(names([check("a", { saves: true }), check("b")])).toEqual(["a"])
    expect(names([check("a"), check("b", { account: "tester2" }), check("c")])).toEqual(["a"])
    expect(names([check("a"), check("b", { app: "mobile" })])).toEqual(["a"])
    // runners already on checks count toward the five and the fit.
    expect(names([check("a", { runner: "r1" }), check("b", { verdict: "통과" }), check("c"), check("d", { saves: true })])).toEqual(["c"])
    expect(names([check("a", { runner: "r1", saves: true }), check("b")])).toEqual([])
    expect(names([check("a", { over: true }), check("b", { runner: "r1" }), check("c", { runner: "r2" }), check("d", { runner: "r3" }), check("e", { runner: "r4" }), check("f", { runner: "r5" }), check("g")])).toEqual([])
  })

  test("a runner command needs the timeout, full access, the folder and both closing lines; resume only of the check's own session", () => {
    const k = check("detail", { minutes: 25, spent: 20, session: S1 })
    const words = (c: string) => c.match(/'[^']*'|\S+/g)!.map(w => w.replace(/^'|'$/g, ""))
    const F = folderOf("detail")
    expect(runnerCommand(words(asideExec(F, 5)), k, F)).toEqual({ minutes: 5 })
    expect(runnerCommand(words(asideExec(F, 6)), k, F)).toEqual({ deny: "the timeout must be 1 to 5 minutes: at most 10 a call, and 5 of check detail's 25 minutes are left." })
    expect(runnerCommand(words(asideExec(F, 5).replace(" --permission full-access", "")), k, F)).toEqual(refused("`--permission full-access` is missing"))
    expect(runnerCommand(words(asideExec("C:/elsewhere", 5)), k, F)).toEqual(refused(`must name the screenshot folder ${F}`))
    expect(runnerCommand(words(asideExec(F, 5).replace("판정:", "verdict").replace("판정:", "verdict")), k, F)).toEqual(refused("the closing line `판정:`"))
    expect(runnerCommand(words(asideResume(S1, 5)), k, F)).toEqual({ minutes: 5 })
    expect(runnerCommand(words(asideResume(S2, 5)), k, F)).toEqual(refused(`resume check detail's own session, ${S1}`))
    expect(runnerCommand(["aside", "exec", "x"], k, F)).toEqual(refused("check detail's aside runs only as `timeout <n>m aside exec"))
    expect(runnerCommand(words(asideResume(S1, 5)), { ...k, session: undefined }, F)).toEqual(refused("has no aside session yet"))
  })

  test("each check gets its runner; the hook writes its task and ## e2e from the results, and the reviewer lands", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([ok(out(S1, "우수회원만 체크, 모두 disabled", "통과")), ok(out(S2, "우수회원", "통과"))]))
    expect(context(await toAside($))).toContain("aside path, with 2 checks to run, each by a rein:e2e-runner agent, up to 5 at once")
    expect(await status($)).toContain("e2e check detail: waiting for a runner, limit 30 minutes")
    expect(await status($)).toContain("e2e runners to spawn now: 1 rein:e2e-runner")
    const first = await spawnRunner($)
    expect(first.agentId).toBe("agent-rein:e2e-runner")
    expect(spawned[0]).toMatchObject({ type: RUNNER, background: true })
    const task = spawned[0]!.prompt!
    expect(task).toContain("Run check `detail` of a Rein run's integration test through aside")
    expect(task).toContain("- App: http://localhost:8090\n- Log in: tester / test-pass, 아이디·비밀번호로 직접 로그인\n- Page: 회원상세, reached by the menus 회원 > 회원관리 > 회원상세")
    expect(task).toContain(`- Expected: ${CHECKS[0]!.expect}\n- Saving: do not save, change or delete anything\n- Production hosts, never to be opened: app.example.com\n- Screenshot folder: ${folderOf("detail")}`)
    expect(task).toContain("timeout 10m aside exec --permission full-access '<prompt>'")
    expect(task).toContain(`write ${folderOf("detail")}/result.md with Write`)
    // mobile saves, so it waits for detail.
    expect(await spawnRunner($)).toEqual(refused("check mobile waits for the runners on detail"))
    const ran1 = await $.tool.call(runAs(first.agentId!, asideExec(folderOf("detail"))))
    expect(context(ran1)).toContain(`The hook captured session ${S1}; aside ended with 관측: 우수회원만 체크, 모두 disabled and 판정: 통과. Write agent/evidence/detail/1/result.md`)
    expect(context(await $.tool.call(report(first.agentId!, folderOf("detail"), S1, "우수회원만 체크, 모두 disabled", "통과")))).toContain("check detail: 판정: 통과. Report this to the main session and stop")
    // a check closed, the others open: e2e.md holds each as it stands.
    expect(files[QAI]).toContain(`### detail\n\n- 할 일: ${CHECKS[0]!.todo}\n`)
    expect(files[QAI]).toContain(`- 본 것: 우수회원만 체크, 모두 disabled\n- 결과: 통과\n- aside 세션: ${S1}\n`)
    expect(files[QAI]).toContain("### mobile\n")
    expect(files[QAI]).toContain("- 본 것: (없음)\n- 결과: 진행 중\n- aside 세션: 없음\n")
    expect(files[QAI]).toContain("판정: 미정\n")
    expect(await status($)).toContain(`e2e check detail: 판정: 통과, 세션 ${S1}`)
    const second = await spawnRunner($)
    expect(spawned[1]!.prompt).toContain("- Saving: save only what the task says to save, and change nothing else")
    expect(spawned[1]!.prompt).toContain("timeout 10m aside exec")
    await $.tool.call(runAs(second.agentId!, asideExec(folderOf("mobile"))))
    expect(context(await $.tool.call(report(second.agentId!, folderOf("mobile"), S2, "우수회원", "통과")))).toContain("Every aside check passed; the hook wrote ## e2e")
    expect(files[QAI]).toBe(
      "## e2e\n\n방법: aside가 화면을 직접 확인함\n\n" +
        `### detail\n\n- 할 일: ${CHECKS[0]!.todo}\n- 기대: ${CHECKS[0]!.expect}\n- 계정: 앱 login 설정대로\n- 본 것: 우수회원만 체크, 모두 disabled\n- 결과: 통과\n- aside 세션: ${S1}\n- 스크린샷: agent/evidence/detail/1/shot.png\n\n![](evidence/detail/1/shot.png)\n\n` +
        `### mobile\n\n- 할 일: ${CHECKS[1]!.todo}\n- 기대: ${CHECKS[1]!.expect}\n- 계정: 앱 login 설정대로\n- 본 것: 우수회원\n- 결과: 통과\n- aside 세션: ${S2}\n- 스크린샷: agent/evidence/mobile/1/shot.png\n\n![](evidence/mobile/1/shot.png)\n\n` +
        "판정: 통과\n",
    )
    expect(await status($)).not.toContain("e2e runners to spawn now")
    expect(await spawnRunner($)).toEqual(refused("runs a check only while the aside checks of qa-integration wait for their verdicts"))
    await $.agent.spawn(spawnVerifier)
    const verifierTask = spawned.find(s => s.type === "rein:reviewer")!.prompt!
    expect(verifierTask).toContain(`the \`## 완료 판정 덮기\` section of ${DIR}/2-plan.md (D169)`)
    expect(verifierTask).toContain("An aside check with screenshots shows a part only when they show it as its 본 것 says (D177)")
    expect(verifierTask).toContain(`## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n- "<part>" — 통과 — <what showed it>`)
    const done = await $.tool.call(write(QAI, `${files[QAI]}\n## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n- "${SPEC_LINE}" — 통과 — e2e: detail — 스크린샷에 우수회원만 체크\n\n판정: 통과\n`, VERIFIER))
    expect(context(done)).toContain("now in the land stage")
  })

  test("checks that fit run side by side, each runner held to its own check", async ($, on) => {
    const files = filesWith()
    const three = ["a", "b", "c"].map(name => ({ ...CHECKS[0]!, name }))
    world(on, files, undefined, { ...RUN, checks: three }, host([ok(out(S1, "보임", "통과")), ok(out(S2, "보임", "통과"))]))
    await toAside($)
    expect(await status($)).toContain("e2e runners to spawn now: 3")
    const ids = [(await spawnRunner($)).agentId!, (await spawnRunner($)).agentId!, (await spawnRunner($)).agentId!]
    expect(spawned.map(s => s.prompt!.split("\n")[0])).toEqual(["a", "b", "c"].map(n => `Run check \`${n}\` of a Rein run's integration test through aside, then write its result. Do not fix anything, and do not judge the screen yourself: aside does.`))
    expect(await spawnRunner($)).toEqual(refused("every open aside check already has its runner (a, b, c)"))
    // a runner may not run or write for another check.
    expect(await $.tool.call(runAs(ids[0]!, asideExec(folderOf("b"))))).toEqual(refused(`must name the screenshot folder ${folderOf("a")}`))
    expect(await $.tool.call(report(ids[0]!, folderOf("b"), S1, "x", "통과"))).toEqual(refused(`the rein:e2e-runner of check a writes only ${folderOf("a")}/result.md`))
    expect(await $.tool.call(runAs(ids[0]!, "git status"))).toEqual(refused("check a's aside runs only as"))
    await $.tool.call(runAs(ids[0]!, asideExec(folderOf("a"))))
    await $.tool.call(runAs(ids[1]!, asideExec(folderOf("b"))))
    const s = await status($)
    expect(s).toContain(`e2e check a: rein:e2e-runner ${ids[0]} on it, 세션 ${S1}, 0 of 30 minutes spent`)
    expect(s).toContain(`e2e check b: rein:e2e-runner ${ids[1]} on it, 세션 ${S2}`)
    expect(s).toContain(`e2e check c: rein:e2e-runner ${ids[2]} on it, 0 of 30 minutes spent`)
    expect(context(await $.tool.call(report(ids[1]!, folderOf("b"), S2, "보임", "통과")))).toContain("Report this to the main session and stop")
    expect(files[QAI]).toContain(`### a\n\n- 할 일: ${CHECKS[0]!.todo}\n- 기대: ${CHECKS[0]!.expect}\n- 계정: 앱 login 설정대로\n- 본 것: (없음)\n- 결과: 진행 중\n- aside 세션: ${S1}\n`)
    expect(files[QAI]).toContain(`- 본 것: 보임\n- 결과: 통과\n- aside 세션: ${S2}\n`)
    expect(files[QAI]).toContain("판정: 미정\n")
    files[`${folderOf("c")}/shot.png`] = ""
    await $.tool.call(report(ids[2]!, folderOf("c"), S2, "보임", "통과"))
    expect(context(await $.tool.call(report(ids[0]!, folderOf("a"), S1, "보임", "통과")))).toContain("Every aside check passed")
    // its check closed, a runner writes nothing more.
    expect(await $.tool.call(report(ids[0]!, folderOf("a"), S1, "보임", "실패"))).toEqual(refused("D176: its part in the run is over"))
  })

  test("a runner's aside call is refused unless in the foreground, under the full Bash timeout, one at a time", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, checks: [CHECKS[0]] }, host([ok(out(S1, "우수회원", "통과"))]))
    await toAside($)
    const { agentId } = await spawnRunner($)
    const command = asideExec(folderOf("detail"))
    expect(await $.tool.call(runAs(agentId!, `${command} 2>&1 | tail -40`))).toEqual(refused("D94: commands cannot be chained, redirected or substituted"))
    expect(await $.tool.call(runAs(agentId!, command, { run_in_background: true }))).toEqual(refused("run aside in the foreground"))
    expect(await $.tool.call(runAs(agentId!, command, { timeout: 120_000 }))).toEqual(refused("run aside with the Bash timeout 600000"))
    expect(await $.tool.call(runAs(agentId!, asideExec(folderOf("detail"), 11)))).toEqual(refused("the timeout must be 1 to 10 minutes"))
    const k = (store.get("runs:proj/login-fix") as { e2e: { checks: CheckRun[] } }).e2e.checks
    store.set("runs:proj/login-fix", { ...(store.get("runs:proj/login-fix") as object), e2e: { path: "aside", checks: k.map(x => ({ ...x, running: true })) } })
    expect(await $.tool.call(runAs(agentId!, command))).toEqual(refused("check detail's aside call is already running"))
  })

  test("a 통과 with no screenshot in the check's folder counts as 실패 and asks the user (D177)", async ($, on) => {
    const files = filesWith()
    const questions: string[] = []
    world(on, files, q => (questions.push(q), undefined), { ...RUN, checks: [CHECKS[0]] }, host([ok(out(S1, "우수회원", "통과"))], () => "", { shots: false }))
    await toAside($)
    const r = await runCheck($, "detail", S1, "우수회원", "통과")
    expect(context(r)).toContain("check detail: 판정: 실패 (aside said 통과, but its folder has no screenshot, so the hook counts it 실패, D177)")
    expect(context(r)).toContain("Every aside check has a verdict and these aside checks failed: detail")
    expect(files[QAI]).toContain(`- 본 것: 우수회원\n- 결과: 실패 (aside는 통과라 했지만 스크린샷이 없음)\n- aside 세션: ${S1}\n- 스크린샷: 없음\n`)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`>   증거: ${UNSHOT}`)
  })

  test("a result file not in the form is not taken; the runner writes it again", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, checks: [CHECKS[0]] }, host([ok(out(S1, "우수회원", "통과"))]))
    await toAside($)
    const { agentId } = await spawnRunner($)
    await $.tool.call(runAs(agentId!, asideExec(folderOf("detail"))))
    const bad = await $.tool.call(write(`${folderOf("detail")}/result.md`, `세션: ${S1}\n판정: 통과\n`, agentId))
    expect(context(bad)).toContain("needs exactly one line each of `세션: <ID>`, `관측: <what aside saw>`")
    expect(await status($)).toContain(`e2e check detail: rein:e2e-runner ${agentId} on it`)
  })

  test("past 10 minutes the runner resumes its running session until the check's limit, and its verdict counts (D172)", async ($, on) => {
    const files = filesWith()
    const running = () => `${S2}  running  ephemeral  x  2026-10-02T00:00:00.000Z\n${S1}  idle  ephemeral  y  t\n`
    world(on, files, undefined, { ...RUN, checks: [CHECKS[1]] }, host([timedOut(S2), timedOut(S2, "continuing existing session"), ok(out(S2, "우수회원", "통과", "continuing existing session"))], running))
    await toAside($)
    const { agentId } = await spawnRunner($)
    const r1 = await $.tool.call(runAs(agentId!, asideExec(folderOf("mobile"))))
    expect(context(r1)).toContain(`aside is still running check mobile in session ${S2} (10 of 25 minutes spent). Wait on it: \`timeout 10m aside session resume ${S2} '<prompt>'\``)
    expect(await status($)).toContain(`e2e check mobile: rein:e2e-runner ${agentId} on it, 세션 ${S2}, 10 of 25 minutes spent`)
    await $.tool.call(runAs(agentId!, asideResume(S2, 10)))
    expect(await $.tool.call(runAs(agentId!, asideResume(S2, 10)))).toEqual(refused("the timeout must be 1 to 5 minutes"))
    expect(context(await $.tool.call(runAs(agentId!, asideResume(S2, 5))))).toContain("aside ended with 관측: 우수회원 and 판정: 통과")
    expect(context(await $.tool.call(report(agentId!, folderOf("mobile"), S2, "우수회원", "통과")))).toContain("Every aside check passed")
    expect(files[QAI]).toContain(`- 결과: 통과\n- aside 세션: ${S2}\n`)
    expect(ran.some(x => x.argv.includes("stop"))).toBe(false)
  })

  test("after exit 124 a session that is no longer running leaves the check open for the runner to start again", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host([timedOut(S1)], () => `${S1}  interrupted  e  x  t\n`))
    await toAside($)
    const { agentId } = await spawnRunner($)
    const r = await $.tool.call(runAs(agentId!, asideExec(folderOf("detail"))))
    expect(context(r)).toContain(`aside ran past 10 minutes and its session ${S1} is interrupted, with no verdict. Run aside exec again while time is left (20 of 30 minutes)`)
    expect(await status($)).not.toContain("halt:")
  })

  test("a runner that ended without its result frees its check for a new one", async ($, on) => {
    const agents: Record<string, AgentStatus> = {}
    world(on, filesWith(), undefined, { ...RUN, checks: [CHECKS[0]] }, host([], () => "", { agents }))
    await toAside($)
    const { agentId } = await spawnRunner($)
    expect(await status($)).toContain(`rein:e2e-runner ${agentId} on it`)
    agents[agentId!] = "failed"
    expect(await status($)).toContain("e2e check detail: waiting for a runner")
    expect((await spawnRunner($)).agentId).toBe("agent-rein:e2e-runner-2")
    expect(await $.tool.call(runAs(agentId!, asideExec(folderOf("detail"))))).toEqual(refused("D117: only "))
  })

  test("the main session's own aside runs, and counts for no check", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, checks: [CHECKS[0]] }, host([ok(out(S1, "우수회원", "통과"))]))
    await toAside($)
    const r = await $.tool.call({ tool: "Bash", command: asideExec(folderOf("detail")), timeout: 600_000 } as never)
    expect(r).not.toEqual(expect.objectContaining({ deny: expect.anything() }))
    expect(context(r)).toBe("")
    expect(await status($)).toContain("e2e check detail: waiting for a runner")
  })

  test("capture reads exec and resume first lines and the last 관측; the list gives a status", () => {
    expect(captureAside(out(S1, "보임", "실패"))).toEqual({ session: S1, observed: "보임", verdict: "실패" })
    expect(captureAside(out(S1, "보임", "통과", "continuing existing session"))).toEqual({ session: S1, resumed: true, observed: "보임", verdict: "통과" })
    expect(captureAside(`created new session: ${S1}\n관측: a\n관측: b\n판정: 통과`).observed).toBe("b")
    // the sign-in warning aside printed first in a real run (2026-10-06).
    const warned = `Exit code 124\n\x1b[33mWarning:\x1b[0m Aside needs sign-in again for this account.\nYour cloud session is paused (device mismatch).\n\nCurrent account: * u0  a@b.c  signed out/paused  profiles: Profile 0\n\nSign in again in Aside Settings > Account, or switch accounts:\n  aside account list\n  aside account use <id>\n  aside exec --account <id> ...\n\n\x1b[2mcreated new session: ${S1}\x1b[0m\n\x1b[2mThinking: I'll start\x1b[0m\n`
    expect(captureAside(warned).session).toBe(S1)
    expect(sessionStatus(`\x1b[2m${S1}  running  ephemeral  t\x1b[0m\n${S2}  idle  e  t\n`, S2)).toBe("idle")
    expect(sessionStatus("", S2)).toBeUndefined()
  })

  test("each app the checks use is checked against production and probed (D170)", async ($, on) => {
    world(on, filesWith({ ...E2E, apps: { ...APPS, mobile: { url: "https://app.example.com" } } }), undefined, RUN, host([]))
    expect(context(await toAside($))).toContain("D100: the run is in the qa-integration stage but halted: https://app.example.com")
    expect(await spawnRunner($)).toEqual(refused("D100: the run is halted"))
  })

  test("an app that does not answer halts with its url", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host([], () => "", { fetch: url => !url.includes("3000") }))
    expect(context(await toAside($))).toContain("D101: the run is in the qa-integration stage but halted: http://localhost:3000 did not answer")
  })

  test("2-plan.md's 없음 runs no aside, even with Aside down, and writes a passing ## e2e (D168)", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, { ...RUN, checks: [] }, { run: argv => (argv[0] === "aside" ? { exitCode: 1 } : { exitCode: 0, stdout: "ok\n" }) })
    expect(context(await relay($, ADVANCE))).toContain("D168: the qa commands passed; 2-plan.md's `## e2e 확인` checks no screen")
    expect(files[QAI]).toContain("방법: 없음 — 2-plan.md에 화면 확인 항목이 없음")
  })
})

describe("a check's time limit (D101)", () => {
  const running = () => `${S2}  running  ephemeral  x  t\n`

  test("past the check's limit the hook stops the session and closes the check; the run halts once the rest are done", async ($, on) => {
    const two = [{ ...CHECKS[0]!, minutes: 10 }, { ...CHECKS[0]!, name: "other" }]
    const files = filesWith()
    world(on, files, () => "다시 돌리기", { ...RUN, checks: two }, host([timedOut(S2), ok(out(S1, "보임", "통과"))], running))
    await toAside($)
    const first = (await spawnRunner($)).agentId!
    const other = (await spawnRunner($)).agentId!
    const r = await $.tool.call(runAs(first, asideExec(folderOf("detail"))))
    expect(context(r)).toContain(`check detail ran past its 10 minutes and is closed with no verdict. The hook stopped aside session ${S2}. Write nothing.`)
    expect(context(r)).toContain("Report this to the main session and stop")
    expect(ran.some(x => x.argv.join(" ") === `aside session stop ${S2}`)).toBe(true)
    expect(await status($)).toContain(`e2e check detail: ran past its 10 minutes and the hook stopped it, 세션 ${S2}`)
    expect(await status($)).not.toContain("halt:")
    expect(await $.tool.call(report(first, folderOf("detail"), S2, "x", "통과"))).toEqual(refused("D176"))
    await $.tool.call(runAs(other, asideExec(folderOf("other"))))
    const last = await $.tool.call(report(other, folderOf("other"), S1, "보임", "통과"))
    expect(context(last)).toContain("No check is open now, but check detail ran past its 10 minutes, so the run is halted (D101); ")
    expect(files[QAI]).toContain(`- 결과: 없음 — 판정 없이 닫힘 (시간 초과나 스페이스 유실)\n- aside 세션: ${S2}\n`)
    expect(files[QAI]).toContain(`- 본 것: 보임\n- 결과: 통과\n- aside 세션: ${S1}\n`)
    expect(files[QAI]).toContain("판정: 미정\n")
    expect(await status($)).toContain("halt: D101: check detail ran past its 10 minutes")
    // 다시 돌리기 keeps the pass and runs the check whose time ran out again.
    await relay($, ADVANCE)
    const s = await status($)
    expect(s).toContain(`e2e check other: 판정: 통과, 세션 ${S1}`)
    expect(s).toContain("e2e check detail: waiting for a runner, limit 10 minutes")
  })

  test("a stop that fails tells the runner the user stops the session", async ($, on) => {
    world(on, filesWith(), undefined, { ...RUN, checks: [{ ...CHECKS[0]!, minutes: 5 }] }, {
      ...host([timedOut(S2)], running),
      run: argv => (argv[0] === "aside" && argv[2] === "list" ? { exitCode: 0, stdout: running() } : argv[0] === "aside" ? { exitCode: argv[2] === "stop" ? 1 : 0 } : { exitCode: 0, stdout: "ok\n" }),
    })
    await toAside($)
    const { agentId } = await spawnRunner($)
    const r = await $.tool.call(runAs(agentId!, asideExec(folderOf("detail"), 5)))
    expect(context(r)).toContain(`The hook could not stop aside session ${S2}, which may still be driving the browser: the user stops it (\`aside session stop ${S2}\`).`)
    expect(await status($)).toContain("halt: D101: check detail ran past its 5 minutes")
  })
})

describe("a failed check asks the user (D173)", () => {
  const failing = () => host([ok(out(S1, "우수회원만 체크", "통과")), ok(out(S2, "공란", "실패"))])

  async function toHalt($: Engine) {
    await toAside($)
    await runCheck($, "detail", S1, "우수회원만 체크", "통과")
    return runCheck($, "mobile", S2, "공란", "실패")
  }

  test("실패 항목만 다시 돌리기 keeps what passed and runs the failed check again, counting nothing", async ($, on) => {
    const files = filesWith()
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "실패 항목만 다시 돌리기"), RUN, failing())
    const r = await toHalt($)
    expect(context(r)).toContain("Every aside check has a verdict and these aside checks failed: mobile")
    expect(files[QAI]).toContain("판정: 실패\n")
    expect(await $.tool.call(write(QAI, "## e2e\n\n판정: 통과\n"))).toEqual(expect.objectContaining({ result: "ok" }))
    const again = await relay($, ADVANCE)
    expect(questions[0]).toContain("aside 확인 항목이 실패했습니다 (D173)")
    expect(questions[0]).toContain(`> mobile — 세션 ${S2} — 판정: 실패`)
    expect(questions[0]).toContain(">   관측: 공란")
    expect(context(again)).toContain("with 1 check to run")
    const s = await status($)
    expect(s).toContain(`e2e check detail: 판정: 통과, 세션 ${S1}`)
    expect(s).toContain("e2e check mobile: waiting for a runner")
    expect(questions[0]).toContain("사용자가 실패한 항목을 직접 확인했다면 5-checklist.md에서 그 항목의 칸을 모두 체크한 뒤 이것을 고릅니다. 칸이 다 체크된 항목은 다시 돌지 않고 사용자 확인으로 통과합니다.")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ retries: 0 })
    expect(files[QAI]).toBe("## 이전 진입\n\n### 1차 진입 — e2e\n\n판정: 통과\n")
    const { agentId } = await spawnRunner($)
    expect(spawned.at(-1)!.prompt).toContain(`- Screenshot folder: ${folderOf("mobile", 2)}`)
    await $.tool.call(runAs(agentId!, asideExec(folderOf("mobile", 2))))
    expect(context(await $.tool.call(report(agentId!, folderOf("mobile", 2), S2, "우수회원", "통과")))).toContain("Every aside check passed")
    expect(files[QAI]).toContain(`- 결과: 통과\n- aside 세션: ${S1}\n`)
    expect(files[QAI]).toContain("- 스크린샷: agent/evidence/mobile/2/shot.png\n\n![](evidence/mobile/2/shot.png)\n")
    expect(files[QAI]).toContain("판정: 통과\n\n## 이전 진입\n\n### 1차 진입 — e2e\n\n판정: 통과\n")
  })

  test("the question names the parts of the completion line only the failed checks cover", async ($, on) => {
    const files = { ...filesWith(), [`${DIR}/2-plan.md`]: '## 완료 판정 덮기\n\n- "세 번 실패하면" — e2e: mobile\n- "잠긴다" — e2e: detail, mobile\n- "로그인에" — 테스트: tests/login.test.ts\n' }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "그대로 멈춤"), RUN, failing())
    await toHalt($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain('이 경우 확인되지 않는 조각: "세 번 실패하면" (mobile로만 확인)')
    expect(questions[0]).not.toContain('"잠긴다" (')
  })

  test("with no part only the failed checks cover, the question says so", async ($, on) => {
    const files = { ...filesWith(), [`${DIR}/2-plan.md`]: '## 완료 판정 덮기\n\n- "세 번 실패하면 잠긴다" — e2e: detail, mobile\n' }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "그대로 멈춤"), RUN, failing())
    await toHalt($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("이 경우 확인되지 않는 조각: 없음")
  })

  test("기존 동작으로 진행 marks the failure as the user's judgment and goes on to the completion check", async ($, on) => {
    const files = filesWith()
    world(on, files, () => "기존 동작으로 진행", RUN, failing())
    await toHalt($)
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D173: the user judged mobile as what the code did before")
    expect(files[QAI]).toContain(`- 결과: 실패 → 사용자가 기존 동작으로 판단\n- aside 세션: ${S2}\n`)
    expect(files[QAI]).toContain("\n판정: 통과\n")
    expect(await status($)).not.toContain("halt:")
    await $.agent.spawn(spawnVerifier)
    expect(spawned.find(s => s.type === "rein:reviewer")!.prompt).toContain("only e2e checks the user passed as 기존 동작 cover it")
    expect(spawned.find(s => s.type === "rein:reviewer")!.prompt).toContain("A check passed as 기존 동작 whose only failed part is 레이아웃 still shows what its 기대 says: count it.")
    const done = await $.tool.call(write(QAI, `${files[QAI]}\n## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n판정: 실패\n`, VERIFIER))
    expect(context(done)).toContain("completion-failed: the completion check in e2e.md failed, so the run is halted in qa-integration")
    expect(await status($)).toContain("halt: completion-failed")
  })

  test("그대로 멈춤 keeps the halt; a dismissed question too", async ($, on) => {
    let answer: string | undefined = "그대로 멈춤"
    world(on, filesWith(), () => answer, RUN, failing())
    await toHalt($)
    expect(await relay($, ADVANCE)).toEqual(refused("D173: the run stays halted in qa-integration."))
    answer = undefined
    expect(await relay($, ADVANCE)).toEqual(asks("D173: this needs a decision; nothing changed."))
    expect(await status($)).toContain("halt: D173")
  })

  test("a config approved while halted voids the results: the halt becomes a rerun question", async ($, on) => {
    const files = filesWith()
    world(on, files, () => "새 config 승인", { ...RUN, configHashes: { "E:/proj": await sha256Text(config()) } }, failing())
    await toHalt($)
    files["E:/proj/.rein/config.json"] = config({ ...E2E, timeout: 20 })
    await relay($, ADVANCE)
    const s = await status($)
    expect(s).toContain("halt: D120: a config changed after the aside checks ran")
    expect(s).not.toContain("e2e check")
  })
})

describe("handoff files before e2e (D178)", () => {
  test("handoff files halt nothing: the aside checks run at once and the hook asks nothing", async ($, on) => {
    const questions: string[] = []
    world(on, filesWith(), q => (questions.push(q), undefined), { ...RUN, handoff: ["01_config.sql"] }, host([]))
    expect(context(await toAside($))).toContain("aside path, with 2 checks to run")
    expect(await status($)).not.toContain("halt:")
    expect(questions).toHaveLength(0)
  })

  test("a run halted on D174 before D178 is asked the rerun question, and the entry runs", async ($, on) => {
    const questions: string[] = []
    const halted = { ...RUN, stage: "qa-integration", handoff: ["a.sql"], browser: "aside", e2e: { path: "aside" }, halt: { rule: "D174", reason: "2-plan.md's `## 넘길 것` names files the user applies by hand (a.sql); e2e runs once they say these are applied" } }
    world(on, filesWith(), q => (questions.push(q), "다시 돌리기"), halted, host([]))
    await relay($, ADVANCE)
    expect(questions[0]).toContain("환경을 고쳤나요? 통합 qa를 다시 돌릴까요? (멈춘 이유: D174:")
    expect(await status($)).toContain("e2e runners to spawn now: 1")
    expect(await status($)).not.toContain("halt:")
  })
})

describe("2-plan.md changed after it passed: told once, and goto takes it", () => {
  const PLAN = `${DIR}/2-plan.md`
  const V1 = `## 접근 방법\n\na\n\n## 상세 설계\n\n### src/login.ts\n- 고친다\n- 테스트: tests/login.test.ts\n\n### tests/login.test.ts\n- 본다\n- 테스트: tests/login.test.ts\n\n## e2e 확인\n\n### detail\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: /member/detail에서 본다\n- 기대: 우수회원\n- 저장: 없음\n${COVER}`
  const V2 = V1.replace("에서 본다", "에서 펼침을 체크하고 본다")
  const record = () => store.get("runs:proj/login-fix") as { stage: string; checks?: { todo: string }[]; frozen?: { plan?: string }; e2e?: { path?: string }; halt?: unknown; retries: number }
  const at = (stage: string) => ({ ...RUN, stage, checks: [CHECKS[0]], frozen: { spec: SPEC_TEXT, plan: V1 }, sealed: {}, e2e: stage === "qa-integration" ? { path: "aside", checks: [] } : undefined })
  const edit = (content: string) => ({ tool: "Write", file_path: PLAN, content }) as never
  const goto = (stage: string) => ({ tool: "mcp__rein__goto", stage }) as never
  const repo = { "E:/proj/.git/HEAD": "" }

  test("a changed 2-plan.md is told once; the run and its design stay", async ($, on) => {
    world(on, { ...filesWith(), ...repo, [PLAN]: V1 }, undefined, at("qa-integration"), host([]))
    const r = await $.tool.call(edit(V2))
    expect(context(r)).toContain("2-plan.md changed after it passed")
    expect(context(r)).toContain("call mcp__rein__goto")
    expect(record()).toMatchObject({ stage: "qa-integration", frozen: { plan: V1 } })
    expect(record().checks![0]!.todo).toBe(CHECKS[0]!.todo)
    expect(context(await $.tool.call({ tool: "Bash", command: "ls" } as never))).not.toContain("2-plan.md changed")
  })

  test("goto qa-integration reads 2-plan.md again and runs the entry, the qa commands skipped", async ($, on) => {
    world(on, { ...filesWith(), ...repo, [PLAN]: V2 }, undefined, { ...at("qa-integration"), retries: 1 }, host([]))
    const r = await $.tool.call(goto("qa-integration"))
    expect(context(r)).toContain("5-checklist.md")
    expect(record()).toMatchObject({ stage: "qa-integration", frozen: { plan: V2 }, e2e: { path: "wait" }, retries: 0 })
    expect(record().checks![0]!.todo).toBe("/member/detail에서 펼침을 체크하고 본다")
    expect(ran.some(r => r.argv.includes("npm test"))).toBe(false)
  })

  test("goto qa-integration is refused while a check is open; goto elsewhere is not", async ($, on) => {
    const running = { ...at("qa-integration"), e2e: { path: "aside", checks: [{ name: "detail", minutes: 30, spent: 0, app: "admin", runner: "agent-r1" }, { name: "mobile", minutes: 30, spent: 0, app: "admin", verdict: "통과" }] } }
    world(on, { ...filesWith(), ...repo, [PLAN]: V1 }, undefined, running, host([]))
    expect(await $.tool.call(goto("qa-integration"))).toEqual(refused("integration checks are still open (detail)"))
    expect(record()).toMatchObject({ stage: "qa-integration", e2e: { path: "aside" } })
    expect(context(await $.tool.call(goto("plan")))).toContain("The run is now in the plan stage.")
  })

  test("goto past plan with a 2-plan.md that does not pass is refused, and nothing moves", async ($, on) => {
    world(on, { ...filesWith(), ...repo, [PLAN]: V1.replace("- 앱: admin", "- 앱: nope") }, undefined, at("qa-integration"), host([]))
    expect(await $.tool.call(goto("dev"))).toEqual(refused("2-plan.md, and it does not pass"))
    expect(record().stage).toBe("qa-integration")
  })
})

describe("evidence a person reads (D208)", () => {
  test("each screenshot is also an image line, its spaces and parentheses escaped", () => {
    const section = asideSection([{ name: "detail", minutes: 30, spent: 0, exec: "", session: S1, observed: "우수회원", verdict: "통과", evidence: "agent/evidence/detail/1", shots: ["agent/evidence/detail/1/a b (1).png", "agent/evidence/detail/1/c.png"] }])
    expect(section).toContain("- 스크린샷: agent/evidence/detail/1/a b (1).png, agent/evidence/detail/1/c.png\n\n![](evidence/detail/1/a%20b%20%281%29.png)\n![](evidence/detail/1/c.png)\n")
  })

  test("a screenshot of a check from before agent/ is linked from e2e.md in agent/ by its folder", () => {
    const section = asideSection([{ name: "detail", minutes: 30, spent: 0, exec: "", session: S1, observed: "우수회원", verdict: "통과", evidence: "evidence/detail/1", shots: ["evidence/detail/1/c.png"] }])
    expect(section).toContain("- 스크린샷: evidence/detail/1/c.png\n\n![](../evidence/detail/1/c.png)\n")
  })

  test("steps are numbered and the expectation is listed by part, in ## e2e and in the runner's task with the app's note and why the data was chosen", () => {
    const base = { name: "detail", minutes: 30, spent: 0, exec: "", session: S1, observed: "우수회원", verdict: "통과" as const, shots: ["a.png"], todo: "회원을 연다\n회원유형을 본다", expect: "우수회원\n비활성" }
    expect(asideSection([base])).toContain("- 할 일:\n  1. 회원을 연다\n  2. 회원유형을 본다\n- 기대:\n  - 우수회원\n  - 비활성\n")
    const check = { ...CHECKS[0]!, todo: base.todo, expect: base.expect, reference: "휴면 회원" }
    const task = runnerTask({ ...E2E, apps: { ...APPS, admin: { ...APPS.admin, note: "환영 안내는 [건너뛰기]" } } }, check, base, "F", "F/result.md")
    expect(task).toContain("- Mind in this app: 환영 안내는 [건너뛰기]\n")
    expect(task).toContain("- Task: \n  1. 회원을 연다\n  2. 회원유형을 본다\n- Expected: \n  - 우수회원\n  - 비활성\n- Why this data (background, not to check): 휴면 회원\n")
    const config = (app: object) => checkConfig(JSON.stringify({ qa: ["t"], e2e: { apps: { admin: { url: "http://x", ...app } }, production: [], backends: [] } }))
    expect(config({ note: 3 })).toContain("`e2e.apps.admin.note` must be a string")
    expect(readConfig(JSON.stringify({ qa: ["t"], e2e: { ...E2E, apps: { admin: { url: "http://x", note: "닫기" } } } })).e2e?.apps.admin).toEqual({ url: "http://x", note: "닫기" })
  })

  test("a check's account wins over an account the app's login names, in the runner's task", () => {
    const base = { name: "detail", minutes: 30, spent: 0, exec: "", session: S1, observed: "", verdict: "통과" as const, shots: [] }
    const task = runnerTask(E2E, { ...CHECKS[0]!, account: "tester2" }, base, "F", "F/result.md")
    expect(task).toContain("- Log in: tester / test-pass, 아이디·비밀번호로 직접 로그인\n")
    expect(task).toContain("- Account: tester2 (log in as this account, even where the login above names another; the rest of the login still applies)\n")
  })

  test("each check says what it was asked and the account it logged in as, never the app's login", () => {
    const base = { minutes: 30, spent: 0, exec: "", session: S1, observed: "우수회원", verdict: "통과" as const, shots: ["a.png"] }
    const section = asideSection([
      { ...base, name: "detail", todo: "회원을 연다", expect: "우수회원", account: "tester2" },
      { ...base, name: "mobile", todo: "회원을 저장한다", expect: "저장됨" },
      { ...base, name: "old" },
    ])
    expect(section).toContain("### detail\n\n- 할 일: 회원을 연다\n- 기대: 우수회원\n- 계정: tester2\n")
    expect(section).toContain("### mobile\n\n- 할 일: 회원을 저장한다\n- 기대: 저장됨\n- 계정: 앱 login 설정대로\n")
    expect(section).toContain("### old\n\n- 할 일: (기록 없음)\n- 기대: (기록 없음)\n- 계정: (기록 없음)\n")
    expect(section.match(/^판정:/gm)).toHaveLength(1)
  })
})

describe("the integration test waits for the user (5-checklist.md)", () => {
  const LIST = `${DIR}/5-checklist.md`
  const answer = (text: string) => ({ tool: "mcp__rein__advance", answer: text }) as never

  test("a run in worktrees tells the user to start the apps from them, in the result and atop the checklist", async ($, on) => {
    const files = filesWith(E2E)
    const TREE = "E:/proj/.claude/worktrees/login-fix"
    world(on, files, undefined, { ...RUN, checks: CHECKS, trees: [{ repo: "E:/proj", path: TREE, branch: "rein/login-fix", start: "main" }] }, host([]))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain(`Tell them too that the run's code is in its worktrees (${TREE}): an app started from the main working tree does not have it`)
    expect(files[LIST]).toMatch(new RegExp(`^# 통합 테스트 체크리스트 — spec\\n\\n> 이 run의 코드는 워크트리에 있습니다: ${TREE}\\. 메인 작업 트리에서 띄운 앱에는 이 변경이 없으니`))
  })

  test("in an autopilot run the hook writes the checklist and tells the main session to run the checks in Ego itself", async ($, on) => {
    const files = filesWith(E2E)
    world(on, files, undefined, { ...RUN, checks: CHECKS, autopilot: true }, host([]))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain(`the hook wrote the integration test checklist ${LIST}, and nothing ran. This is an autopilot run: the user does not test by hand or type /rein:e2e. Call mcp__rein__advance now with answer "e2e 실행 (Ego)" and said "autopilot", then go on as the rein:qa skill says for the ego path.`)
    expect(files[LIST]).toContain("# 통합 테스트 체크리스트")
  })

  test("with checks, passing work qa stops in qa-integration: the hook writes the checklist by page and runs nothing", async ($, on) => {
    const files = filesWith({ ...E2E, apps: { ...APPS, admin: { ...APPS.admin, note: "로그인 뒤 환영 안내는 [건너뛰기]" } } })
    const detail = { ...CHECKS[0]!, title: "휴면 회원의 회원유형", kind: "변경" as const, todo: "/member/detail를 연다\n회원 테스트회원A를 검색해 회원유형을 본다", expect: "우수회원만 체크\n네 라디오가 모두 비활성", reference: "테스트회원A는 휴면 회원" }
    world(on, files, undefined, { ...RUN, checks: [detail, { ...detail, name: "detail-control", title: "정상 회원의 회원유형", kind: "대조" as const, account: "tester2" }, CHECKS[1]] }, host([]))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain(`the hook wrote the integration test checklist ${LIST}, and nothing ran. Tell the user, then stop.`)
    expect(files[LIST]).toBe(
      "# 통합 테스트 체크리스트 — spec\n\n" +
        "항목마다 할 일을 화면에서 해 보고, 기대대로 보이는 줄의 칸을 `[x]`로 체크하세요.\n\n" +
        "- 직접 확인했으면: 모든 칸을 체크한 뒤 `/rein:land`\n" +
        "- aside에 맡기려면: `/rein:e2e` — 기대 칸을 모두 체크한 항목은 건너뛰고, 통과한 항목은 훅이 체크합니다\n" +
        "- 문제가 있으면: 메인 세션에 말하세요. dev로 되돌릴 수 있습니다\n\n" +
        "## 회원상세\n\n- 접근: 회원 > 회원관리 > 회원상세\n- 앱: admin (http://localhost:8090)\n- 주의: 로그인 뒤 환영 안내는 [건너뛰기]\n\n" +
        "- **휴면 회원의 회원유형** — 변경 확인 · `detail`\n  - 계정: 따로 없음 — admin 앱의 login 설정대로\n" +
        "  - 할 일:\n    1. /member/detail를 연다\n    2. 회원 테스트회원A를 검색해 회원유형을 본다\n" +
        "  - 기대:\n    - [ ] 우수회원만 체크\n    - [ ] 네 라디오가 모두 비활성\n  - 참고: 테스트회원A는 휴면 회원\n\n" +
        "- **정상 회원의 회원유형** — 대조군 (바뀌면 안 됨) · `detail-control`\n  - 계정: tester2\n" +
        "  - 할 일:\n    1. /member/detail를 연다\n    2. 회원 테스트회원A를 검색해 회원유형을 본다\n" +
        "  - 기대:\n    - [ ] 우수회원만 체크\n    - [ ] 네 라디오가 모두 비활성\n  - 참고: 테스트회원A는 휴면 회원\n\n" +
        "## (페이지 기록 없음)\n\n- 접근: (기록 없음)\n- 앱: mobile (http://localhost:3000)\n- 계정: 따로 없음 — mobile 앱의 login 설정대로\n\n" +
        `- **mobile**\n  - 할 일: ${CHECKS[1]!.todo}\n  - 기대:\n    - [ ] ${CHECKS[1]!.expect}\n  - 저장: 할 일대로 저장하고, 원래 값으로 되돌립니다\n`,
    )
    expect(files[LIST]).not.toContain("test-pass")
    expect(tick(files[LIST]!, "detail-control", "aside 통과")).toContain(
      "- **정상 회원의 회원유형** — 대조군 (바뀌면 안 됨) · `detail-control` (aside 통과)\n  - 계정: tester2\n" +
        "  - 할 일:\n    1. /member/detail를 연다\n    2. 회원 테스트회원A를 검색해 회원유형을 본다\n" +
        "  - 기대:\n    - [x] 우수회원만 체크\n    - [x] 네 라디오가 모두 비활성\n  - 참고: 테스트회원A는 휴면 회원\n\n" +
        "## (페이지 기록 없음)",
    )
    expect(tick(files[LIST]!, "detail-control", "aside 통과")).toContain("- **휴면 회원의 회원유형** — 변경 확인 · `detail`\n")
    expect(tick(files[LIST]!, "detail-control", "aside 통과")).toContain("    - [ ] 우수회원만 체크\n")
    const ticked = tick(files[LIST]!, "detail-control", "aside 통과")
    expect(tick(ticked, "detail-control", "aside 통과")).toBe(ticked)
    expect(unchecked(ticked)).toEqual(["- [ ] **휴면 회원의 회원유형**: 우수회원만 체크", "- [ ] **휴면 회원의 회원유형**: 네 라디오가 모두 비활성", `- [ ] **mobile**: ${CHECKS[1]!.expect}`])
    expect(files[QAI]).toBe("")
    expect(await status($)).toContain("stage: qa-integration\n")
    expect(await status($)).toContain("e2e: wait (5-checklist.md is out")
    expect(await status($)).not.toContain("e2e runners to spawn")
    expect(ran.filter(x => x.argv[0] === "aside")).toHaveLength(0)
  })

  test("advance without an answer asks how the user tests; another answer leaves the run waiting", async ($, on) => {
    world(on, filesWith(), undefined, RUN, host([]))
    await relay($, ADVANCE)
    expect(await $.tool.call(ADVANCE)).toEqual(asks(`this needs a decision; nothing changed.`))
    const question = ((await $.tool.call(ADVANCE)) as { result: string }).result
    expect(question).toContain('"직접 확인 완료", "e2e 실행 (Aside)", "e2e 실행 (Ego)", "dev로 보냄", "plan으로 보냄"')
    expect(question).not.toContain("재시도")
    expect(await $.tool.call(answer("나중에"))).toEqual(refused(`answer takes one of "직접 확인 완료", "e2e 실행 (Aside)", "e2e 실행 (Ego)", "dev로 보냄", "plan으로 보냄", and "나중에" is none of them, so nothing changed.`))
    expect(await status($)).toContain("e2e: wait")
  })

  test("직접 확인 완료 needs every box checked; then ## e2e says so and the run goes to land with no completion check", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([]))
    await relay($, ADVANCE)
    const open = await $.tool.call(answer("직접 확인 완료"))
    expect(open).toEqual(refused(`The run does not go to land: these boxes of ${LIST} are still empty:\n  - [ ] **detail**: ${CHECKS[0]!.expect}`))
    expect(open).toEqual(refused(`- [ ] **mobile**: ${CHECKS[1]!.expect}`))
    expect(await $.tool.call(write(LIST, files[LIST]!.replace(`- [ ] ${CHECKS[0]!.expect}`, `- [x] ${CHECKS[0]!.expect}`)))).toEqual(expect.objectContaining({ result: "ok" }))
    const left = await $.tool.call(answer("직접 확인 완료"))
    expect(left).toEqual(refused(`- [ ] **mobile**: ${CHECKS[1]!.expect}`))
    expect(left).not.toEqual(refused("**detail**"))
    files[LIST] = files[LIST]!.replace(`- [ ] ${CHECKS[1]!.expect}`, `- [x] ${CHECKS[1]!.expect}`)
    const r = await $.tool.call(answer("직접 확인 완료"))
    expect(context(r)).toContain("now in the land stage")
    expect(files[QAI]).toBe("## e2e\n\n방법: 사용자가 5-checklist.md대로 직접 확인함 — 모든 칸 체크\n\n판정: 통과\n")
    expect(spawned).toHaveLength(0)
    expect(await status($)).toContain("stage: land\n")
  })

  test("dev로 보냄 sends the run to dev with the checklist and counts nothing", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([]))
    await relay($, ADVANCE)
    expect(await $.tool.call(write(LIST, `${files[LIST]}\n## 찾은 문제\n\n- detail: 회원유형이 일반으로 보임\n`))).toEqual(expect.objectContaining({ result: "ok" }))
    const r = await $.tool.call(answer("dev로 보냄"))
    expect(context(r)).toContain(`The user found a problem in the integration test; ${LIST} holds the checklist and what they found.`)
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "dev", retries: 0, failFile: LIST })
  })

  test("plan으로 보냄 sends the run to plan with the checklist as a design problem and counts nothing", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([]))
    await relay($, ADVANCE)
    expect(await $.tool.call(write(LIST, `${files[LIST]}\n## 찾은 문제\n\n- detail: 설계한 화면이 아니다\n`))).toEqual(expect.objectContaining({ result: "ok" }))
    const r = await $.tool.call(answer("plan으로 보냄"))
    expect(context(r)).toContain(`The user found a problem in the integration test; ${LIST} holds the checklist and what they found.`)
    expect(context(r)).toContain("D62")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", d62: true, failFile: LIST, retries: 0 })
  })

  test("e2e 실행 runs the aside checks; each one that passes checks its box", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([ok(out(S1, "우수회원만 체크", "통과")), ok(out(S2, "공란", "실패"))]))
    await relay($, ADVANCE)
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("D56: the user asked for e2e. The run is now in the qa-integration stage, aside path, with 2 checks to run")
    await runCheck($, "detail", S1, "우수회원만 체크", "통과")
    expect(files[LIST]).toContain(`- **detail** ([aside 통과](agent/e2e.md#detail))\n  - 할 일: ${CHECKS[0]!.todo}\n  - 기대:\n    - [x] ${CHECKS[0]!.expect}\n`)
    await runCheck($, "mobile", S2, "공란", "실패")
    expect(files[LIST]).toContain(`- **mobile**\n  - 할 일: ${CHECKS[1]!.todo}\n  - 기대:\n    - [ ] ${CHECKS[1]!.expect}\n`)
    expect(await status($)).toContain("halt: D173")
  })

  test("a failed check the user tested by hand, every box checked, passes as theirs on 실패 항목만 다시 돌리기 and runs no aside", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([ok(out(S1, "우수회원만 체크", "통과")), ok(out(S2, "공란", "실패"))]))
    await relay($, ADVANCE)
    await $.tool.call(answer("e2e 실행 (Aside)"))
    await runCheck($, "detail", S1, "우수회원만 체크", "통과")
    await runCheck($, "mobile", S2, "공란", "실패")
    expect(await status($)).toContain("halt: D173")
    files[LIST] = files[LIST]!.replace(`    - [ ] ${CHECKS[1]!.expect}`, `    - [x] ${CHECKS[1]!.expect}`)
    expect(context(await $.tool.call(answer("실패 항목만 다시 돌리기")))).toContain("every aside check already passed")
    expect(files[QAI]).toContain("- 기대: 우수회원으로 표시\n- 계정: 앱 login 설정대로\n- 본 것: (없음)\n- 결과: 통과 (사용자가 체크리스트로 확인)\n- aside 세션: 없음\n")
    expect(await status($)).not.toContain("halt:")
  })

  test("e2e 실행 skips a check whose every expectation box the user checked; ## e2e says the user checked it", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([ok(out(S2, "우수회원으로 표시", "통과"))]))
    await relay($, ADVANCE)
    files[LIST] = files[LIST]!.replace(`    - [ ] ${CHECKS[0]!.expect}`, `    - [x] ${CHECKS[0]!.expect}`)
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("with 1 check to run")
    await runCheck($, "mobile", S2, "우수회원으로 표시", "통과")
    expect(files[QAI]).toContain("### detail\n\n")
    expect(files[QAI]).toContain("- 결과: 통과 (사용자가 체크리스트로 확인)\n- aside 세션: 없음\n- 스크린샷: 없음\n")
    expect(files[LIST]).toContain(`- **mobile** ([aside 통과](agent/e2e.md#mobile))\n`)
  })

  test("e2e 실행 with every check checked by the user runs no aside and goes to the completion check", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, { run: argv => (argv[0] === "aside" ? { exitCode: 1 } : argv[0] === "git" ? { exitCode: 0, stdout: "abc123\n" } : { exitCode: 0, stdout: "ok\n" }) })
    await relay($, ADVANCE)
    files[LIST] = files[LIST]!.replaceAll("    - [ ] ", "    - [x] ")
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("every aside check already passed")
    expect(files[QAI]).toContain("### mobile\n\n")
    expect(files[QAI]!.match(/사용자가 체크리스트로 확인/g)).toHaveLength(2)
  })

  test("a check the hook ticked, or with a box still empty, is not the user's", () => {
    const text = "- **a** — 변경 확인 · `a`\n  - 기대:\n    - [x] y\n    - [ ] z\n\n- **b** — 대조군 (바뀌면 안 됨) · `b` (사용자가 기존 동작으로 판단)\n  - 기대:\n    - [x] y\n\n- **c**\n  - 기대:\n    - [x] y\n"
    expect(["a", "b", "c", "d"].map(name => handChecked(text, name))).toEqual([false, false, true, false])
  })

  test("the hook's tick links its evidence, each path segment and the fragment encoded; a ticked check is checked, not the user's", () => {
    const ego: CheckRun = { name: "상세 a", minutes: 5, spent: 0, evidence: "agent/evidence/상세 a/2", ego: { profile: "p", space: "s", spentMs: 0 } }
    const aside: CheckRun = { name: "b", minutes: 5, spent: 0, runner: "r", session: "s1" }
    expect(egoTick(ego)).toBe("[ego 통과](agent/evidence/%EC%83%81%EC%84%B8%20a/2/judge.md)")
    expect(asideTick({ ...aside, name: "a b" })).toBe("[aside 통과](agent/e2e.md#a%20b)")
    // a pass kept links the earlier pass's evidence; the plain words when the record cannot tell it.
    expect(carriedTick({ ...ego, carried: true })).toBe("[이전 통과 유지 — 파일 변경 없음](agent/evidence/%EC%83%81%EC%84%B8%20a/2/judge.md)")
    expect(carriedTick({ ...aside, carried: true, cleared: true })).toBe("[이전 통과 유지 — 코드가 바뀌었지만 영향 없다고 판정 (agent/impact.md)](agent/e2e.md#b)")
    expect(carriedTick({ name: "b", minutes: 5, spent: 0, verdict: "통과", checked: true, carried: true })).toBe("이전 통과 유지 — 파일 변경 없음")
    expect(carriedTick({ ...ego, evidence: undefined, carried: true })).toBe("이전 통과 유지 — 파일 변경 없음")
    const text = "- **a** — 변경 확인 · `a`\n  - 기대:\n    - [ ] y\n    - [ ] z\n\n- **b**\n  - 기대:\n    - [ ] y\n"
    const ticked = tick(tick(text, "a", egoTick({ ...ego, name: "a", evidence: "agent/evidence/a/1" })), "b", asideTick(aside))
    expect(ticked).toBe("- **a** — 변경 확인 · `a` ([ego 통과](agent/evidence/a/1/judge.md))\n  - 기대:\n    - [x] y\n    - [x] z\n\n- **b** ([aside 통과](agent/e2e.md#b))\n  - 기대:\n    - [x] y\n")
    expect(["a", "b"].map(name => [handChecked(ticked, name), allChecked(ticked, name)])).toEqual([[false, true], [false, true]])
    expect(tick(ticked, "a", "ego 통과")).toBe(ticked)
    // the person unchecks a box the hook checked: the check runs again.
    const undone = ticked.replace("    - [x] z", "    - [ ] z")
    expect([handChecked(undone, "a"), allChecked(undone, "a")]).toEqual([false, false])
    expect(unchecked(undone)).toEqual(["- [ ] **a**: z"])
  })

  test("e2e 실행 with Aside down runs nothing and leaves the run waiting", async ($, on) => {
    world(on, filesWith(), undefined, RUN, { run: argv => (argv[0] === "aside" ? { exitCode: 1 } : argv[0] === "git" ? { exitCode: 0, stdout: "abc123\n" } : { exitCode: 0, stdout: "ok\n" }) })
    await relay($, ADVANCE)
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("D141: Aside is unavailable")
    const s = await status($)
    expect(s).toContain("e2e: wait")
    expect(s).not.toContain("halt:")
  })

  test("while waiting a reviewer's e2e.md moves nothing: integration qa has not run", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host([]))
    await relay($, ADVANCE)
    await $.agent.spawn(spawnVerifier)
    const own = await $.tool.call(write(QAI, `## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n판정: 통과\n`, VERIFIER))
    expect(context(own)).toContain("integration qa has not run: the user tests by 5-checklist.md, or runs /rein:e2e")
    expect(await status($)).toContain("e2e: wait")
  })

  test("a check needs both 페이지 and 경로", () => {
    const reason = (parseChecks("## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 할 일: x\n- 기대: y\n- 저장: 없음\n") as { reason?: string }).reason ?? ""
    expect(reason).toContain("a needs exactly one non-empty line of `- 페이지:`, `- 경로:`")
  })
})

describe("a pass stands while the files its check names are unchanged", () => {
  const SRC = "E:/proj/src/login.ts"
  const VIEW = "E:/proj/src/view.ts"
  const LIST = `${DIR}/5-checklist.md`
  const S3 = "Qm3vX8sLr2NcTa0p"
  const answer = (text: string) => ({ tool: "mcp__rein__advance", answer: text }) as never
  const hashOf = (text: string) => sha256Text(btoa(String.fromCharCode(...new TextEncoder().encode(text))))
  const FILED = [{ ...CHECKS[0]!, files: [SRC] }, { ...CHECKS[1]!, files: [VIEW] }]
  const record = () => store.get("runs:proj/login-fix") as { stage: string; passed?: { name: string; verdict?: string; files: Record<string, string> }[] }
  const filesNow = (view = "w1"): Record<string, string> => ({ ...filesWith(), [SRC]: "v1", [VIEW]: view })
  // a check's pass from an earlier visit, as the hook kept it.
  const pass = async (k: (typeof FILED)[number], session: string, file: string, text: string) => ({
    name: k.name, minutes: 10, spent: 0, exec: "x", todo: k.todo, expect: k.expect, session, observed: "우수회원", verdict: "통과",
    evidence: `agent/evidence/${k.name}/1`, shots: [`agent/evidence/${k.name}/1/shot.png`], files: { [file]: await hashOf(text) },
  })
  // the run back in qa after a dev retry that left login.ts as it was and
  // left view.ts as `view`; both checks passed before, on w1.
  const retried = async (view: string) => ({
    ...RUN, planFiles: [SRC, VIEW], writes: [SRC, VIEW], checks: FILED, retries: 1,
    sealed: { [SRC]: await hashOf("v1"), [VIEW]: await hashOf(view) },
    passed: [await pass(FILED[0]!, S1, SRC, "v1"), await pass(FILED[1]!, S2, VIEW, "w1")],
  })
  const IMPACT_MD = `${DIR}/agent/impact.md`
  // rein:impact, spawned while work qa waits for it, writes impact.md with
  // these verdicts.
  const judgeImpact = async ($: Engine, verdicts: Record<string, string>) => {
    const { agentId } = (await $.agent.spawn({ tool_use_id: "i", prompt: "judge the impact", description: "impact", subagentType: "rein:impact" } as never)) as { agentId?: string }
    const text = `## 영향 판정\n\n${Object.entries(verdicts).map(([name, v]) => `### ${name}\n- 판정: ${v}\n- 이유: 바뀐 줄이 이 화면에 닿지 않음\n`).join("\n")}`
    return $.tool.call(write(IMPACT_MD, text, agentId))
  }

  test("a check that passes is kept with the seal values of its files; one naming no file rests on every sealed file", async ($, on) => {
    const sealed = { [SRC]: await hashOf("v1"), [VIEW]: await hashOf("w1") }
    world(on, filesNow(), undefined, { ...RUN, planFiles: [SRC, VIEW], checks: [FILED[0], CHECKS[1]], sealed }, host([ok(out(S1, "우수회원", "통과")), ok(out(S2, "우수회원", "통과"))]))
    await toAside($)
    await runCheck($, "detail", S1, "우수회원", "통과")
    await runCheck($, "mobile", S2, "우수회원", "통과")
    expect(record().passed?.map(p => [p.name, p.verdict, p.files])).toEqual([["detail", "통과", { [SRC]: sealed[SRC] }], ["mobile", "통과", sealed]])
  })

  test("a check that fails drops its earlier pass", async ($, on) => {
    world(on, filesNow("w2"), undefined, await retried("w2"), host([ok(out(S3, "공란", "실패"))]))
    await relay($, ADVANCE)
    await judgeImpact($, { mobile: "영향 있음" })
    await $.tool.call(answer("e2e 실행 (Aside)"))
    await runCheck($, "mobile", S3, "공란", "실패")
    expect(record().passed?.map(p => p.name)).toEqual(["detail"])
  })

  test("back from dev, a check whose file changed waits for rein:impact; touched, it runs again, and the other comes checked and says so in ## e2e", async ($, on) => {
    const files = filesNow("w2")
    world(on, files, undefined, await retried("w2"), host([ok(out(S3, "우수회원", "통과"))]))
    expect(context(await relay($, ADVANCE))).toContain("files they rest on changed since: mobile. Before the checklist is written, spawn rein:impact")
    expect(files[LIST]).toBeUndefined()
    expect(await status($)).toContain("e2e impact: spawn rein:impact (in the foreground) to judge whether the change since their pass touches mobile")
    expect(await $.tool.call(ADVANCE)).toEqual(refused("wait for rein:impact's judgment. Spawn rein:impact"))
    expect(context(await judgeImpact($, { mobile: "영향 있음" }))).toContain("rein:impact found the change touches every check in question")
    expect(spawned.at(-1)).toMatchObject({ type: "rein:impact", background: false })
    expect(spawned.at(-1)!.prompt).toContain(`### mobile\n- 할 일: ${CHECKS[1]!.todo}\n- 기대: ${CHECKS[1]!.expect}\n- 통과 뒤 바뀐 파일: ${VIEW}`)
    expect(files[LIST]).toContain(`- **detail** ([이전 통과 유지 — 파일 변경 없음](agent/e2e.md#detail))\n  - 할 일: ${CHECKS[0]!.todo}\n  - 기대:\n    - [x] ${CHECKS[0]!.expect}\n`)
    expect(files[LIST]).toContain(`- **mobile**\n  - 할 일: ${CHECKS[1]!.todo}\n`)
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("with 1 check to run")
    const { agentId } = await spawnRunner($)
    expect(spawned.at(-1)!.prompt).toContain("- App: http://localhost:3000")
    expect(await spawnRunner($)).toEqual(refused("every open aside check already has its runner (mobile)"))
    await $.tool.call(runAs(agentId!, asideExec(folderOf("mobile"))))
    expect(context(await $.tool.call(report(agentId!, folderOf("mobile"), S3, "우수회원", "통과")))).toContain("Every aside check passed")
    expect(files[QAI]).toContain(`- 결과: 통과 (이전 통과 유지 — 파일 변경 없음)\n- aside 세션: ${S1}\n- 스크린샷: agent/evidence/detail/1/shot.png\n`)
    expect(files[QAI]).toContain(`- 결과: 통과\n- aside 세션: ${S3}\n`)
  })

  test("a check rein:impact finds untouched comes checked and does not run; with none left, straight to the completion check", async ($, on) => {
    const files = filesNow("w2")
    world(on, files, undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    expect(context(await judgeImpact($, { mobile: "영향 없음" }))).toContain("rein:impact found the change does not touch mobile")
    expect(files[LIST]).toBeUndefined()
    expect(ran.filter(x => x.argv[0] === "aside" || x.argv[0] === "ego-browser")).toHaveLength(0)
    expect(files[QAI]).toContain("(이전 통과 유지 — 코드가 바뀌었지만 영향 없다고 판정 (agent/impact.md))")
    expect(files[QAI]).toContain("\n판정: 통과\n")
    expect(await status($)).toContain("stage: qa-integration\n")
  })

  test("the diff goes from the copy kept as the check passed to the file now", async ($, on) => {
    const w1 = await hashOf("w1")
    const files = { ...filesNow("w2"), [`${DIR}/agent/sealed/${w1}.txt`]: "w1" }
    world(on, files, undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    expect(ran.some(x => x.argv.join(" ") === `git diff --no-index --no-color -U5 -- ${DIR}/agent/sealed/${w1}.txt ${VIEW}`)).toBe(true)
    expect(files[`${DIR}/agent/impact-diff.md`]).toContain(`## ${VIEW}\n\n통과 당시 버전 ${w1.slice(0, 12)}에서 지금까지 — check: mobile\n\n\`\`\`diff\nabc123\n\`\`\``)
  })

  test("without the copy there is no diff, and rein:impact is told the check is touched", async ($, on) => {
    const files = filesNow("w2")
    world(on, files, undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    expect(files[`${DIR}/agent/impact-diff.md`]).toContain("(통과 당시의 사본이 없어 diff를 만들 수 없음: 이 파일에 걸린 check는 영향 있음)")
  })

  test("rein:impact writes only impact.md", async ($, on) => {
    world(on, filesNow("w2"), undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    const { agentId } = (await $.agent.spawn({ tool_use_id: "i", prompt: "p", description: "impact", subagentType: "rein:impact" } as never)) as { agentId?: string }
    expect(await $.tool.call(write(`${DIR}/5-checklist.md`, "x", agentId))).toEqual(refused("rein:impact writes only"))
  })

  test("rein:impact is refused unless work qa waits for it", async ($, on) => {
    world(on, filesNow(), undefined, await retried("w1"), host([]))
    expect(await $.agent.spawn({ tool_use_id: "i", prompt: "p", description: "impact", subagentType: "rein:impact" } as never)).toEqual(refused("rein:impact judges only while work qa waits for it"))
  })

  test("a rein:impact that ended without impact.md: advance runs every check in question", async ($, on) => {
    const files = filesNow("w2")
    world(on, files, undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    await $.agent.spawn({ tool_use_id: "i", prompt: "p", description: "impact", subagentType: "rein:impact" } as never)
    expect(context(await $.tool.call(ADVANCE))).toContain("rein:impact ended without writing impact.md, so every check in question runs again")
    expect(files[LIST]).toContain(`- **mobile**\n  - 할 일: ${CHECKS[1]!.todo}\n`)
  })

  test("a carried check runs again when the user unchecks its box", async ($, on) => {
    const files = filesNow("w2")
    world(on, files, undefined, await retried("w2"), host([]))
    await relay($, ADVANCE)
    await judgeImpact($, { mobile: "영향 있음" })
    files[LIST] = files[LIST]!.replace(`    - [x] ${CHECKS[0]!.expect}`, `    - [ ] ${CHECKS[0]!.expect}`)
    expect(context(await $.tool.call(answer("e2e 실행 (Aside)")))).toContain("with 2 checks to run")
  })

  test("impact.md: a check with no verdict line is touched", () => {
    expect(parseImpact("## 영향 판정\n\n### a\n- 판정: 영향 없음\n- 이유: 다른 탭\n\n### b\n- 판정: 모름\n", ["a", "b", "c"])).toEqual({
      a: { affected: false, why: "다른 탭" },
      b: { affected: true, why: "판정 없음 — impact.md에 이 check의 `- 판정:` 줄이 없음" },
      c: { affected: true, why: "판정 없음 — impact.md에 이 check의 `- 판정:` 줄이 없음" },
    })
  })

  test("a seal keeps a copy of each sealed file by its seal value", async ($, on) => {
    const files: Record<string, string> = { ...filesNow(), "E:/proj/.git/HEAD": "" }
    world(on, files, undefined, { ...(await retried("w1")), stage: "review" }, host([]))
    await $.tool.call({ tool: "mcp__rein__goto", stage: "qa" } as never)
    expect(files[`${DIR}/agent/sealed/${await hashOf("v1")}.txt`]).toBe("v1")
    expect(files[`${DIR}/agent/sealed/${await hashOf("w1")}.txt`]).toBe("w1")
  })

  test("with every check's files unchanged nothing runs: no checklist, no browser, straight to the completion check", async ($, on) => {
    const files = filesNow()
    world(on, files, undefined, await retried("w1"), host([]))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("every check already passed, in this visit or in an earlier one with none of its files changed since")
    expect(files[LIST]).toBeUndefined()
    expect(ran.filter(x => x.argv[0] === "aside" || x.argv[0] === "ego-browser")).toHaveLength(0)
    expect(files[QAI]).toContain("\n판정: 통과\n")
    expect(await status($)).toContain("stage: qa-integration\n")
  })

  test("dev로 보냄 on a failed check keeps the passes for the next visit", async ($, on) => {
    const sealed = { [SRC]: await hashOf("v1"), [VIEW]: await hashOf("w1") }
    world(on, filesNow(), () => "dev로 보냄", { ...RUN, planFiles: [SRC, VIEW], checks: FILED, sealed }, host([ok(out(S1, "우수회원", "통과")), ok(out(S2, "공란", "실패"))]))
    await toAside($)
    await runCheck($, "detail", S1, "우수회원", "통과")
    await runCheck($, "mobile", S2, "공란", "실패")
    await relay($, ADVANCE)
    expect(record()).toMatchObject({ stage: "dev", retries: 0 })
    expect(record().passed?.map(p => p.name)).toEqual(["detail"])
  })

  test("an approved config drops the passes", async ($, on) => {
    const files = filesNow()
    world(on, files, () => "새 config 승인", { ...(await retried("w1")), configHashes: { "E:/proj": await sha256Text(config()) } }, host([]))
    files["E:/proj/.rein/config.json"] = config({ ...E2E, timeout: 20 })
    await relay($, ADVANCE)
    expect(record().passed).toBeUndefined()
  })

  test("a design goto takes again drops the pass of a check it changed", async ($, on) => {
    const PLAN = `${DIR}/2-plan.md`
    const V1 = `## 접근 방법\n\na\n\n## 상세 설계\n\n### src/login.ts\n- 고친다\n- 테스트: tests/login.test.ts\n\n### tests/login.test.ts\n- 본다\n- 테스트: tests/login.test.ts\n\n## e2e 확인\n\n### detail\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: 회원상세\n- 경로: 회원 > 회원관리 > 회원상세\n- 할 일: /member/detail에서 본다\n- 기대: 우수회원\n- 저장: 없음\n${COVER}`
    world(on, { ...filesNow(), "E:/proj/.git/HEAD": "", [PLAN]: V1 }, undefined, { ...(await retried("w1")), stage: "review", frozen: { spec: SPEC_TEXT, plan: V1 } }, host([]))
    await $.tool.call({ tool: "Write", file_path: PLAN, content: V1.replace("에서 본다", "에서 펼치고 본다") } as never)
    expect(record()).toMatchObject({ stage: "review" })
    expect(record().passed).toHaveLength(2)
    await $.tool.call({ tool: "mcp__rein__goto", stage: "qa" } as never)
    expect(record()).toMatchObject({ stage: "qa" })
    expect(record().passed).toBeUndefined()
  })

  // 2-plan.md whose detail check is FILED[0] as it was; `approach` is its 접근 방법.
  const PLAN = `${DIR}/2-plan.md`
  const planWith = (approach: string) => {
    const k = FILED[0]!
    return `## 접근 방법\n\n${approach}\n\n## 상세 설계\n\n### src/login.ts\n- 고친다\n- 테스트: tests/login.test.ts\n\n### tests/login.test.ts\n- 본다\n- 테스트: tests/login.test.ts\n\n## e2e 확인\n\n### ${k.name}\n- 제목: t\n- 구분: 변경\n- 앱: ${k.app}\n- 페이지: ${k.page}\n- 경로: ${k.route}\n- 할 일: ${k.todo}\n- 기대: ${k.expect}\n- 저장: 없음\n- 파일: src/login.ts\n${COVER}`
  }
  // the run in review on planWith("a"), its config frozen as `hash`.
  const reviewed = async (hash: string) => ({ ...(await retried("w1")), stage: "review", configHashes: { "E:/proj": hash }, frozen: { spec: SPEC_TEXT, plan: planWith("a") } })
  // 2-plan.md rewritten with another 접근 방법, and goto takes it.
  const redesign = async ($: Engine) => {
    await $.tool.call({ tool: "Write", file_path: PLAN, content: planWith("b") } as never)
    await $.tool.call({ tool: "mcp__rein__goto", stage: "qa" } as never)
    expect(record()).toMatchObject({ stage: "qa" })
  }

  test("a design goto takes again keeps the pass of a check it gives as it was", async ($, on) => {
    world(on, { ...filesNow(), "E:/proj/.git/HEAD": "", [PLAN]: planWith("a") }, undefined, await reviewed(await sha256Text(config())), host([]))
    await redesign($)
    expect(record().passed?.map(p => p.name)).toEqual(["detail"])
  })

  test("a design goto takes again with a config changed since drops the passes", async ($, on) => {
    world(on, { ...filesNow(), "E:/proj/.git/HEAD": "", [PLAN]: planWith("a") }, undefined, await reviewed("an older hash"), host([]))
    await redesign($)
    expect(record().passed).toBeUndefined()
  })

  const CFG = "E:/proj/.rein/config.json"
  // what the person approved of config(), as the hook keeps it.
  const seen = { "E:/proj": viewOf(readConfig(config())) }

  test("a design goto takes again with only the config's qa commands changed keeps the passes", async ($, on) => {
    const files = { ...filesNow(), "E:/proj/.git/HEAD": "", [PLAN]: planWith("a"), [CFG]: JSON.stringify({ qa: ["npm test", "npm run lint"], e2e: E2E }) }
    world(on, files, undefined, { ...(await reviewed(await sha256Text(config()))), configSeen: seen }, host([]))
    await redesign($)
    expect(record().passed?.map(p => p.name)).toEqual(["detail"])
  })

  test("a design goto takes again with the config's e2e changed drops the passes", async ($, on) => {
    const files = { ...filesNow(), "E:/proj/.git/HEAD": "", [PLAN]: planWith("a"), [CFG]: config({ ...E2E, timeout: 20 }) }
    world(on, files, undefined, { ...(await reviewed(await sha256Text(config()))), configSeen: seen }, host([]))
    await redesign($)
    expect(record().passed).toBeUndefined()
  })

  test("an approved config that changed only the qa commands keeps the passes", async ($, on) => {
    const files = filesNow()
    world(on, files, () => "새 config 승인", { ...(await retried("w1")), configHashes: { "E:/proj": await sha256Text(config()) }, configSeen: seen }, host([]))
    files[CFG] = JSON.stringify({ qa: ["npm run lint"], e2e: E2E })
    expect(await relay($, ADVANCE)).toEqual({ result: "The user approved the current configs.", context: [expect.stringContaining("D50: the configs are frozen")] })
    expect(record().passed?.map(p => p.name)).toEqual(["detail", "mobile"])
  })
})
