import type { E2e } from "./config.ts"
import { listed, type Check } from "./parse.ts"
import type { CheckRun } from "./state.ts"

// The aside path of integration qa, from what `aside exec` and `aside
// session resume` were measured to do: the session ID is
// the first line (past any warning the CLI prints first), the verdict
// the last `판정:` line, both ANSI-coloured even when piped; the exit code is
// not the verdict.

const ANSI = /\x1b\[[0-9;]*m/g

export type Capture = { session?: string; resumed?: true; observed?: string; verdict?: "통과" | "실패" }

// the session ID, the last `관측:` line and the final verdict
// out of a command's output. The session line is the CLI's, `created new
// session: <ID>` for exec, `continuing existing session: <ID>` for resume,
// past a leading `Exit code <n>` the Bash tool puts on a failure. It
// counts only before aside's agent writes anything (a `Thinking:` line or a
// tool call), so a warning the CLI prints first (a sign-in notice) may come
// before it, while page text, which reaches the output only as a tool's
// result after its call, cannot spoof it.
const SESSION_LINE = /^(created new|continuing existing) session: ([A-Za-z0-9]{16})$/
const AGENT_LINE = /^(?:Thinking:|[A-Za-z_][\w-]*\()/

export function captureAside(output: string): Capture {
  const clean = output.replace(ANSI, "").replace(/\r/g, "")
  const lines = clean.split("\n").map(l => l.trim()).filter(l => l !== "" && !/^(?:Error: )?Exit code \d+$/.test(l))
  const first = SESSION_LINE.exec(lines.find(l => SESSION_LINE.test(l) || AGENT_LINE.test(l)) ?? "")
  const verdict = /판정: (통과|실패)\s*$/.exec(clean.trimEnd())?.[1] as Capture["verdict"]
  const observed = lines.findLast(l => /^관측:/.test(l))?.replace(/^관측:\s*/, "")
  return {
    ...(first ? { session: first[2] } : {}),
    ...(first?.[1] === "continuing existing" ? { resumed: true as const } : {}),
    ...(observed !== undefined && verdict ? { observed } : {}),
    ...(verdict ? { verdict } : {}),
  }
}

// a session's status in `aside session list`, whose lines are
// `<ID>  <status>  ...`; undefined when the list has no line for it.
export function sessionStatus(list: string, session: string): string | undefined {
  for (const line of list.replace(ANSI, "").split(/\r?\n/)) {
    const [id, status] = line.trim().split(/\s+/)
    if (id === session) return status
  }
  return undefined
}

// The Bash tool reports a failed exit as a first line `Exit code <n>`
// (measured 2026-09-24).
export function exitCodeOf(text: string | undefined): number | undefined {
  const m = /^(?:Error: )?Exit code (\d+)/.exec(text ?? "")
  return m ? Number(m[1]) : undefined
}

// a check's time limit in minutes: its own `- 시간:`, else config
// `e2e.timeout`, default 30, at most 60.
export function checkMinutes(e2e: E2e, check: Check): number {
  const t = check.minutes ?? e2e.timeout
  return typeof t === "number" && t >= 1 ? Math.min(Math.floor(t), 60) : 30
}

// one call waits at most 10 minutes, the Bash tool's foreground limit.
export const CALL_MINUTES = 10

// The host alone: lowercase, no userinfo, port or trailing dot.
const hostOf = (s: string) => {
  try {
    return new URL(s.includes("://") ? s : `http://${s}`).hostname.toLowerCase().replace(/\.+$/, "")
  } catch {
    return undefined
  }
}

// whether an url or host is a production host. An entry matches its
// exact host; `*.example.com` matches every host under example.com. One the
// hook cannot read counts as production, since it cannot tell.
export function isProduction(target: string, production: string[]): boolean {
  const host = hostOf(target)
  if (host === undefined) return true
  return production.some(p => {
    const entry = p.trim()
    if (entry.startsWith("*.")) {
      const base = hostOf(entry.slice(2))
      return base !== undefined && host.endsWith(`.${base}`)
    }
    return hostOf(entry) === host
  })
}

// what of the urls of the apps the checks use and of the
// backends is production, in the words the halt reason uses; empty when e2e
// may run.
export function productionTargets(e2e: E2e, apps: string[]): string[] {
  const hits = apps.map(a => e2e.apps[a]?.url).filter((u): u is string => u !== undefined && isProduction(u, e2e.production))
  for (const b of e2e.backends) if (isProduction(b, e2e.production)) hits.push(`the app's backend ${b}`)
  return hits
}


// at most this many rein:e2e-runner agents run aside at once (measured
// 2026-10-16: two `aside exec` sessions ran side by side, each in its own
// tabs).
export const AT_ONCE = 5

// whether a check still waits for its verdict: none yet, and its time did
// not run out.
export const isOpen = (k: CheckRun) => !k.verdict && !k.over && !k.ego?.human

// the check's account line in a runner's or driver's task. The app's login
// may name an account of its own (one password that opens every
// account): the check's account wins over it.
export const accountLine = (check: Check): string[] =>
  check.account ? [`- Account: ${check.account} (log in as this account, even where the login above names another; the rest of the login still applies)`] : []

// the checks a runner may take now, in 2-plan.md's order: the first open
// checks no runner has, while they fit beside the checks runners have, up to
// AT_ONCE. Checks run side by side only when none of them saves and all log
// in to one app as one account; the first that does not fit waits, and the
// ones after it with it, so a saving check never runs out of turn.
export function startable(checks: CheckRun[]): CheckRun[] {
  const group = checks.filter(k => isOpen(k) && k.runner !== undefined)
  const out: CheckRun[] = []
  for (const k of checks) {
    if (!isOpen(k) || k.runner !== undefined) continue
    const all = [...group, ...out]
    const fits = all.length === 0 || (!k.saves && all.every(g => !g.saves && g.app === k.app && g.account === k.account))
    if (all.length >= AT_ONCE || !fits) break
    out.push(k)
  }
  return out
}

// the Bash timeout a runner's aside call runs under: the tool's maximum,
// so the `timeout` wrapper inside the command decides.
export const ASIDE_BASH_TIMEOUT = 600_000

// the task the hook gives the rein:e2e-runner it spawns for check k: the
// check as 2-plan.md gives it, the app's url, login and note from config
// e2e.apps, what aside's prompt must tell it, the command the hook accepts,
// and the result file the runner writes. The runner writes aside's prompt
// itself. `--permission full-access` stays required: under guard, aside's
// sandbox cannot write the folder, and its setup question waits in the app
// where the CLI cannot answer.
export function runnerTask(e2e: E2e, check: Check, k: CheckRun, folder: string, result: string): string {
  const app = e2e.apps[check.app]
  const url = app?.url ?? "(not in config e2e.apps)"
  const host = app ? (hostOf(app.url) ?? app.url) : url
  const flags = [e2e.model ? ` -m '${e2e.model}'` : "", e2e.effort ? ` --effort '${e2e.effort}'` : ""].join("")
  const left = k.minutes - k.spent
  const production = e2e.production.length > 0
  return [
    `Run check \`${k.name}\` of a Rein run's integration test through aside, then write its result. Do not fix anything, and do not judge the screen yourself: aside does.`,
    "",
    "The check:",
    `- App: ${url}`,
    ...(app?.login ? [`- Log in: ${app.login}`] : []),
    ...(app?.note ? [`- Mind in this app: ${app.note}`] : []),
    ...accountLine(check),
    ...(check.page && check.route ? [`- Page: ${check.page}, reached by the menus ${check.route}`] : []),
    `- Task: ${listed(check.todo, true)}`,
    `- Expected: ${listed(check.expect, false)}`,
    ...(check.reference ? [`- Why this data (background, not to check): ${check.reference}`] : []),
    ...(check.evidence ?? []).map(ev => `- Evidence the plan asks for (tell aside to show it on its 관측 line or in a screenshot): ${ev.kind} — ${ev.text}`),
    `- Saving: ${check.saves ? "save only what the task says to save, and change nothing else" : "do not save, change or delete anything"}`,
    ...(production ? [`- Production hosts, never to be opened: ${e2e.production.join(", ")}`] : []),
    `- Screenshot folder: ${folder}`,
    `- Time limit: ${left} minutes in all`,
    "",
    "1. Write aside's prompt, in English, from the check. It tells aside to open the app, log in (as the account, when one is named) and reach the page by its menus; to do the task and compare what it sees with what is expected;" +
      " to open only the screens the task names, and when it cannot find a screen or the data by the path the task gives, not to search elsewhere but to say why on the 관측 line and end with 판정: 실패; the saving rule above;" +
      ` to stay on ${host}${production ? ", never to open the production hosts, and if the app sends requests to one of them, to stop at once, say so and end with 판정: 실패" : ""};` +
      ` to save PNG screenshots that show what it saw in the folder ${folder}, and nothing else there; and to end its answer with exactly two last lines, \`관측: <what you saw>\`, then \`판정: 통과\` if it matches what is expected, or \`판정: 실패\`.`,
    `2. Run it with Bash in the foreground with the Bash timeout ${ASIDE_BASH_TIMEOUT}, as one command and nothing more (no pipe, redirect, \`;\` or \`&&\`), the prompt in single quotes, a ' inside it written as '"'"':`,
    `   timeout ${Math.min(left, CALL_MINUTES)}m aside exec --permission full-access${flags} '<prompt>'`,
    `   The hook refuses it unless it starts with \`timeout <n>m aside exec\` (n at most ${CALL_MINUTES} and at most the minutes left), has \`--permission full-access\`, and its prompt names the screenshot folder and both closing lines.`,
    "3. The hook's result says what it captured and what is next. When aside ran past the call's time and its session still runs, resume that session as the result says: `timeout <n>m aside session resume <session> '<prompt>'`. When the result says the check's time is spent, the hook stopped the session and closed the check: write nothing, report that and stop.",
    `4. Once aside ended with its two lines, write ${result} with Write, exactly these three lines, copied from aside's output:`,
    "   세션: <the session ID on the output's first line>",
    "   관측: <aside's 관측 line>",
    "   판정: <통과 or 실패, as aside said>",
    "   If aside ended without the two lines, run step 2 again while time is left, or write 판정: 실패 with what went wrong on the 관측 line.",
    "",
    "When the hook has judged the file, answer with its result in one line and stop.",
  ].join("\n")
}

// a runner's aside command for its open check k, from the words the shell
// would pass: `timeout <n>m aside exec` with `--permission full-access` and
// a prompt naming `folder` and both closing lines, or `timeout <n>m aside
// session resume <k's session>`, n from 1 to CALL_MINUTES and to the
// check's minutes left. The minutes of the call, or why it is refused.
export function runnerCommand(words: string[], k: CheckRun, folder: string): { minutes: number } | { deny: string } {
  const resume = k.session ? ` or \`timeout <n>m aside session resume ${k.session} '<prompt>'\`` : ""
  const form = `check ${k.name}'s aside runs only as \`timeout <n>m aside exec --permission full-access ... '<prompt>'\`${resume}, one command alone`
  const n = /^(\d+)m$/.exec(words[1] ?? "")
  if (words[0] !== "timeout" || !n || words[2] !== "aside") return { deny: `${form}.` }
  const minutes = Number(n[1])
  const left = k.minutes - k.spent
  const most = Math.min(CALL_MINUTES, left)
  if (minutes < 1 || minutes > most) return { deny: `the timeout must be 1 to ${most} minutes: at most ${CALL_MINUTES} a call, and ${left} of check ${k.name}'s ${k.minutes} minutes are left.` }
  if (words[3] === "exec") {
    const rest = words.slice(4)
    const full = rest.some((w, i) => w === "--permission=full-access" || (w === "--permission" && rest[i + 1] === "full-access"))
    if (!full) return { deny: `${form}: \`--permission full-access\` is missing.` }
    const text = rest.join(" ")
    const needs: [string, string][] = [[folder, `the screenshot folder ${folder}`], ["관측:", "the closing line `관측:`"], ["판정:", "the closing line `판정:`"]]
    const missing = needs.filter(([s]) => !text.includes(s)).map(([, what]) => what)
    if (missing.length > 0) return { deny: `aside's prompt for check ${k.name} must name ${missing.join(", ")}.` }
    return { minutes }
  }
  if (words[3] === "session" && words[4] === "resume") {
    if (!k.session) return { deny: `check ${k.name} has no aside session yet; start it with aside exec.` }
    if (words[5] !== k.session) return { deny: `resume check ${k.name}'s own session, ${k.session}.` }
    return { minutes }
  }
  return { deny: `${form}.` }
}
