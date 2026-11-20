import { describe, expect } from "claude-code/testing"
import { sha256Text } from "../hooks/lib/hash.ts"
import { joinMockup } from "../hooks/lib/mockup.ts"
import { asIsWanted, screenRows } from "../hooks/stages/spec.ts"
import { relay, DIR, grade, REIN, SPEC_TEXT, spawned, store, world, test } from "./world.ts"

// 1-mockup.html in two parts: rein:as-is draws each screen of `## 화면` as
// it is now in agent/asis.html, from `## 화면` and the code; rein:sketcher
// draws the to-be in agent/tobe.html from 1-spec.md and the as-is, and the
// hook joins the two. The hook writes both tasks and tells the approval
// question when the picture is older than the spec.

const SPEC = `${DIR}/1-spec.md`
const HTML = `${DIR}/1-mockup.html`
const TOBE = `${DIR}/agent/tobe.html`
const ASIS = `${DIR}/agent/asis.html`
const SKETCHER = "agent-rein:sketcher"
const AS_IS = "agent-rein:as-is"
const ADVANCE = { tool: "mcp__rein__advance" } as never
const SCREENS = "\n## 화면\n\n| id | 이름 | URL | 진입 파일 | 종류 |\n|---|---|---|---|---|\n| order0101 | 주문 조회 | /order/list | web/order/list.jsp | 변경 |\n| member0102 | 회원 등급 | /member/grade | - | 새 화면, 따를 화면 member0101 |\n| member0103 | 회원 메모 | - | - | 새 화면 |\n"
const WITH_SCREENS = `${SPEC_TEXT}${SCREENS}`
const section = (id: string, body = "지금") => `<section class="screen" id="${id}">\n  <div class="before"><span class="tag">AS-IS (현행)</span><div class="canvas">${body}</div></div>\n</section>\n`
const AS_IS_HTML = `<style>/* web/css/order.css */ .canvas .grid { border: 1px solid #ccc; }</style>\n${section("order0101", "주문 표")}${section("member0101", "회원 표")}`
const TO_BE = `<!doctype html><html><head><style>.shell{}</style></head><body>
<section class="screen" id="order0101"><h2>주문 조회</h2><div class="compare"><!-- rein:as-is order0101 --><div class="compare-arrow">▼</div><div class="after">새 주문 표</div></div></section>
<section class="screen" id="member0102"><h2>회원 등급</h2><p class="muted">현행 없음 — 새 화면, member0101을 따름</p><div class="compare"><!-- rein:as-is member0101 --><div class="compare-arrow">▼</div><div class="after">등급 표</div></div></section>
<section class="screen" id="member0103"><h2>회원 메모</h2><p class="muted">현행 없음 — 새 화면</p><div class="after">메모</div></section>
</body></html>`
const spawn = (description: string, type = "rein:sketcher", prompt = "the user said a lot") => ({ tool_use_id: "s", prompt, description, subagentType: type, background: true }) as never
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const record = () => store.get("runs:proj/login-fix") as { sketcher?: string; asIs?: string; sketched?: { spec: string; html: string } }
const as = (e: Record<string, unknown>, agentId = SKETCHER) => ({ ...e, agentId }) as never

describe("the pieces", () => {
  test("`## 화면` gives the screens whose as-is is drawn: each 변경, and the screen each new one follows", () => {
    const rows = screenRows(WITH_SCREENS)
    expect(rows).toEqual([
      { id: "order0101", kind: "변경" },
      { id: "member0102", kind: "새 화면, 따를 화면 member0101", follows: "member0101" },
      { id: "member0103", kind: "새 화면" },
    ])
    expect(asIsWanted(rows)).toEqual(["order0101", "member0101"])
    expect(screenRows(SPEC_TEXT)).toEqual([])
  })

  test("the to-be and the as-is join: each marker becomes the as-is, its style before the to-be's", () => {
    const joined = joinMockup(TO_BE, AS_IS_HTML)
    if (!("html" in joined)) throw new Error(joined.problem)
    expect(joined.html).not.toContain("rein:as-is")
    expect(joined.html).toContain(`<div class="compare"><div class="before"><span class="tag">AS-IS (현행)</span><div class="canvas">주문 표</div></div><div class="compare-arrow">`)
    expect(joined.html).toContain(`<p class="muted">현행 없음 — 새 화면, member0101을 따름</p><div class="compare"><div class="before"><span class="tag">AS-IS (현행)</span><div class="canvas">회원 표</div></div>`)
    expect(joined.html).toContain("<head><style>/* web/css/order.css */ .canvas .grid { border: 1px solid #ccc; }</style>\n<style>.shell{}</style></head>")
    expect(joinMockup(TO_BE.replace("<!-- rein:as-is order0101 -->", ""), AS_IS_HTML)).toEqual({ problem: "the .compare of #order0101 has no `<!-- rein:as-is <id> -->` where the as-is goes" })
    expect(joinMockup(TO_BE, section("order0101"))).toEqual({ problem: "agent/asis.html has no as-is of #member0101, which agent/tobe.html places" })
    // a mockup with no screen to compare needs no as-is.
    expect(joinMockup('<section class="screen" id="flow"><div class="after">흐름</div></section>', "")).toEqual({ html: '<section class="screen" id="flow"><div class="after">흐름</div></section>' })
  })
})

