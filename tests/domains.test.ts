import { describe, expect, test } from "claude-code/testing"
import { knowledgeDescription, knowledgeIndex } from "../hooks/lib/knowledge.ts"
import { relay, DIR, grade, REIN, SPEC_TEXT, spawned, world } from "./world.ts"

// Domain rules in a folder under rules/ and domain knowledge under
// knowledge/<domain>/, listed for the agents that get it.

const RULES = `${REIN}/rules`
const KNOW = `${REIN}/knowledge`
const FILES = ["E:/proj/src/login.ts"]
const OPEN = { tool: "mcp__rein__open_run", runId: "login-fix" } as never
const ADVANCE = { tool: "mcp__rein__advance" } as never
const STATUS = { tool: "mcp__rein__status" } as never
const DEV_RUN = { v: 2, stage: "dev", runId: "login-fix", rules: [], planFiles: FILES, repos: ["E:/proj"], writes: [], retries: 0 }
const REVIEW_RUN = { ...DEV_RUN, stage: "review", writes: FILES }
const KNOWLEDGE = {
  [`${KNOW}/spring/tx.md`]: "---\ndescription: \"트랜잭션 경계\"\n---\n# tx\n",
  [`${KNOW}/spring/plain.md`]: "# no front matter\n",
  [`${KNOW}/flat.md`]: "---\ndescription: not in a domain folder\n---\n",
  [`${KNOW}/spring/pages/SCHEMA.md`]: "---\ndescription: 화면 지식\n---\n",
  [`${KNOW}/spring/pages/order/order0103/index.md`]: "# 주문순번관리\n",
  [`${KNOW}/spring/raw/a.md`]: "no SCHEMA.md",
}
const INDEX = `- ${KNOW}/spring/pages/: 화면 지식\n- ${KNOW}/spring/plain.md\n- ${KNOW}/spring/raw/\n- ${KNOW}/spring/tx.md: 트랜잭션 경계`

