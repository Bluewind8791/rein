import { describe, expect } from "claude-code/testing"
import { applicableRules } from "../hooks/lib/rules.ts"
import type { Land } from "../hooks/lib/pane.ts"
import type { Rule, Run } from "../hooks/lib/state.ts"
import { fromPortable, toPortable } from "../hooks/lib/sync.ts"
import { inTree, landMessage, treeTable } from "../hooks/lib/trees.ts"
import { at, COVER, DIR, gitSub, planned, ran, REIN, relay, SPEC_TEXT, store, world, type Host, test } from "./world.ts"

// Every run works in its own git worktree of each repository its plan
// names, <repository>/.claude/worktrees/<runId> on branch rein/<runId>, made
// from HEAD when plan passes, the session root's repository too. The session
// stays in the main tree: in a worktree Claude Code would refuse its writes
// to the run's other worktrees. Land commits in each worktree on the
// person's approval, cherry-picks the commit into the main tree's branch
// and removes the worktree. A run from before worktrees (no trees in its
// record) goes on as it did; one from before plan made them all (the
// session root's made at open_run, marked root) goes on from the main tree.

const TREE = "E:/proj/.claude/worktrees/login-fix"
const BRANCH = "rein/login-fix"
const HOME = { repo: "E:/proj", path: TREE, branch: BRANCH, start: "main" }
const LEGACY = { ...HOME, root: true as const }
const QA = JSON.stringify({ qa: ["npm test"] })
// the .git file git writes in a linked worktree.
const GITFILE = "gitdir: E:/proj/.git/worktrees/login-fix"
const LAND = `${DIR}/6-land.md`
const MESSAGE = "# 로그인\n\n## 커밋 메시지\n\n```text\n[ISSUE-1] 로그인 잠금\n\n세 번 실패하면 잠근다.\n```\n\n## 스테이징\n\n- E:/proj: src/login.ts\n"

// A small git per folder: the branch it is on (null: a detached HEAD), the
// paths git status lists, and what the hook's land commands do. `worktree
// add` makes the worktree's .git file and its HEAD's config; `fail` makes
// one subcommand (or `<subcommand> <first argument>`) fail with git's words;
// diff, what `git diff --name-status -z` and `--numstat -z` print; untracked,
// a config HEAD does not hold, so the worktree is made without it.
type Git = { branch: string | null; changed?: string[]; committed?: string[]; fail?: Record<string, string>; diff?: { names: string; counts: string }; untracked?: boolean }

function gitHost(files: Record<string, string>, repos: Record<string, Git>, log: string[][], more: Host = {}): Host {
  return {
    run: (argv, cwd) => {
      if (argv[0] !== "git") return more.run?.(argv, cwd) ?? { exitCode: 0 }
      const sub = gitSub(argv)!
      const args = argv.slice(argv.indexOf(sub) + 1)
      log.push([cwd ?? "", sub, ...args])
      const g = repos[cwd ?? ""]
      const failed = g?.fail?.[`${sub} ${args[0]}`] ?? g?.fail?.[sub]
      if (failed !== undefined) return { exitCode: 128, stderr: `${failed}\n` }
      if (sub === "symbolic-ref") return g?.branch ? { exitCode: 0, stdout: `${g.branch}\n` } : { exitCode: 1 }
      if (sub === "rev-parse" && args[0] === "--git-path") return { exitCode: 0, stdout: ".git/info/exclude\n" }
      if (sub === "rev-parse") return { exitCode: 0, stdout: `c-${cwd}\n` }
      if (sub === "worktree" && args[0] === "add") {
        const path = args[3]!
        files[`${path}/.git`] = `gitdir: ${cwd}/.git/worktrees/login-fix`
        const config = files[`${cwd}/.rein/config.json`]
        if (config !== undefined && !g?.untracked) files[`${path}/.rein/config.json`] = config
        repos[path] ??= { branch: args[2]! }
        return { exitCode: 0 }
      }
      if (sub === "worktree" && args[0] === "remove") {
        for (const f of Object.keys(files)) if (f.startsWith(`${args[2]}/`)) delete files[f]
        return { exitCode: 0 }
      }
      if (sub === "status") return { exitCode: 0, stdout: (g?.changed ?? []).map(p => ` M ${p}\0`).join("") }
      if (sub === "diff-tree") return { exitCode: 0, stdout: (g?.committed ?? []).map(p => `${p}\0`).join("") }
      if (sub === "cherry-pick" && args[0] === "--abort") return { exitCode: 0 }
      if (sub === "diff" && g?.diff) return { exitCode: 0, stdout: args.includes("--numstat") ? g.diff.counts : g.diff.names }
      return { exitCode: 0 }
    },
  }
}

