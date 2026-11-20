import { describe, expect } from "claude-code/testing"
import { importLine } from "../hooks/lib/egoHarness.ts"
import { MARK, PROBE_SCRIPT, SHOT_PROBE_SCRIPT } from "../hooks/lib/ego.ts"
import { layoutCheck, parseLayoutVerdict, tickLayout, toBeSources } from "../hooks/lib/layout.ts"
import { devTask } from "../hooks/stages/dev.ts"
import type { Run } from "../hooks/lib/state.ts"
import { DIR, gitSub, grade, ran, relay, SPEC_TEXT, spawned, store, world, type Host, test } from "./world.ts"

// spec's layout check: a to-be drawn from a planning-document
// picture is rendered with a headless Chrome, rein:layout-verifier compares it
// with the picture, and a drawing that differs goes back to the sketcher.

const SPEC = `${DIR}/1-spec.md`
const HTML = `${DIR}/1-mockup.html`
const VERDICT = `${DIR}/agent/layout-verify.md`
const SHOTS = `${DIR}/agent/layout/mockup`
const ADVANCE = { tool: "mcp__rein__advance" } as never
const TO_BE = (source = "<!-- to-be source: brief/기획서.pdf (3쪽) -->") =>
  `<section class="screen" id="dash0101"><h2>대시보드</h2><div class="compare"><div class="before">지금</div><div class="after">${source}<div class="changed">도넛</div></div></div></section>\n<section class="screen" id="flow"><div class="after">흐름</div></section>`
const record = () => store.get("runs:proj/login-fix") as Run
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const spawnAs = async ($: { agent: { spawn: (e: never) => Promise<unknown> } }, type: string, description = "go") =>
  ((await $.agent.spawn({ tool_use_id: "s", prompt: "the user said a lot", description, subagentType: type } as never)) as { agentId?: string; deny?: string })
type Engine = { agent: { spawn: (e: never) => Promise<unknown> }; tool: { call: (e: never) => Promise<unknown> } }
// a sketcher spawned with to-be writes the drawing; what its Write returned.
const sketch = async ($: Engine, html = TO_BE()) => {
  const { agentId } = await spawnAs($, "rein:sketcher", "to-be")
  return $.tool.call({ tool: "Write", file_path: HTML, content: html, agentId } as never)
}
// a verifier spawned on the hook's ask writes its verdict; what its Write returned.
const verify = async ($: Engine, body: string) => {
  const { agentId } = await spawnAs($, "rein:layout-verifier")
  return $.tool.call({ tool: "Write", file_path: VERDICT, content: body, agentId } as never)
}
const DIFFER = "## #dash0101\n판정: 다름\n- 도넛 차트: 그림은 오른쪽 위, 목업은 왼쪽 아래\n"
const MATCH = "## #dash0101\n판정: 맞음\n"
// the renderer as the hook runs it: every id it is given rendered.
const renders: Host = {
  run: argv => {
    if (!argv[1]?.endsWith("hooks/render-mockup.js")) return { exitCode: 0 }
    const [, , , out, ...ids] = argv
    return { exitCode: 0, stdout: JSON.stringify({ shots: ids.map(id => ({ id, png: `${out}/${id}.png`, boxes: `${out}/${id}.boxes.txt` })), missing: [] }) + "\n" }
  },
}

