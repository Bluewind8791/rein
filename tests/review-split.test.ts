import { describe, expect } from "claude-code/testing"
import { parseGroups, pendingGroups, planRanges, SPLIT_AT } from "../hooks/stages/review.ts"
import type { Run } from "../hooks/lib/state.ts"
import { COVER, DIR, REIN, reviewed, spawned, SPEC_TEXT, store, world, test } from "./world.ts"

// A change of SPLIT_AT or more files is reviewed in groups: a
// rein:review-splitter writes review-groups.md, one rein:reviewer per group
// writes review-<n>.md, and once every group has its verdict the hook moves
// the run as one review would, writing review.md from the failed groups.

const RULES = [
  { name: "api", path: `${REIN}/rules/api.md`, hash: "h", paths: ["src/**"] },
  { name: "web", path: `${REIN}/rules/web.md`, hash: "h", paths: ["web/**"] },
  { name: "all", path: `${REIN}/rules/all.md`, hash: "h", paths: null },
]
const SRC = ["a", "b", "c", "d", "e"].map(n => `E:/proj/src/${n}.ts`)
const WEB = ["a", "b", "c", "d", "e"].map(n => `E:/proj/web/${n}.js`)
const FILES = [...SRC, ...WEB]
const PLAN = [
  "# 바꿈",
  "",
  "## 접근 방법",
  "",
  "나눠서",
  "",
  "## 상세 설계",
  "",
  ...FILES.flatMap(f => [`### ${f.slice("E:/proj/".length)}`, "", "- 바꿈", "- 테스트 면제: 없음", ""]),
  "## 영향 범위",
  "",
  "없음",
  "",
  "## 변경 전 실패",
  "",
  "- src/a.ts — 지금: 0 → 바뀐 뒤: 1",
  "",
].join("\n")
const RUN = { v: 2, stage: "review", runId: "login-fix", rules: RULES, planFiles: FILES, repos: ["E:/proj"], writes: FILES, retries: 0 }
const GROUPS = `## 묶음 1: 서버\n\n${SRC.map(f => `- ${f}`).join("\n")}\n\n## 묶음 2: 화면\n\n${WEB.map(f => `- ${f}`).join("\n")}\n`
const md = (design: string, rules: string[], cause?: string) =>
  `## 설계 대조\n\n판정: ${design}\n\n## 룰 체크\n\n${rules.map(r => `- \`${r}\` — 판정: 통과`).join("\n")}\n\n## 정확성\n\n판정: 통과\n${cause ? `\n## 실패 원인\n\n원인: ${cause}\n\n이유.\n` : ""}`
const SPLITTER = "agent-rein:review-splitter"
const R1 = "agent-rein:reviewer"
const R2 = "agent-rein:reviewer-2"

const STATUS = { tool: "mcp__rein__status" } as never
const spawn = (subagentType: string, prompt = "review") => ({ tool_use_id: "t", prompt, description: "d", subagentType, background: true }) as never
const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) => ((await $.tool.call(STATUS)) as { result: string }).result

const start = (files: Record<string, string>, run: Record<string, unknown> = RUN) => ({ files: { [`${DIR}/2-plan.md`]: PLAN, ...files } as Record<string, string>, run })

