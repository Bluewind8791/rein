import { resolve, same, under } from "./paths.ts"

// a command runs alone and as written. Outside single quotes the shell
// could chain, redirect, substitute or expand, so any character that might
// is refused: ; & | > < ( ) ` $ and line breaks, a backslash outside quotes,
// brace and glob characters { } * ? [ ] (they expand to words the check
// never saw, a planted file named --output=x included), and ~ where bash
// expands it (a word's start, after = or :). Inside double quotes `, $ and
// an escaping backslash are refused. The answer is the words the shell would
// pass, or the reason it was refused.
export function checkChain(command: string): { words: string[] } | { deny: string } {
  const words: string[] = []
  let word: string | undefined
  let quote: "'" | '"' | undefined
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote === "'") {
      if (ch === "'") quote = undefined
      else word += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined
      else if (ch === "`" || ch === "$" || ch === "\n" || ch === "\r") return { deny: `D94: ${JSON.stringify(ch)} inside double quotes can run or expand something.` }
      else if (ch === "\\" && /["\\$`\n]/.test(command[i + 1] ?? "")) return { deny: "D94: a backslash escape inside double quotes is not allowed." }
      else word += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      word ??= ""
    } else if (ch === " " || ch === "\t") {
      if (word !== undefined) words.push(word)
      word = undefined
    } else if (/[;&|<>()`$\n\r\\]/.test(ch)) {
      return { deny: `D94: commands cannot be chained, redirected or substituted; ${JSON.stringify(ch)} is not allowed.` }
    } else if (/[{}*?[\]]/.test(ch) || (ch === "~" && (word === undefined || /[=:]$/.test(word)))) {
      return { deny: `D94: ${JSON.stringify(ch)} outside quotes expands into words the hook cannot check; quote it.` }
    } else word = (word ?? "") + ch
  }
  if (quote) return { deny: "D94: the command has an unclosed quote." }
  if (word !== undefined) words.push(word)
  return { words }
}

const READ_ONLY = new Set(["diff", "status", "log", "show", "grep", "ls-tree"])
const READ_ONLY_NAMES = "diff, status, log, show, grep, ls-tree, config [--get] user.name|user.email"

// `git config [--get] user.name|user.email`: the author a rule may ask
// for, as git resolves it (includeIf included). Any other config form
// could write or list more.
const authorRead = (rest: string[]) => {
  const args = rest[0] === "--get" ? rest.slice(1) : rest
  return args.length === 1 && (args[0] === "user.name" || args[0] === "user.email")
}

// options that write a file or run a command from a read-only git,
// abbreviations included (git takes an unambiguous prefix of a long option;
// `--text` is an option of its own). `-c` is refused wherever it stands;
// in grep, -O (bundled with other short options too) and
// --open-files-in-pager run a program.
function forbidden(word: string, sub: string): boolean {
  if (word === "-c") return true
  if (sub === "grep" && /^-[^-]*O/.test(word)) return true
  const name = /^--([^=]+)/.exec(word)?.[1]
  if (name === undefined || name.length < 2) return false
  return "output".startsWith(name) || "ext-diff".startsWith(name) || (name !== "text" && "textconv".startsWith(name)) || (sub === "grep" && "open-files-in-pager".startsWith(name))
}

// `git [--no-pager] [-C <repository>] diff|status|log|show|grep|ls-tree ...`.
// -C must name a repository of the run, or, with no repositories yet
// (repos undefined, spec and plan), a folder at or below the session
// root. --no-index stays allowed: it only reads, and reading is not blocked.
export function readOnlyGit(words: string[], repos: string[] | undefined, root: string): string | undefined {
  if (words[0] !== "git") return `D117: only read-only git (${READ_ONLY_NAMES}) may run here.`
  let i = 1
  if (words[i] === "--no-pager") i++
  if (words[i] === "-C") {
    const dir = words[i + 1]
    const at = dir === undefined ? undefined : resolve(dir, root)
    if (repos === undefined && (at === undefined || !(same(at, root) || under(at, root)))) {
      return `D160: git -C must name a folder at or below ${root}.`
    }
    if (repos !== undefined && (at === undefined || !repos.some(r => same(r, at)))) {
      return `D117: git -C must name a repository of this run: ${repos.join(", ") || "none recorded"}.`
    }
    i += 2
  }
  const sub = words[i]
  if (sub === "config" && authorRead(words.slice(i + 1))) return undefined
  if (sub === undefined || !READ_ONLY.has(sub)) {
    return `D117: only git ${READ_ONLY_NAMES} may run here, with at most --no-pager and -C <repository> before them; got ${sub ?? "nothing"}.`
  }
  const bad = words.slice(1).find(w => forbidden(w, sub))
  if (bad !== undefined) return `D119: ${bad} is refused in a read-only git command.`
  return undefined
}

// commands that only print what they read. sed only prints lines by
// number (-n, a script of digits, $, commas, semicolons and p: w, r, e and
// s would write, read or run); find has none of its tests that act or
// write; rg runs no preprocessor.
const READERS = new Set(["cat", "head", "tail", "wc", "ls", "grep", "rg", "sed", "find", "cut"])
const FIND_ACTS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"])
const SED_FORM = "sed runs here only as sed -n '<line numbers>p' <file>"

function sedPrints(args: string[]): boolean {
  const scripts: string[] = []
  const rest: string[] = []
  let quiet = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "-n" || a === "--quiet" || a === "--silent") quiet = true
    else if (a === "-E" || a === "-r") continue
    else if (a === "-e" && args[i + 1] !== undefined) scripts.push(args[++i]!)
    else if (a.startsWith("-")) return false
    else rest.push(a)
  }
  if (scripts.length === 0 && rest.length > 0) scripts.push(rest.shift()!)
  return quiet && scripts.length > 0 && scripts.every(s => /^[0-9,$;p\s]+$/.test(s))
}

// why a command is not a reader, if it is not.
function notReader(words: string[]): string | undefined {
  const [cmd, ...args] = words
  if (cmd === undefined || !READERS.has(cmd)) return `${cmd} is not one of them`
  if (cmd === "sed" && !sedPrints(args)) return SED_FORM
  const act = cmd === "find" ? args.find(a => FIND_ACTS.has(a)) : cmd === "rg" ? args.find(a => a.startsWith("--pre")) : undefined
  return act === undefined ? undefined : `${cmd} ${act} acts on files or runs a program`
}

// the parts of a pipeline, split at each | outside quotes. || chains.
function pipeParts(command: string): string[] | { deny: string } {
  const parts: string[] = []
  let quote: string | undefined
  let start = 0
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === "|") {
      if (command[i + 1] === "|") return { deny: 'D94: commands cannot be chained, redirected or substituted; "||" is not allowed.' }
      parts.push(command.slice(start, i))
      start = i + 1
    }
  }
  parts.push(command.slice(start))
  return parts
}

const READ_TOOLS_HINT = "Read, Grep and Glob read and search files; give Bash one command per call, with absolute paths."

// what an agent that only reads may run: commands that read (READERS),
// alone or piped into each other, after a read-only git or not (the git
// runs hardened, see gitRewrite). also names what else the stage allows.
// The answer is why the command is refused, if it is.
export function readOnly(command: string, repos: string[] | undefined, root: string, rule = "D117", also = ""): string | undefined {
  const parts = pipeParts(command)
  if ("deny" in parts) return `${parts.deny} ${READ_TOOLS_HINT}`
  const words: string[][] = []
  for (const part of parts) {
    const checked = checkChain(part)
    if ("deny" in checked) return `${checked.deny} ${READ_TOOLS_HINT}`
    if (checked.words.length === 0) return `D94: a pipe needs a command on each side. ${READ_TOOLS_HINT}`
    words.push(checked.words)
  }
  if (words[0]![0] === "git") {
    const git = readOnlyGit(words[0]!, repos, root)
    if (git !== undefined) return git
  }
  for (const w of words[0]![0] === "git" ? words.slice(1) : words) {
    const why = notReader(w)
    if (why !== undefined) return `${rule}: only ${also}commands that read (cat, head, tail, wc, ls, grep, rg, find, cut, sed -n '<line numbers>p'), alone or piped into each other, or after a read-only git (${READ_ONLY_NAMES}), may run here; ${why}. ${READ_TOOLS_HINT}`
  }
  return undefined
}

const quoteWord = (w: string) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, `'"'"'`)}'`)

// what a checked read-only git runs as: a repository's own config
// (set before the run, or by a tool the hook does not judge) could still
// run a program from a plain diff, log, show or status: diff.external, a
// textconv driver, core.fsmonitor, gpg.program behind --show-signature, a
// pager. The hook's own -c and --no-* switch those off. Filter drivers stay;
// dev cannot write inside .git. The hook's own git runs with the same -c.
export const GIT_HARDEN = ["-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "gpg.program=false", "-c", "core.pager=cat"]

// a rewritten Bash git leaves out -c diff.external, which Claude Code refuses
// in a worktree-isolated session; its --no-ext-diff covers it.
const BASH_HARDEN = GIT_HARDEN.filter((w, i) => w !== "diff.external=" && GIT_HARDEN[i + 1] !== "diff.external=")

export function hardenGit(words: string[]): string {
  let i = 1
  if (words[i] === "--no-pager") i++
  const repo = words[i] === "-C" ? words.slice(i, i + 2) : []
  i += repo.length
  const sub = words[i]!
  const off = sub === "status" || sub === "ls-tree" || sub === "config" ? [] : sub === "grep" ? ["--no-textconv"] : ["--no-ext-diff", "--no-textconv"]
  const head = ["git", ...BASH_HARDEN, "--no-pager"]
  return [...head, ...repo, sub, ...off, ...words.slice(i + 1)].map(quoteWord).join(" ")
}

// in a stage that limits Bash, only tools that run no command
// of their own besides it. Anything else (PowerShell, Monitor, CronCreate,
// Workflow, another MCP server's tools) could run what Bash may not.
const QUIET = new Set([
  "Read", "Grep", "Glob", "Write", "Edit", "NotebookEdit", "Bash", "Agent", "Task", "Skill",
  "AskUserQuestion", "TodoWrite", "ToolSearch", "SendMessage", "WebFetch", "WebSearch", "BashOutput", "TaskOutput",
])

export const quietTool = (tool: string) => QUIET.has(tool) || tool.startsWith("mcp__rein__")

// the built-in tools that run a command, or change files, their own
// way. spec, plan and dev refuse only these, so another MCP server's tools (an
// issue tracker, a database) stay usable for the investigation.
const RUNNERS = new Set(["PowerShell", "Monitor", "CronCreate", "Workflow", "EnterWorktree", "ExitWorktree"])

export const runnerTool = (tool: string) => RUNNERS.has(tool)

// The hardened form of a command that is, or whose pipeline starts with,
// a checked read-only git, else undefined (the command runs as written).
// The stage's rule already judged -C and the rest of the pipeline; a
// repository of a run is at or below the root or one of its outside
// repositories, which the caller tries in turn.
export function gitRewrite(command: string, root: string): string | undefined {
  const parts = pipeParts(command)
  if ("deny" in parts) return undefined
  const checked = checkChain(parts[0]!)
  if ("deny" in checked || readOnlyGit(checked.words, undefined, root) !== undefined) return undefined
  return [hardenGit(checked.words), ...parts.slice(1)].join(" |")
}

// whether a command reaches only into folder: a git whose -C names it or
// a folder in it, or an rm whose every path lies there.
export function inFolder(words: string[], folder: string, root: string): boolean {
  const within = (p: string) => same(resolve(p, root), folder) || under(resolve(p, root), folder)
  if (words[0] === "git") {
    const i = words[1] === "--no-pager" ? 2 : 1
    return words[i] === "-C" && words[i + 1] !== undefined && within(words[i + 1]!)
  }
  const paths = words[0] === "rm" ? words.slice(1).filter(w => w !== "-f" && w !== "--") : []
  return paths.length > 0 && paths.every(within)
}

// tool.check sees a command after tool.call rewrote it, so a hardened
// git comes back as written, without the hook's own -c (which its rules
// refuse from anyone else).
const HARDENED = `git ${BASH_HARDEN.join(" ")} `
export const unharden = (command: string) => (command.startsWith(HARDENED) ? `git ${command.slice(HARDENED.length)}` : command)

// whether a command (Bash or PowerShell, as the main session wrote it)
// runs `git commit` where a command starts: at the start, after `;`, `&`,
// `|`, `(` or a line break, with `-C`/`-c` options before it allowed.
export function gitCommits(command: string): boolean {
  return /(?:^|[;&|(\n])\s*git(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+commit(?![\w-])/.test(command)
}

// the commit message a command gives, as far as it can be read: each
// `-m`/`--message` value (quoted, bare, or a PowerShell here-string), a
// heredoc fed to `-F -`, or the file `-F`/`--file` names (read by the caller).
export function commitMessage(command: string): { message?: string; file?: string } {
  const parts: string[] = []
  const flag = /(?:^|\s)(?:-m|--message)(?:=|\s*)(@'\r?\n[\s\S]*?\r?\n'@|@"\r?\n[\s\S]*?\r?\n"@|"(?:[^"\\]|\\.)*"|'[^']*'|[^\s'"]+)/g
  for (const m of command.matchAll(flag)) {
    const v = m[1]!
    if (v.startsWith("@")) parts.push(v.replace(/^@['"]\r?\n/, "").replace(/\r?\n['"]@$/, ""))
    else if (v.startsWith('"')) parts.push(v.slice(1, -1).replace(/\\(["\\$`])/g, "$1"))
    else if (v.startsWith("'")) parts.push(v.slice(1, -1))
    else parts.push(v)
  }
  if (parts.length > 0) return { message: parts.join("\n\n") }
  const file = /(?:^|\s)(?:-F|--file)(?:=|\s+)("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "")
  if (file === "-") {
    const doc = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?:\n|$)/.exec(command)
    return doc ? { message: doc[3]!.replace(/\r$/gm, "") } : {}
  }
  return file ? { file } : {}
}
