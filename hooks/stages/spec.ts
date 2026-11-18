import { parseGrade, parseImpacts, type GradeDim } from "../lib/parse.ts"
import { SPEC_VERDICT } from "../lib/layout.ts"
import { same } from "../lib/paths.ts"
import type { Grade, StageSpec } from "../lib/state.ts"
import { completionLine, sectionText } from "./qaIntegration.ts"

// the Rein agents' row in spec: grade.md only, by the rein:grader the hook
// recorded for the current 1-spec.md; 1-mockup.html only, by the rein:sketcher
// it recorded last (register.ts refuses their every other tool). The main
// session writes 1-spec.md as it likes; the run leaves spec through advance.
export const spec: StageSpec = {
  write(path, c) {
    if (path !== undefined && same(path, `${c.dir}/1-mockup.html`) && c.agentId !== undefined && c.agentId === c.run.sketcher) return { allow: true }
    if (c.agentId !== undefined && c.agentId === c.run.sketcher) return { deny: `the sketcher writes ${c.dir}/1-mockup.html and nothing else.` }
    if (c.agentId !== undefined && c.agentId === c.run.sketchCheck?.agent) {
      return path !== undefined && same(path, `${c.dir}/${SPEC_VERDICT}`) ? { allow: true } : { deny: `the layout verifier writes ${c.dir}/${SPEC_VERDICT} and nothing else.` }
    }
    if (path !== undefined && same(path, `${c.dir}/agent/grade.md`)) {
      return c.agentId !== undefined && c.agentId === c.run.grader
        ? { allow: true }
        : { deny: "D175: only the rein:grader agent spawned for the current 1-spec.md may write grade.md." }
    }
    return { deny: `D175: the grader writes ${c.dir}/agent/grade.md and nothing else.` }
  },

  // the form is checked before the write lands.
  preWrite(tool, input, path, c) {
    if (!same(path, `${c.dir}/agent/grade.md`)) return undefined
    if (tool !== "Write") return "D175: write the whole grade.md with Write."
    const parsed = parseGrade(typeof input.content === "string" ? input.content : "", DIMENSIONS.map(d => d.name))
    return parsed.ok ? undefined : `D175: ${parsed.reason}`
  },

  artifacts: ["agent/grade.md", "1-mockup.html", SPEC_VERDICT],
}

// what the sketcher draws: the current screen before the questions, or
// the current and the target once the grading is over.
export type SketchMode = "as-is" | "to-be"

// the mode named in the Agent call's description, the one place it can
// come from (the hook drops the prompt); undefined when it names none or both.
export function sketchMode(description: string): SketchMode | undefined {
  const named = (["as-is", "to-be"] as const).filter(m => new RegExp(`(^|[^a-z])${m}($|[^a-z])`, "i").test(description))
  return named.length === 1 ? named[0] : undefined
}

// the sketcher's whole task, built by the hook at agent.spawn in place of
// whatever the main session wrote, so nothing of the conversation reaches it.
export function sketcherTask(dir: string, mode: SketchMode, redraw: string[] = []): string {
  return [
    `Draw ${dir}/1-mockup.html, mode ${mode}. You did not see the conversation that produced the spec: draw only what ${dir}/1-spec.md says, what the planning document's pictures it names show, and what the code shows.`,
    "",
    `Read ${dir}/1-spec.md first. Then read the code it cites, and the code you find, for the as-is.`,
    mode === "as-is"
      ? "Mode as-is: the screens as they are now, alone, with each [?] of 1-spec.md as a yellow note where it belongs. No to-be."
      : "Mode to-be: rewrite the file whole, the as-is above and the to-be below for each screen that changes; each line of ## 미해결 질문 as one red note. No yellow note is left. Where `## 기획서 대조` names a picture of the screen (its `원본:` line, a file in the run folder), open it with Read and draw the to-be's layout as the picture lays it out, with `<!-- to-be source: <its path relative to the run folder> (<page>) -->` inside that screen's section.",
    ...redraw,
    "",
    `Write ${dir}/1-mockup.html, whole, with Write; the hook refuses every other write and every tool but Read, Grep, Glob and Write. Then answer in the form your instructions give, and stop.`,
  ].join("\n")
}

// the kinds of work a spec is, from `유형:` in its front matter; each
// weighs the dimensions and words their anchors its own way.
export const TYPES = ["feature", "bugfix", "improvement"] as const
export type SpecType = (typeof TYPES)[number]

// `유형:` of 1-spec.md's front matter, or undefined when it is none of TYPES.
export function specType(text: string): SpecType | undefined {
  const value = frontValue(text, "유형")
  return TYPES.find(t => t === value)
}

