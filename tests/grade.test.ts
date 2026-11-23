import { describe, expect } from "claude-code/testing"
import { parseGrade } from "../hooks/lib/parse.ts"
import { DIMENSIONS, frontValue, openQuestions, passes, referenced, scopeGaps, scoreGrade, specType, steady } from "../hooks/stages/spec.ts"
import { relay, DIR, grade, gradeMd, SCOPE, SPEC_TEXT, spawned, store, world, test } from "./world.ts"

// a grader that sees only 1-spec.md scores it; the hook works out the
// ambiguity, paces the user's questions and shows what is left when it asks
// for approval.

const SPEC = `${DIR}/1-spec.md`
const GRADE = `${DIR}/agent/grade.md`
const GRADER = "agent-rein:grader"
const NAMES = DIMENSIONS.map(d => d.name)
const ADVANCE = { tool: "mcp__rein__advance" } as never
const STATUS = { tool: "mcp__rein__status" } as never
const spawn = { tool_use_id: "g", prompt: "the user said a lot", description: "grade", subagentType: "rein:grader", background: true } as never
const question = (n = 1) => ({ tool: "AskUserQuestion", questions: Array.from({ length: n }, (_, i) => ({ question: `q${i}?`, header: "h", options: [], multiSelect: false })) }) as never
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const record = () => store.get("runs:proj/login-fix") as { asked?: number; grader?: string; grades?: { ambiguity: number; asked: number }[] }

// grade.md with one score per dimension, in DIMENSIONS order.
const scored = (scores: number[], quote = "잠긴다") =>
  DIMENSIONS.map((d, i) => `## ${d.name}\n\n점수: ${scores[i]}\n근거: "${quote}"\n빈칸: ${scores[i]! < 0.9 ? `${d.name}의 빈칸` : "없음"}\n`).join("\n")