describe("the layout check's pieces", () => {
  test("toBeSources reads the picture a to-be screen names, to-be screens only", () => {
    expect(toBeSources(TO_BE())).toEqual({ dash0101: "brief/기획서.pdf (3쪽)" })
    expect(toBeSources(TO_BE(""))).toEqual({})
    expect(toBeSources('<section class="screen" id="a"><div class="before"><!-- to-be source: x.png --></div></section>')).toEqual({})
  })

  test("parseLayoutVerdict takes one verdict per screen, and a 다름 says what differs", () => {
    expect(parseLayoutVerdict(DIFFER, ["dash0101"])).toEqual({ verdicts: [{ id: "dash0101", match: false, diffs: ["도넛 차트: 그림은 오른쪽 위, 목업은 왼쪽 아래"] }] })
    expect(parseLayoutVerdict("## dash0101\n판정: 맞음\n", ["dash0101"])).toEqual({ verdicts: [{ id: "dash0101", match: true, diffs: [] }] })
    expect(parseLayoutVerdict(MATCH, ["dash0101", "b"])).toEqual({ problem: "it has no `## #<id>` section for #b" })
    expect(parseLayoutVerdict("## #dash0101\n판정: 다름\n", ["dash0101"])).toEqual({ problem: "#dash0101 is 다름 with no `- ` line saying what differs" })
    expect(parseLayoutVerdict("## #dash0101\n판정: 비슷\n", ["dash0101"])).toEqual({ problem: "#dash0101 needs exactly one line `판정: 맞음` or `판정: 다름`" })
  })

  test("the worker is given each to-be screen of `## 배치 대조`, with its rendered picture", () => {
    const run = { v: 2, stage: "dev", runId: "login-fix", rules: [], retries: 0, planFiles: ["E:/proj/a.jsp"], layouts: [{ anchor: "dash0101", page: "대시보드", route: "홈 > 대시보드", look: "도넛 두 개" }] } as unknown as Run
    const task = devTask(run, DIR, "E:/proj", { dash0101: "agent/layout/mockup/dash0101.png" })
    expect(task).toContain("Screens to build as drawn.")
    expect(task).toContain(`- #dash0101 (대시보드): ${HTML}#dash0101, rendered as ${DIR}/agent/layout/mockup/dash0101.png; compare: 도넛 두 개`)
    expect(devTask({ ...run, layouts: undefined }, DIR, "E:/proj")).not.toContain("Screens to build")
  })
})