const record = () => store.get("runs:proj/login-fix") as (Run & Record<string, unknown>) | undefined
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const text = (r: unknown) => {
  const o = r as { deny?: string; result?: string; context?: string[] }
  return [o.deny, o.result, ...(o.context ?? [])].filter(x => x !== undefined).join("\n")
}
const OPEN = { tool: "mcp__rein__open_run", runId: "login-fix" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const PARK = { tool: "mcp__rein__park", reason: "사용자가 그만두자고 함" } as never
const write = (file_path: string) => ({ tool: "Write", file_path, content: "x" }) as never

describe("open_run makes no worktree", () => {
  test("the session stays in the main tree, and the run's writes go on from there", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA }
    const log: string[][] = []
    world(on, files, undefined, null, gitHost(files, { "E:/proj": { branch: "main" } }, log))
    const r = await $.tool.call(OPEN)
    expect(text(r)).not.toContain("EnterWorktree")
    expect(log).toEqual([])
    expect(record()?.trees).toEqual([])
    expect(await $.tool.call(write(`${DIR}/1-spec.md`))).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("autopilot: true is kept on the run and said in the result", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA }
    world(on, files, undefined, null, gitHost(files, { "E:/proj": { branch: "main" } }, []))
    const r = await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix", autopilot: true } as never)
    expect(text(r)).toContain("This is an autopilot run: the spec's questions are asked as usual")
    expect(record()?.autopilot).toBe(true)
  })

  test("a session root's repository without a usable config.json opens no run until rein:setup wrote one", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "" }
    world(on, files, undefined, null, gitHost(files, { "E:/proj": { branch: "main" } }, []))
    expect(await $.tool.call(OPEN)).toEqual({
      deny: "E:/proj/.rein/config.json does not exist, so E:/proj has not been set up for Rein. Invoke the rein:setup skill for E:/proj (it asks the user before it writes), then call open_run again with the same runId.",
    })
    files["E:/proj/.rein/config.json"] = JSON.stringify({ qa: [] })
    expect(await $.tool.call(OPEN)).toEqual({ deny: expect.stringContaining("E:/proj/.rein/config.json is not usable (`qa` must be a non-empty array of command strings)") })
    expect(record()).toBeUndefined()
    files["E:/proj/.rein/config.json"] = QA
    expect(text(await $.tool.call(OPEN))).toContain("Run opened")
  })

  test("the session root's nearest repository is the one checked, and a root in no repository opens as before", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "" }
    world(on, files, undefined, null, gitHost(files, { "E:/proj": { branch: "main" } }, []))
    at.root = "E:/proj/web"
    expect(await $.tool.call(OPEN)).toEqual({ deny: expect.stringContaining("E:/proj/.rein/config.json does not exist, so E:/proj has not") })
    delete files["E:/proj/.git/HEAD"]
    expect(text(await $.tool.call(OPEN))).toContain("Run opened")
  })
})

const PLAN = (file: string) => `# 로그인

## 접근 방법

로그인을 고친다.

## 상세 설계

### ${file}
- 잠금을 더한다
- 테스트 면제: 예시
${COVER}`

