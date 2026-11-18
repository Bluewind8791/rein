import { ASIDE_BASH_TIMEOUT, isOpen, runnerCommand } from "../lib/aside.ts"
import { checkChain, readOnly } from "../lib/bash.ts"
import { importsHarness, roundCommand } from "../lib/ego.ts"
import { importLine } from "../lib/egoHarness.ts"
import type { App, ConfigView } from "../lib/config.ts"
import { itemsOf, listed, type Check, type Layout } from "../lib/parse.ts"
import { same } from "../lib/paths.ts"
import type { CheckRun, Ctx, Passed, Run, Seal, StageSpec } from "../lib/state.ts"
import { CHECKLIST_TEMPLATE } from "./checklistTemplate.ts"
import { failedTail, type CommandResult } from "./qa.ts"
import { QA_INTEGRATION_TEMPLATE } from "./qaTemplate.ts"

// the integration reviewer's row: e2e.md; Bash only reads, as the reviewer's.
// aside runs only in the rein:e2e-runner agents (runnerRow).
export const qaIntegration: StageSpec = {
  write(path, c) {
    if (path !== undefined && same(path, `${c.dir}/agent/e2e.md`)) {
      return c.run.busy ? { deny: "D79: the hook is still judging the last e2e.md write; wait for its result." } : { allow: true }
    }
    return { deny: `D74: in the qa-integration stage only ${c.dir}/agent/e2e.md may be written.` }
  },

  // integrationGuard, on the file as the write would leave it.
  preWrite(tool, input, path, c) {
    if (!same(path, `${c.dir}/agent/e2e.md`)) return undefined
    if (tool === "NotebookEdit") return "D74: write e2e.md with Write or Edit."
    const before = c.previous ?? ""
    let after = typeof input.content === "string" ? input.content : before
    if (tool === "Edit") {
      const from = String(input.old_string ?? "")
      const to = String(input.new_string ?? "")
      if (from === "" || !before.includes(from)) return undefined
      after = input.replace_all === true ? before.split(from).join(to) : before.replace(from, () => to)
    }
    return integrationGuard(before, after)
  },

  bash: (command, c) => readOnly(command, c.run.repos ?? [], c.root, "D99"),

  toolRule: "D99",

  artifacts: ["agent/e2e.md"],
}

// the open check a rein:e2e-runner agent took, by its agentId.
export function runnerCheck(run: Run, agentId: string | undefined): CheckRun | undefined {
  return agentId === undefined ? undefined : run.e2e?.checks?.find(k => k.runner === agentId && isOpen(k))
}

// a check's result file, relative to the run directory, in its
// screenshot folder.
export const resultOf = (k: CheckRun) => `${k.evidence ?? `evidence/${k.name}`}/result.md`

// a rein:e2e-runner's row while its check is open: it writes the check's
// result file, and Bash runs its aside command in the form runnerCommand
// accepts, in the foreground under ASIDE_BASH_TIMEOUT, one call at a time.
// The prompt is the runner's own.
export function runnerRow(k: CheckRun): StageSpec {
  const result = resultOf(k)
  return {
    write(path, c) {
      if (path !== undefined && same(path, `${c.dir}/${result}`)) return { allow: true }
      return { deny: `the rein:e2e-runner of check ${k.name} writes only ${c.dir}/${result}.` }
    },
    preWrite: tool => (tool === "NotebookEdit" ? `write the result of check ${k.name} with Write.` : undefined),
    bash(command, c, input) {
      const checked = checkChain(command)
      if ("deny" in checked) return checked.deny
      const form = runnerCommand(checked.words, k, `${c.dir}/${k.evidence ?? `evidence/${k.name}`}`)
      if ("deny" in form) return form.deny
      if (k.running) return `check ${k.name}'s aside call is already running; wait for its result.`
      if (input.run_in_background === true) return "run aside in the foreground; the hook reads its output."
      if (input.timeout !== ASIDE_BASH_TIMEOUT) return `run aside with the Bash timeout ${ASIDE_BASH_TIMEOUT}.`
      return undefined
    },
    toolRule: "D99",
    artifacts: [result],
  }
}

// an ego check's evidence folder and its judge's result file, relative to
// the run directory.
export const folderOf = (k: CheckRun) => k.evidence ?? `evidence/${k.name}/1`
export const judgeOf = (k: CheckRun) => `${folderOf(k)}/judge.md`

// a rein:ego-driver's row while its check is open: it writes only round
// files of the check's folder, each starting with the harness import, and
// Bash runs only `ego-browser nodejs < <folder>/round-NN.mjs`, in the
// foreground. What the round may run on (its turn, the clock, the round
// number) the hook checks against the run as the call starts.
export function driverRow(k: CheckRun): StageSpec {
  const folder = folderOf(k)
  return {
    write(path, c) {
      const round = path === undefined ? undefined : /\/round-\d{2}\.mjs$/.exec(path.replace(/\\/g, "/"))
      if (path !== undefined && round && same(path, `${c.dir}/${folder}/${round[0].slice(1)}`)) return { allow: true }
      return { deny: `the rein:ego-driver of check ${k.name} writes only round files, ${c.dir}/${folder}/round-NN.mjs; the harness writes the evidence.` }
    },
    preWrite(tool, input, _path, c) {
      if (tool !== "Write") return `write each round of check ${k.name} whole, with Write, as a new round-NN.mjs.`
      const first = importLine(`${c.dir}/${folder}`)
      return importsHarness(String(input.content ?? ""), `${c.dir}/${folder}`) ? undefined : `a round's first line must be the harness import, exactly:\n${first}`
    },
    bash(command, c, input) {
      const form = roundCommand(command, `${c.dir}/${folder}`, c.root)
      if ("deny" in form) return form.deny
      if (input.run_in_background === true) return "run the round in the foreground; the hook reads its output."
      return undefined
    },
    toolRule: "D99",
  }
}

