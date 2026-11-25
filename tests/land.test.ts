import { describe, expect } from "claude-code/testing"
import type { Land } from "../hooks/lib/pane.ts"
import { landFiles, nameStatus, numstat, stagingProblem } from "../hooks/stages/land.ts"
import { relay, DIR, gitSub, ran, world, type Host, test } from "./world.ts"

// The land stage: the main session stages the planned files that changed and
// writes 6-land.md; advance checks the staging and closes the run. The user
// commits it themselves.

const LAND = `${DIR}/6-land.md`
const MESSAGE = "# 커밋\n\n```text\n[ISSUE-1] 로그인 잠금\n\n세 번 실패하면 잠근다.\n```\n"

// A small git per repository: the files changed in the work tree, the staged
// set and HEAD. The Bash tool's add and commit move them.
type Repo = { changed: string[]; staged: Set<string>; head: string }

function gitHost(repos: Record<string, Repo>, seen: string[] = [], more: Host = {}): Host {
  return {
    run: (argv, cwd) => {
      const repo = repos[cwd ?? ""]
      if (!repo || argv[0] !== "git") return { exitCode: 1 }
      const sub = gitSub(argv)
      if (sub === "status") return { exitCode: 0, stdout: repo.changed.map(p => `${repo.staged.has(p) ? "M " : " M"} ${p}\0`).join("") }
      if (sub === "diff" && argv.includes("--name-only")) return { exitCode: 0, stdout: [...repo.staged].map(p => `${p}\0`).join("") }
      if (sub === "rev-parse") return { exitCode: 0, stdout: `${repo.head}\n` }
      return { exitCode: 1 }
    },
    bash: command => {
      seen.push(command)
      const m = /-C (\S+) /.exec(command)
      const repo = m ? repos[m[1]!] : undefined
      if (repo && / add -- /.test(command)) {
        for (const p of command.split(" add -- ")[1]!.split(" ")) repo.staged.add(p.replace(`${m![1]}/`, ""))
      }
      if (repo && / commit /.test(command)) {
        repo.head = `${repo.head}-next`
        repo.changed = repo.changed.filter(p => !repo.staged.has(p))
        repo.staged.clear()
      }
      return undefined
    },
    ...more,
  }
}

const RUN = {
  v: 2, stage: "land", runId: "login-fix", rules: [], retries: 0,
  planFiles: ["E:/proj/src/login.ts", "E:/proj/src/new.ts"], repos: ["E:/proj"], writes: [],
  landRepos: ["E:/proj"], heads: { "E:/proj": "h0" },
}
const fresh = (): Record<string, Repo> => ({ "E:/proj": { changed: ["src/login.ts", "src/new.ts"], staged: new Set(), head: "h0" } })
const staged = (): Record<string, Repo> => ({ "E:/proj": { changed: ["src/login.ts", "src/new.ts"], staged: new Set(["src/login.ts", "src/new.ts"]), head: "h0" } })

const bash = (command: string) => ({ tool: "Bash", command }) as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const COMMIT = "git -C E:/proj commit -m x"
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const asks = (text: string) => expect.objectContaining({ result: expect.stringContaining(text) })
const ok = expect.objectContaining({ result: "ok" })
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) =>
  ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result
const COMPLETE = DIR.replace("/active/", "/complete/")

describe("land Bash", () => {
  test("the main session stages planned files and writes 6-land.md", async ($, on) => {
    const repos = fresh()
    world(on, {}, undefined, RUN, gitHost(repos))
    expect(await $.tool.call(bash("git -C E:/proj add -- src/login.ts src/new.ts"))).toEqual(ok)
    expect(await $.tool.call({ tool: "Write", file_path: LAND, content: MESSAGE } as never)).toEqual(ok)
    expect([...repos["E:/proj"]!.staged]).toEqual(["src/login.ts", "src/new.ts"])
  })

  test("the main session's own commit runs only once the user approves it, its message shown (D182)", async ($, on) => {
    const questions: string[] = []
    let answer = "취소"
    world(on, { [LAND]: MESSAGE }, q => (questions.push(q), answer), RUN, gitHost(fresh()))
    const heredoc = "git commit -q -F - <<'EOF'\n[담당자 요청] 로그인 오류 수정\n\n본문 한 줄\nEOF\ngit log -1 --oneline"
    const notRun = expect.objectContaining({ result: expect.stringContaining("The user did not approve the commit; it does not run.") })
    expect(await relay($, bash(heredoc))).toEqual(notRun)
    expect(questions[0]).toContain("커밋 메시지:\n```text\n> [담당자 요청] 로그인 오류 수정\n> \n> 본문 한 줄")
    expect(await relay($, { tool: "PowerShell", command: "git -C E:/proj commit -m '제목' -m '본문'" } as never)).toEqual(notRun)
    expect(questions[1]).toContain("> 제목\n> \n> 본문")
    // unanswered, the commit stays refused and advance takes its answer first.
    expect(await $.tool.call(bash(COMMIT))).toEqual(refused("D182: this needs the user's answer; nothing changed."))
    expect(await $.tool.call({ tool: "mcp__rein__advance" } as never)).toEqual(asks("D182: this needs the user's answer; nothing changed."))
    answer = "커밋"
    expect(await relay($, bash(COMMIT))).not.toEqual(expect.objectContaining({ deny: expect.anything() }))
    // Approved once: the same command again is asked about anew.
    expect(await $.tool.call(bash(COMMIT))).toEqual(refused("D182: this needs the user's answer; nothing changed."))
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "취소" } as never)).toEqual(notRun)
    for (const cmd of ["git status", `grep -n "git commit" notes.md`, "git log -1"]) expect(await $.tool.call(bash(cmd))).toEqual(ok)
    expect(questions).toHaveLength(3)
    // the main session's commit does not end the run.
    expect(await status($)).toContain("stage: land")
  })
})

