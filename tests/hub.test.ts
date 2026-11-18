import { describe, expect, test } from "claude-code/testing"
import type { HttpInit } from "claude-code"
import type { HubInfo, HubRecord } from "../hooks/lib/sync.ts"
import { clock, DIR, grade, ran, relay, REIN, SPEC_TEXT, store, toasts, world, type Host } from "./world.ts"

// The hook no longer sends runs anywhere: it writes each run's
// agent/record.json, which the local frame server sends to the hub with the
// run's files. The hook asks the hub only whether another PC holds a run, for
// the runs to list, a run's documents, and to take a run over. The hub here
// is a fake of its API; the frame server and frame/sync.js are fakes of
// their commands.

const SERVER = "http://hub:7380"
const HOME = "C:/Users/u/.rein"
const STATUS_FILE = `${HOME}/.hub/status.json`
const PARK = { tool: "mcp__rein__park", reason: "다른 PC에서 이어서 하려고 함" } as never
const STATUS = { tool: "mcp__rein__status" } as never
const RESUME = { tool: "mcp__rein__resume", runId: "login-fix" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const syncFile = (said: Record<string, string> = { server: SERVER }) => ({ [`${HOME}/sync.json`]: JSON.stringify(said) })
// status.json as the local frame server writes it, at the mocked clock's now.
const statusFile = (st: Record<string, unknown>) => ({ [STATUS_FILE]: JSON.stringify({ v: 1, at: new Date(clock.now()).toISOString(), reachable: true, unsent: 0, ...st }) })

type Call = { method: string; path: string; pc?: string; body?: unknown }
const hub = {
  online: true as true | false | "hang",
  records: new Map<string, HubRecord>(),
  info: new Map<string, HubInfo>(),
  docs: new Map<string, Record<string, string>>(),
  // what a claim answers when not 200 by the gen it is given: a status, a
  // hang after the claim took effect, or a refused connection before it did.
  claim: undefined as number | "hang" | "refused" | undefined,
  // why frame/sync.js pull-run fails; undefined: it downloads.
  pullError: undefined as string | undefined,
  calls: [] as Call[],
}

function reset() {
  hub.online = true
  hub.records.clear()
  hub.info.clear()
  hub.docs.clear()
  hub.claim = undefined
  hub.pullError = undefined
  hub.calls.length = 0
}

// a run the hub holds, with what its agent/record.json says.
function onHub(rec: Partial<HubRecord>, info: Partial<HubInfo> = {}) {
  const r: HubRecord = { project: "proj", runId: "login-fix", pc: "PC-B", state: "defer", gen: 3, at: "2026-11-18T09:00:00.000Z", ...rec }
  hub.records.set(`${r.project}/${r.runId}`, r)
  hub.info.set(`${r.project}/${r.runId}`, { stage: "spec", title: "spec", at: r.at, event: "park", portable: true, ...info })
}

const answer = (status: number, value: unknown) => ({ status, text: JSON.stringify(value) })

function fakeHub(url: string, init?: HttpInit): ReturnType<NonNullable<Host["fetch"]>> {
  if (!url.startsWith(SERVER)) return true
  const path = url.slice(SERVER.length)
  const method = init?.method ?? "GET"
  hub.calls.push({ method, path, pc: init?.headers?.["x-rein-pc"], ...(init?.body !== undefined ? { body: JSON.parse(init.body) } : {}) })
  if (hub.online !== true) return hub.online
  const listed = /^\/api\/hub\/runs\?project=(.+)$/.exec(path)
  if (listed) {
    const runs = [...hub.records.values()].filter(r => r.project === listed[1]).map(r => {
      const info = hub.info.get(`${r.project}/${r.runId}`)!
      const resumable = (r.state === "active" || r.state === "defer") && info.portable && info.run !== undefined
      return { ...r, stage: info.stage, title: info.title, portable: info.portable, resumable, link: `${SERVER}/#${r.project}/${r.runId}` }
    })
    return answer(200, { runs })
  }
  const m = /^\/api\/runs\/([^/]+)\/([^/]+)(\/docs|\/claim)?$/.exec(path)
  const key = m ? `${m[1]}/${m[2]}` : ""
  const rec = hub.records.get(key)
  if (!m || !rec) return answer(404, { error: "unknown" })
  if (m[3] === undefined) return answer(200, { record: rec, info: hub.info.get(key) })
  if (m[3] === "/docs") return answer(200, { files: hub.docs.get(key) ?? {}, skipped: [] })
  if (hub.claim === "refused") return false
  if (typeof hub.claim === "number") return answer(hub.claim, hub.claim === 422 ? { error: "closed" } : { error: "changed", record: rec })
  if ((JSON.parse(init!.body!) as { gen: number }).gen !== rec.gen) return answer(409, { error: "changed", record: rec })
  const now = { ...rec, pc: init!.headers!["x-rein-pc"]!, state: "active" as const, gen: rec.gen + 1 }
  hub.records.set(key, now)
  return hub.claim === "hang" ? "hang" : answer(200, { record: now })
}

// node frame/server.js kick, and node frame/sync.js pull-run writing the
// hub's files of the run into its destination; anything else, `other`.
function host(files: Record<string, string>, pulled: Record<string, string> = {}, other?: Host["run"]): Host["run"] {
  return (argv, cwd, stdin, env) => {
    if (argv[0] === "node" && argv[1]?.endsWith("/frame/sync.js") && argv[2] === "pull-run") {
      if (hub.pullError !== undefined) return { exitCode: 1, stdout: `${JSON.stringify({ error: hub.pullError })}\n` }
      for (const [rel, text] of Object.entries(pulled)) files[`${argv.at(-1)}/${rel}`] = text
      return { exitCode: 0, stdout: `{"ok":true,"files":${Object.keys(pulled).length}}\n` }
    }
    return other?.(argv, cwd, stdin, env) ?? { exitCode: 0 }
  }
}

const kicks = () => ran.filter(r => r.argv[0] === "node" && r.argv[1]!.endsWith("/frame/server.js") && r.argv[2] === "kick")
const pulls = () => ran.filter(r => r.argv[0] === "node" && r.argv[1]!.endsWith("/frame/sync.js"))

// The record of a run in review, as PC-B kept it: paths relative.
const B_RUN = {
  v: 2, stage: "review", runId: "login-fix", uid: "u1", rules: [], retries: 1,
  planFiles: ["{root}/src/a.ts"], repos: ["{root}"], writes: ["{root}/src/a.ts"], sealed: { "{root}/src/a.ts": "abc" }, frozen: { spec: SPEC_TEXT },
}

// where this PC's copy of a run another PC took over goes, at the mocked clock's now.
const lostAt = () => `${REIN}/.lost/login-fix-${new Date(clock.now()).toISOString().replace(/\D/g, "").slice(0, 14)}`
const D220 = () => `D220: PC PC-B took the run login-fix over (it resumed it from the hub), so it is no longer this PC's. This session has no run now; this PC's copy is in ${lostAt()}. Tell the user.`

describe("hub (D219-D222)", () => {
  test("without a server in ~/.rein/sync.json nothing asks the hub, no record.json is written and no server is kicked", async ($, on) => {
    reset()
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "보류", { stage: "dev", runId: "login-fix" }, { fetch: fakeHub, run: host(files) })
    on("session.start", async (_$, e) => ({ cwd: e.cwd }))
    on("tool.register", async (_$, e) => ({ value: { tool: `mcp__rein__${e.name}` } }))
    await $.session.start({ cwd: "E:/proj", surface: null, isInteractive: true })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).toContain("The user put the run aside (보류).")
    expect(r.result).not.toContain("hub")
    expect(hub.calls).toEqual([])
    expect(Object.keys(files).filter(f => f.endsWith("/record.json"))).toEqual([])
    expect(kicks()).toEqual([])
  })

  test("보류 writes the run's record.json with its paths relative and no owner, asking the hub nothing", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const run = { stage: "dev", runId: "login-fix", uid: "u1", planFiles: ["E:/proj/src/a.ts"], rules: [{ name: "r", path: `${REIN}/rules/r.md`, hash: "h", paths: null }] }
    world(on, files, () => "보류", run, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, PARK)) as { result: string }
    expect(r.result).toContain("The local frame server sends it to the hub; before moving to another PC, mcp__rein__status shows whether anything is unsent.")
    expect(r.result).not.toContain("D219")
    const info = JSON.parse(files[`${REIN}/defer/login-fix/agent/record.json`]!) as HubInfo & Record<string, unknown>
    expect(info).toEqual(expect.objectContaining({ v: 1, uid: "u1", project: "proj", runId: "login-fix", stage: "dev", title: "spec", event: "park", portable: true }))
    expect(info.run?.planFiles).toEqual(["{root}/src/a.ts"])
    expect(info.run?.rules[0]?.path).toBe("{rein}/rules/r.md")
    expect(info.run?.owner).toBeUndefined()
    expect(info.run?.status).toBeUndefined()
    expect(hub.calls).toEqual([])
  })

  test("D220: a run the hub says another PC holds is let go at spec approval", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "active", uid: "u1" })
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix", uid: "u1" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    await grade($)
    const r = (await relay($, ADVANCE)) as { result: string }
    expect(r.result).toBe(`Approved, but ${D220()}`)
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(files[`${lostAt()}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(Object.keys(files).filter(f => f.startsWith(`${REIN}/drop/`))).toEqual([])
  })

  test("another PC's run of the same slug (another uid) is not this one: the approval goes on", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "active", uid: "u2" })
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix", uid: "u1" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    await grade($)
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
  })

  test("a hub that refuses does not hold the approval up, and the run's record.json follows it into plan", async ($, on) => {
    reset()
    hub.online = false
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    await grade($)
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(hub.calls.map(c => c.path)).toEqual(["/api/runs/proj/login-fix"])
    expect(JSON.parse(files[`${DIR}/agent/record.json`]!)).toEqual(expect.objectContaining({ stage: "plan", event: "spec" }))
  })

  test("a hub that hangs is given up on after HUB_MS", async ($, on) => {
    reset()
    hub.online = "hang"
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    await grade($)
    const pending = relay($, ADVANCE)
    await clock.settle()
    await clock.advance(2500)
    expect(await pending).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(hub.calls.map(c => c.path)).toEqual(["/api/runs/proj/login-fix"])
  })

  test("D220 from status.json's lost runs, with no hub call", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    Object.assign(files, statusFile({ lost: [{ project: "proj", runId: "login-fix", pc: "PC-B", local: "active" }] }))
    await grade($)
    const r = (await relay($, ADVANCE)) as { result: string }
    expect(r.result).toBe(D220())
    expect(hub.calls).toEqual([])
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
  })

  test("a record that names no PC is this PC's: not let go", async ($, on) => {
    reset()
    onHub({ pc: "unknown", state: "active" })
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    await grade($)
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ stage: "plan" }))
  })

  test("without COMPUTERNAME or HOSTNAME a Mac names itself to the hub by its LocalHostName", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const mac: Host["run"] = argv => (argv.join(" ") === "scutil --get LocalHostName" ? { exitCode: 0, stdout: "Example-MacBook-Pro\n" } : { exitCode: 0 })
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix" }, { fetch: fakeHub, run: host(files, {}, mac) })
    await grade($)
    await relay($, ADVANCE)
    expect(hub.calls.map(c => c.pc)).toEqual(["Example-MacBook-Pro"])
  })

  test("status with no run lists this project's hub runs with their links, resumable or view only (D214); offline, D221", async ($, on) => {
    reset()
    onHub({ runId: "login-fix", pc: "PC-B", state: "defer", at: "2026-11-18T09:00:00.000Z" }, { stage: "review", title: "로그인 잠금", run: B_RUN as never })
    onHub({ runId: "far-away", pc: "PC-B", state: "active", at: "2026-11-18T10:00:00.000Z" }, { stage: "plan", title: "바깥 저장소", portable: false })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const before = Object.keys(files).length
    const s = (await $.tool.call(STATUS)) as { result: string }
    expect(s.result).toContain("Runs on the hub (D219; mcp__rein__resume with the runId takes up a resumable one, the user confirms; mcp__rein__status with the runId fetches its documents to read):\n"
      + `- far-away: 바깥 저장소 (stage plan, active on PC-B, updated 2026-11-18T10:00:00.000Z; view only, it uses a repository outside the session root (D214)) ${SERVER}/#proj/far-away\n`
      + `- login-fix: 로그인 잠금 (stage review, deferred on PC-B, updated 2026-11-18T09:00:00.000Z; resumable) ${SERVER}/#proj/login-fix`)
    expect(hub.calls.map(c => c.path)).toEqual(["/api/hub/runs?project=proj"])
    expect(Object.keys(files).length).toBe(before)
    hub.online = false
    const off = (await $.tool.call(STATUS)) as { result: string }
    expect(off.result).toMatch(/\nD221: the hub did not answer \(.+\); hub runs are not listed\./)
  })

  test("status with a runId fetches that hub run's documents to read, replacing the folder", async ($, on) => {
    reset()
    onHub({ pc: "PC-B" })
    hub.docs.set("proj/login-fix", { "1-spec.md": SPEC_TEXT, "agent/review.md": "# review\n", "../escape.md": "x" })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const s = (await $.tool.call({ tool: "mcp__rein__status", runId: "login-fix" } as never)) as { result: string }
    const docs = `${HOME}/.hub/docs/proj/login-fix`
    expect(s.result).toContain(`The documents of login-fix on the hub are in ${docs} (2 files), to read.`)
    expect(files[`${docs}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(files[`${docs}/agent/review.md`]).toBe("# review\n")
    expect(Object.keys(files).filter(f => f.includes("escape"))).toEqual([])
    expect(hub.calls.map(c => c.path)).toEqual(["/api/runs/proj/login-fix/docs"])
  })

  test("another PC's run is taken over from the hub: asked, claimed by its gen, downloaded, and from right after plan (D222)", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "defer", gen: 3, uid: "u1" }, { stage: "review", title: "spec", run: B_RUN as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "이어서 진행"), null, { fetch: fakeHub, run: host(files, { "1-spec.md": SPEC_TEXT, "agent/dev-diff.md": "# dev\n" }), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { result: string }
    expect(questions[0]).toContain("이 run을 서버에서 받아 이 세션에서 이어서 진행할까요?")
    expect(questions[0]).toContain("단계: review (PC PC-B에서 보류됨, 2026-11-18T09:00:00.000Z에 올림)")
    expect(questions[0]).toContain("plan 통과 직후로 되돌려 dev부터 다시 합니다(D222)")
    expect(hub.calls.filter(c => c.method === "POST")).toEqual([{ method: "POST", path: "/api/runs/proj/login-fix/claim", pc: "PC-A", body: { gen: 3 } }])
    expect(pulls().map(p => p.argv.slice(2))).toEqual([["pull-run", "--server", SERVER, "--pc", "PC-A", "proj", "login-fix", DIR]])
    expect(r.result).toContain("Resumed login-fix in this session. The run is in the dev stage")
    expect(r.result).toContain("it went back to right after plan passed: the dev stage (D222)")
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ stage: "dev", status: "active", owner: "s1", uid: "u1", writes: [], retries: 0, planFiles: ["E:/proj/src/a.ts"] }))
    expect(files[`${DIR}/agent/dev-diff.md`]).toBe("# dev\n")
    expect(JSON.parse(files[`${DIR}/agent/record.json`]!)).toEqual(expect.objectContaining({ uid: "u1", stage: "dev", event: "resume" }))
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"resume","stage":"review","from":"hub","pc":"PC-B"`)
  })

  test("D220: a claim the hub refuses as changed takes nothing up, its worktree removed", async ($, on) => {
    reset()
    hub.claim = 409
    onHub({ pc: "PC-B", state: "active" }, { stage: "plan", run: { ...B_RUN, stage: "plan", trees: [{ repo: "{root}", path: "{root}", branch: "rein/login-fix", start: "develop", root: true }] } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}), "E:/proj/.git/HEAD": "" }
    const git: string[][] = []
    const other: Host["run"] = (argv, cwd) => {
      if (argv.includes("symbolic-ref")) return { exitCode: 0, stdout: "main\n" }
      if (argv.includes("--git-path")) return { exitCode: 0, stdout: ".git/info/exclude\n" }
      if (argv.includes("worktree")) git.push([cwd ?? "", ...argv.slice(argv.indexOf("worktree"))])
      return { exitCode: 0 }
    }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files, {}, other), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { deny: string }
    expect(r.deny).toBe("D220: the hub's record of login-fix changed since it was read: another PC may have taken it or moved it on. Nothing changed here; call mcp__rein__status to see it again.")
    expect(git.map(g => g[2])).toEqual(["add", "remove", "prune"])
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(pulls()).toEqual([])
  })

  test("a run in a worktree on the other PC gets its worktree anew here, from this PC's HEAD, its paths put under it", async ($, on) => {
    reset()
    const TREE = "E:/proj/.claude/worktrees/login-fix"
    onHub({ pc: "PC-B", state: "defer" }, { stage: "review", run: { ...B_RUN, trees: [{ repo: "{root}", path: "{root}", branch: "rein/login-fix", start: "develop", root: true }] } as never })
    const config = JSON.stringify({ qa: ["npm test"] })
    // the main tree's config, which git does not track: the worktree gets a copy.
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}), "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": config }
    const added: string[][] = []
    const git: Host["run"] = (argv, cwd) => {
      if (argv.includes("symbolic-ref")) return { exitCode: 0, stdout: "main\n" }
      if (argv.includes("--git-path")) return { exitCode: 0, stdout: ".git/info/exclude\n" }
      if (argv.includes("worktree")) added.push([cwd ?? "", ...argv.slice(argv.indexOf("worktree"))])
      return { exitCode: 0 }
    }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files, { "1-spec.md": SPEC_TEXT }, git), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { result: string }
    expect(added).toEqual([["E:/proj", "worktree", "add", "-b", "rein/login-fix", TREE, "HEAD"]])
    expect(r.result).toContain(`Its worktrees were made anew on this PC from HEAD: ${TREE} (from main).`)
    expect(files[`${TREE}/.rein/config.json`]).toBe(config)
    expect(r.result).toContain(`Call EnterWorktree with path ${TREE}`)
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ stage: "dev", planFiles: [`${TREE}/src/a.ts`], repos: [TREE], trees: [{ repo: "E:/proj", path: TREE, branch: "rein/login-fix", start: "main", root: true }] }))
  })

  test("status shows the hub as status.json says; a stale one means the local server is not running, and it is kicked", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile() }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    Object.assign(files, statusFile({ reachable: false, checkedAt: new Date(clock.now()).toISOString(), lastOkAt: "2026-11-18T08:00:00.000Z", error: "connect ETIMEDOUT", unsent: 3 }))
    const s = (await $.tool.call(STATUS)) as { result: string }
    expect(s.result).toContain(`Hub ${SERVER}: 서버에 닿지 않음, 미전송 3건 (last reached 2026-11-18T08:00:00.000Z; connect ETIMEDOUT)`)
    // the local server found the hub unreachable just now: it is not asked.
    expect(s.result).toContain("D221: the hub did not answer (connect ETIMEDOUT); hub runs are not listed.")
    expect(hub.calls).toEqual([])
    expect(kicks()).toEqual([])
    await clock.advance(4 * 60_000)
    const stale = (await $.tool.call(STATUS)) as { result: string }
    expect(stale.result).toContain(`Hub ${SERVER}: the local frame server is not running; nothing is being sent. It was started now.`)
    expect(kicks()).toHaveLength(1)
  })

  test("a sync.json naming only the git remote gets the hint, and the git sync's send queue goes", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile({ remote: "https://github.com/u/rein-runs.git" }) }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), store: { "sync:pending": [{ project: "proj", runId: "x", state: "defer", stage: "dev", event: "park" }] } })
    const s = (await $.tool.call(STATUS)) as { result: string }
    expect(s.result).toContain("sync.json still names a git remote, which Rein no longer uses; /rein:setup sets the hub.")
    expect(store.has("sync:pending")).toBe(false)
    expect(hub.calls).toEqual([])
  })

  test("resuming this PC's deferred copy of a run another PC took over asks about the hub's, and changes nothing until it is taken up", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "active", uid: "u1" }, { stage: "plan", title: "spec", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}), [`${REIN}/defer/login-fix/1-spec.md`]: "# A's spec\n" }
    const stored = { v: 2, stage: "plan", runId: "login-fix", uid: "u1", status: "defer", rules: [], writes: [], retries: 0 }
    let said: string | undefined
    // what lay in this PC's state folders when the claim reached the hub.
    let atClaim: string[] | undefined
    const fetch: Host["fetch"] = (url, init) => {
      if (url.endsWith("/claim")) atClaim = Object.keys(files).filter(f => /\/(active|defer|complete|drop)\/login-fix\//.test(f))
      return fakeHub(url, init)
    }
    world(on, files, () => said, null, { fetch, run: host(files, { "1-spec.md": SPEC_TEXT }), env: { COMPUTERNAME: "PC-A" }, store: { "runs:proj/login-fix": stored } })
    const r = (await relay($, RESUME)) as { result: string }
    expect(r.result).toContain("이 run을 서버에서 받아 이 세션에서 이어서 진행할까요?")
    expect(r.result).toContain("주의: 이 run은 PC PC-B가 쥐고 있습니다")
    expect(r.result).toContain(`이어받으면 이 PC의 기록은 지우고 사본(defer/login-fix)은 ${REIN}/.lost/로 옮깁니다 (PC PC-B가 서버에서 가져간 run입니다, D220).`)
    said = "취소"
    expect(await relay($, RESUME)).toEqual({ deny: "D147: login-fix is not resumed. Nothing changed." })
    expect(files[`${REIN}/defer/login-fix/1-spec.md`]).toBe("# A's spec\n")
    expect(store.get("runs:proj/login-fix")).toEqual(stored)
    expect(hub.calls.filter(c => c.method === "POST")).toEqual([])
    said = "이어서 진행"
    const done = (await relay($, RESUME)) as { result: string }
    expect(atClaim).toEqual([])
    expect(files[`${lostAt()}/1-spec.md`]).toBe("# A's spec\n")
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(done.result).toContain(`D220: PC PC-B had taken login-fix over, so this PC's record of it went and its copies are in ${lostAt()}. Tell the user.`)
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ status: "active", owner: "s1", uid: "u1", claimed: new Date(clock.now()).toISOString() }))
    expect(hub.records.get("proj/login-fix")?.pc).toBe("PC-A")
    expect(kicks()).toHaveLength(1)
  })

  test("A to B and back to A: this PC's stale drop/ and complete/ copies go to .lost/ before the claim, only once taken up", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}), [`${REIN}/drop/login-fix/1-spec.md`]: "# old\n", [`${REIN}/complete/login-fix/1-spec.md`]: "# older\n" }
    let said: string | undefined
    let atClaim: string[] | undefined
    const fetch: Host["fetch"] = (url, init) => {
      if (url.endsWith("/claim")) atClaim = Object.keys(files).filter(f => /\/(active|defer|complete|drop)\/login-fix\//.test(f))
      return fakeHub(url, init)
    }
    world(on, files, () => said, null, { fetch, run: host(files, { "1-spec.md": SPEC_TEXT }), env: { COMPUTERNAME: "PC-A" } })
    const asked = (await relay($, RESUME)) as { result: string }
    expect(asked.result).toContain(`이어받으면 이 PC의 사본(complete/login-fix, drop/login-fix)은 ${REIN}/.lost/로 옮깁니다.`)
    expect(files[`${REIN}/drop/login-fix/1-spec.md`]).toBe("# old\n")
    said = "이어서 진행"
    const r = (await relay($, RESUME)) as { result: string }
    expect(atClaim).toEqual([])
    expect(files[`${lostAt()}/1-spec.md`]).toBe("# older\n")
    expect(files[`${lostAt()}-drop/1-spec.md`]).toBe("# old\n")
    expect(r.result).toContain(`This PC's earlier copies of login-fix are in ${lostAt()}, ${lostAt()}-drop. Tell the user.`)
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(hub.records.get("proj/login-fix")).toEqual(expect.objectContaining({ pc: "PC-A", gen: 4 }))
  })

  test("a claim whose files cannot be downloaded leaves the run this PC's on the hub; resuming again downloads it without another claim", async ($, on) => {
    reset()
    hub.pullError = "ECONNRESET"
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files, { "1-spec.md": SPEC_TEXT }), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { deny: string }
    expect(r.deny).toBe(`D219: the hub now says this PC holds login-fix, but its files could not be downloaded to ${DIR} (ECONNRESET). Tell the user; resume it again once that is fixed (it is downloaded then without another claim).`)
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(hub.records.get("proj/login-fix")?.pc).toBe("PC-A")
    hub.pullError = undefined
    const again = (await relay($, RESUME)) as { result: string }
    expect(again.result).toContain("Resumed login-fix in this session.")
    expect(hub.calls.filter(c => c.method === "POST")).toHaveLength(1)
    expect(pulls()).toHaveLength(2)
  })

  test("a claim that hangs is looked up once more: the hub naming this PC, the run is downloaded", async ($, on) => {
    reset()
    hub.claim = "hang"
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files, { "1-spec.md": SPEC_TEXT }), env: { COMPUTERNAME: "PC-A" } })
    const pending = relay($, RESUME)
    await clock.settle()
    await clock.advance(2500)
    const r = (await pending) as { result: string }
    expect(r.result).toContain("Resumed login-fix in this session.")
    expect(hub.calls.map(c => `${c.method} ${c.path}`).slice(-3)).toEqual(["GET /api/runs/proj/login-fix", "POST /api/runs/proj/login-fix/claim", "GET /api/runs/proj/login-fix"])
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
  })

  test("a claim that is not answered, the hub still naming another PC, takes nothing up and says the claim may not have reached it", async ($, on) => {
    reset()
    hub.claim = "refused"
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { deny: string }
    expect(r.deny).toMatch(/^D221: the hub did not answer the claim of login-fix \(.+\), and whether the claim reached it is not known\. Nothing changed here; call resume again once the hub answers/)
    expect(hub.calls.map(c => `${c.method} ${c.path}`).slice(-2)).toEqual(["POST /api/runs/proj/login-fix/claim", "GET /api/runs/proj/login-fix"])
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(pulls()).toEqual([])
  })

  test("a claim of a run closed on the hub meanwhile (422) takes nothing up", async ($, on) => {
    reset()
    hub.claim = 422
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    expect(await relay($, RESUME)).toEqual({ deny: "the hub refused to hand login-fix over (it was closed there meanwhile). Nothing changed here; tell the user." })
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(pulls()).toEqual([])
  })

  test("a hub run using a repository outside the session root is not taken up (D214)", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "defer", uid: "u1" }, { stage: "plan", portable: false })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => "이어서 진행", null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const r = (await relay($, RESUME)) as { deny: string }
    expect(r.deny).toContain("On the hub it uses a repository outside the session root (D214), so it can only be read here (mcp__rein__status with its runId fetches its documents).")
    expect(hub.calls.filter(c => c.method === "POST")).toEqual([])
    expect(pulls()).toEqual([])
  })

  for (const [hubUid, runUid] of [[undefined, "u1"], ["u1", undefined]]) {
    test(`a hub record of the same slug with uid ${hubUid ?? "missing"} for a run with uid ${runUid ?? "missing"} is a collision, not this run: nothing is let go`, async ($, on) => {
      reset()
      onHub({ pc: "PC-B", state: "active", uid: hubUid })
      const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
      world(on, files, () => "승인", { stage: "spec", runId: "login-fix", uid: runUid }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
      await grade($)
      expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
      expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    })
  }

  test("a lost entry of a stale status.json, or found before this PC took the run up, lets nothing go", async ($, on) => {
    reset()
    const lost = (at: string) => statusFile({ lost: [{ project: "proj", runId: "login-fix", pc: "PC-B", local: "active", at }] })
    const files: Record<string, string> = { ...syncFile(), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "승인", { stage: "spec", runId: "login-fix", uid: "u1", claimed: "2026-11-18T09:30:00.000Z" }, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    Object.assign(files, lost("2026-11-18T09:00:00.000Z"))
    const PARK_ASK = { tool: "mcp__rein__park", reason: "x" } as never
    expect(((await $.tool.call(PARK_ASK)) as { result: string }).result).not.toContain("D220")
    Object.assign(files, lost("2026-11-18T10:00:00.000Z"))
    await clock.advance(4 * 60_000)
    expect(((await $.tool.call(PARK_ASK)) as { result: string }).result).not.toContain("D220")
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ status: "active" }))
    expect(hub.calls).toEqual([])
  })

  test("with the hub offline, resuming a run status.json found lost asks the hub once", async ($, on) => {
    reset()
    hub.online = false
    onHub({ pc: "PC-B", state: "active", uid: "u1" }, { stage: "plan", run: { ...B_RUN, stage: "plan" } as never })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({ lost: [{ project: "proj", runId: "login-fix", pc: "PC-B", local: "defer", at: new Date(clock.now()).toISOString() }] }), [`${REIN}/defer/login-fix/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "이어서 진행", null, {
      fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" },
      store: { "runs:proj/login-fix": { v: 2, stage: "plan", runId: "login-fix", uid: "u1", status: "defer", rules: [], writes: [], retries: 0 } },
    })
    const r = (await relay($, RESUME)) as { deny: string }
    expect(r.deny).toMatch(/^D221: taking a run over from another PC needs the hub/)
    expect(hub.calls).toHaveLength(1)
    expect(files[`${REIN}/defer/login-fix/1-spec.md`]).toBe(SPEC_TEXT)
  })

  test("open_run refuses a slug the hub has; a hub that does not answer lets it through", async ($, on) => {
    reset()
    onHub({ pc: "PC-B", state: "active" })
    const files: Record<string, string> = { ...syncFile(), ...statusFile({}) }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    const OPEN = { tool: "mcp__rein__open_run", runId: "login-fix" } as never
    expect(await $.tool.call(OPEN)).toEqual({ deny: "the hub already has a run named login-fix in this project (active on PC PC-B). Choose another slug." })
    hub.online = false
    const r = (await $.tool.call(OPEN)) as { result: string }
    expect(r.result).toContain("Run opened. runId: login-fix.")
    const uid = (store.get("runs:proj/login-fix") as { uid?: string }).uid
    expect(typeof uid).toBe("string")
    expect(JSON.parse(files[`${DIR}/agent/record.json`]!)).toEqual(expect.objectContaining({ uid, stage: "spec", event: "open" }))
  })

  test("a session starting with a server kicks the local server once, and toasts what status.json found at odds", async ($, on) => {
    reset()
    const files: Record<string, string> = { ...syncFile() }
    world(on, files, () => undefined, null, { fetch: fakeHub, run: host(files), env: { COMPUTERNAME: "PC-A" } })
    Object.assign(files, statusFile({ conflicts: [{ kind: "catalog", path: "web/rules/a.md", local: "h1", hub: "h2" }] }))
    on("session.start", async (_$, e) => ({ cwd: e.cwd }))
    on("tool.register", async (_$, e) => ({ value: { tool: `mcp__rein__${e.name}` } }))
    await $.session.start({ cwd: "E:/proj", surface: null, isInteractive: true })
    expect(kicks()).toHaveLength(1)
    expect(toasts).toEqual(["Rein: 서버와 어긋난 것이 있습니다(다른 PC가 가져간 run 0건, 충돌 1건) — mcp__rein__status로 확인하세요"])
    expect(hub.calls).toEqual([])
  })
})
