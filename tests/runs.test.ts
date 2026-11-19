import { describe, expect } from "claude-code/testing"
import { sha256Text } from "../hooks/lib/hash.ts"
import { relay, DIR, REIN, SESSION, SPEC_TEXT, clock, moves, renames, store, world, type Host, test } from "./world.ts"

// Run states and their folders, the slug-keyed record a session
// points to, park, resume and the v0.2.0 keys.

const PARK = (reason = "사용자가 요구사항이 취소됐다고 함") => ({ tool: "mcp__rein__park", reason }) as never
const RESUME = (runId: string) => ({ tool: "mcp__rein__resume", runId }) as never
const STATUS = { tool: "mcp__rein__status" } as never
const OPEN = (runId: string) => ({ tool: "mcp__rein__open_run", runId }) as never
const DEFER = `${REIN}/defer/login-fix`
const DROP = `${REIN}/drop/login-fix`
const refused = (text: string) => expect.objectContaining({ deny: expect.stringContaining(text) })
// a gate called without the user's answer says what to ask; it refuses nothing.
const asks = (text: string) => expect.objectContaining({ result: expect.stringContaining(text) })
const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) =>
  ((await $.tool.call(STATUS)) as { result: string }).result
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""

// A run another session left: its record, and its folder in `state`.
const OLD = { v: 2, stage: "land", runId: "old-run", rules: [], writes: [], retries: 0, landRepos: ["E:/proj"], heads: { "E:/proj": "h0" } }
const oldFiles = (state: string) => ({ [`${REIN}/${state}/old-run/1-spec.md`]: "# 리뷰 상세 블록 삭제\n\n## 완료 판정\n\nx\n", [`${REIN}/${state}/old-run/6-land.md`]: "msg" })

describe("park", () => {
  test("보류 moves the folder to defer/, keeps the record without an owner and frees the session", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, q => (questions.push(q), "보류"), { stage: "dev", runId: "login-fix" })
    const r = await relay($, PARK("나중에 이어서 하자고 함\n`rm -rf`"))
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining(`The user put the run aside (보류). Its folder is now ${DEFER}`) }))
    expect(questions[0]).toContain("run login-fix(dev 단계)을 멈출까요?")
    expect(questions[0]).toContain("> 나중에 이어서 하자고 함\n> 'rm -rf'")
    expect(files[`${DEFER}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(files[`${DIR}/1-spec.md`]).toBeUndefined()
    expect(files[`${DEFER}/agent/trace.jsonl`]).toContain(`"ev":"park","stage":"dev","answer":"보류"`)
    expect(files[`${DEFER}/agent/trace.jsonl`]).toContain(`"state":"defer"`)
    expect(await status($)).toBe("No Rein run is open in this session.\nResumable runs of this project (mcp__rein__resume with the runId; the user confirms):\n- login-fix: spec (stage dev, deferred)")
    // No run: writes go through, and a new run can open.
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(OPEN("next-task"))).toEqual(expect.objectContaining({ result: expect.stringContaining("Run opened") }))
  })

  test("폐기 moves the folder to drop/ and removes the record", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "폐기", { stage: "qa", runId: "login-fix" })
    const r = await relay($, PARK("조사해 보니 버그가 아니었음"))
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining(`The user dropped the run (폐기). Its record stays in ${DROP}.`) }))
    expect(files[`${DROP}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(files[`${DROP}/agent/trace.jsonl`]).toContain(`"ev":"park","stage":"qa","answer":"폐기","reason":"조사해 보니 버그가 아니었음","state":"drop"`)
    expect(await status($)).toBe("No Rein run is open in this session.")
    expect(await relay($, RESUME("login-fix"))).toEqual(refused("D147: login-fix is not a run this session can resume. This project has none."))
    // The slug stays taken.
    expect(await $.tool.call(OPEN("login-fix"))).toEqual(refused(`D58: ${DROP} already exists`))
  })

  test("완료 moves the folder to complete/ as a run done outside Rein (D183)", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "완료 (Rein 밖에서 반영함)"), { stage: "review", runId: "login-fix" })
    const r = await relay($, PARK("사용자가 직접 커밋해 운영까지 반영함"))
    expect(questions[0]).toContain("완료: Rein 밖에서(직접 커밋 등) 이미 반영했으니 run을 끝난 것으로 닫습니다.")
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining(`The user closed the run as done outside Rein (완료, D183). Its record is in ${REIN}/complete/login-fix.`) }))
    expect(files[`${REIN}/complete/login-fix/1-spec.md`]).toBe(SPEC_TEXT)
    expect(files[`${REIN}/complete/login-fix/agent/trace.jsonl`]).toContain(`"ev":"park","stage":"review","answer":"완료 (Rein 밖에서 반영함)"`)
    expect(await status($)).toBe("No Rein run is open in this session.")
  })

  test("계속 진행 and no answer change nothing", async ($, on) => {
    let answer: string | undefined = "계속 진행"
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => answer, { stage: "review", runId: "login-fix" })
    expect(await relay($, PARK())).toEqual(refused("D146: the run is not stopped. It stays open in review"))
    answer = undefined
    expect(await relay($, PARK())).toEqual(asks("D146: this needs a decision; nothing changed."))
    expect(moves).toEqual([])
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(await status($)).toContain("stage: review")
  })

  test("refused while a judgment runs commands, before asking; with no run; without a reason", async ($, on) => {
    let asked = false
    world(on, { [`${DIR}/1-spec.md`]: SPEC_TEXT }, () => ((asked = true), "폐기"), { stage: "qa", runId: "login-fix", busy: { what: "qa.md", at: 0 } })
    expect(await relay($, PARK())).toEqual(refused("D146: the hook is running a judgment's commands (qa.md)"))
    expect(await relay($, PARK(" "))).toEqual(refused("D146: give the reason"))
    expect(asked).toBe(false)
    expect(moves).toEqual([])
  })

  test("with no run open there is nothing to park", async ($, on) => {
    world(on, {}, () => "폐기", null)
    expect(await relay($, PARK())).toEqual(refused("D146: this session has no run open"))
  })

  test("a folder that cannot move refuses the change and leaves the run as it was (D144)", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "폐기", { stage: "dev", runId: "login-fix" }, { move: () => false })
    expect(await relay($, PARK())).toEqual(refused("D144: the run folder could not be moved (The process cannot access the file because it is being used by another process.), so nothing changed; the run stays open in dev."))
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(await status($)).toContain("stage: dev")
  })

  test("the move runs PowerShell with the paths in the environment on Windows, mv elsewhere", async ($, on) => {
    world(on, { [`${DIR}/1-spec.md`]: SPEC_TEXT }, () => "보류", { stage: "dev", runId: "login-fix" })
    await relay($, PARK())
    expect(moves[0]!.argv.slice(0, 4)).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"])
    expect(moves[0]!.argv[4]).toContain("[IO.Directory]::Move($env:REIN_FROM, $env:REIN_TO)")
    expect(moves[0]!.argv.join(" ")).not.toContain(DIR)
    expect(moves[0]).toEqual(expect.objectContaining({ from: DIR, to: DEFER }))
  })
})