describe("rein:as-is", () => {
  test("is spawned in spec only, once 1-spec.md lists a screen with an as-is in `## 화면`", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    expect(await $.agent.spawn(spawn("as-is", "rein:as-is"))).toEqual(refused(`${SPEC} does not exist yet. Write it with its \`## 화면\``))
    files[SPEC] = SPEC_TEXT
    expect(await $.agent.spawn(spawn("as-is", "rein:as-is"))).toEqual(refused("`## 화면` of 1-spec.md lists no screen with an as-is"))
    expect(spawned).toEqual([])
  })

  test("is refused past spec", async ($, on) => {
    world(on, { [SPEC]: WITH_SCREENS }, () => undefined, { stage: "plan", runId: "login-fix" })
    expect(await $.agent.spawn(spawn("as-is", "rein:as-is"))).toEqual(refused("rein:as-is draws the as-is of 1-mockup.html in the spec stage only; the run is in plan."))
  })

  test("draws in the foreground the screens agent/asis.html lacks, from `## 화면` alone and the domain knowledge", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: WITH_SCREENS, [`${REIN}/knowledge/web/screen-as-is.md`]: "---\ndescription: 현행 배치 읽기\n---\n" }
    world(on, files)
    await $.agent.spawn(spawn("as-is", "rein:as-is"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:as-is", background: false })])
    const prompt = spawned[0]!.prompt ?? ""
    expect(prompt).toContain(`into ${ASIS}. You see neither 1-spec.md nor the conversation`)
    expect(prompt).toContain("Draw the as-is of #order0101, #member0101: each screen as the code shows it now, whole.")
    expect(prompt).toContain("| member0102 | 회원 등급 | /member/grade | - | 새 화면, 따를 화면 member0101 |")
    // nothing of 1-spec.md but `## 화면`.
    expect(prompt).not.toContain("로그인에 세 번 실패하면 잠긴다")
    expect(prompt).not.toContain("the user said a lot")
    expect(prompt).toContain("Look in it first for the screen's files and for how to read its current layout.")
    expect(prompt).toContain(`- ${REIN}/knowledge/web/screen-as-is.md: 현행 배치 읽기`)
    expect(record().asIs).toBe(AS_IS)
    // a screen added later: only it is drawn, the rest kept.
    files[ASIS] = section("order0101")
    await $.agent.spawn(spawn("as-is", "rein:as-is"))
    const again = spawned.at(-1)!.prompt ?? ""
    expect(again).toContain("Draw the as-is of #member0101:")
    expect(again).toContain(`${ASIS} has the as-is of #order0101 already. Keep every section you are not asked to draw as it is`)
  })

  test("with every screen drawn, draws again the screen the main session names, with its words", async ($, on) => {
    world(on, { [SPEC]: WITH_SCREENS, [ASIS]: AS_IS_HTML })
    await $.agent.spawn(spawn("as-is", "rein:as-is", "사용자: order0101 현행에 엑셀 버튼이 빠졌다"))
    const prompt = spawned.at(-1)!.prompt ?? ""
    expect(prompt).toContain("The user says the as-is of a screen differs from the real one.")
    expect(prompt).toContain("> 사용자: order0101 현행에 엑셀 버튼이 빠졌다")
    expect(prompt).toContain("Draw again the screens they name, and only those")
  })

  test("reads the code and writes agent/asis.html, nothing else; a new as-is makes 1-mockup.html again and keeps it the sketcher's drawing", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: WITH_SCREENS, "E:/proj/web/order/list.jsp": "x" }
    world(on, files)
    await $.agent.spawn(spawn("as-is", "rein:as-is"))
    expect(await $.tool.call(as({ tool: "Grep", pattern: "x", path: "E:/proj" }, AS_IS))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(as({ tool: "Bash", command: "ls" }, AS_IS))).toEqual(refused("rein:as-is reads with Read, Grep and Glob and writes agent/asis.html with Write or Edit; Bash is refused."))
    expect(await $.tool.call(as({ tool: "Write", file_path: SPEC, content: "x" }, AS_IS))).toEqual(refused(`rein:as-is writes ${ASIS} and nothing else.`))
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "x" }, AS_IS))).toEqual(refused(`rein:as-is writes ${ASIS} and nothing else.`))
    expect(await $.tool.call(as({ tool: "Write", file_path: ASIS, content: AS_IS_HTML }, AS_IS))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(files[HTML]).toBeUndefined()
    await $.agent.spawn(spawn("draw"))
    await $.tool.call(as({ tool: "Write", file_path: TOBE, content: TO_BE }))
    const first = record().sketched
    expect(files[HTML]).toContain("주문 표")
    // the user says the as-is differs: drawn again, joined again.
    await $.agent.spawn(spawn("as-is", "rein:as-is", "order0101 다름"))
    expect(await $.tool.call(as({ tool: "Edit", file_path: ASIS, old_string: "주문 표", new_string: "주문 표와 엑셀 버튼" }, `${AS_IS}-2`))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(files[HTML]).toContain("주문 표와 엑셀 버튼")
    expect(record().sketched).toEqual({ spec: first!.spec, html: await sha256Text(files[HTML]!) })
    expect(record().sketched!.html).not.toBe(first!.html)
    // an as-is that drops a screen the to-be places leaves 1-mockup.html as it was.
    const r = await $.tool.call(as({ tool: "Write", file_path: ASIS, content: section("order0101") }, `${AS_IS}-2`))
    expect(context(r)).toContain("1-mockup.html was not made again with it: agent/asis.html has no as-is of #member0101")
    expect(files[HTML]).toContain("주문 표와 엑셀 버튼")
  })
})

