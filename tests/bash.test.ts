import { describe, expect } from "claude-code/testing"
import { checkChain, commitMessage, gitCommits, gitRewrite } from "../hooks/lib/bash.ts"
import { dev } from "../hooks/stages/dev.ts"
import { planReviewer } from "../hooks/stages/plan.ts"
import { qaIntegration } from "../hooks/stages/qaIntegration.ts"
import { review } from "../hooks/stages/review.ts"
import { store, world, test } from "./world.ts"

// the Bash policy of review, as a pure function.

const c = { run: { v: 2, stage: "review", runId: "r", rules: [], writes: [], retries: 0, repos: ["E:/proj", "E:/proj/api"] }, root: "E:/proj", dir: "C:/u/.rein/proj/r" } as never
const policy = (command: string) => review.bash!(command, c, {})

describe("the main session's commit (D182)", () => {
  test("gitCommits finds git commit where a command starts", () => {
    for (const cmd of ["git commit -m x", "cd x && git commit -m x", "git -C D:/proj -c a=b commit -F m.md", "git add a\ngit commit -m x", "(git commit -m x)"]) expect([cmd, gitCommits(cmd)]).toEqual([cmd, true])
    for (const cmd of ["git status", `grep "git commit" a`, "echo git commit", "git log --grep commit", "git commit-tree x"]) expect([cmd, gitCommits(cmd)]).toEqual([cmd, false])
  })

  test("commitMessage reads -m values, a heredoc on -F -, a PowerShell here-string, or names the -F file", () => {
    expect(commitMessage(`git commit -m "a \\"b\\"" -m 'c'`)).toEqual({ message: 'a "b"\n\nc' })
    expect(commitMessage("git commit -q -F - <<'EOF'\n제목\n\n본문\nEOF\ngit log -1")).toEqual({ message: "제목\n\n본문" })
    expect(commitMessage("git commit -m @'\r\n제목\r\n본문\r\n'@")).toEqual({ message: "제목\r\n본문" })
    expect(commitMessage("git -C E:/proj commit -F C:/u/6-land.md")).toEqual({ file: "C:/u/6-land.md" })
    expect(commitMessage("git commit")).toEqual({})
  })
})