// a rein:ego-judge's row: it writes only its check's judge.md. It has no
// Bash; it reads the evidence.
export function judgeRow(k: CheckRun): StageSpec {
  const file = judgeOf(k)
  return {
    write(path, c) {
      if (path !== undefined && same(path, `${c.dir}/${file}`)) return { allow: true }
      return { deny: `the rein:ego-judge of check ${k.name} writes only ${c.dir}/${file}.` }
    },
    preWrite: tool => (tool === "NotebookEdit" ? `write the judgment of check ${k.name} with Write.` : undefined),
    bash: () => "the rein:ego-judge runs no command; it reads the evidence files.",
    toolRule: "D99",
    artifacts: [file],
  }
}

// the ego path once no check is open: a check whose time ran out, or
// whose space was lost twice, halts the run (D101) with no ## e2e; a failed
// check writes ## e2e and halts (D173); a check the user took to test by
// hand sends the run back to waiting for them, the checks that passed
// ticked; otherwise ## e2e from every verdict. undefined while one is open.
export function settleEgo(checks: CheckRun[]): { written?: string; halt?: { rule: "D101" | "D173"; reason: string }; wait?: true } | undefined {
  if (checks.some(isOpen)) return undefined
  const over = checks.filter(k => k.over)
  if (over.length > 0) return { halt: { rule: "D101", reason: over.map(k => (k.ego?.lost ?? 0) >= 2 ? `check ${k.name} lost its ego space twice` : `check ${k.name} ran past its ${k.minutes} minutes`).join("; ") } }
  const failed = checks.filter(k => k.verdict === "실패").map(k => k.name)
  if (failed.length > 0) return { written: egoSection(checks), halt: { rule: "D173", reason: `these ego checks failed: ${failed.join(", ")}` } }
  if (checks.some(k => k.ego?.human)) return { wait: true }
  return { written: egoSection(checks) }
}

// what a runner wrote in its check's result file: the session, the 관측
// line and the verdict, each on one line; the problem otherwise.
export function parseResult(text: string): { session: string; observed: string; verdict: "통과" | "실패" } | { problem: string } {
  const lines = text.split(/\r?\n/).map(l => l.trim())
  const one = (key: string) => {
    const found = lines.filter(l => l.startsWith(`${key}:`)).map(l => l.slice(key.length + 1).trim())
    return found.length === 1 && found[0] !== "" ? found[0] : undefined
  }
  const [session, observed, verdict] = [one("세션"), one("관측"), one("판정")]
  if (session === undefined || observed === undefined || (verdict !== "통과" && verdict !== "실패")) {
    return { problem: "the result file needs exactly one line each of `세션: <ID>`, `관측: <what aside saw>` and `판정: 통과` or `판정: 실패`." }
  }
  return { session, observed, verdict }
}

// the aside path once no check is open: a check whose time ran out halts
// the run (D101) with no ## e2e; otherwise the hook's ## e2e from every
// verdict, and a halt when one failed (D173). undefined while a check is open.
export function settleAside(checks: CheckRun[]): { written?: string; halt?: { rule: "D101" | "D173"; reason: string } } | undefined {
  if (checks.some(isOpen)) return undefined
  const over = checks.filter(k => k.over)
  if (over.length > 0) return { halt: { rule: "D101", reason: over.map(k => `check ${k.name} ran past its ${k.minutes} minutes`).join("; ") } }
  const failed = checks.filter(k => k.verdict === "실패").map(k => k.name)
  return { written: asideSection(checks), ...(failed.length > 0 ? { halt: { rule: "D173" as const, reason: `these aside checks failed: ${failed.join(", ")}` } } : {}) }
}

// QA_INTEGRATION_TEMPLATE up to `## 완료 판정 대조`, the part the hook
// fills, and from there, the part the completion reviewer fills.
const COMPLETION_AT = QA_INTEGRATION_TEMPLATE.indexOf("## 완료 판정 대조")
const E2E_TEMPLATE = QA_INTEGRATION_TEMPLATE.slice(0, COMPLETION_AT)
const COMPLETION_TEMPLATE = QA_INTEGRATION_TEMPLATE.slice(COMPLETION_AT)

type Values = Record<string, string>

// `{{name}}` filled from values; a line that is only `{{name}}` goes when
// its value is empty.
function fill(text: string, values: Values): string {
  return text
    .split("\n")
    .flatMap(line => {
      const only = /^\{\{(\w+)\}\}$/.exec(line)
      if (only) return values[only[1]!] ? [values[only[1]!]!] : []
      return [line.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m)]
    })
    .join("\n")
}

// the `## e2e` section from E2E_TEMPLATE: each block once per item of its
// name, blank lines between items, at most one blank line in a row outside
// code blocks.
function renderE2e(values: Values, blocks: Record<"check" | "command", Values[]>): string {
  let text = E2E_TEMPLATE
  for (const [name, items] of Object.entries(blocks)) {
    text = text.replace(blockOf(name), (_, body: string) => items.map(item => fill(body, item)).join("\n"))
  }
  return tidy(fill(text, values))
}

// `<!-- name -->` … `<!-- /name -->` of a template, its body captured.
const blockOf = (name: string) => new RegExp(`<!-- ${name} -->\\n([\\s\\S]*?)<!-- /${name} -->\\n`)