describe("plan in worktrees", () => {
  test("the session root's repository gets its worktree from HEAD, kept out of git status, with the main tree's config and its worktree.setup; the files move into it", async ($, on) => {
    const config = JSON.stringify({ qa: ["npm test"], worktree: { setup: ["npm ci"] } })
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": config, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [] }, gitHost(files, { "E:/proj": { branch: "main", untracked: true } }, log))
    const r = await planned($, PLAN("src/login.ts"))
    expect(r).toContain("now in the dev stage")
    expect(r).toContain(`The design's files: ${TREE}/src/login.ts.`)
    expect(r).toContain(`(원래 경로 → 워크트리 경로): E:/proj → ${TREE}`)
    expect(log).toContainEqual(["E:/proj", "worktree", "add", "-b", BRANCH, TREE, "HEAD"])
    expect(files["E:/proj/.git/info/exclude"]).toBe("/.claude/worktrees/\n")
    expect(files[`${TREE}/.rein/config.json`]).toBe(config)
    expect(ran).toContainEqual({ argv: ["C:/Program Files/Git/bin/bash.exe", "-c", "npm ci"], cwd: TREE })
    expect(record()).toEqual(expect.objectContaining({ planFiles: [`${TREE}/src/login.ts`], repos: [TREE], trees: [HOME] }))
  })

  test("a repository inside the session root's gets its own worktree: each file goes into the worktree of its innermost repository, and both are written from the main tree", async ($, on) => {
    const WEB = "E:/proj/web"
    const WT = `${WEB}/.claude/worktrees/login-fix`
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA, [`${WEB}/.git/HEAD`]: "", [`${WEB}/.rein/config.json`]: QA, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [] }, gitHost(files, { "E:/proj": { branch: "main" }, [WEB]: { branch: "develop" } }, log))
    const plan = `# 로그인\n\n## 접근 방법\n\n로그인을 고친다.\n\n## 상세 설계\n\n### src/login.ts\n- 잠금을 더한다\n- 테스트 면제: 예시\n\n### web/src/a.ts\n- 잠금을 보인다\n- 테스트 면제: 예시\n${COVER}`
    expect(await planned($, plan)).toContain("now in the dev stage")
    expect(log).toContainEqual(["E:/proj", "worktree", "add", "-b", BRANCH, TREE, "HEAD"])
    expect(log).toContainEqual([WEB, "worktree", "add", "-b", BRANCH, WT, "HEAD"])
    expect(record()).toEqual(expect.objectContaining({ planFiles: [`${TREE}/src/login.ts`, `${WT}/src/a.ts`], trees: [HOME, { repo: WEB, path: WT, branch: BRANCH, start: "develop" }] }))
    expect(await $.tool.call(write(`${TREE}/src/login.ts`))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(write(`${WT}/src/a.ts`))).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("a worktree git cannot make keeps the run in plan", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const repos = { "E:/proj": { branch: "main", fail: { worktree: "fatal: a branch named 'rein/login-fix' already exists" } } }
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [] }, gitHost(files, repos, []))
    expect(await planned($, PLAN("src/login.ts"))).toContain("the run's git worktree could not be made, so the run stays in plan: `git worktree add -b rein/login-fix E:/proj/.claude/worktrees/login-fix HEAD` failed in E:/proj: fatal: a branch named 'rein/login-fix' already exists.")
    expect(record()?.stage).toBe("plan")
  })

  test("a failed worktree.setup is told and the run goes on", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"], worktree: { setup: ["npm ci"] } }), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [] }, gitHost(files, { "E:/proj": { branch: "main" } }, [], { run: () => ({ exitCode: 1, stderr: "npm ERR! missing lockfile" }) }))
    const r = await planned($, PLAN("src/login.ts"))
    expect(r).toContain(`worktree.setup failed, so the worktree may lack what it needs (dependencies, say); the run goes on.`)
    expect(r).toContain(`\`npm ci\` (in ${TREE}) exited 1:`)
    expect(record()?.stage).toBe("dev")
  })

  test("a run from before, in the worktree open_run made, goes on from the main tree: its writes are not held, and plan moves a main-tree path into that worktree", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA, [`${TREE}/.git`]: GITFILE, [`${TREE}/.rein/config.json`]: QA, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [LEGACY] }, gitHost(files, {}, log))
    expect(await planned($, PLAN("src/login.ts"))).toContain("now in the dev stage")
    expect(record()).toEqual(expect.objectContaining({ planFiles: [`${TREE}/src/login.ts`], repos: [TREE], trees: [LEGACY] }))
    expect(log.some(l => l[1] === "worktree")).toBe(false)
  })

  test("with a session root that is no repository, each repository named gets its worktree and the files move into it", async ($, on) => {
    const WEB = "E:/proj/web"
    const WT = `${WEB}/.claude/worktrees/login-fix`
    const files: Record<string, string> = { [`${WEB}/.git/HEAD`]: "", [`${WEB}/.rein/config.json`]: QA, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, undefined, { stage: "plan", runId: "login-fix", trees: [] }, gitHost(files, { [WEB]: { branch: "develop" } }, log))
    const r = await planned($, PLAN("web/src/a.ts"))
    expect(r).toContain("now in the dev stage")
    expect(r).toContain(`The design's files: ${WT}/src/a.ts.`)
    expect(r).toContain(`(원래 경로 → 워크트리 경로): ${WEB} → ${WT}`)
    expect(log).toContainEqual([WEB, "worktree", "add", "-b", BRANCH, WT, "HEAD"])
    expect(record()).toEqual(expect.objectContaining({ planFiles: [`${WT}/src/a.ts`], repos: [WT], trees: [{ repo: WEB, path: WT, branch: BRANCH, start: "develop" }] }))
    expect(Object.keys(record()!.configHashes as object)).toEqual([WT])
    expect(files[`${WT}/.rein/config.json`]).toBe(QA)
  })

  test("a run from before worktrees passes plan as it did", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": QA, [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, undefined, { stage: "plan", runId: "login-fix" }, gitHost(files, {}, log))
    expect(await planned($, PLAN("src/login.ts"))).toContain("now in the dev stage")
    expect(record()).toEqual(expect.objectContaining({ planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"] }))
    expect(record()?.trees).toBeUndefined()
    expect(log.some(l => l[1] === "worktree")).toBe(false)
  })
})

