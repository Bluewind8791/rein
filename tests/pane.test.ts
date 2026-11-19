import { describe, expect } from "claude-code/testing"
import { chip, fmtDur, frameState, frameStatus, progressView, type FrameStatus } from "../hooks/lib/pane.ts"
import type { Run } from "../hooks/lib/state.ts"
import { relay, DIR, gates, ran, REIN, SPEC_TEXT, world, type Host, test } from "./world.ts"

// the frame. From when a run opens or is picked back up until it leaves
// active, the hook writes the run's status to agent/frame.json in the run
// folder, in every session, and makes sure the frame server runs: as the run
// opens, is picked back up and enters a stage, never on every call. Its URL
// is told to the main session once as the run opens or is picked back up,
// and again only when a stage's ensure started the server.

const FRAME = `${DIR}/agent/frame.json`
const URL = "http://127.0.0.1:7357/"

const status = (files: Record<string, string>): FrameStatus => JSON.parse(files[FRAME]!) as FrameStatus

const RUN = (over: Partial<Run> = {}): Run => ({ v: 2, stage: "dev", runId: "login-fix", rules: [], writes: [], retries: 0, ...over }) as Run

const ACT = (over = {}) => ({ tool: "Bash", count: 1, running: false, end: "ok" as const, since: 0, until: 1234, ...over })

const open = (h: { tool: { call: (e: never) => Promise<unknown> } }) => h.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)

// the frame server's ensure as the hook ran it.
const ensures = () => ran.filter(r => r.argv[0] === "node")

// a frame server that answers ensure as `started` says.
const server = (started: boolean): Host => ({
  run: (argv: string[]) => (argv[0] === "node" ? { exitCode: 0, stdout: `${JSON.stringify({ url: URL, started })}\n` } : { exitCode: 0 }),
})

describe("the run's status for the frame", () => {
  test("opening a run writes frame.json in its folder, in any session", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null)
    await open($)
    const s = status(files)
    expect(s).toMatchObject({ runId: "login-fix", stage: "spec", state: "run" })
    expect(typeof s.updated).toBe("number")
    expect(s.view.stages.slice(0, 2)).toEqual([{ name: "spec", tone: "now" }, { name: "plan", tone: "wait" }])
  })

  test("a change to the run rewrites frame.json", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null)
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    expect(status(files).view.pills).toEqual([])
    // the grader the hook records is one change to the run.
    await $.agent.spawn({ tool_use_id: "g", prompt: "grade", description: "grade", subagentType: "rein:grader", background: true } as never)
    expect(status(files).view.pills.map(p => p.name)).toEqual(["grader"])
  })

  test("a stage the call moved is written as moved", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null)
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)
    expect(status(files)).toMatchObject({ stage: "plan", state: "run" })
  })

  test("the main session's question to the person is written as waiting for them", async ($, on) => {
    const files: Record<string, string> = {}
    let seen: string | undefined
    world(on, files, () => {
      seen = status(files).state
      return "네"
    }, null)
    await open($)
    await $.tool.call({ tool: "AskUserQuestion", questions: [{ question: "어느 쪽?", options: [] }] } as never)
    expect(seen).toBe("ask")
    expect(status(files).state).toBe("run")
  })

  test("once the run left active nothing is written in its old folder", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => "보류", null)
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    await relay($, { tool: "mcp__rein__park", reason: "나중에 이어서 하자고 함" } as never)
    expect(files[FRAME]).toBeUndefined()
    await $.tool.call({ tool: "Read", file_path: `${REIN}/defer/login-fix/1-spec.md` } as never)
    expect(Object.keys(files).filter(f => f.startsWith(`${DIR}/`))).toEqual([])
  })

  test("resume writes frame.json again", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/defer/old-run/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "이어서 진행", null, {
      store: { "runs:proj/old-run": { v: 2, stage: "dev", runId: "old-run", status: "defer", rules: [], writes: [], retries: 0 } },
    })
    await relay($, { tool: "mcp__rein__resume", runId: "old-run" } as never)
    const s = JSON.parse(files[`${REIN}/active/old-run/agent/frame.json`]!) as FrameStatus
    expect(s).toMatchObject({ runId: "old-run", stage: "dev", state: "run" })
  })
})