// at most one blank line in a row outside code blocks, none at either end,
// and no space at a line's end there (a list after `- 할 일:` leaves one).
function tidy(text: string): string {
  const out: string[] = []
  let fenced = false
  for (const raw of text.split("\n")) {
    if (raw.startsWith("```")) fenced = !fenced
    const line = fenced ? raw : raw.trimEnd()
    if (!fenced && line === "" && (out.length === 0 || out.at(-1) === "")) continue
    out.push(line)
  }
  return `${out.join("\n").trimEnd()}\n`
}

// 5-checklist.md from 2-plan.md's checks, every box empty: one section
// per page (with the menus that reach it, the app and its note), in the
// order the pages first appear, each check under its page in plan order:
// its title and kind, its steps numbered, a box per part of its
// expectation, and why its data was chosen. The account is the check's
// own, else the app's login says how, once for the page when its checks
// share it; the login itself stays out, since it may hold a password. A
// check from a plan before 페이지 and 경로 says so, one before 제목 shows its
// name. Then a box per screen of `## 배치 대조`, in plan order.
export function checklist(title: string, checks: Check[], apps: Record<string, App>, layouts: Layout[] = []): string {
  const pages = new Map<string, Check[]>()
  for (const k of checks) {
    const key = [k.app, k.page, k.route].join("\n")
    pages.set(key, [...(pages.get(key) ?? []), k])
  }
  const account = (k: Check) => k.account ?? `따로 없음 — ${k.app} 앱의 login 설정대로`
  const page = (body: string, group: Check[]) => {
    const first = group[0]!
    const shared = group.every(k => k.account === first.account)
    const block = blockOf("check").exec(body)!
    const head = fill(body.slice(0, block.index), {
      page: first.page || "(페이지 기록 없음)",
      route: first.route || "(기록 없음)",
      app: first.app,
      url: apps[first.app]?.url ?? "",
      pageAccount: shared ? `- 계정: ${account(first)}` : "",
      note: apps[first.app]?.note ? `- 주의: ${apps[first.app]!.note}` : "",
    })
    const check = group.map(k => fill(block[1]!, {
      head: k.title ? `**${k.title}** — ${k.kind === "대조" ? "대조군 (바뀌면 안 됨)" : "변경 확인"} · \`${k.name}\`` : `**${k.name}**`,
      account: shared ? "" : `  - 계정: ${account(k)}`,
      todo: listed(k.todo, true, "    "),
      expect: itemsOf(k.expect).map(x => `    - [ ] ${x}`).join("\n"),
      saves: k.saves ? "  - 저장: 할 일대로 저장하고, 원래 값으로 되돌립니다" : "",
      reference: k.reference ? `  - 참고: ${k.reference}` : "",
    }))
    return `${head}${check.join("\n")}${body.slice(block.index + block[0].length)}`
  }
  const text = CHECKLIST_TEMPLATE.replace(blockOf("page"), (_, body: string) => [...pages.values()].map(group => page(body, group)).join("\n"))
    .replace(blockOf("layouts"), (_, body: string) => (layouts.length === 0 ? "" : body.replace(blockOf("layout"), (__, item: string) => layouts.map(l => fill(item, { ...l })).join("\n"))))
  const e2e = checks.length > 0 ? "- aside에 맡기려면: `/rein:e2e` — 기대 칸을 모두 체크한 항목은 건너뛰고, 통과한 항목은 훅이 체크합니다" : ""
  return tidy(fill(text, { title, e2e }))
}

// the screens of `## 배치 대조` whose box in 5-checklist.md is not checked;
// all of them when the file is gone.
export function openLayouts(text: string | undefined, layouts: Layout[]): string[] {
  const done = (a: string) => text !== undefined && new RegExp(`^\\s*[-*+]\\s+\\[[xX]\\]\\s+\\*\\*배치 ${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*`, "m").test(text)
  return layouts.filter(l => !done(l.anchor)).map(l => l.anchor)
}

// 5-checklist.md with the boxes of check `name`'s expectation checked and
// why at the end of its line, when one of them is still empty; the text as
// it was otherwise.
export function tick(text: string, name: string, why: string): string {
  const lines = text.split("\n")
  const { at, end } = checkLines(lines, name)
  if (at < 0 || !lines.slice(at + 1, end).some(l => EMPTY_BOX.test(l))) return text
  lines[at] = lines[at]!.replace(/^(.*?)(\r?)$/, (_, line: string, cr: string) => `${line} (${why})${cr}`)
  for (let i = at + 1; i < end; i++) lines[i] = lines[i]!.replace(EMPTY_BOX, "$1[x]")
  return lines.join("\n")
}

// whether the person checked every box of check `name`'s expectation in
// 5-checklist.md themselves: none is empty, and the hook did not check them
// (its tick leaves why at the end of the check's line).
export function handChecked(text: string, name: string): boolean {
  const lines = text.split(/\r?\n/)
  const { at, end } = checkLines(lines, name)
  const under = lines.slice(at + 1, end)
  const own = new RegExp(`(?:^- \\*\\*${name}\\*\\*| · \`${name}\`)\\s*$`)
  return at >= 0 && own.test(lines[at]!) && under.some(l => /^\s+[-*+]\s+\[[xX]\]/.test(l)) && !under.some(l => EMPTY_BOX.test(l))
}

const EMPTY_BOX = /^(\s+[-*+]\s+)\[ \]/

