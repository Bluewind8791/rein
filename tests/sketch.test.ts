import { describe, expect } from "claude-code/testing"
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

describe("the sketcher", () => {
  test("is spawned in spec only, for a 1-spec.md that exists", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    expect(await $.agent.spawn(spawn("as-is"))).toEqual(refused(`${SPEC} does not exist yet.`))
    expect(spawned).toEqual([])
    files[SPEC] = SPEC_TEXT
    await $.agent.spawn(spawn("draw"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:sketcher" })])
  })

  test("is refused past spec", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, () => undefined, { stage: "plan", runId: "login-fix" })
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused("rein:sketcher draws 1-mockup.html in the spec stage only; the run is in plan."))
  })

  test("draws first in the foreground on the hook's task, with the domain knowledge", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [`${REIN}/knowledge/web/screen-as-is.md`]: "---\ndescription: 현행 배치 읽기\n---\n" })
    await $.agent.spawn(spawn("as-is"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:sketcher", background: false })])
    const prompt = spawned[0]!.prompt ?? ""
    expect(prompt).toContain(`Draw ${HTML}. You did not see the conversation`)
    expect(prompt).toContain("the as-is above and the to-be below")
    expect(prompt).toContain("Each [?] of 1-spec.md is a yellow pin on the to-be")
    expect(prompt).not.toContain("the user said a lot")
    expect(prompt).toContain(`- ${REIN}/knowledge/web/screen-as-is.md: 현행 배치 읽기`)
    expect(record().sketcher).toBe(SKETCHER)
  })

  test("draws again for an answer as the main session spawned it, in the background", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT })
    await $.agent.spawn(spawn("draw"))
    await $.tool.call(as({ tool: "Write", file_path: HTML, content: "<html>first</html>" }))
    await $.agent.spawn(spawn("draw again"))
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:sketcher", background: true }))
    await $.agent.spawn({ ...(spawn("draw in End") as object), background: false } as never)
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:sketcher", background: false }))
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