describe("resume", () => {
  test("a deferred run: the person confirms, the folder comes back to active/, session-bound fields go, heads stay", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = oldFiles("defer")
    const record = { ...OLD, status: "defer", busy: { what: "x", at: 1 } }
    world(on, files, q => (questions.push(q), "이어서 진행"), null, { store: { "runs:proj/old-run": record } })
    expect(await status($)).toContain("- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)")
    const r = await relay($, RESUME("old-run"))
    expect(r).toEqual(expect.objectContaining({ result: `Resumed old-run in this session. The run is in the land stage; its folder is ${REIN}/active/old-run.` }))
    expect(context(r)).toContain("D147: invoke the rein:land skill to carry on.")
    expect(questions[0]).toContain("run: old-run\n단계: land (보류됨)")
    expect(questions[0]).toContain("> 리뷰 상세 블록 삭제")
    expect(questions[0]).not.toContain("주의")
    expect(files[`${REIN}/active/old-run/6-land.md`]).toBe("msg")
    expect(files[`${REIN}/defer/old-run/6-land.md`]).toBeUndefined()
    expect(files[`${REIN}/active/old-run/agent/trace.jsonl`]).toContain(`"ev":"resume","stage":"land","from":"defer","session":"${SESSION}"`)
    const shown = await status($)
    expect(shown).toContain("stage: land")
    expect(shown).toContain("- E:/proj: h0")
    // The busy token went with the old session: park is asked, not refused.
    expect(await relay($, PARK())).toEqual(refused(`D146: answer takes one of "보류", "폐기", "완료 (Rein 밖에서 반영함)", "계속 진행", and "이어서 진행" is none of them, so nothing changed.`))
  })

  test("a run parked before the files were numbered: resume copies each old file to its new name, the old ones stay", async ($, on) => {
    const base = `${REIN}/defer/old-run`
    const files: Record<string, string> = {
      [`${base}/spec.md`]: "# 리뷰 상세 블록 삭제\n\n## 완료 판정\n\nx\n",
      [`${base}/land.md`]: "old msg",
      [`${base}/6-land.md`]: "msg",
      [`${base}/qa-integration.md`]: "## e2e",
    }
    world(on, files, () => "이어서 진행", null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    expect(await status($)).toContain("- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)")
    await relay($, RESUME("old-run"))
    const active = `${REIN}/active/old-run`
    expect(files[`${active}/1-spec.md`]).toBe(files[`${active}/spec.md`])
    expect(files[`${active}/agent/e2e.md`]).toBe("## e2e")
    // a file already under its new name is not overwritten.
    expect(files[`${active}/6-land.md`]).toBe("msg")
    expect(files[`${active}/land.md`]).toBe("old msg")
  })

  test("a run parked when every file was numbered: resume copies the files no one reads to their names without the number", async ($, on) => {
    const base = `${REIN}/defer/old-run`
    const files: Record<string, string> = {
      [`${base}/1-spec.md`]: "# 리뷰 상세 블록 삭제\n\n## 완료 판정\n\nx\n",
      [`${base}/1-spec.html`]: "<html>",
      [`${base}/dev.md`]: "- [x] old",
      [`${base}/3-dev-items.md`]: "- [x] src/a.ts",
      [`${base}/3-dev.md`]: "# dev diff",
      [`${base}/4-review.md`]: "판정: 실패",
    }
    world(on, files, () => "이어서 진행", null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    await relay($, RESUME("old-run"))
    const active = `${REIN}/active/old-run`
    expect(files[`${active}/1-mockup.html`]).toBe("<html>")
    // the numbered name is the newer one: dev.md, from before, does not win.
    expect(files[`${active}/agent/dev-items.md`]).toBe("- [x] src/a.ts")
    expect(files[`${active}/agent/dev-diff.md`]).toBe("# dev diff")
    expect(files[`${active}/agent/review.md`]).toBe("판정: 실패")
    expect(files[`${active}/4-review.md`]).toBe("판정: 실패")
  })

  test("a run parked before agent/: resume copies the files no one reads into agent/, the old ones stay", async ($, on) => {
    const base = `${REIN}/defer/old-run`
    const files: Record<string, string> = {
      [`${base}/1-spec.md`]: "# 리뷰 상세 블록 삭제\n\n## 완료 판정\n\nx\n",
      [`${base}/5-qa.md`]: "old qa",
      [`${base}/qa.md`]: "qa",
      [`${base}/qa-output.log`]: "log",
      [`${base}/review-groups.md`]: "# 1. 서버",
      [`${base}/review-1.md`]: "판정: 통과",
      [`${base}/review-2.md`]: "판정: 실패",
      [`${base}/evidence/ego-guide.md`]: "guide",
    }
    world(on, files, () => "이어서 진행", null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    await relay($, RESUME("old-run"))
    const active = `${REIN}/active/old-run`
    // the name without the number is the newer one.
    expect(files[`${active}/agent/qa.md`]).toBe("qa")
    expect(files[`${active}/agent/qa-output.log`]).toBe("log")
    expect(files[`${active}/agent/review-groups.md`]).toBe("# 1. 서버")
    expect(files[`${active}/agent/review-1.md`]).toBe("판정: 통과")
    expect(files[`${active}/agent/review-2.md`]).toBe("판정: 실패")
    expect(files[`${active}/agent/evidence/ego-guide.md`]).toBe("guide")
    expect(files[`${active}/qa.md`]).toBe("qa")
  })

  test("another session's active run: the question warns; the old session is told it lost the run", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = oldFiles("active")
    world(on, files, q => (questions.push(q), "이어서 진행"), null, {
      store: { "runs:proj/old-run": { ...OLD, stage: "qa-integration", status: "active", owner: "s0", e2e: { path: "aside", command: "x", running: true } }, "session:s0": { project: "proj", runId: "old-run" } },
    })
    expect(await status($)).toContain("- old-run: 리뷰 상세 블록 삭제 (stage qa-integration, active in another session)")
    const r = await relay($, RESUME("old-run"))
    expect(context(r)).toContain("invoke the rein:qa skill")
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining("The session that held it no longer does; tell the user.") }))
    expect(questions[0]).toContain("단계: qa-integration (다른 세션에서 진행 중)")
    expect(questions[0]).toContain("주의: 이 run은 다른 세션이 연 채로 남아 있습니다")
    expect(moves).toEqual([])
    // The old session's aside run is forgotten, so the command may run here.
    expect(await $.tool.call({ tool: "Bash", command: "x", timeout: 600000 } as never)).toEqual(expect.objectContaining({ result: "ok" }))
  })

  // the skill the user types in a new session finds the runs that wait for it.
  test("the list names the skill each run waits for: spec and plan while their file is as it stopped, and the integration wait", async ($, on) => {
    const spec = "# 잠금\n\n## 완료 판정\n\nx\n"
    const files: Record<string, string> = {
      [`${REIN}/active/a-spec/1-spec.md`]: spec,
      [`${REIN}/defer/b-plan/1-spec.md`]: spec,
      [`${REIN}/defer/b-plan/2-plan.md`]: "고친 설계",
      [`${REIN}/active/c-qa/1-spec.md`]: spec,
    }
    const run = (runId: string, rest: Record<string, unknown>) => ({ v: 2, runId, rules: [], writes: [], retries: 0, ...rest })
    world(on, files, () => undefined, null, {
      store: {
        "runs:proj/a-spec": run("a-spec", { stage: "spec", status: "active", owner: "s0", waits: { stage: "spec", hash: await sha256Text(spec) } }),
        "runs:proj/b-plan": run("b-plan", { stage: "plan", status: "defer", waits: { stage: "plan", hash: await sha256Text("처음 설계") } }),
        "runs:proj/c-qa": run("c-qa", { stage: "qa-integration", status: "active", owner: "s0", e2e: { path: "wait" } }),
      },
    })
    const shown = await status($)
    expect(shown).toContain("- a-spec: 잠금 (stage spec, waits for /rein:plan, active in another session)")
    expect(shown).toContain("- b-plan: 잠금 (stage plan, deferred)")
    expect(shown).toContain("- c-qa: 잠금 (stage qa-integration, waits for /rein:land or /rein:e2e, active in another session)")
  })

  test("a session whose run was taken over: its first judged call is refused with the notice, then it has no run (D145)", async ($, on) => {
    // This session (s1) points to a run that s2 now owns.
    const files: Record<string, string> = oldFiles("active")
    world(on, files, () => "폐기", null, {
      store: { "runs:proj/old-run": { ...OLD, status: "active", owner: "s2" }, [`session:${SESSION}`]: { project: "proj", runId: "old-run" } },
    })
    // A read is not judged and leaves the notice for later.
    expect(await $.tool.call({ tool: "Read", file_path: "E:/proj/src/a.ts" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(refused("D145: the run old-run is no longer this session's"))
    expect(files["E:/proj/src/a.ts"]).toBeUndefined()
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    // It is another session's active run now, so this one could take it back.
    expect(await status($)).toContain("No Rein run is open in this session.\nResumable runs of this project (mcp__rein__resume with the runId; the user confirms):\n- old-run: 리뷰 상세 블록 삭제 (stage land, active in another session)")
    expect(await relay($, PARK())).toEqual(refused("D146: this session has no run open"))
    expect(files[`${REIN}/active/old-run/6-land.md`]).toBe("msg")
  })

  test("status is never refused: it carries the notice once, with what it shows (N5)", async ($, on) => {
    world(on, oldFiles("active"), () => undefined, null, {
      store: { "runs:proj/old-run": { ...OLD, status: "active", owner: "s2" }, [`session:${SESSION}`]: { project: "proj", runId: "old-run" } },
    })
    const first = await status($)
    expect(first).toContain("D145: the run old-run is no longer this session's")
    expect(first).toContain("No Rein run is open in this session.")
    expect(await status($)).not.toContain("D145")
  })

  test("the notice refuses the plugin's own tools too, without running them", async ($, on) => {
    let asked = false
    world(on, oldFiles("active"), () => ((asked = true), "승인"), null, {
      store: { "runs:proj/old-run": { ...OLD, status: "active", owner: "s2" }, [`session:${SESSION}`]: { project: "proj", runId: "old-run" } },
    })
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual({ deny: expect.stringMatching(/^D145: the run old-run is no longer this session's: .*This call was refused so nothing ran unchecked/) })
    expect(asked).toBe(false)
    expect(await relay($, { tool: "mcp__rein__advance" } as never)).toEqual(refused("D112: this session has no run open."))
  })

  test("refused while a run is open; an unknown runId or 취소 changes nothing", async ($, on) => {
    let answer = "취소"
    const files: Record<string, string> = { ...oldFiles("defer"), [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => answer, { stage: "plan", runId: "login-fix" }, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    expect(await relay($, RESUME("old-run"))).toEqual(refused("D59: this session already has a run open (login-fix, stage plan); one run per session. Call mcp__rein__park first"))
    answer = "보류"
    await relay($, PARK())
    answer = "취소"
    expect(await relay($, RESUME("nope"))).toEqual(refused("D147: nope is not a run this session can resume. Resumable runs of this project:\n- login-fix: spec (stage plan, deferred)\n- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)"))
    expect(await relay($, RESUME("old-run"))).toEqual(refused("D147: old-run is not resumed. Nothing changed."))
    expect(files[`${REIN}/defer/old-run/6-land.md`]).toBe("msg")
  })
})

describe("open_run", () => {
  test("a slug taken in any state, by a v0.2.0 folder or by a record is refused; state names are refused", async ($, on) => {
    const files: Record<string, string> = {
      [`${REIN}/defer/a/1-spec.md`]: "x",
      [`${REIN}/complete/b/1-spec.md`]: "x",
      [`${REIN}/drop/c/1-spec.md`]: "x",
      [`${REIN}/d/1-spec.md`]: "x",
    }
    world(on, files, undefined, null, { store: { "runs:proj/e": { ...OLD, runId: "e", status: "defer" } } })
    expect(await $.tool.call(OPEN("a"))).toEqual(refused(`D58: ${REIN}/defer/a already exists`))
    expect(await $.tool.call(OPEN("b"))).toEqual(refused(`D58: ${REIN}/complete/b already exists`))
    expect(await $.tool.call(OPEN("c"))).toEqual(refused(`D58: ${REIN}/drop/c already exists`))
    expect(await $.tool.call(OPEN("d"))).toEqual(refused(`D58: ${REIN}/d already exists`))
    expect(await $.tool.call(OPEN("e"))).toEqual(refused("D58: a run named e is already recorded"))
    expect(await $.tool.call(OPEN("defer"))).toEqual(refused("D144: defer names a folder"))
    expect(await $.tool.call(OPEN("rules"))).toEqual(refused("D144: rules names a folder"))
  })

  test("one run per session: a second open_run is refused and points to park (D59)", async ($, on) => {
    world(on, { [`${DIR}/1-spec.md`]: SPEC_TEXT }, undefined, { stage: "dev", runId: "login-fix" })
    expect(await $.tool.call(OPEN("other"))).toEqual(refused("D59: this session already has a run open (login-fix, stage dev). A second run cannot be opened; if the user wants to stop that one, call mcp__rein__park"))
  })

  test("the result lists this project's deferred runs", async ($, on) => {
    world(on, oldFiles("defer"), undefined, null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    const r = await $.tool.call(OPEN("new-one"))
    expect(r).toEqual(expect.objectContaining({ result: `Run opened. runId: new-one. Write the spec to ${REIN}/active/new-one/1-spec.md, the only file this stage may write; rein:sketcher draws ${REIN}/active/new-one/1-mockup.html beside it when a picture helps (D158).` }))
    expect(context(r)).toContain("D147: this project has deferred runs:\n- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)")
  })
})

// v0.2.0's open_run wrote this load line first; only it proves whose run a folder is.
const LOAD = (session: string) => `{"t":"2026-09-24T00:00:00.000Z","ev":"load","ver":"0.2.0","session":"${session}","hooksEnv":"1","rules":[]}\n{"t":"2026-09-24T00:00:01.000Z","ev":"stage","from":null,"to":"spec"}\n`

describe("v0.2.0 keys (D149)", () => {
  test("another session's run:<id> whose folder has its load line becomes a deferred run it points to", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/old-run/1-spec.md`]: "# 리뷰 상세 블록 삭제\n", [`${REIN}/old-run/6-land.md`]: "msg", [`${REIN}/old-run/trace.jsonl`]: LOAD("s0") }
    world(on, files, q => (q.includes("이어서 진행할까요") ? "이어서 진행" : "폐기"), null, { store: { "run:s0": { ...OLD } } })
    expect(await status($)).toContain("- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)")
    expect(files[`${REIN}/defer/old-run/6-land.md`]).toBe("msg")
    expect(files[`${REIN}/old-run/6-land.md`]).toBeUndefined()
    expect(files[`${REIN}/defer/old-run/agent/trace.jsonl`]).toContain(`"ev":"migrate","from":"run:s0","state":"defer"`)
    // the trace from before agent/ goes on there, and stays where it was.
    expect(files[`${REIN}/defer/old-run/agent/trace.jsonl`]).toContain(LOAD("s0"))
    expect(files[`${REIN}/defer/old-run/trace.jsonl`]).toBe(LOAD("s0"))
    expect(store.get("session:s0")).toEqual({ project: "proj", runId: "old-run" })
    expect(store.get("run:s0")).toBeUndefined()
    // Now it can be resumed, or dropped from the session that resumes it.
    await relay($, RESUME("old-run"))
    expect(await relay($, PARK("커밋하지 않기로 함"))).toEqual(expect.objectContaining({ result: expect.stringContaining("The user dropped the run (폐기)") }))
    expect(files[`${REIN}/drop/old-run/6-land.md`]).toBe("msg")
  })

  test("a folder of the same name without that session's load line is another project's: key and folder are left", async ($, on) => {
    const files: Record<string, string> = {
      [`${REIN}/old-run/6-land.md`]: "msg", [`${REIN}/old-run/trace.jsonl`]: LOAD("s7"),
      [`${REIN}/bare/1-spec.md`]: "x",
      [`${REIN}/rules/trace.jsonl`]: LOAD("s3"), [`${REIN}/rules/api.md`]: "# api",
    }
    world(on, files, undefined, null, { store: { "run:s0": { ...OLD }, "run:s2": { ...OLD, runId: "bare" }, "run:s3": { ...OLD, runId: "rules" }, "run:s9": { ...OLD, runId: "elsewhere" } } })
    expect(await status($)).toBe("No Rein run is open in this session.")
    expect(moves).toEqual([])
    expect(files[`${REIN}/old-run/6-land.md`]).toBe("msg")
    expect(files[`${REIN}/rules/api.md`]).toBe("# api")
    for (const k of ["run:s0", "run:s2", "run:s3", "run:s9"]) expect(store.get(k)).toBeDefined()
  })

  test("this session's own run:<id> becomes its active run", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/login-fix/1-spec.md`]: SPEC_TEXT, [`${REIN}/login-fix/trace.jsonl`]: LOAD(SESSION) }
    world(on, files, undefined, null, { store: { [`run:${SESSION}`]: { stage: "spec", runId: "login-fix" } } })
    expect(await status($)).toContain(`stage: spec`)
    expect(await status($)).toContain(`run directory: ${DIR}`)
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
  })

  test("this session's own folder that cannot move holds the session: judged calls are refused, retried at most every 10 s (U72)", async ($, on) => {
    let held = true
    const files: Record<string, string> = { [`${REIN}/login-fix/1-spec.md`]: SPEC_TEXT, [`${REIN}/login-fix/trace.jsonl`]: LOAD(SESSION) }
    world(on, files, undefined, null, { store: { [`run:${SESSION}`]: { stage: "spec", runId: "login-fix" } }, move: () => !held })
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(refused("D149: this session's run login-fix from before the Rein upgrade could not be moved"))
    expect(await $.tool.call(OPEN("other"))).toEqual(refused("D149: this session's run login-fix"))
    expect(await $.tool.check({ tool: "Read", input: { file_path: `${REIN}/login-fix/1-spec.md` } } as never)).toEqual({ decision: "ask" })
    expect(await $.tool.call({ tool: "Read", file_path: "E:/proj/src/a.ts" } as never)).toEqual(expect.objectContaining({ result: "ok" }))
    const tries = moves.length
    held = false
    // Within 10 s the move is not tried again.
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(refused("D149"))
    expect(moves.length).toBe(tries)
    // status is never refused: it shows the hold (N5).
    expect(await status($)).toContain("D149: this session's run login-fix")
    await clock.advance(10_000)
    // Two judged calls at once: the one that waits on the retry is refused
    // too, never let through while the hold is being lifted.
    const both = await Promise.all([
      $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never),
      $.tool.call({ tool: "Write", file_path: "E:/proj/src/b.ts", content: "x" } as never),
    ])
    // Both waited for the move; once it is done the session's run holds,
    // and the main session's writes go through.
    for (const r of both) expect(r).toEqual(expect.objectContaining({ result: "ok" }))
    expect(moves.length).toBe(tries + 1)
    expect(await status($)).toContain(`run directory: ${DIR}`)
  })

  test("a retry that fails again keeps the hold", async ($, on) => {
    const files: Record<string, string> = { [`${REIN}/login-fix/1-spec.md`]: SPEC_TEXT, [`${REIN}/login-fix/trace.jsonl`]: LOAD(SESSION) }
    world(on, files, undefined, null, { store: { [`run:${SESSION}`]: { stage: "spec", runId: "login-fix" } }, move: () => false })
    await status($)
    await clock.advance(10_000)
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(refused("D149"))
    expect(await $.tool.call({ tool: "Write", file_path: "E:/proj/src/a.ts", content: "x" } as never)).toEqual(refused("D149"))
    expect(files["E:/proj/src/a.ts"]).toBeUndefined()
  })

  test("this session's own run:<id> when it already points to a run is deferred, and the pointer stays", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [`${REIN}/old-run/1-spec.md`]: "# 옛 run\n", [`${REIN}/old-run/trace.jsonl`]: LOAD(SESSION) }
    world(on, files, undefined, { stage: "dev", runId: "login-fix" }, { store: { [`run:${SESSION}`]: { ...OLD } } })
    const shown = await status($)
    expect(shown).toContain("runId: login-fix")
    expect(files[`${REIN}/defer/old-run/1-spec.md`]).toBe("# 옛 run\n")
    expect(store.get(`session:${SESSION}`)).toEqual({ project: "proj", runId: "login-fix" })
  })
})

// Rein does not hold the main session to a row, so what changed while
// the run was parked is measured as any of its changes is: against the
// frozen 1-spec.md and 2-plan.md and dev's seal. Files off the design move nothing.
describe("changes while parked (D176)", () => {
  const PLANNED = "E:/proj/src/login.ts"
  const sealOf = async (text: string) => sha256Text(btoa(String.fromCharCode(...new TextEncoder().encode(text))))
  const QA = async () => ({
    v: 2, stage: "qa", runId: "login-fix", rules: [], retries: 1, writes: [PLANNED], planFiles: [PLANNED], repos: ["E:/proj"],
    halt: { rule: "D141", reason: "aside down" }, qaVisit: { passed: true, reruns: 0 }, frozen: { spec: SPEC_TEXT }, sealed: { [PLANNED]: await sealOf("v1") },
  })
  const answers = (questions: string[] = []) => (q: string) => (questions.push(q), q.includes("멈출까요") ? "보류" : "이어서 진행")

  test("a planned file changed while parked is told on resume; the run stays in qa", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [PLANNED]: "v1" }
    world(on, files, answers(questions), await QA())
    await relay($, PARK("내일 이어서"))
    expect(questions[0]).toContain("이어받을 때 승인된 1-spec.md·2-plan.md나 dev가 넘긴 설계 파일이 바뀌어 있으면 알려 주고, run은 그 단계에 그대로 둡니다.")
    files[PLANNED] = "v2 written while parked"
    const r = await relay($, RESUME("login-fix"))
    expect(context(r)).toContain(`these files changed after dev passed: ${PLANNED}`)
    expect(context(r)).toContain("invoke the rein:qa skill")
    const shown = await status($)
    expect(shown).toContain("stage: qa")
    expect(shown).toContain("halt: D141")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"drift"`)
  })

  test("a file off the design changed while parked moves nothing", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [PLANNED]: "v1" }
    world(on, files, answers(), await QA())
    await relay($, PARK())
    files["E:/proj/test/fixture.json"] = "{}"
    const r = await relay($, RESUME("login-fix"))
    expect(context(r)).toContain("invoke the rein:qa skill")
    expect(await status($)).toContain("halt: D141")
  })

  test("a 1-spec.md changed while parked is told on resume", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT, [PLANNED]: "v1" }
    world(on, files, answers(), await QA())
    await relay($, PARK())
    files[`${REIN}/defer/login-fix/1-spec.md`] = `${SPEC_TEXT}
더함
`
    const r = await relay($, RESUME("login-fix"))
    expect(context(r)).toContain("1-spec.md changed after the user approved it")
    expect(await status($)).toContain("stage: qa")
  })

  test("a store write that fails after the move puts the folder back (F4)", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "보류", { stage: "dev", runId: "login-fix" }, { storeFails: (k, v) => k === "runs:proj/login-fix" && (v as { status?: string }).status === "defer" })
    const r = await relay($, PARK())
    expect(r).toEqual(refused("the store could not be written ("))
    expect(r).toEqual(refused(`the folder is back in ${DIR}`))
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(await status($)).toContain("stage: dev")
  })
})

describe("moves and ownership (D144)", () => {
  test("trace lines around a park never make active/<runId> again", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "보류", { stage: "dev", runId: "login-fix" })
    const [parked] = await Promise.all([relay($, PARK()), $.tool.call(STATUS), $.tool.call(STATUS), $.tool.call(STATUS)])
    expect(parked).toEqual(expect.objectContaining({ result: expect.stringContaining("보류") }))
    await $.tool.call(STATUS)
    expect(Object.keys(files).filter(f => f.startsWith(`${DIR}/`))).toEqual([])
    expect(files[`${DEFER}/1-spec.md`]).toBe(SPEC_TEXT)
  })

  test("a run folder deleted by hand does not hold the run: park changes the store and says so (U72)", async ($, on) => {
    const files: Record<string, string> = {}
    world(on, files, () => "폐기", { stage: "dev", runId: "login-fix" })
    const r = await relay($, PARK())
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining(`The run folder ${DIR} was already gone`) }))
    expect(files[`${DROP}/agent/trace.jsonl`]).toContain(`"folder":"missing"`)
    expect(store.get("runs:proj/login-fix")).toBeUndefined()
    expect(await status($)).toBe("No Rein run is open in this session.")
  })

  test("a deferred run without a folder can be resumed, with a warning, and then dropped", async ($, on) => {
    const questions: string[] = []
    const files: Record<string, string> = {}
    world(on, files, q => (questions.push(q), q.includes("이어서 진행할까요") ? "이어서 진행" : "폐기"), null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    const r = await relay($, RESUME("old-run"))
    expect(questions[0]).toContain("주의: 이 run의 폴더가 없습니다")
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining("Its folder was missing") }))
    expect(await relay($, PARK())).toEqual(expect.objectContaining({ result: expect.stringContaining("The user dropped the run (폐기)") }))
  })

  test("a deferred run whose folder sits in active/ (a failed move back) resumes without a move", async ($, on) => {
    const files: Record<string, string> = oldFiles("active")
    world(on, files, () => "이어서 진행", null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    expect(await status($)).toContain("- old-run: 리뷰 상세 블록 삭제 (stage land, deferred)")
    expect(await relay($, RESUME("old-run"))).toEqual(expect.objectContaining({ result: expect.stringContaining("Resumed old-run") }))
    expect(moves).toEqual([])
    expect(files[`${REIN}/active/old-run/6-land.md`]).toBe("msg")
  })

  test("an active run whose folder already sits at the destination closes without a move", async ($, on) => {
    const files: Record<string, string> = { [`${DROP}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "폐기", { stage: "dev", runId: "login-fix" })
    const r = await relay($, PARK())
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining("The user dropped the run (폐기)") }))
    expect(moves).toEqual([])
    expect(files[`${DROP}/agent/trace.jsonl`]).toContain(`"folder":"there"`)
  })

  // the answer comes in a second call, which finds the run another session's.
  test("a run taken over before the answer comes is not closed by this session", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => {
      store.set("runs:proj/login-fix", { stage: "dev", runId: "login-fix", status: "active", owner: "s2" })
      return "폐기"
    }, { stage: "dev", runId: "login-fix" })
    const r = await relay($, PARK())
    expect(r).toEqual(refused("D145: the run login-fix is no longer this session's"))
    expect(files[`${DIR}/1-spec.md`]).toBe(SPEC_TEXT)
    expect(store.get("runs:proj/login-fix")).toEqual(expect.objectContaining({ owner: "s2", status: "active" }))
  })

  test("park 폐기 and a second park answered together close the run once", async ($, on) => {
    const files: Record<string, string> = { [`${DIR}/1-spec.md`]: SPEC_TEXT }
    world(on, files, () => "폐기", { stage: "dev", runId: "login-fix" })
    const both = await Promise.all([relay($, PARK()), relay($, PARK())])
    expect(both.filter(r => (r as { result?: string }).result !== undefined).length).toBe(1)
    expect(files[`${DROP}/1-spec.md`]).toBe(SPEC_TEXT)
  })
})