describe("the frame server", () => {
  test("opening a run makes sure of it, and a server it started is told with the URL", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null, server(true))
    const r = (await open($)) as { result: string }
    expect(ensures().map(x => [x.argv[0], x.argv[1]!.endsWith("/frame/server.js"), x.argv[2]])).toEqual([["node", true, "ensure"]])
    expect(r.result).toContain(URL)
  })

  test("a server that was running already is told as the run opens, and not again as it moves on", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null, server(false))
    const r = (await open($)) as { result: string }
    expect(ensures()).toHaveLength(1)
    expect(r.result).toContain(URL)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    const moved = (await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)) as { result: string }
    expect(ensures()).toHaveLength(2)
    expect(moved.result).not.toContain(URL)
  })

  test("a server that cannot start does not stop the run opening", async ($, on) => {
    const files: Record<string, string> = {}
    const run = (argv: string[]) => {
      if (argv[0] === "node") throw new Error("spawn node ENOENT")
      return { exitCode: 0 }
    }
    world(on, files, () => undefined, null, { run })
    const r = (await open($)) as { result: string }
    expect(r.result).toContain("Run opened.")
    expect(status(files).runId).toBe("login-fix")
  })

  test("calls within a stage do not run it again; entering a stage does", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null, server(false))
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    await $.tool.call({ tool: "Read", file_path: `${DIR}/1-spec.md` } as never)
    await $.tool.call({ tool: "mcp__rein__status" } as never)
    expect(ensures()).toHaveLength(1)
    await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)
    expect(ensures()).toHaveLength(2)
  })

  test("a server started as the stage moved is told in that result, once", async ($, on) => {
    const files: Record<string, string> = {}
    let started = false
    world(on, files, () => undefined, null, {
      run: (argv: string[]) => (argv[0] === "node" ? { exitCode: 0, stdout: JSON.stringify({ url: URL, started }) } : { exitCode: 0 }),
    })
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    started = true
    const r = (await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)) as { result: string }
    expect(r.result).toContain(URL)
    const again = (await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }
    expect(again.result).not.toContain(URL)
  })

  // claude --resume of a session that holds its run: no tool opens it again.
  test("a session starting with its run open takes the frame up again, and a server it started is told with the next Rein result", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, { v: 2, stage: "dev", runId: "login-fix", rules: [], writes: [], retries: 0 }, server(true))
    on("session.start", async (_$, e) => ({ cwd: e.cwd }))
    on("tool.register", async (_$, e) => ({ value: { tool: `mcp__rein__${e.name}` } }))
    await $.session.start({ cwd: "D:/proj", surface: null, isInteractive: true })
    expect(status(files)).toMatchObject({ runId: "login-fix", stage: "dev", state: "run" })
    expect(ensures()).toHaveLength(1)
    const r = (await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }
    expect(r.result).toContain(URL)
    expect(ensures()).toHaveLength(1)
  })

  test("a session starting without a run writes nothing and starts no server", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => undefined, null, server(true))
    on("session.start", async (_$, e) => ({ cwd: e.cwd }))
    on("tool.register", async (_$, e) => ({ value: { tool: `mcp__rein__${e.name}` } }))
    await $.session.start({ cwd: "D:/proj", surface: null, isInteractive: true })
    expect(Object.keys(files).filter(f => f.endsWith("/frame.json"))).toEqual([])
    expect(ensures()).toEqual([])
  })

  test("resume makes sure of it", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/defer/old-run/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "이어서 진행", null, {
      ...server(true),
      store: { "runs:proj/old-run": { v: 2, stage: "dev", runId: "old-run", status: "defer", rules: [], writes: [], retries: 0 } },
    })
    const r = (await relay($, { tool: "mcp__rein__resume", runId: "old-run" } as never)) as { result: string }
    expect(ensures()).toHaveLength(1)
    expect(r.result).toContain(URL)
  })
})

