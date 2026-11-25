import { accountLine, AT_ONCE, isOpen } from "./aside.ts"
import type { App, E2e } from "./config.ts"
import { listed, type Check } from "./parse.ts"
import { resolve, same } from "./paths.ts"
import type { CheckRun } from "./state.ts"
import { doneFile, handoffFile, importLine, lostFile } from "./egoHarness.ts"

// The ego path of integration qa: a rein:ego-driver drives each check in
// its own TaskSpace through the harness, a rein:ego-judge decides it from the
// evidence alone. What the hook runs in ego itself (whether ego answers, its
// profiles, closing spaces) goes through `ego-browser nodejs` with a script
// on stdin (`-e` hangs while stdin is open, measured), its answer on one
// line the hook finds by MARK.

export const MARK = "[rein-ego]"

// the ego-browser guide the hook saves in the run's evidence folder for the
// drivers, who run no other command.
export const EGO_GUIDE = "ego-guide.md"

// the script that lists the ego profiles: `[{ id, name }]`.
export const PROBE_SCRIPT = `console.log(${JSON.stringify(MARK)} + JSON.stringify((await profiles()).map(p => ({ id: p.id, name: p.name }))))\n`

// the script that takes a test screenshot in a space of its own, then
// closes it: `{ ok, error? }`. A screenshot fails while ego's window is
// minimized (at once) or closed (CDP timeout after 15 s), though goto,
// evaluate and snapshot still work (measured, ego-browser 0.6.1.11).
export const SHOT_PROBE_SCRIPT = [
  `const name = "rein-probe-shot"`,
  `for (const s of await listTaskSpaces()) if (s.name === name) await (await taskSpace(name)).finish({ keep: [] }).catch(() => undefined)`,
  `const t = await taskSpace(name)`,
  `let out`,
  `try {`,
  `  const p = (await t.pages())[0] ?? (await t.newPage())`,
  `  await p.screenshot()`,
  `  out = { ok: true }`,
  `} catch (e) {`,
  `  out = { ok: false, error: String(e?.message ?? e).slice(0, 200) }`,
  `}`,
  `await t.finish({ keep: [] }).catch(() => undefined)`,
  `console.log(${JSON.stringify(MARK)} + JSON.stringify(out))`,
  "",
].join("\n")