describe("the person's gates are the main session's", () => {
  test("a subagent cannot call advance, park or resume", async ($, on) => {
    let asked = false
    world(on, { [`${DIR}/1-spec.md`]: SPEC_TEXT }, () => ((asked = true), "승인"), { stage: "spec", runId: "login-fix" })
    for (const tool of ["mcp__rein__advance", "mcp__rein__park", "mcp__rein__resume"]) {
      expect(await $.tool.call({ tool, agentId: "agent-x", reason: "r", runId: "login-fix" } as never)).toEqual(refused(`D146: ${tool} is called only by the main session`))
    }
    expect(asked).toBe(false)
    expect(await $.tool.call({ tool: "mcp__rein__status", agentId: "agent-x" } as never)).toEqual(expect.objectContaining({ result: expect.stringContaining("stage: spec") }))
  })
})

describe("the session's name", () => {
  // the end of a main-loop turn; agentId: a subagent's.
  const turnEnds = ($: { turn: { complete: (e: never) => Promise<unknown> } }, agentId?: string) =>
    $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t", reason: "answer", agentId } as never)
  // the hook's /rename runs once the turn is done, not within it.
  const settled = () => new Promise(r => setTimeout(r, 0))

  test("the turn that opened a run names the session after its slug, once", async ($, on) => {
    world(on, {}, () => undefined, null)
    await turnEnds($)
    await $.tool.call(OPEN("next-task"))
    await turnEnds($, "agent-x")
    await settled()
    expect(renames).toEqual([])
    await turnEnds($)
    await turnEnds($)
    await settled()
    expect(renames).toEqual(["next-task"])
  })

  test("the session's next run renames it again", async ($, on) => {
    world(on, {}, () => "보류", null)
    await $.tool.call(OPEN("next-task"))
    await turnEnds($)
    await settled()
    await relay($, PARK())
    await $.tool.call(OPEN("other-task"))
    await turnEnds($)
    await settled()
    expect(renames).toEqual(["next-task", "other-task"])
  })

  test("a resumed run names the session too", async ($, on) => {
    world(on, oldFiles("defer"), () => "이어서 진행", null, { store: { "runs:proj/old-run": { ...OLD, status: "defer" } } })
    await relay($, RESUME("old-run"))
    await turnEnds($)
    await settled()
    expect(renames).toEqual(["old-run"])
  })

  // this session's transcript, its names in the order they were given, and
  // PowerShell picking its lines that hold the pattern, as Select-String would.
  const TRANSCRIPT = "C:/Users/u/.claude/projects/E--proj/s1.jsonl"
  const named = (...titles: string[]): [Record<string, string>, Host] => {
    const text = ['{"type":"user"}', ...titles.map(t => JSON.stringify({ type: "custom-title", customTitle: t, sessionId: SESSION }))].join("\n") + "\n"
    const run: Host["run"] = (argv, _cwd, _stdin, env) =>
      argv[0] === "powershell.exe" && env?.REIN_FILE === TRANSCRIPT
        ? { exitCode: 0, stdout: text.split("\n").filter(l => l.includes(env.REIN_PATTERN!)).slice(-1).join("") + "\r\n" }
        : { exitCode: 0 }
    return [{ [TRANSCRIPT]: text }, { run }]
  }

  test("a session its transcript names after its run is not named again, as after a reload of Rein", async ($, on) => {
    const [files, host] = named("다른 이름", "login-fix")
    world(on, files, () => undefined, { stage: "spec", runId: "login-fix" }, host)
    await turnEnds($)
    await turnEnds($)
    await settled()
    expect(renames).toEqual([])
  })

  test("a session its transcript names otherwise is named after its run", async ($, on) => {
    const [files, host] = named("login-fix", "다른 이름")
    world(on, files, () => undefined, { stage: "spec", runId: "login-fix" }, host)
    await turnEnds($)
    await settled()
    expect(renames).toEqual(["login-fix"])
  })

  test("a rename the person typed in this session keeps their name", async ($, on) => {
    world(on, {})
    await $.command.run({ command: "rename", args: "내 작업", origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 80 } })
    await turnEnds($)
    await settled()
    expect(renames).toEqual(["내 작업"])
  })
})

