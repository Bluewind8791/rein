import { readOnly } from "../lib/bash.ts"
import { itemPath, parseReview } from "../lib/parse.ts"
import { resolve, same } from "../lib/paths.ts"
import { applicableRules, ruleFile } from "../lib/rules.ts"
import type { ReviewGroup, Run, Seal, StageSpec } from "../lib/state.ts"

// the rule files review checks, by file name relative to rules/
// (`api.md`, `spring/naming.md`): the frozen rules the changed files
// bring in. dev's hand-off, the status tool
// and the review.md check all use this one list.
export function reviewRules(run: Run, root: string): { file: string; path: string }[] {
  return applicableRules(run.rules, run.writes, root, run.outside).map(r => ({ file: ruleFile(r), path: r.path }))
}

// The changed files and rules, as the dev→review result and status show
// them. In status the changed files are its `writes:` already.
export function reviewLists(run: Run, root: string, inStatus = false): string {
  const rules = reviewRules(run, root)
  return [
    ...(inStatus && run.writes.length > 0 ? ["Changed files (D49 ③): those of writes, above."]
      : ["Changed files (D49 ③):", ...(run.writes.length > 0 ? run.writes.map(w => `- ${w}`) : ["- none"])]),
    rules.length > 0
      ? "Rules to check (D115), by file name:"
      : "Rules to check (D115): none. The rule check section says `적용 대상 없음`.",
    ...rules.map(r => `- ${r.file}: ${r.path}`),
  ].join("\n")
}

// from SPLIT_AT changed files on, review is split: a rein:review-splitter
// groups the files that belong together in review-groups.md, and one
// rein:reviewer per group writes review-<n>.md, which the hook joins into
// review.md. Fewer files keep one reviewer and review.md.
export const SPLIT_AT = 10
export const GROUPS_FILE = "agent/review-groups.md"
export const groupFile = (n: number) => `agent/review-${n}.md`
export const splits = (run: Run) => run.writes.length >= SPLIT_AT

// what the groups must hold, each exactly once: the changed files and the
// handoff files.
export const groupItems = (run: Run, dir: string) => [...run.writes, ...(run.handoff ?? []).map(h => `${dir}/handoff/${h}`)]

// whether every changed and handoff file is in a group; a dev retry that
// wrote a file none holds voids them, and the files are grouped anew.
export const groupsCover = (run: Run, dir: string) =>
  run.reviewGroups !== undefined && groupItems(run, dir).every(f => run.reviewGroups!.some(g => g.files.some(x => same(x, f))))

// the groups a reviewer still has to judge in this visit to review: one
// with no verdict, and a passed one whose file changed since, as dev sealed
// it. A failed verdict stands for the visit; entering review from dev drops it.
export function pendingGroups(run: Run): number[] {
  const out: number[] = []
  for (const [i, g] of (run.reviewGroups ?? []).entries()) {
    const v = g.verdict
    const changed = v !== undefined && g.files.some(f => sealOf(run.sealed, f) !== sealOf(v.seal, f))
    if (v === undefined || (v.pass && changed)) out.push(i + 1)
  }
  return out
}

const sealOf = (seal: Seal | undefined, file: string) => Object.entries(seal ?? {}).find(([f]) => same(f, file))?.[1]