describe("split review", () => {
  test(`from ${SPLIT_AT} changed files the splitter comes first; a reviewer before it is refused`, async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    expect(await status($)).toContain("so its review is split: spawn rein:review-splitter first")
    expect(await $.agent.spawn(spawn("rein:reviewer"))).toEqual(refused("spawn rein:review-splitter first"))
    await $.agent.spawn(spawn("rein:review-splitter"))
    const task = spawned.at(-1)!.prompt!
    expect(spawned.at(-1)).toEqual(expect.objectContaining({ type: "rein:review-splitter", background: false }))
    expect(task).toContain("- E:/proj/src/a.ts (2-plan.md lines 9–13: ### src/a.ts)")
    expect(task).toContain(`Write ${DIR}/agent/review-groups.md, whole, once, with Write`)
    expect(await status($)).toContain(`review splitter: ${SPLITTER}`)
  })

  test("fewer files keep one reviewer, and no splitter", async ($, on) => {
    const { files } = start({})
    world(on, files, undefined, { ...RUN, writes: FILES.slice(0, SPLIT_AT - 1) })
    expect(await $.agent.spawn(spawn("rein:review-splitter"))).toEqual(refused("too few to split"))
    await $.agent.spawn(spawn("rein:reviewer"))
    expect(spawned.at(-1)!.prompt).toContain(`Write ${DIR}/agent/review.md, whole, once`)
  })

  test("review-groups.md must hold every changed file once; only the splitter's counts", async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    await $.agent.spawn(spawn("rein:review-splitter"))
    const path = `${DIR}/agent/review-groups.md`
    expect(await $.tool.call(write(path, GROUPS.replace(`- ${WEB[4]}\n`, ""), SPLITTER))).toEqual(refused(`these are in no group: ${WEB[4]}`))
    expect(await $.tool.call(write(path, `${GROUPS}- ${SRC[0]}\n`, SPLITTER))).toEqual(refused(`these are in more than one group: ${SRC[0]}`))
    expect(await $.tool.call(write(path, `${GROUPS}- E:/proj/x.ts\n`, SPLITTER))).toEqual(refused("not changed or handoff files of the run: E:/proj/x.ts"))
    expect(await $.tool.call(write(path, GROUPS.replace("묶음 2", "묶음 3"), SPLITTER))).toEqual(refused("should be 묶음 2"))
    expect(context(await $.tool.call(write(path, GROUPS)))).toBe("")
    expect(await status($)).not.toContain("review group 1")
    expect(context(await $.tool.call(write(path, GROUPS, SPLITTER)))).toContain("review-groups.md passed with 2 groups")
    const s = await status($)
    expect(s).toContain("review group 1 (서버, 5 files): not reviewed yet")
    expect(s).toContain("Groups to review: 1, 2. Spawn one rein:reviewer per group")
    expect(s).not.toContain("review splitter:")
  })

  test("each group's reviewer gets its files, their lines in 2-plan.md, its rules and assertions, and writes only its file", async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    expect(await $.agent.spawn(spawn("rein:reviewer", "리뷰해 줘"))).toEqual(refused("as `묶음 <n>`"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    const one = spawned.at(-1)!.prompt!
    expect(one).toContain("This is group 1 of 2 (서버)")
    expect(one).toContain("- E:/proj/src/b.ts (lines 14–18)")
    expect(one).not.toContain("web/a.js")
    expect(one).toContain("- api.md: ")
    expect(one).not.toContain("- web.md: ")
    expect(one).toContain("- src/a.ts — 지금: 0 → 바뀐 뒤: 1")
    expect(one).toContain(`Write ${DIR}/agent/review-1.md, whole, once`)
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    expect(spawned.at(-1)!.prompt).toContain("leave `## 변경 전 실패` out")
    expect(await $.tool.call(write(`${DIR}/agent/review-2.md`, md("통과", ["web.md", "all.md"]), R1))).toEqual(refused("only the rein:reviewer spawned for group 2"))
    expect(await $.tool.call(write(`${DIR}/agent/review-1.md`, md("통과", ["web.md", "all.md"]), R1))).toEqual(refused("The hook's rule list: api.md, all.md."))
    expect(await status($)).toContain(`review group 2 (화면, 5 files): rein:reviewer ${R2} on it`)
  })

  test("all groups 통과 moves the run to qa once the last verdict is in", async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    const first = await $.tool.call(write(`${DIR}/agent/review-1.md`, md("통과", ["api.md", "all.md"]), R1))
    expect(context(first)).toContain("Group 1 passed; the run stays in review")
    expect(await status($)).toContain("stage: review")
    const last = await $.tool.call(write(`${DIR}/agent/review-2.md`, md("통과", ["web.md", "all.md"]), R2))
    expect(context(last)).toContain("Every group passed. The run is now in the qa stage.")
    expect(await status($)).toContain("stage: qa")
    expect(files[`${DIR}/agent/review.md`]).toBeUndefined()
  })

  test("a failed group sends the run to dev with a review.md of the failed groups; the retry reviews only it", async ($, on) => {
    const src = Object.fromEntries(FILES.map(f => [f, "x"]))
    const { files } = start(src)
    world(on, files, undefined, { ...RUN, stage: "dev" })
    const devItems = FILES.map(f => `- [x] ${f.slice("E:/proj/".length)}`).join("\n") + "\n"
    await $.agent.spawn(spawn("rein:worker"))
    expect(context(await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker")))).toContain("spawn rein:review-splitter first")
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    await $.tool.call(write(`${DIR}/agent/review-1.md`, md("통과", ["api.md", "all.md"]), R1))
    const failed = md("실패", ["web.md", "all.md"], "구현").replace("판정: 실패\n", "판정: 실패\n\nweb/a.js:3 설계와 다름\n")
    const r = await $.tool.call(write(`${DIR}/agent/review-2.md`, failed, R2))
    expect(context(r)).toContain(`Groups 2 failed; the hook wrote ${DIR}/agent/review.md from them.`)
    expect(await status($)).toContain(`failFile: ${DIR}/agent/review.md`)
    const joined = files[`${DIR}/agent/review.md`]!
    expect(joined).toContain("- 묶음 1 (서버): 통과 — agent/review-1.md")
    expect(joined).toContain("- 묶음 2 (화면): 실패 — agent/review-2.md")
    expect(joined).toContain("# 묶음 2: 화면\n\n## 설계 대조\n\n판정: 실패\n\nweb/a.js:3 설계와 다름")

    // the retry changes a file of group 2 only: group 1 stays passed.
    await $.agent.spawn(spawn("rein:worker"))
    await $.tool.call(write(WEB[0]!, "y", "agent-rein:worker-2"))
    await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker-2"))
    const s = await status($)
    expect(s).toContain("stage: review")
    expect(s).toContain("review group 1 (서버, 5 files): 통과")
    expect(s).toContain("review group 2 (화면, 5 files): not reviewed yet")
    expect(s).toContain("Groups to review: 2.")
    expect(await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))).toEqual(refused("one of those still to judge"))
  })

  test("after the run went back through plan, review judges again only the groups whose files changed", async ($, on) => {
    const src = Object.fromEntries(FILES.map(f => [f, "x"]))
    const plan = `${PLAN}${COVER}`
    const repo = { "E:/proj/.git/HEAD": "", "E:/proj/.rein/config.json": JSON.stringify({ qa: ["npm test"] }), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const { files } = start({ ...src, ...repo, [`${DIR}/2-plan.md`]: plan })
    world(on, files, () => "승인", { ...RUN, stage: "dev", frozen: { spec: SPEC_TEXT, plan } })
    const devItems = FILES.map(f => `- [x] ${f.slice("E:/proj/".length)}`).join("\n") + "\n"
    await $.agent.spawn(spawn("rein:worker"))
    await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker"))
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    await $.tool.call(write(`${DIR}/agent/review-1.md`, md("통과", ["api.md", "all.md"]), R1))
    await $.tool.call(write(`${DIR}/agent/review-2.md`, md("통과", ["web.md", "all.md"]), R2))
    expect(await status($)).toContain("stage: qa")

    // integration qa sends the run to plan; the revised design passes and dev changes one screen file.
    const key = "runs:proj/login-fix"
    store.set(key, { ...(store.get(key) as object), stage: "plan", d62: true, failFile: `${DIR}/5-checklist.md` })
    await $.tool.call(write(`${DIR}/2-plan.md`, plan.replace("나눠서", "나눠서, 여백도")))
    await reviewed($)
    expect(context(await $.tool.call({ tool: "mcp__rein__advance", answer: "승인" } as never))).toContain("now in the dev stage")
    await $.agent.spawn(spawn("rein:worker"))
    await $.tool.call(write(WEB[0]!, "y", "agent-rein:worker-2"))
    expect(context(await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker-2")))).toContain("Groups to review: 2.")
    const s = await status($)
    expect(s).toContain("review group 1 (서버, 5 files): 통과")
    expect(s).toContain("review group 2 (화면, 5 files): 통과")
    expect(await $.agent.spawn(spawn("rein:review-splitter"))).toEqual(refused("already grouped"))
    expect(await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))).toEqual(refused("one of those still to judge"))
  })

  test("a dev pass with no file changed since every group passed has every group reviewed again", async ($, on) => {
    const src = Object.fromEntries(FILES.map(f => [f, "x"]))
    const { files } = start(src)
    world(on, files, undefined, { ...RUN, stage: "dev" })
    const devItems = FILES.map(f => `- [x] ${f.slice("E:/proj/".length)}`).join("\n") + "\n"
    await $.agent.spawn(spawn("rein:worker"))
    await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker"))
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    await $.tool.call(write(`${DIR}/agent/review-1.md`, md("통과", ["api.md", "all.md"]), R1))
    await $.tool.call(write(`${DIR}/agent/review-2.md`, md("통과", ["web.md", "all.md"]), R2))
    const key = "runs:proj/login-fix"
    store.set(key, { ...(store.get(key) as object), stage: "dev" })
    await $.agent.spawn(spawn("rein:worker"))
    expect(context(await $.tool.call(write(`${DIR}/agent/dev-items.md`, devItems, "agent-rein:worker-2")))).toContain("Groups to review: 1, 2.")
  })

  test("a failed group without a 원인 line is refused; the groups that failed for 구현 only send the run to dev", async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    expect(await $.tool.call(write(`${DIR}/agent/review-1.md`, md("실패", ["api.md", "all.md"]), R1))).toEqual(refused("a failure needs a `## 실패 원인` section"))
    await $.tool.call(write(`${DIR}/agent/review-1.md`, md("실패", ["api.md", "all.md"], "구현"), R1))
    await $.tool.call(write(`${DIR}/agent/review-2.md`, md("실패", ["web.md", "all.md"], "구현"), R2))
    const s = await status($)
    expect(s).toContain("stage: dev")
    expect(s).toContain(`failFile: ${DIR}/agent/review.md`)
    expect(s).not.toContain("d62:")
  })

  test("one failed group judged 설계 sends the run to plan, whatever the others judged", async ($, on) => {
    const { files, run } = start({})
    world(on, files, undefined, run)
    await $.agent.spawn(spawn("rein:review-splitter"))
    await $.tool.call(write(`${DIR}/agent/review-groups.md`, GROUPS, SPLITTER))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 1"))
    await $.agent.spawn(spawn("rein:reviewer", "묶음 2"))
    await $.tool.call(write(`${DIR}/agent/review-1.md`, md("실패", ["api.md", "all.md"], "구현"), R1))
    const r = await $.tool.call(write(`${DIR}/agent/review-2.md`, md("실패", ["web.md", "all.md"], "설계"), R2))
    expect(context(r)).toContain(`Groups 1, 2 failed; the hook wrote ${DIR}/agent/review.md from them.`)
    expect(context(r)).toContain("D62")
    const s = await status($)
    expect(s).toContain("stage: plan")
    expect(s).toContain("d62: the revised 2-plan.md waits for approval")
    expect(s).toContain(`failFile: ${DIR}/agent/review.md`)
  })
})