describe("land gate", () => {
  test("without 6-land.md advance is refused (D84)", async ($, on) => {
    world(on, {}, undefined, RUN, gitHost(staged()))
    expect(await relay($, ADVANCE)).toEqual(refused(`D84: ${LAND} does not exist; write it first`))
    expect(await status($)).toContain("stage: land")
  })

  test("a planned file changed but not staged is refused (D89)", async ($, on) => {
    world(on, { [LAND]: MESSAGE }, undefined, RUN, gitHost(fresh()))
    await $.tool.call(bash("git -C E:/proj add -- src/login.ts"))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(refused("D89: the staging is not exactly the planned files that changed. E:/proj: not staged: E:/proj/src/new.ts"))
    expect(r).toEqual(refused("Stage the files not staged by name: `git -C <repository> add -- <path>...`."))
  })

  test("files the user staged beyond the plan are unstaged only with their consent (D89)", async ($, on) => {
    const repos = staged()
    repos["E:/proj"]!.staged.add("src/my notes.txt")
    world(on, { [LAND]: MESSAGE }, undefined, RUN, gitHost(repos))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(refused("E:/proj: staged but not planned-and-changed: E:/proj/src/my notes.txt"))
    expect(r).toEqual(refused("Unstage the files staged but not planned-and-changed only with the user's consent, or ask them to (`git -C E:/proj restore --staged -- 'src/my notes.txt'`). Then call advance again."))
  })

  test("the staging and 6-land.md close the run without a question or a commit; a new run can open", async ($, on) => {
    const seen: string[] = []
    let asked = false
    const files: Record<string, string> = { [LAND]: MESSAGE }
    const repos = staged()
    world(on, files, () => ((asked = true), "커밋"), RUN, gitHost(repos, seen))
    const r = await relay($, ADVANCE)
    expect(r).toEqual(expect.objectContaining({ result: "The run is finished." }))
    expect(asked).toBe(false)
    expect(seen).toEqual([])
    expect(repos["E:/proj"]!.head).toBe("h0")
    expect(context(r)).toContain(`D60: the planned files that changed are staged in E:/proj. The run is finished and closed; its record is in ${COMPLETE}. The user commits the staging themselves, with the message in ${COMPLETE}/6-land.md: give them that path.`)
    expect(context(r)).toContain("Tell the user. After you tell the user, invoke the rein:retro skill. Run folder: C:/Users/u/.rein/proj/complete/login-fix.")
    expect(files[`${COMPLETE}/6-land.md`]).toBe(MESSAGE)
    expect(await status($)).toBe("No Rein run is open in this session.")
    expect(await $.tool.call({ tool: "mcp__rein__open_run", runId: "next-task" } as never)).toEqual(expect.objectContaining({ result: expect.stringContaining("Run opened") }))
  })

  test("the end names the handoff files where the folder moved them (D163)", async ($, on) => {
    world(on, { [LAND]: MESSAGE }, undefined, { ...RUN, handoff: ["01.sql"] }, gitHost(staged()))
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain(`The user still has to apply the handoff files by hand, as 2-plan.md's \`## 넘길 것\` says (${COMPLETE}/2-plan.md): ${COMPLETE}/handoff/01.sql.`)
  })

  test("a folder that cannot move keeps the run in land until advance finishes it (D148, D144)", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE }
    let held = true
    world(on, files, undefined, RUN, gitHost(staged(), [], { move: () => !held }))
    expect(await relay($, ADVANCE)).toEqual(refused("D144: the staging is ready, but the run folder could not be moved to complete (The process cannot access the file"))
    expect(await status($)).toContain("finished: the staging is ready")
    expect(files[LAND]).toBe(MESSAGE)
    expect(files[`${DIR}/agent/land.json`]).toContain(`"repo":"E:/proj"`)
    held = false
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "The run is finished." }))
    expect(await status($)).toBe("No Rein run is open in this session.")
    expect(files[`${COMPLETE}/6-land.md`]).toBe(MESSAGE)
    expect(files[LAND]).toBeUndefined()
    expect(files[`${COMPLETE}/agent/land.json`]).toContain(`"repo":"E:/proj"`)
    expect(files[`${COMPLETE}/agent/trace.jsonl`]).toContain(`"ev":"stage","from":"land","to":null,"state":"complete"`)
  })

  test("the hook's own git runs hardened and lists a rename as its two paths", async ($, on) => {
    world(on, { [LAND]: MESSAGE }, undefined, RUN, gitHost(staged()))
    await relay($, ADVANCE)
    const git = ran.filter(x => x.argv[0] === "git")
    expect(git.length).toBeGreaterThan(0)
    for (const x of git) expect(x.argv.slice(0, 9)).toEqual(["git", "-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "gpg.program=false", "-c", "core.pager=cat"])
    expect(git.filter(x => ["status", "diff"].includes(gitSub(x.argv)!)).every(x => x.argv.includes("--no-renames"))).toBe(true)
  })

  test("a rename is its deletion and its addition: an unplanned deletion is refused (D89)", () => {
    const run = { ...RUN, planFiles: ["E:/proj/new.txt"] } as never
    const status = { "E:/proj": "D  old.txt\0A  new.txt\0" }
    const staged = { "E:/proj": "new.txt\0old.txt\0" }
    expect(stagingProblem(run, status, staged)).toContain("staged but not planned-and-changed: E:/proj/old.txt")
  })

  test("a run in several repositories closes once each has its planned files staged", async ($, on) => {
    const repos: Record<string, Repo> = {
      "E:/proj": { changed: ["src/login.ts"], staged: new Set(["src/login.ts"]), head: "a0" },
      "E:/proj/api": { changed: ["src/A.java"], staged: new Set(), head: "b0" },
    }
    const run = { ...RUN, planFiles: ["E:/proj/src/login.ts", "E:/proj/api/src/A.java"], repos: ["E:/proj", "E:/proj/api"], landRepos: ["E:/proj", "E:/proj/api"], heads: { "E:/proj": "a0", "E:/proj/api": "b0" } }
    world(on, { [LAND]: MESSAGE }, undefined, run, gitHost(repos))
    expect(await relay($, ADVANCE)).toEqual(refused("E:/proj/api: not staged: E:/proj/api/src/A.java"))
    repos["E:/proj/api"]!.staged.add("src/A.java")
    const r = await relay($, ADVANCE)
    expect(context(r)).toContain("D60: the planned files that changed are staged in E:/proj, E:/proj/api.")
  })
  test("the staging closes the run with what the person commits in the frame: each staged file with its counts, the other changes left", async ($, on) => {
    const files: Record<string, string> = { [LAND]: MESSAGE }
    const repos = staged()
    repos["E:/proj"]!.changed.push("notes.txt")
    const base = gitHost(repos)
    world(on, files, undefined, RUN, {
      ...base,
      run: (argv, cwd, stdin, env) => {
        const sub = gitSub(argv)
        if (sub === "symbolic-ref") return { exitCode: 0, stdout: "main\n" }
        if (sub === "diff" && argv.includes("--cached") && argv.includes("--name-status")) return { exitCode: 0, stdout: "M\0src/login.ts\0A\0src/new.ts\0" }
        if (sub === "diff" && argv.includes("--cached") && argv.includes("--numstat")) return { exitCode: 0, stdout: "2\t1\tsrc/login.ts\0-\t-\tsrc/new.ts\0" }
        return base.run!(argv, cwd, stdin, env)
      },
    })
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "The run is finished." }))
    // agent/land.json, written before the folder moved, moved with it.
    expect(JSON.parse(files[`${COMPLETE}/agent/land.json`] ?? "{}") as Land).toEqual({
      repos: [{ repo: "E:/proj", branch: "main", files: [{ path: "src/login.ts", status: "M", add: 2, del: 1 }, { path: "src/new.ts", status: "A", add: null, del: null }], left: ["notes.txt"] }],
    })
  })

  test("git's name-status and numstat as the frame lists land's files: a binary file has no counts, a new file git does not track yet is added", () => {
    expect(nameStatus("M\0a.ts\0A\0b.png\0D\0c.ts\0T\0d.sh\0")).toEqual({ "a.ts": "M", "b.png": "A", "c.ts": "D", "d.sh": "M" })
    expect(numstat("3\t1\ta.ts\0-\t-\tb.png\0")).toEqual([{ path: "a.ts", add: 3, del: 1 }, { path: "b.png", add: null, del: null }])
    // git diff --no-index of a new file against /dev/null (nul on Windows) names both.
    expect(numstat("2\t0\t\0nul\0new file.txt\0")).toEqual([{ path: "new file.txt", add: 2, del: 0 }])
    expect(landFiles(["a.ts", "b.png", "n.ts", "e.ts"], { "a.ts": "M", "b.png": "A" }, numstat("3\t1\ta.ts\0-\t-\tb.png\0"), { "n.ts": { add: 5, del: 0 } })).toEqual([
      { path: "a.ts", status: "M", add: 3, del: 1 },
      { path: "b.png", status: "A", add: null, del: null },
      { path: "n.ts", status: "A", add: 5, del: 0 },
      { path: "e.ts", status: "A", add: 0, del: 0 },
    ])
  })
})