// review-groups.md: `## 묶음 <n>: <title>` headings numbered from 1, each with
// its files as `- <path>` lines; every changed and handoff file in exactly one.
export function parseGroups(text: string, items: string[], root: string): { ok: true; groups: ReviewGroup[] } | { ok: false; reason: string } {
  const groups: ReviewGroup[] = []
  const unknown: string[] = []
  const twice: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const head = /^##\s+묶음\s+(\d+)\s*:\s*(\S.*?)\s*$/.exec(line)
    if (head) {
      if (Number(head[1]) !== groups.length + 1) return { ok: false, reason: `the groups are numbered from 1 in order; \`${line.trim()}\` should be 묶음 ${groups.length + 1}.` }
      groups.push({ title: head[2]!, files: [] })
      continue
    }
    if (/^##\s/.test(line)) return { ok: false, reason: `\`${line.trim()}\` is not a \`## 묶음 <n>: <title>\` heading.` }
    const item = /^\s*[-*]\s+`?([^`]+?)`?\s*$/.exec(line)?.[1]
    const group = groups.at(-1)
    if (item === undefined || group === undefined) continue
    const path = resolve(item, root)
    const known = items.find(f => same(f, path))
    if (known === undefined) unknown.push(item)
    else if (groups.some(g => g.files.some(f => same(f, known)))) twice.push(item)
    else group.files.push(known)
  }
  if (groups.length === 0) return { ok: false, reason: "it has no `## 묶음 1: <title>` heading." }
  const empty = groups.flatMap((g, i) => (g.files.length === 0 ? [`묶음 ${i + 1}`] : []))
  const missing = items.filter(f => !groups.some(g => g.files.some(x => same(x, f))))
  const problems = [
    ...(unknown.length > 0 ? [`these are not changed or handoff files of the run: ${unknown.join(", ")}`] : []),
    ...(twice.length > 0 ? [`these are in more than one group: ${twice.join(", ")}`] : []),
    ...(missing.length > 0 ? [`these are in no group: ${missing.join(", ")}`] : []),
    ...(empty.length > 0 ? [`these groups have no file: ${empty.join(", ")}`] : []),
  ]
  return problems.length > 0 ? { ok: false, reason: `${problems.join("; ")}.` } : { ok: true, groups }
}

// where each file's `###` item of `## 상세 설계` lies in 2-plan.md, as 1-based
// line numbers, and the line range of `## 영향 범위`.
export function planRanges(plan: string, root: string): { items: { path: string; from: number; to: number }[]; impact?: { from: number; to: number } } {
  const lines = plan.split(/\r?\n/)
  const items: { path: string; from: number; to: number }[] = []
  let section = ""
  let fenced = false
  let impact: { from: number; to: number } | undefined
  const close = (i: number) => {
    const last = items.at(-1)
    if (last && last.to === 0) last.to = i
    if (impact && impact.to === 0) impact.to = i
  }
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const h2 = /^##\s+(.*?)\s*$/.exec(line)
    if (h2) {
      close(i)
      section = h2[1]!
      if (section === "영향 범위") impact = { from: i + 1, to: 0 }
      continue
    }
    const h3 = section === "상세 설계" ? /^###\s+(.*)$/.exec(line) : null
    if (!h3) continue
    close(i)
    const path = itemPath(h3[1]!)
    if (path !== undefined) items.push({ path: resolve(path, root), from: i + 1, to: 0 })
  }
  close(lines.length)
  return { items, ...(impact ? { impact } : {}) }
}

// the lines of 2-plan.md's `## 변경 전 실패`, each `- <test file> — …`.
function assertions(plan: string): string[] {
  const lines = plan.split(/\r?\n/)
  const start = lines.findIndex(l => /^##\s+변경 전 실패\s*$/.test(l))
  if (start < 0) return []
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end).filter(l => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s+없음\s*$/.test(l))
}

// what one reviewer judges: the whole change, or one group of it.
type Scope = {
  handoff: string[]
  rules: { file: string; path: string }[]
  out: string
  intro: string[]
  design: string
  assertion: string
}

// the reviewer's whole task, built by the hook at agent.spawn in place
// of whatever the main session (the author) wrote.
export function reviewTask(run: Run, root: string, dir: string): string {
  return scopedTask(run, dir, {
    handoff: (run.handoff ?? []).map(h => `${dir}/handoff/${h}`),
    rules: reviewRules(run, root),
    out: "agent/review.md",
    intro: [reviewLists(run, root)],
    design: `Design: the \`## 상세 설계\` and \`## 영향 범위\` sections of ${dir}/2-plan.md.`,
    assertion: "2-plan.md's `## 변경 전 실패` names assertions that must fail on the code as it was before the change, one line each. For each line, find the test case that makes the assertion, and show from the code before the change (`git -C <root> show HEAD:<path>`) where it gives the old result, as path:line, so the assertion fails there. When no test case makes the assertion, or it would pass on the code before the change, `## 설계 대조` is 실패 with the line. Without the section, or with only `없음`, skip this.",
  })
}

