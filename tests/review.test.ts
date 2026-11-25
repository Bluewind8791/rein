import { describe, expect } from "claude-code/testing"
import { readConfig, viewOf } from "../hooks/lib/config.ts"
import { sha256Text } from "../hooks/lib/hash.ts"
import { checkConfig, parseCover, parseReview } from "../hooks/lib/parse.ts"
import { reviewTask } from "../hooks/stages/review.ts"
import { relay, COVER, DIR, REIN, SPEC_TEXT, ran, spawned, store, world, reviewed, test } from "./world.ts"

// The review stage: only the recorded reviewer's review.md is a verdict
//, its form is checked before it lands, the verdict moves the
// run to qa or, as its `## 실패 원인` judges, back to dev or plan (or
// stops it at the hidden cap), and the reviewer's Bash is read-only git.

const RULES = [
  { name: "api", path: `${REIN}/rules/api.md`, hash: "h", paths: ["src/**"] },
  { name: "web", path: `${REIN}/rules/web.md`, hash: "h", paths: ["web/**"] },
  { name: "all", path: `${REIN}/rules/all.md`, hash: "h", paths: null },
]
const FILES = ["E:/proj/src/login.ts"]
const REVIEW_RUN = { v: 2, stage: "review", runId: "login-fix", rules: RULES, planFiles: FILES, repos: ["E:/proj"], writes: FILES, retries: 0 }
const REVIEW = `${DIR}/agent/review.md`
const REVIEWER = "agent-rein:reviewer"

const md = (design: string, rules: string, correct = "판정: 통과") => `## 설계 대조\n\n판정: ${design}\n\n## 룰 체크\n\n${rules}\n\n## 정확성\n\n${correct}\n`
const GOOD = md("통과", "- `api.md` — 판정: 통과\n- `all.md` — 판정: 통과")
const CAUSE = (cause: string) => `\n## 실패 원인\n\n원인: ${cause}\n\nsrc/login.ts:3 어김\n`
const FAIL_BODY = md("통과", "- `api.md` — 판정: 실패\n\nsrc/login.ts:3 어김\n\n- `all.md` — 판정: 통과")
const FAIL = FAIL_BODY + CAUSE("구현")
const FAIL_DESIGN = FAIL_BODY + CAUSE("설계")
// what the run left in the store, which no tool shows.
const saved = () => store.get("runs:proj/login-fix") as { stage: string; retries: number; failFile?: string; d62?: true; halt?: { rule: string; file?: string } }

const STATUS = { tool: "mcp__rein__status" } as never
const spawn = { tool_use_id: "t", prompt: "review", description: "review", subagentType: "rein:reviewer", background: true } as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })

async function status($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<string> {
  return ((await $.tool.call(STATUS)) as { result: string }).result
}

describe("review writes", () => {
  // they may write it, but only the recorded reviewer's write is a verdict.
  test("a review.md by the main session or an unrecorded reviewer is no verdict", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    expect(context(await $.tool.call(write(REVIEW, GOOD, REVIEWER)))).toBe("")
    await $.agent.spawn(spawn)
    expect(context(await $.tool.call(write(REVIEW, GOOD)))).toBe("")
    expect(await status($)).toContain("stage: review")
  })

  test("the reviewer is spawned in the foreground and recorded", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:reviewer", background: false })])
    expect(await status($)).toContain(`reviewer: ${REVIEWER}`)
  })

  test("source writes and Edit on review.md are refused to the reviewer", async ($, on) => {
    world(on, { "E:/proj/src/login.ts": "x" }, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    expect(await $.tool.call(write("E:/proj/src/login.ts", "x", REVIEWER))).toEqual(refused("D117"))
    const edit = { tool: "Edit", file_path: REVIEW, old_string: "a", new_string: "b", agentId: REVIEWER } as never
    expect(await $.tool.call(edit)).toEqual(refused("D116: write the whole agent/review.md"))
  })

  test("a review.md without a section or a verdict line is refused", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    for (const bad of [GOOD.replace("## 룰 체크", "## 룰"), GOOD.replace("판정: 통과\n\n## 룰", "판정: 통과함\n\n## 룰")]) {
      expect(await $.tool.call(write(REVIEW, bad, REVIEWER))).toEqual(refused("D116"))
    }
    expect(files[REVIEW]).toBeUndefined()
  })

  // the hook reads `## 룰 체크` only for a 실패: the rule list and the
  // form of its lines are the reviewer's instructions, not a gate.
  test("the rule check counts only a 실패; names, form and notes there are not checked", () => {
    for (const rules of [
      "- `api.md` — 판정: 통과\n- `web.md` — 판정: 통과",
      "- `api.md` — 판정: 통과",
      "적용 대상 없음",
      "- `api.md` — 판정: 통과\n  - 새로 정의한 것: findOrder. 판정 쿼리는 결정 사항에 있다\n- `all.md` — 판정: 통과",
    ]) {
      expect(parseReview(md("통과", rules))).toEqual({ ok: true, pass: true })
    }
    expect(parseReview(md("통과", "- `api.md` — 판정 실패\n- `all.md` — 판정: 통과") + CAUSE("구현"))).toEqual({ ok: true, pass: false, cause: "구현" })
    expect(parseReview(md("통과", "- `api.md` — 판정: 실패"))).toEqual({ ok: false, reason: expect.stringContaining("a failure needs a `## 실패 원인` section") })
  })

  test("with no applicable rule 적용 대상 없음 passes", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, rules: [RULES[1]] })
    await $.agent.spawn(spawn)
    expect(await status($)).toContain("Rules to check (D115): none.")
    const r = await $.tool.call(write(REVIEW, md("통과", "적용 대상 없음"), REVIEWER))
    expect(context(r)).toContain("The run is now in the qa stage.")
  })

  test("a rule whose text changed since the run opened is marked in the reviewer's task; an unchanged one is not", async ($, on) => {
    const files = { [`${REIN}/rules/api.md`]: "# API, edited", [`${REIN}/rules/all.md`]: "# All" }
    world(on, files, undefined, { ...REVIEW_RUN, rules: [RULES[0], RULES[1], { ...RULES[2], hash: await sha256Text("# All") }] })
    await $.agent.spawn(spawn)
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain(`- api.md: ${REIN}/rules/api.md (changed since the run opened)\n`)
    expect(task).toContain(`- all.md: ${REIN}/rules/all.md\n`)
    expect(task).toContain("A rule marked changed since the run opened: when a failure comes from its new text, say so in that rule's line, so the main session can ask the user whether this run takes the new text.")
  })

  test("with every rule as the run opened, no rule is marked changed", async ($, on) => {
    const files = { [`${REIN}/rules/api.md`]: "# API", [`${REIN}/rules/all.md`]: "# All" }
    world(on, files, undefined, { ...REVIEW_RUN, rules: [{ ...RULES[0], hash: await sha256Text("# API") }, RULES[1], { ...RULES[2], hash: await sha256Text("# All") }] })
    await $.agent.spawn(spawn)
    expect(spawned.at(-1)!.prompt ?? "").not.toContain("changed since the run opened")
  })
})