describe("the sketcher", () => {
  test("is spawned in spec only, for a 1-spec.md that exists, once each screen of `## 화면` has its as-is", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files)
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused(`${SPEC} does not exist yet.`))
    files[SPEC] = WITH_SCREENS
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused(`${ASIS} has no as-is of #order0101, #member0101, which \`## 화면\` of 1-spec.md lists. Spawn rein:as-is first`))
    files[ASIS] = section("order0101")
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused("has no as-is of #member0101,"))
    expect(spawned).toEqual([])
    files[ASIS] = AS_IS_HTML
    await $.agent.spawn(spawn("draw"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:sketcher" })])
  })

  test("is refused past spec", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, () => undefined, { stage: "plan", runId: "login-fix" })
    expect(await $.agent.spawn(spawn("to-be"))).toEqual(refused("rein:sketcher draws 1-mockup.html in the spec stage only; the run is in plan."))
  })

  test("draws first in the foreground on the hook's task: the to-be, on the as-is, no code", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT, [`${REIN}/knowledge/web/screen-as-is.md`]: "---\ndescription: 현행 배치 읽기\n---\n" })
    await $.agent.spawn(spawn("to-be"))
    expect(spawned).toEqual([expect.objectContaining({ type: "rein:sketcher", background: false })])
    const prompt = spawned[0]!.prompt ?? ""
    expect(prompt).toContain(`Draw the to-be of ${HTML}. You did not see the conversation`)
    expect(prompt).toContain("You read no code.")
    expect(prompt).toContain("with `<!-- rein:as-is <id> -->` where its as-is goes")
    expect(prompt).toContain("Each [?] of 1-spec.md is a yellow pin on the to-be")
    expect(prompt).toContain("name it on the `spec에 없음:` line of your answer; never make it up.")
    expect(prompt).toContain(`Write ${TOBE}, whole, with Write`)
    expect(prompt).not.toContain("the user said a lot")
    expect(prompt).not.toContain("screen-as-is.md")
    expect(record().sketcher).toBe(SKETCHER)
  })

  test("draws again for an answer as the main session spawned it, in the background", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT })
    await $.agent.spawn(spawn("draw"))
    await $.tool.call(as({ tool: "Write", file_path: TOBE, content: "<html>first</html>" }))
    await $.agent.spawn(spawn("draw again"))
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:sketcher", background: true }))
    await $.agent.spawn({ ...(spawn("draw in End") as object), background: false } as never)
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:sketcher", background: false }))
  })

  test("reads with Read and writes agent/tobe.html, nothing else; the hook makes 1-mockup.html; the last one spawned writes", async ($, on) => {
    const files: Record<string, string> = { [SPEC]: WITH_SCREENS, [ASIS]: AS_IS_HTML, "E:/proj/src/a.jsp": "x" }
    world(on, files)
    await $.agent.spawn(spawn("to-be"))
    expect(await $.tool.call(as({ tool: "Read", file_path: ASIS }))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(as({ tool: "Grep", pattern: "x", path: "E:/proj" }))).toEqual(refused("the sketcher reads with Read and writes agent/tobe.html with Write; Grep is refused."))
    expect(await $.tool.call(as({ tool: "Glob", pattern: "**/*.jsp" }))).toEqual(refused("Glob is refused."))
    expect(await $.tool.call(as({ tool: "Bash", command: "ls" }))).toEqual(refused("Bash is refused."))
    expect(await $.tool.call(as({ tool: "Edit", file_path: TOBE, old_string: "a", new_string: "b" }))).toEqual(refused("Edit is refused."))
    expect(await $.tool.call(as({ tool: "Write", file_path: SPEC, content: "x" }))).toEqual(refused(`the sketcher writes ${TOBE} and nothing else; the hook makes 1-mockup.html from it.`))
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "x" }))).toEqual(refused(`the sketcher writes ${TOBE} and nothing else`))
    expect(await $.tool.call(as({ tool: "Write", file_path: ASIS, content: "x" }))).toEqual(refused(`the sketcher writes ${TOBE} and nothing else`))
    // a to-be with a screen the as-is lacks is not joined; the sketcher is told.
    const bad = await $.tool.call(as({ tool: "Write", file_path: TOBE, content: TO_BE.replace("rein:as-is member0101", "rein:as-is member9999") }))
    expect(context(bad)).toContain(`1-mockup.html was not made from it: agent/asis.html has no as-is of #member9999, which agent/tobe.html places. Write ${TOBE} again, whole.`)
    expect(files[HTML]).toBeUndefined()
    expect(record().sketched).toBeUndefined()
    expect(await $.tool.call(as({ tool: "Write", file_path: TOBE, content: TO_BE }))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(files[HTML]).toContain('<div class="before"><span class="tag">AS-IS (현행)</span><div class="canvas">회원 표</div></div>')
    expect(record().sketched).toBeDefined()
    expect(await $.tool.call(as({ tool: "SubagentHandback", report: "drawn" }))).toEqual(expect.objectContaining({ result: "ok" }))
    // A second sketcher takes over; the first one writes nothing.
    await $.agent.spawn(spawn("to-be"))
    expect(record().sketcher).toBe(`${SKETCHER}-2`)
    expect(await $.tool.call(as({ tool: "Write", file_path: TOBE, content: "x" }))).toEqual(refused("its part in the run is over"))
    expect(await $.tool.call(as({ tool: "Write", file_path: TOBE, content: TO_BE.replace("등급 표", "등급 표 2") }, `${SKETCHER}-2`))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(files[HTML]).toContain("등급 표 2")
  })
})

