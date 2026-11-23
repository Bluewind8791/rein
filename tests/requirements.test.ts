import { describe, expect } from "claude-code/testing"
import { docChangeLines, docRows, rowChanges } from "../hooks/lib/requirements.ts"
import { DIR, REIN, SPEC_TEXT, spawned, world, test } from "./world.ts"

// Screen documents: one file per screen, the requirements landed so
// far, in ~/.rein/<project>/requirements/<domain>/<id>.md. In spec the hook
// tells the main session of them once 1-spec.md names their screens, and
// gives them to rein:sketcher and rein:collator; status names them.

const SPEC = `${DIR}/1-spec.md`
const DOC = `${REIN}/requirements/shop/order0101.md`
const HEAD = "| 요소 | 요구사항 | 상태 | 근거 | run |\n|---|---|---|---|---|\n"
const ROW_LIST = "| list.cols | 목록 표 5열 | 구현됨 | 기획서 p.3 | order-list |"
const ROW_EXCEL = "| toolbar.excel | 엑셀 다운로드 버튼 | 보류 | 기획서 p.5 → 사용자: 다음 차수 2026-11-10 | order-list |"
const DOC_TEXT = `---\n화면: order0101\n이름: 주문 목록\n갱신: 2026-11-20 (run order-list)\n---\n\n${HEAD}${ROW_LIST}\n${ROW_EXCEL}\n`
const SCREENS = "\n## 화면\n\n| id | 이름 | URL | 진입 파일 | 종류 |\n|---|---|---|---|---|\n| order0101 | 주문 목록 | /order/list | - | 변경 |\n"
const WITH_SCREENS = `${SPEC_TEXT}${SCREENS}`
const ASIS = `<style></style>\n<section class="screen" id="order0101">\n  <div class="before"><div class="canvas">표</div></div>\n</section>\n`
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) =>
  ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result

describe("the pieces", () => {
  test("a document's rows leave out its header and separator; the changes are the rows added and dropped", () => {
    expect(docRows(DOC_TEXT)).toEqual([ROW_LIST, ROW_EXCEL])
    const done = ROW_EXCEL.replace("보류 | 기획서 p.5 → 사용자: 다음 차수 2026-11-10 | order-list", "구현됨 | 기획서 p.5 | order-excel")
    const after = `${HEAD}${ROW_LIST}\n${done}\n`
    expect(rowChanges(DOC_TEXT, after)).toEqual({ added: [done], removed: [ROW_EXCEL] })
    expect(rowChanges(undefined, after)).toEqual({ added: [ROW_LIST, done], removed: [] })
    expect(docChangeLines([{ rel: "shop/order0101.md", before: DOC_TEXT, after }], REIN)).toBe(
      `화면 문서 (run이 닫히면 ${REIN}/requirements/로 옮김):\n  shop/order0101.md (바뀐 줄 2)\n    - ${ROW_EXCEL}\n    + ${done}`,
    )
    expect(docChangeLines([], REIN)).toBeUndefined()
  })
})