// whether every box of check `name`'s expectation in 5-checklist.md is
// checked, by the person or the hook; a box the person unchecked again
// has the check run.
export function allChecked(text: string, name: string): boolean {
  const lines = text.split(/\r?\n/)
  const { at, end } = checkLines(lines, name)
  const under = lines.slice(at + 1, end)
  return at >= 0 && under.some(l => /^\s+[-*+]\s+\[[xX]\]/.test(l)) && !under.some(l => EMPTY_BOX.test(l))
}

// the line of check `name` in 5-checklist.md, and the end of the indented
// lines under it; at is -1 when the file has no such check.
function checkLines(lines: string[], name: string): { at: number; end: number } {
  const at = lines.findIndex(l => new RegExp(`^- (?:\\*\\*${name}\\*\\*|.* · \`${name}\`)`).test(l))
  let end = at + 1
  while (at >= 0 && end < lines.length && /^\s+\S/.test(lines[end]!)) end++
  return { at, end }
}

// why a check's box is checked, or its result says, when its pass is
// from an earlier visit: none of the files it rests on changed, or
// rein:impact found the change does not touch it.
export const CARRIED = "이전 통과 유지 — 파일 변경 없음"
export const CLEARED = "이전 통과 유지 — 코드가 바뀌었지만 영향 없다고 판정 (agent/impact.md)"
export const carriedWhy = (k: CheckRun): string => (k.cleared ? CLEARED : CARRIED)

// why the hook ticks a check, as a link to its evidence the frame opens: a
// path relative to the run folder, each segment and the fragment encoded.
const linkTo = (path: string, fragment?: string) => `${path.split("/").map(encodeURIComponent).join("/")}${fragment === undefined ? "" : `#${encodeURIComponent(fragment)}`}`
const evidenceOf = (k: CheckRun): string | undefined => {
  if (k.ego !== undefined) return k.evidence === undefined ? undefined : linkTo(judgeOf(k))
  return k.runner !== undefined || k.session !== undefined ? linkTo("agent/e2e.md", k.name) : undefined
}
export const egoTick = (k: CheckRun): string => `[ego 통과](${linkTo(judgeOf(k))})`
export const asideTick = (k: CheckRun): string => `[aside 통과](${linkTo("agent/e2e.md", k.name)})`
// a pass kept from an earlier visit links that pass's evidence: its judge.md
// on the ego path, its section of e2e.md on the aside path; the plain words
// when the record cannot tell which (the person's pass, say).
export function carriedTick(k: CheckRun): string {
  const link = evidenceOf(k)
  return link === undefined ? carriedWhy(k) : `[${carriedWhy(k)}](${link})`
}

// the files a check's pass rests on: those its `- 파일:` names, or every
// sealed file when it names none (a 대조 check, say).
const restsOn = (run: Run, k: Check | undefined): string[] => (k?.files?.length ? k.files : Object.keys(run.sealed ?? {}))

// the passes kept once check k has its verdict: k's earlier record goes,
// and a pass is kept with the seal's value of each file it rests on, when
// the seal has them all.
export function remember(run: Run, k: CheckRun): Passed[] | undefined {
  const kept = (run.passed ?? []).filter(p => p.name !== k.name)
  const files = restsOn(run, run.checks?.find(x => x.name === k.name))
  const seal = run.sealed
  if (k.verdict === "통과" && files.length > 0 && seal && files.every(f => seal[f] !== undefined)) {
    kept.push({ ...k, files: Object.fromEntries(files.map(f => [f, seal[f]!])) })
  }
  return kept.length > 0 ? kept : undefined
}

// check k's pass from an earlier visit and the files it rests on that
// changed since, by the seal; undefined when it has none to carry.
function changedSince(run: Run, k: Check): { pass: Passed; changed: string[] } | undefined {
  const pass = run.passed?.find(x => x.name === k.name)
  const seal = run.sealed
  if (!pass || !seal || Object.keys(pass.files).length === 0) return undefined
  return { pass, changed: Object.keys(pass.files).filter(f => seal[f] !== pass.files[f]) }
}

const sameSeal = (a: Seal, b: Seal) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(f => a[f] === b[f])

// rein:impact's verdict on check `name`, when it judged it under the
// current seal; a check it was asked about and gave no verdict is affected.
function verdictOf(run: Run, name: string): { affected: boolean; why: string } | undefined {
  const i = run.impact
  if (!i?.verdicts || !i.doubt.includes(name) || !run.sealed || !sameSeal(i.sealed, run.sealed)) return undefined
  return i.verdicts[name] ?? { affected: true, why: "판정 없음" }
}

// check k's pass from an earlier visit, when none of the files it rests on
// changed since, or rein:impact found the change does not touch it.
export function carriedPass(run: Run, k: Check): CheckRun | undefined {
  const since = changedSince(run, k)
  if (!since) return undefined
  const { files: _files, cleared: _cleared, ...held } = since.pass
  if (since.changed.length === 0) return { ...held, carried: true }
  return verdictOf(run, k.name)?.affected === false ? { ...held, carried: true, cleared: true } : undefined
}

// the checks whose earlier pass rests on files changed since, each with
// those files and the seal value it passed on, that rein:impact has not
// judged under the current seal.
export function doubtful(run: Run): { name: string; files: { path: string; was: string }[] }[] {
  return (run.checks ?? []).flatMap(k => {
    const since = changedSince(run, k)
    if (!since || since.changed.length === 0 || verdictOf(run, k.name) !== undefined) return []
    return [{ name: k.name, files: since.changed.map(path => ({ path, was: since.pass.files[path]! })) }]
  })
}

