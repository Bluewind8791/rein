import { describe, expect } from "claude-code/testing"
import { sketchMode } from "../hooks/stages/spec.ts"
import { relay, DIR, grade, REIN, SPEC_TEXT, spawned, store, world, test } from "./world.ts"

// a sketcher that sees only 1-spec.md and the code draws 1-mockup.html; the
// hook writes its task and tells the approval question when the picture is
// older than the spec.

const SPEC = `${DIR}/1-spec.md`
const HTML = `${DIR}/1-mockup.html`
const SKETCHER = "agent-rein:sketcher"
const ADVANCE = { tool: "mcp__rein__advance" } as never
const spawn = (description: string) => ({ tool_use_id: "s", prompt: "the user said a lot", description, subagentType: "rein:sketcher", background: true }) as never
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const record = () => store.get("runs:proj/login-fix") as { sketcher?: string; sketched?: { spec: string; html: string } }
const as = (e: Record<string, unknown>, agentId = SKETCHER) => ({ ...e, agentId }) as never

describe("the sketcher's mode", () => {
  test("is as-is or to-be in the description, exactly one of them", () => {
    expect(sketchMode("as-is")).toBe("as-is")
    expect(sketchMode("draw the to-be")).toBe("to-be")
    expect(sketchMode("AS-IS 그림")).toBe("as-is")
    expect(sketchMode("draw it")).toBeUndefined()
    expect(sketchMode("as-is then to-be")).toBeUndefined()
    expect(sketchMode("was-isolated")).toBeUndefined()
  })
})

describe("the sketcher", () => {
  test("is spawned in spec only, with a mode, for a 1-spec.md that exists", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    expect(await $.agent.spawn(spawn("as-is"))).toEqual(refused(`${SPEC} does not exist yet.`))
    files[SPEC] = SPEC_TEXT
    expect(await $.agent.spawn(spawn("draw"))).toEqual(refused("name the mode in the Agent call's description, as-is (before the questions) or to-be"))
    expect(spawned).toEqual([])
  })

  test("is refused past spec", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, () => undefined, { stage: "plan", runId: "login-fix" })
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused("rein:sketcher draws 1-mockup.html in the spec stage only; the run is in plan."))
  })

  test("runs in the foreground on the hook's task, with the domain knowledge", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [`${REIN}/knowledge/web/screen-as-is.md`]: "---\ndescription: 현행 배치 읽기\n---\n" })
    await $.agent.spawn(spawn("as-is"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:sketcher", background: false })])
    const prompt = spawned[0]!.prompt ?? ""
    expect(prompt).toContain(`Draw ${HTML}, mode as-is.`)
    expect(prompt).toContain("You did not see the conversation")
    expect(prompt).not.toContain("the user said a lot")
    expect(prompt).toContain(`- ${REIN}/knowledge/web/screen-as-is.md: 현행 배치 읽기`)
    expect(record().sketcher).toBe(SKETCHER)
  })

  test("reads anything and writes 1-mockup.html, nothing else; the last one spawned writes", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, "E:/proj/src/a.jsp": "x" })
    await $.agent.spawn(spawn("as-is"))
    expect(await $.tool.call(as({ tool: "Read", file_path: "E:/proj/src/a.jsp" }))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(as({ tool: "Grep", pattern: "x", path: "E:/proj" }))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(as({ tool: "Bash", command: "ls" }))).toEqual(refused("the sketcher reads with Read, Grep and Glob and writes 1-mockup.html with Write; Bash is refused."))
    expect(await $.tool.call(as({ tool: "Edit", file_path: HTML, old_string: "a", new_string: "b" }))).toEqual(refused("Edit is refused."))
    expect(await $.tool.call(as({ tool: "Write", file_path: SPEC, content: "x" }))).toEqual(refused(`the sketcher writes ${HTML} and nothing else.`))
    expect(await $.tool.call(as({ tool: "Write", file_path: `${DIR}/agent/grade.md`, content: "x" }))).toEqual(refused(`the sketcher writes ${HTML} and nothing else.`))
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>as-is</html>" }))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(record().sketched).toBeDefined()
    expect(await $.tool.call(as({ tool: "SubagentHandback", report: "drawn" }))).toEqual(expect.objectContaining({ result: "ok" }))
    // A second sketcher takes over; the first one writes nothing.
    await $.agent.spawn(spawn("to-be"))
    expect(record().sketcher).toBe(`${SKETCHER}-2`)
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "x" }))).toEqual(refused("its part in the run is over"))
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>to-be</html>" }, `${SKETCHER}-2`))).toEqual(expect.objectContaining({ result: "ok" }))
  })
})

describe("1-mockup.html in the approval question", () => {
  test("is named as it is while it is the sketcher's drawing of 1-spec.md as it is", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined))
    await $.agent.spawn(spawn("to-be"))
    await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>to-be</html>" }))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`시각 자료: ${HTML}`)
    expect(questions[0]).not.toContain("오래됐습니다")
  })

  test("is named as older once 1-spec.md or 1-mockup.html changed since the sketcher drew it", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined))
    await $.agent.spawn(spawn("as-is"))
    await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>as-is</html>" }))
    files[SPEC] = `${SPEC_TEXT}답 하나\n`
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`시각 자료: ${HTML} — 주의: 1-mockup.html이 1-spec.md보다 오래됐습니다. 지금의 1-spec.md를 rein:sketcher가 그린 것이 아닙니다.`)
    // Drawn again from 1-spec.md as it is, then changed by hand.
    await $.agent.spawn(spawn("to-be"))
    await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>to-be</html>" }, `${SKETCHER}-2`))
    await relay($, ADVANCE)
    expect(questions[1]).not.toContain("오래됐습니다")
    files[HTML] = "<html>by hand</html>"
    await relay($, ADVANCE)
    expect(questions[2]).toContain("오래됐습니다")
  })
})