describe("the store near its limit", () => {
  // A run another session left open, its frozen 1-spec.md large enough to fill the store past 3 MiB.
  const leftover = (mib: number) => ({
    "runs:proj/old-run": { v: 2, stage: "plan", runId: "old-run", status: "active", owner: "s0", rules: [], writes: [], retries: 0, frozen: { spec: "x".repeat(mib * 1024 * 1024) } },
    "session:s0": { project: "proj", runId: "old-run" },
  })

  test("below 3 MiB status and open_run say nothing of the store", async ($, on) => {
    world(on, {}, undefined, null, { store: leftover(2) })
    expect(await status($)).not.toContain("Rein's store")
    expect(context(await $.tool.call(OPEN("next-task")))).not.toContain("Rein's store")
  })

  test("past 3 MiB status names the largest run records and how to free them", async ($, on) => {
    world(on, {}, undefined, null, { store: leftover(3.2) })
    const text = await status($)
    expect(text).toContain("Rein's store on this PC holds about 3.2 MiB of its 4.0 MiB")
    expect(text).toContain("- proj/old-run (active, 3277 KB)")
    expect(text).toContain("mcp__rein__park with 폐기")
  })

  test("past 3 MiB status of an open run warns too", async ($, on) => {
    world(on, {}, undefined, { stage: "dev", runId: "login-fix" }, { store: leftover(3.2) })
    const text = await status($)
    expect(text).toContain("stage: dev")
    expect(text).toContain("- proj/old-run (active, 3277 KB)")
  })

  test("past 3 MiB open_run opens the run and warns", async ($, on) => {
    world(on, {}, undefined, null, { store: leftover(3.2) })
    const r = await $.tool.call(OPEN("next-task"))
    expect(r).toEqual(expect.objectContaining({ result: expect.stringContaining("Run opened") }))
    expect(context(r)).toContain("Rein's store on this PC holds about 3.2 MiB")
  })

  test("a refused write near the limit says the store is the likely cause", async ($, on) => {
    world(on, {}, undefined, null, { store: leftover(3.9), storeFails: k => k === "runs:proj/next-task" })
    const r = await $.tool.call(OPEN("next-task"))
    expect(r).toEqual(refused("Rein: a hook rule failed ("))
    expect(r).toEqual(refused("Rein's store on this PC holds about 3.9 MiB"))
  })

  test("a refused write far from the limit says nothing of the store", async ($, on) => {
    world(on, {}, undefined, null, { storeFails: k => k === "runs:proj/next-task" })
    const r = (await $.tool.call(OPEN("next-task"))) as { deny: string }
    expect(r.deny).toContain("Rein: a hook rule failed")
    expect(r.deny).not.toContain("Rein's store")
  })
})
