import { describe, expect } from "claude-code/testing"
import { readConfig } from "../hooks/lib/config.ts"
import { closeScript, driverTask, egoStartable, judgeTask, MARK, parseJudge, PROBE_SCRIPT, resolveProfiles, roundCommand, roundOutcome, runSpaces, SHOT_PROBE_SCRIPT } from "../hooks/lib/ego.ts"
import { harnessSource, importLine, REOPEN_MARK, TAKEOVER_MARK } from "../hooks/lib/egoHarness.ts"
import { checkConfig, parseChecks, type Check } from "../hooks/lib/parse.ts"
import { checklist } from "../hooks/stages/qaIntegration.ts"
import type { CheckRun } from "../hooks/lib/state.ts"
import { clock, DIR, gitSub, ran, relay, SPEC_TEXT, spawned, store, world, type Host, test } from "./world.ts"

// The ego path of integration qa: the user picks Ego at /rein:e2e, each
// check runs in its ego profile's TaskSpace, a rein:ego-driver drives it in
// rounds through the harness the hook writes, a rein:ego-judge decides it
// from the evidence, part by part, citing files that exist.

const QAI = `${DIR}/agent/e2e.md`
const APPS = { admin: { url: "http://localhost:8090", login: "id/password form; test-pass for every account", profile: "Tester1", profiles: { tester2: "Tester2" } }, mobile: { url: "http://localhost:3000", profile: "Tester1" } }
const E2E = { apps: APPS, production: ["app.example.com"], backends: ["localhost:8080"] }
const CHECKS: Check[] = [
  { name: "detail", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "회원 테스트회원A의 회원유형을 본다", expect: "우수회원만 체크되고 비활성", saves: false, evidence: [{ kind: "측정", text: "회원유형 체크박스의 disabled 수" }] },
  { name: "staff", app: "admin", page: "회원상세", route: "회원 > 회원관리 > 회원상세", todo: "같은 회원을 tester2로 본다", expect: "우수회원", saves: false, account: "tester2" },
]
const RUN = { v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0, planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"], checks: CHECKS }
const PROFILES = [{ id: "Default", name: "Your ego" }, { id: "Profile 1", name: "Tester1" }, { id: "Profile 2", name: "Tester2" }]
const filesWith = (e2e: object = E2E): Record<string, string> => ({ "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"], e2e }), [`${DIR}/1-spec.md`]: SPEC_TEXT })

const STATUS = { tool: "mcp__rein__status" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const answer = (label: string) => ({ tool: "mcp__rein__advance", answer: label }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
type Engine = { tool: { call: (e: never) => Promise<unknown> }; agent: { spawn: (e: never) => Promise<unknown> } }
const status = async ($: Engine) => ((await $.tool.call(STATUS)) as { result: string }).result
const folderOf = (name: string, n = 1) => `${DIR}/agent/evidence/${name}/${n}`
const spawn = async ($: Engine, type: string) => (await $.agent.spawn({ tool_use_id: "s", prompt: "run the next e2e check", description: "e2e", subagentType: type } as never)) as { agentId?: string; deny?: string }
const DRIVER = "rein:ego-driver"
const JUDGE = "rein:ego-judge"
const round = (agentId: string, folder: string, nn: string, body = "await page.goto(\"/\")") => ({ tool: "Write", file_path: `${folder}/round-${nn}.mjs`, content: `${importLine(folder)}\n${body}\n`, agentId }) as never
const runRound = (agentId: string, folder: string, nn: string, more: object = {}) => ({ tool: "Bash", command: `ego-browser nodejs < ${folder}/round-${nn}.mjs`, timeout: 600_000, agentId, ...more }) as never
const judgeMd = (lines: string[], verdict: string) => `## 기대 대조\n\n${lines.join("\n")}\n\n판정: ${verdict}\n`

// what the round does inside ego, by the files it leaves: the hook reads them.
type Effect = (folder: string, nn: string) => void

// ego answering with PROFILES (or not), git and npm passing; each round's
// Bash call plays the next effect, writing what the harness would.
function host(files: Record<string, string>, effects: Effect[], ego: { up: boolean; shot?: string } = { up: true }, more: Host = {}): Host {
  return {
    run: (argv, _cwd, stdin) => {
      if (argv[0] === "ego-browser" && argv[1] === "skill") return ego.up ? { exitCode: 0, stdout: "# ego-browser guide\n" } : { exitCode: 1 }
      if (argv[0] === "ego-browser") {
        if (!ego.up) return { exitCode: 1, stderr: "ego is not running" }
        // a script's console.log goes to stderr (measured, ego-browser 0.6.1.11)
        if (stdin === PROBE_SCRIPT) return { exitCode: 0, stderr: `${MARK}${JSON.stringify(PROFILES)}\n` }
        if (stdin === SHOT_PROBE_SCRIPT) return { exitCode: 0, stderr: `${MARK}${JSON.stringify(ego.shot ? { ok: false, error: ego.shot } : { ok: true })}\n` }
        return { exitCode: 0, stderr: `${MARK}[]\n` }
      }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      return { exitCode: 0, stdout: "ok\n" }
    },
    bash: c => {
      const m = /^ego-browser nodejs < (.+)\/round-(\d{2})\.mjs$/.exec(c)
      if (!m) return undefined
      effects.shift()?.(m[1]!, m[2]!)
      return { result: { stdout: "[rein] ok\n", stderr: "" }, text: "[rein] ok" }
    },
    ...more,
  }
}

// a round that saves a shot and a measurement, then calls done().
const doneRound = (files: Record<string, string>): Effect => (folder, nn) => {
  files[`${folder}/round-${nn}.log`] = "{}\n"
  files[`${folder}/round-${nn}-shot-1.png`] = ""
  files[`${folder}/round-${nn}-measure-1.json`] = "{}"
  files[`${folder}/round-${nn}-done.json`] = JSON.stringify({ summary: "우수회원만 체크, disabled 3" })
}

// the work qa passes and the run waits; the user picks Ego.
async function toEgo($: Engine): Promise<unknown> {
  await relay($, ADVANCE)
  return $.tool.call(answer("e2e 실행 (Ego)"))
}

// a driver drives check `name` to done() in one round; the judge passes it.
async function passCheck($: Engine, name: string): Promise<unknown> {
  const { agentId } = await spawn($, DRIVER)
  const folder = folderOf(name)
  await $.tool.call(round(agentId!, folder, "01"))
  await $.tool.call(runRound(agentId!, folder, "01"))
  const judge = await spawn($, JUDGE)
  return $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: judgeMd(["- 우수회원만 체크: 통과 — round-01-shot-1.png", "- 비활성: 통과 — round-01-measure-1.json 의 disabled 3"], "통과"), agentId: judge.agentId } as never)
}