// what a score of 0.2, 0.6 and 1.0 looks like.
type Anchors = readonly [string, string, string]
type Dimension = { name: string; fact: boolean; asks: string; weight: Record<SpecType, number>; anchors: Record<SpecType, Anchors> }
const same3 = (a: Anchors): Record<SpecType, Anchors> => ({ feature: a, bugfix: a, improvement: a })

// what the grader scores, the weights of each type summing to 1. A fact is
// filled by reading the code, never by asking the user.
export const DIMENSIONS: Dimension[] = [
  {
    name: "문제", fact: false, asks: "what is wrong, for whom, and why it matters, with one reading only",
    weight: { feature: 0.2, bugfix: 0.3, improvement: 0.2 },
    anchors: {
      feature: ["only a wish (\"add X\"), with no user or reason", "who needs it and what they get, but the reason or the user reads more than one way", "who needs it, what they cannot do today and why it matters, with one reading only"],
      bugfix: ["a symptom with no screen, entry point or steps", "the symptom and where it shows, but the input data or the steps to reproduce it are unclear", "the entry point, the input and the steps, so a third party reproduces it as written, and the actual result as concrete values, messages or screen states"],
      improvement: ["\"improve X\" with no current pain", "a direction (faster, simpler) but not what is wrong today in observable terms", "what is wrong today as observable behaviour, for whom, and why it matters"],
    },
  },
  {
    name: "완료 판정", fact: false, asks: "the `## 완료 판정` line states behaviour someone can observe and check, with nothing left to choose",
    weight: { feature: 0.3, bugfix: 0.25, improvement: 0.25 },
    anchors: {
      feature: ["no line, or \"works correctly\"", "the behaviour is named, but a value, a message or a condition is left open", "one line of observable behaviour: what a person does and what they see, with its values, nothing left to choose"],
      bugfix: ["no line, or only \"fixed\" or \"no error\"", "the expected result is named, but in words that do not compare (\"shows correctly\")", "under the reproduction's conditions, the expected screen, values or data state, concrete enough to compare with the actual result"],
      improvement: ["no line, or \"improved\"", "a direction (\"faster\", \"clearer\") with no measure or observable change", "the behaviour or layout after the change, observable, with its measure when it is about speed or size"],
    },
  },
  {
    name: "경계 조건", fact: false, asks: "which edge cases (empty or missing input, boundary values, failure paths, concurrent use, behaviour that must stay) must hold when the work is done: named in the completion line, or plainly outside the request",
    weight: { feature: 0.2, bugfix: 0.15, improvement: 0.15 },
    anchors: {
      ...same3(["no edge case named or ruled out", "some edge cases named, but the failure paths or the behaviour that must stay are not settled", "every edge case that matters is named in the completion line or plainly outside the request"]),
      bugfix: ["no word on when it happens", "the screen only, not the conditions", "the conditions it happens under (permission, data state, always or sometimes) and the cases the fix must not change, in the completion line or plainly outside the request"],
    },
  },
  {
    name: "현행 동작", fact: true, asks: "how it works today, the places involved as path:line, and the edge cases found with whether the code handles them",
    weight: { feature: 0.1, bugfix: 0.2, improvement: 0.2 },
    anchors: {
      feature: ["nothing about today", "the screens or code the feature joins described, without path:line", "the screens or code the feature joins or follows, as path:line, and the edge cases found with whether the code handles them"],
      bugfix: ["nothing about today", "the code path described without path:line, or not traced to where it goes wrong", "the code path the symptom goes through as path:line, where it goes wrong, and the edge cases found with whether the code handles them"],
      improvement: ["nothing about today", "described without path:line", "how it works today, the places involved as path:line, and the edge cases found with whether the code handles them"],
    },
  },
  {
    name: "영향 범위", fact: true, asks: "what relies on the code to change, one path per line, or a plain 없음",
    weight: { feature: 0.2, bugfix: 0.1, improvement: 0.2 },
    anchors: same3(["missing", "module names only, or paths without what relies on them", "one `path — what relies on it` line per dependent, or a plain 없음"]),
  },
]

// the rows `## 범위` always has: the parts of a system a change can reach
// beyond the code it touches. A domain's knowledge may add rows.
export const SCOPE_ROWS = ["화면·UI", "API·엔드포인트", "데이터 스키마·마이그레이션", "배치·예약 작업", "권한·설정", "내보내기·보고서", "외부 연동"]