// the script that closes every TaskSpace whose name matches the pattern
// (a regular expression's source), whatever its state (handed to the user
// included): the names it closed.
export function closeScript(pattern: string): string {
  return [
    `const re = new RegExp(${JSON.stringify(pattern)})`,
    `const out = []`,
    `for (const s of await listTaskSpaces()) {`,
    `  if (typeof s.name !== "string" || !re.test(s.name)) continue`,
    `  const t = await taskSpace(s.name).catch(() => undefined)`,
    `  if (t) await t.finish({ keep: [] }).then(() => out.push(s.name), () => undefined)`,
    `}`,
    `console.log(${JSON.stringify(MARK)} + JSON.stringify(out))`,
    "",
  ].join("\n")
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// the pattern of a run's spaces, every attempt of the checks named; of one
// space by its name.
export const runSpaces = (runId: string, checks: string[]) => `^${escape(spacePrefix(runId))}(?:${checks.map(escape).join("|")})-\\d+$`
export const oneSpace = (name: string) => `^${escape(name)}$`

// the JSON on a script's MARK line, or undefined.
export function marked(stdout: string): unknown {
  const line = stdout.split(/\r?\n/).find(l => l.startsWith(MARK))
  if (line === undefined) return undefined
  try {
    return JSON.parse(line.slice(MARK.length))
  } catch {
    return undefined
  }
}

export type Profile = { id: string; name: string }

export function profilesOf(stdout: string): Profile[] | undefined {
  const v = marked(stdout)
  return Array.isArray(v) ? v.filter((p): p is Profile => typeof p?.id === "string" && typeof p?.name === "string") : undefined
}

// the prefix of a run's spaces, and one attempt's space.
export const spacePrefix = (runId: string) => `rein-${runId}-`
export const spaceName = (runId: string, check: string, folder: string) => `${spacePrefix(runId)}${check}-${attemptOf(folder)}`

// the attempt number of an evidence folder `evidence/<check>/<n>`.
export const attemptOf = (folder: string) => Number(/(\d+)$/.exec(folder)?.[1] ?? 1)

// the ego profile id each check runs in: its account's profile from the
// app's `profiles`, else the app's `profile`, both by name, looked up in
// what ego lists. What is missing, in the words the halt gives.
export function resolveProfiles(e2e: E2e, checks: Check[], listed: Profile[]): { ids: Record<string, string> } | { missing: string[] } {
  const ids: Record<string, string> = {}
  const missing: string[] = []
  for (const k of checks) {
    const app: App | undefined = e2e.apps[k.app]
    const name = k.account ? app?.profiles?.[k.account] : app?.profile
    if (name === undefined) {
      missing.push(k.account ? `check ${k.name}: account ${k.account} has no profile in e2e.apps.${k.app}.profiles` : `check ${k.name}: e2e.apps.${k.app}.profile is not set`)
      continue
    }
    const found = listed.find(p => p.name === name)
    if (!found) missing.push(`check ${k.name}: ego has no profile named ${name}`)
    else ids[k.name] = found.id
  }
  return missing.length > 0 ? { missing: [...new Set(missing)] } : { ids }
}

// a check whose driver is on it: claimed or spawned, not yet done.
export const driving = (k: CheckRun) => isOpen(k) && k.runner !== undefined && !k.ego?.driven

// the checks a driver may take now, in 2-plan.md's order: the first open
// checks with no driver, while they fit beside the checks drivers have, up
// to AT_ONCE drivers. A check that saves runs alone; checks in one profile
// run together only as one account; the first that does not fit waits, and
// the ones after it with it. A check whose driver is done holds its
// profile's account until it is judged: the judge may send the driver back
// to the same space, and another account's login there would be what it sees.
export function egoStartable(checks: CheckRun[]): CheckRun[] {
  const group = checks.filter(driving)
  const held = checks.filter(k => isOpen(k) && k.runner !== undefined)
  const out: CheckRun[] = []
  for (const k of checks) {
    if (!isOpen(k) || k.runner !== undefined) continue
    const all = [...group, ...out]
    const alone = all.length === 0 || (!k.saves && all.every(g => !g.saves))
    const shared = [...held, ...out].every(g => g.ego?.profile !== k.ego?.profile || g.account === k.account)
    if (all.length >= AT_ONCE || !alone || !shared) break
    out.push(k)
  }
  return out
}

// the checks a judge may take now: done driving, no judge on them.
export const judgeable = (checks: CheckRun[]) => checks.filter(k => isOpen(k) && k.ego?.driven !== undefined && k.ego.judge === undefined)

// a check's minutes used, from what its clock kept and its run since.
export function usedMs(k: CheckRun, now: number): number {
  return (k.ego?.spentMs ?? 0) + (k.ego?.since !== undefined ? Math.max(0, now - k.ego.since) : 0)
}

// the most a round's Bash timeout may be: the check's time left, at most
// the tool's 10 minutes, in ms.
export function roundLimitMs(k: CheckRun, now: number): number {
  return Math.max(0, Math.min(10 * 60_000, k.minutes * 60_000 - usedMs(k, now)))
}

// a driver's round command for check k: `ego-browser nodejs < <file>`,
// the file a round-NN.mjs of the check's folder, alone. The round's file
// as the hook reads it, or why it is refused.
export function roundCommand(command: string, folder: string, root: string): { file: string; round: string } | { deny: string } {
  const form = `check rounds run only as \`ego-browser nodejs < ${folder}/round-NN.mjs\`, one command alone, with forward slashes`
  const m = /^\s*ego-browser\s+nodejs\s+<\s*(?:"([^"]+)"|'([^']+)'|([^\s"'`$;&|<>()\\]+))\s*$/.exec(command)
  const path = m?.[1] ?? m?.[2] ?? m?.[3]
  if (path === undefined || /[\\`$]/.test(path)) return { deny: `${form}. Bash runs nothing else: to see the evidence folder, list it with Glob and open a file with Read.` }
  const file = resolve(path, root)
  const round = /\/round-(\d{2})\.mjs$/.exec(file)?.[1]
  if (round === undefined || !same(file, `${folder}/round-${round}.mjs`)) return { deny: `${form}; ${path} is not a round file of that folder.` }
  return { file, round }
}

// the first line a round file must have: the harness import.
export function importsHarness(text: string, folder: string): boolean {
  return (text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "").trim() === importLine(folder)
}

// what a round's output says: the user holds the space (ego refused it,
// exit 0, measured), the script failed (`ego's nodejs process exited with
// code N`), or it ran.
export function roundOutcome(output: string): { kind: "user" } | { kind: "error"; code: number } | { kind: "ok" } {
  if (/Control of this task space is with the user/.test(output)) return { kind: "user" }
  const code = /ego's nodejs process exited with code (\d+)/.exec(output)?.[1]
  return code !== undefined ? { kind: "error", code: Number(code) } : { kind: "ok" }
}

// the files a round ends with, by round number.
export const roundEnds = (round: string) => ({ handoff: handoffFile(round), done: doneFile(round), lost: lostFile(round) })

// the judge's result: under `## 기대 대조`, one line per part of the
// expectation, `- <part>: <통과|실패|증거 부족> — <citation or reason>`, then
// `판정: <통과|실패|증거 부족>`, which follows from the parts. The parts, the
// verdict, the files cited and, for 증거 부족, what is missing; or the
// problem with the form. A part that passed must cite at least one file,
// and every file it cites must be in the check's folder; a judgment that
// breaks this is a problem too, for the judge to write again. For a check
// with data conditions, `## 데이터` comes first: one line per condition,
// `- <condition>: <맞음|안 맞음> — <citation or reason>`, then
// `데이터: <the data the check ran on>` (used), and a 맞음 condition cites
// files as a passed part does. When every part passed it is 통과 though a
// condition is 안 맞음; otherwise a condition 안 맞음 makes it 증거 부족, that
// condition being what is missing; `데이터: 없음 — <why>` alone, with no
// condition or part lines, makes it 데이터 없음.
export type Judged = { parts: string[]; verdict: "통과" | "실패" | "증거 부족" | "데이터 없음"; cited: string[]; missing?: string; used?: string }

const VERDICTS = ["통과", "실패", "증거 부족", "데이터 없음"] as const

// the evidence files a line cites: names the harness gives, round-NN-...,
// and the hook's records of the driver's MCP calls, mcp-NN.json.
const CITED = /round-\d{2}(?:-[\w.-]+)?\.(?:png|json|txt|log|mjs)|round-\d{2}-download-\d+-[^\s,)`'"]+|mcp-\d{2,}\.json/g

// the lines of a judge.md section, after its heading up to the next one.
function sectionOf(lines: string[], heading: RegExp): string[] | undefined {
  const at = lines.findIndex(l => heading.test(l))
  if (at < 0) return undefined
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l))
  return lines.slice(at + 1, end < 0 ? undefined : end)
}

export function parseJudge(text: string, inFolder: (name: string) => boolean, data = false): Judged | { problem: string } {
  const lines = text.split(/\r?\n/)
  const body = sectionOf(lines, /^##\s+기대 대조\s*$/)
  const dataForm = data ? "`## 데이터`, then one line per data condition `- <condition>: <맞음|안 맞음> — <the evidence files it cites, or why>` and one line `데이터: <the data the check ran on>` (only `데이터: 없음 — <why>`, with no condition and no part lines, when no data could be found or made), then " : ""
  const form = `judge.md needs ${dataForm}\`## 기대 대조\`, then one line per part of the expectation \`- <part>: <통과|실패|증거 부족> — <the evidence files it cites, or why>\`, then one line \`판정: <통과|실패|증거 부족${data ? "|데이터 없음" : ""}>\`.`
  if (body === undefined) return { problem: form }
  const parts: { text: string; verdict: string; rest: string }[] = []
  for (const l of body) {
    const m = /^\s*[-*]\s+(.+?):\s*(통과|실패|증거 부족)\s*[—–-]\s*(.*)$/.exec(l)
    if (m) parts.push({ text: m[1]!.trim(), verdict: m[2]!, rest: m[3]!.trim() })
  }
  const verdicts = body.map(l => /^\s*판정:\s*(.*?)\s*$/.exec(l)?.[1]).filter((v): v is string => v !== undefined)
  if (verdicts.length !== 1 || !VERDICTS.includes(verdicts[0] as never) || (!data && verdicts[0] === "데이터 없음")) return { problem: form }
  const said = verdicts[0] as Judged["verdict"]
  const conditions: { text: string; fits: boolean; rest: string }[] = []
  let used: string | undefined
  if (data) {
    const section = sectionOf(lines, /^##\s+데이터\s*$/)
    if (section === undefined) return { problem: form }
    for (const l of section) {
      const m = /^\s*[-*]\s+(.+?):\s*(맞음|안 맞음)\s*[—–-]\s*(.*)$/.exec(l)
      if (m) conditions.push({ text: m[1]!.trim(), fits: m[2] === "맞음", rest: m[3]!.trim() })
    }
    const named = section.map(l => /^\s*데이터:\s*(.*?)\s*$/.exec(l)?.[1]).filter((v): v is string => v !== undefined)
    if (named.length !== 1 || named[0] === "") return { problem: form }
    used = named[0]
  }
  const none = used !== undefined && /^없음(?:\s|[—–-]|$)/.test(used)
  if (none ? conditions.length > 0 || parts.length > 0 : parts.length === 0 || (data && conditions.length === 0)) return { problem: form }
  const unmet = conditions.filter(x => !x.fits)
  const own = none ? "데이터 없음" : parts.every(p => p.verdict === "통과") ? "통과" : unmet.length > 0 ? "증거 부족" : parts.some(p => p.verdict === "실패") ? "실패" : "증거 부족"
  const rule = `${data ? "데이터: 없음 is 데이터 없음, else " : ""}every part 통과 is 통과, ${data ? "else any condition 안 맞음 is 증거 부족, " : ""}any 실패 is 실패, else 증거 부족`
  if (said !== own) return { problem: `판정: ${said} does not follow from ${data ? "the data and " : ""}the parts, which make it ${own}: ${rule}.` }
  const citedBy = (rest: string) => [...rest.matchAll(CITED)].map(m => m[0])
  const shown = [...parts.filter(p => p.verdict === "통과").map(p => ({ ...p, how: "passed" })), ...conditions.filter(x => x.fits).map(x => ({ ...x, how: "fits" }))]
  const bad: string[] = []
  for (const p of shown) {
    const files = citedBy(p.rest)
    if (files.length === 0) bad.push(`"${p.text}" ${p.how} with no evidence file cited`)
    for (const f of files.filter(f => !inFolder(f))) bad.push(`"${p.text}" cites ${f}, which is not in the check's folder`)
  }
  if (bad.length > 0) return { problem: `${bad.join("; ")}. A 통과 part${data ? " or a 맞음 condition" : ""} cites the evidence files of the folder that show it, by name; if none shows it, it is ${data ? "증거 부족 or 안 맞음" : "증거 부족"}.` }
  const cited = [...new Set(shown.flatMap(p => citedBy(p.rest)))]
  const missing = [...unmet.map(x => `데이터 조건 「${x.text}」 안 맞음: ${x.rest}`), ...parts.filter(p => p.verdict === "증거 부족").map(p => `${p.text}: ${p.rest}`)].join("; ")
  return {
    parts: parts.map(p => `${p.text}: ${p.verdict} — ${p.rest}`),
    verdict: said,
    cited,
    ...(missing ? { missing } : {}),
    ...(used !== undefined ? { used } : {}),
  }
}

// how a judge decides a check's data conditions, before its expectation.
function dataJudging(): string[] {
  return [
    "Before the expectation, decide the data the check ran on. Other runs and people test on the same data, so the driver may have used other data than the task names, or made it (marked `E2E` and a date and time).",
    "- Find the data the task was done on, in the rounds and the mcp files. For each data condition, decide from them: 맞음 when a file shows that data meets it, 안 맞음 when the evidence shows otherwise or nothing shows it. A part of the expectation that rests on a condition 안 맞음 is 증거 부족 however its screen looks: without that data what shows may not mean the change works. Judge a part that does not rest on it as usual; when every part passes, 판정 is 통과 and the 안 맞음 line only records it. Otherwise the driver goes back for data that fits, so say on the condition's line what is missing.",
    "- Decide what is expected on that data only. Rows others added while the check ran (without its mark, when the driver made the data) are not this check's.",
    `- When the driver found no data that fits and could not make it (its summary starts \`${NO_DATA}\`), check that the mcp files and the rounds show it looked and tried. If they do, write no condition lines and no part lines, \`데이터: 없음 — <what it queried and why the data could not be made>\` and 판정: 데이터 없음. If they do not, it is 증거 부족, saying what it must still try.`,
  ]
}

// a check that changes the screen also has its layout judged, as the part
// LAYOUT. A 대조 check's screen looks the same before and after, so a
// layout defect there is not this change's.
const changes = (check: Check) => check.kind !== "대조"
const LAYOUT = "레이아웃"

// a failed check whose only failed part is LAYOUT: every part of its
// expectation passed, so it still shows what its 기대 says.
export function onlyLayoutFailed(k: CheckRun): boolean {
  const verdicts = (k.ego?.parts ?? []).map(p => /^(.+?): (통과|실패|증거 부족) — /.exec(p))
  return verdicts.some(m => m?.[1] === LAYOUT && m[2] === "실패") && verdicts.every(m => m !== null && (m[1] === LAYOUT || m[2] === "통과"))
}

// the task the hook gives the rein:ego-driver it spawns for check k: the
// check as 2-plan.md gives it, the app's url, login and note, the round form the
// hook accepts, the harness and what each of its functions records.
export function driverTask(e2e: E2e, check: Check, k: CheckRun, folder: string, guide: string | undefined, limitMs: number, last?: string): string {
  const app = e2e.apps[check.app]
  const url = app?.url ?? "(not in config e2e.apps)"
  return [
    `Drive check \`${k.name}\` of a Rein run's integration test in the ego browser and record the evidence a separate judge decides it by. Do not judge it, and do not fix anything.`,
    "",
    "The check:",
    `- App: ${url}`,
    ...(app?.login ? [`- Log in: ${app.login}`] : []),
    ...(app?.note ? [`- Mind in this app: ${app.note}`] : []),
    ...accountLine(check),
    ...(check.page && check.route ? [`- Page: ${check.page}, reached by the menus ${check.route}`] : []),
    `- Task: ${listed(check.todo, true)}`,
    `- Expected: ${listed(check.expect, false)}`,
    ...(check.data ? [`- Data conditions (what the task's data must be for the check to show what is expected): ${listed(check.data, false)}`] : []),
    ...(check.reference ? [`- Why this data (background, not to check): ${check.reference}`] : []),
    ...(check.evidence ?? []).map(ev => `- Evidence the plan asks for: ${ev.kind} — ${ev.text}`),
    `- Saving: ${savingRule(check)}`,
    ...(e2e.production.length > 0 ? [`- Production hosts, never to be opened: ${e2e.production.join(", ")}`] : []),
    `- Evidence folder: ${folder}`,
    `- Time limit: ${k.minutes} minutes in all, counted by the hook; the time the space is handed to the user does not count`,
    ...(last ? ["", `An earlier driver of this check stopped after round-${last}.mjs; its rounds and their logs are in the folder. Start at round-${String(Number(last) + 1).padStart(2, "0")}.mjs.`] : []),
    ...(k.ego?.returned ? ["", `The judge found evidence missing: ${k.ego.returned}. Collect only that, then call done() again.`] : []),
    "",
    "How you work, round by round:",
    `1. Write each round as a new file ${folder}/round-NN.mjs (01, 02, ...), whole, with Write, and run it with Bash in the foreground, as this one command and nothing more:`,
    `   ego-browser nodejs < ${folder}/round-NN.mjs`,
    `   Give the call a Bash timeout of at most the milliseconds the hook last gave (now ${limitMs}). Every round starts a new process: variables do not carry over, the browser tab does.`,
    '   A snapshot ref such as @12 holds only for the snapshot it came from: never reuse one from an earlier round or after the page changed. Pick a target by CSS (`css:input[name="user_id"]`), `text=` or `loc=role:` instead, narrow enough to match one element. A `loc=role:` always takes a name, `[name="..."]` or `[name*="..."]`, and `>> nth=N` follows only a CSS, `text=` or href selector, never a `loc=role:`.',
    "   A dialog (alert, confirm, prompt) does not carry over: the next round starts by dismissing one left open, and a confirm counts as cancelled. So click what opens it, acceptDialog() or dismissDialog() and record what follows in the same round.",
    "   Handle a dialog at once in the window it opened in: while it is open, a command to another window (the page that opened a popup) times out after about 30 seconds. The harness records the dialog's type and text in the round's log when you accept or dismiss it; do not record them yourself with consoleLog or a string you write.",
    "   When a part says something does not happen (a window does not open, only an alert shows), do the action and, in the same round, wait a few seconds, then for each page pages() lists save a measure noted with what must not appear, returning its location.href and document.title; the harness logs the alert.",
    "2. The first line of every round is exactly:",
    `   ${importLine(folder)}`,
    "   The harness opens this check's TaskSpace in its ego profile, blocks the production hosts, keeps goto on the app's host and logs every action. Use only what it exports. Never call taskSpace, listTaskSpaces, profiles, takeOverTaskSpace, claimTaskSpace, finish or cdp yourself.",
    `3. ${guide ? `Before your first round, read the ego-browser guide ${guide} with Read for how to use a Page (selectors, snapshot refs, waits, select, keyboard, mouse, popups, dialogs, file inputs). Skip its parts on spaces, profiles, handOff and finish: the harness does those.` : "The Page is an ego-browser Page: goto, click, fill, selectOption, press, waitForSelector, waitForURL, waitForFunction, evaluate, snapshot refs such as @12, `text=`, `loc=role:`, CSS."}`,
    "4. What the harness exports:",
    "   - page: the space's first Page. newPage() opens another; pages() lists them. Each acts like an ego Page, logged.",
    "   - shot(note, { page, fullPage }): a screenshot, for what the screen shows.",
    "   - snapshot(note, { page, scope }): the accessibility snapshot, saved and returned (use it to choose targets, too).",
    "   - measure(note, fn, arg, { page }): runs fn in the page and saves its code and result: counts, totals, the options of a closed select, the rows of a virtualized grid.",
    "   - appState(note, fn, arg, { page }): the same for the app's own state (a grid's data through its API, a store).",
    "   - server(note, url, init, { page }): a request from the page, saved with its response.",
    "   - network(note, { page, filter }): the requests the page sent in this round, with their status.",
    "   - consoleLog(note, { page }): the page's console messages and errors in this round.",
    "   - download(note, trigger, { page }): runs trigger (the click that downloads) and saves the file.",
    "   - handOff(what): hands the space to the user and ends the round. See step 7.",
    "   - done(summary): ends your work on the check. See step 8.",
    ...(check.data ? dataSteps() : ["5. Open the app, log in as the check says (the account, when one is named), reach the page by its menus and do the task. Open only the screens the task names; when you cannot find a screen or the data by the path it gives, record what you saw and call done() saying so, without searching elsewhere."]),
    "   Record evidence for every part of what is expected: a shot for what the screen shows, and measure, appState, server, network, consoleLog, download or snapshot for what a screenshot cannot show. Collect every piece the plan asks for. When the screen disagrees with what is expected, record that state too: the judge decides, not you.",
    ...(changes(check) ? [`   This check changes the screen, so the judge also decides its layout. On each screen the expectation is about, once the task is done, save a shot of the whole screen and one measure noted \`${LAYOUT}\` that returns, for the selects, inputs and grids on it: each one's left, right, top and width (getBoundingClientRect); for a select, the width of its widest option's text in its own font; for a grid, its container's width and the sum of its columns' widths. Record what it returns, whatever it shows.`] : []),
    "6. What a round's output means: `ego's nodejs process exited with code N` is an error in your script, not the app's failure; read it and write the next round. A notice that control of the task space is with the user means the user is using it: wait a minute, then run the same round file again. The hook's result after each round says what is next.",
    "7. handOff(what) only for what only a person can do: log in when the login text does not get you in, a second factor, a captcha; or what you cannot handle: a file picker, a browser permission prompt. Never for an app error or a screen that differs from what is expected. Say in what exactly what the user must do. shot() hands off by itself when ego's window is closed or minimized. Then stop and answer `넘김: <what>`; the main session resumes you once the user is done, and your next round takes the space back.",
    "8. When the evidence for every part is saved, call done(summary) as the last line of your last round, then answer `완료: <summary>` and stop. A judge then reads the evidence. If the main session later sends you what the judge found missing, collect only that, in new rounds, and call done() again.",
    "",
    "Write only round files; the harness writes every evidence file. The hook refuses anything else.",
  ].join("\n")
}

// the saving rule of a driver's task. A check with data conditions may
// make the data it needs when none fits, and put it back.
function savingRule(check: Check): string {
  if (check.saves) return "save only what the task says to save, and change nothing else"
  return check.data ? "do not save, change or delete anything, except data you make as step 5 says when no data fits the conditions" : "do not save, change or delete anything"
}

// the start of a driver's done() summary when no data fits the check's
// conditions and none could be made.
export const NO_DATA = "데이터 없음:"

// step 5 of a driver's task for a check with data conditions: check the
// task's data against them, find other data or make it when they no longer
// hold, and what it may never change.
function dataSteps(): string[] {
  return [
    "5. Open the app, log in as the check says (the account, when one is named) and reach the page by its menus. Before the task, check that the data the task names still meets every data condition: other runs and people test on the same data, so it may have changed since the plan was written.",
    "   Check it with the MCP tools you have (a database, say) and on the screen. Use MCP tools only to read: never run anything through them that saves, changes or deletes data. The hook records every MCP call you make, with its result, in the evidence folder (mcp-NN.json); the judge reads them.",
    "   When the task's data no longer meets every condition, find other data that does and that the check's account sees on this page, and do the task on it. You may change the data and the steps that reach it (search conditions, the row to click, paging). Never change the page, what is expected, whether the check changes the screen, or the account.",
    "   When no data meets the conditions, make it through the app's own screens; you may open the screen that creates it. Put a mark for this check alone into it (a name or memo field): `E2E` and the current month, day, hour, minute and second, such as `E2E1028143015`. Do the task on it, look only at what carries your mark, and once the evidence is saved put it back through the app (a disuse flag, deleting it). Rows others add while you work (other runs, people testing) are not yours: look past them.",
    `   When the data cannot be made either (no screen makes it, or the account may not), record what you queried and why it cannot be made, and call done() with a summary that starts \`${NO_DATA}\`.`,
    "   Open only the screens the task names and those you need for its data.",
  ]
}

// the task of the rein:ego-judge for check k: decide it from the evidence
// alone, part by part, into judge.md.
export function judgeTask(check: Check, k: CheckRun, folder: string, file: string, summary: string | undefined): string {
  return [
    `Judge check \`${k.name}\` of a Rein run's integration test from its evidence alone, and write the result. Do not fix anything; you cannot see the browser.`,
    "",
    "The check:",
    `- Task: ${listed(check.todo, true)}`,
    `- Expected: ${listed(check.expect, false)}`,
    ...(check.data ? [`- Data conditions (what the data the check ran on must be): ${listed(check.data, false)}`] : []),
    ...(check.evidence ?? []).map(ev => `- Evidence the plan asks for: ${ev.kind} — ${ev.text}`),
    ...(summary ? [`- The driver's summary (a claim, not evidence): ${summary}`] : []),
    "",
    `The evidence is in ${folder}. Read it with Read:`,
    "- round-NN.mjs: the code the driver ran. Read it to see what each measurement really measures.",
    "- round-NN.log: every action the driver took, with the page's url after it. An acceptDialog or dismissDialog line carries the dialog's type and text in its `dialog`.",
    "- round-NN-shot-K.png (screenshots; round-NN-shots.txt says what each is for), round-NN-snapshot-K.txt, round-NN-measure-K.json and round-NN-state-K.json (code and result), round-NN-server-K.json, round-NN-network-K.json, round-NN-console-K.json, round-NN-download-K-<name> files.",
    ...(check.data ? ["- mcp-NN.json: each MCP call the driver made (a database query, say), its input and result, recorded by the hook."] : []),
    "",
    "Start with the last round's log and its done file: the driver often collects the evidence late, after rounds that failed or were redone. Evidence for a part may be in any round, so decide a part 증거 부족 only after reading every round's log and the files it names.",
    ...(k.ego?.returns === 1 && k.ego.parts ? ["An earlier judge of this check found evidence missing, and the driver collected more in later rounds. Its parts were:", ...k.ego.parts.map(p => `- ${p}`), "Keep each part it found 통과, with its citation, unless the later rounds show otherwise; decide again only the parts it found 증거 부족, reading every round, the earlier ones too."] : []),
    "Decide a dialog's text from its `dialog` in round-NN.log, not from a console line or a string the driver wrote.",
    "",
    "1. Split what is expected into its parts: each thing that must hold on its own.",
    "2. For each part, decide from the evidence: 통과 when a file shows it; 실패 when the evidence shows otherwise; 증거 부족 when nothing recorded shows it either way. A measurement counts only when its code measures what the part says: options of a closed select counted from the DOM, not the visible one; every row of a virtualized grid from the app's data, not the rendered rows. A shot shows only what is on it.",
    ...(changes(check) ? [`   This check changes the screen, so add one more part, \`${LAYOUT}\`, decided from the shots and the driver's \`${LAYOUT}\` measure: 실패 when a select or input is wider than its widest content plus 60px, a grid's columns leave empty space in its container or overflow it, or fields that share a row or a column are out of line (their tops or edges differ by more than 3px); name the element and its numbers. 통과 when neither shows such a defect; 증거 부족 when the measure is missing. Judge only what the expected parts say appears or changes on the screen (a new or changed field, button, column, link); an element the task only uses (clicks, fills, uploads into) keeps the size and columns it had before this change, so note its defect in its line without failing it. When the expected parts name nothing on the screen, \`${LAYOUT}\` is 통과. When the expected parts are only about a printed or downloaded file, \`${LAYOUT}\` is 통과 (the screen is not what changed), citing the shot or the measure.`] : []),
    ...(check.data ? dataJudging() : []),
    `3. Write ${file} with Write, in exactly this form:`,
    "",
    ...(check.data ? ["## 데이터", "", "- <condition>: 맞음 — <the evidence files that show it, e.g. mcp-01.json, round-01-shot-1.png>", "- <condition>: 안 맞음 — <what the evidence shows instead, citing the files>", "", "데이터: <the data the check ran on: 후보 그대로, or what the driver used instead and why, or what it made>", ""] : []),
    "## 기대 대조",
    "",
    "- <part>: 통과 — <the evidence files that show it, by name, e.g. round-02-shot-1.png, round-02-measure-1.json, and what they show>",
    "- <part>: 실패 — <what the evidence shows instead, citing the files>",
    "- <part>: 증거 부족 — <what is missing and how the driver could record it>",
    "",
    `판정: <통과 | 실패 | 증거 부족${check.data ? " | 데이터 없음" : ""}>`,
    "",
    `판정 is ${check.data ? "데이터 없음 when no data could be found or made, else " : ""}통과 when every part passed, ${check.data ? "else 증거 부족 when any data condition is 안 맞음, " : ""}실패 when any part failed, else 증거 부족. Every 통과 part${check.data ? " and every 맞음 condition" : ""} must cite at least one file in the folder by name; the hook has you write it again otherwise.`,
    "",
    "When the hook has judged the file, answer with its result in one line and stop.",
  ].join("\n")
}