describe("the ego path's pieces", () => {
  test("a check may name evidence a screenshot cannot show, each line a kind and what", () => {
    const one = "## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: p\n- 경로: a > b\n- 할 일: x\n- 기대: y\n- 저장: 없음\n"
    expect(parseChecks(`${one}- 증거: 측정 — option 수\n- 증거: 앱 상태 - 그리드 전체 행\n`)).toEqual({
      checks: [{ name: "a", title: "t", kind: "변경", app: "admin", page: "p", route: "a > b", todo: "x", expect: "y", saves: false, evidence: [{ kind: "측정", text: "option 수" }, { kind: "앱 상태", text: "그리드 전체 행" }] }],
    })
    expect((parseChecks(`${one}- 증거: 사진 — 화면\n`) as { reason: string }).reason).toContain("a has `- 증거: 사진 — 화면`, not `<kind> — <what>` with a kind of 측정, 앱 상태, 서버 응답, 네트워크, 콘솔, 다운로드, snapshot")
  })

  test("config apps carry an ego profile and one per account; a malformed one is refused", () => {
    expect(readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e?.apps.admin).toEqual(APPS.admin)
    const bad = (app: object) => checkConfig(JSON.stringify({ qa: ["t"], e2e: { apps: { admin: { url: "http://x", ...app } }, production: [], backends: [] } }))
    expect(bad({ profile: "" })).toContain("`e2e.apps.admin.profile` must be an ego profile name")
    expect(bad({ profiles: { tester2: 3 } })).toContain("`e2e.apps.admin.profiles` must map each account to an ego profile name")
    expect(bad({ profile: "Tester1", profiles: { tester2: "Tester2" } })).toBeUndefined()
  })

  test("each check maps to its account's profile, else the app's; what is missing is named", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    expect(resolveProfiles(e2e, CHECKS, PROFILES)).toEqual({ ids: { detail: "Profile 1", staff: "Profile 2" } })
    const missing = resolveProfiles({ ...e2e, apps: { admin: { url: "http://x", profile: "Nobody" } } }, CHECKS, PROFILES)
    expect(missing).toEqual({ missing: ["check detail: ego has no profile named Nobody", "check staff: account tester2 has no profile in e2e.apps.admin.profiles"] })
  })

  test("drivers run side by side unless one saves; one profile only as one account", () => {
    const k = (name: string, profile: string, more: Partial<CheckRun> = {}): CheckRun => ({ name, minutes: 30, spent: 0, ego: { profile, space: `s-${name}`, spentMs: 0 }, ...more })
    expect(egoStartable([k("a", "P1"), k("b", "P2", { account: "x" }), k("c", "P1")]).map(x => x.name)).toEqual(["a", "b", "c"])
    expect(egoStartable([k("a", "P1"), k("b", "P1", { account: "x" }), k("c", "P2")]).map(x => x.name)).toEqual(["a"])
    expect(egoStartable([k("a", "P1"), k("b", "P2", { saves: true })]).map(x => x.name)).toEqual(["a"])
    expect(egoStartable([k("a", "P1", { runner: "d1", ego: { profile: "P1", space: "s", spentMs: 0, driven: "x" } }), k("b", "P2", { saves: true })]).map(x => x.name)).toEqual(["b"])
  })

  test("a check awaiting its judge holds its profile's account: the judge may send its driver back", () => {
    const k = (name: string, profile: string, more: Partial<CheckRun> = {}): CheckRun => ({ name, minutes: 30, spent: 0, ego: { profile, space: `s-${name}`, spentMs: 0 }, ...more })
    const judging = k("a", "P1", { runner: "d1", ego: { profile: "P1", space: "s-a", spentMs: 0, driven: "x" } })
    expect(egoStartable([judging, k("b", "P1", { account: "x" }), k("c", "P2")]).map(x => x.name)).toEqual([])
    expect(egoStartable([judging, k("b", "P1"), k("c", "P2", { account: "x" })]).map(x => x.name)).toEqual(["b", "c"])
    expect(egoStartable([{ ...judging, verdict: "통과" }, k("b", "P1", { account: "x" })]).map(x => x.name)).toEqual(["b"])
  })

  test("a saving check awaiting its judge keeps every other check from starting: its driver may save again", () => {
    const k = (name: string, profile: string, more: Partial<CheckRun> = {}): CheckRun => ({ name, minutes: 30, spent: 0, ego: { profile, space: `s-${name}`, spentMs: 0 }, ...more })
    const judging = k("a", "P1", { saves: true, runner: "d1", ego: { profile: "P1", space: "s-a", spentMs: 0, driven: "x" } })
    expect(egoStartable([judging, k("b", "P2", { saves: true })]).map(x => x.name)).toEqual([])
    expect(egoStartable([judging, k("b", "P2"), k("c", "P1")]).map(x => x.name)).toEqual([])
    expect(egoStartable([{ ...judging, verdict: "통과" }, k("b", "P2", { saves: true })]).map(x => x.name)).toEqual(["b"])
  })

  test("a round runs only as ego-browser nodejs < its folder's round file", () => {
    const f = "C:/r/evidence/a/1"
    expect(roundCommand(`ego-browser nodejs < ${f}/round-03.mjs`, f, "E:/proj")).toEqual({ file: `${f}/round-03.mjs`, round: "03" })
    expect(roundCommand(`ego-browser nodejs < "${f}/round-03.mjs"`, f, "E:/proj")).toEqual({ file: `${f}/round-03.mjs`, round: "03" })
    expect(roundCommand(`ego-browser nodejs < ${f}/round-03.mjs; rm x`, f, "E:/proj")).toEqual(refused("check rounds run only as"))
    expect(roundCommand(`ego-browser nodejs < C:/r/evidence/b/1/round-03.mjs`, f, "E:/proj")).toEqual(refused("is not a round file of that folder"))
    expect(roundCommand(`ego-browser nodejs -e "x"`, f, "E:/proj")).toEqual(refused("check rounds run only as"))
    const other = roundCommand(`cp ${f}/a ${f}/b`, f, "E:/proj")
    expect(other).toEqual(refused("check rounds run only as"))
    for (const said of ["Bash runs nothing else. To change a round, Write the next round-NN.mjs whole.", "use Glob, Grep and Read, or a read-only command (cat, head, tail, grep, sed -n", "print less in the round itself", "(`new Date()`, `page.waitForTimeout(ms)`)"]) expect(other).toEqual(refused(said))
  })

  test("a round's output: the user holds the space, a script error, or it ran", () => {
    expect(roundOutcome("Control of this task space is with the user ... takeOverTaskSpace(3)")).toEqual({ kind: "user" })
    expect(roundOutcome("TypeError: x\n\nego's nodejs process exited with code 1.")).toEqual({ kind: "error", code: 1 })
    expect(roundOutcome("[rein] saved round-01-shot-1.png")).toEqual({ kind: "ok" })
    expect(roundOutcome("CdpRequestTimeoutError: CDP request timed out: Network.enable\n\nego's nodejs process exited with code 1.")).toEqual({ kind: "ego" })
  })

  test("the judge's parts make the verdict; a pass cites a file of the folder, or the judge writes it again", () => {
    const has = (n: string) => ["round-01-shot-1.png", "round-01-measure-1.json"].includes(n)
    expect(parseJudge(judgeMd(["- 보인다: 통과 — round-01-shot-1.png", "- 3개: 통과 — round-01-measure-1.json"], "통과"), has)).toEqual({ parts: ["보인다: 통과 — round-01-shot-1.png", "3개: 통과 — round-01-measure-1.json"], verdict: "통과", cited: ["round-01-shot-1.png", "round-01-measure-1.json"] })
    expect(parseJudge(judgeMd(["- 보인다: 통과 — 화면에 보였다"], "통과"), has)).toEqual({ problem: expect.stringContaining('"보인다" passed with no evidence file cited') })
    expect(parseJudge(judgeMd(["- 보인다: 통과 — round-02-shot-1.png"], "통과"), has)).toEqual({ problem: expect.stringContaining('"보인다" cites round-02-shot-1.png, which is not in the check\'s folder') })
    expect(parseJudge(judgeMd(["- 보인다: 통과 — round-01-shot-1.png", "- 3개: 증거 부족 — option 수를 세지 않음"], "증거 부족"), has)).toMatchObject({ verdict: "증거 부족", missing: "3개: option 수를 세지 않음" })
    expect(parseJudge(judgeMd(["- 보인다: 실패 — round-01-shot-1.png"], "통과"), has)).toEqual({ problem: expect.stringContaining("판정: 통과 does not follow from the parts, which make it 실패") })
    expect(parseJudge("판정: 통과\n", has)).toEqual({ problem: expect.stringContaining("judge.md needs `## 기대 대조`") })
  })

  test("a check that changes the screen has its layout measured and judged; a 대조 check does not", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const k: CheckRun = { name: "detail", minutes: 30, spent: 0 }
    const base = CHECKS[0] as Check
    const tasks = (check: Check) => [driverTask(e2e, check, k, "f", undefined, 1000), judgeTask(check, k, "f", "f/judge.md", undefined)]
    const [drive, judge] = tasks({ ...base, kind: "변경" })
    expect(drive).toContain("one measure noted `레이아웃`")
    expect(judge).toContain("add one more part, `레이아웃`")
    expect(judge).toContain("wider than its widest content plus 60px")
    expect(judge).toContain("differ by more than 3px")
    expect(judge).toContain("Judge only what the expected parts say appears or changes on the screen (a new or changed field, button, column, link); an element the task only uses (clicks, fills, uploads into) keeps the size and columns it had before this change, so note its defect in its line without failing it. When the expected parts name nothing on the screen, `레이아웃` is 통과.")
    expect(judge).not.toContain("Judge only the elements the task or the expected parts are about")
    expect(judge).toContain("only about a printed or downloaded file, `레이아웃` is 통과")
    expect(tasks(base).join(" ")).toContain("`레이아웃`")
    expect(tasks({ ...base, kind: "대조" }).join(" ")).not.toContain("레이아웃")
  })

  test("the judge counts only evidence recorded on the check's app address, and the driver opens that address", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const k: CheckRun = { name: "detail", minutes: 30, spent: 0 }
    const check = CHECKS[0] as Check
    const url = e2e.apps[check.app]!.url
    const judge = judgeTask(check, k, "f", "f/judge.md", undefined, url)
    expect(judge).toContain(`- App: ${url}`)
    expect(judge).toContain("A part counts only from evidence recorded on this app: the url in round-NN.log after each action starts with the app's address above (scheme, host and port).")
    expect(judgeTask(check, k, "f", "f/judge.md", undefined)).not.toContain("- App:")
    expect(driverTask(e2e, check, k, "f", undefined, 1000)).toContain("Open the app at the App address above (another port on the same host is another app, even when the data conditions name it)")
    expect(driverTask(e2e, { ...check, data: "a row with no order" }, k, "f", undefined, 1000)).toContain("Open the app at the App address above (another port on the same host is another app, even when the data conditions name it)")
  })

  test("the judge reads the last round first and finds no evidence missing before reading every round's log", () => {
    const judge = judgeTask(CHECKS[0] as Check, { name: "detail", minutes: 30, spent: 0 }, "f", "f/judge.md", undefined)
    expect(judge).toContain("Start with the last round's log")
    expect(judge).toContain("only after reading every round's log")
  })

  test("a dialog is handled in the round that opens it", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const drive = driverTask(e2e, CHECKS[0] as Check, { name: "detail", minutes: 30, spent: 0 }, "f", undefined, 1000)
    expect(drive).toContain("in the same round")
    expect(drive).toContain("a confirm counts as cancelled")
    expect(drive).toContain("When a part says something does not happen (a window does not open, only an alert shows), do the action and, in the same round, wait a few seconds, then for each page pages() lists save a measure noted with what must not appear")
  })

  test("a check's account wins over an account the app's login names", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: { ...E2E, apps: { ...APPS, admin: { ...APPS.admin, login: "tester / test-pass (one password for every account)" } } } })).e2e!
    const drive = driverTask(e2e, { ...CHECKS[0], account: "tester2" } as Check, { name: "detail", minutes: 30, spent: 0 }, "f", undefined, 1000)
    expect(drive).toContain("- Log in: tester / test-pass (one password for every account)\n")
    expect(drive).toContain("- Account: tester2 (log in as this account, even where the login above names another; the rest of the login still applies)\n")
  })

  test("a snapshot ref is not reused from an earlier round", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const drive = driverTask(e2e, CHECKS[0] as Check, { name: "detail", minutes: 30, spent: 0 }, "f", undefined, 1000)
    expect(drive).toContain("never reuse one from an earlier round")
  })

  test("a role locator takes a name, and `>> nth=N` never follows one", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const drive = driverTask(e2e, CHECKS[0] as Check, { name: "detail", minutes: 30, spent: 0 }, "f", undefined, 1000)
    expect(drive).toContain("A `loc=role:` always takes a name, `[name=\"...\"]` or `[name*=\"...\"]`, and `>> nth=N` follows only a CSS, `text=` or href selector, never a `loc=role:`.")
  })

  test("a dialog is handled at once in its window; the harness logs its type and text, and the judge reads its text there", () => {
    expect(harnessSource({ folder: "f", space: "s", profile: "p", app: "http://localhost", production: [] })).toContain("dialog: { type: d.type, message: d.message }")
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const k: CheckRun = { name: "detail", minutes: 30, spent: 0 }
    const drive = driverTask(e2e, CHECKS[0] as Check, k, "f", undefined, 1000)
    expect(drive).toContain("in the window it opened in")
    expect(drive).toContain("records the dialog's type and text in the round's log")
    expect(judgeTask(CHECKS[0] as Check, k, "f", "f/judge.md", undefined)).toContain("a dialog's text from its `dialog` in round-NN.log")
  })

  test("the run's spaces are its checks' attempts, not another run's", () => {
    const re = new RegExp(runSpaces("a", ["detail", "x-y"]))
    expect(["rein-a-detail-1", "rein-a-x-y-12"].every(n => re.test(n))).toBe(true)
    expect(["rein-a-b-detail-1", "rein-a-detail-", "rein-ab-detail-1", "rein-a-detail-1x"].some(n => re.test(n))).toBe(false)
    expect(closeScript(runSpaces("a", ["detail"]))).toContain("finish({ keep: [] })")
  })
})

