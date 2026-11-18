import { resolve, same, under } from "../lib/paths.ts"
import type { LandFile } from "../lib/pane.ts"
import type { Run } from "../lib/state.ts"

// The paths `git status --porcelain=v1 -z` lists, absolute under the
// repository: "XY path", and after a rename or copy the old path as its own
// entry, both kept.
export function statusPaths(z: string, repo: string): string[] {
  return statusEntries(z, repo).map(e => e.path)
}

// Each status entry with its XY code; the old path of a rename or copy
// comes as its own entry with the same code.
export function statusEntries(z: string, repo: string): { code: string; path: string }[] {
  const entries = z.split("\0").filter(e => e !== "")
  const out: { code: string; path: string }[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const code = entry.slice(0, 2)
    out.push({ code, path: resolve(`${repo}/${entry.slice(3)}`, repo) })
    if (/[RC]/.test(code) && entries[i + 1] !== undefined) out.push({ code, path: resolve(`${repo}/${entries[++i]}`, repo) })
  }
  return out
}

// `git diff --cached --name-only -z`, absolute and sorted.
export function stagedPaths(z: string, repo: string): string[] {
  return z.split("\0").filter(e => e !== "").map(p => resolve(`${repo}/${p}`, repo)).sort()
}

// the plan files a repository owns (its own, not a nested one's).
export function filesOf(run: Run, root: string): string[] {
  const repos = run.repos ?? []
  return (run.planFiles ?? []).filter(f => {
    const owner = repos.filter(r => under(f, r)).sort((a, b) => b.length - a.length)[0]
    return owner !== undefined && same(owner, root)
  })
}

// `git diff --name-status -z --no-renames`: each path git lists, as the
// frame shows its change: A added, D deleted, M any other.
export function nameStatus(z: string): Record<string, "A" | "M" | "D"> {
  const parts = z.split("\0")
  const out: Record<string, "A" | "M" | "D"> = {}
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]!.charAt(0)
    if (code === "") break
    out[parts[i + 1]!] = code === "A" ? "A" : code === "D" ? "D" : "M"
  }
  return out
}

// `git diff --numstat -z`: each path's added and deleted lines, null for a
// binary file. A pair of paths (`git diff --no-index` of a new file against
// /dev/null comes as one) counts for the second.
export function numstat(z: string): { path: string; add: number | null; del: number | null }[] {
  const parts = z.split("\0")
  const out: { path: string; add: number | null; del: number | null }[] = []
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(parts[i]!)
    if (!m) continue
    let path = m[3]!
    if (path === "") {
      path = parts[i + 2] ?? ""
      i += 2
    }
    const count = (s: string) => (s === "-" ? null : Number(s))
    out.push({ path, add: count(m[1]!), del: count(m[2]!) })
  }
  return out
}

// land's files of one repository as the frame lists them, in the order
// given: the status and counts git gave for each path; a path git did not
// list (a new file it does not track yet) is added, counted by `fresh`.
export function landFiles(paths: string[], status: Record<string, "A" | "M" | "D">, counts: { path: string; add: number | null; del: number | null }[], fresh: Record<string, { add: number | null; del: number | null }> = {}): LandFile[] {
  return paths.map(path => {
    const counted = counts.find(c => c.path === path) ?? fresh[path]
    return { path, status: status[path] ?? "A", add: counted === undefined ? 0 : counted.add, del: counted === undefined ? 0 : counted.del }
  })
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.some(y => same(x, y)))

// A word as the shell reads it back: bare when it is safe, else single-quoted.
const quote = (w: string) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, `'"'"'`)}'`)

// what the person commits. The staged set of each land repository must be
// exactly its planned files that git status shows changed. Files staged
// beyond that (the user staged them before) are unstaged only with the
// user's consent.
export function stagingProblem(run: Run, status: Record<string, string>, staged: Record<string, string>): string | undefined {
  const problems: string[] = []
  const unstage: string[] = []
  let missed = false
  for (const root of run.landRepos ?? []) {
    const planned = filesOf(run, root)
    const changed = statusPaths(status[root] ?? "", root).filter(p => planned.some(f => same(f, p)))
    const want = [...new Set(changed)]
    const have = stagedPaths(staged[root] ?? "", root)
    if (!sameSet(want, have)) {
      const missing = want.filter(p => !have.some(h => same(h, p)))
      const extra = have.filter(p => !want.some(w => same(w, p)))
      problems.push(`${root}: ${missing.length ? `not staged: ${missing.join(", ")}` : ""}${missing.length && extra.length ? "; " : ""}${extra.length ? `staged but not planned-and-changed: ${extra.join(", ")}` : ""}`)
      if (missing.length) missed = true
      if (extra.length) unstage.push(["git", "-C", root, "restore", "--staged", "--", ...extra.map(p => p.slice(root.length + 1))].map(quote).join(" "))
    }
  }
  if (problems.length === 0) return undefined
  const next: string[] = []
  if (unstage.length) next.push(`Unstage the files staged but not planned-and-changed only with the user's consent, or ask them to (${unstage.map(u => `\`${u}\``).join(", ")}).`)
  if (missed) next.push("Stage the files not staged by name: `git -C <repository> add -- <path>...`.")
  return `D89: the staging is not exactly the planned files that changed. ${problems.join(" | ")} ${next.join(" ")} Then call advance again.`
}

// text in a code fence longer than any backtick run inside it.
export function fenced(text: string, lang: string): string {
  const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)))
  return `${fence}${lang}\n${text}\n${fence}`
}