describe("the activity chip (U79, D202)", () => {
  test("the chip is the tool, its count in a row, how long it took and how it ended", async () => {
    // zoetrope's form: the hammer stands, the mark comes after, a run of the
    // same tool shows its count and a single call the time it took.
    expect(chip(ACT({ running: true, count: 5 }))).toBe("⚒ Bash ×5")
    expect(chip(ACT({ count: 5 }))).toBe("⚒ Bash ×5 ✓")
    expect(chip(ACT())).toBe("⚒ Bash 1.2s ✓")
    expect(chip(ACT({ tool: "Read", end: "error" as const }))).toBe("⚒ Read 1.2s ✗")
    expect(chip(ACT({ tool: "Read", end: "deny" as const, rule: "D175" }))).toBe("⚒ Read 1.2s ⊘ D175")
  })

  test("a duration is written as zoetrope writes it", async () => {
    expect([847, 1234, 42_000, 123_000].map(fmtDur)).toEqual(["847ms", "1.2s", "42s", "2m3s"])
  })

  // the grader reads 1-spec.md, which leaves it on the run (a grade.md
  // spends the grader, so its pill would be gone).
  const READING = (agentId: string | undefined, file = "1-spec.md") => ({ tool: "Read", file_path: `${DIR}/${file}`, agentId })
  const spawnGrader = async ($: { agent: { spawn: (e: never) => Promise<unknown> } }) =>
    ((await $.agent.spawn({ tool_use_id: "g", prompt: "grade", description: "grade", subagentType: "rein:grader", background: true } as never)) as { agentId?: string }).agentId

  // a run opened, so the hook writes frame.json.
  const opened = async ($: { tool: { call: (e: never) => Promise<unknown> } }, on: Parameters<typeof world>[0], files: Record<string, string>, host: Host = {}) => {
    world(on, files, () => undefined, null, host)
    await open($)
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
  }
  const pill = (files: Record<string, string>, name: string) => status(files).view.pills.find(p => p.name === name)

  test("a finished call settles the chip on the agent's pill", async ($, on) => {
    const files: Record<string, string> = {}
    await opened($, on, files)
    await $.tool.call(READING(await spawnGrader($)) as never)
    expect(pill(files, "grader")).toMatchObject({ pulse: true, end: "ok" })
    expect(pill(files, "grader")?.chip).toMatch(/^⚒ Read \d+ms ✓$/)
  })

  test("a call that errored marks the chip", async ($, on) => {
    const files: Record<string, string> = {}
    await opened($, on, files, { call: (tool: string) => (tool === "Read" ? { isError: true, result: "no such file", text: "no such file" } : undefined) })
    await $.tool.call(READING(await spawnGrader($)) as never)
    expect(pill(files, "grader")).toMatchObject({ end: "error" })
    expect(pill(files, "grader")?.chip).toMatch(/^⚒ Read \d+ms ✗$/)
  })

  // The chip hook wraps the one that judges, so what Rein refused is shown
  // too, with the rule it was refused by.
  test("a call Rein refused is shown with its rule", async ($, on) => {
    const files: Record<string, string> = {}
    await opened($, on, files)
    files[`${DIR}/2-plan.md`] = "x"
    const out = (await $.tool.call(READING(await spawnGrader($), "2-plan.md") as never)) as { deny?: string }
    expect(out.deny).toContain("D175")
    expect(pill(files, "grader")).toMatchObject({ end: "deny" })
    expect(pill(files, "grader")?.chip).toMatch(/^⚒ Read \d+ms ⊘ D175$/)
  })

  test("the main session's own call takes the first pill, which does not breathe", async ($, on) => {
    const files: Record<string, string> = {}
    await opened($, on, files)
    await $.tool.call({ tool: "Read", file_path: `${DIR}/1-spec.md` } as never)
    expect(status(files).view.pills[0]).toMatchObject({ id: "main", name: "main", pulse: false, end: "ok" })
  })

  test("a call in flight is shown running, its time left to the page's clock", async ($, on) => {
    const files: Record<string, string> = {}
    let release = () => {}
    let began = () => {}
    const reached = new Promise<void>(r => (began = r))
    await opened($, on, files, { call: (tool: string) => (tool === "Read" ? (began(), undefined) : undefined) })
    const agentId = await spawnGrader($)
    gates[`${DIR}/1-spec.md`] = new Promise<void>(r => (release = r))
    const slow = $.tool.call(READING(agentId) as never)
    await reached
    const p = pill(files, "grader")
    expect(p?.chip).toBe("⚒ Read")
    expect(typeof p?.since).toBe("number")
    expect(p?.end).toBeUndefined()
    release()
    await slow
    delete gates[`${DIR}/1-spec.md`]
    expect(pill(files, "grader")?.since).toBeUndefined()
    expect(pill(files, "grader")?.chip).toMatch(/^⚒ Read \d+ms ✓$/)
  })
})