export const THRESHOLD = 0.25 // the highest ambiguity that passes
export const EVERY = 3 // questions between grades
const CITED = 0.4 // the most a dimension scores without a quote found in 1-spec.md
const STEADY = 0.05 // a grade that moved the ambiguity this much or less made no headway

// the grader's whole task, built by the hook at agent.spawn in place of
// whatever the main session wrote, so nothing of the conversation reaches it.
export function graderTask(dir: string, type: SpecType): string {
  return [
    "Grade how ambiguous a Rein spec is (D175). You did not see the conversation that produced it, and you judge only what the file says: what 1-spec.md does not say does not exist.",
    "",
    `Read ${dir}/1-spec.md, and nothing else; the hook refuses every other read and every other tool.`,
    "",
    `The spec is a ${type} (\`유형:\` in its front matter); score it by the anchors for that type below.`,
    "Score each dimension from 0 to 1, with at most two decimals. 1: a reader of the file alone finds a single reading and nothing to ask. Each dimension has three anchors, for 0.2, 0.6 and 1.0; a spec between two anchors scores between them. When unsure, score lower.",
    ...DIMENSIONS.flatMap(d => [`- ${d.name}: ${d.asks}.`, ...d.anchors[type].map((a, i) => `  - ${["0.2", "0.6", "1.0"][i]}: ${a}.`)]),
    "",
    `Cite the words of 1-spec.md that support each score in \`근거:\` lines, copied exactly. A dimension with no quote the hook finds in 1-spec.md word for word counts at most ${CITED}. \`[?]\` marks something undecided: count it as a blank, and never quote a line holding \`[?]\`. \`빈칸:\` is the dimension's first gap, as one sentence a question could answer: what is missing or can be read more than one way; \`없음\` when nothing is. Do not add the scores up; the hook does.`,
    "",
    `Write ${dir}/agent/grade.md, whole, once, with Write, in exactly this form, one section per dimension:`,
    "",
    ...DIMENSIONS.flatMap(d => [`## ${d.name}`, "", "점수: <0 to 1>", '근거: "<words copied from 1-spec.md>"', "빈칸: <its first gap, or 없음>", ""]),
    "When the hook accepts the file, answer with the hook's summary, word for word, and stop.",
  ].join("\n")
}

// the `- ...` lines of `## 미해결 질문`: questions the user left open, shown
// at approval; plan writes an assumption for each.
export function openQuestions(text: string): string[] {
  const section = sectionText(text, "미해결 질문")
  return (section?.split(/\r?\n/) ?? []).filter(l => /^\s*[-*]\s+\S/.test(l)).map(l => l.trim())
}