const LANDING = { stage: "land", runId: "login-fix", planFiles: [`${TREE}/src/login.ts`], repos: [TREE], landRepos: [TREE], heads: { [TREE]: "h0" }, trees: [HOME], writes: [`${TREE}/src/login.ts`] }

describe("land in worktrees", () => {
  test("on approval: the planned files committed in the worktree, cherry-picked into the start branch, the worktree removed", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    const questions: string[] = []
    const repos = { "E:/proj": { branch: "main" }, [TREE]: { branch: BRANCH, changed: ["src/login.ts", "tmp.log"], diff: { names: "M\0src/login.ts\0", counts: "3\t1\tsrc/login.ts\0" } } }
    world(on, files, q => (questions.push(q), "커밋"), LANDING, gitHost(files, repos, log))
    const r = await relay($, ADVANCE)
    // the frame's land: what was asked, then the commit in the main tree, in
    // the agent/land.json that moved with the folder.
    expect(JSON.parse(files[`${REIN}/complete/login-fix/agent/land.json`] ?? "{}") as Land).toEqual({
      repos: [{ repo: "E:/proj", branch: "main", files: [{ path: "src/login.ts", status: "M", add: 3, del: 1 }], left: ["tmp.log"] }],
      result: [{ repo: "E:/proj", branch: "main", commit: "c-E:/proj", removed: true }],
    })
    expect(questions[0]).toContain("E:/proj — main 브랜치에 넣음")
    expect(questions[0]).toContain("  커밋할 파일: src/login.ts")
    expect(questions[0]).toContain("  커밋하지 않고 워크트리와 함께 지워질 파일: tmp.log")
    expect(questions[0]).toContain("> [ISSUE-1] 로그인 잠금")
    const land = log.filter(l => ["add", "commit", "cherry-pick", "worktree", "branch"].includes(l[1]!))
    expect(land).toEqual([
      [TREE, "add", "-A", "--", "src/login.ts"],
      [TREE, "commit", "-q", "-m", "[ISSUE-1] 로그인 잠금\n\n세 번 실패하면 잠근다."],
      ["E:/proj", "cherry-pick", `c-${TREE}`],
      ["E:/proj", "worktree", "remove", "--force", TREE],
      ["E:/proj", "worktree", "prune"],
      ["E:/proj", "branch", "-D", BRANCH],
    ])
    expect(text(r)).toContain("The run is finished.")
    expect(context(r)).toContain("D60: the run's commit is in the main working tree of E:/proj")
    expect(record()).toBeUndefined()
  })

  test("the approval shows the rows each screen document of the run changes", async ($, on) => {
    const head = "| 요소 | 요구사항 | 상태 | 근거 | run |\n|---|---|---|---|---|\n"
    const kept = "| list.cols | 목록 표 5열 | 구현됨 | 기획서 p.3 | order-list |"
    const was = "| toolbar.excel | 엑셀 다운로드 | 보류 | 기획서 p.5 | order-list |"
    const now = "| toolbar.excel | 엑셀 다운로드 | 구현됨 | 기획서 p.5 | login-fix |"
    const files: Record<string, string> = {
      [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE,
      [`${REIN}/requirements/shop/order0101.md`]: `${head}${kept}\n${was}\n`,
      [`${DIR}/agent/requirements/shop/order0101.md`]: `${head}${kept}\n${now}\n`,
      [`${DIR}/agent/requirements/shop/member0101.md`]: `${head}| - | 조회는 회원팀만 | 구현됨 | 사용자 요청 | login-fix |\n`,
    }
    const questions: string[] = []
    const repos = { "E:/proj": { branch: "main" }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }
    world(on, files, q => (questions.push(q), "취소"), LANDING, gitHost(files, repos, []))
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`화면 문서 (run이 닫히면 ${REIN}/requirements/로 옮김):\n  shop/member0101.md (새 문서)\n    + | - | 조회는 회원팀만 | 구현됨 | 사용자 요청 | login-fix |\n  shop/order0101.md (바뀐 줄 2)\n    - ${was}\n    + ${now}`)
    expect(files[`${REIN}/requirements/shop/order0101.md`]).toBe(`${head}${kept}\n${was}\n`)
  })

  test("in an autopilot run nothing is asked: the main session is told to pass the commit itself", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    const questions: string[] = []
    const repos = { "E:/proj": { branch: "main" }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }
    world(on, files, q => (questions.push(q), "커밋"), { ...LANDING, autopilot: true }, gitHost(files, repos, log))
    const r = await relay($, ADVANCE)
    expect(text(r)).toContain(`autopilot run: the user is not asked here; nothing changed yet. Tell them in one line what passed, giving the paths below, then call mcp__rein__advance again now with answer "커밋" and said "autopilot".`)
    expect(text(r)).toContain("  커밋할 파일: src/login.ts")
    expect(questions).toHaveLength(0)
    expect(log.some(l => l[1] === "commit")).toBe(false)
    expect(text(await $.tool.call({ tool: "mcp__rein__advance", answer: "커밋", said: "autopilot" } as never))).toContain("The run is finished.")
  })

  test("a cherry-pick git refuses is undone and land stops; the next approval skips the commit made", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    const repos: Record<string, Git> = { "E:/proj": { branch: "main", fail: { "cherry-pick": "error: your local changes would be overwritten by cherry-pick." } }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"], committed: ["src/login.ts"] } }
    world(on, files, () => "커밋", LANDING, gitHost(files, repos, log))
    const first = await relay($, ADVANCE)
    expect(text(first)).toContain(`the commit c-${TREE} is in the worktree ${TREE}, but \`git cherry-pick\` into E:/proj (main) failed (error: your local changes would be overwritten by cherry-pick.). It was undone (cherry-pick --abort)`)
    expect(log).toContainEqual(["E:/proj", "cherry-pick", "--abort"])
    expect(record()?.trees?.[0]).toEqual({ ...HOME, commit: `c-${TREE}` })
    expect(record()?.stage).toBe("land")
    repos["E:/proj"]!.fail = undefined
    log.length = 0
    expect(text(await relay($, ADVANCE))).toContain("The run is finished.")
    expect(log.some(l => l[1] === "commit")).toBe(false)
    expect(log).toContainEqual(["E:/proj", "cherry-pick", `c-${TREE}`])
  })

  test("land runs from the main tree: a session still in the worktree is told to leave it first", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "커밋"), LANDING, gitHost(files, { "E:/proj": { branch: "main" }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }, log))
    at.root = TREE
    expect(text(await relay($, ADVANCE))).toContain(`this session is in the run's worktree ${TREE}, which land removes once the commit is in`)
    expect(questions).toEqual([])
    expect(log.some(l => l[1] === "commit")).toBe(false)
    // writes are not held to the worktree in land.
    at.root = "E:/proj"
    expect(await $.tool.call(write(LAND))).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("a worktree folder a program holds is told as an empty folder to delete", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const repos: Record<string, Git> = { "E:/proj": { branch: "main", fail: { "worktree remove": `error: failed to delete '${TREE}': Permission denied` } }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }
    world(on, files, () => "커밋", LANDING, gitHost(files, repos, []))
    const r = await relay($, ADVANCE)
    expect(text(r)).toContain("The run is finished.")
    expect(context(r)).toContain(`Removing the worktrees did not finish: git deleted the worktree's files and dropped it, but could not delete the folder ${TREE} (error: failed to delete '${TREE}': Permission denied): a program holds it.`)
    const land = JSON.parse(files[`${REIN}/complete/login-fix/agent/land.json`] ?? "{}") as Land
    expect(land.result).toEqual([{ repo: "E:/proj", branch: "main", commit: "c-E:/proj", removed: false, folder: TREE }])
  })

  test("agent/land.json keeps each repository's result across advances: a cherry-pick refused in one, then a run folder that cannot move", async ($, on) => {
    const API = "E:/api/.claude/worktrees/login-fix"
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE, [`${API}/.git`]: "gitdir: E:/api/.git/worktrees/login-fix" }
    const repos: Record<string, Git> = {
      "E:/proj": { branch: "main" },
      "E:/api": { branch: "main", fail: { "cherry-pick": "error: your local changes would be overwritten by cherry-pick." } },
      [TREE]: { branch: BRANCH, changed: ["src/login.ts"] },
      [API]: { branch: BRANCH, changed: ["src/A.java"], committed: ["src/A.java"] },
    }
    let held = true
    const run = { ...LANDING, planFiles: [`${TREE}/src/login.ts`, `${API}/src/A.java`], repos: [TREE, API], landRepos: [TREE, API], trees: [HOME, { repo: "E:/api", path: API, branch: BRANCH, start: "main" }] }
    world(on, files, () => "커밋", run, { ...gitHost(files, repos, []), move: () => !held })
    expect(text(await relay($, ADVANCE))).toContain("`git cherry-pick` into E:/api (main) failed")
    const PROJ = { repo: "E:/proj", branch: "main", commit: "c-E:/proj", removed: true }
    expect((JSON.parse(files[`${DIR}/agent/land.json`]!) as Land).result).toEqual([PROJ])
    repos["E:/api"]!.fail = undefined
    expect(text(await relay($, ADVANCE))).toContain("D144: the commits are in, but the run folder could not be moved to complete")
    held = false
    expect(text(await relay($, ADVANCE))).toContain("The run is finished.")
    const land = JSON.parse(files[`${REIN}/complete/login-fix/agent/land.json`] ?? "{}") as Land
    expect(land.repos.map(r => r.repo)).toEqual(["E:/proj", "E:/api"])
    expect(land.result).toEqual([PROJ, { repo: "E:/api", branch: "main", commit: "c-E:/api", removed: true }])
  })

  test("the main tree on another branch than the run started from stops land before anything is committed", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    world(on, files, () => "커밋", LANDING, gitHost(files, { "E:/proj": { branch: "hotfix" }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }, log))
    expect(text(await relay($, ADVANCE))).toContain("the run cannot land yet: the main working tree E:/proj is on hotfix, not on main, where the run started from; the user switches it back to main.")
    expect(log.some(l => l[1] === "commit" || l[1] === "cherry-pick")).toBe(false)
  })

  test("a run started on a detached HEAD lands in the branch the main tree is on now, and not while it is still detached", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE, [`${TREE}/.git`]: GITFILE }
    const questions: string[] = []
    const repos: Record<string, Git> = { "E:/proj": { branch: null }, [TREE]: { branch: BRANCH, changed: ["src/login.ts"] } }
    world(on, files, q => (questions.push(q), "취소"), { ...LANDING, trees: [{ ...HOME, start: null }] }, gitHost(files, repos, []))
    expect(text(await relay($, ADVANCE))).toContain("the main working tree E:/proj is on a detached HEAD, as it was when the run started; the user switches it to the branch the commit goes into")
    repos["E:/proj"]!.branch = "feature"
    expect(text(await relay($, ADVANCE))).toContain("The user did not approve the commit; nothing was committed")
    expect(questions[0]).toContain("E:/proj — feature 브랜치에 넣음 (run을 시작할 때 detached HEAD였으므로 지금 브랜치)")
  })
})

