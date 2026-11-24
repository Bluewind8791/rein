import { describe, expect, type Engine } from "claude-code/testing"
import { parseLayouts, toBeScreens } from "../hooks/lib/parse.ts"
import { checklist, openLayouts } from "../hooks/stages/qaIntegration.ts"
import { relay, DIR, gitSub, planned, SPEC_TEXT, spawned, store, world, type Host, test } from "./world.ts"

// The to-be screens of 1-mockup.html: 2-plan.md names each in `## 배치 대조`,
// 5-checklist.md gives each a box, and integration qa waits for the person
// to compare and check them.

const HTML = `${DIR}/1-mockup.html`
const LIST = `${DIR}/5-checklist.md`
const QAI = `${DIR}/agent/e2e.md`
const SPEC_LINE = "로그인에 세 번 실패하면 잠긴다"
const DRAWN = [
  '<section class="screen" id="order0101"><h2>주문 등록</h2>',
  '<div class="compare"><div class="before">지금</div><div class="compare-arrow">▼</div><div class="after"><div class="changed">탭</div></div></div></section>',
  '<section class="screen" id="order0102"><h2>주문 조회</h2><div class="before">그대로</div></section>',
  '<section class="screen" id="flow"><svg><text class="after-label">x</text></svg></section>',
  '<!-- <section class="screen" id="old"><div class="after"></div></section> -->',
].join("\n")
const SECTION = "\n## 배치 대조\n\n### order0101\n- 페이지: 주문 등록\n- 경로: 주문 > 주문관리 > 주문 등록\n- 볼 곳: 검색 영역 아래 탭 2개\n"
const LAYOUT = { anchor: "order0101", page: "주문 등록", route: "주문 > 주문관리 > 주문 등록", look: "검색 영역 아래 탭 2개" }

const ADVANCE = { tool: "mcp__rein__advance" } as never
const STATUS = { tool: "mcp__rein__status" } as never
const answer = (text: string) => ({ tool: "mcp__rein__advance", answer: text }) as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const spawnVerifier = { tool_use_id: "t", prompt: "p", description: "d", subagentType: "rein:reviewer" } as never
const VERIFIER = "agent-rein:reviewer"
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) => ((await $.tool.call(STATUS)) as { result: string }).result