describe("running checks in ego", () => {
  test("Ego runs each check in its profile's space: a driver drives, a judge passes it, and the hook writes ## e2e", async ($, on) => {
    const files = filesWith()
    world(on, files, () => undefined, RUN, host(files, [doneRound(files), doneRound(files)]))
    expect(context(await toEgo($))).toContain("D56: the user asked for e2e. The run is now in the qa-integration stage, ego path, with 2 checks to run")
    expect(files[`${DIR}/agent/evidence/ego-guide.md`]).toContain("ego-browser guide")
    const text = await status($)
    expect(text).toContain("e2e: ego")
    expect(text).toContain("e2e check detail: waiting for a rein:ego-driver, space rein-login-fix-detail-1")
    expect(text).toContain("e2e drivers to spawn now: 2 rein:ego-driver")
    const { agentId } = await spawn($, DRIVER)
    expect(agentId).toBe("agent-rein:ego-driver")
    const task = spawned.find(s => s.type === DRIVER)!
    expect(task.background).toBe(true)
    expect(task.prompt).toContain(importLine(folderOf("detail")))
    expect(task.prompt).toContain("- Evidence the plan asks for: 측정 — 회원유형 체크박스의 disabled 수")
    expect(task.prompt).toContain("`CdpRequestTimeoutError` is ego not answering, not your script: the hook's result says what to do.")
    expect(task.prompt).toContain("read-only command")
    expect(files[`${folderOf("detail")}/harness.mjs`]).toContain('"space":"rein-login-fix-detail-1","profile":"Profile 1"')
    expect(files[`${folderOf("detail")}/harness.mjs`]).toContain('"production":["app.example.com"]')
    // only round files, each starting with the harness import
    expect(await $.tool.call({ tool: "Write", file_path: `${folderOf("detail")}/round-01-shot-1.png`, content: "", agentId } as never)).toEqual(refused("writes only round files"))
    expect(await $.tool.call({ tool: "Write", file_path: `${folderOf("detail")}/round-01.mjs`, content: "const t = await taskSpace(\"x\")\n", agentId } as never)).toEqual(refused("a round's first line must be the harness import"))
    await $.tool.call(round(agentId!, folderOf("detail"), "01"))
    expect(await $.tool.call(runRound(agentId!, folderOf("detail"), "01", { timeout: undefined }))).toEqual(refused("give the round a Bash timeout"))
    expect(await $.tool.call(runRound(agentId!, folderOf("detail"), "01", { run_in_background: true }))).toEqual(refused("run the round in the foreground"))
    expect(await $.tool.call({ tool: "Bash", command: `ego-browser nodejs -e "await taskSpace(1)"`, timeout: 600_000, agentId } as never)).toEqual(refused("check rounds run only as"))
    expect(context(await $.tool.call(runRound(agentId!, folderOf("detail"), "01")))).toContain("The hook recorded done() for check detail; its time stops. Stop now and answer `완료: 우수회원만 체크, disabled 3`")
    expect(await $.tool.call(runRound(agentId!, folderOf("detail"), "01"))).toEqual(refused("you called done() for check detail"))
    expect(await status($)).toContain("e2e judges to spawn now: 1 rein:ego-judge")
    const judge = await spawn($, JUDGE)
    const judgeTask = spawned.find(s => s.type === JUDGE)!.prompt!
    expect(judgeTask).toContain(`The evidence is in ${folderOf("detail")}`)
    expect(judgeTask).toContain("- The driver's summary (a claim, not evidence): 우수회원만 체크, disabled 3")
    expect(await $.tool.call({ tool: "Write", file_path: `${folderOf("detail")}/judge.md`, content: "x", agentId: judge.agentId, extra: 1 } as never)).toMatchObject({ context: [expect.stringContaining("judge.md needs `## 기대 대조`")] })
    // a pass that cites no file is the judge's to fix, not the check's failure.
    const uncited = await $.tool.call({ tool: "Write", file_path: `${folderOf("detail")}/judge.md`, content: judgeMd(["- 우수회원만 체크: 통과 — 화면에 보였다", "- 비활성: 통과 — round-01-measure-1.json 의 disabled 3"], "통과"), agentId: judge.agentId, extra: 2 } as never)
    expect(context(uncited)).toContain('"우수회원만 체크" passed with no evidence file cited')
    expect(context(uncited)).toContain("Write it again.")
    const passed = await $.tool.call({ tool: "Write", file_path: `${folderOf("detail")}/judge.md`, content: judgeMd(["- 우수회원만 체크: 통과 — round-01-shot-1.png", "- 비활성: 통과 — round-01-measure-1.json 의 disabled 3"], "통과"), agentId: judge.agentId } as never)
    expect(context(passed)).toContain("check detail: 판정: 통과. Other ego checks are still open")
    // with staff still open, e2e.md already holds detail's verdict.
    expect(files[QAI]).toContain("방법: ego에서 rein:ego-driver가 조작하고, rein:ego-judge가 증거 파일로 판정함")
    expect(files[QAI]).toContain("- 결과: 통과\n- ego 스페이스: rein-login-fix-detail-1\n")
    expect(files[QAI]).toContain("### staff\n")
    expect(files[QAI]).toContain("- 결과: 진행 중\n")
    expect(files[QAI]).toContain("판정: 미정\n")
    // a passed check's space is closed
    expect(ran.some(r => r.argv[0] === "ego-browser")).toBe(true)
    expect(context(await passCheck($, "staff"))).toContain("Every ego check passed; the hook wrote ## e2e")
    expect(files[QAI]).toContain("방법: ego에서 rein:ego-driver가 조작하고, rein:ego-judge가 증거 파일로 판정함")
    expect(files[QAI]).toContain("- ego 스페이스: rein-login-fix-detail-1\n- 스크린샷: agent/evidence/detail/1/round-01-shot-1.png\n- 증거: agent/evidence/detail/1/round-01-shot-1.png, agent/evidence/detail/1/round-01-measure-1.json\n")
    expect(files[`${DIR}/5-checklist.md`]).toContain("- **detail** ([ego 통과](agent/evidence/detail/1/judge.md))\n  - 계정: 따로 없음 — admin 앱의 login 설정대로\n  - 할 일: 회원 테스트회원A의 회원유형을 본다\n  - 기대:\n    - [x] 우수회원만 체크되고 비활성\n")
    const run = store.get("runs:proj/login-fix") as { browser?: string; e2e: { checks: CheckRun[] } }
    expect(run.browser).toBe("ego")
    expect(run.e2e.checks.map(k => [k.name, k.ego?.profile, k.verdict])).toEqual([["detail", "Profile 1", "통과"], ["staff", "Profile 2", "통과"]])
  })

  test("ego not answering halts the run; Aside로 실행 runs it in Aside instead", async ($, on) => {
    const files = filesWith()
    const ego = { up: false }
    world(on, files, () => undefined, RUN, host(files, [], ego))
    expect(context(await toEgo($))).toContain("ego-unavailable: the user asked for e2e, but `ego-browser nodejs` did not answer")
    expect(await status($)).toContain("halt: ego-unavailable")
    const asked = (await $.tool.call(ADVANCE)) as { result: string }
    expect(asked.result).toContain('"Ego를 켰음, 다시 확인", "Aside로 실행", "e2e 없이 진행"')
    expect(await $.tool.call(answer("Ego를 켰음, 다시 확인"))).toEqual(refused("ego-unavailable: still the same"))
    const aside = await $.tool.call(answer("Aside로 실행"))
    expect(context(aside)).toContain("aside path, with 2 checks to run")
    expect((store.get("runs:proj/login-fix") as { browser?: string }).browser).toBe("aside")
  })

  test("a test screenshot failing (ego's window closed or minimized) halts the run until it works", async ($, on) => {
    const files = filesWith()
    const ego = { up: true, shot: "CDP request timed out: Page.captureScreenshot" }
    world(on, files, () => undefined, RUN, host(files, [], ego))
    expect(context(await toEgo($))).toContain("ego-unavailable: the user asked for e2e, but a test screenshot in ego failed (CDP request timed out: Page.captureScreenshot): ego's window is closed or minimized")
    expect(((await $.tool.call(ADVANCE)) as { result: string }).result).toContain("ego 창이 닫혔거나 최소화됨")
    expect(await $.tool.call(answer("Ego를 켰음, 다시 확인"))).toEqual(refused("ego-unavailable: still the same"))
    ego.shot = ""
    expect(context(await $.tool.call(answer("Ego를 켰음, 다시 확인")))).toContain("ego path, with 2 checks to run")
  })

  test("a check with no ego profile halts before anything runs (ego-profile-missing)", async ($, on) => {
    const files = filesWith({ ...E2E, apps: { ...APPS, admin: { ...APPS.admin, profiles: {} } } })
    world(on, files, () => undefined, RUN, host(files, []))
    expect(context(await toEgo($))).toContain("ego-profile-missing: the user asked for e2e, but the ego profiles are not set up: check staff: account tester2 has no profile in e2e.apps.admin.profiles")
    expect(((await $.tool.call(ADVANCE)) as { result: string }).result).toContain('"rein:setup으로 채웠음, 다시 확인", "Aside로 실행", "e2e 없이 진행"')
    files["E:/proj/.rein/config.json"] = JSON.stringify({ qa: ["npm test"], e2e: E2E })
    await relay($, ADVANCE)
    await $.tool.call(answer("새 config 승인"))
    expect(context(await $.tool.call(answer("rein:setup으로 채웠음, 다시 확인")))).toContain("ego path, with 2 checks to run")
  })

  test("a hand-off stops the check's clock and waits for the user; the driver resumes, or the user takes the check", async ($, on) => {
    const files = filesWith()
    const handoff: Effect = (folder, nn) => { files[`${folder}/round-${nn}-handoff.json`] = JSON.stringify({ what: "2FA 코드를 입력" }) }
    world(on, files, () => undefined, RUN, host(files, [handoff, doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    expect(context(await $.tool.call(runRound(agentId!, folder, "01")))).toContain("Stop now and answer `넘김: 2FA 코드를 입력`")
    expect(await status($)).toContain("e2e hand-off: check detail's space rein-login-fix-detail-1 waits for the user: 2FA 코드를 입력")
    await $.tool.call(round(agentId!, folder, "02"))
    expect(await $.tool.call(runRound(agentId!, folder, "02"))).toEqual(refused("check detail's space is handed to the user (2FA 코드를 입력)"))
    await clock.advance(40 * 60_000)
    expect(((await $.tool.call(ADVANCE)) as { result: string }).result).toContain('"끝냈음, 이어서", "이 check는 사람이 확인"')
    expect(context(await $.tool.call(answer("끝냈음, 이어서")))).toContain(`Resume its rein:ego-driver ${agentId} with SendMessage`)
    expect(files[`${folder}/${TAKEOVER_MARK}`]).toBe("")
    // the 40 minutes handed off did not count
    expect(context(await $.tool.call(runRound(agentId!, folder, "02")))).toContain("The hook recorded done() for check detail")
  })

  test("the user may take a handed-off check by hand: once the rest pass, the run waits for them again", async ($, on) => {
    const files = filesWith()
    const handoff: Effect = (folder, nn) => { files[`${folder}/round-${nn}-handoff.json`] = JSON.stringify({ what: "파일 선택" }) }
    world(on, files, () => undefined, RUN, host(files, [handoff, doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    await $.tool.call(round(agentId!, folderOf("detail"), "01"))
    await $.tool.call(runRound(agentId!, folderOf("detail"), "01"))
    expect(context(await $.tool.call(answer("이 check는 사람이 확인")))).toContain("Other ego checks are still open")
    expect(context(await passCheck($, "staff"))).toContain("the checks the user takes by hand are left. The run waits for them again (e2e: wait)")
    expect(await status($)).toContain("e2e: wait")
    expect(files[`${DIR}/5-checklist.md`]).toContain("- **detail**\n  - 계정: 따로 없음 — admin 앱의 login 설정대로\n  - 할 일: 회원 테스트회원A의 회원유형을 본다\n  - 기대:\n    - [ ] 우수회원만 체크되고 비활성\n")
    expect(files[`${DIR}/5-checklist.md`]).toContain("    - [x] 우수회원\n")
  })

  test("evidence missing goes back to the driver once; missing again is 실패 and halts the run (D173)", async ($, on) => {
    const files = filesWith()
    world(on, files, () => undefined, RUN, host(files, [doneRound(files), doneRound(files), doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    await $.tool.call(runRound(agentId!, folder, "01"))
    const short = judgeMd(["- 우수회원만 체크: 통과 — round-01-shot-1.png", "- 비활성: 증거 부족 — disabled를 재지 않음"], "증거 부족")
    const j1 = await spawn($, JUDGE)
    expect(context(await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: short, agentId: j1.agentId } as never))).toContain("증거 부족, the first time, so it goes back to its driver")
    expect(await status($)).toContain(`e2e missing evidence: send rein:ego-driver ${agentId} of check detail with SendMessage what its judge found missing: 비활성: disabled를 재지 않음`)
    await $.tool.call(round(agentId!, folder, "02"))
    expect(context(await $.tool.call(runRound(agentId!, folder, "02")))).toContain("recorded done()")
    const firstJudge = spawned.filter(s => s.type === JUDGE)[0]!.prompt!
    expect(firstJudge).not.toContain("An earlier judge of this check")
    const j2 = await spawn($, JUDGE)
    const secondJudge = spawned.filter(s => s.type === JUDGE)[1]!.prompt!
    expect(secondJudge).toContain("An earlier judge of this check found evidence missing")
    expect(secondJudge).toContain("\n- 우수회원만 체크: 통과 — round-01-shot-1.png\n- 비활성: 증거 부족 — disabled를 재지 않음\n")
    expect(secondJudge).toContain("decide again only the parts it found 증거 부족")
    expect(context(await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: short, agentId: j2.agentId } as never))).toContain("check detail: 판정: 실패 (증거 부족 a second time counts as 실패)")
    await passCheck($, "staff")
    const run = store.get("runs:proj/login-fix") as { halt?: { rule: string } }
    expect(run.halt?.rule).toBe("D173")
    expect(files[QAI]).toContain("(증거 부족이 두 번째라 실패로 봄)")
    // the user sends it to dev: the run's spaces are closed as it leaves
    ran.length = 0
    await $.tool.call(answer("dev로 보냄"))
    expect(ran.filter(r => r.argv[0] === "ego-browser")).toHaveLength(1)
  })

  test("a check whose only failed part is 레이아웃 still covers its parts of the completion line (D173)", async ($, on) => {
    const files = { ...filesWith(), [`${DIR}/2-plan.md`]: '## 완료 판정 덮기\n\n- "우수회원만 체크" — e2e: detail\n' }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "그대로 멈춤"), RUN, host(files, [doneRound(files), doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    await $.tool.call(runRound(agentId!, folder, "01"))
    const judge = await spawn($, JUDGE)
    await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: judgeMd(["- 우수회원만 체크: 통과 — round-01-shot-1.png", "- 레이아웃: 실패 — 그리드 열 합 1605 > 컨테이너 1296"], "실패"), agentId: judge.agentId } as never)
    await passCheck($, "staff")
    await relay($, ADVANCE)
    expect(questions[0]).toContain("이 경우 확인되지 않는 조각: 없음")
    expect(questions[0]).toContain("레이아웃만 실패한 항목은 기대가 근거로 남습니다")
  })

  test("a driver resumed with SendMessage goes on with its own check and takes no other", async ($, on) => {
    const files = filesWith()
    world(on, files, () => undefined, RUN, host(files, [doneRound(files), doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    await $.tool.call(runRound(agentId!, folder, "01"))
    const j1 = await spawn($, JUDGE)
    await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: judgeMd(["- 우수회원만 체크: 통과 — round-01-shot-1.png", "- 비활성: 증거 부족 — disabled를 재지 않음"], "증거 부족"), agentId: j1.agentId } as never)
    // the engine raises a resume as agent.spawn, under the driver's own id
    const resume = (id: string) => $.agent.spawn({ tool_use_id: "m", prompt: "빠진 것: disabled 수", description: "e2e", subagentType: DRIVER, resume: { agentId: id } } as never) as Promise<{ agentId?: string; deny?: string }>
    expect(await resume(agentId!)).toEqual({ model: "m", agentId })
    const checks = (store.get("runs:proj/login-fix") as { e2e: { checks: CheckRun[] } }).e2e.checks
    expect(checks.map(k => [k.name, k.runner])).toEqual([["detail", agentId], ["staff", undefined]])
    expect(await status($)).toContain("e2e drivers to spawn now: 1 rein:ego-driver")
    await $.tool.call(round(agentId!, folder, "02"))
    expect(context(await $.tool.call(runRound(agentId!, folder, "02")))).toContain("The hook recorded done() for check detail")
    // a driver with no open check is not resumed
    expect(await resume("agent-gone")).toEqual(refused("agent-gone drives no open ego check now"))
  })

  test("past the check's time a round is refused, its space closed and the check closed with no verdict (D101)", async ($, on) => {
    const files = filesWith()
    world(on, files, () => undefined, RUN, host(files, [() => undefined, doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    expect(context(await $.tool.call(runRound(agentId!, folder, "01")))).toContain("The round ran. Write the next round")
    await $.tool.call(round(agentId!, folder, "02"))
    expect(await $.tool.call(runRound(agentId!, folder, "01"))).toEqual(refused("run the newest round, round-02.mjs"))
    await clock.advance(31 * 60_000)
    expect(await $.tool.call(runRound(agentId!, folder, "02"))).toEqual(refused("check detail ran past its 30 minutes and is closed with no verdict; the hook closed its ego space"))
    await passCheck($, "staff")
    expect((store.get("runs:proj/login-fix") as { halt?: { rule: string; reason: string } }).halt).toEqual({ rule: "D101", reason: "check detail ran past its 30 minutes" })
  })

  test("a lost space starts a new attempt once; a round past its Bash timeout has its space closed and reopened", async ($, on) => {
    const files = filesWith()
    const lost: Effect = (folder, nn) => { files[`${folder}/round-${nn}-lost.json`] = "{}" }
    world(on, files, () => undefined, RUN, host(files, [lost], { up: true }, {
      bash: c => (c.endsWith("/2/round-01.mjs") ? { result: { stdout: "", stderr: "", timedOutAfterMs: 600_000 }, text: "timed out", isError: true } : c.startsWith("ego-browser") ? (lost(c.replace(/^ego-browser nodejs < (.+)\/round-\d{2}\.mjs$/, "$1"), "01"), { result: "ok", text: "ok" }) : undefined),
    }))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    await $.tool.call(round(agentId!, folderOf("detail"), "01"))
    const fresh = context(await $.tool.call(runRound(agentId!, folderOf("detail"), "01")))
    expect(fresh).toContain(`The hook started attempt 2 in a new space: write round-01.mjs in ${folderOf("detail", 2)}`)
    expect(files[`${folderOf("detail", 2)}/harness.mjs`]).toContain('"space":"rein-login-fix-detail-2"')
    await $.tool.call(round(agentId!, folderOf("detail", 2), "01"))
    expect(context(await $.tool.call(runRound(agentId!, folderOf("detail", 2), "01")))).toContain("The round ran past its Bash timeout")
    expect(files[`${folderOf("detail", 2)}/${REOPEN_MARK}`]).toBe("")
  })

  test("a driver reads with read-only commands, nothing else; ego not answering (CDP timeout) reruns the same round once, then the space is lost", async ($, on) => {
    const files = filesWith()
    const said = "CdpRequestTimeoutError: CDP request timed out: Network.enable\n\nego's nodejs process exited with code 1."
    world(on, files, () => undefined, RUN, host(files, [], { up: true }, { bash: c => (c.startsWith("ego-browser") ? { result: { stdout: said, stderr: "" }, text: said, isError: true } : undefined) }))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    const bash = (command: string) => $.tool.call({ tool: "Bash", command, agentId } as never) as Promise<{ deny?: string }>
    expect((await bash(`grep -n goto ${folder}/round-01.mjs`)).deny).toBeUndefined()
    expect((await bash(`cat ${folder}/round-01.mjs | head -5`)).deny).toBeUndefined()
    for (const command of [`cp ${folder}/round-01.mjs ${folder}/round-02.mjs`, "sleep 5", `echo x > ${folder}/x.txt`, `cd ${folder}`]) expect(await bash(command)).toEqual(refused("Bash runs nothing else. To change a round, Write the next round-NN.mjs whole."))
    const first = context(await $.tool.call(runRound(agentId!, folder, "01")))
    expect(first).toContain("ego did not answer as the harness opened the space (CDP timeout); this is not your code, so do not change it. Run the same round file again.")
    expect(first).not.toContain("an error in your code")
    const again = context(await $.tool.call(runRound(agentId!, folder, "01")))
    expect(again).toContain(`The hook started attempt 2 in a new space: write round-01.mjs in ${folderOf("detail", 2)}`)
    await $.tool.call(round(agentId!, folderOf("detail", 2), "01"))
    expect(context(await $.tool.call(runRound(agentId!, folderOf("detail", 2), "01")))).toContain("Run the same round file again.")
    expect(context(await $.tool.call(runRound(agentId!, folderOf("detail", 2), "01")))).toContain("so the check is closed with no verdict")
  })

  test("in a check that saves, ego not answering (CDP timeout) may come after a save: no rerun, the space is closed and a new attempt starts; a second loss closes the check", async ($, on) => {
    const files = filesWith()
    const said = "CdpRequestTimeoutError: CDP request timed out: Network.enable\n\nego's nodejs process exited with code 1."
    const saving = { ...RUN, checks: [{ ...CHECKS[0]!, saves: true }, CHECKS[1]!] }
    world(on, files, () => undefined, saving, host(files, [], { up: true }, { bash: c => (c.startsWith("ego-browser") ? { result: { stdout: said, stderr: "" }, text: said, isError: true } : undefined) }))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    ran.length = 0
    const first = context(await $.tool.call(runRound(agentId!, folder, "01")))
    expect(first).not.toContain("Run the same round file again.")
    expect(first).toContain("may have come after a save")
    expect(first).toContain(`The hook started attempt 2 in a new space: write round-01.mjs in ${folderOf("detail", 2)}`)
    expect(ran.filter(r => r.argv[0] === "ego-browser")).toHaveLength(1)
    await $.tool.call(round(agentId!, folderOf("detail", 2), "01"))
    const second = context(await $.tool.call(runRound(agentId!, folderOf("detail", 2), "01")))
    expect(second).not.toContain("Run the same round file again.")
    expect(second).toContain("so the check is closed with no verdict")
  })
})

// Other runs and people test on the same data: a check with `- 데이터 조건:`
// says what its data must be, its driver checks that with the MCP tools it
// has (each call recorded for the judge) and uses other data or makes it,
// and its judge decides the data before the expectation.
const DATA = "미출고 주문이 2건 이상\n회원 목록 조회에 보임"
const DATA_RUN = { ...RUN, checks: [{ ...CHECKS[0]!, data: DATA }, CHECKS[1]!] }
const dataJudge = (conditions: string[], used: string, lines: string[], verdict: string) => `## 데이터\n\n${conditions.join("\n")}${conditions.length > 0 ? "\n\n" : ""}데이터: ${used}\n\n${judgeMd(lines, verdict)}`

describe("data conditions", () => {
  test("a check may say what its data must be, one condition a line; the checklist shows them above its expectation", () => {
    const one = "## e2e 확인\n\n### a\n- 제목: t\n- 구분: 변경\n- 앱: admin\n- 페이지: p\n- 경로: a > b\n- 할 일: x\n"
    const rest = "- 기대: y\n- 저장: 없음\n"
    const parsed = parseChecks(`${one}- 데이터 조건:\n  - 미출고 주문이 2건 이상\n  - 회원 목록 조회에 보임\n${rest}`) as { checks: Check[] }
    expect(parsed.checks[0]!.data).toBe(DATA)
    expect((parseChecks(`${one}${rest}`) as { checks: Check[] }).checks[0]!.data).toBeUndefined()
    expect((parseChecks(`${one}- 데이터 조건:\n${rest}`) as { reason: string }).reason).toContain("a needs at most one `- 데이터 조건:` line, with its conditions")
    const list = checklist("t", parsed.checks, APPS)
    expect(list).toContain("  - 데이터 조건 (할 일의 데이터가 이와 맞지 않으면 맞는 데이터로 바꿔서 확인):\n    - 미출고 주문이 2건 이상\n    - 회원 목록 조회에 보임\n  - 기대:")
    expect(checklist("t", [{ ...parsed.checks[0]!, data: undefined }], APPS)).not.toContain("데이터 조건")
  })

  test("its driver checks the data with MCP tools, read only, and may use other data or make it; without conditions it does not search elsewhere", () => {
    const e2e = readConfig(JSON.stringify({ qa: ["t"], e2e: E2E })).e2e!
    const k: CheckRun = { name: "detail", minutes: 30, spent: 0 }
    const drive = driverTask(e2e, { ...CHECKS[0]!, data: DATA }, k, "f", undefined, 1000)
    expect(drive).toContain("- Data conditions (what the task's data must be for the check to show what is expected): \n  - 미출고 주문이 2건 이상\n  - 회원 목록 조회에 보임\n")
    expect(drive).toContain("Use MCP tools only to read")
    expect(drive).toContain("in the evidence folder (mcp-NN.json)")
    expect(drive).toContain("Never change the page, what is expected, whether the check changes the screen, or the account.")
    expect(drive).toContain("make it through the app's own screens")
    expect(drive).toContain("call done() with a summary that starts `데이터 없음:`")
    expect(drive).toContain("- Saving: do not save, change or delete anything, except data you make as step 5 says when no data fits the conditions")
    expect(drive).not.toContain("without searching elsewhere")
    const plain = driverTask(e2e, CHECKS[0]!, k, "f", undefined, 1000)
    expect(plain).toContain("without searching elsewhere")
    expect(plain).not.toContain("Data conditions")
    expect(plain).toContain("- Saving: do not save, change or delete anything\n")
    expect(driverTask(e2e, { ...CHECKS[0]!, saves: true }, k, "f", undefined, 1000)).toContain("- Saving: save only what the task says to save, and change nothing else; after each save, wait for the app's sign that it is done (its notice, the save's response) and record it before you reopen or read what was saved; set an on/off value by reading it first and clicking only when it differs, never by a count of clicks")
    const judge = judgeTask({ ...CHECKS[0]!, data: DATA }, k, "f", "f/judge.md", undefined)
    expect(judge).toContain("- mcp-NN.json: each MCP call the driver made")
    expect(judge).toContain("## 데이터")
    expect(judge).toContain("판정: <통과 | 실패 | 증거 부족 | 데이터 없음>")
    expect(judgeTask(CHECKS[0]!, k, "f", "f/judge.md", undefined)).not.toContain("## 데이터")
  })

  test("the judge decides the data first: a condition not met sends back a check whose parts did not all pass, 데이터: 없음 is 데이터 없음, a met condition cites a file", () => {
    const has = (n: string) => ["round-01-shot-1.png", "mcp-01.json"].includes(n)
    const met = ["- 미출고 주문이 2건 이상: 맞음 — mcp-01.json", "- 회원 목록 조회에 보임: 맞음 — round-01-shot-1.png"]
    const parts = ["- 보인다: 통과 — round-01-shot-1.png"]
    expect(parseJudge(dataJudge(met, "후보 그대로", parts, "통과"), has, true)).toEqual({ parts: ["보인다: 통과 — round-01-shot-1.png"], verdict: "통과", cited: ["round-01-shot-1.png", "mcp-01.json"], used: "후보 그대로" })
    const unmet = [met[0]!, "- 회원 목록 조회에 보임: 안 맞음 — 목록에 없음"]
    expect(parseJudge(dataJudge(unmet, "후보 그대로", parts, "통과"), has, true)).toMatchObject({ verdict: "통과", parts: ["보인다: 통과 — round-01-shot-1.png"] })
    expect(parseJudge(dataJudge(unmet, "후보 그대로", parts, "증거 부족"), has, true)).toEqual({ problem: expect.stringContaining("판정: 증거 부족 does not follow from the data and the parts, which make it 통과") })
    const short = [...parts, "- 3건: 증거 부족 — 목록을 세지 않음"]
    expect(parseJudge(dataJudge(unmet, "후보 그대로", short, "증거 부족"), has, true)).toMatchObject({ verdict: "증거 부족", missing: "데이터 조건 「회원 목록 조회에 보임」 안 맞음: 목록에 없음; 3건: 목록을 세지 않음" })
    const failed = [...parts, "- 3건: 실패 — round-01-shot-1.png에 2건"]
    expect(parseJudge(dataJudge(unmet, "후보 그대로", failed, "증거 부족"), has, true)).toMatchObject({ verdict: "증거 부족", missing: expect.stringContaining("데이터 조건 「회원 목록 조회에 보임」 안 맞음") })
    expect(parseJudge(dataJudge(unmet, "후보 그대로", failed, "실패"), has, true)).toEqual({ problem: expect.stringContaining("which make it 증거 부족") })
    expect(parseJudge(dataJudge(["- 미출고 주문이 2건 이상: 맞음 — 조회했다"], "후보 그대로", parts, "통과"), has, true)).toEqual({ problem: expect.stringContaining('"미출고 주문이 2건 이상" fits with no evidence file cited') })
    expect(parseJudge("## 데이터\n\n데이터: 없음 — 조회 0건, 등록 화면 권한 없음\n\n## 기대 대조\n\n판정: 데이터 없음\n", has, true)).toEqual({ parts: [], verdict: "데이터 없음", cited: [], used: "없음 — 조회 0건, 등록 화면 권한 없음" })
    expect(parseJudge(judgeMd(parts, "통과"), has, true)).toEqual({ problem: expect.stringContaining("judge.md needs `## 데이터`") })
    expect(parseJudge("## 기대 대조\n\n판정: 데이터 없음\n", has)).toEqual({ problem: expect.stringContaining("judge.md needs `## 기대 대조`") })
  })

  test("a driver's MCP call is allowed and recorded in its check's folder; the pass ticks the checklist with the data it used", async ($, on) => {
    const files = filesWith()
    const rows = "[{\"member\":\"order0102\",\"open\":3}]"
    world(on, files, () => undefined, DATA_RUN, host(files, [doneRound(files), doneRound(files)], { up: true }, { call: tool => (tool === "mcp__db__query" ? { result: "rows", text: rows } : undefined) }))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    expect(spawned.find(s => s.type === DRIVER)!.prompt).toContain("- Data conditions")
    expect(await $.tool.call({ tool: "mcp__db__query", sql: "select member, open from orders", agentId } as never)).toMatchObject({ text: rows })
    expect(JSON.parse(files[`${folder}/mcp-01.json`]!)).toEqual({ tool: "mcp__db__query", input: { sql: "select member, open from orders" }, isError: false, output: rows })
    await $.tool.call({ tool: "mcp__db__query", sql: "select 1", agentId } as never)
    expect(files[`${folder}/mcp-02.json`]).toContain("select 1")
    expect(await $.tool.call({ tool: "PowerShell", command: "dir", agentId } as never)).toEqual(refused("D99"))
    await $.tool.call(round(agentId!, folder, "01"))
    await $.tool.call(runRound(agentId!, folder, "01"))
    const judge = await spawn($, JUDGE)
    expect(spawned.find(s => s.type === JUDGE)!.prompt).toContain("## 데이터")
    // the judge of a check with data conditions writes its data section first.
    expect(context(await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: judgeMd(["- 우수회원만 체크되고 비활성: 통과 — round-01-shot-1.png"], "통과"), agentId: judge.agentId, extra: 1 } as never))).toContain("judge.md needs `## 데이터`")
    const used = "회원 order0102 (후보 테스트회원A가 「미출고 주문이 2건 이상」에 맞지 않아 바꿈)"
    const conditions = ["- 미출고 주문이 2건 이상: 맞음 — mcp-01.json", "- 회원 목록 조회에 보임: 맞음 — round-01-shot-1.png"]
    const passed = await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: dataJudge(conditions, used, ["- 우수회원만 체크되고 비활성: 통과 — round-01-shot-1.png", "- 레이아웃: 통과 — round-01-measure-1.json"], "통과"), agentId: judge.agentId } as never)
    expect(context(passed)).toContain("check detail: 판정: 통과.")
    expect(files[`${DIR}/5-checklist.md`]).toContain(`- **detail** ([ego 통과](agent/evidence/detail/1/judge.md) · 사용한 데이터: ${used})\n`)
    expect(files[QAI]).toContain(`데이터: ${used}`)
  })

  test("데이터 없음 fails the check, and the D173 question marks it for the user to prepare data", async ($, on) => {
    const files = filesWith()
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "그대로 멈춤"), DATA_RUN, host(files, [doneRound(files), doneRound(files)]))
    await toEgo($)
    const { agentId } = await spawn($, DRIVER)
    const folder = folderOf("detail")
    await $.tool.call(round(agentId!, folder, "01"))
    await $.tool.call(runRound(agentId!, folder, "01"))
    const judge = await spawn($, JUDGE)
    const none = "## 데이터\n\n데이터: 없음 — 미출고 주문 2건 이상인 회원 0건, 주문 등록 화면은 이 계정에 없음\n\n## 기대 대조\n\n판정: 데이터 없음\n"
    expect(context(await $.tool.call({ tool: "Write", file_path: `${folder}/judge.md`, content: none, agentId: judge.agentId } as never))).toContain("check detail: 판정: 실패 (데이터 없음:")
    await passCheck($, "staff")
    const run = store.get("runs:proj/login-fix") as { halt?: { rule: string }; e2e: { checks: CheckRun[] } }
    expect(run.halt?.rule).toBe("D173")
    expect(run.e2e.checks.find(k => k.name === "detail")).toMatchObject({ verdict: "실패", noData: true })
    expect(files[QAI]).toContain("- 결과: 실패 — 데이터 없음 (조건에 맞는 데이터를 찾지도 만들지도 못함)")
    await relay($, ADVANCE)
    expect(questions[0]).toContain("detail — 세션 rein-login-fix-detail-1 — 판정: 데이터 없음 (조건에 맞는 데이터를 찾지도 만들지도 못함)")
    expect(questions[0]).toContain("데이터 없음인 항목은 코드 문제가 아닙니다")
  })
})