const write = (file_path: string, content: string, agentId?: string) => ({ tool: "Write", file_path, content, agentId }) as never
const read = (file_path: string) => ({ tool: "Read", input: { file_path } }) as never
const spawn = (subagentType: string) => ({ tool_use_id: "t", prompt: "reason", description: subagentType, subagentType }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""

async function status($: { tool: { call: (e: never) => Promise<unknown> } }): Promise<string> {
  return ((await $.tool.call(STATUS)) as { result: string }).result
}

describe("rules in a domain folder (D210)", () => {
  test("open_run freezes rules one folder down, named by their path under rules/", async ($, on) => {
    const files: Record<string, string> = {
      [`${RULES}/api.md`]: "# api\n",
      [`${RULES}/spring/naming.md`]: "---\npaths: src/**\n---\n# naming\n",
      [`${RULES}/web/naming.md`]: "# web naming\n",
      [`${RULES}/spring/deep/x.md`]: "too deep",
      [`${RULES}/spring/notes.txt`]: "not a rule",
    }
    world(on, files, () => "승인", null)
    await $.tool.call(OPEN)
    const load = files[`${DIR}/agent/trace.jsonl`] ?? ""
    expect(load).toContain(`"name":"api","hash":"`)
    expect(load).toContain(`"name":"spring/naming","hash":"`)
    expect(load).toContain(`"name":"web/naming","hash":"`)
    expect(load).not.toContain("deep")
    expect(load).not.toContain("notes")

    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    expect(context(await relay($, ADVANCE))).toContain(`- ${RULES}/spring/naming.md (paths: src/**)`)
  })

  test("open_run freezes the shared rules of ~/.rein/rules too, named rules:<name>", async ($, on) => {
    const SHARED = "C:/Users/u/.rein/rules"
    const files: Record<string, string> = {
      [`${RULES}/api.md`]: "# api\n",
      [`${SHARED}/api.md`]: "---\npaths: src/**\n---\n# shared api\n",
      [`${SHARED}/common/log.md`]: "# log\n",
    }
    world(on, files, () => "승인", null)
    await $.tool.call(OPEN)
    const load = files[`${DIR}/agent/trace.jsonl`] ?? ""
    expect(load).toContain(`"name":"api","hash":"`)
    expect(load).toContain(`"name":"rules:api","hash":"`)
    expect(load).toContain(`"name":"rules:common/log","hash":"`)

    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    const entry = context(await relay($, ADVANCE))
    expect(entry).toContain(`- ${SHARED}/api.md (shared, every repository of the run; paths: src/**)`)
    expect(entry).toContain(`- ${RULES}/api.md (no paths: list, always applies)`)
  })

  test("review names a folder rule by its path under rules/", async ($, on) => {
    const rules = [{ name: "spring/naming", path: `${RULES}/spring/naming.md`, hash: "h", paths: null }]
    world(on, {}, undefined, { ...REVIEW_RUN, rules })
    expect(await status($)).toContain(`- spring/naming.md: ${RULES}/spring/naming.md`)
    await $.agent.spawn(spawn("rein:reviewer"))
    expect(spawned[0]!.prompt).toContain("`spring/naming.md`")
    const review = "## 설계 대조\n\n판정: 통과\n\n## 룰 체크\n\n- `spring/naming.md` — 판정: 통과\n\n## 정확성\n\n판정: 통과\n"
    await $.tool.call(write(`${DIR}/agent/review.md`, review, "agent-rein:reviewer"))
    expect(await status($)).toContain("stage: qa")
  })
})

describe("domain knowledge (D211)", () => {
  test("the plan entry and status's index file list each domain's files and folders, not loose files or what a folder holds", async ($, on) => {
    const files: Record<string, string> = { ...KNOWLEDGE }
    world(on, files, () => "승인", null)
    await $.tool.call(OPEN)
    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    const entry = context(await relay($, ADVANCE))
    expect(entry).toContain("Domain knowledge (D211)")
    expect(entry).toContain("give this list to rein:test-planner")
    expect(entry).toContain(INDEX)
    expect(entry).not.toContain("flat.md")
    expect(entry).toContain("A path ending in / is a folder (D212)")
    expect(entry).not.toContain("order0103")
    expect(entry).not.toContain("a.md")
    // status names the file that holds the index instead of repeating it.
    const shown = await status($)
    expect(shown).not.toContain(INDEX)
    expect(shown).toContain(`Domain knowledge (D211): 4 files and folders, each with its description, listed in ${DIR}/agent/knowledge.md.`)
    expect(files[`${DIR}/agent/knowledge.md`]).toContain(INDEX)
    expect(files[`${DIR}/agent/knowledge.md`]).toContain("The main session, rein:sketcher, rein:worker, rein:arbiter and rein:test-planner use it.")
    // a knowledge file added later reaches the index at the next status.
    files[`${KNOW}/spring/new.md`] = "---\ndescription: 새 지식\n---\n"
    expect(await status($)).toContain("5 files and folders")
    expect(files[`${DIR}/agent/knowledge.md`]).toContain(`- ${KNOW}/spring/new.md: 새 지식`)
  })

  test("the worker and the arbiter get the index", async ($, on) => {
    world(on, { ...KNOWLEDGE }, undefined, DEV_RUN)
    await $.agent.spawn(spawn("rein:worker"))
    await $.agent.spawn(spawn("rein:arbiter"))
    expect(spawned[0]!.prompt).toContain("it never widens the design")
    expect(spawned[0]!.prompt).toContain(INDEX)
    expect(spawned[1]!.prompt).toContain("what the domain (a framework, a library) allows")
    expect(spawned[1]!.prompt).toContain(INDEX)
  })

  test("the reviewer does not get the index", async ($, on) => {
    world(on, { ...KNOWLEDGE }, undefined, REVIEW_RUN)
    await $.agent.spawn(spawn("rein:reviewer"))
    expect(spawned[0]!.prompt).not.toContain("Domain knowledge")
  })

  test("no knowledge folder, no index", async ($, on) => {
    world(on, {}, undefined, DEV_RUN)
    await $.agent.spawn(spawn("rein:worker"))
    expect(spawned[0]!.prompt).not.toContain("Domain knowledge")
    expect(await status($)).not.toContain("Domain knowledge")
  })

  test("knowledge reads without a prompt while a run is open", async ($, on) => {
    world(on, { ...KNOWLEDGE }, undefined, DEV_RUN)
    const allow = expect.objectContaining({ decision: "allow" })
    expect(await $.tool.check(read(`${KNOW}/spring/tx.md`))).toEqual(allow)
    expect(await $.tool.check(read(`${KNOW}/spring/pages/order/order0103/index.md`))).toEqual(allow)
    expect(await $.tool.check({ tool: "Grep", input: { pattern: "x", path: KNOW } } as never)).toEqual(allow)
    expect(await $.tool.check(read(`${KNOW}/../rules/api.md`))).toEqual({ decision: "ask" })
    expect(await $.tool.check({ tool: "Write", input: { file_path: `${KNOW}/spring/tx.md`, content: "x" } } as never)).toEqual({ decision: "ask" })
  })

  test("knowledge reads ask when no run is open", async ($, on) => {
    world(on, { ...KNOWLEDGE }, undefined, null)
    expect(await $.tool.check(read(`${KNOW}/spring/tx.md`))).toEqual({ decision: "ask" })
  })

  test("knowledge is not a slug", async ($, on) => {
    world(on, {}, undefined, null)
    expect(await $.tool.call({ tool: "mcp__rein__open_run", runId: "knowledge" } as never)).toEqual(
      expect.objectContaining({ deny: expect.stringContaining("D144") }),
    )
  })

  test("the description is the front matter's description: line, unquoted", () => {
    expect(knowledgeDescription("---\ndescription: 'a b'\n---\n")).toBe("a b")
    expect(knowledgeDescription("---\ntitle: x\n---\ndescription: body\n")).toBeNull()
    expect(knowledgeDescription("description: no front matter\n")).toBeNull()
    expect(knowledgeIndex([], "use")).toBeUndefined()
  })
})