describe("spec's layout check", () => {
  test("a to-be drawn from a picture is rendered and the main session is told to have it compared", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, undefined, undefined, renders)
    const r = await sketch($)
    expect(ran.find(c => c.argv[1]?.endsWith("hooks/render-mockup.js"))?.argv.slice(2)).toEqual([HTML, SHOTS, "dash0101"])
    expect(context(r)).toContain("The to-be of #dash0101 is drawn from a planning-document picture. Spawn rein:layout-verifier")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "pending", fails: 0, sources: { dash0101: "brief/기획서.pdf (3쪽)" }, shots: { dash0101: "agent/layout/mockup/dash0101.png" } }))
  })

  test("a drawing that names no picture is not checked", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, undefined, undefined, renders)
    const r = await sketch($, TO_BE(""))
    expect(context(r)).not.toContain("layout-verifier")
    expect(record().sketchCheck).toBeUndefined()
  })

  test("the verifier is spawned only when asked, on the hook's task, reads and writes its verdict alone", async ($, on) => {
    world(on, { [SPEC]: SPEC_TEXT }, undefined, undefined, renders)
    expect(await spawnAs($, "rein:layout-verifier")).toEqual(refused("only when the hook asks for it in spec"))
    await sketch($)
    const { agentId } = await spawnAs($, "rein:layout-verifier")
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain(`- #dash0101: mockup ${DIR}/agent/layout/mockup/dash0101.png; document ${DIR}/brief/기획서.pdf (3쪽)`)
    expect(task).toContain("`## 기획서 대조` section")
    // the mockup's other to-be screen comes along: it may draw part of the picture.
    expect(task).toContain(`All its to-be screens: #dash0101 ${DIR}/agent/layout/mockup/dash0101.png, #flow ${DIR}/agent/layout/mockup/flow.png.`)
    expect(task).toContain("compare each screen only with the part of the picture it covers")
    // a region left as words is missing; only another screen's drawing excuses it.
    expect(task).toContain("draws as a screen of its own (a popup, a tab's body) is not missing")
    expect(task).toContain("a region left as words instead of drawn (such as `(생략, 변경 없음)`) is missing.")
    expect(task).not.toContain("the user said a lot")
    expect(record().sketchCheck?.agent).toBe(agentId)
    const as = (e: object) => ({ ...e, agentId }) as never
    expect(await $.tool.call(as({ tool: "Bash", command: "ls" }))).toEqual(refused("the layout verifier reads the pictures with Read and writes its verdict with Write; Bash is refused."))
    expect(await $.tool.call(as({ tool: "Write", file_path: HTML, content: "x" }))).toEqual(refused(`the layout verifier writes ${VERDICT} and nothing else.`))
    expect(context(await $.tool.call(as({ tool: "Write", file_path: VERDICT, content: "## #dash0101\n판정: 다름\n" })))).toContain("was not taken: #dash0101 is 다름 with no `- ` line")
    expect(context(await $.tool.call(as({ tool: "Write", file_path: VERDICT, content: MATCH })))).toContain("Every to-be drawn from a planning-document picture matches its picture.")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "match", fails: 0 }))
    expect(await $.tool.call(as({ tool: "SubagentHandback", report: "compared" }))).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("a drawing that differs goes back to the sketcher with what differs, measured from the third, and stops at the fifth", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), undefined), undefined, renders)
    await sketch($)
    expect(context(await verify($, DIFFER))).toContain("The to-be differs from the planning-document picture (#dash0101: 도넛 차트: 그림은 오른쪽 위, 목업은 왼쪽 아래). Spawn rein:sketcher again, in the foreground")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "differ", fails: 1 }))
    await sketch($)
    const second = spawned.filter(s => s.type === "rein:sketcher").at(-1)!.prompt ?? ""
    expect(second).toContain(`Your last to-be differs from the planning document's picture: ${VERDICT} says where`)
    expect(second).not.toContain("boxes.txt")
    await verify($, DIFFER)
    await sketch($)
    await verify($, DIFFER)
    await sketch($)
    const fourth = spawned.filter(s => s.type === "rein:sketcher").at(-1)!.prompt ?? ""
    expect(fourth).toContain(`It came out different 3 times in a row. Before you draw, read the measurement of your last to-be (each element, its position and size in pixels): ${SHOTS}/dash0101.boxes.txt.`)
    await verify($, DIFFER)
    await sketch($)
    expect(context(await verify($, DIFFER))).toContain("5 drawings in a row differ from the planning-document picture")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "given-up", fails: 5 }))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain(`주의: 기획서 그림과 배치가 5번 연달아 달라 다시 그리기를 멈췄습니다. 다른 곳: ${VERDICT}`)
  })

  test("a drawing that got no closer stops the redrawing, as the verifier judges from the last differences", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), undefined), undefined, renders)
    await sketch($)
    const first = await spawnAs($, "rein:layout-verifier")
    expect(spawned.at(-1)!.prompt ?? "").not.toContain("진전")
    await $.tool.call({ tool: "Write", file_path: VERDICT, content: DIFFER, agentId: first.agentId } as never)
    const redraw = await sketch($)
    expect(spawned.filter(s => s.type === "rein:sketcher").at(-1)).toEqual(expect.objectContaining({ background: false }))
    expect(context(redraw)).toContain("Spawn rein:layout-verifier")
    await spawnAs($, "rein:layout-verifier")
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain("This drawing was made to fix the differences found in the one before:\n- #dash0101: 도넛 차트: 그림은 오른쪽 위, 목업은 왼쪽 아래")
    expect(task).toContain("진전: 있음 | 없음")
    const agentId = record().sketchCheck?.agent
    const r = await $.tool.call({ tool: "Write", file_path: VERDICT, content: `${DIFFER}진전: 없음\n`, agentId } as never)
    expect(context(r)).toContain("The last drawing got no closer to the planning-document picture (#dash0101: 도넛 차트: 그림은 오른쪽 위, 목업은 왼쪽 아래). The hook stops redrawing")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "given-up", fails: 2 }))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("주의: 기획서 그림과 배치가 2번 연달아 달라 다시 그리기를 멈췄습니다.")
  })

  test("a drawing redone for an answer is not compared until advance, which compares it before the user is asked", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [SPEC]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), undefined), undefined, renders)
    await sketch($)
    await verify($, MATCH)
    const renders0 = ran.filter(c => c.argv[1]?.endsWith("hooks/render-mockup.js")).length
    files[SPEC] = `${SPEC_TEXT}답 하나\n`
    const again = await sketch($, `${TO_BE()}<!-- 답 반영 -->`)
    expect(context(again)).not.toContain("layout-verifier")
    expect(ran.filter(c => c.argv[1]?.endsWith("hooks/render-mockup.js")).length).toBe(renders0)
    await grade($)
    expect(await relay($, ADVANCE)).toEqual(refused("The to-be of #dash0101 is drawn from a planning-document picture. Spawn rein:layout-verifier"))
    expect(questions).toEqual([])
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "pending", fails: 0 }))
    expect(await relay($, ADVANCE)).toEqual(refused("The to-be is being compared with its planning-document picture."))
    await verify($, MATCH)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("기획서 그림과 배치 비교: 맞음.")
  })

  test("a match after a difference starts the count again, and approval says it matches", async ($, on) => {
    const questions: string[] = []
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), undefined), undefined, renders)
    await sketch($)
    await verify($, DIFFER)
    await sketch($)
    await verify($, MATCH)
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "match", fails: 0 }))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("기획서 그림과 배치 비교: 맞음.")
  })

  test("without a browser the check is skipped, and the user is told", async ($, on) => {
    const questions: string[] = []
    const none: Host = { run: argv => (argv[1]?.endsWith("hooks/render-mockup.js") ? { exitCode: 2, stdout: JSON.stringify({ error: "no Chrome or Edge found" }) + "\n" } : { exitCode: 0 }) }
    world(on, { [SPEC]: SPEC_TEXT }, q => (questions.push(q), undefined), undefined, none)
    const r = await sketch($)
    expect(context(r)).toContain("the hook could not render it to compare (no Chrome or Edge found)")
    expect(record().sketchCheck).toEqual(expect.objectContaining({ state: "unrendered", why: "no Chrome or Edge found" }))
    expect(await spawnAs($, "rein:layout-verifier")).toEqual(refused("only when the hook asks for it"))
    await grade($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("주의: 목업을 렌더링하지 못해 기획서 그림과 배치를 비교하지 않았습니다 (no Chrome or Edge found).")
  })
})