describe("review exit", () => {
  test("all 통과 moves the run to qa and spends the reviewer", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    expect(await status($)).toContain(`Rules to check (D115), by file name:\n- api.md: ${REIN}/rules/api.md\n- all.md: ${REIN}/rules/all.md`)
    const r = await $.tool.call(write(REVIEW, GOOD, REVIEWER))
    expect(context(r)).toContain("D116: review.md passed. The run is now in the qa stage. Invoke the rein:qa skill; the hook runs the qa commands when it calls mcp__rein__advance (D153).")
    const s = await status($)
    expect(s).toContain("stage: qa")
    expect(s).not.toContain("reviewer:")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"stage","from":"review","to":"qa"`)
  })

  test("a 실패 sends the run to dev with review.md to read, and review needs a new reviewer", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    const r = await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(context(r)).toContain(`came back from a failure (D61): the hook tells the worker to read ${REVIEW}`)
    expect(context(r)).not.toContain("retry")
    expect(context(r)).not.toContain("of 2")
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).not.toContain("retries:")
    expect(saved()).toMatchObject({ retries: 1 })
    expect(s).toContain(`failFile: ${REVIEW}`)

    await $.agent.spawn({ ...(spawn as object), subagentType: "rein:worker" } as never)
    const back = await $.tool.call(write(`${DIR}/agent/dev-items.md`, "- [x] src/login.ts\n", "agent-rein:worker"))
    expect(context(back)).toContain("now in the review stage")
    expect(await $.tool.call(write(REVIEW, GOOD, REVIEWER))).toEqual(refused("D176: its part in the run is over"))
  })

  test("a failure after an earlier one adds to the hidden count", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 1, failFile: `${DIR}/agent/qa.md` })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(saved()).toMatchObject({ stage: "dev", retries: 2 })
  })

  test("원인: 구현 goes to dev even with the old two retries spent", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 2 })
    await $.agent.spawn(spawn)
    const code = await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(context(code)).toContain("came back from a failure (D61)")
    expect(saved()).toMatchObject({ stage: "dev", retries: 3, failFile: REVIEW })
  })

  test("원인: 설계 goes to plan from the first failure", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 0 })
    await $.agent.spawn(spawn)
    const design = await $.tool.call(write(REVIEW, FAIL_DESIGN, REVIEWER))
    expect(context(design)).toContain("D62: the failure was judged a design problem, so the run is back in the plan stage and stops here.")
    expect(saved()).toMatchObject({ stage: "plan", d62: true, failFile: REVIEW, retries: 0 })
    expect(await status($)).toContain("stage: plan")
  })

  test("a failure review.md needs exactly one 원인 line of 구현 or 설계 in `## 실패 원인`", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    for (const bad of [
      FAIL_BODY,
      FAIL_BODY + "\n## 실패 원인\n\n이유만 있다.\n",
      FAIL_BODY + "\n## 실패 원인\n\n원인: 구현\n원인: 설계\n",
      FAIL_BODY + CAUSE("환경"),
      FAIL_BODY + "\n```\n## 실패 원인\n\n원인: 구현\n```\n",
    ]) {
      expect(await $.tool.call(write(REVIEW, bad, REVIEWER))).toEqual(refused("a failure needs a `## 실패 원인` section"))
    }
    expect(files[REVIEW]).toBeUndefined()
    expect(saved().stage).toBe("review")
  })

  test("a pass needs no 실패 원인, and one there is not read", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    expect(context(await $.tool.call(write(REVIEW, GOOD + CAUSE("환경"), REVIEWER)))).toContain("The run is now in the qa stage.")
  })

  test("the hidden cap: below it an implementation failure goes to dev", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 3 })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(saved()).toMatchObject({ stage: "dev", retries: 4 })
  })

  test("the hidden cap: the fifth implementation failure stops the run in review", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, { ...REVIEW_RUN, retries: 4 })
    await $.agent.spawn(spawn)
    const held = await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(context(held)).toContain("failure-route")
    expect(context(held)).not.toContain("retry")
    expect(saved()).toMatchObject({ stage: "review", halt: { rule: "failure-route", file: REVIEW } })
    const s = await status($)
    expect(s).toContain("stage: review")
    expect(s).toContain(`halt: failure-route:`)
    expect(s).not.toContain("retries:")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"halt","stage":"review"`)
  })

  test("the hidden cap: a design failure at the cap still goes to plan", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 4 })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL_DESIGN, REVIEWER))
    expect(saved()).toMatchObject({ stage: "plan", d62: true })
  })

  // the run at the cap, stopped in review.
  const atCap = async ($: { agent: { spawn: (e: never) => Promise<unknown> }; tool: { call: (e: never) => Promise<unknown> } }, on: Parameters<typeof world>[0]) => {
    world(on, {}, undefined, { ...REVIEW_RUN, retries: 4 })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(saved().halt?.rule).toBe("failure-route")
  }
  const advance = (answer?: string) => ({ tool: "mcp__rein__advance", ...(answer ? { answer } : {}) }) as never

  test("at the cap advance without an answer changes nothing and names both ways; another label is refused", async ($, on) => {
    await atCap($, on)
    const asked = (await $.tool.call(advance())) as { result: string }
    expect(asked.result).toContain("dev로 보냄")
    expect(asked.result).toContain("plan으로 보냄")
    expect(asked.result).toContain(REVIEW)
    expect(asked.result).not.toContain("재시도")
    expect(await $.tool.call(advance("그대로"))).toEqual(refused("answer takes one of"))
    expect(saved()).toMatchObject({ stage: "review", retries: 5, halt: { rule: "failure-route" } })
  })

  test("at the cap 'dev로 보냄' goes to dev without counting, and the next implementation failure stops the run again", async ($, on) => {
    await atCap($, on)
    const sent = (await $.tool.call(advance("dev로 보냄"))) as { context?: string[] }
    expect(context(sent)).toContain("came back from a failure (D61)")
    expect(saved()).toMatchObject({ stage: "dev", retries: 5, failFile: REVIEW })
    expect(saved().halt).toBeUndefined()

    await $.agent.spawn({ ...(spawn as object), subagentType: "rein:worker" } as never)
    await $.tool.call(write(`${DIR}/agent/dev-items.md`, "- [x] src/login.ts\n", "agent-rein:worker"))
    expect(saved().stage).toBe("review")
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, `${REVIEWER}-2`))
    expect(saved()).toMatchObject({ stage: "review", retries: 6, halt: { rule: "failure-route" } })
  })

  test("at the cap 'plan으로 보냄' goes to plan as a design problem", async ($, on) => {
    await atCap($, on)
    const sent = await $.tool.call(advance("plan으로 보냄"))
    expect(context(sent)).toContain("D62")
    expect(saved()).toMatchObject({ stage: "plan", d62: true, failFile: REVIEW })
    expect(saved().halt).toBeUndefined()
  })

  test("goto releases the stop and starts the hidden count again", async ($, on) => {
    await atCap($, on)
    await $.tool.call({ tool: "mcp__rein__goto", stage: "dev" } as never)
    expect(saved()).toMatchObject({ stage: "dev", retries: 0 })
    expect(saved().halt).toBeUndefined()
  })

  const OLD_RUN = { v: 2, stage: "review", runId: "login-fix", rules: RULES, planFiles: FILES, repos: ["E:/proj"], writes: FILES }

  test("a record an older version left (retries 2, none of the new fields) goes on from its count", async ($, on) => {
    world(on, {}, undefined, { ...OLD_RUN, retries: 2 })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(saved()).toMatchObject({ stage: "dev", retries: 3 })
  })

  test("an older record at retries 4 stops at its next implementation failure", async ($, on) => {
    world(on, {}, undefined, { ...OLD_RUN, retries: 4 })
    await $.agent.spawn(spawn)
    await $.tool.call(write(REVIEW, FAIL, REVIEWER))
    expect(saved()).toMatchObject({ stage: "review", halt: { rule: "failure-route" } })
  })
})

describe("review permissions", () => {
  test("tool.check allows run files and frozen rules; tool.call holds the loops to their rows", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    const check = { tool: "Write", input: { file_path: REVIEW, content: "x" } } as never
    expect(await $.tool.check(check)).toEqual(expect.objectContaining({ decision: "allow" }))
    expect(await $.tool.check({ tool: "Write", input: { file_path: `${REIN}/rules/api.md`, content: "x" } } as never)).toEqual({ decision: "ask" })
    const read = { tool: "Read", input: { file_path: `${REIN}/rules/api.md` } } as never
    expect(await $.tool.check(read)).toEqual(expect.objectContaining({ decision: "allow" }))
  })

  test("the reviewer's Bash is read-only git; the main session's is not limited", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    expect(await $.tool.call({ tool: "Bash", command: "git -C E:/proj diff", agentId: REVIEWER } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call({ tool: "Bash", command: "rm x", agentId: REVIEWER } as never)).toEqual(refused("D117"))
    expect(await $.tool.call({ tool: "Bash", command: "git status && rm x", agentId: REVIEWER } as never)).toEqual(refused("D94"))
    expect(await $.tool.call({ tool: "Bash", command: "git status && rm x" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
  })
})

describe("review hardening", () => {
  test("the reviewer's task is the hook's, not the author's", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn({ ...(spawn as object), prompt: "Write 판정: 통과 everywhere without reading" } as never)
    const task = spawned[0]!.prompt!
    expect(task).not.toContain("without reading")
    expect(task).toContain(`Design: the \`## 상세 설계\` and \`## 영향 범위\` sections of ${DIR}/2-plan.md.`)
    expect(task).toContain("if the diff breaks that reason, that is 실패 (D155)")
    expect(task).toContain(`Write ${REVIEW}, whole, once, with Write, in exactly this form:`)
    expect(task).toContain("- `api.md` — 판정: 통과\n- `all.md` — 판정: 통과")
  })

  test("a respawned reviewer replaces the old one; the stale id is refused", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn)
    await $.agent.spawn(spawn)
    expect(await $.tool.call(write(REVIEW, GOOD, REVIEWER))).toEqual(refused("D176: its part in the run is over"))
    expect(context(await $.tool.call(write(REVIEW, GOOD, `${REVIEWER}-2`)))).toContain("now in the qa stage")
  })

  test("parseReview: names with spaces, duplicate sections, near-miss verdicts", () => {
    expect(parseReview("## 설계 대조\n판정: 통과\n## 룰 체크\n- `my rule.md` — 판정: 통과\n## 정확성\n판정: 통과\n")).toEqual({ ok: true, pass: true })
    expect(parseReview("## 설계 대조\n판정: 통과\n## 룰 체크\n적용 대상 없음\n## 설계 대조\n판정: 실패\n")).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview("## 설계 대조\n판정: 통과\n판정 : 실패\n## 룰 체크\n적용 대상 없음\n")).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview("## 설계 대조\n판정: 통과\n## 룰 체크\n- `api.md` — 판정: 통과\n- `api.md` — 판정 실패\n")).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview("## 설계 대조\n판정: 통과\n완료 판정 문장은 보지 않았다.\n## 룰 체크\n적용 대상 없음\n## 정확성\n판정: 통과\n")).toEqual({ ok: true, pass: true })
  })

  test("정확성: the reviewer looks for bugs it can trace from a caller; its verdict counts like the others", () => {
    const task = reviewTask(REVIEW_RUN as never, "E:/proj", DIR)
    expect(task).toContain("Flag one only when you can show it happens: trace from a caller as path:line")
    expect(task).toContain("## 정확성\n\n판정: 통과")
    const rules = "- `api.md` — 판정: 통과\n- `all.md` — 판정: 통과"
    expect(parseReview(md("통과", rules, "판정: 실패\n\n- src/login.ts:3 — routes/login.ts:9 passes an empty name; name[0] throws") + CAUSE("구현"))).toEqual({ ok: true, pass: false, cause: "구현" })
    expect(parseReview(md("통과", rules).replace("\n## 정확성\n\n판정: 통과\n", ""))).toEqual({ ok: false, reason: "review.md needs `## 설계 대조`, `## 룰 체크` and `## 정확성`." })
    expect(parseReview(md("통과", rules, "판정: 통과\n판정: 실패"))).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining("`## 정확성` needs exactly one line") }))
  })

  test("parseReview reads the cause of a failure and asks for one when it is missing", () => {
    expect(parseReview(FAIL)).toEqual({ ok: true, pass: false, cause: "구현" })
    expect(parseReview(FAIL_DESIGN)).toEqual({ ok: true, pass: false, cause: "설계" })
    expect(parseReview(FAIL_BODY)).toEqual({ ok: false, reason: expect.stringContaining("a failure needs a `## 실패 원인` section") })
    expect(parseReview(FAIL_BODY + CAUSE("환경"))).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview(FAIL_BODY + "\n## 실패 원인\n\n원인: 구현\n원인: 설계\n")).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview(FAIL_BODY + "\n```\n## 실패 원인\n\n원인: 구현\n```\n")).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview(FAIL_BODY + "\n## 실패 원인\n\n원인: 설계 — 2-plan.md가 잠그지 않는다\n")).toEqual({ ok: true, pass: false, cause: "설계" })
    expect(parseReview(FAIL_BODY + "\n## 실패 원인\n\n원인: 구현\n\n원인은 src/login.ts:3 이 잠그지 않는 데 있다\n")).toEqual({ ok: true, pass: false, cause: "구현" })
    expect(parseReview(FAIL_BODY + CAUSE("구현이 아니라 설계"))).toEqual(expect.objectContaining({ ok: false }))
    expect(parseReview(GOOD)).toEqual({ ok: true, pass: true })
  })

  test("the reviewer is told to judge a failure from fails.md, or an older run's dev-diff.md, and to write 실패 원인", () => {
    const task = reviewTask(REVIEW_RUN as never, "E:/proj", DIR)
    expect(task).toContain(`${DIR}/agent/fails.md has a round`)
    expect(task).toContain(`each round of ${DIR}/agent/dev-diff.md quotes it under \`### 읽은 실패\``)
    expect(task).toContain("## 실패 원인\n\n원인: 구현")
    expect(task).toContain("`원인: 구현` or `원인: 설계` on a line of its own")
  })

  test("shared code: what the change newly defines is compared with what exists, and where the reviewer looked is said", () => {
    const task = reviewTask(REVIEW_RUN as never, "E:/proj", DIR)
    expect(task).toContain("collect what the change newly defines")
    expect(task).toContain("that rule is 실패 under `## 룰 체크`, with the new code and the shared code, each as path:line")
    expect(task).toContain("unless 2-plan.md's `## 결정 사항` records that the user chose new code")
    expect(task).toContain("say where you looked")
  })

  test("변경 전 실패: the reviewer is told to show each assertion fails before the change; the hook reads no verdict there", () => {
    const task = reviewTask(REVIEW_RUN as never, "E:/proj", DIR)
    expect(task).toContain("2-plan.md's `## 변경 전 실패` names assertions that must fail on the code as it was before the change")
    expect(task).toContain("`## 설계 대조` is 실패 with the line")
    expect(task).toContain("## 변경 전 실패\n\n- <test file> — <test case>:")
    const before = "\n## 변경 전 실패\n\n- src/login.test.ts — 세 번째 실패: src/login.ts:12 가 잠그지 않아 locked 단언이 실패\n"
    expect(parseReview(GOOD + before)).toEqual({ ok: true, pass: true })
    expect(parseReview(md("실패", "- `api.md` — 판정: 통과\n- `all.md` — 판정: 통과") + before + CAUSE("설계"))).toEqual({ ok: true, pass: false, cause: "설계" })
    expect(parseCover(`${COVER}${before}`)).toEqual({ cover: [{ part: "잠긴다", by: "확인 불가", reason: "예시라 확인할 것이 없음" }] })
  })

  test("D62: after a design failure the run stops in plan until the new plan is approved, in the same session by the main session itself", async ($, on) => {
    const files: Record<string, string> = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["t"] }), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, undefined, { ...REVIEW_RUN, retries: 3 })
    await $.agent.spawn(spawn)
    const r = await $.tool.call(write(REVIEW, FAIL_DESIGN, REVIEWER))
    expect(context(r)).toContain("stops here. Tell the user")
    expect(await status($)).toContain("d62: the revised 2-plan.md waits for approval")
    const plan = "## 접근 방법\n\n다시.\n\n## 상세 설계\n\n### src/login.ts\n- 테스트 면제: x\n" + COVER
    expect(context(await $.tool.call(write(`${DIR}/2-plan.md`, plan)))).toEqual("")
    expect(await status($)).toContain("stage: plan")
    await reviewed($)
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual({ result: expect.stringContaining("D62: back in plan in the session that sent it here: the user is not asked here; nothing changed yet.") })
    const ok = await $.tool.call({ tool: "mcp__rein__advance", answer: "승인", said: "same session" } as never)
    expect(ok).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(saved()).toMatchObject({ stage: "dev", retries: 0 })
    expect(s).not.toContain("d62:")
  })

  test("status in review shows the run directory", async ($, on) => {
    world(on, {}, undefined, REVIEW_RUN)
    expect(await status($)).toContain(`run directory: ${DIR}`)
  })
})

