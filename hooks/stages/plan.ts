import { readOnly } from "../lib/bash.ts"
import { same, under } from "../lib/paths.ts"
import type { Run, StageSpec } from "../lib/state.ts"

// the rules frozen at open_run, for the plan skill to pick the ones
// its file list matches. Rides the spec→plan advance result.
export function planEntry(run: Run): string {
  const head = "The run is now in the plan stage. Invoke the rein:plan skill."
  if (run.rules.length === 0) return `${head} No project rules were frozen for this run (D115); skip the rule step.`
  const list = run.rules.map(r => {
    const shared = r.shared ? "shared, every repository of the run; " : ""
    return r.paths === null ? `- ${r.path} (${shared}no paths: list, always applies)` : `- ${r.path} (${shared}paths: ${r.paths.join(", ")})`
  })
  return [
    head,
    "Project rules frozen for this run (D115). Read each rule whose paths globs match a file in your design, globs relative to the session root (for a shared rule, relative to the repository the file is in), and design to it (D118):",
    ...list,
  ].join("\n")
}

// the folders a file's repository root may be, nearest first, from
// the file's folder up to the drive or file system root, the session root
// or not.
export function repoCandidates(file: string): string[] {
  const dirs: string[] = []
  for (let dir = file.slice(0, file.lastIndexOf("/")); dir !== "" && !/^[A-Za-z]:$/.test(dir); dir = dir.slice(0, dir.lastIndexOf("/"))) {
    dirs.push(dir)
  }
  return dirs
}

// a repository of the run outside the session root.
export const outside = (repo: string, root: string) => !same(repo, root) && !under(repo, root)

// failed design reviews in one visit to plan after which advance no longer
// asks for a passing one: the person's approval decides.
export const PLAN_REVIEWS = 2

export const PLAN_REVIEW = "mcp__rein__plan_review"

// the plan reviewer's whole task, built by the hook at agent.spawn in place
// of whatever the main session wrote. rules: the frozen rule files the
// design's files bring in, by file name relative to rules/. changed: on a
// visit to plan after the design was approved, the lines of 2-plan.md that
// differ from the approved one (diff.ts lineDiff); the review judges only
// those and what they directly affect. Absent, the whole design.
export function planReviewTask(dir: string, rules: { file: string; path: string }[], changed?: string[]): string {
  const scope = changed === undefined ? [] : [
    "",
    "This design was approved before in this run, and dev built it; the run came back to plan to change it. Judge only what changed since the approved version, and what the change directly affects: a changed item still carries out the spec requirement it served, a removed item's requirement is still carried out by another, a changed `## 영향 범위` answer still holds, and the listed rules hold for what the change designs. A part that did not change passed before: do not fail the design for it, even where you would judge it otherwise now. Each part is 실패 only for a problem a changed line brings in.",
    changed.length === 0
      ? "2-plan.md is the same as the approved version, so nothing changed: every part is 통과."
      : `The lines of 2-plan.md that differ from the approved version, \`- \` for a line only in the approved version and \`+ \` for a line only in 2-plan.md now; read 2-plan.md for where they sit:\n\`\`\`diff\n${changed.join("\n")}\n\`\`\``,
  ]
  return [
    changed === undefined
      ? "Review the design of a Rein run before any code is written. You did not write it. Do not fix anything, and write no file."
      : "Review a change to the design of a Rein run before the code follows it. You did not write it. Do not fix anything, and write no file.",
    "",
    `Design: ${dir}/2-plan.md. Spec: ${dir}/1-spec.md.`,
    rules.length > 0 ? "Rules to check, by file name:" : "Rules to check: none. Give `rules` as [].",
    ...rules.map(r => `- ${r.file}: ${r.path}`),
    "",
    "Judge three parts:",
    "1. rules: for each listed rule, whether the design follows it: the files it changes, where things go, and the names and shapes it states. Read each rule file. A rule about code the design does not describe is 통과 here; dev and review hold the code to it. A rule that clashes with the design is 실패.",
    "2. impact: 2-plan.md's `## 영향 범위` answers every item of 1-spec.md's `## 영향 범위`: `변경` for a path the design changes (an item of `## 상세 설계`), `테스트: <test file>` with a test file the design lists, `유지: <reason>` with a reason the design keeps and the code that shows it as path:line, or `넘김: <file>`; an item that is no file (a DB sequence, another system) may be answered in words. A missing answer, a `변경` path the design does not change, a test file it does not list, a `유지` reason the design breaks, or a `유지` with no path:line or whose path:line does not show what the reason says is 실패.",
    "3. spec: every requirement of 1-spec.md has an item of `## 상세 설계` that carries it out. A requirement no item answers is 실패. Every line under 1-spec.md's `## 미해결 질문` has a row of `## 결정 사항` whose 근거 starts with `가정:`, and the design follows that assumption; a line without one is 실패. The same holds for every `[?]` left in another section of 1-spec.md: it needs a `## 결정 사항` row whose 근거 starts with `가정:`, and the design follows it. Do not judge the tests, `## e2e 확인`, `## 완료 판정 덮기` or `## 변경 전 실패`; the test-planner decides them.",
    "Do not flag taste that no rule, `유지` reason or spec requirement states.",
    ...scope,
    "",
    `Give the verdict by calling ${PLAN_REVIEW} once: rules with one entry per listed rule file and no others, impact and spec. Each verdict is exactly 통과 or 실패. On 실패, why names the place in 2-plan.md (its \`### <path>\` item or section) and the rule sentence, \`유지\` reason or spec requirement it breaks. What you write on a failure is all the planner gets to fix it, so be specific. If the hook refuses the call, fix exactly what it says and call again. Once it is recorded, answer with the outcome and, on 실패, each reason as you gave it, then stop.`,
  ].join("\n")
}