// integration qa's layout check: on the ego path each to-be
// screen of `## 배치 대조` is an ego check, 배치-<id>, judged by
// rein:layout-verifier against the rendered to-be; a match checks the screen's
// box, and when only layout checks failed the run goes back to dev on its own.
describe("integration qa's layout check", () => {
  const APPS = { admin: { url: "http://localhost:8090", login: "test-pass", profile: "Tester1" } }
  const E2E = { apps: APPS, production: ["app.example.com"], backends: [] }
  const CHECK = { name: "detail", app: "admin", page: "대시보드", route: "홈 > 대시보드", todo: "대시보드를 연다", expect: "총주문이 보인다", saves: false }
  const LAYOUT = { anchor: "dash0101", page: "대시보드", route: "홈 > 대시보드", look: "도넛 두 개가 오른쪽 위" }
  const RUN = { v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0, planFiles: ["E:/proj/src/a.jsp"], repos: ["E:/proj"], writes: ["E:/proj/src/a.jsp"], checks: [CHECK], layouts: [LAYOUT] }
  const LIST = `${DIR}/5-checklist.md`
  const folder = (name: string) => `${DIR}/agent/evidence/${name}/1`
  const files = (): Record<string, string> => ({ "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"], e2e: E2E }), [SPEC]: SPEC_TEXT, [HTML]: TO_BE() })
  const PROFILES = [{ id: "Profile 1", name: "Tester1" }]
  const ego = (fs: Record<string, string>): Host => ({
    run: (argv, _cwd, stdin) => {
      if (argv[1]?.endsWith("hooks/render-mockup.js")) return renders.run!(argv, undefined)
      if (argv[0] === "ego-browser" && argv[1] === "skill") return { exitCode: 0, stdout: "# guide\n" }
      if (argv[0] === "ego-browser") {
        if (stdin === PROBE_SCRIPT) return { exitCode: 0, stderr: `${MARK}${JSON.stringify(PROFILES)}\n` }
        if (stdin === SHOT_PROBE_SCRIPT) return { exitCode: 0, stderr: `${MARK}${JSON.stringify({ ok: true })}\n` }
        return { exitCode: 0, stderr: `${MARK}[]\n` }
      }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/a.jsp\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      return { exitCode: 0, stdout: "ok\n" }
    },
    bash: c => {
      const m = /^ego-browser nodejs < (.+)\/round-(\d{2})\.mjs$/.exec(c)
      if (!m) return undefined
      const [f, nn] = [m[1]!, m[2]!]
      fs[`${f}/round-${nn}.log`] = "{}\n"
      fs[`${f}/round-${nn}-shot-1.png`] = ""
      fs[`${f}/round-${nn}-done.json`] = JSON.stringify({ summary: "찍음" })
      return { result: { stdout: "[rein] ok\n", stderr: "" }, text: "[rein] ok" }
    },
  })
  const judgeMd = (part: string, verdict: string) => `## 기대 대조\n\n${part}\n\n판정: ${verdict}\n`
  // a driver drives check `name` to done() in one round.
  const drive = async ($: Engine, name: string) => {
    const { agentId } = await spawnAs($, "rein:ego-driver")
    await $.tool.call({ tool: "Write", file_path: `${folder(name)}/round-01.mjs`, content: `${importLine(folder(name))}\nawait page.goto("/")\n`, agentId } as never)
    await $.tool.call({ tool: "Bash", command: `ego-browser nodejs < ${folder(name)}/round-01.mjs`, timeout: 600_000, agentId } as never)
  }
  const passDetail = async ($: Engine) => {
    await drive($, "detail")
    const j = await spawnAs($, "rein:ego-judge")
    return $.tool.call({ tool: "Write", file_path: `${folder("detail")}/judge.md`, content: judgeMd("- 총주문이 보인다: 통과 — round-01-shot-1.png", "통과"), agentId: j.agentId } as never)
  }
  const judgeLayout = async ($: Engine, part: string, verdict: string) => {
    await drive($, "배치-dash0101")
    const v = await spawnAs($, "rein:layout-verifier")
    return $.tool.call({ tool: "Write", file_path: `${folder("배치-dash0101")}/judge.md`, content: judgeMd(part, verdict), agentId: v.agentId } as never)
  }
  const toEgo = async ($: Engine) => {
    await relay($, ADVANCE)
    return $.tool.call({ tool: "mcp__rein__advance", answer: "e2e 실행 (Ego)" } as never)
  }

  test("tickLayout checks the screen's box once, and layoutCheck measures from the third try", () => {
    const list = "- [ ] **배치 dash0101** — 대시보드\n- [ ] **배치 b** — x\n"
    expect(tickLayout(list, "dash0101", "ok")).toBe("- [x] **배치 dash0101** — 대시보드 (ok)\n- [ ] **배치 b** — x\n")
    expect(tickLayout(tickLayout(list, "dash0101", "ok"), "dash0101", "ok")).toBe(tickLayout(list, "dash0101", "ok"))
    expect(layoutCheck(LAYOUT, "admin", false)).toEqual(expect.objectContaining({ name: "배치-dash0101", app: "admin", page: "대시보드", route: "홈 > 대시보드", saves: false }))
    expect(layoutCheck(LAYOUT, "admin", false).evidence).toBeUndefined()
    expect(layoutCheck(LAYOUT, "admin", true).evidence?.[0]?.kind).toBe("측정")
  })

  test("each to-be screen is an ego check judged by rein:layout-verifier; a match checks its box", async ($, on) => {
    const fs = files()
    world(on, fs, () => undefined, RUN, ego(fs))
    expect(context(await toEgo($))).toContain("with 2 checks to run")
    expect((store.get("runs:proj/login-fix") as Run).layoutChecks?.map(k => k.name)).toEqual(["배치-dash0101"])
    await passDetail($)
    await drive($, "배치-dash0101")
    const text = ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result
    expect(text).toContain("e2e layout judges to spawn now: 1 rein:layout-verifier")
    expect(text).not.toContain("rein:ego-judge, in the background")
    expect(await spawnAs($, "rein:ego-judge")).toEqual(refused("a layout check (배치-<id>) takes rein:layout-verifier"))
    const v = await spawnAs($, "rein:layout-verifier")
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain(`The target: the to-be of screen #dash0101 in ${HTML}, rendered as ${SHOTS}/dash0101.png. Where to look: 도넛 두 개가 오른쪽 위.`)
    expect(task).toContain(`The screen as built: the screenshots a driver saved, each to open with Read: ${folder("배치-dash0101")}/round-01-shot-1.png.`)
    expect(task).toContain("The log of round NN is round-NN.log in the same folder")
    expect(await $.tool.call({ tool: "Bash", command: "ls", agentId: v.agentId } as never)).toEqual(refused("Bash is refused"))
    const passed = await $.tool.call({ tool: "Write", file_path: `${folder("배치-dash0101")}/judge.md`, content: judgeMd("- 배치 #dash0101: 통과 — round-01-shot-1.png", "통과"), agentId: v.agentId } as never)
    expect(context(passed)).toContain("check 배치-dash0101: 판정: 통과.")
    expect(fs[LIST]).toContain("- [x] **배치 dash0101**")
    expect(fs[LIST]).toContain("(ego와 rein:layout-verifier가 to-be와 같다고 판정)")
    expect((store.get("runs:proj/login-fix") as Run).halt).toBeUndefined()
  })

  test("when only layout checks fail the run goes back to dev on its own, with what differs", async ($, on) => {
    const fs = files()
    world(on, fs, () => undefined, RUN, ego(fs))
    await toEgo($)
    await passDetail($)
    const r = await judgeLayout($, "- 배치 #dash0101: 실패 — 도넛: to-be는 오른쪽 위, 화면은 아래", "실패")
    expect(context(r)).toContain("Only layout checks failed (#dash0101): the screen as built differs from the to-be of 1-mockup.html, so the run goes back to dev on its own")
    const run = store.get("runs:proj/login-fix") as Run
    expect(run.stage).toBe("dev")
    expect(run.retries).toBe(1)
    expect(run.failFile).toBe(`${DIR}/agent/layout-fails.md`)
    expect(run.layoutFails).toEqual({ dash0101: 1 })
    const fails = fs[`${DIR}/agent/layout-fails.md`]!
    expect(fails).toContain(`- to-be: ${HTML}#dash0101 (렌더링: ${DIR}/agent/layout/mockup/dash0101.png)`)
    expect(fails).toContain(`- 구현 화면: ${DIR}/agent/evidence/배치-dash0101/1/round-01-shot-1.png`)
    expect(fails).toContain("- 다른 곳: 배치 #dash0101: 실패 — 도넛: to-be는 오른쪽 위, 화면은 아래")
    expect(fails).not.toContain("번 연속 달랐습니다")
  })

  test("a layout check failing beside another failed check halts for the user as before (D173)", async ($, on) => {
    const fs = files()
    world(on, fs, () => undefined, RUN, ego(fs))
    await toEgo($)
    await drive($, "detail")
    const j = await spawnAs($, "rein:ego-judge")
    await $.tool.call({ tool: "Write", file_path: `${folder("detail")}/judge.md`, content: judgeMd("- 총주문이 보인다: 실패 — round-01-shot-1.png 에 없음", "실패"), agentId: j.agentId } as never)
    await judgeLayout($, "- 배치 #dash0101: 실패 — 도넛 위치", "실패")
    const run = store.get("runs:proj/login-fix") as Run
    expect(run.stage).toBe("qa-integration")
    expect(run.halt?.rule).toBe("D173")
  })

  test("from the third difference in a row the driver measures and the worker is told to find the cause", async ($, on) => {
    const fs = files()
    world(on, fs, () => undefined, { ...RUN, layoutFails: { dash0101: 2 } }, ego(fs))
    await toEgo($)
    expect((store.get("runs:proj/login-fix") as Run).layoutChecks?.[0]?.evidence?.[0]?.kind).toBe("측정")
    await passDetail($)
    await judgeLayout($, "- 배치 #dash0101: 실패 — 도넛 위치", "실패")
    expect(fs[`${DIR}/agent/layout-fails.md`]).toContain(`3번 연속 달랐습니다. 고치기 전에 to-be의 요소 측정(${SHOTS}/dash0101.boxes.txt)과 구현 화면의 측정(${DIR}/agent/evidence/배치-dash0101/1/)을 비교하고`)
  })
})