// the rules a group's files bring in.
export const groupRules = (run: Run, n: number, root: string) =>
  applicableRules(run.rules, (run.reviewGroups?.[n - 1]?.files ?? []).filter(f => run.writes.some(w => same(w, f))), root, run.outside).map(r => ({ file: ruleFile(r), path: r.path }))

// one group's reviewer task: its files, the rules they bring in, where
// their items lie in 2-plan.md and the assertions of its test files.
export function groupTask(run: Run, root: string, dir: string, n: number, plan: string): string {
  const group = run.reviewGroups![n - 1]!
  const of = run.reviewGroups!.length
  const handoff = group.files.filter(f => !run.writes.some(w => same(w, f)))
  const files = group.files.filter(f => run.writes.some(w => same(w, f)))
  const rules = groupRules(run, n, root)
  const ranges = planRanges(plan, root)
  const at = (f: string) => {
    const item = ranges.items.find(x => same(x.path, f))
    return item ? `lines ${item.from}–${item.to}` : "no item of its own"
  }
  const mine = assertions(plan).filter(l => files.some(f => l.includes(f) || l.includes(f.slice(f.lastIndexOf("/") + 1))))
  const impact = ranges.impact ? `, at lines ${ranges.impact.from}–${ranges.impact.to}` : ""
  return scopedTask(run, dir, {
    handoff,
    rules,
    out: groupFile(n),
    intro: [
      `This is group ${n} of ${of} (${group.title}): other reviewers judge the other groups at the same time. Judge only this group's files. Read a file outside it only where a change of yours relies on it.`,
      "",
      "Changed files of this group, with where their item of `## 상세 설계` lies in 2-plan.md (read those lines, not the whole file):",
      ...files.map(f => `- ${f} (${at(f)})`),
      rules.length > 0 ? "Rules to check, by file name:" : "Rules to check: none. The rule check section says `적용 대상 없음`.",
      ...rules.map(r => `- ${r.file}: ${r.path}`),
    ],
    design: `Design: those items of ${dir}/2-plan.md, and its \`## 영향 범위\`${impact}: judge the lines about this group's files.`,
    assertion:
      mine.length > 0
        ? `These lines of 2-plan.md's \`## 변경 전 실패\` belong to this group's tests; each names an assertion that must fail on the code as it was before the change:\n${mine.join("\n")}\nFor each line, find the test case that makes the assertion, and show from the code before the change (\`git -C <root> show HEAD:<path>\`) where it gives the old result, as path:line, so the assertion fails there. When no test case makes the assertion, or it would pass on the code before the change, \`## 설계 대조\` is 실패 with the line.`
        : "No line of 2-plan.md's `## 변경 전 실패` belongs to this group's tests: leave `## 변경 전 실패` out.",
  })
}