describe("park and resume in worktrees", () => {
  test("폐기 removes the worktree and its branch; 보류 keeps them", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "폐기"), { stage: "dev", runId: "login-fix", trees: [HOME] }, gitHost(files, {}, log))
    const r = await relay($, PARK)
    expect(questions[0]).toContain(`이 run의 워크트리: ${TREE}. 폐기하면 워크트리와 브랜치 ${BRANCH}를 지웁니다`)
    expect(text(r)).toContain(`Its worktrees and branch ${BRANCH} were removed. This session has no run now.`)
    expect(log).toContainEqual(["E:/proj", "worktree", "remove", "--force", TREE])
  })

  test("폐기 from inside the worktree is refused until the session leaves it", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [`${TREE}/.git`]: GITFILE }
    const log: string[][] = []
    world(on, files, () => "폐기", { stage: "dev", runId: "login-fix", trees: [HOME] }, gitHost(files, {}, log))
    at.root = TREE
    expect(text(await relay($, PARK))).toContain(`D146: this session is in the run's worktree ${TREE}, which 폐기 removes`)
    expect(record()?.stage).toBe("dev")
    expect(log.some(l => l[1] === "worktree")).toBe(false)
  })

  test("보류 keeps the worktree", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const log: string[][] = []
    world(on, files, () => "보류", { stage: "dev", runId: "login-fix", trees: [HOME] }, gitHost(files, {}, log))
    expect(text(await relay($, PARK))).toContain(`Its worktrees stay: ${TREE}.`)
    expect(log.some(l => l[1] === "worktree")).toBe(false)
  })

  test("resume goes on from the main tree, and refuses while a worktree is gone", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/defer/login-fix/1-spec.md`]: SPEC_TEXT }
    const stored = { v: 2, stage: "dev", runId: "login-fix", rules: [], writes: [], retries: 0, status: "defer", trees: [HOME] }
    world(on, files, () => "이어서 진행", null, { store: { "runs:proj/login-fix": stored } })
    const RESUME = { tool: "mcp__rein__resume", runId: "login-fix" } as never
    expect(text(await relay($, RESUME))).toContain(`D147: login-fix works in git worktrees that are gone: ${TREE}, so it cannot go on. Tell the user: while its branch ${BRANCH} is still there, \`git -C E:/proj worktree add ${TREE} ${BRANCH}\` brings the worktree back`)
    files[`${TREE}/.git`] = GITFILE
    const r = text(await relay($, RESUME))
    expect(r).toContain(`Resumed login-fix in this session. The run is in the dev stage; its folder is ${DIR}.`)
    expect(r).not.toContain("EnterWorktree")
  })
})