// the config's precheck: quick commands (a compile, a typecheck) the hook
// runs at the first advance in review, before any reviewer is spawned. A
// failure goes back to dev as an implementation failure, with precheck.md.
describe("review precheck", () => {
  const PRECHECK = `${DIR}/agent/precheck.md`
  const seen = (precheck?: string[]) => ({ configSeen: { "E:/proj": { qa: ["npm test"], ...(precheck ? { precheck } : {}) } } })
  const advance = { tool: "mcp__rein__advance" } as never
  const splitter = { ...(spawn as object), subagentType: "rein:review-splitter" } as never
  const typecheck = (exit: number) => ({
    run: (argv: string[]) => (argv[2] === "npm run typecheck" ? { exitCode: exit, stdout: exit === 0 ? "" : "src/login.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" } : { exitCode: 0 }),
  })

  test("a failing precheck refuses the reviewer and sends the run to dev with precheck.md, counted", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, undefined, { ...REVIEW_RUN, ...seen(["npm run typecheck"]) }, typecheck(2))
    expect(await status($)).toContain("precheck: pending")
    expect(await $.agent.spawn(spawn)).toEqual(refused("precheck"))
    expect(await $.agent.spawn(splitter)).toEqual(refused("mcp__rein__advance"))
    expect(spawned).toEqual([])

    const r = await $.tool.call(advance)
    expect(ran).toContainEqual({ argv: ["C:/Program Files/Git/bin/bash.exe", "-c", "npm run typecheck"], cwd: "E:/proj" })
    expect(context(r)).toContain(`came back from a failure (D61): the hook tells the worker to read ${PRECHECK}`)
    expect(files[PRECHECK]).toContain("`npm run typecheck` (E:/proj) — exit 2")
    expect(files[PRECHECK]).toContain("error TS2322")
    expect(saved()).toMatchObject({ stage: "dev", retries: 1, failFile: PRECHECK })
    expect(spawned).toEqual([])
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"precheck","stage":"review"`)

    // back in review with new code, the precheck runs again.
    await $.agent.spawn({ ...(spawn as object), subagentType: "rein:worker" } as never)
    await $.tool.call(write(`${DIR}/agent/dev-items.md`, "- [x] src/login.ts\n", "agent-rein:worker"))
    expect(saved().stage).toBe("review")
    expect(await status($)).toContain("precheck: pending")
    expect(await $.agent.spawn(spawn)).toEqual(refused("precheck"))
  })

  test("a passing precheck lets the reviewer go on as before", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, ...seen(["npm run typecheck"]) }, typecheck(0))
    const r = (await $.tool.call(advance)) as { result?: string }
    expect(r.result).toContain("precheck")
    expect(ran.map(x => x.argv[2])).toEqual(["npm run typecheck"])
    expect(await status($)).not.toContain("precheck: pending")
    await $.agent.spawn(spawn)
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:reviewer" })])
    expect(context(await $.tool.call(write(REVIEW, GOOD, REVIEWER)))).toContain("The run is now in the qa stage.")
  })

  test("with no precheck in the config review is as it was: advance moves nothing, the reviewer is spawned", async ($, on) => {
    world(on, {}, undefined, { ...REVIEW_RUN, ...seen() })
    expect(await status($)).not.toContain("precheck")
    expect(await $.tool.call(advance)).toEqual(refused("D112: advance does not move the review stage"))
    expect(ran).toEqual([])
    await $.agent.spawn(spawn)
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:reviewer" })])
  })

  test("precheck, when there, is an array of command strings, and the approved view keeps it", () => {
    expect(checkConfig(JSON.stringify({ qa: ["t"], precheck: ["npm run typecheck"] }))).toBeUndefined()
    expect(checkConfig(JSON.stringify({ qa: ["t"], precheck: "npm run typecheck" }))).toContain("`precheck`")
    expect(checkConfig(JSON.stringify({ qa: ["t"], precheck: [""] }))).toContain("`precheck`")
    expect(viewOf(readConfig(JSON.stringify({ qa: ["t"], precheck: ["tsc"] })))).toEqual({ qa: ["t"], precheck: ["tsc"] })
    expect(viewOf(readConfig(JSON.stringify({ qa: ["t"] })))).toEqual({ qa: ["t"] })
  })
})