describe("bash policy", () => {
  test("read-only git passes", () => {
    for (const cmd of [
      "git -C E:/proj diff",
      "git status",
      "git log --oneline -5",
      "git show HEAD:path",
      "git --no-pager -C E:/proj/api log -p",
      "git -C api diff --stat",
      'git log --format="%H %s"',
      "git diff 'a|b'",
      "git diff --no-index a b",
      "git -C E:/proj grep -n -e foo HEAD -- src",
      "git -C E:/proj ls-tree -r --name-only HEAD src",
      "git -C E:/proj config user.name",
      "git config --get user.email",
    ]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, undefined])
    }
  })

  test("chains, redirects, substitutions and quoting tricks are refused (D94)", () => {
    for (const cmd of [
      "git status && rm x",
      "git status; rm x",
      "git status || rm x",
      "git status &",
      "echo > x",
      "git log < x",
      "git diff $(rm x)",
      'git diff "$(rm x)"',
      "git diff `rm x`",
      "git diff $HOME",
      "git status\nrm x",
      "git log 'unclosed",
      "git diff a\\;b",
      "(git status)",
    ]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining("D94")])
    }
  })

  test("other commands, other repositories and writing options are refused (D117, D119)", () => {
    const cases: [string, string][] = [
      ["git diff --output=x", "D119"],
      ["git diff --output x", "D119"],
      ["git -c core.pager=x log", "D117"],
      ["git log -c", "D119"],
      ["git diff --ext-diff", "D119"],
      ["git show --textconv HEAD", "D119"],
      ["git grep -O vim foo", "D119"],
      ["git grep -nOvim foo", "D119"],
      ["git grep --open-files-in-pager foo", "D119"],
      ["git grep --open foo", "D119"],
      ["git push", "D117"],
      ["git -C E:/other diff", "D117"],
      ["git -C E:/proj/../other diff", "D117"],
      ["git -C", "D117"],
      ["python x.py", "D117"],
      ["GIT_EXTERNAL_DIFF=x git diff", "D117"],
      ["git config user.name x", "D117"],
      ["git config --global user.name", "D117"],
      ["git config --file a user.name", "D117"],
      ["git config --list", "D117"],
      ["git config core.pager", "D117"],
      ["git config --get user.name --show-origin", "D117"],
    ]
    for (const [cmd, rule] of cases) expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining(rule)])
  })

  test("commands that only read pass, alone or piped into each other", () => {
    for (const cmd of [
      "cat E:/proj/a.ts",
      "ls -la E:/proj/src",
      "sed -n '15,45p' E:/proj/a.ts",
      "sed -n -e '125p;160p' -e '$p' a.js",
      "grep -n 'put(' E:/proj/a.java | sed -n 1,80p",
      "rg -n foo E:/proj | wc -l",
      "find E:/proj -name '*.java'",
      "tail -40 x | grep -v y | head -5",
      "sed -n '28,48p' E:/proj/a.jsp | cut -c1-140",
      "git -C E:/proj show HEAD:src/a.jsp | grep -n foo",
      "git log --oneline | head -5",
    ]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, undefined])
    }
  })

  test("what writes, runs or acts is refused, piped or not, and the refusal names the tools that read (D117)", () => {
    for (const cmd of [
      "git status | sh",
      "cat x | sh",
      "cat x | git log",
      "sed -i 's/a/b/' x",
      "sed -n '1w out' x",
      "sed 's/a/b/' x",
      "sed -n -f s.sed x",
      "find . -delete",
      "find . -name x -fprint out",
      "rg --pre sh foo",
    ]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining("D117")])
    }
    expect(policy("python x.py")).toContain("Read, Grep and Glob")
    for (const cmd of ["cat x | grep y > z", "| head", "cat x |", "cat x |& head"]) expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining("D94")])
  })

  test("the plan reviewer, dev and an agent whose part is over read the same way (D117, D161)", () => {
    const reviewer = (cmd: string) => planReviewer.bash!(cmd, c, {})
    expect(reviewer("grep -rn foo E:/proj/src | head")).toBeUndefined()
    expect(reviewer("rm E:/proj/a.ts")).toContain("D117")
    const dc = { run: { v: 2, stage: "dev", runId: "r", rules: [], writes: [], retries: 0, repos: ["E:/proj"], planFiles: ["E:/proj/a.ts"] }, root: "E:/proj", dir: "C:/u/.rein/proj/r" } as never
    const inDev = (cmd: string) => dev.bash!(cmd, dc, {})
    expect(inDev("ls E:/proj/src")).toBeUndefined()
    expect(inDev("rm E:/proj/a.ts")).toBeUndefined()
    expect(inDev("git -C E:/proj diff")).toBeUndefined()
    expect(inDev("rm E:/proj/b.ts")).toContain("D161")
    expect(inDev("npm test")).toContain("D161")
  })

  test("braces, globs and tilde expand into unchecked words, so they are refused (D94)", () => {
    for (const cmd of [
      "git diff --output{=/tmp/a,=/tmp/b}",
      "git diff --ext{-diff,-diff}",
      "git show --text{conv,conv} HEAD",
      "git diff *",
      "git diff -- src/?.ts",
      "git diff [a]b",
      "git diff ~/x",
      "git log --format=~",
    ]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining("D94")])
    }
    for (const cmd of ["git diff HEAD~1", "git diff -- '*.ts'", "git show 'HEAD:src/{a}.ts'"]) expect([cmd, policy(cmd)]).toEqual([cmd, undefined])
  })

  test("abbreviated writing options are caught by D119 itself", () => {
    for (const cmd of ["git diff --outp=x", "git diff --ou x", "git diff --ext", "git show --textc HEAD", "git log -p -c"]) {
      expect([cmd, policy(cmd)]).toEqual([cmd, expect.stringContaining("D119")])
    }
    expect(policy("git diff --text")).toBeUndefined()
    expect(policy("git log --oneline --exit-code")).toBeUndefined()
  })

  test("a read-only git runs hardened against the repository's own config", () => {
    expect(gitRewrite("git -C E:/proj diff --stat", "E:/proj")).toBe(
      "git -c core.fsmonitor=false -c gpg.program=false -c core.pager=cat --no-pager -C E:/proj diff --no-ext-diff --no-textconv --stat",
    )
    expect(gitRewrite("git status", "E:/proj")).toBe("git -c core.fsmonitor=false -c gpg.program=false -c core.pager=cat --no-pager status")
    expect(gitRewrite(`git log --format="%H %s"`, "E:/proj")).toContain("log --no-ext-diff --no-textconv '--format=%H %s'")
    expect(gitRewrite("npm test", "E:/proj")).toBeUndefined()
  })

  test("grep and ls-tree run hardened too, and a piped git is hardened before the pipe", () => {
    const head = "git -c core.fsmonitor=false -c gpg.program=false -c core.pager=cat --no-pager -C E:/proj"
    expect(gitRewrite("git -C E:/proj grep -n foo", "E:/proj")).toBe(`${head} grep --no-textconv -n foo`)
    expect(gitRewrite("git -C E:/proj ls-tree HEAD", "E:/proj")).toBe(`${head} ls-tree HEAD`)
    expect(gitRewrite("git -C E:/proj show HEAD:a.jsp | grep -n 'x|y'", "E:/proj")).toBe(`${head} show --no-ext-diff --no-textconv HEAD:a.jsp | grep -n 'x|y'`)
    expect(gitRewrite("cat a | grep x", "E:/proj")).toBeUndefined()
  })

  test("a rewritten git never passes -c diff.external, which a worktree-isolated session refuses", () => {
    for (const c of ["git -C E:/proj diff", "git -C E:/proj show HEAD:a.jsp", "git status", "git -C E:/proj log --oneline"]) {
      expect(gitRewrite(c, "E:/proj")).not.toContain("diff.external")
    }
  })

  test("the integration reviewer reads the same way as the reviewer (D99)", () => {
    const qc = { run: { v: 2, stage: "qa-integration", runId: "r", rules: [], writes: [], retries: 0, repos: ["E:/proj"] }, root: "E:/proj", dir: "C:/u/.rein/proj/r" } as never
    const verifier = (cmd: string) => qaIntegration.bash!(cmd, qc, {})
    for (const cmd of ["ls -la C:/u/.rein/proj/r/handoff", "git -C E:/proj diff", "git -C E:/proj show HEAD:a | grep -n x"]) expect([cmd, verifier(cmd)]).toEqual([cmd, undefined])
    for (const cmd of ["npm test", "rm E:/proj/a.ts"]) expect([cmd, verifier(cmd)]).toEqual([cmd, expect.stringContaining("D99: ")])
  })

  test("the tokenizer drops quotes and keeps quoted spaces", () => {
    expect(checkChain(`git log --format="%H %s" 'a b'`)).toEqual({ words: ["git", "log", "--format=%H %s", "a b"] })
  })
})