describe("2-plan.md's `## 배치 대조`", () => {
  const PLAN = (extra: string) => `## 접근 방법\n\na\n\n## 상세 설계\n\n### src/login.ts\n- 고친다\n- 테스트: tests/login.test.ts\n\n### tests/login.test.ts\n- 본다\n- 테스트: tests/login.test.ts\n\n## 완료 판정 덮기\n\n- "잠긴다" — 확인 불가: 예시라 확인할 것이 없음\n${extra}`
  const REPO = () => ({ "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["t"] }), [`${DIR}/1-spec.md`]: SPEC_TEXT })

  test("toBeScreens reads the .screen sections that draw a .after, outside comments", () => {
    expect(toBeScreens(DRAWN)).toEqual(["order0101"])
    expect(toBeScreens('<section id="c" class="screen wide"><div style="x" class="after">y</div></section>')).toEqual(["c"])
    expect(toBeScreens("<p>없음</p>")).toEqual([])
  })

  test("parseLayouts reads the screens, 없음, and names what is wrong", () => {
    expect(parseLayouts(SECTION)).toEqual({ layouts: [LAYOUT] })
    expect(parseLayouts("## 배치 대조\n\n### `#order0101`\n- 페이지: a\n- 경로: b\n- 볼 곳: c\n")).toEqual({ layouts: [{ anchor: "order0101", page: "a", route: "b", look: "c" }] })
    expect(parseLayouts("## 배치 대조\n\n없음\n")).toEqual({ layouts: [] })
    expect(parseLayouts("## 접근 방법\n")).toBeUndefined()
    expect((parseLayouts("## 배치 대조\n\n### a\n- 페이지: x\n") as { reason: string }).reason).toContain("a needs exactly one non-empty line of `- 경로:`, `- 볼 곳:`")
  })

  test("parseLayouts takes an optional `- 저장:` line; 있음 saves, 없음 or no line does not", () => {
    const item = (extra: string) => `## 배치 대조\n\n### order0101\n- 페이지: a\n- 경로: b > 저장 > 되돌림\n- 볼 곳: c\n${extra}`
    const plain = { anchor: "order0101", page: "a", route: "b > 저장 > 되돌림", look: "c" }
    expect(parseLayouts(item("- 저장: 있음\n"))).toEqual({ layouts: [{ ...plain, saves: true }] })
    expect(parseLayouts(item("- 저장: 없음\n"))).toEqual({ layouts: [plain] })
    expect(parseLayouts(item(""))).toEqual({ layouts: [plain] })
    expect((parseLayouts(item("- 저장: 예\n")) as { reason: string }).reason).toContain("order0101 needs at most one `- 저장:` line, 있음 or 없음")
    expect((parseLayouts(item("- 저장: 있음\n- 저장: 있음\n")) as { reason: string }).reason).toContain("order0101 needs at most one `- 저장:` line, 있음 or 없음")
  })

  test("with a to-be in 1-mockup.html each to-be screen needs its item, and no other; then the plan passes and keeps them", async ($, on) => {
    const files: Record<string, string> = { ...REPO(), [HTML]: DRAWN }
    world(on, files, undefined, { stage: "plan", runId: "login-fix" })
    const none = await planned($, PLAN(""))
    expect(none).toContain("2-plan.md does not pass yet, so the run stays in plan: 1-mockup.html draws the to-be of #order0101, and `## 배치 대조` has no `### <anchor>` for it.")
    expect(none).not.toMatch(/^: /)
    const stray = SECTION + "\n### order0102\n- 페이지: 주문 조회\n- 경로: 주문 > 주문관리 > 주문 조회\n- 볼 곳: 그리드\n"
    expect(await planned($, PLAN(stray))).toContain("`## 배치 대조` names #order0102, which 1-mockup.html draws no to-be of")
    expect(await planned($, PLAN(SECTION))).toContain("now in the dev stage")
    expect((store.get("runs:proj/login-fix") as { layouts?: unknown }).layouts).toEqual([LAYOUT])
  })

  test("without a to-be: no section, or 없음, passes; an item does not", async ($, on) => {
    world(on, REPO(), undefined, { stage: "plan", runId: "login-fix" })
    expect(await planned($, PLAN(SECTION))).toContain("`## 배치 대조` names #order0101, which 1-mockup.html draws no to-be of")
    expect(await planned($, PLAN("\n## 배치 대조\n\n없음\n"))).toContain("now in the dev stage")
    expect((store.get("runs:proj/login-fix") as { layouts?: unknown }).layouts).toBeUndefined()
  })
})

describe("the layout boxes of 5-checklist.md", () => {
  const RUN = {
    v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 0,
    planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"], writes: ["E:/proj/src/login.ts"], checks: [], layouts: [LAYOUT],
  }
  const SPEC = `# 로그인 잠금\n\n## 완료 판정\n\n${SPEC_LINE}\n`
  const filesWith = (): Record<string, string> => ({ "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"] }), [`${DIR}/1-spec.md`]: SPEC, [HTML]: DRAWN })
  const host: Host = {
    run: argv => {
      if (argv[0] === "aside") return { exitCode: 1 }
      if (argv[0] === "git" && gitSub(argv) === "status") return { exitCode: 0, stdout: " M src/login.ts\0" }
      if (argv[0] === "git") return { exitCode: 0, stdout: "abc123\n" }
      return { exitCode: 0, stdout: "ok\n" }
    },
  }
  const completion = (text: string) => `${text}\n## 완료 판정 대조\n\n> ${SPEC_LINE}\n\n판정: 통과\n`
  // work qa passes, the e2e commands run, and the completion check passes.
  async function passed($: Engine, files: Record<string, string>): Promise<unknown> {
    await relay($, ADVANCE)
    await $.agent.spawn(spawnVerifier)
    return $.tool.call(write(QAI, completion(files[QAI]!), VERIFIER))
  }

  test("checklist gives each screen a box after the checks; openLayouts names the screens whose box is empty", () => {
    const text = checklist("spec", [], {}, [LAYOUT])
    expect(text).toBe(
      "# 통합 테스트 체크리스트 — spec\n\n" +
        "항목마다 할 일을 화면에서 해 보고, 기대대로 보이는 줄의 칸을 `[x]`로 체크하세요.\n\n" +
        "- 직접 확인했으면: 모든 칸을 체크한 뒤 `/rein:land`\n" +
        "- 문제가 있으면: 메인 세션에 말하세요. dev로 되돌릴 수 있습니다\n\n" +
        "## 화면 배치 대조\n\n" +
        "[1-mockup.html](1-mockup.html)을 열어 두고, 화면마다 구현된 배치를 to-be와 비교하세요. 영역 순서, 컬럼 순서, 버튼 위치가 to-be와 같으면 칸을 체크합니다.\n\n" +
        "- [ ] **배치 order0101** — 주문 등록 화면을 [1-mockup.html#order0101](1-mockup.html#order0101)의 to-be와 대조\n" +
        "  - 접근: 주문 > 주문관리 > 주문 등록\n  - 볼 곳: 검색 영역 아래 탭 2개\n",
    )
    expect(checklist("spec", [], {})).not.toContain("화면 배치 대조")
    expect(openLayouts(text, [LAYOUT])).toEqual(["order0101"])
    expect(openLayouts(text.replace("- [ ] **배치", "- [x] **배치"), [LAYOUT])).toEqual([])
    expect(openLayouts(undefined, [LAYOUT])).toEqual(["order0101"])
  })

  test("with no screen check the checklist holds the layout boxes, and a passing integration qa waits for them", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host)
    const r = await passed($, files)
    expect(files[LIST]).toContain("- [ ] **배치 order0101**")
    expect(files[LIST]).not.toContain("/rein:e2e")
    expect(context(r)).toContain(`layout-unchecked: integration qa passed, but the layout boxes of ${LIST} for order0101 are still empty, so the run waits for the user in qa-integration.`)
    expect(await status($)).toContain("halt: layout-unchecked")
    const asked = (await $.tool.call(ADVANCE)) as { result: string }
    expect(asked.result).toContain("layout-unchecked: this needs the user's answer; nothing changed.")
    expect(asked.result).toContain("빈 칸: 배치 order0101")
    expect(asked.result).toContain('"직접 확인 완료", "dev로 보냄", "plan으로 보냄"')
    expect(asked.result).not.toContain("재시도")
    expect(await $.tool.call(answer("나중에"))).toEqual(refused('answer takes one of "직접 확인 완료", "dev로 보냄", "plan으로 보냄"'))
    expect(await $.tool.call(answer("직접 확인 완료"))).toEqual(refused(`The run does not go to land: these layout boxes of ${LIST} are still empty: 배치 order0101.`))
    files[LIST] = files[LIST]!.replace("- [ ] **배치 order0101**", "- [x] **배치 order0101**")
    const done = await $.tool.call(answer("직접 확인 완료"))
    expect(context(done)).toContain("now in the land stage")
    expect(await status($)).toContain("stage: land\n")
  })

  test("boxes the user checked before integration qa passed let the run go on to land", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host)
    await relay($, ADVANCE)
    files[LIST] = files[LIST]!.replace("- [ ] **배치 order0101**", "- [x] **배치 order0101**")
    await $.agent.spawn(spawnVerifier)
    expect(context(await $.tool.call(write(QAI, completion(files[QAI]!), VERIFIER)))).toContain("now in the land stage")
  })

  test("dev로 보냄 sends the run to dev with the checklist and counts nothing", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host)
    await passed($, files)
    const r = await $.tool.call(answer("dev로 보냄"))
    expect(context(r)).toContain(`The user found a layout that differs from the to-be of 1-mockup.html; ${LIST} holds the checklist and what they found.`)
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "dev", retries: 0, failFile: LIST })
  })

  test("plan으로 보냄 sends the run to plan with the checklist and counts nothing", async ($, on) => {
    const files = filesWith()
    world(on, files, undefined, RUN, host)
    await passed($, files)
    const r = await $.tool.call(answer("plan으로 보냄"))
    expect(context(r)).toContain(`The user found a layout that differs from the to-be of 1-mockup.html; ${LIST} holds the checklist and what they found.`)
    expect(context(r)).toContain("D62")
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", d62: true, failFile: LIST, retries: 0 })
  })

  test("with screen checks the waiting checklist holds the layout boxes too, and 직접 확인 완료 needs them", async ($, on) => {
    const files: Record<string, string> = { ...filesWith(), "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"], e2e: { apps: { admin: { url: "http://localhost:8090" } }, production: ["app.example.com"], backends: ["localhost:8080"] } }) }
    const check = { name: "detail", app: "admin", page: "회원상세", route: "회원 > 회원상세", todo: "본다", expect: "우수회원", saves: false }
    world(on, files, undefined, { ...RUN, checks: [check] }, host)
    await relay($, ADVANCE)
    expect(files[LIST]).toContain("- aside에 맡기려면: `/rein:e2e`")
    expect(files[LIST]).toContain("- **detail**\n  - 할 일: 본다\n  - 기대:\n    - [ ] 우수회원\n")
    expect(files[LIST]).toContain("- [ ] **배치 order0101**")
    files[LIST] = files[LIST]!.replace("    - [ ] 우수회원", "    - [x] 우수회원")
    expect(await $.tool.call(answer("직접 확인 완료"))).toEqual(refused("- [ ] **배치 order0101**"))
    files[LIST] = files[LIST]!.replace("- [ ] **배치 order0101**", "- [x] **배치 order0101**")
    expect(context(await $.tool.call(answer("직접 확인 완료")))).toContain("now in the land stage")
    expect(spawned).toHaveLength(0)
  })
})