describe("grade.md (D175)", () => {
  test("the form: every dimension once, a score, quotes or 없음, a gap", () => {
    const ok = parseGrade(gradeMd(), NAMES)
    expect(ok).toEqual({ ok: true, dims: NAMES.map(name => ({ name, score: 0.9, quotes: ["잠긴다"] })) })
    expect(parseGrade(gradeMd().replace("## 문제", "## 목표"), NAMES)).toEqual(expect.objectContaining({ ok: false }))
    expect(parseGrade(gradeMd().replace("점수: 0.9", "점수: 1.5"), NAMES)).toEqual(expect.objectContaining({ ok: false }))
    expect(parseGrade(gradeMd().replace('근거: "잠긴다"', "근거: 잠긴다"), NAMES)).toEqual(expect.objectContaining({ ok: false }))
    expect(parseGrade(gradeMd().replace("빈칸: 없음", ""), NAMES)).toEqual(expect.objectContaining({ ok: false }))
    const none = parseGrade(gradeMd().replace('근거: "잠긴다"', "근거: 없음").replace("빈칸: 없음", "빈칸: 누가 겪는지"), NAMES)
    expect(none).toEqual(expect.objectContaining({ ok: true, dims: expect.arrayContaining([{ name: "문제", score: 0.9, quotes: [], gap: "누가 겪는지" }]) }))
  })

  test("a quote not in 1-spec.md word for word, or holding [?], caps its dimension at 0.4", () => {
    const dims = (quotes: string[]) => NAMES.map(name => ({ name, score: 1, quotes }))
    expect(scoreGrade(dims(["세 번   실패하면\n잠긴다"]), SPEC_TEXT, "bugfix", "h", 0).ambiguity).toBe(0)
    const made = scoreGrade(dims(["다섯 번 실패하면"]), SPEC_TEXT, "bugfix", "h", 0)
    expect(made.ambiguity).toBe(0.6)
    expect(made.dims.every(d => d.capped && d.score === 0.4)).toBe(true)
    expect(scoreGrade(dims([]), SPEC_TEXT, "bugfix", "h", 0).ambiguity).toBe(0.6)
    expect(scoreGrade(dims(["잠긴다 [?]"]), `${SPEC_TEXT}잠긴다 [?]\n`, "bugfix", "h", 0).ambiguity).toBe(0.6)
  })

  test("each 유형 weighs the dimensions its own way", () => {
    // 경계 조건 at 0 costs its weight: 0.2 in a feature, 0.15 in a bugfix.
    const edgeless = NAMES.map((name, i) => ({ name, score: i === 2 ? 0 : 1, quotes: ["잠긴다"] }))
    expect(scoreGrade(edgeless, SPEC_TEXT, "feature", "h", 0).ambiguity).toBe(0.2)
    expect(scoreGrade(edgeless, SPEC_TEXT, "bugfix", "h", 0).ambiguity).toBe(0.15)
    // 현행 동작 at 0: 0.1 in a feature, 0.2 in an improvement.
    const blind = NAMES.map((name, i) => ({ name, score: i === 3 ? 0 : 1, quotes: ["잠긴다"] }))
    expect(scoreGrade(blind, SPEC_TEXT, "feature", "h", 0).ambiguity).toBe(0.1)
    expect(scoreGrade(blind, SPEC_TEXT, "improvement", "h", 0).ambiguity).toBe(0.2)
    for (const t of ["feature", "bugfix", "improvement"] as const) {
      expect(Math.round(DIMENSIONS.reduce((sum, d) => sum + d.weight[t], 0) * 1000)).toBe(1000)
    }
    expect(specType(SPEC_TEXT)).toBe("bugfix")
    expect(specType(SPEC_TEXT.replace("유형: bugfix", "유형: 버그"))).toBeUndefined()
    expect(specType(SPEC_TEXT.replace("유형: bugfix\n", ""))).toBeUndefined()
  })

  test("## 범위 decides every row of the catalog as 대상 or 제외, or the grade fails", () => {
    const g = { hash: "h", asked: 0, ambiguity: 0.1, dims: [] }
    expect(scopeGaps(SPEC_TEXT)).toEqual([])
    const without = SPEC_TEXT.replace(SCOPE, "")
    expect(scopeGaps(without)).toEqual(["`## 범위` has no table"])
    expect(passes(g, without)).toBe(false)
    const open = SPEC_TEXT.replace("| 화면·UI | 제외 (닿지 않음) |", "| 화면·UI | [?] 대상인가 |").replace("| 외부 연동 | 제외 (닿지 않음) | |\n", "")
    expect(scopeGaps(open)).toEqual(["`## 범위` has no row 외부 연동", "`## 범위` row 화면·UI is neither 대상 nor 제외"])
    expect(passes(g, open)).toBe(false)
    // A domain's own row is judged too; 대상 decides it.
    const more = `${SPEC_TEXT}| 메뉴 등록 | 미확정 | |\n`
    expect(scopeGaps(more)).toEqual(["`## 범위` row 메뉴 등록 is neither 대상 nor 제외"])
    expect(scopeGaps(more.replace("| 메뉴 등록 | 미확정 |", "| 메뉴 등록 | 대상 |"))).toEqual([])
  })

  test("lines under ## 미해결 질문 are the user's open questions and do not fail the grade; steady grades are seen", () => {
    const text = `${SPEC_TEXT}\n## 미해결 질문\n\n- 관리자도 잠기는가\n- 문구는 나중에\n`
    expect(openQuestions(text)).toEqual(["- 관리자도 잠기는가", "- 문구는 나중에"])
    expect(openQuestions(SPEC_TEXT)).toEqual([])
    const g = { hash: "h", asked: 0, ambiguity: 0.1, dims: [] }
    expect(passes(g, SPEC_TEXT)).toBe(true)
    expect(passes(g, text)).toBe(true)
    const at = (ambiguity: number) => ({ ...g, ambiguity })
    expect(steady([0.5, 0.48, 0.45, 0.42].map(at))).toBe(true)
    expect(steady([0.48, 0.45, 0.42].map(at))).toBe(false)
    expect(steady([0.6, 0.5, 0.48, 0.46, 0.44].map(at))).toBe(true)
    expect(steady([0.6, 0.5, 0.45, 0.4].map(at))).toBe(false)
  })
})