function scopedTask(run: Run, dir: string, s: Scope): string {
  const lines = s.rules.length > 0 ? s.rules.map(r => `- \`${r.file}\` — 판정: 통과`).join("\n") : "적용 대상 없음"
  return [
    "Review the changes of a Rein run (D116). You did not write them. Do not fix anything.",
    "",
    s.design,
    ...s.intro,
    `Repositories, for \`git -C <root> diff\`: ${(run.repos ?? []).join(", ") || "none recorded"}. New files do not show in git diff; read them with Read.`,
    ...(s.handoff.length
      ? [`Handoff files (D163), outside every repository, for the person to apply: ${s.handoff.join(", ")}. Read each whole; it is part of the change. It must do what 2-plan.md's \`## 넘길 것\` item for it says, and fit the code changes; a mismatch is 실패 under \`## 설계 대조\`.`]
      : []),
    "",
    "Check that every change follows the design, and that it keeps every listed rule; read each rule file. A `## 영향 범위` line that says `유지` gives a reason the path stays safe: if the diff breaks that reason, that is 실패 (D155). A rule that clashes with the design is still 실패. Do not flag taste no rule states. Do not compare with the spec's completion line; qa does that.",
    "",
    "When a listed rule asks for shared code over new code, collect what the change newly defines: a JS function, a private or static Java helper, a CSS class, an SQL insert, update or sequence select written as a string, a plain Exception thrown, JSON.stringify or Gson on rows. For each, look for shared code that does the same: in the domain knowledge (its index of shared code and the places it says to look, when status lists any) and with Grep in the repositories. When one exists, that rule is 실패 under `## 룰 체크`, with the new code and the shared code, each as path:line, unless 2-plan.md's `## 결정 사항` records that the user chose new code. Under the rule's line, say where you looked, so that none found differs from not looked for.",
    "",
    "Then look for bugs and security holes in what the change added or changed: an empty input, null, a boundary or off-by-one, a swallowed error, concurrent access, a repeat that is not idempotent, a guard or retry that hides a broken invariant; user input reaching SQL, a shell or HTML unescaped, a missing authentication or authorization check. Flag one only when you can show it happens: trace from a caller as path:line to the input that reaches the code and what goes wrong there. Leave out what could go wrong only if some caller passed a value none passes, a nit, and what you would just write differently; they are not 실패. A problem in code the change does not touch is not this run's. A flagged problem makes `## 정확성` 실패; when the design itself asks for the faulty code, say so on its line.",
    "",
    s.assertion,
    "",
    `On a 실패, also judge whether the code or the design must change. ${dir}/agent/fails.md has a round for each time dev passed after a failure, quoting the failure that round set out to fix (a run from before fails.md has none: there each round of ${dir}/agent/dev-diff.md quotes it under \`### 읽은 실패\`). 설계: what fails is what the design asks for (its item, its \`## 영향 범위\` or its tests), or an earlier round already quotes the same failure, the same finding at the same place for the same reason, so fixing the code on this design did not hold. 구현: anything else; the code can be fixed within the design.`,
    "",
    `Write ${dir}/${s.out}, whole, once, with Write, in exactly this form:`,
    "",
    "## 설계 대조",
    "",
    "판정: 통과",
    "",
    "(on 실패: what differs from the design, as path:line and the design item)",
    "",
    "## 룰 체크",
    "",
    lines,
    "",
    "(on 실패: which rule was broken where, as path:line and the rule sentence)",
    "",
    "## 정확성",
    "",
    "판정: 통과",
    "",
    "(on 실패: one line per problem: where, as path:line, the caller path that reaches it, and what goes wrong)",
    "",
    "## 변경 전 실패",
    "",
    "- <test file> — <test case>: <path:line before the change> gives <the old result>, so <the assertion> fails",
    "",
    "(only when 2-plan.md has assertions under `## 변경 전 실패`: one line each, also when the review passes. No verdict line here; a failure goes under `## 설계 대조`.)",
    "",
    "## 실패 원인",
    "",
    "원인: 구현",
    "",
    "(only when a verdict above is 실패: 구현 or 설계, then why; for 설계, the design item, or the round of fails.md that quotes the same failure)",
    "",
    "Each verdict is exactly 통과 or 실패. `## 룰 체크` has one line per listed rule file and no others; with no rules listed it holds only `적용 대상 없음`. With a 실패, `## 실패 원인` has exactly one line `원인: 구현` or `원인: 설계`. What you write on a failure is all dev or plan gets to fix it, so be specific. When the hook accepts the file, answer with the outcome in one line and stop.",
  ].join("\n")
}