describe("tools beside Bash", () => {
  const RUN = { v: 2, runId: "login-fix", rules: [], planFiles: ["E:/proj/src/a.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/a.ts"], retries: 0 }
  const AGENT = "agent-1"

  // the Rein agent of the stage is held to Bash; the reviewer in
  // review, the integration reviewer in qa-integration.
  for (const [stage, field] of [["review", "reviewer"], ["qa-integration", "verifier"]] as const) {
    test(`${stage} refuses its agent command-running tools and lets quiet ones through`, async ($, on) => {
      world(on, {}, undefined, { ...RUN, stage, [field]: AGENT })
      for (const call of [
        { tool: "PowerShell", command: "Set-Content E:/proj/src/a.ts pwned" },
        { tool: "Monitor", command: "sed -i s/a/b/ src/a.ts", description: "x", timeout_ms: 1 },
        { tool: "CronCreate", prompt: "x", cron: "* * * * *" },
        { tool: "mcp__other__execute_query", sql: "drop table x" },
      ]) {
        expect([call.tool, await $.tool.call({ ...call, agentId: AGENT } as never)]).toEqual([call.tool, expect.objectContaining({ deny: expect.stringContaining("is refused; commands run only through Bash") })])
      }
      for (const tool of ["Read", "Grep", "TodoWrite", "mcp__rein__status"]) {
        expect([tool, await $.tool.call({ tool, file_path: "E:/proj/src/a.ts", pattern: "x", todos: [], agentId: AGENT } as never)]).not.toEqual([tool, expect.objectContaining({ deny: expect.any(String) })])
      }
    })
  }

  // the main session runs what it likes, as written, in every stage.
  for (const stage of ["spec", "plan", "dev", "review", "qa", "qa-integration", "land"]) {
    test(`the main session's tools and commands are not limited in ${stage}`, async ($, on) => {
      const seen: string[] = []
      world(on, {}, undefined, { ...RUN, stage }, { bash: c => (seen.push(c), undefined) })
      for (const call of [
        { tool: "PowerShell", command: "Get-ChildItem" },
        { tool: "Monitor", command: "tail -f x", description: "x", timeout_ms: 1 },
        { tool: "mcp__other__execute_query", sql: "select 1" },
        { tool: "Bash", command: "npm test && echo done > E:/proj/out.txt" },
        { tool: "Bash", command: "git -C E:/proj diff" },
      ]) {
        expect([stage, call.tool, await $.tool.call(call as never)]).toEqual([stage, call.tool, expect.objectContaining({ result: "ok" })])
      }
      expect([stage, seen]).toEqual([stage, ["npm test && echo done > E:/proj/out.txt", "git -C E:/proj diff"]])
    })
  }

  test("the hardened git is what the reviewer's Bash runs", async ($, on) => {
    const seen: string[] = []
    world(on, {}, undefined, { ...RUN, stage: "review", reviewer: AGENT }, { bash: c => (seen.push(c), undefined) })
    await $.tool.call({ tool: "Bash", command: "git -C E:/proj diff", agentId: AGENT } as never)
    expect(seen).toEqual(["git -c core.fsmonitor=false -c gpg.program=false -c core.pager=cat --no-pager -C E:/proj diff --no-ext-diff --no-textconv"])
  })
})

