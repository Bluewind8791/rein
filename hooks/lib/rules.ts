import { matchesAny } from "./glob.ts"
import { sha256 } from "./hash.ts"
import { under } from "./paths.ts"
import type { Rule } from "./state.ts"

// the frozen rules that apply to the changed files: a rule with
// no `paths:` always, else when a file under the root matches one of its globs.
// A rule of a repository outside the session root the same way, with
// its repository as the root and only when a file lies in it.
// A shared rule (~/.rein/rules) with the root and each of repos, the run's
// repositories outside it, each file relative to the one it lies in.
// A file in a run's worktree of a repository (.claude/worktrees/<runId>/)
// is matched as the repository's own file there.
export function applicableRules(rules: Rule[], files: string[], root: string, repos: string[] = []): Rule[] {
  const relsOf = (dir: string) => {
    const base = dir.replace(/\/$/, "")
    return files.filter(f => under(f, base)).map(f => f.slice(base.length + 1).replace(/(^|\/)\.claude\/worktrees\/[^/]+\//, "$1"))
  }
  const ignoreCase = /^[A-Za-z]:\//.test(root)
  return rules.filter(r => {
    const rels = r.shared ? [root, ...repos].flatMap(relsOf) : relsOf(r.repo ?? root)
    if (r.repo !== undefined && rels.length === 0) return false
    return r.paths === null || rels.some(rel => matchesAny(r.paths!, rel, ignoreCase))
  })
}

// ~/.rein/rules, the rules every project's runs check, from a project
// folder ~/.rein/<project> beside it.
export const sharedRulesOf = (project: string) => `${project.slice(0, project.lastIndexOf("/"))}/rules`

// a rule's file as review.md names it, relative to rules/:
// `api.md`, or `spring/naming.md` for a rule in a domain folder.
export function ruleFile(rule: Rule): string {
  return rule.name + rule.path.slice(rule.path.lastIndexOf("."))
}

// one rule file frozen from its bytes: SHA-256 hash and `paths:` globs.
// register.ts lists and reads the files, since only it may touch $. name is
// the file's path relative to rules/.
export async function freezeRule(name: string, path: string, base64: string): Promise<Rule> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return {
    name: name.replace(/\.md$/i, ""),
    path,
    hash: await sha256(bytes),
    paths: rulePaths(new TextDecoder().decode(bytes)),
  }
}

// The `paths:` list in the front matter, as a block list, a flow list or one
// scalar; null when there is no front matter or no `paths:` key.
export function rulePaths(text: string): string[] | null {
  const lines = frontMatter(text)
  if (!lines) return null
  const at = lines.findIndex(l => /^paths[ \t]*:/.test(l))
  if (at < 0) return null
  const rest = lines[at]!.replace(/^paths[ \t]*:/, "").trim()
  if (rest.startsWith("[")) return splitFlow(rest.replace(/^\[|\]$/g, "")).map(unquote).filter(Boolean)
  if (rest) return [unquote(rest)]
  const out: string[] = []
  for (const line of lines.slice(at + 1)) {
    const item = /^[ \t]*-[ \t]*(.*)$/.exec(line)
    if (item) out.push(unquote(item[1]!))
    else if (!/^[ \t]*(#.*)?$/.test(line)) break
  }
  return out.filter(Boolean)
}

// The lines of a file's front matter; null when it has none.
export function frontMatter(text: string): string[] | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text)
  return front ? front[1]!.split(/\r?\n/) : null
}

export const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2")

// Commas split a flow list except inside quotes or a {a,b} glob group.
function splitFlow(s: string): string[] {
  const out: string[] = []
  let cur = ""
  let depth = 0
  let quote = ""
  for (const ch of s) {
    if (quote) quote = ch === quote ? "" : quote
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === "," && depth === 0) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  return [...out, cur]
}