export function reviewEntry(run: Run, root: string, dir: string): string {
  return `The run is now in the review stage. Invoke the rein:review skill.\n${reviewLists(run, root)}${reviewNext(run, dir)}`
}

// what the main session does next in a split review, "" when the change is
// small enough for one reviewer.
export function reviewNext(run: Run, dir: string): string {
  if (!splits(run)) return ""
  if (!groupsCover(run, dir)) {
    return `\nThis change has ${run.writes.length} changed files (${SPLIT_AT} or more), so its review is split: spawn rein:review-splitter first, once; the hook writes its task. It groups the files that belong together in ${GROUPS_FILE}. Do not spawn rein:reviewer before that.`
  }
  const groups = run.reviewGroups!
  const running = groups.flatMap((g, i) => (g.reviewer ? [i + 1] : []))
  const todo = pendingGroups(run).filter(n => !running.includes(n))
  const lines = [`\nThe review is split into ${groups.length} groups (${GROUPS_FILE}).`]
  if (todo.length > 0) lines.push(`Groups to review: ${todo.join(", ")}. Spawn one rein:reviewer per group, all in one message, each with the prompt \`묶음 <n>\`; the hook writes each task. A group that passed with none of its files changed since is not reviewed again.`)
  if (running.length > 0) lines.push(`Groups a reviewer is on: ${running.join(", ")}.`)
  return lines.join(" ")
}

// the splitter's whole task: the files to group, where each one's item
// lies in 2-plan.md, and the form of review-groups.md.
export function splitterTask(run: Run, root: string, dir: string, plan: string): string {
  const ranges = planRanges(plan, root)
  const lines = plan.split(/\r?\n/)
  const at = (f: string) => {
    const item = ranges.items.find(x => same(x.path, f))
    return item ? ` (2-plan.md lines ${item.from}–${item.to}: ${lines[item.from - 1]?.trim()})` : ""
  }
  const handoff = (run.handoff ?? []).map(h => `${dir}/handoff/${h}`)
  return [
    `Group the changed files of a Rein run for review. The change has ${run.writes.length} changed files, too many for one reviewer to read with their design; one rein:reviewer per group will judge them at the same time, each seeing only its own group. A problem that spans two groups is seen by neither, so the grouping is what keeps it in view. Do not review or fix anything.`,
    "",
    "The files, each with where its item of `## 상세 설계` lies in 2-plan.md:",
    ...run.writes.map(f => `- ${f}${at(f)}`),
    ...(handoff.length > 0 ? ["Handoff files (D163), part of the change, outside every repository:", ...handoff.map(h => `- ${h}`)] : []),
    "",
    `Read ${dir}/2-plan.md: \`## 접근 방법\`, the \`###\` headings and first lines of each item, and \`## 영향 범위\`. Read no item whole. Repositories, for \`git -C <root> diff --stat\` and other read-only git: ${(run.repos ?? []).join(", ") || "none recorded"}. Use Grep to see which file calls, includes or shares a name, key or column with which; open a file only where that does not tell.`,
    "",
    "Put in one group the files a reviewer must read together to judge any of them: a caller and what it calls where the change touches both, a screen and the controller, service, mapper or query behind it, files that change the same key, column, message or setting, a test and the code it tests, a handoff file and the code it goes with. Split where files share nothing the change touches. Make as many groups as the change splits into, each small enough for one reviewer to read its files and their items whole.",
    "",
    `Write ${dir}/${GROUPS_FILE}, whole, once, with Write, in exactly this form: one heading per group, numbered from 1, and its files as listed above, each once. A line under a heading that is not \`- <path>\` is ignored, so a short reason may follow the files.`,
    "",
    "## 묶음 1: <a few words for what the group changes>",
    "",
    "- <path>",
    "- <path>",
    "",
    "## 묶음 2: <...>",
    "",
    "- <path>",
    "",
    "Every changed and handoff file is in exactly one group. When the hook accepts the file, answer with the number of groups in one line and stop.",
  ].join("\n")
}