// impact.md as rein:impact wrote it: per check asked about, under
// `### <name>`, `- 판정: 영향 없음` or `- 판정: 영향 있음` and `- 이유: ...`.
// A check with no such verdict is affected.
export function parseImpact(text: string, names: string[]): Record<string, { affected: boolean; why: string }> {
  const out: Record<string, { affected: boolean; why: string }> = {}
  const sections = text.split(/^### +/m).slice(1)
  for (const name of names) {
    const body = sections.find(x => x.split(/\r?\n/)[0]!.trim().replace(/^`|`$/g, "") === name)
    const verdict = body && /^- 판정:\s*(영향 없음|영향 있음)\s*$/m.exec(body)?.[1]
    const why = (body && /^- 이유:\s*(.+)$/m.exec(body)?.[1]?.trim()) || ""
    out[name] = verdict ? { affected: verdict === "영향 있음", why } : { affected: true, why: "판정 없음 — impact.md에 이 check의 `- 판정:` 줄이 없음" }
  }
  return out
}

export const IMPACT_FILE = "agent/impact.md"
export const IMPACT_DIFF = "agent/impact-diff.md"

// rein:impact's row: it writes only impact.md, whole, and runs nothing.
export function impactRow(): StageSpec {
  return {
    write(path, c) {
      if (path !== undefined && same(path, `${c.dir}/${IMPACT_FILE}`)) return { allow: true }
      return { deny: `rein:impact writes only ${c.dir}/${IMPACT_FILE}.` }
    },
    preWrite: tool => (tool === "Write" ? undefined : "write impact.md whole, with Write."),
    bash: () => "rein:impact runs no command; the diff is in impact-diff.md.",
    toolRule: "D99",
    artifacts: [IMPACT_FILE],
  }
}

// rein:impact's task: each check whose earlier pass is in question, as
// 2-plan.md gives it, with the files changed since and where their diff is.
export function impactTask(dir: string, checks: Check[], doubt: { name: string; files: { path: string }[] }[]): string {
  const item = (d: (typeof doubt)[number]) => {
    const k = checks.find(x => x.name === d.name)!
    return [
      `### ${k.name}`,
      ...(k.title ? [`- 제목: ${k.title}`] : []),
      ...(k.kind ? [`- 구분: ${k.kind}`] : []),
      ...(k.page ? [`- 페이지: ${k.page}`] : []),
      `- 할 일: ${listed(k.todo, true)}`,
      `- 기대: ${listed(k.expect, false)}`,
      `- 통과 뒤 바뀐 파일: ${d.files.map(f => f.path).join(", ")}`,
    ].join("\n")
  }
  return [
    "Judge whether a Rein run's code change since some e2e checks passed can change what those checks saw. Do not fix anything.",
    `Each check below passed in the browser on an earlier version of the code. Since then the files listed under it changed. The diff of each such file, from the version the check passed on to now, is in ${dir}/${IMPACT_DIFF}, one section per file and version. Read the diffs and, where you need it, the current files and the code they call, with Read, Grep and Glob.`,
    "For each check decide: 영향 없음 when no changed line can change what its steps do or what its expectation says it sees (another tab's code, a popup it does not open, a comment, a rename the screen does not show); 영향 있음 when a changed line runs on its steps' path or feeds what it sees (a query its numbers come from, the markup or script of the screen or popup it opens, a shared function either calls), or when you cannot tell. A check judged 영향 없음 is not run again, so be sure.",
    `Write ${dir}/${IMPACT_FILE} once, whole, with Write, one section per check, in this form:`,
    "```markdown\n## 영향 판정\n\n### <check name>\n- 판정: 영향 없음\n- 이유: <the changed lines and why they do not reach this check, or what they change that it sees>\n```",
    "`- 판정:` is exactly `영향 없음` or `영향 있음`. A check with no such line is run again. Then answer in one line with the hook's result and stop.",
    "## Checks",
    ...doubt.map(item),
  ].join("\n\n")
}

// the passes kept as plan passes again with checks and configs: those
// whose check the new design gives as it was (its app, route, steps,
// expectation, saves, account and files), while no config's e2e changed
// (sameE2e). Each still runs again at the next entry unless carriedPass
// finds its files unchanged.
export function keptPasses(run: Run, checks: Check[], hashes: Record<string, string>, views: Record<string, ConfigView>): Passed[] | undefined {
  if (!sameE2e(run, hashes, views)) return undefined
  const kept = (run.passed ?? []).filter(p => {
    const before = run.checks?.find(k => k.name === p.name)
    const now = checks.find(k => k.name === p.name)
    return before !== undefined && now !== undefined && sameCheck(before, now)
  })
  return kept.length > 0 ? kept : undefined
}

// whether the configs as they are now (their hashes and views) give every
// e2e check what the frozen ones gave: the same repositories, and the `e2e`
// of each as the person last approved it (configSeen). qa, qa-integration
// and worktree.setup do not change what a check sees. A repository with no
// approved view kept is compared by its whole file.
export function sameE2e(run: Run, hashes: Record<string, string>, views: Record<string, ConfigView>): boolean {
  const was = run.configHashes ?? {}
  const repos = Object.keys(hashes)
  if (repos.length !== Object.keys(was).length || repos.some(repo => was[repo] === undefined)) return false
  return repos.every(repo => {
    const seen = run.configSeen?.[repo]
    const now = views[repo]
    return seen !== undefined && now !== undefined ? JSON.stringify(seen.e2e) === JSON.stringify(now.e2e) : was[repo] === hashes[repo]
  })
}

const sameCheck = (a: Check, b: Check) => {
  const af = a.files ?? []
  const bf = b.files ?? []
  return a.app === b.app && a.route === b.route && a.todo === b.todo && a.expect === b.expect && a.reference === b.reference && a.saves === b.saves && a.account === b.account &&
    af.length === bf.length && af.every(f => bf.some(g => same(f, g))) && JSON.stringify(a.evidence ?? []) === JSON.stringify(b.evidence ?? [])
}

// the boxes of 5-checklist.md still empty, each line as written; a box of
// an expectation as `- [ ] **<its check's title>**: <the line>`.
export function unchecked(text: string): string[] {
  let title: string | undefined
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^[-*+]\s/.test(line)) title = /\*\*(.+?)\*\*/.exec(line)?.[1]
    const box = /^(\s*)[-*+]\s+\[ \]\s*(.*)$/.exec(line)
    if (box) out.push(box[1] && title ? `- [ ] **${title}**: ${box[2]}` : line.trim())
  }
  return out
}