describe("1-mockup.html in the approval question", () => {
  test("is named as it is while it is the sketcher's drawing of 1-spec.md as it is", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined))
    await $.agent.spawn(spawn("to-be"))
    await $.tool.call(as({ tool: "Write", file_path: TOBE, content: "<html>to-be</html>" }))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`시각 자료: ${HTML}`)
    expect(questions[0]).not.toContain("오래됐습니다")
  })

  test("is named as older once 1-spec.md or 1-mockup.html changed since the sketcher drew it", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined))
    await $.agent.spawn(spawn("to-be"))
    await $.tool.call(as({ tool: "Write", file_path: TOBE, content: "<html>first</html>" }))
    files[SPEC] = `${SPEC_TEXT}답 하나\n`
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`시각 자료: ${HTML} — 주의: 1-mockup.html이 1-spec.md보다 오래됐습니다. 지금의 1-spec.md를 rein:sketcher가 그린 것이 아닙니다.`)
    // Drawn again from 1-spec.md as it is, then changed by hand.
    await $.agent.spawn(spawn("to-be"))
    await $.tool.call(as({ tool: "Write", file_path: TOBE, content: "<html>to-be</html>" }, `${SKETCHER}-2`))
    await relay($, ADVANCE)
    expect(questions[1]).not.toContain("오래됐습니다")
    files[HTML] = "<html>by hand</html>"
    await relay($, ADVANCE)
    expect(questions[2]).toContain("오래됐습니다")
  })
})