// the worker runs nothing, so its Bash is read-only git or rm of
// planned files, spelled absolute; a removed file counts as a write.
// Nothing inside .git may be written.
describe("dev Bash", () => {
  const DEV_RUN = {
    v: 2, stage: "dev", runId: "login-fix", rules: [], retries: 0, repos: ["E:/proj"],
    planFiles: ["E:/proj/src/old.ts", "E:/proj/src/a.ts"], writes: ["E:/proj/src/a.ts"], worker: "w",
  }
  const writes = () => (store.get("runs:proj/login-fix") as { writes: string[] }).writes

  test("read-only git and rm of planned files run; a removed file is a write", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    for (const cmd of ["git -C E:/proj diff", "git status", "rm E:/proj/src/old.ts", "rm -f -- /e/proj/src/a.ts"]) {
      expect([cmd, await $.tool.call({ tool: "Bash", command: cmd, agentId: "w" } as never)]).toEqual([cmd, expect.objectContaining({ result: "ok" })])
    }
    expect(writes()).toEqual(["E:/proj/src/a.ts", "E:/proj/src/old.ts"])
  })

  test("anything else is refused", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    for (const [cmd, rule] of [
      ["npm test", "D161"],
      ["echo hi > E:/proj/src/a.ts", "D94"],
      ["rm src/old.ts", "D161"],
      ["rm -r E:/proj/src", "D161"],
      ["rm E:/proj/src/b.ts", "D161"],
      ["rm E:/proj/src/../src/old.ts", "D161"],
      ["rm", "D161"],
      ["git -C E:/other log", "D117"],
      ["git config filter.x.clean evil", "D117"],
    ]) {
      expect([cmd, await $.tool.call({ tool: "Bash", command: cmd, agentId: "w" } as never)]).toEqual([cmd, expect.objectContaining({ deny: expect.stringContaining(`${rule}:`) })])
    }
    expect(writes()).toEqual(["E:/proj/src/a.ts"])
  })

  test("the built-in runners are refused; other MCP tools are not", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    expect(await $.tool.call({ tool: "PowerShell", command: "Get-ChildItem", agentId: "w" } as never)).toEqual(expect.objectContaining({ deny: expect.stringContaining("D161: in the dev stage PowerShell is refused") }))
    expect(await $.tool.call({ tool: "mcp__atlassian__getJiraIssue", agentId: "w" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("nothing inside .git may be written", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    for (const path of ["E:/proj/.git/config", "E:/proj/.GIT/hooks/pre-commit", "E:/proj/sub/.git"]) {
      expect([path, await $.tool.call({ tool: "Write", file_path: path, content: "x", agentId: "w" } as never)]).toEqual([path, expect.objectContaining({ deny: expect.stringContaining("D161: nothing inside .git") })])
    }
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/.gitattributes", content: "x", agentId: "w" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
  })
})