// the `## e2e` section the hook writes itself on the command path
// or when there is no e2e at all.
export function e2eSection(results: CommandResult[] | undefined): string {
  if (!results) return renderE2e({ method: "없음 — e2e 설정도 qa-integration 명령도 없음", verdict: "통과" }, { check: [], command: [] })
  const verdict = results.every(r => r.exit === 0) ? "통과" : "실패"
  const command = results.map(r => ({ cmd: r.cmd, root: r.root, exit: String(r.exit) }))
  return renderE2e({ method: "qa-integration 명령 실행", output: failedTail(results) ?? "", verdict }, { check: [], command })
}

// the 증거 of a check aside passed with no screenshot.
export const UNSHOT = "없음 — aside는 통과라 했지만 스크린샷이 없어 실패로 봄 (D177)"

// what a check came to, as a person reads it.
function result(k: CheckRun): string {
  if (k.checked) return "통과 (사용자가 체크리스트로 확인)"
  const verdict = k.unshot ? "실패 (aside는 통과라 했지만 스크린샷이 없음)" : k.ego?.human ? "없음 — 넘긴 화면을 사용자가 직접 확인하기로 함" : k.over ? "없음 — 판정 없이 닫힘 (시간 초과나 스페이스 유실)" : (k.verdict ?? "진행 중")
  const person = k.person ? " → 사용자가 기존 동작으로 판단" : ""
  const varied = k.varied ? " (훅이 준 명령과 다르게 실행됨)" : ""
  const carried = k.carried ? ` (${carriedWhy(k)})` : ""
  return `${verdict}${person}${varied}${carried}`
}

// the `## e2e` section the hook writes once every aside check has a
// verdict: each check with what it was asked, the account it logged in
// as (the check's own, else the app's login, whose password stays out),
// what aside saw, its result and the person's judgment where they passed a
// failure as what the code did before, and its screenshots, each also as an
// image line a markdown preview shows. A check from before todo was kept
// says so. The section passes when every check passed or was passed by the
// person; verdict, when given, is its 판정 instead.
export function asideSection(checks: CheckRun[], verdict?: string): string {
  return checksSection(checks, "aside가 화면을 직접 확인함", "aside 세션", verdict)
}

// the `## e2e` section of the ego path: as asideSection, what the judge
// found part by part as 본 것, the space for the session, and every
// evidence file its passed parts cite.
export function egoSection(checks: CheckRun[], verdict?: string): string {
  return checksSection(checks, "ego에서 rein:ego-driver가 조작하고, rein:ego-judge가 증거 파일로 판정함", "ego 스페이스", verdict)
}

// the `## e2e` section while the hook has not written its own: each check
// as it stands, an open one 진행 중, and the section 판정: 미정, so a
// stop before every check closes still leaves what ran.
export function progressSection(checks: CheckRun[], browser: "aside" | "ego"): string {
  return browser === "ego" ? egoSection(checks, "미정") : asideSection(checks, "미정")
}

// a path relative to the run folder, as e2e.md in its agent/ links it.
const fromAgent = (path: string) => (path.startsWith("agent/") ? path.slice("agent/".length) : `../${path}`)

function checksSection(checks: CheckRun[], method: string, sessionLabel: string, overall?: string): string {
  const check = checks.map(k => ({
    name: k.name,
    todo: k.todo === undefined ? "(기록 없음)" : listed(k.todo, true),
    expect: k.expect === undefined ? "(기록 없음)" : listed(k.expect, false),
    account: k.account ?? (k.todo === undefined ? "(기록 없음)" : "앱 login 설정대로"),
    observed: k.observed ?? "(없음)",
    result: result(k),
    sessionLabel,
    session: k.session ?? "없음",
    shots: k.shots?.length ? k.shots.join(", ") : "없음",
    cited: k.cited?.length ? `- 증거: ${k.cited.join(", ")}` : "",
    images: (k.shots ?? []).map(s => `![](${fromAgent(s).replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`).join("\n"),
  }))
  const verdict = overall ?? (checks.every(k => k.verdict === "통과" || k.person) ? "통과" : "실패")
  return renderE2e({ method, verdict }, { check, command: [] })
}

// the `## e2e` section when 2-plan.md's `## e2e 확인` says 없음.
export const E2E_NONE = renderE2e({ method: "없음 — 2-plan.md에 화면 확인 항목이 없음", verdict: "통과" }, { check: [], command: [] })

// the `## e2e` section when the person ran the checks of 5-checklist.md
// by hand and checked every box.
export const E2E_MANUAL = renderE2e({ method: "사용자가 5-checklist.md대로 직접 확인함 — 모든 칸 체크", verdict: "통과" }, { check: [], command: [] })