describe("spec", () => {
  test("the main session is told of a screen's document once, when 1-spec.md names the screen", async ($, on) => {
    const files: Record<string, string> = { [DOC]: DOC_TEXT }
    world(on, files, undefined, { stage: "spec", runId: "login-fix" })
    expect(context(await $.tool.call({ tool: "Write", file_path: SPEC, content: SPEC_TEXT } as never))).not.toContain("Screen documents")
    const told = context(await $.tool.call({ tool: "Write", file_path: SPEC, content: WITH_SCREENS } as never))
    expect(told).toContain(`Screen documents from earlier runs, the requirements landed so far for screens of \`## 화면\`: ${DOC}. Read each now.`)
    expect(told).toContain("ask the user before you write it")
    expect(context(await $.tool.call({ tool: "Write", file_path: SPEC, content: `${WITH_SCREENS}\n` } as never))).not.toContain("Screen documents")
    expect(await status($)).toContain(`screen documents of the screens of \`## 화면\`: ${DOC}`)
  })

  test("no document for the screen: nothing is told, and status says none yet", async ($, on) => {
    world(on, {}, undefined, { stage: "spec", runId: "login-fix" })
    expect(context(await $.tool.call({ tool: "Write", file_path: SPEC, content: WITH_SCREENS } as never))).not.toContain("Screen documents")
    expect(await status($)).toContain("screen documents of the screens of `## 화면`: none yet")
  })

  test("the sketcher's task names the documents and has the spec's element tags kept as data-ids; the collator's prompt gets them after the main session's", async ($, on) => {
    world(on, { [DOC]: DOC_TEXT, [SPEC]: WITH_SCREENS, [`${DIR}/agent/asis.html`]: ASIS }, undefined, { stage: "spec", runId: "login-fix" })
    await $.agent.spawn({ tool_use_id: "s", prompt: "draw", description: "draw", subagentType: "rein:sketcher", background: false } as never)
    const task = spawned.at(-1)?.prompt ?? ""
    expect(task).toContain(`The screen documents of earlier runs, the requirements landed so far: ${DOC}.`)
    expect(task).toContain("never draw a 폐기 row, and draw a 보류 row only when a line of `## 요구사항` takes it up")
    expect(task).toContain("Each line of `## 요구사항` ends with the element it is about, `[<data-id>]`")
    await $.agent.spawn({ tool_use_id: "c", prompt: `collate ${SPEC}`, description: "collate", subagentType: "rein:collator" } as never)
    const collator = spawned.at(-1)?.prompt ?? ""
    expect(collator.startsWith(`collate ${SPEC}\n\n`)).toBe(true)
    expect(collator).toContain(`${DOC}. Read each. A requirement of the planning documents that a row holds as the document says is not missing. Report under \`지난 결정과 다름:\``)
  })

  test("a screen with no document: the main session is told once of the completed runs that named it, and status names them", async ($, on) => {
    const OLD = `${REIN}/complete/order-list/1-spec.md`
    world(on, { [OLD]: WITH_SCREENS, [`${REIN}/complete/member-list/1-spec.md`]: SPEC_TEXT }, undefined, { stage: "spec", runId: "login-fix" })
    const told = context(await $.tool.call({ tool: "Write", file_path: SPEC, content: WITH_SCREENS } as never))
    expect(told).toContain(`Screens of \`## 화면\` with no screen document yet that completed runs touched before: order0101 (${OLD}). Read those 1-spec.md files now`)
    expect(told).not.toContain("member-list")
    expect(context(await $.tool.call({ tool: "Write", file_path: SPEC, content: `${WITH_SCREENS}\n` } as never))).not.toContain("completed runs touched before")
    expect(await status($)).toContain(`screen documents of the screens of \`## 화면\`: none yet; earlier completed runs of the screens with none: order0101 (${OLD})`)
  })

  test("the sketcher's task without documents says nothing of them", async ($, on) => {
    world(on, { [SPEC]: WITH_SCREENS, [`${DIR}/agent/asis.html`]: ASIS }, undefined, { stage: "spec", runId: "login-fix" })
    await $.agent.spawn({ tool_use_id: "s", prompt: "draw", description: "draw", subagentType: "rein:sketcher", background: false } as never)
    expect(spawned.at(-1)?.prompt ?? "").not.toContain("The screen documents of earlier runs")
  })
})

describe("land status", () => {
  test("status names where the updated copies go and the project's domains", async ($, on) => {
    world(on, { [DOC]: DOC_TEXT, [SPEC]: WITH_SCREENS, [`${REIN}/knowledge/shop/a.md`]: "x" }, undefined, { stage: "land", runId: "login-fix" })
    expect(await status($)).toContain(`screen documents of the screens of \`## 화면\` (order0101): ${DOC}. The updated copies go in ${DIR}/agent/requirements/, as <domain>/<screen id>.md; the project's domains: shop.`)
  })

  test("a screen with no document: land is told to write the first one from the earlier runs", async ($, on) => {
    const OLD = `${REIN}/complete/order-list/1-spec.md`
    world(on, { [SPEC]: WITH_SCREENS, [OLD]: WITH_SCREENS }, undefined, { stage: "land", runId: "login-fix" })
    expect(await status($)).toContain(`No document yet for: order0101 (${OLD}). Write it from those runs' \`## 요구사항\` (or \`## 기획서 대조\`) lines and this run's, giving each of their lines the element of its run's 1-mockup.html data-id`)
  })

  test("a project with no domain writes <screen id>.md", async ($, on) => {
    world(on, { [SPEC]: WITH_SCREENS }, undefined, { stage: "land", runId: "login-fix" })
    expect(await status($)).toContain("the project's domains: none (write <screen id>.md; it stays on this PC).")
  })
})
