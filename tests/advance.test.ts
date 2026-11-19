import { describe, expect } from "claude-code/testing"
import { relay, DIR, grade, SPEC_TEXT, world, test } from "./world.ts"

// The spec approval with the person played by a tool.call hook beneath the plugin
// (world.ts): $.ui.ask is a tool.call of AskUserQuestion, so the hook answers it.

const SPEC = `${DIR}/1-spec.md`

describe("advance", () => {
  test("approval moves spec to plan", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => "승인")
    await grade($)
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    // The store moved: a second advance finds the run in plan.
    const again = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(again).toEqual({ deny: `D112: ${DIR}/2-plan.md does not exist. Write it before asking for approval.` })
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"stage","from":"spec","to":"plan"`)
  })

  // the main session writes 2-plan.md in spec too; no write of it is judged,
  // only advance in plan judges it.
  test("a 2-plan.md written in spec is not judged; advance in plan judges it", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, () => "승인")
    await grade($)
    const write = { tool: "Write", file_path: `${DIR}/2-plan.md`, content: "x" } as never
    const before = (await $.tool.call(write)) as { result?: string; context?: string[] }
    expect(before.result).toBe("ok")
    expect(before.context ?? []).toEqual([])
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(((await $.tool.call(write)) as { context?: string[] }).context ?? []).toEqual([])
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual({ deny: expect.stringContaining("2-plan.md does not pass yet, so the run stays in plan") })
  })

  // 1-mockup.html is the spec's visuals; the question names it when it is
  // there, as older than 1-spec.md when rein:sketcher did not draw it.
  test("1-mockup.html the main session writes is named in the approval question, as older", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined))
    await grade($)
    expect(await $.tool.call({ tool: "Write", file_path: `${DIR}/1-mockup.html`, content: "<html></html>" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call({ tool: "Write", file_path: `${DIR}/other.html`, content: "x" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(questions[0]).toContain(`(${SPEC}) 시각 자료: ${DIR}/1-mockup.html — 주의: 1-mockup.html이 1-spec.md보다 오래됐습니다.`)
  })

  test("without 1-mockup.html the approval question names 1-spec.md only", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), undefined))
    await grade($)
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(questions[0]).toContain(`(${SPEC})`)
    expect(questions[0]).not.toContain("시각 자료")
  })

  // the run waits for /rein:plan while 1-spec.md is as advance found it.
  test("a spec waiting for the user shows in status until 1-spec.md changes", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => undefined)
    await grade($)
    const status = async () => ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result
    expect(await status()).not.toContain("waits for the user")
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(await status()).toContain("waits for the user: they type /rein:plan")
    files[SPEC] = `${SPEC_TEXT}\n고침\n`
    expect(await status()).not.toContain("waits for the user")
  })

  test("an answer that is no label changes nothing and names the labels; the user's words go in said", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => "완료 판정을 더 구체적으로")
    await grade($)
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual({ deny: expect.stringContaining(`D112: answer takes one of "승인", and "완료 판정을 더 구체적으로" is none of them, so nothing changed.`) })
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"ev":"stage"`)
    const approved = await $.tool.call({ tool: "mcp__rein__advance", answer: "승인", said: "해당 스크린샷 근거 승인" } as never)
    expect(approved).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"said":"해당 스크린샷 근거 승인"`)
  })

  // the hook asks no one; without the user's answer the run stops for them.
  test("advance without the user's answer keeps the run in spec and says it waits for /rein:plan", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, () => undefined)
    await grade($)
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual({ result: expect.stringContaining(`D112: this waits for the user; nothing changed. Tell them what the hook knows below, giving the paths, then stop. They read it and type /rein:plan to approve it (that skill passes "승인" as answer to mcp__rein__advance), or tell you what to change: revise 1-spec.md as they said, have rein:grader grade it again, and call advance again without answer.`) })
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"ev":"stage"`)
  })

  // an autopilot run: the main session passes the approval itself, said "autopilot".
  test("in an autopilot run advance tells the main session to approve 1-spec.md itself, and asks no one", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), { stage: "spec", runId: "login-fix", autopilot: true })
    await grade($)
    expect(((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result).toContain("autopilot: on")
    const r = (await relay($, { tool: "mcp__rein__advance" } as never)) as { result?: string }
    expect(r.result).toContain(`D112: autopilot run: the user is not asked here; nothing changed yet. Tell them in one line what passed, giving the paths below, then call mcp__rein__advance again now with answer "승인" and said "autopilot".`)
    expect(r.result).toContain(`autopilot이 1-spec.md를 승인하고 plan 단계로 넘어갑니다. (${SPEC})`)
    expect(questions).toHaveLength(0)
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"ev":"stage"`)
    const approved = await $.tool.call({ tool: "mcp__rein__advance", answer: "승인", said: "autopilot" } as never)
    expect(approved).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"said":"autopilot"`)
  })

  test("no question while 1-spec.md lacks its completion line, its reference or its impact section (D36, D96, D155)", async ($, on) => {
    let asked = false
    const files: Record<string, string> = { [SPEC]: "---\n참조: \"\"\n---\n\n# spec\n\n## 완료 판정\n" }
    world(on, files, () => ((asked = true), "승인"))
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual({ deny: expect.stringContaining("D112: 1-spec.md is missing a line under `## 완료 판정` (D36), a `참조:` line in the front matter with the issue or ticket number, or 없음 (D96, D215) and a `## 영향 범위` section with a `- <path> — <what relies on the code to change>` line per affected path, or 없음 (D155).") })
    expect(asked).toBe(false)
    files[SPEC] = "---\n참조: \"#42\"\n---\n\n# spec\n\n## 완료 판정\n\n잠긴다\n\n## 영향 범위\n\n그대로\n"
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual({ deny: expect.stringContaining("1-spec.md is missing a `## 영향 범위` section") })
    files[SPEC] = "---\n유형: feature\n참조: \"#42\"\n---\n\n# spec\n\n## 완료 판정\n\n잠긴다\n\n## 영향 범위\n\n- `src/api.ts:12` — 로그인 응답 형태에 기댐\n"
    await grade($)
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the plan stage." }))
  })

  test("no question without 1-spec.md", async ($, on) => {
    let asked = false
    world(on, {}, () => {
      asked = true
      return "승인"
    })
    const r = await relay($, { tool: "mcp__rein__advance" } as never)
    expect(r).toEqual({ deny: expect.stringContaining("does not exist") })
    expect(asked).toBe(false)
  })
})
