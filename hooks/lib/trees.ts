import { same, under } from "./paths.ts"
import type { Tree } from "./state.ts"

// Where a run's git worktrees go and what they are called. Nothing here
// touches $; register.ts runs git.

export const WORKTREES = ".claude/worktrees"

export const treeBranch = (runId: string) => `rein/${runId}`

export const treePath = (repo: string, runId: string) => `${repo}/${WORKTREES}/${runId}`

// the repository a session root in some run's worktree belongs to
// (<repo>/.claude/worktrees/<name>), else undefined. Only runs from before
// plan made every worktree had the session in one.
export const treeOwner = (root: string) => /^(.+)\/\.claude\/worktrees\/[^/]+$/.exec(root)?.[1]

const inside = (path: string, dir: string) => same(path, dir) || under(path, dir)

// a path in a repository the run has a worktree of, as it is in that
// worktree; a path already in a worktree and any other path as they are.
// Of nested repositories the innermost holds the path.
export function inTree(trees: Tree[], path: string): string {
  if (trees.some(x => inside(path, x.path))) return path
  const t = trees.filter(x => inside(path, x.repo)).sort((a, b) => b.repo.length - a.repo.length)[0]
  return t ? `${t.path}${path.slice(t.repo.length)}` : path
}

// dev's table of the repositories whose files 2-plan.md names in their
// main tree while the run writes them in its worktree; "" for none.
export function treeTable(trees: Tree[]): string {
  if (trees.length === 0) return ""
  return ` 2-plan.md names these repositories' files in their main working tree, but the run works in its own worktree of each, from its HEAD: read and write each file at its path in the worktree, which the file list above already gives (원래 경로 → 워크트리 경로): ${trees.map(t => `${t.repo} → ${t.path}`).join(", ")}.`
}

// the commit message of 6-land.md: the fenced block under
// `## 커밋 메시지`, trimmed; undefined when there is none or it is empty.
export function landMessage(text: string): string | undefined {
  const section = /^## 커밋 메시지[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1]
  if (section === undefined) return undefined
  const fence = /^(`{3,}|~{3,})[^\n]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/m.exec(section)
  const message = fence?.[2]?.replace(/\r\n/g, "\n").trim()
  return message ? message : undefined
}