// review.md and nothing else, and only by the rein:reviewer agent the
// hook recorded, so the main session cannot pass its own code. A split
// review has review-groups.md by the recorded splitter and review-<n>.md
// by group n's recorded reviewer instead.
// Bash is read-only git, unchained, for every loop.
export const review: StageSpec = {
  write(path, c) {
    if (path !== undefined && same(path, `${c.dir}/agent/review.md`)) {
      return c.agentId !== undefined && c.agentId === c.run.reviewer
        ? { allow: true }
        : { deny: "D116: only the rein:reviewer agent spawned in this review stage may write review.md." }
    }
    if (path !== undefined && same(path, `${c.dir}/${GROUPS_FILE}`)) {
      return c.agentId !== undefined && c.agentId === c.run.splitter
        ? { allow: true }
        : { deny: `D116: only the rein:review-splitter spawned in this review stage may write ${GROUPS_FILE}.` }
    }
    const n = groupOf(path, c.dir)
    if (n !== undefined) {
      return c.agentId !== undefined && c.run.reviewGroups?.[n - 1]?.reviewer === c.agentId
        ? { allow: true }
        : { deny: `D116: only the rein:reviewer spawned for group ${n} may write ${groupFile(n)}.` }
    }
    return { deny: `D117: in the review stage only ${c.dir}/agent/review.md may be written, by the rein:reviewer agent.` }
  },

  // the form is checked before the write lands; a refusal carries the
  // hook's rule list so the reviewer can fix it.
  preWrite(tool, input, path, c) {
    const content = typeof input.content === "string" ? input.content : ""
    if (same(path, `${c.dir}/${GROUPS_FILE}`)) {
      if (tool !== "Write") return `D116: write the whole ${GROUPS_FILE} with Write.`
      const parsed = parseGroups(content, groupItems(c.run, c.dir), c.root)
      return parsed.ok ? undefined : `D116: ${GROUPS_FILE}: ${parsed.reason}`
    }
    const n = groupOf(path, c.dir)
    const name = n === undefined ? "agent/review.md" : groupFile(n)
    if (n === undefined && !same(path, `${c.dir}/agent/review.md`)) return undefined
    if (tool !== "Write") return `D116: write the whole ${name} with Write.`
    const rules = (n === undefined ? reviewRules(c.run, c.root) : groupRules(c.run, n, c.root)).map(r => r.file)
    const parsed = parseReview(content, rules)
    if (parsed.ok) return undefined
    const list = rules.length > 0 ? rules.join(", ") : "none (write `적용 대상 없음`)"
    return `D116: ${parsed.reason} The hook's rule list: ${list}.`
  },

  bash: (command, c) => readOnly(command, c.run.repos ?? [], c.root),

  toolRule: "D117",

  artifacts: run => ["agent/review.md", GROUPS_FILE, ...(run.reviewGroups ?? []).map((_, i) => groupFile(i + 1))],
}

// the group a path is the review file of, if any.
function groupOf(path: string | undefined, dir: string): number | undefined {
  if (path === undefined) return undefined
  const name = /\/review-(\d+)\.md$/.exec(path)?.[1]
  return name !== undefined && same(path, `${dir}/${groupFile(Number(name))}`) ? Number(name) : undefined
}

// review.md of a split review, as the hook writes it once every group has
// its verdict: one line per group, then the whole file of each that failed.
export function joinedReview(run: Run, failed: Record<number, string>): string {
  const groups = run.reviewGroups ?? []
  const rows = groups.map((g, i) => `- 묶음 ${i + 1} (${g.title}): ${g.verdict?.pass ? "통과" : "실패"} — ${groupFile(i + 1)}`)
  const bodies = Object.entries(failed).map(([n, text]) => `# 묶음 ${n}: ${groups[Number(n) - 1]?.title ?? ""}\n\n${text.trim()}\n`)
  return ["# 리뷰 묶음 판정", "", ...rows, "", ...bodies].join("\n")
}