describe("the grader (D175)", () => {
  test("is spawned in the foreground on the hook's task, only for a 1-spec.md that exists and changed", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    expect(await $.agent.spawn(spawn)).toEqual(refused(`D175: ${SPEC} does not exist yet.`))
    files[SPEC] = SPEC_TEXT.replace("유형: bugfix\n", "")
    expect(await $.agent.spawn(spawn)).toEqual(refused("1-spec.md has no `유형:` in its front matter, one of feature, bugfix, improvement"))
    files[SPEC] = SPEC_TEXT
    await $.agent.spawn(spawn)
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:grader", background: false })])
    expect(spawned[0]!.prompt).toContain("You did not see the conversation")
    expect(spawned[0]!.prompt).toContain(`Read ${SPEC}, and nothing else`)
    // The anchors of its 유형, not another's.
    expect(spawned[0]!.prompt).toContain("The spec is a bugfix")
    expect(spawned[0]!.prompt).toContain(`  - 1.0: ${DIMENSIONS[0]!.anchors.bugfix[2]}.`)
    expect(spawned[0]!.prompt).not.toContain(DIMENSIONS[0]!.anchors.feature[2])
    expect(spawned[0]!.prompt).not.toContain("the user said a lot")
    expect(record().grader).toBe(GRADER)
    await $.tool.call({ tool: "Write", file_path: GRADE, content: gradeMd(), agentId: GRADER } as never)
    expect(record().grader).toBeUndefined()
    expect(await $.agent.spawn(spawn)).toEqual(refused("D175: 1-spec.md has not changed since its last grade (ambiguity 0.1)"))
  })

  test("a new grader finds no grade.md: the hook removes the last one, or refuses the spawn when it cannot", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    let removable = true
    world(on, files, undefined, undefined, { remove: () => removable })
    await $.agent.spawn(spawn)
    await $.tool.call({ tool: "Write", file_path: GRADE, content: gradeMd(), agentId: GRADER } as never)
    expect(files[GRADE]).toBeDefined()
    files[SPEC] = `${SPEC_TEXT}\n더 적음\n`
    removable = false
    expect(await $.agent.spawn(spawn)).toEqual(refused("The last grade.md could not be removed for the new grader"))
    expect(files[GRADE]).toBeDefined()
    removable = true
    await $.agent.spawn(spawn)
    expect(files[GRADE]).toBeUndefined()
    expect(spawned).toHaveLength(2)
  })

  test("reads 1-spec.md and writes grade.md, nothing else; a grade.md by anyone else is no grade", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, "E:/proj/src/a.ts": "x" })
    // the main session may write it, but the hook does not take it as a grade.
    const own = await $.tool.call({ tool: "Write", file_path: GRADE, content: gradeMd() } as never)
    expect(own).toEqual(expect.objectContaining({ result: "ok" }))
    expect(context(own)).not.toContain("graded")
    expect((record() as { grades?: unknown[] }).grades).toBeUndefined()
    await $.agent.spawn(spawn)
    const as = (e: Record<string, unknown>) => ({ ...e, agentId: GRADER }) as never
    expect(await $.tool.call(as({ tool: "Read", file_path: SPEC }))).toEqual(expect.objectContaining({ result: "ok" }))
    for (const call of [
      { tool: "Read", file_path: "E:/proj/src/a.ts" },
      { tool: "Grep", pattern: "x", path: DIR },
      { tool: "Bash", command: "git status" },
      { tool: "Write", file_path: SPEC, content: "x" },
    ]) {
      expect(await $.tool.call(as(call))).toEqual(refused("D175: the grader reads"))
    }
    expect(await $.tool.call(as({ tool: "Edit", file_path: GRADE, old_string: "a", new_string: "b" }))).toEqual(refused("D175: the grader reads"))
    expect(await $.tool.call(as({ tool: "Write", file_path: GRADE, content: "## 문제\n" }))).toEqual(refused("D175: grade.md must have one `## <dimension>` section"))
    const r = await $.tool.call(as({ tool: "Write", file_path: GRADE, content: gradeMd() }))
    expect(context(r)).toContain("D175: 1-spec.md graded: ambiguity 0.1 (passes at 0.25 or less).")
    expect(context(r)).toContain("It passes. Tell the user, then call mcp__rein__advance.")
    // the hand-back carries the grader's answer to the session.
    expect(await $.tool.call(as({ tool: "SubagentHandback", report: "graded" }))).toEqual(expect.objectContaining({ result: "ok" }))
    // Spent: a second grade.md from the same grader is refused.
    expect(await $.tool.call(as({ tool: "Write", file_path: GRADE, content: gradeMd() }))).toEqual(refused("D175: only the rein:grader"))
  })

  test("a failing grade says what to do next: facts by reading, one question on the weakest asked dimension", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files)
    const r = await grade($, scored([0.8, 0.5, 0.3, 0.6, 0.9]))
    const said = context(r)
    expect(said).toContain("ambiguity 0.38")
    expect(said).toContain("Fill these facts by reading the code, never by asking: 현행 동작: 현행 동작의 빈칸.")
    expect(said).toContain("ask the user one question from the tree's frontier")
    expect(said).toContain("The gap, 경계 조건: 경계 조건의 빈칸")
    expect(said).toContain("At most 3 questions before the next grade.")
    expect(said).not.toContain("of 12")
    const status = ((await $.tool.call(STATUS)) as { result: string }).result
    expect(status).toContain("grade after 0 questions: ambiguity 0.38")
    expect(status).toContain("- 경계 조건: 0.3 — 빈칸: 경계 조건의 빈칸")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"grade"`)
  })
})

describe("the user's questions in spec (D175)", () => {
  test("one per call, at most three between grades; a dismissed one does not count", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    let dismiss = false
    world(on, files, () => (dismiss ? undefined : "예"))
    expect(await $.tool.call(question(2))).toEqual(refused("D175: ask the user one question per call; this call has 2."))
    dismiss = true
    await $.tool.call(question())
    dismiss = false
    for (let i = 0; i < 3; i++) expect(await $.tool.call(question())).toEqual(expect.objectContaining({ text: "예" }))
    expect(record().asked).toBe(3)
    expect(await $.tool.call(question())).toEqual(refused("D175: 3 questions since the last grade."))
    files[SPEC] = `${SPEC_TEXT}답 셋\n`
    await grade($)
    expect(await $.tool.call(question())).toEqual(expect.objectContaining({ text: "예" }))
    expect(record().asked).toBe(4)
  })

  test("no cap in all: past twelve a question is still asked; a subagent's question is not paced", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    const grades = [{ hash: "h", asked: 12, ambiguity: 0.4, dims: [] }]
    world(on, files, () => "예", { stage: "spec", runId: "login-fix", asked: 12, grades })
    expect(await $.tool.call(question())).toEqual(expect.objectContaining({ text: "예" }))
    expect(record().asked).toBe(13)
    expect(await $.tool.call({ ...(question(2) as object), agentId: "agent-x" } as never)).toEqual(expect.objectContaining({ text: "예" }))
  })
})

describe("approval with the grade (D175)", () => {
  test("no question before 1-spec.md as it is has a grade", async ($, on) => {
    let asked = false
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => ((asked = true), "승인"))
    expect(await relay($, ADVANCE)).toEqual(refused("D175: 1-spec.md has no grade yet. Spawn rein:grader"))
    await grade($)
    files[SPEC] = `${SPEC_TEXT}더함\n`
    expect(await relay($, ADVANCE)).toEqual(refused("D175: 1-spec.md changed since its last grade."))
    expect(asked).toBe(false)
  })

  test("a passing grade is named in the question", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), "승인"))
    await grade($)
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(questions[0]).toContain("모호도 0.1 (기준 0.25 이하).")
  })

  test("a failing grade warns, and the wait says the user may want more questions", async ($, on) => {
    const questions: string[] = []
    let answer: string | undefined
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), answer))
    await grade($, scored([0.8, 0.5, 0.3, 0.6, 0.9]))
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining("The grade does not pass yet: they may also want more questions") })
    expect(questions[0]).toContain("주의: 모호도 0.38, 기준 0.25 초과. 약한 차원: 경계 조건 0.3, 완료 판정 0.5.")
    // The user says it is enough: approving with the warning moves on.
    answer = "승인"
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
  })

  test("the questions the user left open are listed before approval, with what plan does with them", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: `${SPEC_TEXT}\n## 미해결 질문\n\n- 관리자도 잠기는가\n` }, q => (questions.push(q), undefined))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("모호도 0.1 (기준 0.25 이하).")
    expect(questions[0]).toContain("열어 둔 질문 1개 — 이대로 승인하면 plan이 각각의 가정을 2-plan.md의 결정 사항에 적고 설계합니다:\n```text\n> - 관리자도 잠기는가\n```")
  })

  test("an undecided ## 범위 row fails the grade under the threshold: the summary and the question say so", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT.replace("| 권한·설정 | 제외 (닿지 않음) |", "| 권한·설정 | [?] |") }, q => (questions.push(q), undefined))
    const said = context(await grade($))
    expect(said).not.toContain("It passes")
    expect(said).toContain("Hard gate: `## 범위` row 권한·설정 is neither 대상 nor 제외. Give every row 대상 or 제외 (<why>)")
    await relay($, ADVANCE)
    expect(questions[0]).toContain("주의: 모호도 0.1. 약한 차원: 문제 0.9, 완료 판정 0.9. 범위 표에서 정하지 않은 곳 1개.")
  })
})

describe("1-spec.md's front matter (D215)", () => {
  test("a value of the opening --- block, quotes dropped; 참조 needs one", () => {
    const front = (body: string) => `---\n${body}\n---\n\n# t\n`
    expect(frontValue(front('slug: login-fix\n참조: "#42"'), "참조")).toBe("#42")
    expect(frontValue(front("참조: ISSUE-1"), "참조")).toBe("ISSUE-1")
    expect(frontValue(front("slug: login-fix"), "참조")).toBeUndefined()
    expect(frontValue(`# t\n\n---\n참조: "#42"\n---\n`, "참조")).toBeUndefined()
    expect(frontValue('---\n참조: "#42"\n# t\n', "참조")).toBeUndefined()
    expect(referenced(front('참조: "없음"'))).toBe(true)
    expect(referenced(front('참조: ""'))).toBe(false)
    expect(referenced(front("참조:"))).toBe(false)
    expect(referenced("# t\n\n## 참조\n\nISSUE-1\n")).toBe(false)
  })
})