// what the hook adds to the task of a rein:planner or rein:test-planner
// spawned on a visit to plan after the design was approved, on the spec it
// was approved on. changed, the test-planner's: the lines of 2-plan.md that
// differ from the approved one (diff.ts lineDiff).
export function revisitNote(changed?: string[]): string {
  const lead = "The hook: this run's design was approved before, on the spec as it is now, and the run came back to plan to change it. Follow `## Coming back after approval` of your instructions."
  if (changed === undefined) return lead
  return [
    lead,
    changed.length === 0
      ? "2-plan.md is the same as the approved version, so nothing changed."
      : `The lines of 2-plan.md that differ from the approved version, \`- \` for a line only in the approved version and \`+ \` for a line only in 2-plan.md now; read 2-plan.md for where they sit:\n\`\`\`diff\n${changed.join("\n")}\n\`\`\``,
  ].join("\n\n")
}

type Part = { verdict: "통과" | "실패"; why?: string }

// the plan reviewer's call of mcp__rein__plan_review: every part judged
// 통과 or 실패, a failure with its reason, and one rules entry per rule
// file of the review. why: every failure, one line each, for the main
// session and the approval question.
export function parsePlanVerdict(input: Record<string, unknown>, rules: string[]): { ok: true; pass: boolean; why?: string } | { ok: false; reason: string } {
  const part = (v: unknown, name: string): Part | string => {
    if (!v || typeof v !== "object") return `${name} is missing; give it as { verdict, why }.`
    const { verdict, why } = v as Record<string, unknown>
    if (verdict !== "통과" && verdict !== "실패") return `${name}'s verdict must be exactly 통과 or 실패.`
    if (why !== undefined && typeof why !== "string") return `${name}'s why must be text.`
    if (verdict === "실패" && (typeof why !== "string" || why.trim() === "")) return `${name} is 실패 without a why; say where in 2-plan.md and what it breaks.`
    return { verdict, why: typeof why === "string" && why.trim() !== "" ? why.trim() : undefined }
  }
  if (!Array.isArray(input.rules)) return { ok: false, reason: "rules is missing; give one entry per listed rule file, or [] with none listed." }
  const failures: string[] = []
  const seen: string[] = []
  for (const entry of input.rules as unknown[]) {
    const file = entry && typeof entry === "object" ? (entry as Record<string, unknown>).file : undefined
    if (typeof file !== "string" || !rules.includes(file)) return { ok: false, reason: `rules names ${typeof file === "string" ? file : "an entry without a file"}, which is not a rule file of this review.` }
    if (seen.includes(file)) return { ok: false, reason: `rules names ${file} twice.` }
    seen.push(file)
    const p = part(entry, `the rule ${file}`)
    if (typeof p === "string") return { ok: false, reason: p }
    if (p.verdict === "실패") failures.push(`룰 ${file}: ${p.why}`)
  }
  const missing = rules.filter(r => !seen.includes(r))
  if (missing.length > 0) return { ok: false, reason: `rules lacks ${missing.join(", ")}.` }
  for (const [key, label] of [["impact", "영향 범위"], ["spec", "spec 대조"]] as const) {
    const p = part(input[key], key)
    if (typeof p === "string") return { ok: false, reason: p }
    if (p.verdict === "실패") failures.push(`${label}: ${p.why}`)
  }
  return failures.length > 0 ? { ok: true, pass: false, why: failures.join("\n") } : { ok: true, pass: true }
}

// the plan reviewer's row: it reads, with commands that read and
// read-only git, and writes nothing.
export const planReviewer: StageSpec = {
  write: () => ({ deny: `the plan reviewer writes no file; it gives its verdict through ${PLAN_REVIEW}.` }),
  bash: (command, c) => readOnly(command, undefined, c.root),
  toolRule: "D117",
}