describe("what the frame shows", () => {
  test("the chain: passed, the one the run is in, still to come", async () => {
    const v = progressView(RUN(), new Map())
    expect(v.runId).toBe("login-fix")
    expect(v.stages).toEqual([
      { name: "spec", tone: "done" },
      { name: "plan", tone: "done" },
      { name: "dev", tone: "now" },
      { name: "review", tone: "wait" },
      { name: "qa", tone: "wait" },
      { name: "e2e", tone: "wait" },
      { name: "land", tone: "wait" },
    ])
  })

  test("a halted run marks the stage it is in, and says so", async () => {
    const v = progressView(RUN({ stage: "qa-integration", halt: { rule: "D173", reason: "x" } }), new Map())
    expect(v.stages[5]).toEqual({ name: "e2e", tone: "bad" })
    expect(v.marks).toEqual(["멈춤 D173"])
  })

  test("what the run already knows, in its own words", async () => {
    expect(progressView(RUN({ retries: 2, d62: true }), new Map()).marks).toEqual(["설계 문제"])
  })

  test("a run stopped for the main session's decision shows the stop, and no count", async () => {
    const marks = progressView(RUN({ stage: "review", retries: 5, halt: { rule: "failure-route", reason: "stopped", file: "f.md" } }), new Map()).marks
    expect(marks).toContain("멈춤 failure-route")
    expect(marks.some(m => m.includes("재시도"))).toBe(false)
  })

  test("a pill per agent of the stage, the main session's first", async () => {
    const acts = new Map([
      ["main", ACT({ tool: "Read" })],
      ["agent-1", ACT({ count: 3, running: true })],
    ])
    const v = progressView(RUN({ worker: "agent-1", reviewer: "agent-2" }), acts)
    expect(v.pills).toEqual([
      { id: "main", name: "main", pulse: false, chip: "⚒ Read 1.2s ✓", end: "ok" },
      // a run of calls in flight shows its count, and no clock.
      { id: "agent-1", name: "worker", pulse: true, chip: "⚒ Bash ×3" },
      { id: "agent-2", name: "reviewer", pulse: true },
    ])
  })
})

describe("the run's worktrees", () => {
  test("frame.json names each repository the run works in, its branch and where it started", async () => {
    const trees = [
      { repo: "D:/a", path: "D:/a/.claude/worktrees/login-fix", branch: "rein/login-fix", start: "main", root: true as const },
      { repo: "D:/b", path: "D:/b/.claude/worktrees/login-fix", branch: "rein/login-fix", start: null },
    ]
    expect(frameStatus(RUN({ trees }), new Map(), 1).trees).toEqual([
      { repo: "D:/a", branch: "rein/login-fix", start: "main" },
      { repo: "D:/b", branch: "rein/login-fix", start: null },
    ])
    expect(frameStatus(RUN(), new Map(), 1).trees).toEqual([])
  })
})

describe("the run's state", () => {
  test("halted while it is halted or has a design problem", async () => {
    expect(frameState(RUN({ halt: { rule: "D173", reason: "x" } }), new Map())).toBe("halt")
    expect(frameState(RUN({ d62: true }), new Map())).toBe("halt")
  })

  test("waiting for the person while spec or plan stopped for their approval", async () => {
    expect(frameState(RUN({ stage: "plan", waits: { stage: "plan", hash: "h" } }), new Map())).toBe("ask")
    // a mark left from a stage the run has left is no wait.
    expect(frameState(RUN({ waits: { stage: "plan", hash: "h" } }), new Map())).toBe("run")
  })

  test("waiting for the person while integration qa waits for their test, or an ego check is in their hands", async () => {
    expect(frameState(RUN({ stage: "qa-integration", e2e: { path: "wait" } }), new Map())).toBe("ask")
    const handed = { name: "c", minutes: 5, spent: 0, ego: { profile: "p", space: "s", handoff: "로그인해 주세요" } }
    expect(frameState(RUN({ stage: "qa-integration", e2e: { path: "ego", checks: [handed] as never } }), new Map())).toBe("ask")
    expect(frameState(RUN({ stage: "qa-integration", e2e: { path: "ego", checks: [{ ...handed, ego: { ...handed.ego, resumed: true } }] as never } }), new Map())).toBe("run")
  })

  test("waiting for the person while the main session's question is open, going on otherwise", async () => {
    expect(frameState(RUN(), new Map([["main", ACT({ tool: "AskUserQuestion", running: true })]]))).toBe("ask")
    expect(frameState(RUN(), new Map([["main", ACT({ tool: "AskUserQuestion" })]]))).toBe("run")
    expect(frameState(RUN(), new Map([["agent-1", ACT({ tool: "AskUserQuestion", running: true })]]))).toBe("run")
  })
})