// what keeps `## 범위` from deciding the scope: no table, a row of
// SCOPE_ROWS left out, or a row whose 상태 is neither 대상 nor 제외 ([?],
// 미확정, empty). Empty when it decides it.
export function scopeGaps(text: string): string[] {
  const rows = (sectionText(text, "범위")?.split(/\r?\n/) ?? [])
    .filter(l => l.trim().startsWith("|"))
    .map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
    .filter(cells => !cells.every(c => /^:?-+:?$/.test(c)))
    .slice(1)
  if (rows.length === 0) return ["`## 범위` has no table"]
  return [
    ...SCOPE_ROWS.filter(name => !rows.some(r => r[0] === name)).map(name => `\`## 범위\` has no row ${name}`),
    ...rows.filter(r => !/^(대상|제외)/.test(r[1] ?? "")).map(r => `\`## 범위\` row ${r[0]} is neither 대상 nor 제외`),
  ]
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim()

// the grade as the hook scores it from grade.md and 1-spec.md as it is:
// a dimension whose quotes are missing, not in 1-spec.md word for word, or
// holding [?] is capped; ambiguity = 1 - Σ(score × the type's weight).
export function scoreGrade(dims: GradeDim[], specText: string, type: SpecType, hash: string, asked: number): Grade {
  const text = flat(specText)
  let sum = 0
  const scored = DIMENSIONS.map(d => {
    const g = dims.find(x => x.name === d.name)!
    const cited = g.quotes.length > 0 && g.quotes.every(q => !q.includes("[?]") && flat(q) !== "" && text.includes(flat(q)))
    const score = cited ? g.score : Math.min(g.score, CITED)
    sum += score * d.weight[type]
    return { name: d.name, score, ...(cited ? {} : { capped: true as const }), ...(g.gap ? { gap: g.gap } : {}) }
  })
  // weights summing to 1 in floating point may overshoot it by a hair.
  return { hash, asked, ambiguity: Math.max(0, Math.round((1 - sum) * 1000) / 1000), dims: scored }
}

// under the threshold with no hard gate: `## 범위` decides every row.
export const passes = (grade: Grade, specText: string) => grade.ambiguity <= THRESHOLD && scopeGaps(specText).length === 0

// the last three grades each moved the ambiguity by STEADY or less.
export function steady(grades: Grade[]): boolean {
  const n = grades.length
  return n >= 4 && [1, 2, 3].every(i => Math.abs(grades[n - i]!.ambiguity - grades[n - i - 1]!.ambiguity) <= STEADY + 1e-9)
}

const isFact = (name: string) => DIMENSIONS.some(d => d.name === name && d.fact)

// the grade and what the main session does next.
export function gradeSummary(grades: Grade[], specText: string): string {
  const grade = grades.at(-1)!
  const scope = scopeGaps(specText)
  const scores = grade.dims.map(d => `${d.name} ${d.score}${d.capped ? " (capped: no quote found)" : ""}`).join(", ")
  const head = `D175: 1-spec.md graded: ambiguity ${grade.ambiguity} (passes at ${THRESHOLD} or less). Scores: ${scores}.`
  if (passes(grade, specText)) return `${head} It passes. Tell the user, then call mcp__rein__advance.`
  const facts = grade.dims.filter(d => isFact(d.name) && d.gap)
  const weakest = grade.dims.filter(d => !isFact(d.name) && d.gap).sort((a, b) => a.score - b.score)[0]
  const steps = [
    ...(scope.length > 0 ? [`Hard gate: ${scope.join("; ")}. Give every row 대상 or 제외 (<why>): from the code where the work plainly does not reach that part, by asking the user where the request leaves it open.`] : []),
    ...(facts.length > 0 ? [`Fill these facts by reading the code, never by asking: ${facts.map(d => `${d.name}: ${d.gap}`).join("; ")}.`] : []),
    ...(weakest ? [`Ask the user one question on the weakest dimension asked of them, ${weakest.name}: ${weakest.gap}`] : []),
    ...(steady(grades) ? ["The last three grades moved the ambiguity by 0.05 or less: ask from another angle (another dimension, or concrete options to choose from)."] : []),
    `At most ${EVERY} questions before the next grade. Write each answer into 1-spec.md before the next question.`,
  ]
  return `${head} ${steps.join(" ")}`
}

// the grade line of the approval question.
export function gradeLine(grade: Grade, specText: string): string {
  if (passes(grade, specText)) return `모호도 ${grade.ambiguity} (기준 ${THRESHOLD} 이하).`
  const weak = [...grade.dims].sort((a, b) => a.score - b.score).slice(0, 2).map(d => `${d.name} ${d.score}`).join(", ")
  const scope = scopeGaps(specText).length
  const over = grade.ambiguity > THRESHOLD ? `모호도 ${grade.ambiguity}, 기준 ${THRESHOLD} 초과` : `모호도 ${grade.ambiguity}`
  return `주의: ${over}. 약한 차원: ${weak}.${scope > 0 ? ` 범위 표에서 정하지 않은 곳 ${scope}개.` : ""}`
}

// the value of `<key>:` in 1-spec.md's front matter, the `---` block
// that opens the file, without the quotes around it; undefined when absent.
export function frontValue(text: string, key: string): string | undefined {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return undefined
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
  if (end < 0) return undefined
  const line = lines.slice(1, end).find(l => l.startsWith(`${key}:`))
  return line?.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2")
}

// a `참조:` in the front matter with a value (the reference, or 없음).
export function referenced(text: string): boolean {
  return (frontValue(text, "참조") ?? "") !== ""
}

// what the person is not asked to approve without: a line
// under `## 완료 판정` (qa checks against it), a `참조:` in the front matter
// with the reference or 없음 (land's commit title), and a `## 영향 범위` section with
// a `- <path> — <what relies on it>` line per affected path or 없음 (plan
// answers each). undefined when all are there.
export function specProblem(text: string): string | undefined {
  const missing: string[] = []
  if (completionLine(text) === undefined) missing.push("a line under `## 완료 판정` (D36)")
  if (!referenced(text)) missing.push("a `참조:` line in the front matter with the issue or ticket number, or 없음 (D96, D215)")
  const impacts = parseImpacts(text)
  if (impacts === undefined || (impacts.items.length === 0 && !impacts.none)) {
    missing.push("a `## 영향 범위` section with a `- <path> — <what relies on the code to change>` line per affected path, or 없음 (D155)")
  }
  return missing.length > 0 ? `1-spec.md is missing ${missing.slice(0, -1).join(", ")}${missing.length > 1 ? " and " : ""}${missing.at(-1)}` : undefined
}