describe("the worktree pieces", () => {
  test("a path of a repository the run has a worktree of moves into it, the innermost repository's when they nest; paths in a worktree and other paths stay", () => {
    const web = { repo: "E:/ws/web", path: "E:/ws/web/.claude/worktrees/x", branch: "rein/x", start: "main" }
    const inner = { repo: "E:/proj/web", path: "E:/proj/web/.claude/worktrees/login-fix", branch: BRANCH, start: "main" }
    const trees = [HOME, web, inner]
    expect(inTree(trees, "E:/ws/web/src/a.ts")).toBe("E:/ws/web/.claude/worktrees/x/src/a.ts")
    expect(inTree(trees, "E:/ws/web/.claude/worktrees/x/src/a.ts")).toBe("E:/ws/web/.claude/worktrees/x/src/a.ts")
    expect(inTree(trees, "E:/proj/src/a.ts")).toBe(`${TREE}/src/a.ts`)
    expect(inTree(trees, "E:/proj/web/src/a.ts")).toBe("E:/proj/web/.claude/worktrees/login-fix/src/a.ts")
    expect(inTree(trees, "E:/proj/web/.claude/worktrees/login-fix/src/a.ts")).toBe("E:/proj/web/.claude/worktrees/login-fix/src/a.ts")
    expect(inTree(trees, "E:/other/a.ts")).toBe("E:/other/a.ts")
    expect(treeTable([])).toBe("")
    expect(treeTable([HOME])).toContain(`(원래 경로 → 워크트리 경로): E:/proj → ${TREE}.`)
  })

  test("6-land.md's commit message is the fenced block under its heading", () => {
    expect(landMessage(MESSAGE)).toBe("[ISSUE-1] 로그인 잠금\n\n세 번 실패하면 잠근다.")
    expect(landMessage("# x\n\n## 커밋 메시지\n\n그냥 글\n")).toBeUndefined()
    expect(landMessage("# x\n\n## 스테이징\n\n```text\nmsg\n```\n")).toBeUndefined()
  })

  test("a rule's globs match a file in a worktree as the repository's own", () => {
    const rule = (name: string, paths: string[] | null, repo?: string): Rule => ({ name, path: `${name}.md`, hash: "h", paths, ...(repo ? { repo } : {}) })
    const rules = [rule("web", ["web/src/**"]), rule("api", ["src/**"], "E:/work/api")]
    const names = (files: string[]) => applicableRules(rules, files, "E:/proj").map(r => r.name)
    expect(names(["E:/proj/web/.claude/worktrees/x/src/a.ts"])).toEqual(["web"])
    expect(names(["E:/work/api/.claude/worktrees/x/src/A.java"])).toEqual(["api"])
  })

  test("a run in the session root's worktree goes to the sync remote relative to the session root", () => {
    const run = { v: 2, stage: "dev", runId: "login-fix", rules: [], writes: [], retries: 0, planFiles: [`${TREE}/src/a.ts`], repos: [TREE], trees: [{ ...HOME, commit: "c1" }] } as Run
    const out = toPortable(run, "E:/proj", REIN)
    expect(out.portable).toBe(true)
    expect(out.run.planFiles).toEqual(["{root}/.claude/worktrees/login-fix/src/a.ts"])
    expect(out.run.trees).toEqual([{ repo: "{root}", path: "{root}/.claude/worktrees/login-fix", branch: BRANCH, start: "main" }])
  })

  test("a run from before, in the worktree open_run made, goes to the sync remote relative to that worktree, wherever the session is", () => {
    const run = { v: 2, stage: "dev", runId: "login-fix", rules: [], writes: [], retries: 0, planFiles: [`${TREE}/src/a.ts`], repos: [TREE], trees: [{ ...LEGACY, commit: "c1" }] } as Run
    const out = toPortable(run, "E:/proj", REIN)
    expect(out.portable).toBe(true)
    expect(out.run.planFiles).toEqual(["{root}/src/a.ts"])
    expect(out.run.trees).toEqual([{ repo: "{root}", path: "{root}", branch: BRANCH, start: "main", root: true }])
  })

  test("a shared rule goes to the sync remote relative to ~/.rein/rules, and comes back under the other PC's", () => {
    const rule: Rule = { name: "rules:log", path: "C:/Users/u/.rein/rules/log.md", hash: "h", paths: null, shared: true }
    const run = { v: 2, stage: "dev", runId: "login-fix", rules: [rule], writes: [], retries: 0, planFiles: ["E:/proj/src/a.ts"], repos: ["E:/proj"] } as unknown as Run
    const out = toPortable(run, "E:/proj", REIN)
    expect(out.portable).toBe(true)
    expect(out.run.rules[0]!.path).toBe("{rules}/log.md")
    expect(fromPortable(out.run, "F:/proj", "D:/home/.rein/proj").rules[0]!.path).toBe("D:/home/.rein/rules/log.md")
  })
})
