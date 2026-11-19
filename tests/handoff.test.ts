import { describe, expect } from "claude-code/testing"
import { parsePlan } from "../hooks/lib/parse.ts"
import { reviewTask } from "../hooks/stages/review.ts"
import { COVER, DIR, planned, SPEC_TEXT, store, world, test } from "./world.ts"

// what dev writes for the person to apply outside the repositories
// (a DB script): 2-plan.md's `## 넘길 것` names the files, dev writes them in
// the run's handoff/ folder, review reads them, land shows them and leaves
// them out of the commit.

const PLAN = (handoff: string, impact = "- `src/login.ts` — 변경\n") => `# 수탁 분류

## 접근 방법

공통코드를 추가한다.

## 상세 설계

### src/login.ts
- 43을 더한다
- 테스트 면제: 분기 하나

## 넘길 것
${handoff}
## 영향 범위

${impact}${COVER}`

const ITEM = "\n### 01_config.sql\n- t_config에 설정 한 행을 넣는다. 운영 DB에서 배포 전에 직접 실행\n\n"
const REPOS = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"] }), [`${DIR}/1-spec.md`]: SPEC_TEXT }
const HANDOFF = `${DIR}/handoff/01_config.sql`
const DEV_RUN = {
  v: 2, stage: "dev", runId: "login-fix", rules: [], planFiles: ["E:/proj/src/login.ts"], repos: ["E:/proj"],
  writes: ["E:/proj/src/login.ts"], retries: 0, handoff: ["01_config.sql"], worker: "w",
}
const DEV_MD = "# dev 결과\n\n## 설계 항목\n\n- [x] src/login.ts\n"
const write = (file_path: string, content = "x") => ({ tool: "Write", file_path, content }) as never
// dev's files are the worker's to write.
const work = (file_path: string, content = "x") => ({ tool: "Write", file_path, content, agentId: "w" }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const record = () => store.get("runs:proj/login-fix") as { stage: string; handoff?: string[] }

describe("handoff files", () => {
  test("2-plan.md names them under ## 넘길 것; an impact may say 넘김", () => {
    const parsed = parsePlan(PLAN(ITEM, "- `src/login.ts` — 변경\n- t_config — 넘김: 01_config.sql\n"), "E:/proj")
    expect(parsed).toEqual({ ok: true, files: ["E:/proj/src/login.ts"], handoff: ["01_config.sql"] })
    expect(parsePlan(PLAN(ITEM).replace(/## 넘길 것[\s\S]*?(?=## 영향 범위)/, ""), "E:/proj")).toEqual(expect.objectContaining({ ok: true, handoff: [] }))
  })

  test("a heading that is not one plain name, or an item that says nothing, is refused", () => {
    for (const [item, says] of [
      ["\n### sql/01.sql\n- 실행\n", "not one plain file name"],
      ["\n### ../01.sql\n- 실행\n", "not one plain file name"],
      ["\n### .env\n- 실행\n", "not one plain file name"],
      ["\n### 01.sql\n\n", "do not say what the person does"],
      ["\n", "has no `### <file name>` item"],
    ]) {
      expect([item, parsePlan(PLAN(item!), "E:/proj")]).toEqual([item, expect.objectContaining({ ok: false, rule: "D163", reason: expect.stringContaining(says!) })])
    }
  })

  test("the plan pass records them and tells dev where to write them", async ($, on) => {
    world(on, { ...REPOS }, undefined, { stage: "plan", runId: "login-fix" })
    const r = await planned($, PLAN(ITEM))
    expect(record()).toEqual(expect.objectContaining({ stage: "dev", handoff: ["01_config.sql"] }))
    expect(r).toContain(`write the handoff files 2-plan.md's \`## 넘길 것\` names, each whole, in ${DIR}/handoff/: 01_config.sql.`)
  })

  test("dev writes the named ones and no other file in handoff/", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    expect(await $.tool.call(work(HANDOFF, "insert into t_config ..."))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(work(`${DIR}/handoff/other.sql`))).toEqual(expect.objectContaining({ deny: expect.stringContaining("D163: in") }))
    expect(await $.tool.call(work(`${DIR}/handoff/sub/01_config.sql`))).toEqual(expect.objectContaining({ deny: expect.stringContaining("D163: in") }))
    expect(await $.tool.check({ tool: "Write", input: { file_path: HANDOFF, content: "x" } } as never)).toEqual(expect.objectContaining({ decision: "allow" }))
    expect((store.get("runs:proj/login-fix") as { writes: string[] }).writes).toEqual(["E:/proj/src/login.ts"])
  })

  test("dev-items.md does not pass while a handoff file is missing or empty", async ($, on) => {
    const files: Record<string, string> = { [HANDOFF]: "  \n" }
    world(on, files, undefined, DEV_RUN)
    const r = await $.tool.call(work(`${DIR}/agent/dev-items.md`, DEV_MD))
    expect(context(r)).toContain(`D163: these handoff files 2-plan.md names are missing or empty: ${HANDOFF}.`)
    expect(record().stage).toBe("dev")
    files[HANDOFF] = "insert into t_config ..."
    await $.tool.call(work(`${DIR}/agent/dev-items.md`, DEV_MD))
    expect(record().stage).toBe("review")
  })

  test("review reads them, out of the commit", () => {
    const run = { ...DEV_RUN, stage: "review" } as never
    expect(reviewTask(run, "E:/proj", DIR)).toContain(`Handoff files (D163), outside every repository, for the person to apply: ${HANDOFF}.`)
  })
})
