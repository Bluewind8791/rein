import { describe, expect } from "claude-code/testing"
import { worktreeMain } from "../hooks/lib/paths.ts"
import { store, world, test } from "./world.ts"

const QA = JSON.stringify({ qa: ["npm test"] })

// a session rooted in a linked worktree is its main repository's
// project, so the rules and run records are the ones the main tree uses.

describe("project of a worktree", () => {
  test("a linked worktree's .git file names the main repository", () => {
    expect(worktreeMain("gitdir: E:/main/.git/worktrees/proj\n", "E:/proj")).toBe("main")
    expect(worktreeMain("gitdir: E:\\main\\.git\\worktrees\\proj\r\n", "E:/proj")).toBe("main")
    expect(worktreeMain("gitdir: ../main/.git/worktrees/proj\n", "E:/w/proj")).toBe("main")
    expect(worktreeMain("gitdir: ../.git/modules/proj\n", "E:/main/proj")).toBeUndefined()
    expect(worktreeMain("gitdir: E:/bare.git/worktrees/proj\n", "E:/proj")).toBeUndefined()
    expect(worktreeMain("", "E:/proj")).toBeUndefined()
  })

  test("a run opened in a worktree freezes the main repository's rules and keeps its record there", async ($, on) => {
    const rules = "C:/Users/u/.rein/main/rules"
    const files: Record<string, string> = { "E:/proj/.git": "gitdir: E:/main/.git/worktrees/proj\n", "E:/proj/.rein/config.json": QA, [`${rules}/api.md`]: "# api\n" }
    world(on, files, undefined, null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    expect(files["C:/Users/u/.rein/main/active/login-fix/agent/trace.jsonl"]).toContain(`"name":"api"`)
    expect(store.has("runs:main/login-fix")).toBe(true)
  })

  test("a .git folder keeps the session root's folder name", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "ref: refs/heads/main\n", "E:/proj/.rein/config.json": QA }
    world(on, files, undefined, null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    expect(store.has("runs:proj/login-fix")).toBe(true)
  })
})