// the `## e2e` section when e2e was configured but aside could not run
// and the person chose to go on without it.
export const E2E_SKIPPED = renderE2e({ method: "없음 — aside를 쓸 수 없어 사용자가 e2e 없이 진행하기로 함", verdict: "통과" }, { check: [], command: [] })

// what an entry the person asked for left, in one sentence, from the
// run as it stands after it.
export function entryOutcome(run: Run | undefined, noE2e: boolean): string {
  if (!run) return "The run is gone."
  if (run.halt) return `The integration entry ran again but halted (${run.halt.rule}: ${run.halt.reason}).`
  if (run.stage === "qa-integration") {
    if (run.e2e?.path === "wait") return "The run is in qa-integration, waiting for the user to test by 5-checklist.md or run /rein:e2e."
    if (run.e2e?.path === "aside") return "Aside is available; the run is in qa-integration on the aside path."
    if (run.e2e?.path === "ego") return "Ego is available; the run is in qa-integration on the ego path."
    if (run.e2e?.path === "none") return noE2e ? "The user chose to go on without e2e." : "The run is in qa-integration with no e2e to run."
    return "The run is in qa-integration on the command path."
  }
  return `The integration entry moved the run to ${run.stage}.`
}

// the completion reviewer's whole task, built by the hook at
// agent.spawn in place of what the main session wrote.
export function completionTask(run: Run, dir: string, completion: string): string {
  return [
    "Check a Rein run's completion line (D70). Do not fix anything.",
    "",
    `The line, from ${dir}/1-spec.md under \`## 완료 판정\`:`,
    completion,
    "",
    `What e2e checked: the \`## e2e\` section of ${dir}/agent/e2e.md. What changed: \`git -C <root> diff\` in ${(run.repos ?? []).join(", ") || "the run's repositories"}; read new files with Read.`,
    `How each part of the line is checked: the \`## 완료 판정 덮기\` section of ${dir}/2-plan.md (D169), each part by e2e checks, a test file, or 확인 불가 with a reason.`,
    "",
    "Decide only whether that line is now true. Ask for nothing the line does not say.",
    "The line is true only when every part of it is shown true. A part is not shown when no line of `## 완료 판정 덮기` covers it, when what covers it does not show it (read the test file; read the check's 본 것 in `## e2e` and, with Read, the screenshots on its 스크린샷 line, paths relative to the folder of e2e.md), when its 확인 불가 reason does not hold, or when only e2e checks the user passed as 기존 동작 cover it (their 결과 in `## e2e` says 사용자가 기존 동작으로 판단). A check passed as 기존 동작 whose only failed part is 레이아웃 still shows what its 기대 says: count it. A check whose 결과 says 사용자가 체크리스트로 확인 was tested by the person by hand, every part of its 기대 checked: it shows what its 기대 says, the surest evidence there is, though it has no 본 것 or screenshot. An aside check with screenshots shows a part only when they show it as its 본 것 says (D177); a 본 것 its screenshots do not bear out shows nothing. Any part not shown makes the verdict 실패. If 2-plan.md has no `## 완료 판정 덮기` (a plan from before D169), judge the line from `## e2e` and the diff.",
    "",
    `Keep \`## e2e\` of ${dir}/agent/e2e.md exactly as it is and add after it, with Edit (or Write of the whole file, \`## e2e\` and any \`## ${HISTORY}\` unchanged), this form, the <...> filled in:`,
    "",
    COMPLETION_TEMPLATE.replace("{{completion}}", () => completion).trimEnd(),
    "",
    "Give each part of `## 완료 판정 덮기` one line, the part copied as it is there (without that section, the parts you cut the line into). Say what showed it: for e2e checks, the check and the value its screenshot shows; for a test file, the file and what its test asserts; for 확인 불가, why the reason holds. These lines are what the person reads to see why the run passed (D208).",
    "",
    "The verdict is exactly 통과 or 실패, and the quote stays character for character. When the hook has judged the file, answer with the outcome in one line and stop.",
  ].join("\n")
}

// the spec's completion line, the first line under `## 완료 판정`,
// before any next heading; undefined when there is none.
export function completionLine(spec: string): string | undefined {
  const lines = spec.split(/\r?\n/)
  const at = lines.findIndex(l => /^##\s+완료 판정\s*$/.test(l))
  if (at < 0) return undefined
  for (const line of lines.slice(at + 1)) {
    if (/^#/.test(line)) return undefined
    if (line.trim() !== "") return line.trim()
  }
  return undefined
}

// The text of one `## <title>` section, up to the next `## ` heading;
// undefined when absent.
export function sectionText(text: string, title: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(l => l.trim() === `## ${title}`)
  if (at < 0) return undefined
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l))
  return lines.slice(at, end < 0 ? undefined : end).join("\n").trimEnd()
}

// the recorded integration reviewer adds or changes `## 완료
// 판정 대조` and leaves `## e2e` as it was. Only its write is judged.
// The deny text, or undefined.
export function integrationGuard(before: string, after: string): string | undefined {
  if (sectionText(before, "e2e") !== sectionText(after, "e2e")) return "D75: the integration reviewer may not change the ## e2e section; add ## 완료 판정 대조 after it."
  if (sectionText(before, HISTORY) !== sectionText(after, HISTORY)) return `the integration reviewer may not change ## ${HISTORY}, what earlier entries left; keep it as it is.`
  return undefined
}

// the section at the end of e2e.md that keeps what earlier entries left.
const HISTORY = "이전 진입"