describe("split review pieces", () => {
  test("planRanges: each item's lines, past fenced headings, and 영향 범위", () => {
    const plan = "## 상세 설계\n\n### src/a.ts\n\n```diff\n### not a heading\n```\n\n### src/b.ts\n\n- x\n\n## 영향 범위\n\n없음\n"
    const r = planRanges(plan, "E:/proj")
    expect(r.items).toEqual([
      { path: "E:/proj/src/a.ts", from: 3, to: 8 },
      { path: "E:/proj/src/b.ts", from: 9, to: 12 },
    ])
    expect(r.impact).toEqual({ from: 13, to: 16 })
  })

  test("parseGroups takes backticked and relative paths and ignores other lines", () => {
    const text = "## 묶음 1: 서버\n\n- `src/a.ts`\n- E:/proj/src/b.ts\n\n같은 컬럼을 바꿈\n"
    expect(parseGroups(text, ["E:/proj/src/a.ts", "E:/proj/src/b.ts"], "E:/proj")).toEqual({ ok: true, groups: [{ title: "서버", files: ["E:/proj/src/a.ts", "E:/proj/src/b.ts"] }] })
    expect(parseGroups("없음\n", ["E:/proj/src/a.ts"], "E:/proj")).toEqual({ ok: false, reason: "it has no `## 묶음 1: <title>` heading." })
  })

  test("pendingGroups: no verdict, or a pass whose file changed since", () => {
    const run = {
      sealed: { "E:/proj/a": "1", "E:/proj/b": "2", "E:/proj/c": "3" },
      reviewGroups: [
        { title: "x", files: ["E:/proj/a"], verdict: { pass: true, seal: { "E:/proj/a": "1" } } },
        { title: "y", files: ["E:/proj/b"], verdict: { pass: true, seal: { "E:/proj/b": "0" } } },
        { title: "z", files: ["E:/proj/c"] },
      ],
    } as unknown as Run
    expect(pendingGroups(run)).toEqual([2, 3])
  })
})