// e2e.md as the hook writes text into it: `## 이전 진입` stays at the
// end. With archive (an entry starting over), what the file held before
// goes there first as the next 진입, its headings one level down, so the
// verdict lines of an earlier entry never count as this one's.
export function withHistory(old: string, text: string, archive: boolean): string {
  const lines = old.split(/\r?\n/)
  const at = lines.findIndex(l => l.trim() === `## ${HISTORY}`)
  const end = at < 0 ? -1 : lines.findIndex((l, i) => i > at && /^##\s/.test(l))
  let history = at < 0 ? undefined : lines.slice(at, end < 0 ? undefined : end).join("\n").trimEnd()
  const current = at < 0 ? old : [...lines.slice(0, at), ...(end < 0 ? [] : lines.slice(end))].join("\n")
  if (archive && current.trim() !== "") {
    const n = Math.max(0, ...[...(history ?? "").matchAll(/^### (\d+)차 진입 — /gm)].map(m => Number(m[1]))) + 1
    const moved = current.trim().split(/\r?\n/).map(l => (/^##\s/.test(l) ? `### ${n}차 진입 — ${l.slice(2).trim()}` : /^#{3,5}\s/.test(l) ? `#${l}` : l))
    history = `${history ?? `## ${HISTORY}`}\n\n${moved.join("\n")}`
  }
  if (history === undefined) return text
  return text.trim() === "" ? `${history}\n` : `${text.trimEnd()}\n\n${history}\n`
}

type Section = { verdict?: string; session?: string; quote?: string; verdicts: number }

function sections(text: string): Record<string, Section> {
  const out: Record<string, Section> = {}
  let current: Section | undefined
  for (const line of text.split(/\r?\n/)) {
    const head = /^##\s+(.+?)\s*$/.exec(line)
    if (head) {
      current = { verdicts: 0 }
      out[head[1]!] = current
      continue
    }
    if (!current) continue
    const verdict = /^\s*판정:\s*(.*?)\s*$/.exec(line)
    if (verdict) {
      current.verdicts++
      current.verdict = verdict[1]
    }
    const session = /^\s*세션:\s*(\S+)\s*$/.exec(line)
    if (session) current.session = session[1]
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote && current.quote === undefined) current.quote = quote[1]!.trim()
  }
  return out
}

export type IntegrationOutcome =
  | { kind: "stay"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "land" }

// ① `## e2e` and `## 완료 판정 대조` ② one `판정: 통과|실패` each ③ the
// quote is the spec's completion line ④ `## e2e` is the hook's own, as it
// wrote it, and passed: on the aside path every check passed or
// the person passed it; on the command path every stored exit is 0. An e2e
// failure never reaches here as a pass: a failed command went to dev at the
// entry, a failed check halted the run for the person. A
// completion 실패 halts the run; the main session decides where it goes. e2e passed with no completion
// section yet: stay for the reviewer. While the run waits for the person's
// choice nothing has run; on the manual path the boxes they checked are the
// verdict, so no completion check follows.
export function judgeIntegration(text: string, run: Run, completion: string | undefined): IntegrationOutcome {
  const path = run.e2e?.path ?? "none"
  if (path === "wait") return { kind: "stay", reason: "integration qa has not run: the user tests by 5-checklist.md, or runs /rein:e2e. Tell the user and stop." }
  const s = sections(text)
  const e2e = s["e2e"]
  const valid = (x: Section | undefined) => x !== undefined && x.verdicts === 1 && (x.verdict === "통과" || x.verdict === "실패")
  const written = run.e2e?.written
  if (path === "aside" && written === undefined) return { kind: "stay", reason: "aside has not run every check yet; spawn the rein:e2e-runner agents mcp__rein__status asks for, and wait for them. The hook writes `## e2e` itself (D173)." }
  if (path === "ego" && written === undefined) return { kind: "stay", reason: "the ego checks are not all judged yet; spawn the rein:ego-driver and rein:ego-judge agents mcp__rein__status asks for, and wait for them. The hook writes `## e2e` itself (D173)." }
  if (!valid(e2e)) return { kind: "stay", reason: "`## e2e` needs exactly one line `판정: 통과` or `판정: 실패`." }
  const kept = written === undefined || sectionText(text, "e2e") === written.trimEnd()
  if (!kept) return { kind: "stay", reason: "`## e2e` must stay exactly as the hook wrote it (D73, D173)." }
  if (e2e!.verdict !== "통과") {
    const why = path === "aside" || path === "ego" ? "a browser check failed: call mcp__rein__advance, it says what to ask the user (D173, D200)." : "`## e2e` must stay exactly as the hook wrote it (D73)."
    return { kind: "stay", reason: why }
  }
  if (path !== "aside" && path !== "ego" && !(run.e2e?.results ?? []).every(r => r.exit === 0)) return { kind: "stay", reason: "`## e2e` must stay exactly as the hook wrote it (D73)." }
  // the person checked every box by hand: their check is the verdict.
  if (path === "manual") return { kind: "land" }
  const done = s["완료 판정 대조"]
  if (!done) return { kind: "stay", reason: "e2e passed; `## 완료 판정 대조` is next, written by the rein:reviewer agent." }
  if (!valid(done)) return { kind: "stay", reason: "`## 완료 판정 대조` needs exactly one line `판정: 통과` or `판정: 실패`." }
  if (completion === undefined) return { kind: "stay", reason: "1-spec.md has no line under `## 완료 판정` to compare with." }
  if (done!.quote !== completion) return { kind: "stay", reason: `\`## 완료 판정 대조\` must quote the spec's line exactly: \`> ${completion}\` (D79).` }
  if (done!.verdict === "실패") return { kind: "failed", reason: "the completion check failed." }
  return { kind: "land" }
}
