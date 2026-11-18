import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, Register, ToolCallResult } from "claude-code"
import { ASIDE_BASH_TIMEOUT, AT_ONCE, CALL_MINUTES, captureAside, checkMinutes, exitCodeOf, isOpen, productionTargets, runnerTask, sessionStatus, startable } from "./lib/aside.ts"
import { changeLines, readConfig, viewOf, type Config, type ConfigView, type E2e } from "./lib/config.ts"
import { HARNESS_FILE, harnessSource, importLine, REOPEN_MARK, TAKEOVER_MARK } from "./lib/egoHarness.ts"
import { attemptOf, closeScript, driverTask, driving, EGO_GUIDE, egoStartable, judgeable, judgeTask as egoJudgeTask, marked, oneSpace, onlyLayoutFailed, parseJudge, PROBE_SCRIPT, profilesOf, resolveProfiles, roundCommand, roundEnds, roundLimitMs, roundOutcome, runSpaces, SHOT_PROBE_SCRIPT, spaceName, usedMs, type Profile } from "./lib/ego.ts"
import { checkChain, commitMessage, GIT_HARDEN, gitCommits, gitRewrite, inFolder, quietTool, readOnly, runnerTool, unharden } from "./lib/bash.ts"
import { eol, lineDiff } from "./lib/diff.ts"
import { checkConfig, judgeCover, judgeDev, parseCause, parseChecks, parseCover, parseDev, parseDeviation, parseGrade, parseLayouts, parsePlan, parseReview, toBeScreens, type Check, type Layout } from "./lib/parse.ts"
import { climbs, isAbsolute, resolve, same, slash, under, worktreeMain, writeTarget } from "./lib/paths.ts"
import { sha256Text } from "./lib/hash.ts"
import { builtVerifierTask, GIVE_UP_AT, isLayoutCheck, LAYOUT_FAILS, LAYOUT_VERIFIER, layoutCheck, layoutFailsText, layoutIdOf, MEASURE_AT, MOCKUP_SHOTS, parseLayoutVerdict, redrawLines, SPEC_VERDICT, specVerifierTask, tickLayout, toBeSources } from "./lib/layout.ts"
import { pastedImages, pasteName } from "./lib/brief.ts"
import { TRACE_LIMIT, traceFile, traceInput, utf8Bytes } from "./lib/trace.ts"
import { parsePlanView, planViewData, planViewHtml } from "./lib/planView.ts"
import { afterPlan, clearSession, fromPortable, pastPlan, toPortable, type HubInfo, type HubRecord, type HubRun, type HubStatus } from "./lib/sync.ts"
import { quoted } from "./lib/quote.ts"
import { ARBITER_USE, KNOWLEDGE_FILE, knowledgeDescription, knowledgeIndex, knowledgePointer, PLAN_USE, SKETCHER_USE, STATUS_USE, WORKER_USE, type Knowledge } from "./lib/knowledge.ts"
import { applicableRules, freezeRule, ruleFile, sharedRulesOf } from "./lib/rules.ts"
import { frameStatus, MAIN, type Activity, type End, type Land, type LandFile, type LandRepo, type LandResult } from "./lib/pane.ts"
import { normalizeRun, projectOf, renderRun, withContext, type CheckRun, type Ctx, type E2eState, type EgoCheck, type Rule, type Run, type Seal, type Stage, type StageSpec, type Tree } from "./lib/state.ts"
import { inTree, landMessage, treeBranch, treeOwner, treePath, treeTable, WORKTREES } from "./lib/trees.ts"
import { afterDeviation, arbiterTask, d62Entry, dev, devCommand, devDiff, devEntry, devFails, devRound, devTask, holdRoute, routeJudged, toDev, toPlan } from "./stages/dev.ts"
import { outside, parsePlanVerdict, PLAN_REVIEW, PLAN_REVIEWS, planEntry, planReviewer, planReviewTask, repoCandidates, revisitNote } from "./stages/plan.ts"
import { filesOf, landFiles, nameStatus, numstat, stagedPaths, stagingProblem, statusEntries, statusPaths } from "./stages/land.ts"
import { backendsHint, commandReport, failedRun, failureOf, OUTPUT_FILE, outputLog, rerunQuestion, rewrote, type CommandResult } from "./stages/qa.ts"
import { driverRow, egoSection, folderOf as checkFolder, judgeOf, judgeRow, settleEgo, asideSection, progressSection, allChecked, carriedPass, carriedTick, asideTick, egoTick, checklist, doubtful, IMPACT_DIFF, IMPACT_FILE, impactRow, impactTask, parseImpact, completionLine, completionTask, E2E_MANUAL, E2E_NONE, E2E_SKIPPED, e2eSection, entryOutcome, handChecked, judgeIntegration, keptPasses, openLayouts, parseResult, qaIntegration, remember, resultOf, runnerCheck, runnerRow, sameE2e, settleAside, tick, unchecked, UNSHOT, withHistory } from "./stages/qaIntegration.ts"
import { GROUPS_FILE, groupFile, groupItems, groupRules, groupsCover, groupTask, joinedReview, parseGroups, pendingGroups, review, reviewEntry, reviewLists, reviewNext, reviewRules, reviewTask, splits, splitterTask } from "./stages/review.ts"
import { DIMENSIONS, EVERY, gradeLine, graderTask, gradeSummary, openQuestions, passes, scoreGrade, sketcherTask, sketchMode, spec, specProblem, specType, TYPES } from "./stages/spec.ts"
import { unbuilt } from "./stages/unbuilt.ts"

// Kickoff step 5, all six stages. The run opens through the open_run tool,
// the hook keeps its state in $.store and, only while a run is open
//, holds the agents Rein spawns to their stage's allowlist while
// the main session is free, its changes voiding the judgments they touch
//. The advance tool moves spec on after
// the hook itself asks the person; plan too, once 2-plan.md has the
// form, dev by its checklist against the recorded writes, and
// dev goes back to plan when the arbiter finds the design cannot be followed
// (G3); review moves on by the reviewer's review.md, qa by the
// hook's rerun of the config commands, qa-integration by its e2e and
// completion check, land by the staging of the planned files that changed
// and 6-land.md, which closes the run; the person commits it themselves. Every decision
// inside a run goes to trace.jsonl in its folder, which is
// ~/.rein/<project>/<state>/<runId>/ and moves with the run's state.
// The run is kept per slug and the session points to it; park defers
// or drops it on the person's answer, resume picks it up.
// Every $ call stays in this file: the engine follows $ only into functions
// declared here, never across an import. lib/ and stages/ hold pure logic.

// The version in trace and run records; the release skill keeps it equal to
// .claude-plugin/plugin.json.
const VERSION = "0.62.0"
const TEXT_LIMIT = 2000
const PROBE_MS = 8000
const OPEN_RUN = "mcp__rein__open_run"
const ADVANCE = "mcp__rein__advance"
const STATUS = "mcp__rein__status"
const PARK = "mcp__rein__park"
const RESUME = "mcp__rein__resume"
const GOTO = "mcp__rein__goto"
// the activity the frame shows, by agentId, in this session's memory and
// the run's frame.json only. A tool call is far too frequent for $.store,
// and the lock mutate takes would put every agent's tools in one queue; the run
// record stays the run's state alone. Nothing here outlives the session.
const activity = new Map<string, Activity>()
// the run whose status the hook writes for the frame, and its frame.json,
// FRAME_FILE in the run folder.
const FRAME_FILE = "agent/frame.json"
// what land commits and its result, for the frame (writeLand).
const LAND_FILE = "agent/land.json"
let framed: { runId: string; file: string } | undefined
// the run and stage the frame server was last made sure of (ensureFrame),
// and its URL that the main session has not been told yet.
let served: { runId: string; stage: Stage } | undefined
let frameUrl: string | undefined
const APPROVE = "승인"
const RERUN = "다시 돌리기"
const COMMIT = "커밋"
const KEEP_HALT = "그대로 멈춤"
const TO_DEV = "dev로 보냄"
const RERUN_FAILED = "실패 항목만 다시 돌리기"
const AS_BEFORE = "기존 동작으로 진행"
const NEW_CONFIG = "새 config 승인"
const KEEP_CONFIG = "그대로"
const TO_PLAN = "plan으로 되돌림"
const SEND_PLAN = "plan으로 보냄"
const END_RUN = "run 종료"
const ASIDE_ON = "Aside를 켰음, 다시 확인"
const NO_E2E = "e2e 없이 진행"
const E2E_ASIDE = "e2e 실행 (Aside)"
const E2E_EGO = "e2e 실행 (Ego)"
const EGO_ON = "Ego를 켰음, 다시 확인"
const SETUP_DONE = "rein:setup으로 채웠음, 다시 확인"
const AS_ASIDE = "Aside로 실행"
const HANDED_DONE = "끝냈음, 이어서"
const BY_PERSON = "이 check는 사람이 확인"
const BY_HAND = "직접 확인 완료"
const QA_RERUN = "다시 돌림"
const CANCEL = "취소"
const DEFER = "보류"
const DROP = "폐기"
const DONE_OUTSIDE = "완료 (Rein 밖에서 반영함)"
const KEEP_GOING = "계속 진행"
const TAKE_UP = "이어서 진행"
// every run is in one state, and its folder is <project>/<state>/<runId>.
type RunState = "active" | "defer" | "complete" | "drop"
const STATES: RunState[] = ["active", "defer", "complete", "drop"]
// names of ~/.rein/<project> itself, never a slug.
const RESERVED = new Set<string>([...STATES, "rules", "knowledge"])
// stages whose judgments rest on the planned files as dev sealed them.
const SEALED = new Set<Stage>(["review", "qa", "qa-integration", "land"])
// what a session holds: the run it has open, by project and slug.
type Pointer = { project: string; runId: string }
// which rein skill carries on each stage after a resume.
const SKILL: Record<Stage, string> = { spec: "rein:spec", plan: "rein:plan", dev: "rein:dev", review: "rein:review", qa: "rein:qa", "qa-integration": "rein:qa", land: "rein:land" }
// $.fs cannot rename, so PowerShell moves the folder on Windows. The
// paths come in through the environment, so no quoting can break them;
// Directory.Move is one rename, so a failure leaves nothing half moved.
const MOVE_PS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $env:REIN_TO) -ErrorAction Stop | Out-Null; [IO.Directory]::Move($env:REIN_FROM, $env:REIN_TO) } catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }"
// the last line of the transcript that records the session's name.
const TITLE_PS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Select-String -LiteralPath $env:REIN_FILE -SimpleMatch -Pattern $env:REIN_PATTERN -Encoding UTF8 | Select-Object -Last 1 | ForEach-Object { $_.Line }"
// A transcript is past what $.fs.read takes, and $.fs.write writes only
// text, so Node (which Rein's frame and SessionStart hook run on already)
// reads the transcript's user lines but the tools' results (screenshots the
// session read), and writes a pasted image's bytes from base64 on stdin.
const USER_LINES_JS = "const rl = require('readline').createInterface({ input: require('fs').createReadStream(process.env.REIN_FILE), crlfDelay: Infinity }); rl.on('line', l => { if (l.includes('\"type\":\"user\"') && !l.includes('\"tool_result\"')) process.stdout.write(l + '\\n') })"
const WRITE_BYTES_JS = "const fs = require('fs'); let b = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { b += d }); process.stdin.on('end', () => { fs.mkdirSync(require('path').dirname(process.env.REIN_TO), { recursive: true }); fs.writeFileSync(process.env.REIN_TO, Buffer.from(b, 'base64')) })"
// how each stage moves on, for the advance tool and its refusals.
const MOVES = "How each stage moves on: spec, by mcp__rein__advance once rein:grader graded 1-spec.md as it is: the run then waits for the user, who approves 1-spec.md by typing /rein:plan (advance with 승인, D175); plan, by advance once 2-plan.md passes the hook's judgment and a rein:reviewer's design review given through mcp__rein__plan_review (after two failed reviews in one visit the user decides): the run then waits for the user, who approves 2-plan.md by typing /rein:dev (advance with 승인; what advance shows also names a config that differs from the one committed at HEAD, D120); dev, by writing dev-items.md; review, by the rein:reviewer's review.md (a failure goes to dev or plan as its ## 실패 원인 judges it, or stops the run in review for your decision, which advance takes); qa, by advance (the hook runs the qa commands: all pass moves on, once rein:impact wrote impact.md when e2e checks that passed before rest on files changed since, and with checks in 2-plan.md's ## e2e 확인 the run then waits in qa-integration for the user; after a failure, qa.md reporting a code problem sends the run to dev or plan as its ## 실패 원인 judges it, or stops it in qa for your decision, which advance takes; once the user fixed the environment advance takes their answer and reruns; a config changed while the commands ran stops the run for your decision; a config changed since plan, by advance with the approval; e2e configured but Aside unavailable, by advance with the decision); qa-integration, while it waits (e2e: wait), by advance with the user's answer only: they tested by 5-checklist.md and checked every box (/rein:land; the run goes to land), want aside or ego to run the checks (/rein:e2e, which asks which), or found a problem (back to dev or plan); on the aside path once a rein:e2e-runner agent ran each check of 2-plan.md's ## e2e 확인 and wrote its result (up to 5 at once, in the background; mcp__rein__status says how many to spawn now), on the ego path once a rein:ego-driver drove each check and a rein:ego-judge judged it from the evidence (a check handed to the user, by advance with their answer), by the rein:reviewer's completion check in e2e.md (a halt, a failed aside check, or nothing left to commit, by advance with the decision; a failed completion check halts the run until goto moves it; a layout box of 5-checklist.md left empty halts it until advance takes the user's answer that they compared and checked it, or found a layout that differs); land, by advance once the planned files that changed are staged and 6-land.md is written, which closes the run (the user commits it themselves). In any stage the main session may move the run to any stage with mcp__rein__goto, on its own judgment or the user's. In any stage, to stop, put aside or abandon the run: mcp__rein__park (it says what it takes). Call mcp__rein__status to see where the run stands."
// what the main session reads when the completion check failed.
const COMPLETION_FAILED = "the completion check in e2e.md failed, so the run is halted in qa-integration. Tell the user what failed and decide with them where the run goes, then call mcp__rein__goto: plan to revise the design, land to accept the evidence as it is, qa-integration to run the integration entry again (checks that passed stay passed) and the completion check after it, or any other stage."
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"])
const READ_TOOLS = new Set(["Read", "Grep", "Glob"])
const RUN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const UNSURE = "D46: the path names no file, or spells it in a way the hook cannot check (~, //, .., a trailing dot or space, a colon past the drive); write it as a plain path."

// one row per stage whose Rein agents write: the grader in spec,
// the worker and arbiter in dev, the reviewer in review, the integration
// reviewer in qa-integration. A stage the hook does not know refuses every
// write.
const STAGES: Partial<Record<Stage, StageSpec>> = { spec, dev, review, "qa-integration": qaIntegration }
const stageOf = (run: Run): StageSpec => STAGES[run.stage] ?? unbuilt

// G3: the Rein agents the hook records at agent.spawn, by the
// stage they work in. Each runs in the foreground on a task the hook builds
// (judgeTask) and writes its stage's row; only its own write of its file is
// a judgment (the integration reviewer's ## 완료 판정 대조).
type Recorded = { type: string; field: "grader" | "worker" | "arbiter" | "reviewer" | "verifier" }
const JUDGES: Partial<Record<Stage, Recorded>> = {
  spec: { type: "rein:grader", field: "grader" },
  dev: { type: "rein:arbiter", field: "arbiter" },
  review: { type: "rein:reviewer", field: "reviewer" },
  "qa-integration": { type: "rein:reviewer", field: "verifier" },
}
// the worker that writes a straight run's code in dev.
const WORKER: Recorded = { type: "rein:worker", field: "worker" }

// stages that may read the rule files the run froze.
const READS_RULES = new Set<Stage>(["plan", "review"])

// one row per approved transition: the stage it leaves, the artifact
// the person approves, the stage it enters, and what the agent reads next.
const NEXT: Partial<Record<Stage, { artifact: string; to: Stage; entry: (run: Run) => string }>> = {
  spec: { artifact: "1-spec.md", to: "plan", entry: planEntry },
}

// the run the frame shows, the last one this session had; the chip hook
// keeps the activity against it.
let lastRun: Run | undefined
let base: string | undefined
let queue: Promise<void> = Promise.resolve()
let lock: Promise<unknown> = Promise.resolve()
let migration: Promise<void> | undefined
// runs this module moved out of active/; a late trace line of theirs
// must not make the folder there again.
const gone = new Set<string>()
// the runs whose broken trace this session toasted already.
const traceToasted = new Set<string>()
// this session's own v0.2.0 run whose folder could not move yet.
let legacyHeld: { runId: string; problem: string; at: number } | undefined
let retrying: Promise<void> | undefined
// the run whose slug this module last named the session after, and
// whether someone else renamed the session since Rein loaded.
let namedFor: string | undefined
let renamed = false
// the run this session closed last (complete or drop), for its
// retrospective: reading its folder and the main session's transcripts and
// writing its retro.md pass the engine's check. It goes when a run opens.
let closed: { dir: string; transcripts: string[] } | undefined
// every grader this module spawned. It reads 1-spec.md and writes
// grade.md, nothing else, even once it is spent.
const graders = new Set<string>()
// every sketcher this module spawned. It reads and writes 1-mockup.html,
// nothing else; only the last one spawned in spec writes at all.
const sketchers = new Set<string>()
const SKETCHER = "rein:sketcher"
// every layout verifier this module spawned. It reads the pictures and
// writes its verdict, nothing else.
const layoutVerifiers = new Set<string>()
const SPLITTER = "rein:review-splitter"
const IMPACT = "rein:impact"
const COLLATOR = "rein:collator"
// every agent this module spawned for a Rein role. One the run no
// longer counts on writes nothing; any other subagent is the main session's.
const reinAgents = new Set<string>()

// ~/.rein/<project>, where <project> is the session root's folder name,
// or, when the root is a linked worktree, its main repository's.
async function projectDir($: EngineInterface): Promise<string> {
  if (base) return base
  const home = (await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))
  if (!home) throw new Error("neither USERPROFILE nor HOME is set")
  const root = slash(await $.session.root())
  const gitFile = (await $.fs.exists(`${root}/.git`)) ? await $.fs.read(`${root}/.git`).catch(() => "") : ""
  const project = worktreeMain(gitFile, root) ?? (root.split("/").pop() || "root")
  base = `${slash(home)}/.rein/${project}`
  return base
}

// A busy token older than this was left by a judgment that never finished.
const BUSY_STALE_MS = 60 * 60_000

async function ctxOf($: EngineInterface, run: Run, agentId?: string): Promise<Ctx> {
  const raw = slash(await $.session.root())
  const root = resolve(raw, raw)
  const stale = run.busy !== undefined && (await $.clock.now()) - run.busy.at > BUSY_STALE_MS
  return { run: stale ? { ...run, busy: undefined } : run, root, agentId, dir: resolve(await folderOf($, "active", run.runId), root) }
}

// the folder of a run in a state. An active run is always under
// active/, also after a resume, so the paths the agent holds stay valid.
async function folderOf($: EngineInterface, state: RunState, runId: string): Promise<string> {
  return `${await projectDir($)}/${state}/${runId}`
}

async function projectName($: EngineInterface): Promise<string> {
  return (await projectDir($)).split("/").pop()!
}

// One judgment that runs commands at a time (qa reruns, the e2e entry), so
// parallel writes cannot rerun them best-of-N. Undefined when another holds it.
async function takeBusy($: EngineInterface, stage: Stage, what: string): Promise<number | undefined> {
  const now = await $.clock.now()
  const moved = await mutate($, r =>
    r?.stage === stage && (!r.busy || now - r.busy.at > BUSY_STALE_MS) ? { ...r, busy: { what, at: now } } : undefined,
  )
  return moved ? now : undefined
}

async function dropBusy($: EngineInterface, at: number): Promise<void> {
  await mutate($, r => (r?.busy?.at === at ? { ...r, busy: undefined } : undefined))
}

// G9 at qa and after: every repository of the run still has the
// config.json plan passed with (same hash), and it is usable. A problem is
// tampering or environment, not a dev retry.
async function frozenConfigs($: EngineInterface, run: Run): Promise<{ configs: Record<string, Config> } | { problem: string }> {
  const now = await currentConfigs($, run)
  if ("problem" in now) return now
  const changed = (run.repos ?? []).filter(r => run.configHashes?.[r] !== undefined && run.configHashes[r] !== now.hashes[r])
  if (changed.length > 0) return { problem: changed.map(r => `${r}/.rein/config.json (it changed since plan passed)`).join(", ") }
  return { configs: now.configs }
}

// Every repository's config.json as it is now, usable, with its hash.
async function currentConfigs($: EngineInterface, run: Run): Promise<{ configs: Record<string, Config>; hashes: Record<string, string> } | { problem: string }> {
  const repos = run.repos ?? []
  if (repos.length === 0) return { problem: "the run has no repositories recorded, so qa has nothing to run" }
  const configs: Record<string, Config> = {}
  const hashes: Record<string, string> = {}
  const problems: string[] = []
  for (const repo of repos) {
    const path = `${repo}/.rein/config.json`
    if (!(await $.fs.exists(path))) {
      problems.push(`${path} (it does not exist)`)
      continue
    }
    const text = await $.fs.read(path)
    const bad = checkConfig(text)
    if (bad !== undefined) problems.push(`${path} (${bad})`)
    else {
      configs[repo] = readConfig(text)
      hashes[repo] = await sha256Text(text)
    }
  }
  return problems.length > 0 ? { problem: problems.join(", ") } : { configs, hashes }
}

// on the person's answer: the configs as they are now become the
// frozen ones, when every one is usable (the person edits config.json
// with the main session).
async function refreezeConfigs($: EngineInterface, run: Run, stage: Stage, patch: (r: Run, hashes: Record<string, string>, views: Record<string, ConfigView>) => Partial<Run> = () => ({})): Promise<{ configs: Record<string, Config> } | { problem: string }> {
  const now = await currentConfigs($, run)
  if ("problem" in now) return now
  const views = Object.fromEntries(Object.entries(now.configs).map(([repo, cfg]) => [repo, viewOf(cfg)]))
  const moved = await mutate($, r => (r?.stage === stage ? { ...r, ...patch(r, now.hashes, views), configHashes: { ...r.configHashes, ...now.hashes }, configSeen: { ...r.configSeen, ...views } } : undefined))
  if (!moved) return { problem: `the run left ${stage} meanwhile` }
  await trace($, run, { ev: "freeze", stage, configHashes: now.hashes })
  return { configs: now.configs }
}

// after the hook ran commands: the configs whose file no longer has
// the frozen hash (gone counts). A command rewrote its own checks.
async function configDrift($: EngineInterface, run: Run): Promise<string[]> {
  const out: string[] = []
  for (const repo of run.repos ?? []) {
    const frozen = run.configHashes?.[repo]
    if (frozen === undefined) continue
    const path = `${repo}/.rein/config.json`
    const now = (await $.fs.exists(path)) ? await sha256Text(await $.fs.read(path)) : ""
    if (now !== frozen) out.push(path)
  }
  return out
}

// for the approval question, per config that differs from what the
// person last approved, the fields that changed, quoted (the file may be the
// code's writing).
async function configChanges($: EngineInterface, run: Run): Promise<string> {
  const lines: string[] = []
  for (const repo of run.repos ?? []) {
    const path = `${repo}/.rein/config.json`
    const text = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    const frozen = run.configHashes?.[repo]
    if (frozen !== undefined && text !== undefined && (await sha256Text(text)) === frozen) continue
    lines.push(...changeLines(path, run.configSeen?.[repo], text))
  }
  return lines.length > 0 ? `\n\n바뀐 것 (승인된 내용 → 지금):\n${quoted(lines.join("\n"))}` : ""
}

// the run is kept per slug; a session keeps only a pointer to it.
async function recordKey($: EngineInterface, runId: string): Promise<string> {
  return `runs:${await projectName($)}/${runId}`
}

async function pointerKey($: EngineInterface): Promise<string> {
  return `session:${await $.session.id()}`
}

// the session's run: the record its pointer names, while the record is
// active and owned by this session. lost: the pointer names a run another
// session took over (or took over and then ended). held: this session's own
// v0.2.0 run could not move yet; the caller refuses what it would judge.
async function lookup($: EngineInterface): Promise<{ run?: Run; key?: string; lost?: string; held?: string }> {
  await migrated($)
  if (legacyHeld) return { held: legacyHeld.runId }
  const session = await $.session.id()
  const pointer = (await $.store.get(`session:${session}`)) as Pointer | undefined
  if (!pointer || typeof pointer !== "object" || typeof pointer.runId !== "string") return {}
  const key = `runs:${pointer.project}/${pointer.runId}`
  const run = normalizeRun(await $.store.get(key))
  if (run?.status === "active" && run.owner === session) return { run, key }
  return { lost: pointer.runId }
}

async function getRun($: EngineInterface): Promise<Run | undefined> {
  return (await lookup($)).run
}

// The pointer goes only while it still names the lost run, so a parallel
// open_run or resume that just set a new one keeps it.
async function dropPointer($: EngineInterface, runId: string): Promise<void> {
  const key = await pointerKey($)
  await locked(async () => {
    const pointer = (await $.store.get(key)) as Pointer | undefined
    if (pointer?.runId === runId) await $.store.delete(key)
  })
}

const lostLine = (runId: string, refused = true) =>
  `D145: the run ${runId} is no longer this session's: another session resumed it (mcp__rein__resume there), or an upgrade of Rein set it aside (D149). ${refused ? "This call was refused so nothing ran unchecked; from now on" : "From now on"} this session has no run and Rein no longer holds it to one. mcp__rein__status lists the run if it can be resumed. Tell the user.`

// this session's own v0.2.0 run is held until its folder moves; the
// hook tries again at most every LEGACY_RETRY_MS, on a call it would judge.
const LEGACY_RETRY_MS = 10_000

async function heldLine($: EngineInterface): Promise<string> {
  const held = legacyHeld!
  return `D149: this session's run ${held.runId} from before the Rein upgrade could not be moved to ${await folderOf($, "active", held.runId)} (${held.problem}), so Rein refuses this call rather than let it through unchecked. Tell the user (on Windows a file in ${await projectDir($)}/${held.runId} may be open in another program); the hook tries again on the next call, at most every ${LEGACY_RETRY_MS / 1000} seconds.`
}

// One retry at a time: a call that comes while one runs waits for it. The
// hold stays while it runs, so no call passes meanwhile; migrateKey lifts it
// once nothing is left to hold.
function retryLegacy($: EngineInterface): Promise<void> {
  if (retrying) return retrying
  if (!legacyHeld) return Promise.resolve()
  retrying = (async () => {
    const now = await $.clock.now()
    if (!legacyHeld || now - legacyHeld.at < LEGACY_RETRY_MS) return
    legacyHeld = { ...legacyHeld, at: now }
    await migrateKey($, `run:${await $.session.id()}`)
  })().finally(() => {
    retrying = undefined
  })
  return retrying
}

// One store change at a time within this session's hooks.
function locked<T>(job: () => Promise<T>): Promise<T> {
  const p = lock.then(job)
  lock = p.catch(() => {})
  return p
}

// One read-modify-write of the run at a time, so concurrent hooks cannot
// lose each other's change. fn answers the new run, or undefined to leave it.
function mutate($: EngineInterface, fn: (run: Run | undefined) => Run | undefined): Promise<Run | undefined> {
  return locked(async () => {
    const found = await lookup($)
    const run = fn(found.run)
    if (!run || found.key === undefined) return undefined
    await $.store.set(found.key, run)
    // the frame shows the run, so a change to it is the redraw.
    await redraw($, run)
    return run
  })
}

// the rule and context a call is judged by. The main session, and
// any subagent Rein did not spawn, is master: it writes and runs anything.
// A Rein agent is judged by its role while the run counts on it: the
// worker and arbiter in dev, the reviewer in review and the integration reviewer in qa-integration
// by their stage's rules; a rein:e2e-runner or rein:ego-driver by its
// check's row while the check is open, a rein:ego-judge by its own. Once its part is over it writes nothing.
async function scopeOf($: EngineInterface, run: Run, agentId: string | undefined): Promise<{ c: Ctx; spec: StageSpec; main: boolean }> {
  const c = await ctxOf($, run, agentId)
  if (agentId === undefined) return { c, spec: master(run.stage), main: true }
  // on the ego path a driver by its check's row, a judge by its own.
  if (run.stage === "qa-integration" && run.e2e?.path === "ego") {
    const driven = run.e2e.checks?.find(k => k.runner === agentId && isOpen(k))
    if (driven) return { c, spec: driverRow(driven), main: false }
    const judged = run.e2e.checks?.find(k => k.ego?.judge === agentId && isOpen(k))
    if (judged) return { c, spec: judgeRow(judged), main: false }
  }
  const check = run.stage === "qa-integration" && run.e2e?.path !== "ego" ? runnerCheck(run, agentId) : undefined
  if (check) return { c, spec: runnerRow(check), main: false }
  if (counts(run, agentId)) return { c, spec: run.stage === "plan" ? planReviewer : run.stage === "qa" ? impactRow() : stageOf(run), main: false }
  const recorded = [run.worker, run.arbiter, run.reviewer, run.splitter, run.verifier, run.grader, run.sketcher, run.sketchCheck?.agent, run.planReviewer, run.impact?.agent].includes(agentId)
  if (reinAgents.has(agentId) || graders.has(agentId) || sketchers.has(agentId) || layoutVerifiers.has(agentId) || recorded) return { c, spec: retired(`its part in the run is over (the run is in ${run.stage})`), main: false }
  return { c, spec: master(run.stage), main: true }
}

// whether the run counts on this Rein agent in its stage now.
function counts(run: Run, agentId: string): boolean {
  if (run.stage === "spec") return run.grader === agentId || graders.has(agentId) || run.sketcher === agentId || run.sketchCheck?.agent === agentId
  if (run.stage === "plan") return run.planReviewer === agentId && run.planReview !== undefined
  if (run.stage === "dev") return run.worker === agentId || run.arbiter === agentId
  if (run.stage === "review") return run.reviewer === agentId || run.splitter === agentId || (run.reviewGroups ?? []).some(g => g.reviewer === agentId)
  if (run.stage === "qa-integration") return run.verifier === agentId
  if (run.stage === "qa") return run.impact?.agent === agentId
  return false
}

// the main session's files the hook judges: its own work, 2-plan.md in
// plan (at advance) and qa.md in qa (right after its write). Every other file it writes is not a judgment.
const MAIN_FILES: Partial<Record<Stage, string[]>> = { plan: ["2-plan.md"], qa: ["agent/qa.md"] }

// the main session's row. Every write goes through and every command
// runs as given; aside it runs counts for no check.
function master(stage: Stage): StageSpec {
  return { write: () => ({ allow: true }), artifacts: MAIN_FILES[stage] ?? [] }
}

// the rule of a Rein agent whose part is over: it reads, with commands
// that read and read-only git, and writes nothing.
const retired = (why: string): StageSpec => ({
  write: () => ({ deny: `D176: ${why}, so this agent writes nothing. Report to the main session and stop.` }),
  bash: (command, c) => readOnly(command, c.run.repos ?? [], c.root),
  toolRule: "D176",
  runnersOnly: true,
})

// $.fs has no append, so each line rereads and rewrites the newest trace
// file. The queue keeps concurrent hooks from overwriting each other's lines.
// The line goes to the run's folder in `state`, active unless a move says; a
// run moved out of active/ gets no active line, which would make the folder
// there again.
function trace($: EngineInterface, run: Run, event: Record<string, unknown>, state: RunState = "active"): Promise<void> {
  queue = queue.then(async () => {
    if (state === "active" && gone.has(run.runId)) return
    const t = new Date(await $.clock.now()).toISOString()
    const line = JSON.stringify({ t, ...event }) + "\n"
    const dir = await folderOf($, state, run.runId)
    const files = await traceFiles($, dir)
    const n = Math.max(files.length, 1)
    const path = `${dir}/${traceFile(n)}`
    const old = files.length > 0 ? await $.fs.read(path) : ""
    if (old !== "" && utf8Bytes(old) + utf8Bytes(line) > TRACE_LIMIT) await $.fs.write(`${dir}/${traceFile(n + 1)}`, line)
    else await $.fs.write(path, old + line)
  }).catch((err: unknown) => {
    // a failed write must not stop the session. Not awaited, so a hook
    // that holds the store lock while it awaits a trace line does not wait
    // on itself.
    void traceBroke($, run.runId, err)
  })
  return queue
}

// the run folder's trace files that exist, oldest first: trace.jsonl,
// trace-2.jsonl, … up to the first one missing. A folder from before agent/
// gets a copy of its trace there first; the old files stay.
async function traceFiles($: EngineInterface, dir: string): Promise<string[]> {
  if (!(await $.fs.exists(`${dir}/${traceFile(1)}`))) {
    const before = (n: number) => `${dir}/${traceFile(n).replace("agent/", "")}`
    for (let n = 1; await $.fs.exists(before(n)); n++) await $.fs.write(`${dir}/${traceFile(n)}`, await $.fs.read(before(n)))
  }
  const names: string[] = []
  while (await $.fs.exists(`${dir}/${traceFile(names.length + 1)}`)) names.push(traceFile(names.length + 1))
  return names
}

// the first failed trace write of a run marks its record, which
// status shows, and toasts once in this session. A run whose record is gone
// (complete or dropped) gets the toast alone.
async function traceBroke($: EngineInterface, runId: string, err: unknown): Promise<void> {
  const problem = clip(err instanceof Error ? err.message : String(err))!
  if (!traceToasted.has(runId)) {
    traceToasted.add(runId)
    try {
      $.ui.toast(`Rein: ${runId}의 trace.jsonl 쓰기 실패 — 이 run의 기록은 여기서부터 빠짐 (${problem})`)
    } catch {}
  }
  try {
    const key = await recordKey($, runId)
    const at = new Date(await $.clock.now()).toISOString()
    await locked(async () => {
      const r = normalizeRun(await $.store.get(key))
      if (r && !r.traceBroken) await $.store.set(key, { ...r, traceBroken: { at, problem } })
    })
  } catch {}
}

function clip(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) + "…" : text
}

// moves a run folder; undefined when it moved, else why not. It runs
// as a job of the trace queue, so no trace line lands between: lines queued
// before go with the folder, and when `gate` says the run leaves active/,
// lines queued after are dropped rather than make active/<runId> again
// (gate.out), or allowed again once it is back (gate.out false).
function moveFolder($: EngineInterface, from: string, to: string, gate?: { runId: string; out: boolean }): Promise<string | undefined> {
  let out: string | undefined = `the move from ${from} to ${to} did not run`
  queue = queue.then(async () => {
    out = await relocate($, from, to)
    if (out === undefined && gate) {
      if (gate.out) gone.add(gate.runId)
      else gone.delete(gate.runId)
    }
  }).catch(() => {})
  return queue.then(() => out)
}

// The source must exist and the destination must not. On Windows PowerShell
// does it (MOVE_PS), elsewhere mkdir -p and mv. A move that exited 0 is
// checked by its destination only.
async function relocate($: EngineInterface, from: string, to: string): Promise<string | undefined> {
  if (!(await $.fs.exists(from))) return `${from} does not exist`
  if (await $.fs.exists(to)) return `${to} already exists`
  const said = (r: { stdout: string; stderr: string }) => (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/)[0]!.slice(0, 300)
  try {
    if (/^[A-Za-z]:\//.test(from)) {
      const r = await $.process.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", MOVE_PS], { env: { REIN_FROM: from, REIN_TO: to } })
      if (r.exitCode !== 0) return said(r) || `powershell exited ${r.exitCode}`
    } else {
      const made = await $.process.run(["mkdir", "-p", "--", to.slice(0, to.lastIndexOf("/"))])
      if (made.exitCode !== 0) return said(made) || `mkdir exited ${made.exitCode}`
      const r = await $.process.run(["mv", "--", from, to])
      if (r.exitCode !== 0) return said(r) || `mv exited ${r.exitCode}`
    }
  } catch (err) {
    return String(err)
  }
  return (await $.fs.exists(to)) ? undefined : `the move from ${from} to ${to} did not complete`
}

// the run leaves active/ for defer/, complete/ or drop/. In one
// store lock: the record must still be active and this session's, the folder
// moves, the record is checked again (a takeover meanwhile puts the folder
// back), then it becomes deferred (no owner) or goes, and the
// session's pointer goes. The trace line is written at the new place.
// Undefined when done, else why not; the run is then as it was, and the
// reason says where the folder is when putting it back failed. A run that
// ends (complete or drop) also gets `retro`, the line naming its
// retrospective, for the caller to end its answer with.
async function leaveActive($: EngineInterface, run: Run, to: "defer" | "complete" | "drop", event: Record<string, unknown>): Promise<{ problem: string } | { note: string; retro: string }> {
  const [key, pointer, session] = [await recordKey($, run.runId), await pointerKey($), await $.session.id()]
  const [from, dest] = [await folderOf($, "active", run.runId), await folderOf($, to, run.runId)]
  const owned = async () => {
    const r = normalizeRun(await $.store.get(key))
    return r?.status === "active" && r.owner === session ? r : undefined
  }
  // widened by hand: TypeScript does not see the writes in the locked callback.
  let folder = "moved" as "moved" | "there" | "missing"
  const problem = await locked(async () => {
    if (!(await owned())) return "the run is no longer this session's"
    // A folder already at the destination (an earlier move whose store change
    // did not follow), or gone from both places (deleted by hand or by a
    // Bash command), does not hold the run: the store changes all the same.
    if (!(await $.fs.exists(from))) {
      folder = (await $.fs.exists(dest)) ? "there" : "missing"
      gone.add(run.runId)
    } else {
      const moved = await moveFolder($, from, dest, { runId: run.runId, out: true })
      if (moved !== undefined) return moved
    }
    const now = await owned()
    if (!now) {
      if (folder !== "moved") return "another session took the run over meanwhile"
      const back = await moveFolder($, dest, from, { runId: run.runId, out: false })
      return `another session took the run over while its folder moved; ${back === undefined ? `the folder is back in ${from}` : `moving it back failed (${back}), so the folder is in ${dest}`}`
    }
    try {
      if (to === "defer") await $.store.set(key, { ...now, status: "defer", owner: undefined })
      else await $.store.delete(key)
    } catch (err) {
      if (folder !== "moved") return `the store could not be written (${String(err)})`
      const back = await moveFolder($, dest, from, { runId: run.runId, out: false })
      return `the store could not be written (${String(err)}); ${back === undefined ? `the folder is back in ${from}` : `moving it back failed (${back}), so the folder is in ${dest}`}`
    }
    if (((await $.store.get(pointer)) as Pointer | undefined)?.runId === run.runId) await $.store.delete(pointer)
    return undefined
  })
  if (problem !== undefined) {
    await trace($, run, { ev: "error", stage: run.stage, move: to, error: problem })
    return { problem }
  }
  await trace($, run, { ...event, state: to, ...(folder === "moved" ? {} : { folder }) }, to)
  closeFrame(run)
  const missing = ` The run folder ${from} was already gone (deleted by hand or by a command), so only the store changed; the run's files are lost apart from this trace line in ${dest}.`
  // the local frame server sends the run as it now is.
  await writeInfo($, run, to, to === "defer" ? "park" : to)
  const hub = to === "defer" && (await hubOf($)) ? " The local frame server sends it to the hub; before moving to another PC, mcp__rein__status shows whether anything is unsent." : ""
  return { note: (folder === "missing" ? missing : "") + hub, retro: to === "defer" ? "" : await retroFor($, dest) }
}

// the session closed the run in `dir`: remember it for the engine's
// check, and the line that sends the main session to the retrospective.
async function retroFor($: EngineInterface, dir: string): Promise<string> {
  const raw = slash(await $.session.root())
  const transcripts = await transcriptsOf($, dir)
  closed = { dir: resolve(dir, resolve(raw, raw)), transcripts }
  const read = transcripts.length > 0 ? `The main session's transcripts: ${transcripts.join(", ")}.` : "No transcript of the run's main session was found."
  return ` After you tell the user, invoke the rein:retro skill. Run folder: ${dir}. ${read}`
}

// the transcripts of the sessions that held the run as its main session:
// the ones its trace's load and resume lines name, and this one. Each is
// <config>/projects/<folder>/<session>.jsonl, in whatever folder Claude Code
// kept it. None when they cannot be listed: the retrospective goes without.
async function transcriptsOf($: EngineInterface, dir: string): Promise<string[]> {
  try {
    const sessions: string[] = []
    for (const name of await traceFiles($, dir)) {
      for (const line of (await $.fs.read(`${dir}/${name}`)).split("\n")) {
        try {
          const e = JSON.parse(line) as { ev?: unknown; session?: unknown }
          if ((e.ev === "load" || e.ev === "resume") && typeof e.session === "string") sessions.push(e.session)
        } catch {}
      }
    }
    sessions.push(await $.session.id())
    return await transcriptsFor($, sessions)
  } catch {
    return []
  }
}

// the images the user pasted into the run's main sessions, each from when
// it took the run (its trace's load and resume lines), saved in the run
// folder's brief/ as paste-1.png, paste-2.png, … in paste order (pasteName);
// a name there already is kept, so saving again adds only later pastes.
// A failure costs only the copies.
async function savePastes($: EngineInterface, run: Run): Promise<void> {
  try {
    const dir = await folderOf($, "active", run.runId)
    const since = new Map<string, number>()
    for (const name of await traceFiles($, dir)) {
      for (const line of (await $.fs.read(`${dir}/${name}`)).split("\n")) {
        try {
          const e = JSON.parse(line) as { ev?: unknown; session?: unknown; t?: unknown }
          if ((e.ev === "load" || e.ev === "resume") && typeof e.session === "string" && typeof e.t === "string" && !since.has(e.session)) since.set(e.session, Date.parse(e.t))
        } catch {}
      }
    }
    const transcripts: { lines: string[]; since: number }[] = []
    for (const [session, t] of since) {
      const [path] = await transcriptsFor($, [session])
      if (path === undefined) continue
      const r = await $.process.run(["node", "-e", USER_LINES_JS], { env: { REIN_FILE: path }, timeoutMs: 60_000 })
      if (r.exitCode === 0) transcripts.push({ lines: r.stdout.split(/\r?\n/), since: t })
    }
    for (const [i, image] of pastedImages(transcripts).entries()) {
      const to = `${dir}/brief/${pasteName(i + 1, image.mediaType)}`
      if (!(await $.fs.exists(to))) await $.process.run(["node", "-e", WRITE_BYTES_JS], { env: { REIN_TO: to }, stdin: image.data })
    }
  } catch {}
}

// each session's <config>/projects/<folder>/<session>.jsonl that exists.
async function transcriptsFor($: EngineInterface, sessions: string[]): Promise<string[]> {
  const home = (await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME"))
  const config = (await $.env.get("CLAUDE_CONFIG_DIR")) ?? (home && `${home}/.claude`)
  if (!config) return []
  const projects = `${slash(config)}/projects`
  if (!(await $.fs.exists(projects))) return []
  const folders = (await $.fs.list(projects)).filter(f => f.kind === "dir")
  const found: string[] = []
  // a session id is a name, never a path.
  for (const s of new Set(sessions.filter(s => /^[A-Za-z0-9_-]+$/.test(s)))) {
    for (const f of folders) {
      const path = `${projects}/${f.name}/${s}.jsonl`
      if (!found.includes(path) && (await $.fs.exists(path))) found.push(path)
    }
  }
  return found
}

// the session's name as its transcript last records it (/rename, --name or
// a hook's; the AI title is another line), or undefined when it has none or
// the transcript cannot be read. A long session's transcript is past what
// $.fs.read takes, so PowerShell on Windows, grep elsewhere, picks the
// lines; file and pattern come in through the environment, as in MOVE_PS.
async function sessionTitle($: EngineInterface): Promise<string | undefined> {
  try {
    const [path] = await transcriptsFor($, [await $.session.id()])
    if (path === undefined) return undefined
    const env = { REIN_FILE: path, REIN_PATTERN: '{"type":"custom-title"' }
    const r = /^[A-Za-z]:\//.test(path)
      ? await $.process.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", TITLE_PS], { env })
      : await $.process.run(["grep", "-F", "--", env.REIN_PATTERN, path])
    const line = r.exitCode === 0 ? r.stdout.trim().split(/\r?\n/).at(-1) : undefined
    if (!line) return undefined
    const title = (JSON.parse(line) as { customTitle?: unknown }).customTitle
    return typeof title === "string" ? title : undefined
  } catch {
    return undefined
  }
}

// whether a read or write of the retrospective is one the engine's check
// may pass without asking: a read in the closed run's folder, of one of its
// transcripts or of the project's domain rules and knowledge (to tell what
// they already hold), a write of its retro.md where it really lands.
async function retroAllows($: EngineInterface, run: { dir: string; transcripts: string[] }, tool: string, input: Record<string, unknown>): Promise<boolean> {
  const raw = slash(await $.session.root())
  const root = resolve(raw, raw)
  if (READ_TOOLS.has(tool)) {
    const at = input.file_path ?? input.path
    if (typeof at !== "string" || climbs(at)) return false
    const reach = tool === "Glob" ? input.pattern : tool === "Grep" ? input.glob : undefined
    if (typeof reach === "string" && (climbs(reach) || isAbsolute(reach))) return false
    const path = resolve(at, root)
    const project = await projectDir($)
    const dirs = [run.dir, resolve(`${project}/knowledge`, root), resolve(`${project}/rules`, root), resolve(sharedRulesOf(project), root)]
    return dirs.some(d => same(path, d) || under(path, d)) || run.transcripts.some(t => same(resolve(t, root), path))
  }
  const path = writeTarget(input, root)
  const retro = `${run.dir}/agent/retro.md`
  if (path === undefined || !same(path, retro)) return false
  const real = await landing($, path, root)
  return real !== undefined && same(real, retro)
}

// once per module, each v0.2.0 key run:<sessionId> whose run this
// project really holds becomes a slug record.
function migrated($: EngineInterface): Promise<void> {
  migration ??= migrateLegacy($).catch(() => {})
  return migration
}

async function migrateLegacy($: EngineInterface): Promise<void> {
  for (const key of (await $.store.keys()).filter(k => k.startsWith("run:"))) await migrateKey($, key)
}

// one v0.2.0 key. Its run is this project's only when the folder
// <project>/<runId>/ has the load line v0.2.0 wrote on opening it with that
// session's id: finished runs left folders behind, so a folder of the same
// name may be another project's. This session's own run becomes active and
// owned by it, unless the session already points to a run; any other is
// deferred, and its session points to it, so a session running this module
// hears it is gone. Folder first, then the store. This session's own
// run that cannot move holds the session (legacyHeld) until it does.
async function migrateKey($: EngineInterface, key: string): Promise<void> {
  const [base, project, session] = [await projectDir($), await projectName($), await $.session.id()]
  const sid = key.slice("run:".length)
  const own = sid === session
  const run = normalizeRun(await $.store.get(key))
  const skip = () => {
    if (own) legacyHeld = undefined
  }
  if (!run || typeof run.runId !== "string" || !RUN_ID.test(run.runId) || RESERVED.has(run.runId)) return skip()
  const [from, target] = [`${base}/${run.runId}`, `runs:${project}/${run.runId}`]
  if ((await $.store.get(target)) !== undefined || !(await openedBy($, from, sid))) return skip()
  const active = own && (await $.store.get(`session:${session}`)) === undefined
  const state: RunState = active ? "active" : "defer"
  const problem = await moveFolder($, from, `${base}/${state}/${run.runId}`)
  if (problem !== undefined) {
    if (active) legacyHeld = { runId: run.runId, problem, at: await $.clock.now() }
    return
  }
  skip()
  await $.store.set(target, active ? { ...run, status: "active", owner: session } : { ...run, status: "defer", owner: undefined, busy: undefined })
  if (!own || active) await $.store.set(`session:${sid}`, { project, runId: run.runId })
  await $.store.delete(key)
  await trace($, run, { ev: "migrate", from: key, state, session }, state)
}

// v0.2.0's open_run wrote {"ev":"load", "session": <id>, ...} as the
// first lines of trace.jsonl in the run folder.
async function openedBy($: EngineInterface, dir: string, sid: string): Promise<boolean> {
  const path = `${dir}/trace.jsonl`
  if (!(await $.fs.exists(path))) return false
  for (const line of (await $.fs.read(path)).split(/\r?\n/)) {
    try {
      const ev = JSON.parse(line) as Record<string, unknown> | null
      if (ev?.ev === "load" && ev.session === sid) return true
    } catch {
      // not a JSON line
    }
  }
  return false
}

type Resumable = { runId: string; title: string; stage: Stage; state: "defer" | "active"; waits: string[] }

// the skills the person may type to take the run on from where it stops for
// them: the next stage's once spec or plan stopped (waits, while the stage
// and the file are as they were then), /rein:land or /rein:e2e while
// integration qa waits. dir is the run's folder.
async function waitsFor($: EngineInterface, run: Run, dir: string): Promise<string[]> {
  if (run.stage === "qa-integration" && run.e2e?.path === "wait" && !run.halt) return ["/rein:land", "/rein:e2e"]
  if (run.stage === "qa-integration" && run.halt?.rule === "layout-unchecked") return ["/rein:land"]
  const w = run.waits
  if (!w || w.stage !== run.stage) return []
  const path = `${dir}/${w.stage === "spec" ? "1-spec.md" : "2-plan.md"}`
  if (!(await $.fs.exists(path)) || (await sha256Text(await $.fs.read(path))) !== w.hash) return []
  return [w.stage === "spec" ? "/rein:plan" : "/rein:dev"]
}

// the runs this session may resume: this project's deferred runs and
// the active ones another session owns (it may have closed without parking).
async function resumable($: EngineInterface): Promise<Resumable[]> {
  await migrated($)
  const [prefix, session] = [`runs:${await projectName($)}/`, await $.session.id()]
  const out: Resumable[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const run = normalizeRun(await $.store.get(key))
    if (!run || (run.status === "active" && run.owner === session)) continue
    const state = run.status === "defer" ? "defer" : "active"
    out.push({ runId: run.runId, stage: run.stage, state, title: await titleOf($, state, run.runId), waits: await waitsFor($, run, await folderOf($, state, run.runId)) })
  }
  return out
}

// The first `# ` line of the run's 1-spec.md, or of spec.md in a folder
// from before the files were numbered (it gets 1-spec.md on resume).
async function titleOf($: EngineInterface, state: RunState, runId: string): Promise<string> {
  const places = [await folderOf($, state, runId), await folderOf($, "active", runId)]
  let path: string | undefined
  for (const name of ["1-spec.md", "spec.md"]) {
    for (const dir of places) if (path === undefined && (await $.fs.exists(`${dir}/${name}`))) path = `${dir}/${name}`
  }
  if (path === undefined) return "(no 1-spec.md)"
  const line = (await $.fs.read(path)).split(/\r?\n/).find(l => l.startsWith("# "))
  return line ? line.slice(2).trim().slice(0, 200) : "(1-spec.md has no title)"
}

// The run files under the names they had before. Only the files the user
// reads carry their stage's number and stay in the run folder; the others
// are in its agent/. Before, every file did, and before that none, and
// before agent/ the unnumbered ones were in the folder itself. A folder
// from then gets a copy under each new name it lacks, so the hook reads
// only the new names; the old files stay. Newer names come first: in a
// folder that has several, they are the newer. The screenshots stay where
// they are: a check's record names its folder.
const OLD_NAMES: [string, string][] = [
  ["grade.md", "agent/grade.md"], ["test-plan.md", "agent/test-plan.md"], ["dev-items.md", "agent/dev-items.md"],
  ["dev-diff.md", "agent/dev-diff.md"], ["deviation.md", "agent/deviation.md"], ["review.md", "agent/review.md"],
  ["review-groups.md", "agent/review-groups.md"], ["qa.md", "agent/qa.md"], ["qa-output.log", "agent/qa-output.log"],
  ["e2e.md", "agent/e2e.md"], ["land-review.md", "agent/land-review.md"], ["evidence/ego-guide.md", "agent/evidence/ego-guide.md"],
  ["1-spec.html", "1-mockup.html"], ["1-grade.md", "agent/grade.md"], ["2-test-plan.md", "agent/test-plan.md"],
  ["3-dev-items.md", "agent/dev-items.md"], ["3-dev.md", "agent/dev-diff.md"], ["3-deviation.md", "agent/deviation.md"], ["4-review.md", "agent/review.md"],
  ["5-qa.md", "agent/qa.md"], ["5-qa-output.log", "agent/qa-output.log"], ["5-e2e.md", "agent/e2e.md"], ["6-land-review.md", "agent/land-review.md"],
  ["spec.md", "1-spec.md"], ["spec.html", "1-mockup.html"], ["plan.md", "2-plan.md"], ["dev.md", "agent/dev-items.md"],
  ["qa-integration.md", "agent/e2e.md"], ["land.md", "6-land.md"],
]

async function renameFiles($: EngineInterface, dir: string): Promise<void> {
  const groups: [string, string][] = []
  for (let n = 1; await $.fs.exists(`${dir}/review-${n}.md`); n++) groups.push([`review-${n}.md`, groupFile(n)])
  for (const [old, now] of [...OLD_NAMES, ...groups]) {
    if ((await $.fs.exists(`${dir}/${old}`)) && !(await $.fs.exists(`${dir}/${now}`))) await $.fs.write(`${dir}/${now}`, await $.fs.read(`${dir}/${old}`))
  }
}

const resumableLines = (list: Resumable[]) =>
  list.map(r => `- ${r.runId}: ${r.title} (stage ${r.stage}${r.waits.length > 0 ? `, waits for ${r.waits.join(" or ")}` : ""}, ${r.state === "defer" ? "deferred" : "active in another session"})`).join("\n")

// the hub server from ~/.rein/sync.json (none: the hub is off) and this
// PC's name. A file that names only the git remote Rein used before is
// legacy: nothing goes anywhere, and status says so. A dispatch reads it
// once; down is why a call of that dispatch went unanswered.
type Hub = { server: string; pc: string; home: string; down?: string }

async function hubConfig($: EngineInterface): Promise<Hub | { legacy: true } | undefined> {
  const project = await projectDir($)
  const home = project.slice(0, project.lastIndexOf("/"))
  const path = `${home}/sync.json`
  if (!(await $.fs.exists(path))) return undefined
  let said: { server?: unknown; remote?: unknown } | null
  try {
    said = JSON.parse(await $.fs.read(path)) as { server?: unknown; remote?: unknown } | null
  } catch {
    return undefined
  }
  const server = typeof said?.server === "string" ? said.server.trim().replace(/\/+$/, "") : ""
  if (!/^https?:\/\/./.test(server)) return typeof said?.remote === "string" && said.remote.trim() !== "" ? { legacy: true } : undefined
  const pc = (await $.env.get("COMPUTERNAME")) ?? (await $.env.get("HOSTNAME")) ?? (await (hostName ??= hostOf($)))
  return { server, pc, home }
}

async function hubOf($: EngineInterface): Promise<Hub | undefined> {
  const hub = await hubConfig($)
  return hub && "server" in hub ? hub : undefined
}

// macOS and Linux shells export neither name. On a Mac, LocalHostName:
// `hostname` there follows the network it joined. Asked once a session.
let hostName: Promise<string> | undefined
const UNNAMED = "unknown"

async function hostOf($: EngineInterface): Promise<string> {
  for (const argv of [["scutil", "--get", "LocalHostName"], ["hostname"]]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 10_000 })
      const name = (r.stdout ?? "").trim()
      if (r.exitCode === 0 && name !== "") return name
    } catch {}
  }
  return UNNAMED
}

// $.http.fetch takes no signal, so a hub call that hangs is cut by a race,
// as in reachable(): no answer within HUB_MS counts as offline. The wait
// runs on the hook's own 10 s budget, so once a call of a dispatch goes
// unanswered the dispatch asks the hub nothing more (hub.down), but for one
// look whether an unanswered claim reached it: no dispatch waits out more
// than two hangs.
const HUB_MS = 2500
// the local frame server's last look at the hub holds this long: a hub it
// found unreachable is not asked again meanwhile.
const OFFLINE_MS = 60_000
// the server writes status.json at least every minute; one older than this
// was left by a server that no longer runs.
const STALE_MS = 3 * 60_000
// the store key the git sync kept its failed sends under; the local frame
// server's reconcile does that job now.
const OLD_PENDING = "sync:pending"

type HubAnswer = { status: number; json: unknown } | { offline: string }

// one call of the hub API, as this PC; an answer that is no JSON, a
// failure and a hang are offline.
async function hubFetch($: EngineInterface, hub: Hub, method: string, path: string, body?: unknown): Promise<HubAnswer> {
  if (hub.down !== undefined) return { offline: hub.down }
  const seen = await hubState($, hub)
  if (seen?.reachable === false && seen.checkedAt !== undefined && (await $.clock.now()) - Date.parse(seen.checkedAt) < OFFLINE_MS) return { offline: seen.error ?? "the local frame server could not reach it" }
  const headers: Record<string, string> = { "x-rein-pc": hub.pc, "x-rein-client": `hook/${VERSION}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }
  const answer = $.http.fetch(`${hub.server}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }).then(
    (r): HubAnswer => {
      try {
        return { status: r.status, json: r.text === "" ? undefined : JSON.parse(r.text) }
      } catch {
        return { offline: `the hub answered ${r.status} with no JSON` }
      }
    },
    (err: unknown): HubAnswer => ({ offline: String(err) }),
  )
  const hang = $.clock.sleep(HUB_MS).then((): HubAnswer => ({ offline: `no answer within ${HUB_MS / 1000} s` }), (): HubAnswer => ({ offline: "no answer" }))
  const got = await Promise.race([answer, hang])
  if ("offline" in got) hub.down = got.offline
  return got
}

const runPath = (project: string, runId: string) => `/api/runs/${encodeURIComponent(project)}/${encodeURIComponent(runId)}`

// ~/.rein/.hub/status.json as the local frame server last wrote it, and
// whether that is stale; undefined when there is none to read.
async function hubState($: EngineInterface, hub: Hub): Promise<(HubStatus & { stale: boolean }) | undefined> {
  const path = `${hub.home}/.hub/status.json`
  if (!(await $.fs.exists(path))) return undefined
  try {
    const st = JSON.parse(await $.fs.read(path)) as HubStatus | null
    if (!st || typeof st !== "object") return undefined
    return { ...st, stale: !((await $.clock.now()) - Date.parse(st.at ?? "") <= STALE_MS) }
  } catch {
    return undefined
  }
}

// the local frame server, started unless one runs, looks at the hub again
// now (`node frame/server.js kick`). Its time is not the hook's; a failure
// costs only the sending.
async function kick($: EngineInterface): Promise<void> {
  try {
    await $.process.run(["node", `${slash($.plugin.root)}/frame/server.js`, "kick"], { timeoutMs: 5000 })
  } catch {}
}

// agent/record.json in the run's folder in `state`, while a hub is set:
// what the hub lists of the run and, while it is active or deferred, its
// record with its paths relative (toPortable), for another PC to take it up.
// The local frame server sends it with the run's other files. A failure
// costs only the listing.
async function writeInfo($: EngineInterface, run: Run, state: RunState, event: string): Promise<void> {
  if (!(await hubOf($))) return
  try {
    const raw = slash(await $.session.root())
    const port = state === "active" || state === "defer" ? toPortable(run, resolve(raw, raw), await projectDir($)) : undefined
    const info = {
      v: 1, uid: run.uid, project: await projectName($), runId: run.runId, stage: run.stage, title: await titleOf($, state, run.runId),
      at: new Date(await $.clock.now()).toISOString(), event, portable: port?.portable ?? true, ...(port ? { run: port.run } : {}),
    }
    await $.fs.write(`${await folderOf($, state, run.runId)}/agent/record.json`, `${JSON.stringify(info, null, 2)}\n`)
  } catch {}
}

// the PC that holds the run on the hub when it is not this one: when
// `ask`, as the hub's record says, its uid the run's (another uid, or one
// missing on either side, is a collision: not this run); not asked or with
// the hub not answering, as the local frame server last found (status.json's
// lost), unless status.json is stale or found it before this PC last took
// the run up from the hub. A record naming no PC came from one that could
// not read its name (a Mac or Linux PC before hostOf): it is taken as this
// PC's. Undefined when nothing says so.
async function heldBy($: EngineInterface, hub: Hub, run: Run, ask: boolean): Promise<string | undefined> {
  const project = await projectName($)
  const got = ask ? await hubFetch($, hub, "GET", runPath(project, run.runId)) : undefined
  if (got && !("offline" in got) && (got.status === 200 || got.status === 404)) {
    const rec = got.status === 200 ? (got.json as { record?: HubRecord } | undefined)?.record : undefined
    return rec !== undefined && rec.pc !== hub.pc && rec.pc !== UNNAMED && rec.uid !== undefined && rec.uid === run.uid ? rec.pc : undefined
  }
  const st = await hubState($, hub)
  const since = (at: string | undefined) => run.claimed === undefined || Date.parse(at ?? "") >= Date.parse(run.claimed)
  return st && !st.stale ? st.lost?.find(l => l.project === project && l.runId === run.runId && since(l.at))?.pc : undefined
}

// advance, goto and park go by status.json alone, with no hub call: a run
// the local frame server found taken over is let go.
async function lostHere($: EngineInterface, run: Run): Promise<ToolCallResult | undefined> {
  const hub = await hubOf($)
  const pc = hub && (await heldBy($, hub, run, false))
  return pc ? { result: await loseToPc($, run, pc) } : undefined
}

// where this PC's copy of a run another PC holds goes: outside the state
// folders, so the local frame server sends it nowhere.
async function lostFolder($: EngineInterface, runId: string): Promise<string> {
  return `${await projectDir($)}/.lost/${runId}-${new Date(await $.clock.now()).toISOString().replace(/\D/g, "").slice(0, 14)}`
}

// the run passed a stage here while another PC holds it: this
// session lets it go, and this PC's copy goes to .lost/.
async function loseToPc($: EngineInterface, run: Run, pc: string): Promise<string> {
  const [key, pointer, session] = [await recordKey($, run.runId), await pointerKey($), await $.session.id()]
  const [from, dest] = [await folderOf($, "active", run.runId), await lostFolder($, run.runId)]
  await trace($, run, { ev: "lost", pc, rule: "D220" })
  const moved = await locked(async () => {
    const r = normalizeRun(await $.store.get(key))
    if (r?.status === "active" && r.owner === session) await $.store.delete(key)
    if (((await $.store.get(pointer)) as Pointer | undefined)?.runId === run.runId) await $.store.delete(pointer)
    return (await $.fs.exists(from)) ? moveFolder($, from, dest, { runId: run.runId, out: true }) : undefined
  })
  const where = moved === undefined ? dest : from
  return `D220: PC ${pc} took the run ${run.runId} over (it resumed it from the hub), so it is no longer this PC's. This session has no run now; this PC's copy is in ${where}. Tell the user.`
}

// the hub as the local frame server last found it, and what it found at
// odds; a server that wrote nothing lately is not running, so it is started.
// "" when no hub is set.
async function hubLines($: EngineInterface): Promise<string> {
  const hub = await hubConfig($)
  if (!hub) return ""
  if (!("server" in hub)) return "\nsync.json still names a git remote, which Rein no longer uses; /rein:setup sets the hub."
  const st = await hubState($, hub)
  if (!st || st.stale) {
    await kick($)
    return `\nHub ${hub.server}: the local frame server is not running; nothing is being sent. It was started now.`
  }
  const unsent = st.unsent ?? 0
  const head = st.reachable === false
    ? `Hub ${hub.server}: 서버에 닿지 않음, 미전송 ${unsent}건 (last reached ${st.lastOkAt ?? "never"}${st.error ? `; ${clip(st.error)}` : ""})`
    : `Hub ${hub.server}: reached ${st.lastOkAt ?? st.checkedAt ?? st.at}, ${unsent > 0 ? `${unsent} files still to send` : "nothing unsent"}`
  const project = await projectName($)
  const lines = [
    ...(st.lost ?? []).filter(l => l.project === project).map(l => `- ${l.runId}: PC ${l.pc} took it over on the hub (D220), so this PC's copy${l.local ? ` (${l.local})` : ""} is not sent; resuming it here or moving it on lets this copy go to ${hub.home}/${project}/.lost/. Tell the user.`),
    ...(st.collisions ?? []).filter(c => c.project === project).map(c => `- ${c.runId}: PC ${c.pc} has another run of this name on the hub, so this PC's run is not sent; it stays on this PC only. Tell the user.`),
    ...(st.conflicts ?? []).map(c => `- ${c.kind} ${c.path ?? `${c.project}/${c.runId}`}: changed here and on the hub since they last agreed; ${c.kind === "retro" ? "/learn" : "/rein:setup"} resolves it.`),
  ]
  return `\n${head}${lines.length > 0 ? `\n${lines.join("\n")}` : ""}`
}

// the runs of this project the store records.
async function localRuns($: EngineInterface, project: string): Promise<Set<string>> {
  return new Set((await $.store.keys()).filter(k => k.startsWith(`runs:${project}/`)).map(k => k.slice(`runs:${project}/`.length)))
}

// with no run open, this project's runs on the hub that are news to this
// PC, the newest HUB_SHOWN, each with its link in the hub's frame; with
// runId, that run's documents fetched to read instead.
const HUB_SHOWN = 20

async function hubRunLines($: EngineInterface, runId: unknown): Promise<string> {
  const hub = await hubOf($)
  if (!hub) return ""
  const project = await projectName($)
  if (typeof runId === "string" && runId !== "") return hubDocs($, hub, project, runId)
  const got = await hubFetch($, hub, "GET", `/api/hub/runs?project=${encodeURIComponent(project)}`)
  if ("offline" in got || got.status !== 200) return `\nD221: the hub did not answer (${"offline" in got ? clip(got.offline) : `status ${got.status}`}); hub runs are not listed.`
  const local = await localRuns($, project)
  const runs = (got.json as { runs?: HubRun[] } | undefined)?.runs ?? []
  const shown = runs.filter(r => !(r.pc === hub.pc && local.has(r.runId))).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, HUB_SHOWN)
  if (shown.length === 0) return ""
  const lines = shown.map(r => {
    const where = r.state === "active" ? `active on ${r.pc}` : r.state === "defer" ? `deferred on ${r.pc}` : r.state === "complete" ? `complete on ${r.pc}` : `dropped on ${r.pc}`
    const can = r.resumable && !local.has(r.runId) ? "; resumable" : !r.portable && (r.state === "active" || r.state === "defer") ? "; view only, it uses a repository outside the session root (D214)" : ""
    return `- ${r.runId}: ${r.title} (stage ${r.stage}, ${where}, updated ${r.at}${can}) ${r.link}`
  })
  return `\nRuns on the hub (D219; mcp__rein__resume with the runId takes up a resumable one, the user confirms; mcp__rein__status with the runId fetches its documents to read):\n${lines.join("\n")}`
}

// Node removes a folder whole, which $.fs cannot.
const REMOVE_JS = "require('fs').rmSync(process.env.REIN_TO, { recursive: true, force: true })"

// one hub run's documents (its md and html files) in
// ~/.rein/.hub/docs/<project>/<runId>/, the folder replaced.
async function hubDocs($: EngineInterface, hub: Hub, project: string, runId: string): Promise<string> {
  if (!RUN_ID.test(runId)) return `\n${runId} is no slug, so no documents were fetched.`
  const got = await hubFetch($, hub, "GET", `${runPath(project, runId)}/docs`)
  if ("offline" in got) return `\nD221: the hub did not answer (${clip(got.offline)}); the documents of ${runId} were not fetched.`
  if (got.status === 404) return `\nThe hub has no run ${runId} in this project.`
  const docs = got.json as { files?: Record<string, string>; skipped?: string[] } | undefined
  if (got.status !== 200 || !docs?.files) return `\nD221: the hub answered ${got.status}; the documents of ${runId} were not fetched.`
  const dir = `${hub.home}/.hub/docs/${project}/${runId}`
  await $.process.run(["node", "-e", REMOVE_JS], { env: { REIN_TO: dir }, timeoutMs: 30_000 }).catch(() => {})
  const names = Object.keys(docs.files).filter(rel => rel !== "" && !climbs(rel) && !isAbsolute(rel) && !/[:\\]/.test(rel))
  for (const rel of names) await $.fs.write(`${dir}/${rel}`, docs.files[rel]!)
  const skipped = docs.skipped && docs.skipped.length > 0 ? ` Past the size cap, not fetched: ${docs.skipped.join(", ")}.` : ""
  return `\nThe documents of ${runId} on the hub are in ${dir} (${names.length} files), to read.${skipped}`
}

// the run's files from the hub into `dest` (`node frame/sync.js pull-run`,
// which downloads beside it and renames the folder into place; its last
// line says {"ok":true,"files":n} or {"error":...}); undefined when they are
// there, else why not. Its time is not the hook's.
async function pullRun($: EngineInterface, hub: Hub, project: string, runId: string, dest: string): Promise<string | undefined> {
  let r: { exitCode: number; stdout: string; stderr: string }
  try {
    r = await $.process.run(["node", `${slash($.plugin.root)}/frame/sync.js`, "pull-run", "--server", hub.server, "--pc", hub.pc, project, runId, dest], { timeoutMs: 180_000 })
  } catch (err) {
    return String(err)
  }
  try {
    const said = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? "") as { ok?: unknown; error?: unknown }
    return said.ok === true ? undefined : typeof said.error === "string" ? said.error : firstLine(r)
  } catch {
    return firstLine(r)
  }
}

// the store's limit (the engine refuses a write past it) and where the
// hook starts to warn.
const STORE_LIMIT = 4 * 1024 * 1024
const STORE_WARN = 3 * 1024 * 1024

// about the size of the store's JSON text in UTF-8 bytes, and each run
// record's, the largest first.
async function storeUse($: EngineInterface): Promise<{ total: number; records: { name: string; state: string; bytes: number }[] }> {
  const encoder = new TextEncoder()
  let total = 2
  const records: { name: string; state: string; bytes: number }[] = []
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    const bytes = encoder.encode(`${JSON.stringify(key)}:${JSON.stringify(value)},`).length
    total += bytes
    if (key.startsWith("runs:")) records.push({ name: key.slice("runs:".length), state: String(normalizeRun(value)?.status ?? "?"), bytes })
  }
  return { total, records: records.sort((a, b) => b.bytes - a.bytes) }
}

// a warning once the store holds STORE_WARN or more, naming the largest
// run records; undefined below it, or when the store cannot be read.
async function storeWarning($: EngineInterface): Promise<string | undefined> {
  try {
    const { total, records } = await storeUse($)
    if (total < STORE_WARN) return undefined
    const mib = (n: number) => (n / 1024 / 1024).toFixed(1)
    const lines = records.slice(0, 10).map(r => `- ${r.name} (${r.state}, ${Math.ceil(r.bytes / 1024)} KB)`)
    return `Rein's store on this PC holds about ${mib(total)} MiB of its ${mib(STORE_LIMIT)} MiB, shared by every project; past it every Rein judgment that records something is refused. The largest run records (project/runId):\n${lines.join("\n")}\nA run no one will carry on frees its record when it is dropped: in that project's repository, mcp__rein__resume it, then mcp__rein__park with 폐기. Tell the user.`
  } catch {
    return undefined
  }
}

// A stage rule that throws would let the call through (a throwing hook is
// absent), so it refuses instead and leaves an error line. A full
// store is the likely cause when it is near its limit, so that is said too.
async function failClosed($: EngineInterface, run: Run | undefined, tool: string, err: unknown): Promise<ToolCallResult> {
  if (run) await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
  const full = await storeWarning($)
  return { deny: `Rein: a hook rule failed (${String(err)}), so the call is refused. Try again; if it keeps failing, tell the user.${full ? `\n${full}` : ""}` }
}

async function verdictOf($: EngineInterface, stage: StageSpec, path: string | undefined, c: Ctx): Promise<string | undefined> {
  const verdict = stage.write(path, c)
  if ("allow" in verdict) return undefined
  if ("repo" in verdict && (await $.fs.exists(`${verdict.repo}/.git`))) return undefined
  return verdict.deny
}

// Where a path really lands: the realPath of its nearest existing ancestor
// (links, junctions, case aliases followed, as the d.ts advises for a guard)
// plus the rest; undefined when nothing on the way resolves.
async function landing($: EngineInterface, path: string, root: string): Promise<string | undefined> {
  let dir = path
  const rest: string[] = []
  for (let i = 0; i < 256; i++) {
    const real = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath
    if (real !== undefined) return resolve([slash(real), ...rest].join("/"), root)
    const cut = dir.lastIndexOf("/")
    const up = cut <= 0 ? "/" : dir.slice(0, cut)
    const next = /^[A-Za-z]:$/.test(up) ? `${up}/` : up
    if (next === dir) return undefined
    rest.unshift(dir.slice(cut + 1))
    dir = next
  }
  return undefined
}

// The stage's verdict on a write; undefined lets it through. A write
// the spelling allows must be allowed where it really lands too, with the
// run directory and session root resolved the same way.
async function writeDeny($: EngineInterface, stage: StageSpec, path: string | undefined, c: Ctx): Promise<string | undefined> {
  const verdict = await verdictOf($, stage, path, c)
  if (verdict !== undefined || path === undefined) return verdict
  const [real, dir, root] = await Promise.all([landing($, path, c.root), landing($, c.dir, c.root), landing($, c.root, c.root)])
  if (real === undefined) return "D46: the hook cannot tell where this path lands on disk, so it refuses the write."
  if (same(real, path) && same(dir ?? c.dir, c.dir) && same(root ?? c.root, c.root)) return undefined
  return verdictOf($, stage, real, { ...c, dir: dir ?? c.dir, root: root ?? c.root })
}

// the hook shows the run's progress itself, in the frame: from when the run
// opens or is picked back up (resume) until it leaves active, it writes the
// run's status (pane.ts) to agent/frame.json in the run folder, which the
// frame server reads, and it makes sure the server runs (ensureFrame). Every
// session does, wherever it runs. A failure here costs only the frame.
async function openFrame($: EngineInterface, run: Run): Promise<void> {
  framed = { runId: run.runId, file: `${await folderOf($, "active", run.runId)}/${FRAME_FILE}` }
  await redraw($, run)
}

// the run left active: its folder moved, so nothing is written for it any
// more. A write queued before the move went with the folder, one queued
// after it is dropped (writeFrame).
function closeFrame(run: Run): void {
  if (framed?.runId !== run.runId) return
  framed = undefined
  served = undefined
}

// the frame draws from frame.json, so a change to what it shows is a write
// of that file.
async function redraw($: EngineInterface, run: Run): Promise<void> {
  lastRun = run
  if (framed?.runId !== run.runId) return
  await writeFrame($, framed.runId, framed.file, run)
}

// The writes are jobs of the trace queue, one after another in the order
// they were asked for, so an older one never lands over a newer, and one
// that comes after the folder left active/ is dropped rather than make
// active/<runId> again (gone). A write that fails must not stop the session;
// the next change writes the whole status again.
function writeFrame($: EngineInterface, runId: string, file: string, run: Run): Promise<void> {
  const status = frameStatus(run, activity, Date.now())
  queue = queue.then(async () => {
    if (gone.has(runId)) return
    await $.fs.write(file, JSON.stringify(status))
  }).catch(() => {})
  return queue
}

// the frame server, made sure of as the run opens, is picked back up and
// enters each stage, not on every call: `node frame/server.js ensure` starts
// it unless one runs already, and prints {"url","started"} (or {"error"}).
// The URL is told to the main session with the next result of a Rein tool it
// gets (withFrameUrl) when the server was just started, or when the run is
// new to this session's frame (opened, resumed, or a session starting with
// it): a server another run started earlier is otherwise never named. A
// failure here costs only the frame.
async function ensureFrame($: EngineInterface, run: Run): Promise<void> {
  if (framed?.runId !== run.runId || (served?.runId === run.runId && served.stage === run.stage)) return
  const fresh = served?.runId !== run.runId
  served = { runId: run.runId, stage: run.stage }
  try {
    const r = await $.process.run(["node", `${slash($.plugin.root)}/frame/server.js`, "ensure"], { timeoutMs: 10_000 })
    const said = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? "") as { url?: unknown; started?: unknown }
    if ((said.started === true || fresh) && typeof said.url === "string") frameUrl = said.url
  } catch {}
}

// the frame server's URL, once, after the result it goes with.
function withFrameUrl(out: ToolCallResult): ToolCallResult {
  const url = frameUrl
  if (url === undefined || typeof out.result !== "string") return out
  frameUrl = undefined
  return { ...out, result: `${out.result} The run's progress and files are shown in the Rein frame, now served at ${url}; give the user this URL to open in their browser.` }
}

// an agent's tool call as the chip reads it. The same tool called again
// raises the count; a different tool starts the count over, which is what
// lets a chip read the tool and how many of it in a row.
function toolBegan(agentId: string, tool: string): void {
  const was = activity.get(agentId)
  activity.set(agentId, { tool, count: was?.tool === tool ? was.count + 1 : 1, running: true, end: "ok", since: Date.now() })
}

function toolEnded(agentId: string, end: End, rule?: string): void {
  const was = activity.get(agentId)
  if (was !== undefined) activity.set(agentId, { ...was, running: false, end, rule, until: Date.now() })
}

// A Rein refusal names the rule it refused by first ("D110: ..."); a deny
// from anywhere else has none.
function ruleOf(deny: string): string | undefined {
  const head = deny.split(":")[0]
  return head !== undefined && /^[A-Z]\d+$/.test(head) ? head : undefined
}

// every ~/.rein/<project>/rules/*.md as it stands when the run opens,
// and every rules/<domain>/*.md one folder down; then the shared rules of
// ~/.rein/rules the same way, each named rules:<name>. The run uses only
// these, so shrinking a rule mid-run cannot shrink what review checks. No
// rules folder, no rules.
async function freezeRules($: EngineInterface): Promise<Rule[]> {
  const dir = `${await projectDir($)}/rules`
  const rules: Rule[] = []
  for (const name of await mdFiles($, dir)) {
    const path = `${dir}/${name}`
    const { base64 } = await $.fs.read(path, { as: "bytes" })
    rules.push(await freezeRule(name, path, base64))
  }
  const shared = sharedRulesOf(await projectDir($))
  for (const name of await mdFiles($, shared)) {
    const path = `${shared}/${name}`
    const { base64 } = await $.fs.read(path, { as: "bytes" })
    rules.push({ ...(await freezeRule(`rules:${name}`, path, base64)), shared: true })
  }
  return rules
}

// the project folder of a repository outside the session root,
// ~/.rein/<its folder name>, as if a session had started in it.
async function repoProject($: EngineInterface, repo: string): Promise<string> {
  const base = await projectDir($)
  return `${base.slice(0, base.lastIndexOf("/"))}/${repo.split("/").pop()}`
}

// the projects of the run's repositories outside the session root,
// the session's own left out.
async function outsideProjects($: EngineInterface, run: Run): Promise<string[]> {
  const own = await projectDir($)
  const dirs: string[] = []
  for (const repo of run.outside ?? []) {
    const dir = await repoProject($, repo)
    if (!same(dir, own) && !dirs.some(d => same(d, dir))) dirs.push(dir)
  }
  return dirs
}

// the rules of an outside repository's project, frozen as its own project's are,
// each named <project>:<name> and held to that repository. None when the
// project is the session's own: those are frozen already.
async function freezeRepoRules($: EngineInterface, repo: string): Promise<Rule[]> {
  const project = await repoProject($, repo)
  if (same(project, await projectDir($))) return []
  const dir = `${project}/rules`
  const prefix = project.split("/").pop()!
  const rules: Rule[] = []
  for (const name of await mdFiles($, dir)) {
    const path = `${dir}/${name}`
    const { base64 } = await $.fs.read(path, { as: "bytes" })
    rules.push({ ...(await freezeRule(`${prefix}:${name}`, path, base64)), repo })
  }
  return rules
}

// every ~/.rein/<project>/knowledge/<domain>/*.md as it stands now,
// and each folder in a domain as one item, described by its SCHEMA.md
//. Knowledge is not frozen: review never checks it, so nothing is
// gained by holding it still.
// The projects given (those of repositories outside the session root)
// come after the session's own.
async function knowledge($: EngineInterface, projects: string[] = []): Promise<Knowledge[]> {
  const items: Knowledge[] = []
  for (const project of [await projectDir($), ...projects]) {
    const dir = `${project}/knowledge`
    if (!(await $.fs.exists(dir))) continue
    for (const domain of await $.fs.list(dir)) {
      if (domain.kind !== "dir") continue
      for (const entry of await $.fs.list(`${dir}/${domain.name}`)) {
        const path = `${dir}/${domain.name}/${entry.name}`
        if (entry.kind === "file" && /\.md$/i.test(entry.name)) items.push({ path, description: knowledgeDescription(await $.fs.read(path)) })
        if (entry.kind !== "dir") continue
        const schema = `${path}/SCHEMA.md`
        items.push({ path: `${path}/`, description: (await $.fs.exists(schema)) ? knowledgeDescription(await $.fs.read(schema)) : null })
      }
    }
  }
  return items
}

// an agent's task with the knowledge index after it, the run's
// outside projects' too.
async function withKnowledge($: EngineInterface, task: string, use: string, run: Run): Promise<string> {
  const index = knowledgeIndex(await knowledge($, await outsideProjects($, run)), use)
  return index ? `${task}\n\n${index}` : task
}

// The .md files of dir and of its folders, one level down, as paths
// relative to it.
async function mdFiles($: EngineInterface, dir: string): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return []
  const names: string[] = []
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind === "file" && /\.md$/i.test(entry.name)) names.push(entry.name)
    if (entry.kind !== "dir") continue
    for (const inner of await $.fs.list(`${dir}/${entry.name}`)) {
      if (inner.kind === "file" && /\.md$/i.test(inner.name)) names.push(`${entry.name}/${inner.name}`)
    }
  }
  return names
}

async function openRun($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  const current = await getRun($)
  if (current) {
    await trace($, current, { ev: "tool", stage: current.stage, tool: OPEN_RUN, input, decision: "deny", rule: "D59" })
    return { deny: `D59: this session already has a run open (${current.runId}, stage ${current.stage}). A second run cannot be opened; if the user wants to stop that one, call mcp__rein__park (it says what to ask them; pass their answer, D200).` }
  }
  const runId = input.runId
  if (typeof runId !== "string" || runId.length > 64 || !RUN_ID.test(runId)) {
    return { deny: "D58: runId must be a slug of lowercase letters, digits and single hyphens, at most 64 characters." }
  }
  // a slug names one run in every state, and a v0.2.0 folder too.
  const base = await projectDir($)
  if (RESERVED.has(runId)) return { deny: `D144: ${runId} names a folder of ${base} itself. Choose another slug.` }
  for (const taken of [...STATES.map(s => `${base}/${s}/${runId}`), `${base}/${runId}`]) {
    if (await $.fs.exists(taken)) return { deny: `D58: ${taken} already exists. Choose another slug.` }
  }
  const key = await recordKey($, runId)
  if ((await $.store.get(key)) !== undefined) return { deny: `D58: a run named ${runId} is already recorded in this project. Choose another slug.` }
  const [session, pointer, project] = [await $.session.id(), await pointerKey($), await projectName($)]
  // a slug the hub has for this project is another PC's run; a hub that
  // does not answer lets it through (the local frame server then reports a
  // collision and does not send the run).
  const hub = await hubOf($)
  const got = hub && (await hubFetch($, hub, "GET", runPath(project, runId)))
  const held = !got || "offline" in got || got.status !== 200 ? undefined : (got.json as { record?: HubRecord } | undefined)?.record
  if (held) return { deny: `the hub already has a run named ${runId} in this project (${held.state} on PC ${held.pc}). Choose another slug.` }
  // the run works in its own worktree of the session root's repository (of
  // the main one when the session sits in another run's worktree); a root
  // that is no repository gets its worktrees when plan names repositories.
  const root = await sessionRoot($)
  const owner = treeOwner(root)
  const repo = owner !== undefined && (await $.fs.exists(`${owner}/.git`)) ? owner : root
  let tree: Tree | undefined
  if (await $.fs.exists(`${repo}/.git`)) {
    const made = await makeTree($, repo, runId, true)
    if ("problem" in made) return { deny: `the run's git worktree could not be made, so no run was opened: ${made.problem}. Tell the user: a branch ${treeBranch(runId)} or a folder ${treePath(repo, runId)} left from before is theirs to remove, or choose another slug.` }
    tree = made
  }
  const run: Run = { v: 2, stage: "spec", runId, status: "active", owner: session, uid: crypto.randomUUID(), trees: tree ? [tree] : [], rules: await freezeRules($), writes: [], retries: 0, ...(input.autopilot === true ? { autopilot: true as const } : {}) }
  const raced = await locked(async () => {
    const existing = await getRun($)
    if (existing) return existing
    await $.store.set(key, run)
    await $.store.set(pointer, { project, runId })
    return undefined
  })
  if (raced) {
    if (tree) await removeTree($, tree)
    return { deny: `D59: this session already has a run open (${raced.runId}, stage ${raced.stage}). A second run cannot be opened.` }
  }
  if (tree) await carryConfig($, tree)
  const setup = tree ? await setupTree($, tree.path) : ""
  // a run is open: the last one's retrospective is over.
  closed = undefined
  const dir = await folderOf($, "active", runId)
  await trace($, run, {
    ev: "load",
    ver: VERSION,
    session: await $.session.id(),
    hooksEnv: (await $.env.get("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS")) ?? null,
    rules: run.rules.map(r => ({ name: r.name, hash: r.hash, paths: r.paths })),
    ...(run.autopilot ? { autopilot: true } : {}),
    ...(tree ? { worktree: tree.path, branch: tree.branch, start: tree.start } : {}),
    ...(setup ? { setup: clip(setup) } : {}),
  })
  await trace($, run, { ev: "stage", from: null, to: "spec" })
  await writeInfo($, run, "active", "open")
  // the activity is the open run's; the one before it is gone.
  activity.clear()
  await openFrame($, run)
  // the images pasted with the request the run opened on.
  await savePastes($, run)
  const pilot = run.autopilot ? " This is an autopilot run: the spec's questions are asked as usual, but where the user would type /rein:plan or /rein:dev, run /rein:e2e or approve the commit, the hook's result tells you to pass the answer yourself." : ""
  const opened = `Run opened. runId: ${runId}.${pilot} Write the spec to ${dir}/1-spec.md, the only file this stage may write; rein:sketcher draws ${dir}/1-mockup.html beside it when a picture helps (D158).${tree ? ` The run works in its own git worktree, ${tree.path}, made from HEAD (${tree.start === null ? "a detached HEAD" : `branch ${tree.start}`}) on a new branch ${tree.branch}; changes in the main working tree that are not committed are not in it. ${enterLine(tree)}${setupLine(setup ? [setup] : [])}` : ""}`
  // the deferred runs, so the spec agent can notice the request is one.
  const deferred = (await resumable($)).filter(r => r.state === "defer")
  const context: string[] = []
  if (deferred.length > 0) context.push(`D147: this project has deferred runs:\n${resumableLines(deferred)}\nIf the user's request continues one of them, ask the user. To resume it, call mcp__rein__park for this new run (the user chooses 폐기), then mcp__rein__resume with that runId.`)
  // a store near its limit, before this run adds to it.
  const full = await storeWarning($)
  if (full) context.push(full)
  return context.length === 0 ? { result: opened } : { result: opened, context }
}

// the hook asks no one. The main session asks the
// person with AskUserQuestion and passes the label they chose as `answer`;
// the hook cannot tell whether a person gave it. Called without one, a gate
// changes nothing: it names the answers it takes and what only the hook
// knows, for the main session to show with its question. That is a result,
// not a refusal: nothing failed, so the session does not show it as an error.
function answerOf(input: Record<string, unknown>): string | undefined {
  return typeof input.answer === "string" && input.answer.trim() !== "" ? input.answer.trim() : undefined
}

// the question at a decision. Where the user must answer (user), the main
// session asks them; anywhere else it decides with them or on its own.
// Either way answer is the decision, one of the labels, and the user's
// own words go in said.
function unanswered(rule: string, facts: string, options: string[], user = false): ToolCallResult {
  const labels = labelList(options)
  const ask = user
    ? `this needs the user's answer; nothing changed. Ask them with AskUserQuestion, showing what they need to decide, then call again with answer set to the label that matches what they decided (${labels}) and their own words in said. Never pass an answer the user did not give.`
    : `this needs a decision; nothing changed. Decide it with the user (AskUserQuestion, showing what they need to decide) or on your own, then call again with answer set to the label of the decision (${labels}) and, when the user said something, their own words in said.`
  return { result: `${rule ? `${rule}: ` : ""}${ask}\n\nWhat the hook knows here:\n${facts}` }
}

// a stage's file is out and the run stops for the person: they read it and
// type the next stage's skill, which passes the approval to advance, or tell
// the main session what to change (fix).
function waiting(rule: string, facts: string, to: Stage, fix: string): ToolCallResult {
  return { result: `${rule ? `${rule}: ` : ""}this waits for the user; nothing changed. Tell them what the hook knows below, giving the paths, then stop. They read it and type /rein:${to} to approve it (that skill passes "${APPROVE}" as answer to mcp__rein__advance), or tell you what to change: ${fix}\n\nWhat the hook knows here:\n${facts}` }
}

// an autopilot run where the user would have answered (1-spec.md's or
// 2-plan.md's approval, the e2e run, the commit): the main session passes
// that answer itself, said "autopilot", so the trace tells it from a person's.
function selfAnswer(rule: string, facts: string, answer: string): ToolCallResult {
  return { result: `${rule ? `${rule}: ` : ""}autopilot run: the user is not asked here; nothing changed yet. Tell them in one line what passed, giving the paths below, then call mcp__rein__advance again now with answer "${answer}" and said "autopilot".\n\nWhat the hook knows here:\n${facts}` }
}

const labelList = (options: string[]) => options.map(o => `"${o}"`).join(", ")

// an answer that is none of the labels changes nothing.
function offLabel(rule: string, answer: string, options: string[]): ToolCallResult {
  return { deny: `${rule ? `${rule}: ` : ""}answer takes one of ${labelList(options)}, and "${answer}" is none of them, so nothing changed. Pass the label of the decision as answer, and the user's own words in said.` }
}

function saidOf(input: Record<string, unknown>): string | undefined {
  return typeof input.said === "string" && input.said.trim() !== "" ? clip(input.said.trim()) : undefined
}

// the person approves, through the main session's question.
async function advance($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  const run = await getRun($)
  if (!run) return { deny: "D112: this session has no run open." }
  const lost = await lostHere($, run)
  if (lost) return lost
  const answer = answerOf(input)
  if (answer !== undefined) await trace($, run, { ev: "answer", stage: run.stage, tool: ADVANCE, answer, said: saidOf(input) })
  // a refused commit of the main session takes the answer first.
  if (run.commit && !run.commit.approved) return commitAnswer($, run, answer)
  // a judgment's ground that changed is told, and the run stays.
  const changed = await drifted($)
  const out = await advanceRun($, (await getRun($)) ?? run, answer)
  return changed.reduce(noticed, out)
}

async function advanceRun($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  if (run.halt?.rule === "failure-route") return routeGate($, run, answer)
  if (run.stage === "plan") return approvePlan($, run, answer)
  if (run.stage === "qa") return qaGate($, run, answer)
  if (run.stage === "qa-integration" && run.halt?.rule === "D141") return asideGate($, run, answer)
  if (run.stage === "qa-integration" && run.halt?.rule === "D173") return failGate($, run, answer)
  if (run.stage === "qa-integration" && (run.halt?.rule === "ego-unavailable" || run.halt?.rule === "ego-profile-missing")) return egoGate($, run, answer)
  if (run.stage === "qa-integration" && run.halt?.rule === "completion-failed") {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "completion-failed" })
    return { deny: `completion-failed: ${COMPLETION_FAILED} advance does not move this halt.` }
  }
  if (run.stage === "qa-integration" && run.halt?.rule === "layout-unchecked") return layoutGate($, run, answer)
  if (run.stage === "qa-integration" && run.halt) return releaseHalt($, run, answer)
  const handed = run.stage === "qa-integration" && !run.halt ? handedOff(run) : undefined
  if (handed) return handoffGate($, run, handed, answer)
  if (run.stage === "qa-integration" && run.e2e?.path === "wait") return waitGate($, run, answer)
  if (run.stage === "qa-integration") return nothingToCommit($, run, answer)
  if (run.stage === "land") return landGate($, run, answer)
  const next = NEXT[run.stage]
  if (!next) return noTransition($, run)
  const path = `${await folderOf($, "active", run.runId)}/${next.artifact}`
  if (!(await $.fs.exists(path))) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D112", reason: "no artifact" })
    return { deny: `D112: ${path} does not exist. Write it before asking for approval.` }
  }
  const missing = run.stage === "spec" ? specProblem(await $.fs.read(path)) : undefined
  if (missing !== undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D112", reason: missing })
    return { deny: `D112: ${missing}. Add it to ${path}, then call advance again; no answer is taken until then.` }
  }
  // the person approves 1-spec.md as graded, seeing the ambiguity left.
  const shown = run.stage === "spec" ? await $.fs.read(path) : ""
  const graded = run.stage === "spec" ? run.grades?.at(-1) : undefined
  if (run.stage === "spec" && graded?.hash !== (await sha256Text(shown))) {
    const why = graded ? "1-spec.md changed since its last grade" : "1-spec.md has no grade yet"
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D175", reason: why })
    return { deny: `D175: ${why}. Spawn rein:grader, then call advance again; no answer is taken until then.` }
  }
  const more = graded !== undefined && !passes(graded, shown)
  // the spec's visuals, when the sketcher drew any, sit beside 1-spec.md;
  // a picture not drawn from 1-spec.md as it is, or changed since, is older.
  const visual = `${path.slice(0, path.lastIndexOf("/"))}/1-mockup.html`
  const drawn = run.stage === "spec" && (await $.fs.exists(visual)) ? await $.fs.read(visual) : undefined
  const fresh = drawn !== undefined && run.sketched?.spec === (await sha256Text(shown)) && run.sketched.html === (await sha256Text(drawn))
  const seen = drawn === undefined ? "" : ` 시각 자료: ${visual}${fresh ? "" : " — 주의: 1-mockup.html이 1-spec.md보다 오래됐습니다. 지금의 1-spec.md를 rein:sketcher가 그린 것이 아닙니다."}${fresh ? sketchLine(run.sketchCheck, visual) : ""}`
  // a 1-spec.md approved before and changed since (the run came back to
  // spec) shows the person what changed, quoted (the file may be anyone's).
  const changed = run.stage === "spec" && run.frozen?.spec !== undefined ? lineDiff(run.frozen.spec, shown) : []
  const diff = changed.length > 0 ? `\n\n바뀐 것 (승인된 내용 → 지금):\n${quoted(changed.join("\n"))}` : ""
  // questions the user left open: shown before approval, since plan then
  // writes an assumption for each instead of asking.
  const open = run.stage === "spec" ? openQuestions(shown) : []
  const left = open.length > 0 ? `\n\n열어 둔 질문 ${open.length}개 — 이대로 승인하면 plan이 각각의 가정을 2-plan.md의 결정 사항에 적고 설계합니다:\n${quoted(open.join("\n"))}` : ""
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D112", reason: "no answer" })
    await mutate($, r => (r?.stage === "spec" ? { ...r, waits: { stage: "spec", hash: graded!.hash } } : undefined))
    const lead = run.autopilot ? `autopilot이 ${next.artifact}를 승인하고 ${next.to} 단계로 넘어갑니다.` : `${next.artifact}가 승인을 기다립니다. /rein:${next.to}를 입력하면 승인하고 ${next.to} 단계로 넘어갑니다.`
    const facts = `${lead} (${path})${seen}${graded ? ` ${gradeLine(graded, shown)}` : ""}${left}${diff}`
    if (run.autopilot) return selfAnswer("D112", facts, APPROVE)
    const questions = more ? ` The grade does not pass yet: they may also want more questions (ask the next one as the last grade said, one at a time, and grade again every ${EVERY} questions).` : ""
    return waiting("D112", facts, next.to, `revise ${next.artifact} as they said, have rein:grader grade it again, and call advance again without answer.${questions}`)
  }
  if (answer !== APPROVE) return offLabel("D112", answer, [APPROVE])
  // the text the person approved, put back if a command rewrites it.
  const approved = await $.fs.read(path)
  const moved = await mutate($, r => (r?.stage === run.stage ? { ...r, stage: next.to, waits: undefined, frozen: { ...r.frozen, spec: approved } } : undefined))
  if (!moved) return { deny: `D112: the run left ${run.stage} while the question was open; nothing was moved.` }
  await trace($, run, { ev: "stage", from: run.stage, to: next.to, answer })
  // the images pasted later in the spec talk join the brief, and go with it.
  if (run.stage === "spec") await savePastes($, moved)
  // an approved spec is let go when another PC holds the run.
  const hub = await hubOf($)
  const lost = hub && (await heldBy($, hub, moved, true))
  if (lost) return { result: `Approved, but ${await loseToPc($, moved, lost)}` }
  await writeInfo($, moved, "active", "spec")
  // the main session designs with the domain knowledge at hand.
  const index = next.to === "plan" ? knowledgeIndex(await knowledge($), PLAN_USE) : undefined
  return { result: `Approved. The run is now in the ${next.to} stage.`, context: [next.entry(moved), ...(index ? [index] : [])] }
}

// advance has nothing to do in this stage as the run stands.
async function noTransition($: EngineInterface, run: Run): Promise<ToolCallResult> {
  await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D112", reason: "no transition" })
  return { deny: `D112: advance does not move the ${run.stage} stage as the run stands. ${MOVES}` }
}

const GOTO_STAGES: Stage[] = ["spec", "plan", "dev", "review", "qa", "qa-integration", "land"]
// the stages whose work rests on a design that passed plan.
const PAST_PLAN = new Set<Stage>(["dev", "review", "qa", "qa-integration", "land"])
const QA_ENTRY = "The run is now in the qa stage. Invoke the rein:qa skill; the hook runs the qa commands when it calls mcp__rein__advance."

// The main session moves the run to any stage, on its own judgment. The
// stage starts as entering it would: past plan from the design as it
// passed, or, when there is none or 2-plan.md changed since, as the hook
// reads 2-plan.md now; from review on, from the files dev hands on as they
// are now; qa-integration with its entry, run at once (from a halt the
// checks that passed stay passed); land with the repositories that have a
// planned file changed and their HEAD. What the stages found or approved
// goes.
async function goTo($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  const run = await getRun($)
  if (!run) return { deny: "this session has no run open." }
  const lost = await lostHere($, run)
  if (lost) return lost
  const to = input.stage as Stage
  if (typeof input.stage !== "string" || !GOTO_STAGES.includes(to)) return { deny: `stage takes one of ${GOTO_STAGES.join(", ")}.` }
  const c = await ctxOf($, run)
  if (c.run.busy) return { deny: `the hook is running a judgment's commands (${c.run.busy.what}); wait for its result, then call goto again.` }
  // entering again while checks run would drop what their agents find.
  const open = run.stage === "qa-integration" && to === "qa-integration" ? (run.e2e?.checks ?? []).filter(isOpen).map(k => k.name) : []
  if (open.length > 0) return { deny: `integration checks are still open (${open.join(", ")}); running the entry again now would drop what their agents find. Call mcp__rein__status and wait for them; once no check is open, call goto again if it is still needed.` }
  let judged: Extract<PlanJudgment, { ok: true }> | undefined
  let planted: { trees?: Tree[]; made: Tree[]; setup: string[] } = { made: [], setup: [] }
  if (PAST_PLAN.has(to)) {
    const path = `${c.dir}/2-plan.md`
    const now = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    const frozenPlan = run.frozen?.plan
    if (!run.planFiles || (frozenPlan !== undefined && (now === undefined || eol(now) !== eol(frozenPlan)))) {
      if (now === undefined) return { deny: `${path} does not exist, so the run has no design to take to ${to}. Go to plan first.` }
      const j = await judgePlan($, c)
      if (!j.ok) return { deny: `the run cannot go to ${to}: the hook takes the design from 2-plan.md, and it does not pass: ${j.reason} Fix 2-plan.md, or go to plan.` }
      const into = await intoTrees($, run, j)
      if ("problem" in into) return { deny: `the run cannot go to ${to}: its git worktree could not be made (${into.problem}). Tell the user (a branch ${treeBranch(run.runId)} or a folder of that name left from before is theirs to remove).` }
      judged = into.j
      planted = into
    }
  }
  const base: Run = judged ? { ...planPassed({ ...run, keepRetries: undefined }, judged), ...(planted.trees ? { trees: planted.trees } : {}) } : run
  // a worktree made just now goes again with a refusal.
  const unplant = async (deny: string): Promise<ToolCallResult> => {
    for (const t of planted.made) await removeTree($, t)
    return { deny }
  }
  let configs: Record<string, Config> | undefined
  let frozen: Partial<Run> = {}
  if (to === "qa-integration") {
    const now = await currentConfigs($, base)
    if ("problem" in now) return unplant(`the integration entry runs on each repository's .rein/config.json, and ${now.problem}. Fix it, then call goto again.`)
    configs = now.configs
    frozen = { configHashes: now.hashes, configSeen: Object.fromEntries(Object.entries(now.configs).map(([repo, cfg]) => [repo, viewOf(cfg)])) }
  }
  let landAt: Partial<Run> = {}
  if (to === "land") {
    const land = await changedRepos($, base)
    if (land.length === 0) return unplant("git status shows no planned file changed in any repository, so land has nothing to commit.")
    const heads = await headsOf($, land)
    if (typeof heads === "string") return unplant(`git cannot read HEAD of ${heads}, so land cannot start from it.`)
    landAt = { heads, landRepos: land }
  }
  // a planned file changed past the last seal joins the writes review checks the rules on.
  const seal = SEALED.has(to) ? await sealOf($, sealFiles(base, `${c.dir}/handoff`)) : undefined
  if (seal) await keepCopies($, c.dir, seal)
  const changed = seal && run.sealed ? (base.planFiles ?? []).filter(f => run.sealed![f] !== undefined && run.sealed![f] !== seal[f] && !base.writes.some(w => same(w, f))) : []
  const sealed = seal ? { sealed: seal, ...(changed.length > 0 ? { writes: [...base.writes, ...changed] } : {}) } : {}
  // 1-spec.md as it leaves spec is the text plan and later rest on.
  const specPath = `${c.dir}/1-spec.md`
  const spec = run.stage === "spec" && to !== "spec" && (await $.fs.exists(specPath)) ? { frozen: { ...base.frozen, spec: await $.fs.read(specPath) } } : {}
  // a halted integration qa runs its entry again with what it found.
  const reenter = to === "qa-integration" && run.stage === "qa-integration" && run.halt !== undefined && !judged
  const cleared: Partial<Run> = {
    worker: undefined, arbiter: undefined, reviewer: undefined, splitter: undefined, reviewGroups: undefined, verifier: undefined, deviation: undefined,
    failFile: undefined, d62: undefined, keepRetries: undefined, halt: undefined, e2e: undefined, qaVisit: undefined,
    heads: undefined, landRepos: undefined,
    planReviewer: undefined, planReview: undefined, planVerdicts: undefined,
  }
  const moved = await mutate($, r => {
    if (r?.runId !== run.runId || r.stage !== run.stage) return undefined
    if (reenter) return { ...r, retries: 0, ...frozen, ...sealed }
    return { ...(judged ? base : r), ...cleared, retries: 0, ...frozen, ...landAt, ...sealed, ...spec, stage: to === "qa-integration" ? "qa" : to }
  })
  if (!moved) return unplant("the run changed meanwhile; nothing was moved. Call goto again.")
  await trace($, run, { ev: "stage", from: run.stage, to, tool: GOTO, said: saidOf(input), ...(judged ? { files: judged.files, repos: judged.repos } : {}) })
  const head = `The run is now in the ${to} stage.`
  if (to === "qa-integration") {
    const from = reenter ? "qa-integration" : "qa"
    const token = await takeBusy($, from, "goto")
    if (token === undefined) return { deny: "the hook is running a judgment's commands; call goto again once it is done." }
    try {
      const now = (await getRun($))!
      const context = await integrationEntry($, await ctxOf($, now), now, configs!, from)
      return { result: entryOutcome(await getRun($), false), context: [context] }
    } finally {
      await dropBusy($, token)
    }
  }
  const entry = to === "spec" ? "Invoke the rein:spec skill, skipping its step 0 (the run is open)."
    : to === "plan" ? planEntry(moved)
      : to === "dev" ? passedEntry(moved, moved.planFiles ?? [], c.dir)
        : to === "review" ? reviewEntry(moved, c.root, c.dir)
          : to === "qa" ? QA_ENTRY
            : LAND_ENTRY
  return { result: head, context: [`${entry}${setupLine(planted.setup)}`] }
}

// Work qa: a config that changed since plan comes first, since nothing
// can run past it; then the halt for e2e with no Aside; else the hook
// runs the qa commands, asking first after a failed run.
async function qaGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  if (run.halt?.rule === "D141") return asideGate($, run, answer)
  if (run.impact && !run.impact.verdicts && run.qaVisit?.passed) return impactGate($, run)
  return runQa($, run, answer)
}

// work qa passed and waits for rein:impact. Before it is spawned advance
// says so; once it ran and wrote no impact.md, every check in question
// runs again.
async function impactGate($: EngineInterface, run: Run): Promise<ToolCallResult> {
  if (!run.impact?.agent) return { deny: `the qa commands passed, and the earlier passes of ${run.impact!.doubt.join(", ")} wait for rein:impact's judgment. Spawn rein:impact in the foreground (prompt \`judge the impact\`; the hook writes its task). When it writes ${IMPACT_FILE}, the hook writes the checklist.` }
  const out = await impactDone($, run, {}, "rein:impact ended without writing impact.md, so every check in question runs again")
  return "deny" in out ? { deny: out.deny } : { result: "The hook took rein:impact's judgment.", context: [out.context] }
}

// rein:impact's verdicts go into the run, and the integration entry the
// qa commands' pass waited for runs: a check whose pass it cleared comes
// checked in 5-checklist.md and does not run again.
async function impactDone($: EngineInterface, run: Run, verdicts: Record<string, { affected: boolean; why: string }>, what: string): Promise<{ context: string } | { deny: string }> {
  const token = await takeBusy($, "qa", "impact")
  if (token === undefined) return { deny: "the hook is busy with the qa commands; wait for its result, then call mcp__rein__advance." }
  try {
    const moved = await mutate($, r => (r?.stage === "qa" && r.impact && !r.impact.verdicts ? { ...r, impact: { ...r.impact, verdicts } } : undefined))
    if (!moved) return { deny: "the run no longer waits for rein:impact. Call mcp__rein__status." }
    await trace($, moved, { ev: "impact", stage: "qa", verdicts })
    const frozen = await frozenConfigs($, moved)
    if ("problem" in frozen) return { deny: `D50: ${frozen.problem}.${backendsHint(frozen.problem)} Call advance: it says what to ask the user.` }
    const context = await integrationEntry($, await ctxOf($, moved), moved, frozen.configs, "qa")
    return { context: `${what}. ${context}` }
  } finally {
    await dropBusy($, token)
  }
}

// right after rein:impact's impact.md write went through.
async function impactExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const impact = c.run.impact
  if (!impact || impact.verdicts) return result
  const verdicts = parseImpact(await $.fs.read(`${c.dir}/${IMPACT_FILE}`), impact.doubt)
  const cleared = impact.doubt.filter(n => verdicts[n]?.affected === false)
  const out = await impactDone($, c.run, verdicts, cleared.length > 0 ? `rein:impact found the change does not touch ${cleared.join(", ")}` : "rein:impact found the change touches every check in question")
  return withContext(result, "deny" in out ? out.deny : out.context)
}

// work qa passed, but checks that passed in an earlier visit rest on files
// changed since: rein:impact judges from the diff whether the change
// touches each, before 5-checklist.md is written. The diff of each such
// file, from the copy kept as the check passed to now, goes in
// impact-diff.md.
async function impactWait($: EngineInterface, c: Ctx, run: Run, doubt: ReturnType<typeof doubtful>, lead: string): Promise<string> {
  const pairs = new Map<string, { path: string; was: string }>()
  for (const d of doubt) for (const f of d.files) pairs.set(`${f.was} ${f.path}`, f)
  const parts = ["# 통과 뒤 바뀐 파일의 diff", ""]
  for (const { path, was } of pairs.values()) {
    const users = doubt.filter(d => d.files.some(f => f.path === path && f.was === was)).map(d => d.name)
    parts.push(`## ${path}`, "", `통과 당시 버전 ${was.slice(0, 12)}에서 지금까지 — check: ${users.join(", ")}`, "")
    const old = copyOf(c.dir, was)
    if (!(await $.fs.exists(old))) parts.push("(통과 당시의 사본이 없어 diff를 만들 수 없음: 이 파일에 걸린 check는 영향 있음)", "")
    else if (!(await $.fs.exists(path))) parts.push("(지금은 파일이 없음)", "")
    else {
      const r = await $.process.run(["git", "diff", "--no-index", "--no-color", "-U5", "--", old, path], { timeoutMs: 60_000 }).catch(() => undefined)
      const out = r?.stdout.trim()
      parts.push(out ? `\`\`\`diff\n${out}\n\`\`\`` : `(diff를 만들지 못함 — 두 버전을 Read로 비교: ${old}, ${path})`, "")
    }
  }
  await $.fs.write(`${c.dir}/${IMPACT_DIFF}`, parts.join("\n"))
  const names = doubt.map(d => d.name)
  // a D141 halt goes: the entry after the judgment asks for Aside again.
  const moved = await mutate($, r => (r?.stage === "qa" ? { ...r, halt: undefined, qaVisit: { ...(r.qaVisit ?? { reruns: 0 }), passed: true as const }, impact: { sealed: r.sealed ?? {}, doubt: names } } : undefined))
  if (!moved) return "The run left qa before the e2e entry."
  await trace($, run, { ev: "impact", stage: "qa", doubt: names })
  return `${lead}. These checks passed in an earlier visit, but files they rest on changed since: ${names.join(", ")}. Before the checklist is written, spawn rein:impact in the foreground (prompt \`judge the impact\`; the hook writes its task): it judges from the diff whether the change touches each. When it writes ${IMPACT_FILE}, the hook writes 5-checklist.md; a check it finds untouched comes checked and does not run again. The run stays in qa until then.`
}

// e2e is configured but aside cannot run and nothing else would run
// it, so the run halted rather than pass with no e2e. The person either
// starts Aside, and the entry runs again, or goes on without e2e. A config
// changed since it was frozen gets the D50 question first, never a silent
// approval. In qa either answer enters integration only when a hook rerun of
// the qa commands passed in this qa visit (qaVisit.passed).
async function asideGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const from = run.stage === "qa" ? "qa" : "qa-integration"
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  const unchecked = "D141: the qa commands have not passed a hook run in this qa visit, so e2e cannot be decided yet. Tell the user."
  if (from === "qa" && !run.qaVisit?.passed) {
    // Only a record from an older version halts here: the halt stands on no pass,
    // so it goes, and the next advance runs the qa commands.
    await mutate($, r => (r?.stage === "qa" && r.halt?.rule === "D141" && !r.qaVisit?.passed ? { ...r, halt: undefined } : undefined))
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D141", reason: "qa not passed in this visit; halt dropped" })
    return { deny: "D141: the qa commands have not passed a hook run in this qa visit, so e2e cannot be decided yet; the halt is dropped. Call advance again: the hook runs the qa commands (D153)." }
  }
  if ((await ctxOf($, run)).run.busy) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D141", reason: "no answer" })
    return unanswered("D141", `e2e가 설정돼 있지만 Aside를 쓸 수 없습니다 (앱이 꺼져 있거나 설치되지 않음). 어떻게 할까요? (${run.halt!.reason})`, [ASIDE_ON, NO_E2E])
  }
  if (answer !== ASIDE_ON && answer !== NO_E2E) return offLabel("D141", answer, [ASIDE_ON, NO_E2E])
  const token = await takeBusy($, from, "entry")
  if (token === undefined) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  try {
    const now = await getRun($)
    if (!now || now.halt?.rule !== "D141") return { deny: "D141: the run changed while the question was open; nothing was done." }
    if (from === "qa" && !now.qaVisit?.passed) return { deny: unchecked }
    const again = await frozenConfigs($, now)
    if ("problem" in again) return { deny: `D50: a config changed while the question was open: ${again.problem}.${backendsHint(again.problem)} Call advance again: it says what to ask the user.` }
    await trace($, now, { ev: "release", stage: now.stage, halt: now.halt, answer })
    // a halt from before ego was the default holds no browser: the user's answer is Aside.
    const chosen = answer === ASIDE_ON ? await chooseBrowser($, "aside") : now
    if (!chosen) return { deny: "D141: the run changed while the question was open; nothing was done." }
    const context = await integrationEntry($, await ctxOf($, chosen), chosen, again.configs, from, answer === NO_E2E)
    const after = await getRun($)
    if (answer === ASIDE_ON && after?.halt?.rule === "D141") {
      return { deny: `D141: Aside is still unavailable (\`aside session list\` did not exit 0); the run stays halted in ${after.stage}. Tell the user; once Aside runs, call advance again.` }
    }
    return { result: entryOutcome(after, answer === NO_E2E), context: [context] }
  } finally {
    await dropBusy($, token)
  }
}

// the hook runs the frozen qa commands; the agent runs none and only
// reads what failed. advance runs them without a question until a hook run
// of this visit failed; after one it asks first: the agent said the
// failure is the environment's and the user fixed it. All pass: the hook
// writes qa.md itself and enters qa-integration. A failure leaves the run in
// qa, the whole output in qa-output.log; the agent tells
// a code problem (qa.md reports it: dev or plan, no second run) from the
// environment (tell the user; the next advance asks).
async function runQa($: EngineInterface, run: Run, given: string | undefined): Promise<ToolCallResult> {
  if ((await ctxOf($, run)).run.busy) return { deny: "D56: the hook is already running the qa commands; wait for its result." }
  const asked = failedRun(run)
  // with no failed run in this visit the commands run, answer or not.
  const answer = asked ? given : undefined
  if (asked) {
    if (answer === undefined) {
      await trace($, run, { ev: "tool", stage: "qa", tool: ADVANCE, decision: "deny", rule: "D143", reason: "no answer" })
      return unanswered("D143", rerunQuestion(run), [QA_RERUN, CANCEL])
    }
    if (answer !== QA_RERUN && answer !== CANCEL) return offLabel("D143", answer, [QA_RERUN, CANCEL])
    if (answer !== QA_RERUN) {
      await trace($, run, { ev: "tool", stage: "qa", tool: ADVANCE, decision: "deny", rule: "D143", answer })
      return { deny: `D143: no rerun (answer: ${answer}). The run stays in qa. ${MOVES}` }
    }
  }
  const token = await takeBusy($, "qa", "advance run")
  if (token === undefined) return { deny: "D56: the hook is already running the qa commands; wait for its result." }
  try {
    const now = await getRun($)
    if (!now || now.stage !== "qa" || now.halt || failedRun(now) !== asked) {
      const what = !now || now.stage !== "qa" ? `stage ${now?.stage ?? "none"}` : now.halt ? `halt ${now.halt.rule}` : asked ? "the failed run was replaced" : "a hook run failed meanwhile"
      return { deny: `D153: the run changed before the commands ran (${what}); nothing was run. Call advance again.` }
    }
    const frozen = await frozenConfigs($, now)
    if ("problem" in frozen) return { deny: `D50: a config changed before the commands ran: ${frozen.problem}.${backendsHint(frozen.problem)} Call advance again: it says what to ask the user.` }
    const c = await ctxOf($, now)
    const results = await runAll($, now.repos ?? [], r => frozen.configs[r]?.qa ?? [], 600_000)
    const drift = await configDrift($, now)
    const all = drift.length > 0 ? [...results, rewrote(drift)] : results
    const failure = failureOf(all)
    const rule = asked ? "D143" : "D153"
    await trace($, now, { ev: "rerun", stage: "qa", results: stored(all), ...(answer ? { answer } : {}), rule, ...(drift.length > 0 ? { configRewritten: drift } : {}) })
    if (results.length === 0) return { deny: "D56: the run stays in qa; there was no qa command to run. Tell the user." }
    const qaFile = `${c.dir}/agent/qa.md`
    if (drift.length > 0) {
      await $.fs.write(qaFile, `## 검증 명령\n\n${commandReport(all)}\n`)
      let context = ""
      const moved = await mutate($, r => {
        if (r?.stage !== "qa") return undefined
        const routed = holdRoute({ ...r, busy: undefined }, qaFile, "a config the hook had frozen changed while the qa commands ran (D120)")
        context = routed.context
        return { ...routed.run, qaFailure: failure }
      })
      if (!moved) return { deny: "D153: the run left qa while the commands ran; nothing was moved." }
      await trace($, now, { ev: "halt", stage: "qa", halt: moved.halt, retries: moved.retries, rule: "D120" })
      return { result: "The config changed while the qa commands ran (by the code or by hand); the run does not pass.", context: [`D120: the hook ran the qa commands and a config it had frozen changed while they ran:\n${commandReport(all)}\nIt counts as a failing qa that no agent judged. ${context}`] }
    }
    const log = `${c.dir}/${OUTPUT_FILE}`
    if (failure) await $.fs.write(log, outputLog(all))
    const counted = await mutate($, r => {
      if (r?.stage !== "qa") return undefined
      const visit = { ...(r.qaVisit ?? { reruns: 0 }), reruns: (r.qaVisit?.reruns ?? 0) + (asked ? 1 : 0) }
      return failure ? { ...r, qaVisit: { ...visit, failed: true, passed: undefined }, qaFailure: failure } : { ...r, qaVisit: { ...visit, failed: undefined } }
    })
    if (!counted) return { deny: "D153: the run left qa while the commands ran; nothing was moved." }
    if (failure) {
      return { deny: `${rule}: the hook ran the qa commands and one failed:\n${commandReport(all)}\nThe whole output of the failing commands is in ${log}. The run stays in qa. Spawn rein:triage with this report, the path of that output and ${qaFile}: if the failure is the code's, it writes qa.md with its judgment of whether the code or the design must change (## 실패 원인), the run goes to dev or plan by it, and the commands do not run again. If it is the environment's, it writes nothing and says what to fix: tell the user; once they say it is fixed, call advance again: it says what to ask them before it reruns (D143).` }
    }
    await $.fs.write(qaFile, `## 검증 명령\n\n${commandReport(results)}\n\n(${asked ? "사람이 환경을 고친 뒤 훅이 advance에서 다시 돌림, D143" : "훅이 advance에서 돌림, D153"})\n`)
    const context = await integrationEntry($, c, counted, frozen.configs, "qa")
    return { result: "The hook ran the qa commands; all passed and it wrote qa.md.", context: [context] }
  } finally {
    await dropBusy($, token)
  }
}

// in work qa, or in a halted qa-integration, a
// config.json missing, unusable or changed since it was frozen stops the
// run. advance shows the person what changed; their approval freezes the
// configs as they are now. In qa that also drops the D141 halt and the
// visit's last run, pass or fail, since it ran under the old config: the
// next advance runs the commands again, unasked.
async function approveConfigs($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const frozen = await frozenConfigs($, run)
  if (!("problem" in frozen)) return noTransition($, run)
  const stage = run.stage
  const hint = backendsHint(frozen.problem)
  const fixIt = `Fix .rein/config.json with the user (D176: you may write it; /rein:setup helps), then call advance again.${hint}`
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage, tool: ADVANCE, decision: "deny", rule: "D50", reason: "no answer" })
    return unanswered("D50", `${stage}가 plan 때의 config로 돌 수 없습니다: ${frozen.problem}. 지금의 config를 승인할까요?${await configChanges($, run)}`, [NEW_CONFIG, KEEP_CONFIG])
  }
  if (answer !== NEW_CONFIG && answer !== KEEP_CONFIG) return offLabel("D50", answer, [NEW_CONFIG, KEEP_CONFIG])
  if (answer !== NEW_CONFIG) {
    await trace($, run, { ev: "tool", stage, tool: ADVANCE, decision: "deny", rule: "D50", answer })
    return { deny: `D50: the current configs are not approved (answer: ${answer}). The run stays in ${stage}. ${fixIt}` }
  }
  const fresh = <T extends { qaVisit?: Run["qaVisit"] }>(x: T): T => ({ ...x, qaVisit: x.qaVisit && { ...x.qaVisit, passed: undefined, failed: undefined } })
  // in a halted qa-integration the checks ran under the old config, so
  // their results go; a halt on a failed check becomes a rerun question.
  // A run waiting for the person ran nothing, so it keeps waiting.
  const voided = (r: Run): Partial<Run> => (r.e2e?.path === "wait" ? {} : { e2e: undefined, ...(r.halt?.rule === "D173" ? { halt: { rule: "D120" as const, reason: "a config changed after the aside checks ran, so their results are void" } } : {}) })
  // an approved config whose e2e changed voids every earlier aside pass.
  const again = await refreezeConfigs($, run, stage, (r, hashes, views) => ({ ...(stage === "qa" ? { ...fresh(r), halt: undefined } : voided(r)), passed: sameE2e(r, hashes, views) ? r.passed : undefined }))
  if ("problem" in again) return { deny: `D50: the user approved, but the configs are still not usable: ${again.problem}. The run stays in ${stage}. ${fixIt}` }
  const next = stage === "qa"
    ? "D50: the configs are frozen as they are now. Call advance again: the hook runs the qa commands under them (D153)."
    : run.e2e?.path === "wait" && !run.halt
      ? "D50: the configs are frozen as they are now. The run still waits for the user's integration test; call advance again with their answer."
      : `D50: the configs are frozen as they are now; the run is still halted (${run.halt?.rule}). Call advance again: it says what to ask the user ${run.halt?.rule === "D141" ? "about Aside (D141)" : "whether to run integration qa again (D132)"}.`
  return { result: "The user approved the current configs.", context: [next] }
}

// integration qa passed, but git status showed no
// planned file changed (committed or undone meanwhile), so land has nothing
// to commit. advance asks the person: back to plan, or end the run.
async function nothingToCommit($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const c = await ctxOf($, run)
  const file = `${c.dir}/agent/e2e.md`
  const text = (await $.fs.exists(file)) ? await $.fs.read(file) : ""
  const outcome = judgeIntegration(text, run, completionLine(await $.fs.read(`${c.dir}/1-spec.md`)))
  if (outcome.kind !== "land" || (await changedRepos($, run)).length > 0) return noTransition($, run)
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D95", reason: "no answer" })
    return unanswered("D95", "통합 qa는 통과했지만 git status에 바뀐 계획 파일이 없어 커밋할 것이 없습니다 (D95). 어떻게 할까요?", [TO_PLAN, END_RUN])
  }
  if (answer === TO_PLAN) {
    const moved = await mutate($, r => (r?.stage === "qa-integration" && !r.halt ? { ...r, stage: "plan", d62: true, failFile: file, verifier: undefined } : undefined))
    if (!moved) return { deny: "D95: the run changed while the question was open; nothing was moved." }
    await trace($, run, { ev: "stage", from: "qa-integration", to: "plan", answer, rule: "D95" })
    return { result: "The user sent the run back to plan.", context: [d62Entry("git status shows no planned file changed, so there was nothing to commit (D95)", file)] }
  }
  if (answer === END_RUN) {
    // nothing was committed, but the checks passed and the person ended it: complete.
    const left = await leaveActive($, run, "complete", { ev: "stage", from: "qa-integration", to: null, answer, reason: "nothing to commit (D95)" })
    if ("problem" in left) return { deny: `D144: the run folder could not be moved to complete (${left.problem}), so the run stays in qa-integration. Tell the user (on Windows a file in the run folder may be open in another program); once fixed, call advance again.` }
    return { result: "The user ended the run.", context: [`D95: the run ended without a commit, as the user chose; it is closed and its record is in ${await folderOf($, "complete", run.runId)}.${left.note} Tell the user.${left.retro}`] }
  }
  return offLabel("D95", answer, [TO_PLAN, END_RUN])
}

// plan goes on only when the person approves 2-plan.md, as for the spec.
// The hook judges 2-plan.md here and not on its writes, so the planner may
// leave it unfinished between its calls; it must pass before the question.
// The question also shows a config that differs from the one committed at
// HEAD (D120), which approval freezes. After a design problem (D62) approval
// also resets the retries.
async function approvePlan($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const c = await ctxOf($, run)
  const path = `${c.dir}/2-plan.md`
  if (!(await $.fs.exists(path))) {
    await trace($, run, { ev: "tool", stage: "plan", tool: ADVANCE, decision: "deny", rule: "D112", reason: "no artifact" })
    return { deny: `D112: ${path} does not exist. Write it before asking for approval.` }
  }
  const judged = await judgePlan($, c)
  if (!judged.ok) {
    if (judged.take) await takeOutside($, judged.take)
    await trace($, run, { ev: "tool", stage: "plan", tool: ADVANCE, decision: "deny", ...(judged.rule ? { rule: judged.rule } : {}), reason: judged.reason })
    return { deny: `${ruled(judged.rule)}2-plan.md does not pass yet, so the run stays in plan: ${judged.reason} ${judged.fix} Then call advance again.` }
  }
  // the design review: a passing verdict on 2-plan.md as it is now, or
  // PLAN_REVIEWS failed ones in this visit, after which the person decides.
  const hash = await sha256Text(judged.plan)
  const verdicts = run.planVerdicts ?? []
  const reviewed = verdicts.some(v => v.pass && v.hash === hash)
  const failed = verdicts.filter(v => !v.pass)
  if (!reviewed && failed.length < PLAN_REVIEWS) {
    const last = verdicts.at(-1)
    const stale = last !== undefined && !last.pass && last.hash === hash
    await trace($, run, { ev: "tool", stage: "plan", tool: ADVANCE, decision: "deny", reason: "no design review" })
    const why = stale ? "its last design review failed and it has not changed since" : "it has no passing design review as it stands now"
    const fix = stale ? "Continue the planner with the reviewer's reasons, then spawn rein:reviewer again" : "Spawn rein:reviewer for the design review"
    return { deny: `2-plan.md passes the form, but ${why}, so the run stays in plan. ${fix} (the rein:plan skill says how), then call advance again.` }
  }
  const unreviewed = reviewed ? "" : `\n\n설계 리뷰를 통과하지 못한 설계입니다 (실패 ${failed.length}회). 마지막 실패 사유:\n${quoted(failed.at(-1)!.why ?? "")}`
  const head = await headChanges($, judged.repos, judged.texts)
  const rule = run.d62 ? "D62" : head !== "" ? "D120" : ""
  const freeze = head === "" ? "" : "\n\n.rein/config.json이 커밋된 것과 다릅니다. 승인하면 지금 내용으로 고정합니다."
  const fresh = run.trees ? judged.repos.filter(r => !run.trees!.some(t => same(t.path, r) || same(t.repo, r))) : []
  const planting = fresh.length > 0 ? `

승인하면 이 저장소마다 지금 HEAD에서 run의 워크트리(.claude/worktrees/${run.runId})를 만들고 그 안에서 작업합니다. 커밋 안 된 변경은 들어가지 않습니다: ${fresh.join(", ")}` : ""
  // autopilot approves only a reviewed design with every config as at HEAD;
  // anything else waits for the user as in any run.
  const self = run.autopilot === true && reviewed && head === ""
  const lead = self ? `autopilot이 ${run.d62 ? "고친 " : ""}2-plan.md를 승인하고 dev 단계로 넘어갑니다.` : `${run.d62 ? "고친 " : ""}2-plan.md가 승인을 기다립니다. /rein:dev를 입력하면 승인하고 dev 단계로 넘어갑니다.`
  const facts = `${lead} (${path})${unreviewed}${freeze}${head}${planting}`
  const ruleOf = rule ? { rule } : {}
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: "plan", tool: ADVANCE, decision: "deny", ...ruleOf, reason: "no answer" })
    await mutate($, r => (r?.stage === "plan" ? { ...r, waits: { stage: "plan", hash } } : undefined))
    const view = await writePlanView($, c, judged.plan)
    if (self) return selfAnswer(rule, view ? `${facts}\n\n코드 변경: ${view}` : facts, APPROVE)
    const fix = head === "" ? "continue the planner with what they want changed" : "continue the planner with what they want changed, or have .rein/config.json fixed (they fix it, or /rein:setup does with their confirmation)"
    return waiting(rule, view ? `${facts}\n\n코드 변경은 브라우저로 열어 지금 코드와 나란히 볼 수 있습니다. (${view})` : facts, "dev", `${fix} (the rein:plan skill says how), then call advance again without answer.`)
  }
  if (answer !== APPROVE) return offLabel(rule, answer, [APPROVE])
  // the repositories 2-plan.md names get the run's worktrees now.
  const planted = await intoTrees($, run, judged)
  if ("problem" in planted) {
    await trace($, run, { ev: "tool", stage: "plan", tool: ADVANCE, decision: "deny", reason: planted.problem })
    return { deny: `the run's git worktree could not be made, so the run stays in plan: ${planted.problem}. Tell the user (a branch ${treeBranch(run.runId)} or a folder of that name left from before is theirs to remove); then call advance again with the same answer.` }
  }
  const j = planted.j
  const moved = await mutate($, r => {
    if (r?.stage !== "plan" || Boolean(r.d62) !== Boolean(run.d62)) return undefined
    return { ...planPassed(r.d62 ? { ...r, keepRetries: undefined } : r, j), ...(planted.trees ? { trees: planted.trees } : {}) }
  })
  if (!moved) {
    for (const t of planted.made) await removeTree($, t)
    return { deny: `${ruled(rule)}the run changed while the question was open; nothing was moved.` }
  }
  await trace($, run, { ev: "exit", stage: "plan", pass: true, files: j.files, repos: j.repos, ...(planted.made.length > 0 ? { worktrees: planted.made.map(t => t.path) } : {}) })
  await trace($, run, { ev: "stage", from: "plan", to: moved.stage, answer, ...ruleOf })
  const hub = await hubOf($)
  const lost = hub && (await heldBy($, hub, moved, true))
  if (lost) return { result: `Approved, but ${await loseToPc($, moved, lost)}` }
  await writeInfo($, moved, "active", "plan")
  return { result: `Approved. The run is now in the ${moved.stage} stage.`, context: [`${passedEntry(moved, j.files, c.dir)}${setupLine(planted.setup)}`] }
}

// 2-plan.html beside 2-plan.md, for the person to read the design's diffs
// against the files as they are now; its path, or undefined when it could
// not be written (the approval goes on without it).
async function writePlanView($: EngineInterface, c: Ctx, plan: string): Promise<string | undefined> {
  const path = `${c.dir}/2-plan.html`
  try {
    const data = await planViewData(parsePlanView(plan), async file => {
      const full = resolve(file, c.root)
      return (await $.fs.exists(full)) ? await $.fs.read(full) : undefined
    })
    await $.fs.write(path, planViewHtml(data))
    return path
  } catch {
    return undefined
  }
}

// D120 at plan: each repository's config as it differs from the one in its
// HEAD commit, quoted, for the person to see before plan freezes it; "" when
// none differs. It compares the text judgePlan read and hashed (texts), not a
// second read, so what is shown is what gets frozen. A config HEAD does not hold (new, or untracked) is skipped:
// /rein:setup had the person confirm it. Compared field by field, so line
// endings alone are no change.
async function headChanges($: EngineInterface, repos: string[], texts: Record<string, string>): Promise<string> {
  const lines: string[] = []
  for (const repo of repos) {
    const committed = await runGit($, repo, ["show", "HEAD:.rein/config.json"])
    if (!committed || committed.exitCode !== 0 || committed.stdout.trim() === "") continue
    const path = `${repo}/.rein/config.json`
    const text = texts[repo]!
    let before: ConfigView | undefined
    try {
      before = viewOf(readConfig(committed.stdout))
    } catch {
      before = undefined
    }
    if (before && JSON.stringify(before) === JSON.stringify(viewOf(readConfig(text)))) continue
    lines.push(...changeLines(path, before, text))
  }
  return lines.length > 0 ? `\n\n커밋된(HEAD) 것과 다른 것 (HEAD → 지금):\n${quoted(lines.join("\n"))}` : ""
}

// G11 (user decision): a halted integration qa starts over only when the
// person says the environment is fixed (a D174 halt from an older version too).
// The entry runs again from the top (the probe, the path,
// the commands), the checks that passed in this visit kept; no retry
// is spent. A config that changed since it was frozen is not approved by
// this answer: advance first asks the D50 question and shows the change
// (amended), and the release question comes on the next advance.
async function releaseHalt($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const halt = run.halt!
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  const c = await ctxOf($, run)
  if (c.run.busy) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: halt.rule, reason: "no answer" })
    return unanswered(halt.rule, `환경을 고쳤나요? 통합 qa를 다시 돌릴까요? (멈춘 이유: ${halt.rule}: ${halt.reason})`, [RERUN, KEEP_HALT])
  }
  if (answer !== RERUN && answer !== KEEP_HALT) return offLabel(halt.rule, answer, [RERUN, KEEP_HALT])
  if (answer !== RERUN) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: halt.rule, answer })
    return { deny: `${halt.rule}: the run stays halted (${halt.reason}).` }
  }
  const token = await takeBusy($, "qa-integration", "entry")
  if (token === undefined) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  try {
    const now = await getRun($)
    if (!now?.halt || now.halt.rule === "D141" || now.halt.rule === "D173") {
      return { deny: `${halt.rule}: the run changed while the question was open; nothing was done. Call advance again.` }
    }
    const again = await frozenConfigs($, now)
    if ("problem" in again) return { deny: `D50: a config changed while the question was open: ${again.problem}.${backendsHint(again.problem)} Call advance again: it says what to ask the user.` }
    await trace($, now, { ev: "release", stage: now.stage, halt: now.halt, answer })
    const context = await integrationEntry($, await ctxOf($, now), now, again.configs, "qa-integration")
    return { result: entryOutcome(await getRun($), false), context: [context] }
  } finally {
    await dropBusy($, token)
  }
}

// an aside check failed, and a failure there is often
// the environment, the data, or what the code did before, not the change.
// The person decides: back to dev (an implementation problem) or to plan (a
// design problem), the failed checks again (they fixed the environment or the data),
// go on with the failure judged as what the code did before (the hook marks
// it in `## e2e`; the completion check then finds a part only it covers not
// shown), or keep the halt. A changed config is asked about first.
async function failGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  const c = await ctxOf($, run)
  if (c.run.busy) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  const file = `${c.dir}/agent/e2e.md`
  const failed = (run.e2e?.checks ?? []).filter(k => k.verdict === "실패")
  const shown = failed.map(k => `${k.name} — 세션 ${k.session ?? "없음"} — 판정: 실패\n  관측: ${k.observed ?? "(없음)"}${k.unshot ? `\n  증거: ${UNSHOT}` : ""}`).join("\n")
  // the parts of the completion line only the failed checks cover: with
  // 기존 동작으로 진행 the completion check finds them not shown. A check
  // whose only failed part is 레이아웃 still shows its 기대.
  const plan = `${c.dir}/2-plan.md`
  const cover = (await $.fs.exists(plan)) ? parseCover(await $.fs.read(plan)) : undefined
  const names = new Set(failed.map(k => k.name))
  const unshown = new Set(failed.filter(k => !onlyLayoutFailed(k)).map(k => k.name))
  const lost = cover && "cover" in cover ? cover.cover.flatMap(p => (p.by === "e2e" && p.checks.length > 0 && p.checks.every(n => unshown.has(n)) ? [`"${p.part}" (${p.checks.join(", ")}로만 확인)`] : [])) : undefined
  const meaning = [
    `${TO_DEV}: 코드 문제 — dev로 보냅니다.`,
    `${SEND_PLAN}: 설계 문제 — plan으로 보내 설계를 고칩니다. 고친 2-plan.md는 사용자가 승인합니다.`,
    `${RERUN_FAILED}: 환경이나 데이터를 고쳤음 — 통과한 항목은 두고 실패한 항목만 다시 돌립니다. 사용자가 실패한 항목을 직접 확인했다면 5-checklist.md에서 그 항목의 칸을 모두 체크한 뒤 이것을 고릅니다. 칸이 다 체크된 항목은 다시 돌지 않고 사용자 확인으로 통과합니다.`,
    `${AS_BEFORE}: 이 변경 탓이 아님 — 훅이 ## e2e에 사람 판단으로 적고 완료 판정 대조로 갑니다. 그 항목만 덮는 완료 판정 조각은 덮이지 않은 것으로 판정됩니다(레이아웃만 실패한 항목은 기대가 근거로 남습니다).`,
    ...(lost === undefined ? [] : [`  이 경우 확인되지 않는 조각: ${lost.length > 0 ? lost.join(", ") : "없음"}`]),
  ].join("\n")
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D173", reason: "no answer" })
    return unanswered("D173", `${run.e2e?.path === "ego" ? "ego" : "aside"} 확인 항목이 실패했습니다 (D173). 어떻게 할까요?\n${quoted(shown)}\n\n${meaning}\n\n전문: ${file}`, [TO_DEV, SEND_PLAN, RERUN_FAILED, AS_BEFORE, KEEP_HALT])
  }
  if (![TO_DEV, SEND_PLAN, RERUN_FAILED, AS_BEFORE, KEEP_HALT].includes(answer)) return offLabel("D173", answer, [TO_DEV, SEND_PLAN, RERUN_FAILED, AS_BEFORE, KEEP_HALT])
  if (answer === KEEP_HALT) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D173", answer })
    return { deny: "D173: the run stays halted in qa-integration." }
  }
  const token = await takeBusy($, "qa-integration", "entry")
  if (token === undefined) return { deny: "D79: the hook is already running the integration entry; wait for its result." }
  try {
    const changed = { deny: "D173: the run changed while the question was open; nothing was done. Call advance again." }
    const now = await getRun($)
    if (now?.stage !== "qa-integration" || now.halt?.rule !== "D173") return changed
    const again = await frozenConfigs($, now)
    if ("problem" in again) return { deny: `D50: a config changed while the question was open: ${again.problem}.${backendsHint(again.problem)} Call advance again: it says what to ask the user.` }
    if (answer === RERUN_FAILED) {
      await trace($, now, { ev: "release", stage: now.stage, halt: now.halt, answer })
      const context = await integrationEntry($, await ctxOf($, now), now, again.configs, "qa-integration")
      return { result: entryOutcome(await getRun($), false), context: [context] }
    }
    if (answer === TO_DEV || answer === SEND_PLAN) {
      let context = ""
      const moved = await mutate($, r => {
        if (r?.stage !== "qa-integration" || r.halt?.rule !== "D173") return undefined
        const routed = sendBack(r, answer, file)
        context = routed.context
        return routed.run
      })
      if (!moved) return changed
      await trace($, now, { ev: "stage", from: "qa-integration", to: moved.stage, retries: moved.retries, answer, rule: "D173" })
      return { result: `The user sent the run to ${moved.stage}.`, context: [`D173: the user judged the failed checks ${answer === TO_DEV ? "an implementation" : "a design"} problem; ${file} holds what the checks saw. ${context}`] }
    }
    let written = ""
    const moved = await mutate($, r => {
      if (r?.stage !== "qa-integration" || r.halt?.rule !== "D173" || !r.e2e?.checks) return undefined
      const checks = r.e2e.checks.map(k => (k.verdict === "실패" ? { ...k, person: true as const } : k))
      written = r.e2e.path === "ego" ? egoSection(checks) : asideSection(checks)
      return { ...r, halt: undefined, verifier: undefined, e2e: { ...r.e2e, checks, written } }
    })
    if (!moved) return changed
    await writeE2e($, file, written)
    for (const k of failed) await tickBox($, c.dir, k.name, "사용자가 기존 동작으로 판단")
    const names = failed.map(k => k.name).join(", ")
    await trace($, now, { ev: "release", stage: now.stage, halt: now.halt, answer, checks: failed.map(k => k.name) })
    return {
      result: "The user passed the failed checks as what the code did before.",
      context: [`D173: the user judged ${names} as what the code did before, not this change; the hook marked it in ## e2e of ${file}. A part of the completion line only those checks cover is not shown (레이아웃만 실패한 항목은 기대가 근거로 남습니다). Spawn rein:reviewer for the completion check (the rein:qa skill says how).`],
    }
  } finally {
    await dropBusy($, token)
  }
}

// the user chose Ego and nothing ran: ego did not answer
// (ego-unavailable), or a check has no ego profile (ego-profile-missing).
// They fix it and the entry runs again in ego, run it in Aside instead, or go
// on without e2e. A config changed since it was frozen is asked about first.
async function egoGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const rule = run.halt!.rule as "ego-unavailable" | "ego-profile-missing"
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  const busy = { deny: "D79: the hook is already running the integration entry; wait for its result." }
  if ((await ctxOf($, run)).run.busy) return busy
  const retry = rule === "ego-unavailable" ? EGO_ON : SETUP_DONE
  const labels = [retry, AS_ASIDE, NO_E2E]
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule, reason: "no answer" })
    const what = rule === "ego-unavailable"
      ? `Ego로 실행하려 했지만 ego를 쓸 수 없습니다 (ego lite가 꺼져 있거나, Claude Code를 켤 때 ego-browser가 PATH에 없었거나, ego 창이 닫혔거나 최소화됨). 어떻게 할까요? (${run.halt!.reason})`
      : `Ego로 실행하려 했지만 ego 프로필 설정이 빠졌습니다. /rein:setup으로 앱의 기본 프로필(e2e.apps.<앱>.profile)과 계정별 프로필(profiles)을 채우세요. 어떻게 할까요? (${run.halt!.reason})`
    return unanswered(rule, what, labels)
  }
  if (!labels.includes(answer)) return offLabel(rule, answer, labels)
  const token = await takeBusy($, "qa-integration", "entry")
  if (token === undefined) return busy
  try {
    const now = await getRun($)
    if (now?.stage !== "qa-integration" || now.halt?.rule !== rule) return { deny: `${rule}: the run changed while the question was open; nothing was done.` }
    const again = await frozenConfigs($, now)
    if ("problem" in again) return { deny: `D50: a config changed while the question was open: ${again.problem}.${backendsHint(again.problem)} Call advance again: it says what to ask the user.` }
    await trace($, now, { ev: "release", stage: now.stage, halt: now.halt, answer })
    const chosen = answer === AS_ASIDE ? await chooseBrowser($, "aside") : now
    if (!chosen) return { deny: `${rule}: the run changed while the question was open; nothing was done.` }
    const context = await integrationEntry($, await ctxOf($, chosen), chosen, again.configs, "qa-integration", answer === NO_E2E)
    const after = await getRun($)
    if (answer === retry && after?.halt?.rule === rule) return { deny: `${rule}: still the same (${after.halt.reason}); the run stays halted. Tell the user; once it is fixed, call advance again.` }
    return { result: entryOutcome(after, answer === NO_E2E), context: [context] }
  } finally {
    await dropBusy($, token)
  }
}

// an ego check whose driver handed its space to the user (a login, a
// second factor, a file picker): the first such check the user has not
// answered for, in 2-plan.md's order.
const handedOff = (run: Run) => run.e2e?.path === "ego" ? run.e2e.checks?.find(k => isOpen(k) && k.ego?.handoff !== undefined && !k.ego.resumed) : undefined

// the user did what the space was handed off for: its driver takes the
// space back at its next round, when the check's clock starts again (the main
// session resumes it with SendMessage). Or they test that check by hand: it
// closes with no verdict and stays in 5-checklist.md for them.
async function handoffGate($: EngineInterface, run: Run, k: CheckRun, answer: string | undefined): Promise<ToolCallResult> {
  const labels = [HANDED_DONE, BY_PERSON]
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "handoff", check: k.name, reason: "no answer" })
    return unanswered("", `check ${k.name}의 ego 스페이스(${k.ego!.space})를 사용자에게 넘겼습니다. ego 화면에서 이것을 해 주세요: ${k.ego!.handoff}\n끝냈나요?\n\n${HANDED_DONE}: driver가 스페이스를 다시 받아 이어 갑니다.\n${BY_PERSON}: 이 check는 사람이 5-checklist.md대로 직접 확인합니다.`, labels)
  }
  if (!labels.includes(answer)) return offLabel("", answer, labels)
  const c = await ctxOf($, run)
  let settled: ReturnType<typeof settleEgo>
  const moved = await mutate($, r => {
    const at = r?.stage === "qa-integration" && r.e2e?.path === "ego" ? r.e2e.checks?.find(x => x.name === k.name && isOpen(x) && x.ego?.handoff !== undefined && !x.ego.resumed) : undefined
    if (!r?.e2e?.checks || !at?.ego) return undefined
    const next: CheckRun = answer === HANDED_DONE ? { ...at, ego: { ...at.ego, resumed: true } } : { ...at, running: undefined, ego: { ...at.ego, human: true } }
    const checks = r.e2e.checks.map(x => (x.name === k.name ? next : x))
    settled = answer === BY_PERSON ? settleEgo(checks) : undefined
    return settledRun(r, checks, settled)
  })
  if (!moved) return { deny: "The run changed while the question was open; nothing was done. Call mcp__rein__status." }
  await trace($, run, { ev: "handoff", stage: run.stage, check: k.name, answer })
  if (answer === HANDED_DONE) {
    await $.fs.write(`${c.dir}/${checkFolder(k)}/${TAKEOVER_MARK}`, "")
    return { result: `The user finished what check ${k.name}'s space was handed off for.`, context: [`Resume its rein:ego-driver ${k.runner} with SendMessage (to: ${k.runner}): "The user finished in the browser. Write your next round; the harness takes the space back." Its time runs again from that round.`] }
  }
  return { result: `The user takes check ${k.name} to test by hand.`, context: [await egoSettledLine($, moved, settled)] }
}

// the run with check verdicts and what settleEgo made of them: ## e2e and a
// halt, or back to waiting for the user with the checks as they stand.
function settledRun(r: Run, checks: CheckRun[], settled: ReturnType<typeof settleEgo>): Run {
  if (settled?.wait) return { ...r, e2e: { path: "wait", checks } }
  return { ...r, e2e: { ...r.e2e!, checks, ...(settled?.written ? { written: settled.written } : {}) }, halt: settled?.halt ?? r.halt }
}

// what the main session is told once an ego check closed.
async function egoSettledLine($: EngineInterface, run: Run, settled: ReturnType<typeof settleEgo>): Promise<string> {
  const dir = (await ctxOf($, run)).dir
  if (!settled || settled.wait) await writeChecks($, `${dir}/agent/e2e.md`, "ego")
  if (!settled) return "Other ego checks are still open; spawn the agents mcp__rein__status asks for."
  if (settled.wait) return `No ego check is open now; the checks the user takes by hand are left. The run waits for them again (e2e: wait): ${dir}/5-checklist.md has the passed checks ticked. Tell the user: they test the unticked ones by hand and check them, then run /rein:land; or run /rein:e2e again; or tell you a problem.`
  return settledLine($, run, settled, "ego")
}

// screen id's box in 5-checklist.md, checked by rein:layout-verifier.
async function tickLayoutBox($: EngineInterface, dir: string, id: string): Promise<void> {
  const list = `${dir}/5-checklist.md`
  if (await $.fs.exists(list)) await $.fs.write(list, tickLayout(await $.fs.read(list), id, "ego와 rein:layout-verifier가 to-be와 같다고 판정"))
}

// when every ego check has its verdict and the only ones that failed are
// layout checks, the run goes back to dev on its own, counted
// as an implementation failure: the worker reads LAYOUT_FAILS. What the
// main session is told, or undefined when that is not the case.
async function layoutsBack($: EngineInterface, dir: string, run: Run, settled: ReturnType<typeof settleEgo>): Promise<string | undefined> {
  if (settled?.halt?.rule !== "D173") return undefined
  const failed = (run.e2e?.checks ?? []).filter(k => k.verdict === "실패")
  if (failed.length === 0 || !failed.every(k => isLayoutCheck(k.name))) return undefined
  const fails = await Promise.all(failed.map(async k => {
    const id = layoutIdOf(k.name)
    const count = run.layoutFails?.[id] ?? 1
    return { id, mockup: `${MOCKUP_SHOTS}/${id}.png`, shots: await shotsIn($, dir, checkFolder(k)), diffs: (k.ego?.parts ?? []).join(" / "), count, measured: count >= MEASURE_AT ? [`${checkFolder(k)}/`] : [] }
  }))
  const file = `${dir}/${LAYOUT_FAILS}`
  await $.fs.write(file, layoutFailsText(dir, fails))
  let context = ""
  const moved = await mutate($, r => {
    if (r?.stage !== "qa-integration" || r.halt?.rule !== "D173") return undefined
    const routed = routeJudged(r, file, "구현")
    context = routed.context
    return routed.run
  })
  if (!moved) return undefined
  await trace($, moved, { ev: "stage", from: "qa-integration", to: moved.stage, rule: "layout-differs", screens: fails.map(f => f.id), retries: moved.retries })
  return `Only layout checks failed (${fails.map(f => `#${f.id}`).join(", ")}): the screen as built differs from the to-be of 1-mockup.html, so the run goes back to dev on its own with ${file}. Report this to the main session and stop. ${context}`
}

// check `name`'s box in 5-checklist.md, when the file is there.
async function tickBox($: EngineInterface, dir: string, name: string, why: string): Promise<void> {
  const list = `${dir}/5-checklist.md`
  if (await $.fs.exists(list)) await $.fs.write(list, tick(await $.fs.read(list), name, why))
}

// the work qa passed with checks to run, and the hook wrote
// 5-checklist.md; integration qa waits for the person. They tested by hand
// and checked every box (직접 확인 완료, from /rein:land: ## e2e says so and
// the run goes to land with no completion check), want aside or ego to run
// the checks (e2e 실행 (Aside) or (Ego), from /rein:e2e: the entry runs in
// that browser, kept in the run for its reruns), or
// found a problem (dev로 보냄 or plan으로 보냄: what they found is in
// 5-checklist.md; back to dev or plan with it). A changed config is asked about first.
async function waitGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return approveConfigs($, run, answer)
  const c = await ctxOf($, run)
  const busy = { deny: "D79: the hook is already running the integration entry; wait for its result." }
  if (c.run.busy) return busy
  const list = `${c.dir}/5-checklist.md`
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", reason: "no answer" })
    const meaning = [
      `${BY_HAND}: 체크리스트대로 직접 확인했고 모든 칸을 체크함 — land로 갑니다 (/rein:land).`,
      `${E2E_ASIDE}: aside가 항목을 확인합니다. 항목마다 rein:e2e-runner가 맡고, 최대 ${AT_ONCE}개를 동시에 돌립니다 (/rein:e2e).`,
      `${E2E_EGO}: ego 브라우저에서 항목마다 rein:ego-driver가 조작하며 증거를 남기고, rein:ego-judge가 증거로 판정합니다. driver는 최대 ${AT_ONCE}개를 동시에 돌립니다 (/rein:e2e).`,
      `${TO_DEV}: 문제를 찾음, 코드 문제 — 찾은 것을 체크리스트에 적고 dev로 보냅니다.`,
      `${SEND_PLAN}: 문제를 찾음, 설계 문제 — 찾은 것을 체크리스트에 적고 plan으로 보내 설계를 고칩니다.`,
    ].join("\n")
    return unanswered("", `작업 qa가 통과했고, 통합 테스트가 사용자를 기다립니다. 어떻게 할까요?\n체크리스트: ${list}\n\n${meaning}`, [BY_HAND, E2E_ASIDE, E2E_EGO, TO_DEV, SEND_PLAN])
  }
  if (![BY_HAND, E2E_ASIDE, E2E_EGO, TO_DEV, SEND_PLAN].includes(answer)) return offLabel("", answer, [BY_HAND, E2E_ASIDE, E2E_EGO, TO_DEV, SEND_PLAN])
  if (answer === BY_HAND) {
    const open = (await $.fs.exists(list)) ? unchecked(await $.fs.read(list)) : undefined
    if (open === undefined || open.length > 0) {
      await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", answer, open: open ?? "no checklist" })
      const why = open === undefined ? `${list} is gone, so there is nothing to show the user's test.` : `these boxes of ${list} are still empty:\n${open.map(l => `  ${l}`).join("\n")}`
      return { deny: `The run does not go to land: ${why}\nTell the user. Once they have checked every box (by hand, or you check those they say passed), call advance again with their answer.` }
    }
  }
  const token = await takeBusy($, "qa-integration", "entry")
  if (token === undefined) return busy
  try {
    const changed = { deny: "The run changed while the question was open; nothing was done. Call advance again." }
    const now = await getRun($)
    if (now?.stage !== "qa-integration" || now.e2e?.path !== "wait" || now.halt) return changed
    const waiting = (r: Run | undefined): r is Run => r?.stage === "qa-integration" && r.e2e?.path === "wait" && !r.halt
    if (answer === E2E_ASIDE || answer === E2E_EGO) {
      const again = await frozenConfigs($, now)
      if ("problem" in again) return { deny: `D50: a config changed while the question was open: ${again.problem}.${backendsHint(again.problem)} Call advance again: it says what to ask the user.` }
      await trace($, now, { ev: "e2e", stage: now.stage, answer })
      const chosen = await chooseBrowser($, answer === E2E_EGO ? "ego" : "aside")
      if (!chosen) return changed
      const context = await integrationEntry($, await ctxOf($, chosen), chosen, again.configs, "qa-integration")
      return { result: entryOutcome(await getRun($), false), context: [context] }
    }
    if (answer === TO_DEV || answer === SEND_PLAN) {
      let context = ""
      const moved = await mutate($, r => {
        if (!waiting(r)) return undefined
        const routed = sendBack(r, answer, list)
        context = routed.context
        return routed.run
      })
      if (!moved) return changed
      await trace($, now, { ev: "stage", from: "qa-integration", to: moved.stage, retries: moved.retries, answer })
      return { result: `The user sent the run to ${moved.stage}.`, context: [`The user found a problem in the integration test; ${list} holds the checklist and what they found. ${context}`] }
    }
    const moved = await mutate($, r => (waiting(r) ? { ...r, verifier: undefined, e2e: { path: "manual", written: E2E_MANUAL } } : undefined))
    if (!moved) return changed
    await writeE2e($, `${c.dir}/agent/e2e.md`, E2E_MANUAL, true)
    await trace($, now, { ev: "e2e", stage: now.stage, answer, path: "manual" })
    const judged = await integrationExit($, await ctxOf($, moved), { result: "ok" } as ToolCallResult)
    return { result: "The user checked every box of 5-checklist.md by hand.", context: judged.context ?? [] }
  } finally {
    await dropBusy($, token)
  }
}

// integration qa passed with a layout box of 5-checklist.md still empty.
// The user compared each to-be screen of 1-mockup.html with the screen as
// built and checked its box (직접 확인 완료, from /rein:land: the run goes on
// as integration qa left it), or found a layout that differs (dev로 보냄:
// what they found is in 5-checklist.md; back to dev with it, or to plan
// with plan으로 보냄).
async function layoutGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const c = await ctxOf($, run)
  if (c.run.busy) return { deny: "D79: the hook is already judging integration qa; wait for its result." }
  const list = `${c.dir}/5-checklist.md`
  const labels = [BY_HAND, TO_DEV, SEND_PLAN]
  const open = openLayouts((await $.fs.exists(list)) ? await $.fs.read(list) : undefined, run.layouts ?? [])
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "layout-unchecked", reason: "no answer" })
    const meaning = [
      `${BY_HAND}: 화면마다 구현된 배치가 to-be와 같아 칸을 모두 체크함 — land로 갑니다 (/rein:land).`,
      `${TO_DEV}: 배치가 다름, 코드 문제 — 다른 곳을 체크리스트에 적고 dev로 보냅니다.`,
      `${SEND_PLAN}: 배치가 다름, 설계 문제 — 다른 곳을 체크리스트에 적고 plan으로 보내 설계를 고칩니다.`,
    ].join("\n")
    return unanswered("layout-unchecked", `통합 qa는 통과했고, 화면 배치 대조가 사용자를 기다립니다. 구현된 화면을 ${c.dir}/1-mockup.html 의 to-be와 비교해 주세요.\n체크리스트: ${list}\n빈 칸: ${open.map(a => `배치 ${a}`).join(", ")}\n\n${meaning}`, labels, true)
  }
  if (!labels.includes(answer)) return offLabel("layout-unchecked", answer, labels)
  const changed = { deny: "The run changed while the question was open; nothing was done. Call advance again." }
  const held = (r: Run | undefined): r is Run => r?.stage === "qa-integration" && r.halt?.rule === "layout-unchecked"
  if (answer === TO_DEV || answer === SEND_PLAN) {
    let context = ""
    const moved = await mutate($, r => {
      if (!held(r)) return undefined
      const routed = sendBack(r, answer, list)
      context = routed.context
      return routed.run
    })
    if (!moved) return changed
    await trace($, run, { ev: "stage", from: "qa-integration", to: moved.stage, retries: moved.retries, answer, rule: "layout-unchecked" })
    return { result: `The user sent the run to ${moved.stage}.`, context: [`The user found a layout that differs from the to-be of 1-mockup.html; ${list} holds the checklist and what they found. ${context}`] }
  }
  if (open.length > 0) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", answer, open })
    return { deny: `The run does not go to land: these layout boxes of ${list} are still empty: ${open.map(a => `배치 ${a}`).join(", ")}.\nTell the user. Once they have checked them (by hand, or you check those they say match the to-be), call advance again with their answer.` }
  }
  const moved = await mutate($, r => (held(r) ? { ...r, halt: undefined } : undefined))
  if (!moved) return changed
  await trace($, run, { ev: "release", stage: run.stage, halt: run.halt, answer })
  const judged = await integrationExit($, await ctxOf($, moved), { result: "ok" } as ToolCallResult)
  return { result: "The user compared every to-be screen of 1-mockup.html and checked its box.", context: judged.context ?? [] }
}

// the user's answer at an integration gate: dev or plan, with the file to
// read. Neither counts toward the hidden cap.
const sendBack = (r: Run, answer: string, file: string) =>
  answer === SEND_PLAN
    ? toPlan({ ...r, busy: undefined }, file, "the user judged the integration failure a design problem")
    : toDev({ ...r, busy: undefined }, file)

// a failure the hook stopped the run for (holdRoute): no agent judged it,
// or the implementation failures reached the hidden cap. The main session
// decides, with the user when it is not plain: dev (not counted) or plan.
async function routeGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const halt = run.halt!
  const labels = [TO_DEV, SEND_PLAN]
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: halt.rule, reason: "no answer" })
    const meaning = [
      `${TO_DEV}: 코드 문제 — dev가 실패 기록을 읽고 고칩니다.`,
      `${SEND_PLAN}: 설계 문제 — plan에서 설계를 고치고, 고친 2-plan.md는 사용자가 승인합니다.`,
    ].join("\n")
    return unanswered(halt.rule, `실패한 run이 ${run.stage}에서 멈췄습니다 (${halt.reason}). 실패 기록: ${halt.file}\n\n${meaning}`, labels)
  }
  if (!labels.includes(answer)) return offLabel(halt.rule, answer, labels)
  let context = ""
  const moved = await mutate($, r => {
    if (r?.stage !== run.stage || r.halt?.rule !== "failure-route" || r.busy) return undefined
    const file = r.halt.file ?? halt.file!
    const routed = answer === TO_DEV ? toDev(r, file) : toPlan(r, file, "the main session judged the failure a design problem")
    context = routed.context
    return routed.run
  })
  if (!moved) return { deny: `${halt.rule}: the run changed while the question was open; nothing was moved. Call advance again.` }
  await trace($, run, { ev: "stage", from: run.stage, to: moved.stage, retries: moved.retries, answer, rule: halt.rule })
  return { result: `The run is now in the ${moved.stage} stage.`, context: [context] }
}

// G2: the run as it stands, for the agent, which cannot read $.store. It
// never changes the run; no run is an answer, not a refusal.
async function status($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  // the send queue of the git sync Rein used before goes.
  if ((await $.store.get(OLD_PENDING)) !== undefined) await $.store.delete(OLD_PENDING)
  // the hub as the local frame server last found it, and a store near its limit.
  const hub = await hubLines($)
  const full = await storeWarning($)
  const after = `${hub}${full ? `\n${full}` : ""}`
  const run = await getRun($)
  if (!run) {
    // with no run open, the runs this session could resume, and
    // the runs on the hub.
    const list = await resumable($)
    // a run from before the hub gets its agent/record.json, for the local
    // frame server to send.
    if (await hubOf($)) {
      for (const r of list) {
        const dir = await folderOf($, r.state, r.runId)
        const stored = normalizeRun(await $.store.get(await recordKey($, r.runId)))
        if (stored && (await $.fs.exists(dir)) && !(await $.fs.exists(`${dir}/agent/record.json`))) await writeInfo($, stored, r.state, "status")
      }
    }
    const none = "No Rein run is open in this session."
    const remote = await hubRunLines($, input.runId)
    return { result: `${list.length === 0 ? none : `${none}\nResumable runs of this project (mcp__rein__resume with the runId; the user confirms):\n${resumableLines(list)}`}${remote}${after}` }
  }
  // a runner that ended without its result frees its check first.
  if (run.stage === "qa-integration") await reapRunners($)
  const shown = run.stage === "qa-integration" ? ((await getRun($)) ?? run) : run
  // in review the reviewer's lists too, as the dev→review result gave them.
  const c = await ctxOf($, run)
  const extra = run.stage === "review" ? `\n${reviewLists(run, c.root, true)}${reviewNext(shown, c.dir)}` : ""
  // the knowledge index goes to a file, written when it changed; status names it.
  const known = await knowledge($, await outsideProjects($, run))
  const index = knowledgeIndex(known, STATUS_USE)
  const indexFile = `${c.dir}/${KNOWLEDGE_FILE}`
  if (index && (!(await $.fs.exists(indexFile)) || (await $.fs.read(indexFile)) !== `${index}\n`)) await $.fs.write(indexFile, `${index}\n`).catch(() => {})
  const waits = await waitsFor($, shown, c.dir)
  const text = `${renderRun(shown)}${waits.length > 0 ? `\nwaits for the user: they type ${waits.join(" or ")}` : ""}${extra}\nrun directory: ${c.dir}${index ? `\n${knowledgePointer(known, indexFile)}` : ""}${after}`
  await trace($, run, { ev: "tool", stage: run.stage, tool: STATUS, input, decision: "allow", textLength: text.length, text: clip(text) })
  return { result: text }
}

// in a run the main session's own `git commit` (Bash
// or PowerShell) runs only once the person approves it, the message shown.
// The hook refuses it
// and keeps the command; the main session asks, and advance takes the answer
// (commitAnswer). An approved command runs once, as it was. Undefined when
// it may run, else why not.
async function commitGate($: EngineInterface, run: Run, c: Ctx, tool: string, command: string): Promise<string | undefined> {
  if (run.commit?.approved && run.commit.command === command) {
    await mutate($, r => (r?.commit?.approved && r.commit.command === command ? { ...r, commit: undefined } : undefined))
    await trace($, run, { ev: "tool", stage: run.stage, tool, command, decision: "allow", rule: "D182" })
    return undefined
  }
  await mutate($, r => (r ? { ...r, commit: { command } } : undefined))
  await trace($, run, { ev: "tool", stage: run.stage, tool, command, decision: "deny", rule: "D182", reason: "no answer" })
  const asked = unanswered("D182", await commitFacts($, run, c.root, command), [COMMIT, CANCEL], true).result!
  return `${asked}\n\nPass the answer to mcp__rein__advance; on ${COMMIT} run this same command again, unchanged.`
}

// what the person sees about the main session's commit, the message
// read from the command (or the file it names).
async function commitFacts($: EngineInterface, run: Run, root: string, command: string): Promise<string> {
  const read = commitMessage(command)
  let message = read.message
  if (message === undefined && read.file !== undefined) {
    const path = resolve(read.file, root)
    message = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  }
  const shown = command.length > 1500 ? `${command.slice(0, 1500)}…` : command
  const text = quoted(message === undefined ? "(명령에서 읽지 못함 — 아래 명령을 보세요)" : message.trim())
  return `run ${run.runId}(${run.stage} 단계) 중에 메인 세션이 커밋하려 합니다 (D182). 이 메시지로 커밋할까요?\n\n커밋 메시지:\n${text}\n\n명령:\n${quoted(shown)}`
}

// while the main session's commit waits, advance takes the
// person's answer to it before anything else.
async function commitAnswer($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  const command = run.commit!.command
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D182", reason: "no answer" })
    return unanswered("D182", await commitFacts($, run, (await ctxOf($, run)).root, command), [COMMIT, CANCEL], true)
  }
  if (answer !== COMMIT && answer !== CANCEL) return offLabel("D182", answer, [COMMIT, CANCEL])
  if (answer === COMMIT) {
    await mutate($, r => (r?.commit?.command === command ? { ...r, commit: { command, approved: true } } : undefined))
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "allow", rule: "D182", answer })
    return { result: "The user approved the commit. Run the same command again, unchanged; it runs once." }
  }
  if (answer === CANCEL) {
    await mutate($, r => (r?.commit?.command === command ? { ...r, commit: undefined } : undefined))
    await trace($, run, { ev: "tool", stage: run.stage, tool: ADVANCE, decision: "deny", rule: "D182", answer })
    return { result: "The user did not approve the commit; it does not run. Do what they said (a changed command, say, is asked about anew)." }
  }
  return offLabel("D182", answer, [COMMIT, CANCEL])
}

// the agent asks to stop the run; only the person's
// answer defers it (보류, resumable later), drops it (폐기, e.g. there was no
// bug, or the requirement was cancelled) or closes it as done outside
// Rein (완료: the change went in by the person's own commits), from any stage. Refused while a
// judgment runs commands. Repository files and the staging are never touched.
async function park($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  const run = await getRun($)
  if (!run) return { deny: "D146: this session has no run open; there is nothing to park." }
  const lost = await lostHere($, run)
  if (lost) return lost
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (reason === "") return { deny: "D146: give the reason the user wants to stop the run, as { reason }." }
  const busy = (await ctxOf($, run)).run.busy
  if (busy) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: PARK, decision: "deny", rule: "D146", reason: `busy: ${busy.what}` })
    return { deny: `D146: the hook is running a judgment's commands (${busy.what}); wait for its result, then call park again.` }
  }
  const answer = answerOf(input)
  const trees = (run.trees ?? []).filter(t => !t.landed)
  // No trace line: it would make a run folder deleted by hand again.
  if (answer === undefined) {
    return unanswered(
      "D146",
      `run ${run.runId}(${run.stage} 단계)을 멈출까요? 에이전트가 전한 이유:\n${quoted(reason)}\n\n보류: 나중에 이어서 할 수 있게 둡니다. 폐기: run을 버립니다. 완료: Rein 밖에서(직접 커밋 등) 이미 반영했으니 run을 끝난 것으로 닫습니다. 어느 쪽이든 저장소의 파일과 스테이징은 그대로이고, 이 세션은 run이 없는 상태가 됩니다.${trees.length > 0 ? `

이 run의 워크트리: ${trees.map(t => t.path).join(", ")}. 폐기하면 워크트리와 브랜치 ${treeBranch(run.runId)}를 지웁니다(그 안의 커밋 안 된 변경도 사라짐). 보류·완료는 남깁니다.` : ""}\n\n이어받을 때 승인된 1-spec.md·2-plan.md나 dev가 넘긴 설계 파일이 바뀌어 있으면 알려 주고, run은 그 단계에 그대로 둡니다.`,
      [DEFER, DROP, DONE_OUTSIDE, KEEP_GOING],
    )
  }
  if (![DEFER, DROP, DONE_OUTSIDE, KEEP_GOING].includes(answer)) return offLabel("D146", answer, [DEFER, DROP, DONE_OUTSIDE, KEEP_GOING])
  if (answer === KEEP_GOING) {
    await trace($, run, { ev: "tool", stage: run.stage, tool: PARK, decision: "deny", rule: "D146", answer, said: saidOf(input), why: clip(reason) })
    return { deny: `D146: the run is not stopped. It stays open in ${run.stage}; carry on with it.` }
  }
  const now = await getRun($)
  if (!now || now.runId !== run.runId) return { deny: "D146: the run changed while the question was open; nothing was done." }
  if ((await ctxOf($, now)).run.busy) return { deny: "D146: a judgment started running commands while the question was open; nothing was done. Call park again once it is done." }
  // 폐기 removes the worktrees, and Windows keeps a folder the session is in.
  if (answer === DROP) {
    const root = await sessionRoot($)
    const inside = (now.trees ?? []).find(t => !t.landed && (same(root, t.path) || under(root, t.path)))
    if (inside) return { deny: `D146: this session is in the run's worktree ${inside.path}, which 폐기 removes, and a folder the session is in cannot be removed (on Windows). Call ExitWorktree with action "keep" first, then call park again with the same answer. Nothing changed.` }
  }
  const event = { ev: "park", stage: now.stage, answer, said: saidOf(input), reason: clip(reason) }
  const to = answer === DEFER ? "defer" : answer === DROP ? "drop" : "complete"
  const left = await leaveActive($, now, to, event)
  if ("problem" in left) {
    return { deny: `D144: the run folder could not be moved (${left.problem}), so nothing changed; the run stays open in ${now.stage}. Tell the user (on Windows a file in ${await folderOf($, "active", now.runId)} may be open in another program); once fixed, call park again.` }
  }
  const where = await folderOf($, to, now.runId)
  // a dropped run's worktrees go; a deferred or completed one keeps them.
  const kept = (now.trees ?? []).filter(t => !t.landed)
  const removed: string[] = []
  if (to === "drop") for (const t of kept) removed.push(...(await removeTree($, t)))
  const home = kept.find(t => t.root)
  const treeNote = kept.length === 0 ? ""
    : to === "drop"
      ? ` Its worktrees and branch ${treeBranch(now.runId)} were removed.${removed.length > 0 ? ` Removing them did not finish: ${removed.join("; ")}.` : ""}`
      : ` Its worktrees stay: ${kept.map(t => t.path).join(", ")}.${home ? ` To work elsewhere meanwhile, call ExitWorktree with action "keep".` : ""}`
  const said = to === "defer"
    ? `The user put the run aside (보류). Its folder is now ${where}; mcp__rein__resume with runId ${now.runId} continues it later, from this session or another.`
    : to === "drop"
      ? `The user dropped the run (폐기). Its record stays in ${where}.`
      : `The user closed the run as done outside Rein (완료, D183). Its record is in ${where}.`
  return { result: `${said}${left.note}${treeNote} This session has no run now. Repository files and the staging are as they were; if they hold changes of this run, the user decides what to do with them. Tell the user.${left.retro}` }
}

// picks up a deferred run, or an active one another
// session holds, in this session, on the person's answer. The fields bound
// to the session that held it go: the judges' agentIds, the busy token, a
// waiting main-session commit (the person approves again) and a running
// aside.
// heads and the rest stay. What changed while it was parked is
// measured as any change by the main session is.
async function resume($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult> {
  const current = await getRun($)
  if (current) {
    return { deny: `D59: this session already has a run open (${current.runId}, stage ${current.stage}); one run per session. Call mcp__rein__park first (the user chooses 보류 or 폐기), then resume.` }
  }
  const runId = input.runId
  const list = await resumable($)
  const target = typeof runId === "string" ? list.find(r => r.runId === runId) : undefined
  const none = `D147: ${String(runId)} is not a run this session can resume. ${list.length > 0 ? `Resumable runs of this project:\n${resumableLines(list)}` : "This project has none."}`
  // a run of the hub this PC does not record.
  const hub = await hubOf($)
  if (!target && typeof runId === "string" && hub) return resumeRemote($, hub, runId, answerOf(input), saidOf(input), none)
  if (!target) return { deny: none }
  // for a run another PC took over on the hub, the hub's is offered
  // instead; this PC's record and copy let go once the user takes it up.
  const stored = hub && normalizeRun(await $.store.get(await recordKey($, target.runId)))
  if (hub && stored && (await heldBy($, hub, stored, true))) return resumeRemote($, hub, target.runId, answerOf(input), saidOf(input), none, true)
  const warn = target.state === "active"
    ? "\n\n주의: 이 run은 다른 세션이 연 채로 남아 있습니다. 그 세션이 아직 열려 있으면 그 세션은 run을 잃습니다."
    : ""
  const [from, dest] = [await folderOf($, "defer", target.runId), await folderOf($, "active", target.runId)]
  const missing = target.state === "defer" && !(await $.fs.exists(from)) && !(await $.fs.exists(dest))
  const lost = missing ? `\n\n주의: 이 run의 폴더가 없습니다(${from}). 이어받으면 1-spec.md 같은 산출물 없이 진행하게 됩니다.` : ""
  // the run goes on in its worktrees, so they must still be there.
  const vanished: Tree[] = []
  for (const t of normalizeRun(await $.store.get(await recordKey($, target.runId)))?.trees ?? []) {
    if (!t.landed && !(await $.fs.exists(t.path))) vanished.push(t)
  }
  if (vanished.length > 0) {
    const back = vanished.map(t => `\`git -C ${t.repo} worktree add ${t.path} ${t.branch}\``).join(" and ")
    return { deny: `D147: ${target.runId} works in git worktrees that are gone: ${vanished.map(t => t.path).join(", ")}, so it cannot go on. Tell the user: while its branch ${treeBranch(target.runId)} is still there, ${back} brings the worktree back (what was not committed in it is gone); then resume again. Nothing changed.` }
  }
  const answer = answerOf(input)
  if (answer === undefined) {
    return unanswered(
      "D147",
      `이 run을 이 세션에서 이어서 진행할까요?\n\nrun: ${target.runId}\n단계: ${target.stage} (${target.state === "defer" ? "보류됨" : "다른 세션에서 진행 중"})\n제목:\n${quoted(target.title)}${warn}${lost}\n\n커밋 승인과 기록된 서브에이전트는 지워지고, 필요하면 다시 묻습니다.`,
      [TAKE_UP, CANCEL],
    )
  }
  if (answer !== TAKE_UP && answer !== CANCEL) return offLabel("D147", answer, [TAKE_UP, CANCEL])
  if (answer !== TAKE_UP) return { deny: `D147: ${target.runId} is not resumed. Nothing changed.` }
  const [key, pointer, project, session] = [await recordKey($, target.runId), await pointerKey($), await projectName($), await $.session.id()]
  const asAsked = (r: Run | undefined) => (target.state === "defer" ? r?.status === "defer" : r?.status === "active" && r.owner !== session)
  let folder = (target.state === "defer" ? "moved" : "there") as "moved" | "there" | "missing"
  // In one store lock: nothing opened meanwhile, the record as it was asked
  // about, the folder back to active/ (unless it is there already, or gone),
  // the record checked again (a change meanwhile puts the folder back), then
  // it is this session's.
  const outcome = await locked(async (): Promise<Run | string> => {
    if ((await lookup($)).run) return "D59: this session opened a run while the question was open; nothing was done."
    if (!asAsked(normalizeRun(await $.store.get(key)))) return `D147: ${target.runId} changed while the question was open; nothing was done.`
    if (target.state === "defer") {
      if (!(await $.fs.exists(from))) folder = (await $.fs.exists(dest)) ? "there" : "missing"
      else {
        const problem = await moveFolder($, from, dest, { runId: target.runId, out: false })
        if (problem !== undefined) return `D144: the run folder could not be moved (${problem}), so nothing changed. Tell the user (on Windows a file in it may be open in another program); once fixed, call resume again.`
      }
    }
    const r = normalizeRun(await $.store.get(key))
    if (!r || !asAsked(r)) {
      if (folder !== "moved") return `D147: the record of ${target.runId} changed or is gone; nothing was resumed.`
      const back = await moveFolder($, dest, from, { runId: target.runId, out: true })
      return `D147: the record of ${target.runId} changed or is gone; nothing was resumed. ${back === undefined ? `The folder is back in ${from}.` : `Moving the folder back failed (${back}), so it is in ${dest}.`}`
    }
    gone.delete(target.runId)
    const next: Run = {
      ...r, status: "active", owner: session,
      grader: undefined, sketcher: undefined, worker: undefined, arbiter: undefined, reviewer: undefined, verifier: undefined, busy: undefined, commit: undefined,
      splitter: undefined, reviewGroups: r.reviewGroups?.map(g => ({ ...g, reviewer: undefined })),
      e2e: r.e2e && { ...r.e2e, checks: r.e2e.checks?.map(k => ({ ...k, runner: undefined, running: undefined })) },
    }
    await $.store.set(key, next)
    await $.store.set(pointer, { project, runId: target.runId })
    return next
  })
  if (typeof outcome === "string") {
    if (target.state === "defer") await trace($, { runId: target.runId } as Run, { ev: "error", tool: RESUME, error: outcome }, folder === "moved" ? "defer" : "active")
    return { deny: outcome }
  }
  const resumed = outcome
  await trace($, resumed, { ev: "resume", stage: target.stage, from: target.state, session, ver: VERSION, answer, said: saidOf(input), ...(folder === "missing" ? { folder } : {}) })
  await writeInfo($, resumed, "active", "resume")
  const missingNote = folder === "missing" ? ` Its folder was missing, so 1-spec.md and the other run files are gone; tell the user (they may park it and choose 폐기).` : ""
  const note = `${missingNote}${target.state === "active" ? " The session that held it no longer does; tell the user." : ""}`
  return carryOn($, resumed, note)
}

// the run is this session's now; the rein skill of its stage goes on.
async function carryOn($: EngineInterface, resumed: Run, note: string): Promise<ToolCallResult> {
  closed = undefined
  const c = await ctxOf($, resumed)
  await renameFiles($, c.dir)
  // a run picked back up is drawn like a run just opened.
  await openFrame($, resumed)
  // 1-spec.md, 2-plan.md or the sealed files changed while it was parked.
  const changed = await drifted($)
  const skill = resumed.stage === "spec" ? "the rein:spec skill, skipping its step 0 (the run is open)" : `the ${SKILL[resumed.stage]} skill`
  const away = await awayFrom($, resumed)
  return {
    result: `Resumed ${resumed.runId} in this session. The run is in the ${resumed.stage} stage; its folder is ${c.dir}.${note}${away ? ` ${enterLine(away)}` : ""}`,
    context: [`D147: invoke ${skill} to carry on. A judge agent that was recorded (arbiter, reviewer) is spawned again when the stage needs it. mcp__rein__status shows:\n${renderRun(resumed)}\nrun directory: ${c.dir}`, ...changed],
  }
}

// takes a run of the hub up in this session, on the person's answer. The
// hub is claimed first (this PC holds it from now; refused when its record
// changed since read), then the run's files are downloaded to
// active/<runId>/ and its record, back to this PC's paths, becomes the run.
// A run past plan goes back to right after plan passed. A run the hub says
// this PC holds already (a download that failed) is downloaded again
// without a claim. Just before the claim, this PC's copies of the run in
// any state folder go to .lost/, and with `lost` (another PC took this PC's
// run over) its record goes too: a stale copy the hub's record named this
// PC's would be sent over the hub's.
async function resumeRemote($: EngineInterface, hub: Hub, runId: string, answer: string | undefined, said: string | undefined, none: string, lost = false): Promise<ToolCallResult> {
  const [project, session] = [await projectName($), await $.session.id()]
  const got = await hubFetch($, hub, "GET", runPath(project, runId))
  if ("offline" in got) return { deny: `D221: taking a run over from another PC needs the hub, and it did not answer (${clip(got.offline)}), so ${runId} cannot be taken up now. Tell the user; call resume again once the hub answers.` }
  const found = got.status === 200 ? (got.json as { record?: HubRecord; info?: HubInfo } | undefined) : undefined
  const [rec, info] = [found?.record, found?.info]
  if (!rec || !info) return { deny: none }
  const local = await localRuns($, project)
  const open = rec.state === "active" || rec.state === "defer"
  const here = local.has(runId) && !lost
  if (!open || !info.portable || info.run === undefined || here) {
    const why = !info.portable ? ` On the hub it uses a repository outside the session root (D214), so it can only be read here (mcp__rein__status with its runId fetches its documents).` : here || open ? "" : ` On the hub it is ${rec.state === "complete" ? "complete" : "dropped"}.`
    return { deny: `${none}${why}` }
  }
  const mine = rec.pc === hub.pc
  const back = pastPlan(info.stage)
  const held = rec.state === "active" && !mine ? `

주의: 이 run은 PC ${rec.pc}가 쥐고 있습니다(마지막으로 올린 때 ${rec.at}). 이어받으면 그 PC는 다음에 서버에 올릴 때 run을 잃습니다.` : ""
  const redo = back ? `

이 PC에는 이 run의 코드 변경이 없으므로 plan 통과 직후로 되돌려 dev부터 다시 합니다(D222). 이전 산출물(dev-diff.md·review.md·qa.md 등)은 참고로 남습니다.` : ""
  const base = await projectDir($)
  const copies: string[] = []
  for (const state of STATES) if (await $.fs.exists(await folderOf($, state, runId))) copies.push(`${state}/${runId}`)
  const moves = copies.length > 0 ? `사본(${copies.join(", ")})은 ${base}/.lost/로 옮깁니다` : ""
  const old = lost || moves !== "" ? `

이어받으면 이 PC의 ${lost ? `기록은 지우고${moves === "" ? "" : ` ${moves}`} (PC ${rec.pc}가 서버에서 가져간 run입니다, D220)` : moves}.` : ""
  if (answer === undefined) {
    return unanswered(
      "D147",
      `이 run을 서버에서 받아 이 세션에서 이어서 진행할까요?

run: ${runId}
단계: ${info.stage} (${rec.state === "defer" ? `PC ${rec.pc}에서 보류됨` : `PC ${rec.pc}에서 진행 중`}, ${rec.at}에 올림)
제목:
${quoted(info.title)}${held}${redo}${old}`,
      [TAKE_UP, CANCEL],
    )
  }
  if (answer !== TAKE_UP && answer !== CANCEL) return offLabel("D147", answer, [TAKE_UP, CANCEL])
  if (answer !== TAKE_UP) return { deny: `D147: ${runId} is not resumed. Nothing changed.` }
  const dest = await folderOf($, "active", runId)
  // the run's worktrees are made anew here, from this PC's HEAD: the
  // session root's own first, the paths then put back under it.
  const root = await sessionRoot($)
  const owner = treeOwner(root)
  const repo = owner !== undefined && (await $.fs.exists(`${owner}/.git`)) ? owner : root
  const carried = info.run.trees
  const made: Tree[] = []
  const unmake = async (deny: string): Promise<ToolCallResult> => {
    for (const t of made) await removeTree($, t)
    return { deny }
  }
  if (carried?.some(t => t.root)) {
    if (!(await $.fs.exists(`${repo}/.git`))) return { deny: `${runId} works in a worktree of the session root's repository on PC ${rec.pc}, and this session root (${root}) is no git repository, so it cannot be taken up here. Tell the user: start the session in that repository and resume again. Nothing changed.` }
    const t = await makeTree($, repo, runId, true)
    if ("problem" in t) return { deny: `the run's git worktree could not be made here, so ${runId} was not taken up: ${t.problem}. Tell the user (a branch ${treeBranch(runId)} or a folder of that name left from before is theirs to remove). Nothing changed.` }
    made.push(t)
  }
  const placed = fromPortable(info.run, made[0]?.path ?? root, base)
  for (const c of placed.trees?.filter(t => !t.root) ?? []) {
    const t = await makeTree($, c.repo, runId)
    if ("problem" in t) return unmake(`the run's git worktree could not be made here, so ${runId} was not taken up: ${t.problem}. Tell the user (a branch ${treeBranch(runId)} or a folder of that name left from before is theirs to remove). Nothing changed.`)
    made.push(t)
  }
  // this PC's copies go before the claim, the first to the .lost/ folder,
  // any other beside it named by its state.
  const spot = await lostFolder($, runId)
  const moved: string[] = []
  const problem = await locked(async () => {
    if (lost) await $.store.delete(await recordKey($, runId))
    for (const state of STATES) {
      const from = await folderOf($, state, runId)
      if (!(await $.fs.exists(from))) continue
      const to = moved.length === 0 ? spot : `${spot}-${state}`
      await trace($, { runId } as Run, { ev: "lost", pc: rec.pc, to, ...(lost ? { rule: "D220" } : {}) }, state)
      const failed = await moveFolder($, from, to, state === "active" ? { runId, out: true } : undefined)
      if (failed !== undefined) return `${from} could not be moved to ${to} (${failed})`
      moved.push(to)
    }
    return undefined
  })
  const released = `${lost ? `D220: PC ${rec.pc} had taken ${runId} over, so this PC's record of it went${moved.length > 0 ? ` and its copies are in ${moved.join(", ")}` : ""}.` : moved.length > 0 ? `This PC's earlier copies of ${runId} are in ${moved.join(", ")}.` : ""}`
  const unchanged = released === "" ? "Nothing changed here" : `${released} Nothing else changed here`
  if (problem !== undefined) return unmake(`${problem}, so ${runId} was not taken up. ${unchanged}; tell the user (on Windows a file in it may be open in another program), then resume again.`)
  const at = new Date(await $.clock.now()).toISOString()
  if (!mine) {
    const claimed = await hubFetch($, hub, "POST", `${runPath(project, runId)}/claim`, { gen: rec.gen })
    if ("offline" in claimed) {
      // the claim may have reached the hub with its answer lost: a look,
      // even past this dispatch's first unanswered call.
      const again = await hubFetch($, { ...hub, down: undefined }, "GET", runPath(project, runId))
      const now = !("offline" in again) && again.status === 200 ? (again.json as { record?: HubRecord } | undefined)?.record : undefined
      if (now?.pc !== hub.pc) return unmake(`D221: the hub did not answer the claim of ${runId} (${clip(claimed.offline)}), and whether the claim reached it is not known. ${unchanged}; call resume again once the hub answers (should the claim have reached it, the run is then downloaded without another claim).`)
    } else if (claimed.status === 409) return unmake(`D220: the hub's record of ${runId} changed since it was read: another PC may have taken it or moved it on. ${unchanged}; call mcp__rein__status to see it again.`)
    else if (claimed.status !== 200) return unmake(`the hub refused to hand ${runId} over (${claimed.status === 422 ? "it was closed there meanwhile" : `status ${claimed.status}`}). ${unchanged}; tell the user.`)
  }
  const pulled = await pullRun($, hub, project, runId, dest)
  if (pulled !== undefined) return unmake(`D219: the hub now says this PC holds ${runId}, but its files could not be downloaded to ${dest} (${clip(pulled)}).${released === "" ? "" : ` ${released}`} Tell the user; resume it again once that is fixed (it is downloaded then without another claim).`)
  const run: Run = { ...afterPlan(clearSession(placed)), ...(carried !== undefined ? { trees: made } : {}), v: 2, status: "active", owner: session, claimed: at }
  const [key, pointer] = [await recordKey($, runId), await pointerKey($)]
  const taken = await locked(async () => {
    if ((await lookup($)).run) return "D59: this session opened a run while the question was open; the run's files are in place but it was not taken up. Park that run, then resume again."
    if ((await $.store.get(key)) !== undefined) return `D147: a run named ${runId} was recorded here meanwhile; nothing was taken up.`
    await $.store.set(key, run)
    await $.store.set(pointer, { project, runId })
    return undefined
  })
  if (taken !== undefined) return unmake(taken)
  gone.delete(runId)
  const setup: string[] = []
  for (const t of made) {
    await carryConfig($, t)
    const failed = await setupTree($, t.path)
    if (failed !== "") setup.push(failed)
  }
  await writeInfo($, run, "active", "resume")
  // the local frame server looks again now: it sends the run as this PC's
  // and forgets it was lost.
  await kick($)
  await trace($, run, { ev: "resume", stage: info.stage, from: "hub", pc: rec.pc, session, ver: VERSION, answer, said, ...(back ? { rule: "D222", to: run.stage } : {}), ...(made.length > 0 ? { worktrees: made.map(t => t.path) } : {}) })
  const fresh = made.length > 0 ? ` Its worktrees were made anew on this PC from HEAD: ${made.map(t => `${t.path} (from ${t.start ?? "a detached HEAD"})`).join(", ")}.${setupLine(setup)}` : ""
  return carryOn($, run, `${back ? ` This PC has none of its code, so it went back to right after plan passed: the ${run.stage} stage (D222).` : ""}${fresh}${released === "" ? "" : ` ${released} Tell the user.`}`)
}

type PlanJudgment = { ok: true; files: string[]; handoff: string[]; checks: Check[]; layouts: Layout[]; repos: string[]; outside: string[]; hashes: Record<string, string>; views: Record<string, ConfigView>; texts: Record<string, string>; plan: string } | { ok: false; rule: string; reason: string; fix: string; take?: { outside: string[]; rules: Rule[] } }

// G9: 2-plan.md has the form, every
// file is in a git repository, the session root's or another's, and
// none under ~/.rein, and each repository has a usable .rein/config.json.
// Only form and place are judged.
async function judgePlan($: EngineInterface, c: Ctx): Promise<PlanJudgment> {
  const again = "Fix 2-plan.md."
  const specPath = `${c.dir}/1-spec.md`
  const specText = (await $.fs.exists(specPath)) ? await $.fs.read(specPath) : undefined
  const plan = await $.fs.read(`${c.dir}/2-plan.md`)
  const parsed = parsePlan(plan, c.root)
  if (!parsed.ok) return { ok: false, rule: parsed.rule, reason: parsed.reason, fix: again }
  const rein = projectOf(c.dir)
  const repos: string[] = []
  const stray: string[] = []
  for (const file of parsed.files) {
    let repo: string | undefined
    if (!same(file, rein) && !under(file, rein)) {
      for (const dir of repoCandidates(file)) {
        if (await $.fs.exists(`${dir}/.git`)) {
          repo = dir
          break
        }
      }
    }
    if (repo === undefined) stray.push(file)
    else if (!repos.some(r => same(r, repo))) repos.push(repo)
  }
  if (stray.length > 0) {
    const reason = `these files are not in a git repository, or lie under ${rein}: ${stray.join(", ")}.`
    return { ok: false, rule: "D51", reason, fix: again }
  }
  // the session works in the run's worktree, so the main tree of its
  // repository is no place to design for.
  const home = c.run.trees?.find(t => t.root)
  if (home && repos.some(r => same(r, home.repo))) {
    const named = parsed.files.filter(f => (same(f, home.repo) || under(f, home.repo)) && !(same(f, home.path) || under(f, home.path)))
    return { ok: false, rule: "", reason: `these files are in ${home.repo}, the main working tree, but the run works in its own worktree of it, ${home.path}: ${named.join(", ")}. Name each file at its path in the worktree (a relative path is read from it).`, fix: again }
  }
  // a repository outside the session root, the first time 2-plan.md
  // names it, brings its project's rules (frozen now) and knowledge; when
  // there are any, plan stops once so the design follows them.
  const outer = repos.filter(r => outside(r, c.root))
  const fresh = outer.filter(r => !(c.run.outside ?? []).some(o => same(o, r)))
  if (fresh.length > 0) {
    const rules: Rule[] = []
    for (const repo of fresh) rules.push(...(await freezeRepoRules($, repo)))
    const projects: string[] = []
    for (const repo of fresh) projects.push(await repoProject($, repo))
    const own = await projectDir($)
    const known = (await knowledge($, projects)).filter(k => projects.some(p => !same(p, own) && under(k.path, p)))
    if (rules.length > 0 || known.length > 0) {
      const list = rules.map(r => `- ${r.path} (repository ${r.repo}; ${r.paths === null ? "no paths: list, always applies there" : `paths: ${r.paths.join(", ")}`})`)
      const index = knowledgeIndex(known, PLAN_USE)
      const reason = [
        `2-plan.md names repositories outside the session root: ${fresh.join(", ")}. The hook froze their projects' rules for this run (D115) and the run stays in plan once, so the design follows them.`,
        ...(rules.length > 0 ? ["Read each rule whose paths globs match a file in your design, globs relative to its repository, and design to it (D118):", ...list] : []),
        ...(index ? [index] : []),
      ].join("\n")
      return { ok: false, rule: "D214", reason, fix: "Make the design in 2-plan.md follow them.", take: { outside: fresh, rules } }
    }
  }
  const bare: string[] = []
  const hashes: Record<string, string> = {}
  const views: Record<string, ConfigView> = {}
  const texts: Record<string, string> = {}
  for (const repo of repos) {
    const path = `${repo}/.rein/config.json`
    const text = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    const problem = text === undefined ? "it does not exist" : checkConfig(text)
    if (problem !== undefined) bare.push(`${path} (${problem})`)
    else {
      hashes[repo] = await sha256Text(text!)
      views[repo] = viewOf(readConfig(text!))
      texts[repo] = text!
    }
  }
  if (bare.length > 0) {
    const reason = `these repositories have no usable .rein/config.json: ${bare.join(", ")}.`
    return { ok: false, rule: "D50", reason, fix: "Invoke the rein:setup skill for each (it asks the user before it writes)." }
  }
  const checked = await judgeChecks($, plan, parsed.files, parsed.handoff, `${c.dir}/handoff`, repos.map(r => readConfig(texts[r]!)), specText, c.root)
  if ("reason" in checked) return { ok: false, rule: checked.rule, reason: checked.reason, fix: again }
  const html = `${c.dir}/1-mockup.html`
  const placed = judgeLayouts(plan, (await $.fs.exists(html)) ? toBeScreens(await $.fs.read(html)) : [])
  if ("reason" in placed) return { ok: false, rule: "", reason: placed.reason, fix: again }
  return { ok: true, files: parsed.files, handoff: parsed.handoff, checks: checked.checks, layouts: placed.layouts, repos, outside: outer, hashes, views, texts, plan }
}

// a plan judgment's rule as the message starts with it; a rule-less one says only why.
const ruled = (rule: string) => (rule === "" ? "" : `${rule}: `)

// 2-plan.md's `## 배치 대조` against the to-be screens of 1-mockup.html:
// one item for each, and none for another id.
function judgeLayouts(plan: string, screens: string[]): { layouts: Layout[] } | { reason: string } {
  const parsed = parseLayouts(plan)
  if (parsed && "reason" in parsed) return parsed
  const layouts = parsed?.layouts ?? []
  const missing = screens.filter(s => !layouts.some(l => l.anchor === s))
  const strays = layouts.filter(l => !screens.includes(l.anchor)).map(l => l.anchor)
  if (missing.length === 0 && strays.length === 0) return { layouts }
  const why = [
    ...(missing.length > 0 ? [`1-mockup.html draws the to-be of ${missing.map(s => `#${s}`).join(", ")}, and \`## 배치 대조\` has no \`### <anchor>\` for ${missing.length === 1 ? "it" : "them"}`] : []),
    ...(strays.length > 0 ? [`\`## 배치 대조\` names ${strays.map(s => `#${s}`).join(", ")}, which 1-mockup.html draws no to-be of`] : []),
  ]
  return { reason: `${why.join("; ")}. The person compares each to-be screen with what was built, by hand in integration qa, so \`## 배치 대조\` has one item per to-be screen of 1-mockup.html (a \`.screen\` section with an \`.after\`), each \`### <its id>\` with \`- 페이지:\`, \`- 경로:\` and \`- 볼 곳:\`; with none, the line \`없음\` or no section.` }
}

// the outside repositories 2-plan.md named and their rules, kept for
// the run once the person has been told of them.
async function takeOutside($: EngineInterface, take: { outside: string[]; rules: Rule[] }): Promise<void> {
  await mutate($, r => {
    if (r?.stage !== "plan") return undefined
    const seen = [...(r.outside ?? []), ...take.outside.filter(o => !(r.outside ?? []).some(x => same(x, o)))]
    return { ...r, outside: seen, rules: [...r.rules, ...take.rules.filter(t => !r.rules.some(x => x.name === t.name))] }
  })
}

// 2-plan.md's `## e2e 확인`, required when a repository's config
// has e2e (the first such config is the one integration qa runs, as there)
// and every check naming one of its apps; and `## 완료 판정 덮기`, always,
// each part a piece of the spec's completion line, each test file a design
// item or an existing file. Each file a check names on `- 파일:` is a design
// item or a handoff file, kept as dev's seal names it.
async function judgeChecks($: EngineInterface, plan: string, files: string[], handoff: string[], handoffDir: string, configs: Config[], spec: string | undefined, root: string): Promise<{ checks: Check[] } | { rule: string; reason: string }> {
  const e2e = configs.map(x => x.e2e).find(x => x !== undefined)
  const parsed = parseChecks(plan)
  if (parsed && "reason" in parsed) return { rule: "D168", reason: parsed.reason }
  const checks = parsed?.checks
  if (e2e && checks === undefined) {
    return { rule: "D168", reason: "a repository's config has e2e, so 2-plan.md needs `## e2e 확인`: the screens aside checks in integration qa, one `### <name>` check each with `- 앱:`, `- 할 일:`, `- 기대:` and `- 저장:`, or the line `없음` when there is no screen to check." }
  }
  if (!e2e && (checks?.length ?? 0) > 0) {
    return { rule: "D168", reason: `no repository's config has e2e, so these checks would never run: ${checks!.map(k => k.name).join(", ")}. Leave \`## e2e 확인\` out (or only \`없음\` in it), or the user sets up e2e with the rein:setup skill.` }
  }
  const apps = Object.keys(e2e?.apps ?? {})
  const strays = (checks ?? []).filter(k => !apps.includes(k.app))
  if (strays.length > 0) {
    return { rule: "D168", reason: `these checks name an app config e2e.apps does not have: ${strays.map(k => `${k.name} (${k.app})`).join(", ")}. The apps are: ${apps.join(", ")}.` }
  }
  const unknown: string[] = []
  const named = (checks ?? []).map(k => {
    if (k.files === undefined) return k
    const held = k.files.map(name => {
      const file = files.find(f => same(f, resolve(name, root)))
      const handed = handoff.find(h => h.toLowerCase() === name.toLowerCase())
      const at = file ?? (handed === undefined ? undefined : `${handoffDir}/${handed}`)
      if (at === undefined) unknown.push(`${k.name} (${name})`)
      return at ?? name
    })
    return { ...k, files: [...new Set(held)] }
  })
  if (unknown.length > 0) {
    return { rule: "D168", reason: `these checks name a file on \`- 파일:\` that is neither a \`### <path>\` item of \`## 상세 설계\` nor an item of \`## 넘길 것\`: ${unknown.join(", ")}.` }
  }
  const cover = parseCover(plan)
  if (cover === undefined) {
    return { rule: "D169", reason: "2-plan.md has no `## 완료 판정 덮기`: for each part of the spec's completion line, how it is checked, `- \"<part>\" — e2e: <check>`, `- \"<part>\" — 테스트: <test file>` or `- \"<part>\" — 확인 불가: <reason>`." }
  }
  if ("reason" in cover) return { rule: "D169", reason: cover.reason }
  const completion = spec === undefined ? undefined : completionLine(spec)
  if (completion === undefined) return { rule: "D169", reason: "1-spec.md has no line under `## 완료 판정`, so `## 완료 판정 덮기` has nothing to cover." }
  const present: string[] = []
  for (const c of cover.cover) {
    if (c.by !== "테스트" || c.file === "") continue
    const path = resolve(c.file, root)
    if (!files.some(f => same(f, path)) && (await $.fs.exists(path))) present.push(path)
  }
  const wrong = judgeCover(cover.cover, completion, (checks ?? []).map(k => k.name), files, present, root)
  return wrong === undefined ? { checks: named } : { rule: "D169", reason: wrong }
}

// What the agent reads when plan passes.
const passedEntry = (run: Run, files: string[], dir: string) =>
  `${devEntry(run)} The design's files: ${files.join(", ")}.${treeTable(run.trees ?? [])}${handoffLine(run, dir)}`

// what dev reads on entering it about the handoff files, "" for none.
const handoffLine = (run: Run, dir: string) =>
  run.handoff?.length ? ` Also write the handoff files 2-plan.md's \`## 넘길 것\` names, each whole, in ${dir}/handoff/: ${run.handoff.join(", ")}.` : ""

// Plan passes: dev with the design's files and repositories. The
// retries reset (G6) unless a 합당 sent the run back (G3); writes stay, and
// the passes of checks it gives as they were (keptPasses), and the split
// review's groups, so review judges again only those whose files changed.
function planPassed(run: Run, j: Extract<PlanJudgment, { ok: true }>): Run {
  return {
    ...run, stage: "dev", waits: undefined, planFiles: j.files, handoff: j.handoff.length > 0 ? j.handoff : undefined, checks: j.checks, layouts: j.layouts.length > 0 ? j.layouts : undefined, repos: j.repos,
    outside: [...(run.outside ?? []), ...j.outside.filter(o => !(run.outside ?? []).some(x => same(x, o)))],
    configHashes: j.hashes, configSeen: j.views, retries: run.keepRetries ? run.retries : 0,
    frozen: { ...run.frozen, plan: j.plan, planSpec: run.frozen?.spec },
    failFile: undefined, arbiter: undefined, deviation: undefined, keepRetries: undefined, d62: undefined, splitter: undefined,
    planReviewer: undefined, planReview: undefined, planVerdicts: undefined,
    halt: undefined, e2e: undefined, qaVisit: undefined, passed: keptPasses(run, j.checks, j.hashes, j.views),
  }
}

// right after a dev-items.md write went through: pass moves the run to review
// with the changed files and the rules they bring in; fail keeps it in
// dev and names every offending file.
// Judged inside the run lock, against every write recorded so far, those
// still in flight included (recordWrite runs before the write).
async function devExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  // a path as 2-plan.md wrote it, in a repository the run has a worktree of, is the worktree's.
  const items = parseDev(await $.fs.read(`${c.dir}/agent/dev-items.md`), c.root).map(i => ({ ...i, path: inTree(c.run.trees ?? [], i.path) }))
  // every handoff file 2-plan.md names is written, and not empty.
  const unwritten: string[] = []
  for (const name of c.run.handoff ?? []) {
    const path = `${c.dir}/handoff/${name}`
    if (!(await $.fs.exists(path)) || (await $.fs.read(path)).trim() === "") unwritten.push(path)
  }
  // what dev hands on, sealed; a change past here voids review and later.
  const sealed = await sealOf($, sealFiles(c.run, `${c.dir}/handoff`))
  await keepCopies($, c.dir, sealed)
  const judged: { reason?: string } = {}
  const moved = await mutate($, r => {
    if (r?.stage !== "dev") return undefined
    judged.reason = judgeDev(items, r.planFiles ?? [], r.writes, r.deviation !== undefined)
    if (judged.reason === undefined && unwritten.length > 0) judged.reason = `D163: these handoff files 2-plan.md names are missing or empty: ${unwritten.join(", ")}. Write each.`
    if (judged.reason !== undefined) return undefined
    // a failed group is reviewed again; a retry that wrote a file no group
    // holds has the change grouped anew; with no group left to review (no
    // file changed since every group passed), every group is reviewed again.
    const groups = r.reviewGroups?.map(g => (g.verdict?.pass ? g : { ...g, verdict: undefined }))
    const next: Run = { ...r, stage: "review", failFile: undefined, arbiter: undefined, worker: undefined, sealed, ...(groups ? { reviewGroups: groups } : {}) }
    if (!next.reviewGroups) return next
    if (!groupsCover(next, c.dir)) return { ...next, reviewGroups: undefined }
    return pendingGroups(next).length > 0 ? next : { ...next, reviewGroups: next.reviewGroups.map(g => ({ ...g, verdict: undefined })) }
  })
  if (judged.reason !== undefined) {
    await trace($, c.run, { ev: "exit", stage: "dev", pass: false, rule: "D49", reason: judged.reason })
    return withContext(result, `D49: dev-items.md was saved but the run stays in dev: ${judged.reason} Then write dev-items.md again.`)
  }
  if (!moved) return result
  await trace($, c.run, { ev: "exit", stage: "dev", pass: true, writes: moved.writes })
  await trace($, c.run, { ev: "stage", from: "dev", to: "review" })
  await writeDevDiff($, moved, c.dir, c.run.failFile ? `${c.run.failFile.slice(c.run.failFile.lastIndexOf("/") + 1)} 이후` : undefined, c.run.failFile)
  return withContext(result, `D49: dev-items.md passed. ${reviewEntry(moved, c.root, c.dir)}`)
}

// G3, right after the arbiter's deviation.md went through. Its result goes to
// the arbiter; the main session learns the verdict from the status tool.
async function deviationExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const file = `${c.dir}/agent/deviation.md`
  const parsed = parseDeviation(await $.fs.read(file))
  if (!parsed.ok) return withContext(result, `D22: ${parsed.reason} The run stays in dev.`)
  const moved = await mutate($, r => (r?.stage === "dev" ? afterDeviation(r, parsed.verdict, file) : undefined))
  if (!moved) return result
  await trace($, c.run, { ev: "deviation", verdict: parsed.verdict, agentId: c.agentId })
  if (moved.stage === "plan") await trace($, c.run, { ev: "stage", from: "dev", to: "plan", rule: "D22" })
  const said = moved.stage === "plan" ? "The run is now in the plan stage." : "The run stays in dev."
  return withContext(result, `D22: verdict ${parsed.verdict} recorded. ${said} Report the verdict to the main session and stop.`)
}

// right after the reviewer's review.md went through (its form was
// checked before): all 통과 moves the run to qa; any 실패 goes to dev or plan
// with review.md to read, as its `## 실패 원인` judges it, or stops the run
// for the main session. Either way the reviewer is spent.
async function reviewExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const file = `${c.dir}/agent/review.md`
  const parsed = parseReview(await $.fs.read(file), reviewRules(c.run, c.root).map(r => r.file))
  if (!parsed.ok) return withContext(result, `D116: ${parsed.reason} The run stays in review.`)
  let context = ""
  const moved = await mutate($, r => {
    if (r?.stage !== "review") return undefined
    if (parsed.pass) {
      context = "The run is now in the qa stage. Invoke the rein:qa skill; the hook runs the qa commands when it calls mcp__rein__advance (D153)."
      return { ...r, stage: "qa", reviewer: undefined, halt: undefined, qaVisit: undefined }
    }
    const routed = routeJudged({ ...r, reviewer: undefined }, file, parsed.cause)
    context = routed.context
    return routed.run
  })
  if (!moved) return result
  await trace($, c.run, { ev: "exit", stage: "review", pass: parsed.pass, agentId: c.agentId })
  await trace($, c.run, moved.halt ? { ev: "halt", stage: "review", halt: moved.halt, retries: moved.retries } : { ev: "stage", from: "review", to: moved.stage, retries: moved.retries, ...(parsed.pass ? {} : { cause: parsed.cause }) })
  return withContext(result, `D116: review.md ${parsed.pass ? "passed" : "failed"}. ${context} Report this to the main session and stop.`)
}

// right after the splitter's review-groups.md went through (its form was
// checked before): the groups are kept, and the main session spawns one
// reviewer per group. The splitter is spent.
async function groupsExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const parsed = parseGroups(await $.fs.read(`${c.dir}/${GROUPS_FILE}`), groupItems(c.run, c.dir), c.root)
  if (!parsed.ok) return withContext(result, `D116: ${GROUPS_FILE}: ${parsed.reason} The run stays in review.`)
  const moved = await mutate($, r => (r?.stage === "review" && r.splitter === c.agentId ? { ...r, splitter: undefined, reviewGroups: parsed.groups } : undefined))
  if (!moved) return result
  await trace($, moved, { ev: "groups", stage: "review", agentId: c.agentId, groups: parsed.groups.map(g => ({ title: g.title, files: g.files.length })) })
  return withContext(result, `D116: ${GROUPS_FILE} passed with ${parsed.groups.length} groups. Report this to the main session in one line and stop; it spawns one rein:reviewer per group.`)
}

// right after group n's review-<n>.md went through: its verdict is kept with
// the seal of its files. Once no group is left to judge, all 통과 moves the
// run to qa; any 실패 has the hook write review.md from the groups and goes
// to plan when any failed group judged the design, else to dev (or stops
// the run for the main session), as one review.
async function groupExit($: EngineInterface, c: Ctx, n: number, result: ToolCallResult): Promise<ToolCallResult> {
  const name = groupFile(n)
  const parsed = parseReview(await $.fs.read(`${c.dir}/${name}`), groupRules(c.run, n, c.root).map(r => r.file))
  if (!parsed.ok) return withContext(result, `D116: ${parsed.reason} The run stays in review.`)
  const file = `${c.dir}/agent/review.md`
  let context = ""
  let joined: Run | undefined
  const moved = await mutate($, r => {
    const g = r?.stage === "review" ? r.reviewGroups?.[n - 1] : undefined
    if (!r || !g || g.reviewer !== c.agentId) return undefined
    const seal = Object.fromEntries(Object.entries(r.sealed ?? {}).filter(([f]) => g.files.some(x => same(x, f))))
    const groups = r.reviewGroups!.map((x, i) => (i === n - 1 ? { ...x, reviewer: undefined, verdict: { pass: parsed.pass, seal, ...(parsed.pass ? {} : { cause: parsed.cause }) } } : x))
    const next: Run = { ...r, reviewGroups: groups }
    const left = pendingGroups(next)
    if (left.length > 0 || groups.some(x => x.reviewer)) {
      context = `Group ${n} ${parsed.pass ? "passed" : "failed"}; the run stays in review until every group has its verdict.${reviewNext(next, c.dir)}`
      return next
    }
    if (groups.every(x => x.verdict?.pass)) {
      context = "Every group passed. The run is now in the qa stage. Invoke the rein:qa skill; the hook runs the qa commands when it calls mcp__rein__advance (D153)."
      return { ...next, stage: "qa", halt: undefined, qaVisit: undefined }
    }
    joined = next
    const cause = groups.some(x => x.verdict?.pass === false && x.verdict.cause === "설계") ? "설계" : "구현"
    const routed = routeJudged(next, file, cause)
    context = `Groups ${groups.flatMap((x, i) => (x.verdict?.pass ? [] : [i + 1])).join(", ")} failed; the hook wrote ${file} from them. ${routed.context}`
    return routed.run
  })
  if (!moved) return result
  if (joined) {
    const failed: Record<number, string> = {}
    for (const [i, g] of (joined.reviewGroups ?? []).entries()) if (!g.verdict?.pass) failed[i + 1] = await $.fs.read(`${c.dir}/${groupFile(i + 1)}`)
    await $.fs.write(file, joinedReview(joined, failed))
  }
  await trace($, c.run, { ev: "exit", stage: "review", group: n, pass: parsed.pass, agentId: c.agentId })
  if (moved.halt) await trace($, c.run, { ev: "halt", stage: "review", halt: moved.halt, retries: moved.retries })
  else if (moved.stage !== "review") await trace($, c.run, { ev: "stage", from: "review", to: moved.stage, retries: moved.retries })
  return withContext(result, `D116: ${name} ${parsed.pass ? "passed" : "failed"}. ${context} Report this to the main session and stop.`)
}

// G5 (measured 2026-09-24): $.process.run has no shell, and on Windows the
// `bash` on PATH is WSL's (it fails) and `sh` is not found. Claude Code sets
// SHELL to the Bash tool's own shell (Git Bash there), so config commands
// run through `$SHELL -c` as the agent's Bash runs them, `&&` and `cd`
// included; /bin/sh when SHELL is unset. A command that cannot start is 127.
async function runShell($: EngineInterface, command: string, cwd: string, timeoutMs: number): Promise<{ exit: number; out: string }> {
  const shell = (await $.env.get("SHELL")) || "/bin/sh"
  try {
    const r = await $.process.run([shell, "-c", command], { cwd, timeoutMs })
    return { exit: r.exitCode, out: `${r.stdout}${r.stderr}` }
  } catch (err) {
    return { exit: 127, out: String(err) }
  }
}

async function runAll($: EngineInterface, repos: string[], commands: (repo: string) => string[], timeoutMs: number): Promise<CommandResult[]> {
  const results: CommandResult[] = []
  for (const root of repos) {
    for (const cmd of commands(root)) results.push({ root, cmd, ...(await runShell($, cmd, root, timeoutMs)) })
  }
  return results
}

const stored = (results: CommandResult[]) => results.map(({ root, cmd, exit }) => ({ root, cmd, exit }))

// G7: aside is there when `aside session list` exits 0 (1: app not
// running; not installed: cannot start).
async function asideAvailable($: EngineInterface): Promise<boolean> {
  try {
    return (await $.process.run(["aside", "session", "list"], { timeoutMs: 15_000 })).exitCode === 0
  } catch {
    return false
  }
}

// any HTTP answer, 4xx and 5xx included, is reachable.
// $.http.fetch takes no signal, so a hang is cut by a race: no answer within
// PROBE_MS counts as unreachable. The wait runs on the hook's own 10 s
// budget, hence under it.
// the folder a check's screenshots go to, relative to the run
// directory: evidence/<check>/<n>, n one past the highest number there, so a
// check run again never takes the last run's screenshots for its own.
async function shotFolder($: EngineInterface, dir: string, name: string): Promise<string> {
  const base = `${dir}/agent/evidence/${name}`
  const used = (await $.fs.exists(base)) ? (await $.fs.list(base)).filter(e => e.kind === "dir" && /^\d+$/.test(e.name)).map(e => Number(e.name)) : []
  return `agent/evidence/${name}/${Math.max(0, ...used) + 1}`
}

// the PNGs aside saved in a check's folder, relative to the run directory.
async function shotsIn($: EngineInterface, dir: string, folder: string): Promise<string[]> {
  const path = `${dir}/${folder}`
  if (!(await $.fs.exists(path))) return []
  return (await $.fs.list(path)).filter(e => e.kind === "file" && /\.png$/i.test(e.name)).map(e => `${folder}/${e.name}`)
}

async function reachable($: EngineInterface, url: string): Promise<boolean> {
  const answer = $.http.fetch(url).then(() => true, () => false)
  const hang = $.clock.sleep(PROBE_MS).then(() => false, () => false)
  return Promise.race([answer, hang])
}

// right after a qa.md write went through. qa.md may be written only
// after a hook run of the qa commands failed in this visit (qa.write), so it
// reports that failure and judges it (`## 실패 원인`): the run goes to dev or
// plan without running the commands again. qa writes nothing else, so the code they ran against
// is as it was; a pass is only ever the hook's own run (runQa).
async function qaExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const token = await takeBusy($, "qa", "agent/qa.md")
  if (token === undefined) return withContext(result, "D56: qa.md was not judged: the hook is busy with the qa commands or another qa.md write. Once that result is in, write qa.md again if the run is still in qa with a failed run.")
  try {
    const judged = parseCause(await $.fs.read(`${c.dir}/agent/qa.md`))
    if (!judged.ok) return withContext(result, `D153: qa.md: ${judged.reason} qa.md was not judged and the run stays in qa; write qa.md again, whole, with that section.`)
    let context = ""
    const moved = await mutate($, r => {
      if (r?.stage !== "qa" || !failedRun(r)) return undefined
      const routed = routeJudged({ ...r, busy: undefined }, `${c.dir}/agent/qa.md`, judged.cause)
      context = routed.context
      return routed.run
    })
    if (!moved) return withContext(result, "D153: qa.md was not judged: the run no longer has a failed hook run in this qa visit (it left qa, or a rerun or a config approval replaced the failure). Call mcp__rein__status.")
    await trace($, c.run, moved.halt ? { ev: "halt", stage: "qa", halt: moved.halt, retries: moved.retries, rule: "D153" } : { ev: "stage", from: "qa", to: moved.stage, retries: moved.retries, cause: judged.cause, rule: "D153" })
    return withContext(result, `D153: qa.md reports the hook's failed run of the qa commands. ${context}`)
  } finally {
    await dropBusy($, token)
  }
}

// the run's code is in its worktrees, and an app started from the main
// working tree does not have it: the person starts the apps from there.
// The hook cannot see where an app runs, so it only says so.
const openTrees = (run: Run) => (run.trees ?? []).filter(t => !t.landed)
const appsLine = (run: Run) =>
  openTrees(run).length === 0 ? "" : ` Tell them too that the run's code is in its worktrees (${openTrees(run).map(t => t.path).join(", ")}): an app started from the main working tree does not have it, so they start the apps the checks open from the worktree before testing.`
const servedFrom = (run: Run, list: string) => {
  if (openTrees(run).length === 0) return list
  const note = `> 이 run의 코드는 워크트리에 있습니다: ${openTrees(run).map(t => t.path).join(", ")}. 메인 작업 트리에서 띄운 앱에는 이 변경이 없으니, 확인할 앱을 이 워크트리에서 띄운 뒤 테스트하세요.`
  const end = list.indexOf("\n")
  return end < 0 ? `${list}\n\n${note}\n` : `${list.slice(0, end + 1)}\n${note}\n${list.slice(end + 1)}`
}

// G4: entering qa-integration, the hook picks the e2e path and does what
// the path needs before the agent does anything: aside (one command
// per check of 2-plan.md's `## e2e 확인`, after the completion line, the production check on
// the apps' urls and the backends and the reachability probe of
// each app), a halt when e2e is
// configured but only a missing aside could run it, or nothing (2-plan.md
// checks no screen; with noE2e, the person's choice to go
// on without e2e), in every repository of the run. Whether 2-plan.md's
// handoff files are applied before e2e is the main session's to ask.
// Returns what the agent reads. From a halted qa-integration (advance, G11)
// it starts over the same way, but the checks that passed in this visit keep
// their result and only the others run again. Every entry starts
// e2e.md afresh (empty on the aside and ego paths until a check
// closes, the hook's ## e2e otherwise), what it held moved to
// `## 이전 진입` at its end (withHistory), and forgets the last entry's
// reviewer. A spec with no completion line has nothing to check against
//: back to plan, where the person decides. The caller holds the
// busy token.
async function integrationEntry($: EngineInterface, c: Ctx, run: Run, configs: Record<string, Config>, from: "qa" | "qa-integration", noE2e = false): Promise<string> {
  const file = `${c.dir}/agent/e2e.md`
  const repos = run.repos ?? []
  const e2e = repos.map(r => configs[r]?.e2e).find(x => x !== undefined)
  const waited = from === "qa-integration" && run.e2e?.path === "wait"
  const lead = from === "qa" ? "the qa commands passed" : waited ? "the user asked for e2e" : "the entry ran again"
  const ready = (r: Run | undefined): r is Run => r?.stage === from && (from === "qa" || r.halt !== undefined || r.e2e?.path === "wait")
  const enter = (patch: Partial<Run>) =>
    mutate($, r => (ready(r) ? { ...r, stage: "qa-integration", halt: undefined, busy: undefined, verifier: undefined, qaVisit: undefined, ...patch } : undefined))

  const specPath = `${c.dir}/1-spec.md`
  const completion = completionLine(await $.fs.read(specPath))
  if (completion === undefined) {
    const moved = await mutate($, r => (ready(r) ? { ...r, stage: "plan", halt: undefined, busy: undefined, verifier: undefined, e2e: undefined, qaVisit: undefined, d62: true, failFile: specPath } : undefined))
    if (!moved) return `The run left ${from} before the e2e entry.`
    await trace($, run, { ev: "stage", from, to: "plan", rule: "D36" })
    return d62Entry(`${lead}, but 1-spec.md has no line under ## 완료 판정, so integration qa has nothing to check it against (D36); tell the user the approved spec is missing its completion line`, specPath)
  }

  // a pass whose files changed since stands only once rein:impact found
  // the change does not touch its check.
  if (from === "qa" && e2e && !noE2e && (run.checks?.length ?? 0) > 0) {
    const doubt = doubtful(run)
    if (doubt.length > 0) return impactWait($, c, run, doubt, lead)
  }

  // with checks to run, work qa stops here for the person: the hook
  // writes 5-checklist.md and nothing runs until they choose (waitGate).
  // A check whose pass from an earlier visit stands comes checked; when
  // every check's does, nothing is left to test and the entry goes on.
  const carried = (run.checks ?? []).flatMap(k => carriedPass(run, k) ?? [])
  const list = `${c.dir}/5-checklist.md`
  const listed = async (checks: Check[]) => servedFrom(run, carried.reduce((t, k) => tick(t, k.name, carriedTick(k)), checklist(await titleOf($, "active", run.runId), checks, e2e?.apps ?? {}, run.layouts)))
  if (from === "qa" && e2e && (run.checks?.length ?? 0) > 0 && !noE2e && carried.length < run.checks!.length) {
    const moved = await enter({ e2e: { path: "wait" } })
    if (!moved) return `The run left ${from} before the e2e entry.`
    const text = await listed(run.checks!)
    await $.fs.write(list, text)
    await writeE2e($, file, "", true)
    await trace($, run, { ev: "stage", from, to: "qa-integration", e2e: "wait" })
    if (run.autopilot) return `${lead}. The run is now in the qa-integration stage; the hook wrote the integration test checklist ${list}, and nothing ran. This is an autopilot run: the user does not test by hand or type /rein:e2e. Call mcp__rein__advance now with answer "${E2E_EGO}" and said "autopilot", then go on as the rein:qa skill says for the ego path.${appsLine(run)}`
    return `${lead}. The run is now in the qa-integration stage and stops there for the user: the hook wrote the integration test checklist ${list}, and nothing ran. Tell the user, then stop.${appsLine(run)} They test the screens by it and check every box, then run /rein:land; or they run /rein:e2e for the ego browser (or Aside, if they ask for it) to check them; or they tell you a problem they found, and you send the run to dev (the rein:qa skill says how).`
  }
  // the to-be screens of 1-mockup.html are compared by hand whatever runs
  // here: the checklist holds their boxes, and integrationExit waits for them.
  if (from === "qa" && (run.layouts?.length ?? 0) > 0) await $.fs.write(list, await listed(e2e && !noE2e ? (run.checks ?? []) : []))

  // the checks 2-plan.md named. A plan that passed under an older version named
  // none, so its completion line is its one check, as aside got it before.
  const checks: Check[] = !e2e ? [] : (run.checks ?? [{ name: "completion", app: Object.keys(e2e.apps)[0]!, todo: `Check whether this statement is true: ${completion}`, expect: "the statement is true", saves: false }])
  const asideWanted = e2e !== undefined && checks.length > 0 && !noE2e
  // a pass of this visit, or of an earlier one whose files are unchanged,
  // stands, and so does a check the person tested by 5-checklist.md, every
  // box of its expectation checked; with every check's standing, Aside is
  // not needed.
  const before = from === "qa-integration" ? run.e2e : undefined
  const ticked = from === "qa-integration" && (await $.fs.exists(list)) ? await $.fs.read(list) : undefined
  const byHand = (k: Check): CheckRun | undefined => (ticked !== undefined && handChecked(ticked, k.name)
    ? { name: k.name, minutes: checkMinutes(e2e!, k), spent: 0, todo: k.todo, expect: k.expect, ...(k.account ? { account: k.account } : {}), app: k.app, ...(k.saves ? { saves: true as const } : {}), verdict: "통과", checked: true }
    : undefined)
  const carry = (k: Check) => (ticked === undefined || allChecked(ticked, k.name) ? carriedPass(run, k) : undefined)
  const kept = (k: Check) => before?.checks?.find(x => x.name === k.name && x.verdict === "통과" && !x.person) ?? carry(k) ?? byHand(k)
  const allKept = checks.length > 0 && checks.every(k => kept(k) !== undefined)
  // ego unless the user chose Aside (/rein:e2e): the checks run there, whatever else could.
  const path = asideWanted && run.browser !== "aside" ? "ego"
    : asideWanted && (allKept || (await asideAvailable($))) ? "aside" : asideWanted ? "unavailable" : "none"

  if (path === "ego") {
    // each to-be screen whose box is still empty is an ego check of its
    // own, judged by rein:layout-verifier against the to-be.
    const unticked = (run.layouts ?? []).filter(l => ticked === undefined || openLayouts(ticked, [l]).length > 0)
    const extra = unticked.map(l => layoutCheck(l, appFor(run, l.page, e2e!), (run.layoutFails?.[l.anchor] ?? 0) >= MEASURE_AT - 1))
    await mutate($, r => (ready(r) ? { ...r, layoutChecks: extra.length > 0 ? extra : undefined } : undefined))
    return egoEntry($, c, run, e2e!, [...checks, ...extra], kept, from, lead)
  }

  if (path === "aside") {
    const apps = [...new Set(checks.map(k => k.app))]
    const runs: CheckRun[] = await Promise.all(checks.map(async k => {
      const held = kept(k)
      if (held) return held
      const minutes = checkMinutes(e2e!, k)
      const evidence = await shotFolder($, c.dir, k.name)
      return { name: k.name, minutes, spent: 0, todo: k.todo, expect: k.expect, ...(k.account ? { account: k.account } : {}), app: k.app, ...(k.saves ? { saves: true as const } : {}), evidence }
    }))
    let halt: Run["halt"]
    const production = productionTargets(e2e!, apps)
    if (production.length > 0) halt = { rule: "D100", reason: `${production.join(", ")}: a production host or one the hook cannot read; aside does not run there` }
    else {
      const urls = [...new Set(runs.filter(k => !k.verdict).map(k => e2e!.apps[checks.find(x => x.name === k.name)!.app]!.url))]
      const answered = await Promise.all(urls.map(u => reachable($, u)))
      const down = urls.filter((_, i) => !answered[i])
      if (down.length > 0) halt = { rule: "D101", reason: `${down.join(", ")} did not answer; start the app, then run the stage again` }
    }
    const pending = runs.find(k => !k.verdict)
    const written = !halt && !pending ? asideSection(runs) : undefined
    const state: E2eState = { path: "aside", checks: runs, ...(written ? { written } : {}) }
    const moved = await enter({ e2e: state, halt })
    if (!moved) return `The run left ${from} before the e2e entry.`
    await writeE2e($, file, written ?? "", true)
    await trace($, run, { ev: "stage", from, to: "qa-integration", e2e: "aside", checks: runs.map(k => k.name), kept: runs.filter(k => k.verdict).map(k => k.name), halt })
    if (halt) return `${halt.rule}: the run is in the qa-integration stage but halted: ${halt.reason}. Tell the user; once they have fixed it, call mcp__rein__advance to run the entry again.`
    if (written) return `D173: ${lead}; every aside check already passed, in this visit or in an earlier one with none of its files changed since, and the hook wrote ## e2e in ${file}. The run is in the qa-integration stage. Spawn rein:reviewer for the completion check (the rein:qa skill says how).`
    const left = runs.filter(k => !k.verdict).length
    return `D56: ${lead}. The run is now in the qa-integration stage, aside path, with ${left} check${left === 1 ? "" : "s"} to run, each by a rein:e2e-runner agent, up to ${AT_ONCE} at once. Invoke the rein:qa skill; mcp__rein__status says how many runners to spawn now.`
  }

  // e2e is configured and only aside could run it: halt where the run
  // is, unless the person chose to go on without it.
  if (path === "unavailable") {
    // asked for from the wait, it leaves the run waiting: the person may still test by hand.
    if (waited) return `D141: Aside is unavailable (\`aside session list\` did not exit 0), so nothing ran; the run still waits in qa-integration. Tell the user: they start Aside and run /rein:e2e again, or test by ${c.dir}/5-checklist.md by hand.`
    const halt = { rule: "D141" as const, reason: "`aside session list` did not exit 0" }
    // From qa the entry runs only after the qa commands passed a hook rerun.
    const moved = await mutate($, r => (ready(r) ? { ...r, halt, ...(from === "qa" ? { qaVisit: { ...(r.qaVisit ?? { reruns: 0 }), passed: true as const } } : {}) } : undefined))
    if (!moved) return `The run left ${from} before the e2e entry.`
    if (from === "qa-integration") await writeE2e($, file, "", true)
    await trace($, run, { ev: "halt", stage: from, halt })
    return `D141: ${lead}, but e2e is configured and Aside is unavailable, so the run is halted in ${from}; it does not pass without e2e. Tell the user: they start Aside, or decide to go on without e2e. Then call mcp__rein__advance: it says what to ask them (D200).`
  }

  const written = noE2e ? E2E_SKIPPED : e2e ? E2E_NONE : e2eSection()
  const moved = await enter({ e2e: { path: "none", written } })
  if (!moved) return `The run left ${from} before the e2e entry.`
  await writeE2e($, file, written, true)
  await trace($, run, { ev: "stage", from, to: "qa-integration", e2e: "none" })
  if (noE2e) return `D141: the user chose to go on without e2e; the hook wrote ## e2e saying so in ${file}. The run is now in the qa-integration stage. Invoke the rein:qa skill.`
  if (e2e) return `D168: ${lead}; 2-plan.md's \`## e2e 확인\` checks no screen, so the hook wrote a passing ## e2e in ${file}. The run is now in the qa-integration stage. Invoke the rein:qa skill.`
  return `D72: ${lead}; there is no e2e to run, so the hook wrote a passing ## e2e in ${file}. The run is now in the qa-integration stage. Invoke the rein:qa skill.`
}

// the ego path of the integration entry, for the checks run in ego, the
// default unless the user chose Aside (/rein:e2e). With checks left to run, ego must answer
// (ego-unavailable) and every check must map to a profile ego has
// (ego-profile-missing); both halt with nothing run, for the user to fix,
// switch to Aside or go on without e2e. Then the production and reachability
// checks of the aside path, the run's spaces left from before are closed
// (a failed check's kept tabs too), and each check to run gets its attempt
// folder, its profile and its space's name. The caller holds the busy token.
async function egoEntry($: EngineInterface, c: Ctx, run: Run, e2e: E2e, checks: Check[], kept: (k: Check) => CheckRun | undefined, from: "qa" | "qa-integration", lead: string): Promise<string> {
  const file = `${c.dir}/agent/e2e.md`
  const ready = (r: Run | undefined): r is Run => r?.stage === from && (from === "qa" || r.halt !== undefined || r.e2e?.path === "wait")
  const open = checks.filter(k => kept(k) === undefined)
  const halted = async (halt: NonNullable<Run["halt"]>): Promise<string> => {
    const moved = await mutate($, r => (ready(r) ? { ...r, halt } : undefined))
    if (!moved) return `The run left ${from} before the e2e entry.`
    await trace($, run, { ev: "halt", stage: from, halt })
    return `${halt.rule}: ${lead}, but ${halt.reason}. Nothing ran; the run is halted in ${from}. Tell the user, then call mcp__rein__advance: it says what to ask them.`
  }
  let ids: Record<string, string> = {}
  if (open.length > 0) {
    const listed = await egoProfiles($)
    if (!listed) return halted({ rule: "ego-unavailable", reason: "`ego-browser nodejs` did not answer: ego lite is not running, or ego-browser was not on the PATH when Claude Code started" })
    const resolved = resolveProfiles(e2e, open, listed)
    if ("missing" in resolved) return halted({ rule: "ego-profile-missing", reason: `the ego profiles are not set up: ${resolved.missing.join("; ")}` })
    ids = resolved.ids
    const shot = marked((await egoRun($, SHOT_PROBE_SCRIPT, 60_000)) ?? "") as { ok?: boolean; error?: string } | undefined
    if (shot?.ok !== true) return halted({ rule: "ego-unavailable", reason: `a test screenshot in ego failed (${shot?.error ?? "no answer"}): ego's window is closed or minimized; it must stay open on screen (covered by other windows is fine)` })
  }
  const runs: CheckRun[] = await Promise.all(checks.map(async k => {
    const held = kept(k)
    if (held) return held
    const evidence = await shotFolder($, c.dir, k.name)
    return {
      name: k.name, minutes: checkMinutes(e2e, k), spent: 0, todo: k.todo, expect: k.expect, ...(k.account ? { account: k.account } : {}), app: k.app, ...(k.saves ? { saves: true as const } : {}), evidence,
      ego: { profile: ids[k.name]!, space: spaceName(run.runId, k.name, evidence), spentMs: 0 },
    }
  }))
  let halt: Run["halt"]
  const production = productionTargets(e2e, [...new Set(checks.map(k => k.app))])
  if (production.length > 0) halt = { rule: "D100", reason: `${production.join(", ")}: a production host or one the hook cannot read; ego does not run there` }
  else {
    const urls = [...new Set(open.map(k => e2e.apps[k.app]!.url))]
    const answered = await Promise.all(urls.map(u => reachable($, u)))
    const down = urls.filter((_, i) => !answered[i])
    if (down.length > 0) halt = { rule: "D101", reason: `${down.join(", ")} did not answer; start the app, then run the stage again` }
  }
  if (!halt && open.length > 0) {
    await egoRun($, closeScript(runSpaces(run.runId, checks.map(k => k.name))))
    await egoGuide($, c.dir)
  }
  const written = !halt && open.length === 0 ? egoSection(runs) : undefined
  const state: E2eState = { path: "ego", checks: runs, ...(written ? { written } : {}) }
  const moved = await mutate($, r => (ready(r) ? { ...r, stage: "qa-integration", halt, busy: undefined, verifier: undefined, qaVisit: undefined, e2e: state } : undefined))
  if (!moved) return `The run left ${from} before the e2e entry.`
  await writeE2e($, file, written ?? "", true)
  await trace($, run, { ev: "stage", from, to: "qa-integration", e2e: "ego", checks: runs.map(k => k.name), kept: runs.filter(k => k.verdict).map(k => k.name), halt })
  if (halt) return `${halt.rule}: the run is in the qa-integration stage but halted: ${halt.reason}. Tell the user; once they have fixed it, call mcp__rein__advance to run the entry again.`
  if (written) return `D173: ${lead}; every check already passed, in this visit or in an earlier one with none of its files changed since, and the hook wrote ## e2e in ${file}. The run is in the qa-integration stage. Spawn rein:reviewer for the completion check (the rein:qa skill says how).`
  return `D56: ${lead}. The run is now in the qa-integration stage, ego path, with ${open.length} check${open.length === 1 ? "" : "s"} to run: a rein:ego-driver drives each in ego (up to ${AT_ONCE} at once), then a rein:ego-judge judges it from its evidence. Invoke the rein:qa skill; mcp__rein__status says which agents to spawn now.`
}

// the app a layout check opens its screen in: that of a check of 2-plan.md
// on the same page, else of its first check, else the first app.
function appFor(run: Run, page: string, e2e: E2e): string {
  return run.checks?.find(k => k.page === page)?.app ?? run.checks?.[0]?.app ?? Object.keys(e2e.apps)[0]!
}

// the user's browser for e2e, kept in the run so its reruns use it.
async function chooseBrowser($: EngineInterface, browser: "aside" | "ego"): Promise<Run | undefined> {
  return mutate($, r => (r?.stage === "qa" || r?.stage === "qa-integration" ? { ...r, browser } : undefined))
}

// one `ego-browser nodejs` with script on stdin; its output, or undefined
// when it did not run or did not exit 0. A script error exits 1 (measured).
// The script's console.log goes to stderr (measured, ego-browser 0.6.1.11),
// so both streams are read.
async function egoRun($: EngineInterface, script: string, timeoutMs = 60_000): Promise<string | undefined> {
  try {
    const r = await $.process.run(["ego-browser", "nodejs"], { stdin: script, timeoutMs })
    return r.exitCode === 0 ? `${r.stdout}\n${r.stderr}` : undefined
  } catch {
    return undefined
  }
}

// the ego profiles, which also says ego answers; undefined when it does not.
async function egoProfiles($: EngineInterface): Promise<Profile[] | undefined> {
  const out = await egoRun($, PROBE_SCRIPT, 30_000)
  return out === undefined ? undefined : profilesOf(out)
}

// the guide of the installed ego-browser, for the drivers to read: the
// run's agent/evidence/ego-guide.md; undefined when it could not be written.
async function egoGuide($: EngineInterface, dir: string): Promise<string | undefined> {
  const path = `${dir}/agent/evidence/${EGO_GUIDE}`
  try {
    const r = await $.process.run(["ego-browser", "skill"], { timeoutMs: 30_000 })
    if (r.exitCode !== 0 || r.stdout.trim() === "") return (await $.fs.exists(path)) ? path : undefined
    await $.fs.write(path, r.stdout)
    return path
  } catch {
    return (await $.fs.exists(path)) ? path : undefined
  }
}

// egoLeft, its failure traced, never the call's.
async function closeLeftSpaces($: EngineInterface, before: Run | undefined): Promise<void> {
  try {
    await egoLeft($, before)
  } catch (err) {
    const now = await getRun($).catch(() => undefined)
    if (now && now.runId === before?.runId) await trace($, now, { ev: "error", stage: now.stage, what: "closing ego spaces", error: String(err) }).catch(() => undefined)
  }
}

// closes the run's ego spaces once the run left integration qa, was put
// aside or dropped: the run as it was before the call, and as it is now.
async function egoLeft($: EngineInterface, before: Run | undefined): Promise<void> {
  if (before?.stage !== "qa-integration" || before.e2e?.path !== "ego") return
  const now = await getRun($)
  if (now?.runId === before.runId && now.stage === "qa-integration") return
  const names = (before.e2e.checks ?? []).map(k => k.name)
  if (names.length === 0) return
  const closed = await egoRun($, closeScript(runSpaces(before.runId, names)))
  // a run put aside or closed has moved its folder; its trace goes there no more.
  if (now?.runId === before.runId) await trace($, now, { ev: "ego", closed: closed === undefined ? "failed" : marked(closed), reason: `left for ${now.stage}` })
}

// The full output of a Bash call: the file the tool persisted a long output
// to, else its stdout (the stream stderr was merged into, measured), else
// the text the model read.
async function bashOutput($: EngineInterface, result: ToolCallResult): Promise<string> {
  const record = (typeof result.result === "object" && result.result !== null ? result.result : {}) as Record<string, unknown>
  if (typeof record.persistedOutputPath === "string") {
    const full = await $.fs.read(record.persistedOutputPath).catch(() => undefined)
    if (full !== undefined) return full
  }
  if (typeof record.stdout === "string" && record.stdout !== "") {
    return typeof record.stderr === "string" && record.stderr !== "" ? `${record.stdout}\n${record.stderr}` : record.stdout
  }
  return result.text ?? ""
}

// right after a rein:e2e-runner's aside call for its check, `minutes`
// its timeout: the session from the output's first line, and the minutes a
// call that ran past its time spent. Running past it (exit 124, or the Bash
// tool's own timeout) leaves the session running in the Aside app
// (measured 2026-09-24): while the check's limit holds and `aside session
// list` says it runs, the runner resumes it to wait on; past the limit the
// hook stops it and closes the check with no verdict. The verdict is the
// runner's to write, in the check's result file.
async function runnerCaptured($: EngineInterface, run: Run, name: string, agentId: string, minutes: number, result: ToolCallResult): Promise<ToolCallResult> {
  const record = (typeof result.result === "object" && result.result !== null ? result.result : {}) as Record<string, unknown>
  const capture = captureAside(await bashOutput($, result))
  const exit = result.isError ? exitCodeOf(result.text) : 0
  const timedOut = exit === 124 || record.timedOutAfterMs !== undefined
  const check = run.e2e?.checks?.find(k => k.name === name)
  if (!check) return withContext(result, `check ${name} is gone from the run; this result is not used. Report to the main session and stop.`)
  const session = capture.session ?? check.session
  const spent = check.spent + (timedOut ? minutes : 0)
  const listed = timedOut && session ? await asideStatus($, session) : undefined
  const over = timedOut && spent >= check.minutes
  const stopped = over && session && listed === "running" ? await stopAside($, session) : undefined
  let settled: ReturnType<typeof settleAside>
  const moved = await mutate($, r => {
    const k = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === name && x.runner === agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !k) return undefined
    const next: CheckRun = { ...k, running: undefined, spent, ...(session ? { session } : {}), ...(over ? { over: true as const } : {}) }
    const checks = r.e2e.checks.map(x => (x.name === name ? next : x))
    settled = over ? settleAside(checks) : undefined
    return { ...r, e2e: { ...r.e2e, checks }, halt: settled?.halt ?? r.halt }
  })
  if (!moved) return withContext(result, `check ${name} closed or the run moved on while aside ran; this result is not used. Report to the main session and stop.`)
  await trace($, run, { ev: "capture", stage: "qa-integration", check: name, agentId, aside: capture, exit, spent, ...(over ? { over: true, stopped } : {}) })
  const left = check.minutes - spent
  if (over) {
    const stop = stopped === false ? ` The hook could not stop aside session ${session}, which may still be driving the browser: the user stops it (\`aside session stop ${session}\`).` : session ? ` The hook stopped aside session ${session}.` : ""
    return withContext(result, `check ${name} ran past its ${check.minutes} minutes and is closed with no verdict.${stop} Write nothing. ${await settledLine($, moved, settled)}`)
  }
  if (record.backgroundTaskId !== undefined || record.backgroundedToDeliverMessage || record.backgroundedByUser) {
    return withContext(result, `aside went to the background, so the hook could not read its output${session ? `; its session is ${session}` : ""}. Wait on it in the foreground: ${session ? `\`timeout ${Math.min(left, CALL_MINUTES)}m aside session resume ${session} '<prompt>'\`` : "run aside exec again"}, with the Bash timeout ${ASIDE_BASH_TIMEOUT}.`)
  }
  if (timedOut && session && listed === "running") {
    return withContext(result, `aside is still running check ${name} in session ${session} (${spent} of ${check.minutes} minutes spent). Wait on it: \`timeout ${Math.min(left, CALL_MINUTES)}m aside session resume ${session} '<prompt>'\`, with the Bash timeout ${ASIDE_BASH_TIMEOUT}; a short prompt asking for the two closing lines again will do.`)
  }
  if (timedOut) {
    return withContext(result, `aside ran past ${minutes} minutes and its session ${session ?? "(none in the output)"} is ${listed ?? "not in aside session list"}, with no verdict. Run aside exec again while time is left (${left} of ${check.minutes} minutes), or write the result with 판정: 실패 and what went wrong.`)
  }
  const said = capture.verdict ? `aside ended with ${capture.observed !== undefined ? `관측: ${capture.observed} and ` : ""}판정: ${capture.verdict}` : "aside ended without the two closing lines"
  return withContext(result, `The hook captured session ${session ?? "(none in the output)"}; ${said}. Write ${resultOf(check)} in the run directory as your task says.`)
}

// right after a runner wrote its check's result file: the verdict it
// copied from aside, and the screenshots in the check's folder; a 통과
// with none counts as 실패 (D177). Once no check is open the hook writes
// ## e2e, and a failed check halts the run for the person (D173).
async function runnerResult($: EngineInterface, c: Ctx, k: CheckRun, result: ToolCallResult): Promise<ToolCallResult> {
  const file = `${c.dir}/${resultOf(k)}`
  const parsed = parseResult(await $.fs.read(file))
  if ("problem" in parsed) return withContext(result, `${file} was saved, but ${parsed.problem} Write it again.`)
  const shots = await shotsIn($, c.dir, k.evidence ?? `evidence/${k.name}`)
  const unshot = parsed.verdict === "통과" && shots.length === 0
  const verdict = unshot ? "실패" : parsed.verdict
  let settled: ReturnType<typeof settleAside>
  const moved = await mutate($, r => {
    const at = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === k.name && x.runner === c.agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !at) return undefined
    const next: CheckRun = { ...at, running: undefined, session: parsed.session, observed: parsed.observed, verdict, shots, ...(unshot ? { unshot: true as const } : {}) }
    const checks = r.e2e.checks.map(x => (x.name === k.name ? next : x))
    settled = settleAside(checks)
    return { ...r, e2e: { ...r.e2e, checks, ...(settled?.written ? { written: settled.written } : {}) }, halt: settled?.halt ?? r.halt, passed: remember(r, next) }
  })
  if (!moved) return withContext(result, `check ${k.name} closed or the run moved on; this result is not used. Report to the main session and stop.`)
  if (verdict === "통과") await tickBox($, c.dir, k.name, asideTick(k))
  await trace($, c.run, { ev: "result", stage: "qa-integration", check: k.name, agentId: c.agentId, verdict, shots, ...(unshot ? { unshot: true } : {}) })
  const why = unshot ? " (aside said 통과, but its folder has no screenshot, so the hook counts it 실패, D177)" : ""
  return withContext(result, `check ${k.name}: 판정: ${verdict}${why}. ${await settledLine($, moved, settled)}`)
}

// what a runner tells the main session once its check closed: while a
// check is still open, nothing more; once none is, it says where the run
// went. Either way the hook writes e2e.md as the checks stand.
async function settledLine($: EngineInterface, run: Run, settled: ReturnType<typeof settleAside>, browser: "aside" | "ego" = "aside"): Promise<string> {
  const file = `${(await ctxOf($, run)).dir}/agent/e2e.md`
  await writeChecks($, file, browser)
  if (!settled) return "Report this to the main session and stop; it spawns the runners mcp__rein__status asks for."
  if (settled.halt?.rule === "D101") return `No check is open now, but ${settled.halt.reason}, so the run is halted (D101); ${file} shows each check as it stands, with no verdict. Report this to the main session and stop: it tells the user, then calls mcp__rein__advance, which says what to ask them.`
  if (settled.halt) return `Every ${browser} check has a verdict and ${settled.halt.reason}. The hook wrote ## e2e in ${file} and halted the run (D173); it does not go to dev on its own, since a failed check is often the environment or what the code did before. Report this to the main session and stop: it tells the user each failed check and its 관측, then calls mcp__rein__advance, which says what to ask them.`
  return `Every ${browser} check passed; the hook wrote ## e2e in ${file}. Report this to the main session and stop: it spawns rein:reviewer for the completion check (the rein:qa skill says how).`
}

// e2e.md from the run's checks as they stand now: the hook's ## e2e once
// it is written, else each check so far (progressSection). Read and written
// under the store lock, so of two checks closing at once the later write
// is not the older view.
async function writeChecks($: EngineInterface, file: string, browser: "aside" | "ego"): Promise<void> {
  await locked(async () => {
    const run = (await lookup($)).run
    const e2e = run?.stage === "qa-integration" ? run.e2e : undefined
    if (e2e?.checks) await writeE2e($, file, e2e.written ?? progressSection(e2e.checks, browser))
  })
}

// text written to e2e.md with its `## 이전 진입` kept; archive (an
// entry starting over) moves what the file held there first (withHistory).
async function writeE2e($: EngineInterface, file: string, text: string, archive = false): Promise<void> {
  const old = (await $.fs.exists(file)) ? await $.fs.read(file) : ""
  await $.fs.write(file, withHistory(old, text, archive))
}

// a session's status in `aside session list`; undefined when the list
// has no line for it or does not run.
async function asideStatus($: EngineInterface, session: string): Promise<string | undefined> {
  try {
    const r = await $.process.run(["aside", "session", "list"], { timeoutMs: 15_000 })
    return r.exitCode === 0 ? sessionStatus(r.stdout, session) : undefined
  } catch {
    return undefined
  }
}

// stop an aside session the timed-out CLI left running; false when
// the stop did not exit 0 or could not start.
async function stopAside($: EngineInterface, session: string): Promise<boolean> {
  try {
    return (await $.process.run(["aside", "session", "stop", session], { timeoutMs: 15_000 })).exitCode === 0
  } catch {
    return false
  }
}

// The hook's own git in a repository, with the -c a checked read-only git
// runs with; undefined when it cannot start.
async function runGit($: EngineInterface, repo: string, args: string[]): Promise<{ exitCode: number; stdout: string } | undefined> {
  return $.process.run(["git", ...GIT_HARDEN, ...args], { cwd: repo }).catch(() => undefined)
}

// HEAD of a repository; "" when it has none yet (`rev-parse --verify -q`
// exits 1 and prints nothing), so any later HEAD counts as changed;
// undefined when git fails otherwise.
async function headOf($: EngineInterface, repo: string): Promise<string | undefined> {
  const r = await runGit($, repo, ["rev-parse", "--verify", "-q", "HEAD"])
  if (r?.exitCode === 0) return r.stdout.trim()
  return r?.exitCode === 1 && r.stdout.trim() === "" ? "" : undefined
}

// G10: the repositories where git status shows a planned file changed,
// computed by the hook on entering land (not from the recorded writes, which
// miss what Bash changed).
async function changedRepos($: EngineInterface, run: Run): Promise<string[]> {
  const out: string[] = []
  for (const repo of run.repos ?? []) {
    const r = await runGit($, repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])
    if (r && r.exitCode === 0 && statusPaths(r.stdout, repo).some(p => (run.planFiles ?? []).some(f => same(f, p)))) out.push(repo)
  }
  return out
}

// right after a e2e.md write went through (judgeIntegration).
// Passing fixes the land repositories and captures their HEAD.
async function integrationExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const run = (await getRun($)) ?? c.run
  const file = `${c.dir}/agent/e2e.md`
  // The reviewer's result goes to the reviewer; the main session reads status.
  const say = (line: string) => withContext(result, c.agentId !== undefined ? `${line} Report this to the main session and stop.` : line)
  if (run.halt) return say(`${run.halt.rule}: the run is halted (${run.halt.reason}); it stays in qa-integration. Tell the user; once they have fixed it, call mcp__rein__advance.`)
  const completion = completionLine(await $.fs.read(`${c.dir}/1-spec.md`))
  const outcome = judgeIntegration(await $.fs.read(file), run, completion)
  if (outcome.kind === "stay") {
    await trace($, run, { ev: "exit", stage: "qa-integration", pass: false, reason: outcome.reason })
    return say(`D79: e2e.md was saved but the run stays in qa-integration: ${outcome.reason}`)
  }
  // a failed completion check stops the run where it is; the main
  // session decides with goto where it goes.
  if (outcome.kind === "failed") {
    const halt = { rule: "completion-failed" as const, reason: `the completion check in ${file} failed` }
    const held = await mutate($, r => (r?.stage === "qa-integration" && !r.halt ? { ...r, halt } : undefined))
    if (!held) return result
    await trace($, run, { ev: "halt", stage: "qa-integration", halt })
    return say(`completion-failed: ${COMPLETION_FAILED}`)
  }
  const land = await changedRepos($, run)
  if (land.length === 0) {
    await trace($, run, { ev: "exit", stage: "qa-integration", pass: false, reason: "nothing to commit" })
    return say("D95: the checks passed, but git status shows no planned file changed in any repository, so there is nothing to commit. Tell the user, then call mcp__rein__advance: it says what to ask them — whether to send the run back to plan or end it without a commit.")
  }
  // a to-be screen of 1-mockup.html whose box is still empty waits for the
  // person's comparison, whatever checked the rest.
  const list = `${c.dir}/5-checklist.md`
  const open = openLayouts((await $.fs.exists(list)) ? await $.fs.read(list) : undefined, run.layouts ?? [])
  if (open.length > 0) {
    const halt = { rule: "layout-unchecked" as const, reason: `the layout boxes of ${list} for ${open.join(", ")} are still empty` }
    const held = await mutate($, r => (r?.stage === "qa-integration" && !r.halt ? { ...r, halt } : undefined))
    if (!held) return result
    await trace($, run, { ev: "halt", stage: "qa-integration", halt })
    return say(`layout-unchecked: integration qa passed, but ${halt.reason}, so the run waits for the user in qa-integration. Tell the user: they open each screen as built beside its to-be in ${c.dir}/1-mockup.html, and check its box when the layout matches, then run /rein:land; or they tell you a layout that differs, and you send the run to dev. Then call mcp__rein__advance: it says what to ask them.`)
  }
  // a config that changed during integration qa (the app, aside, or
  // a hand) does not go to land; the run halts for the person's look.
  const drift = await configDrift($, run)
  if (drift.length > 0) {
    const halt = { rule: "D120" as const, reason: `${drift.join(", ")} changed during integration qa` }
    const held = await mutate($, r => (r?.stage === "qa-integration" && !r.halt ? { ...r, halt } : undefined))
    if (!held) return result
    await trace($, run, { ev: "exit", stage: "qa-integration", pass: false, rule: "D120", configRewritten: drift })
    return say(`D120: the checks passed, but ${halt.reason}, so the run does not go to land; it is halted in qa-integration. Tell the user, then call mcp__rein__advance: the hook shows them the change and asks.`)
  }
  const heads = await headsOf($, land)
  if (typeof heads === "string") {
    await trace($, run, { ev: "exit", stage: "qa-integration", pass: false, reason: `cannot read HEAD of ${heads}` })
    return say(`D95: the checks passed, but git cannot read HEAD of ${heads}, so the run stays in qa-integration. Tell the user; once it is fixed, write e2e.md again.`)
  }
  const moved = await mutate($, r => (r?.stage === "qa-integration" ? { ...r, stage: "land", heads, landRepos: land } : undefined))
  if (!moved) return result
  await trace($, run, { ev: "capture", stage: "land", heads, landRepos: land })
  await trace($, run, { ev: "stage", from: "qa-integration", to: moved.stage, retries: moved.retries })
  return say(`D79: e2e.md judged. ${LAND_ENTRY}`)
}

const LAND_ENTRY = "The run is now in the land stage. Invoke the rein:land skill."

// HEAD of each repository, as land starts from it; the repository git
// cannot read when one fails.
async function headsOf($: EngineInterface, repos: string[]): Promise<Record<string, string> | string> {
  const heads: Record<string, string> = {}
  for (const repo of repos) {
    const head = await headOf($, repo)
    if (head === undefined) return repo
    heads[repo] = head
  }
  return heads
}

// A git command's stdout in a repository, or undefined when it fails.
async function gitOut($: EngineInterface, repo: string, args: string[]): Promise<string | undefined> {
  const r = await runGit($, repo, args)
  return r !== undefined && r.exitCode === 0 ? r.stdout : undefined
}

// git status and the staged names of each land repository, a
// rename as its deletion and its addition.
async function landState($: EngineInterface, run: Run): Promise<{ porcelain: Record<string, string>; staged: Record<string, string> }> {
  const porcelain: Record<string, string> = {}
  const staged: Record<string, string> = {}
  for (const root of run.landRepos ?? []) {
    porcelain[root] = (await gitOut($, root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])) ?? ""
    staged[root] = (await gitOut($, root, ["diff", "--cached", "--name-only", "-z", "--no-renames"])) ?? ""
  }
  return { porcelain, staged }
}

// advance in land. The main session stages the planned files that
// changed and writes 6-land.md, the commit message and what the person
// commits; once the staging is exactly those files the run closes. The
// person commits it themselves, so nothing is asked. A run in worktrees
// commits there on the person's approval instead (landTrees).
async function landGate($: EngineInterface, run: Run, answer: string | undefined): Promise<ToolCallResult> {
  if (run.finished) return finishRun($, run)
  const c = await ctxOf($, run)
  const path = `${c.dir}/6-land.md`
  if (!(await $.fs.exists(path))) return { deny: `D84: ${path} does not exist; write it first, as the rein:land skill says.` }
  if (run.trees !== undefined) return landTrees($, run, c.dir, await $.fs.read(path), answer)
  const { porcelain, staged } = await landState($, run)
  const problem = stagingProblem(run, porcelain, staged)
  if (problem !== undefined) {
    await trace($, run, { ev: "tool", stage: "land", tool: ADVANCE, decision: "deny", rule: "D89", reason: problem })
    return { deny: problem }
  }
  // the frame lists what the person commits, before the folder moves.
  const repos: LandRepo[] = []
  for (const root of run.landRepos ?? []) {
    const files = stagedPaths(staged[root] ?? "", root)
    const left = [...new Set(statusPaths(porcelain[root] ?? "", root))].filter(p => !files.some(f => same(f, p)))
    const rel = (p: string) => p.slice(root.length + 1)
    repos.push({ repo: root, branch: (await branchOf($, root)) ?? "HEAD", files: await landFilesOf($, root, files.map(rel), "staged"), left: left.map(rel) })
  }
  await writeLand($, c.dir, { repos })
  await trace($, run, { ev: "exit", stage: "land", pass: true })
  return finishRun($, run)
}

// agent/land.json of the run folder `dir` as the hook last wrote it, or
// undefined when there is none.
async function readLand($: EngineInterface, dir: string): Promise<Land | undefined> {
  try {
    return JSON.parse(await $.fs.read(`${dir}/${LAND_FILE}`)) as Land
  } catch {
    return undefined
  }
}

// written while the run folder is still in active/, so it moves with the
// folder to complete/. A failure costs only the frame.
async function writeLand($: EngineInterface, dir: string, land: Land): Promise<void> {
  await $.fs.write(`${dir}/${LAND_FILE}`, JSON.stringify(land)).catch(() => {})
}

// land's files of one repository as the frame lists them: each file's
// status and line counts in git, against HEAD in a worktree (a new file git
// does not track yet against nothing), in the index for a run without
// worktrees, or in the commit once one is made in the worktree.
async function landFilesOf($: EngineInterface, cwd: string, rels: string[], from: "head" | "staged" | { commit: string }): Promise<LandFile[]> {
  const args = (kind: string) =>
    typeof from === "object"
      ? ["diff-tree", "--no-commit-id", "-r", "--no-renames", "-z", kind, from.commit]
      : ["diff", ...(from === "staged" ? ["--cached"] : ["HEAD"]), "--no-renames", "--no-ext-diff", "--no-textconv", "-z", kind, "--", ...rels]
  const names = await gitQuiet($, cwd, args("--name-status"))
  const counts = await gitQuiet($, cwd, args("--numstat"))
  const status = nameStatus(names.exitCode === 0 ? names.stdout : "")
  const fresh: Record<string, { add: number | null; del: number | null }> = {}
  for (const p of from === "head" ? rels.filter(p => status[p] === undefined) : []) {
    // --no-index exits 1 when the files differ.
    const r = await gitQuiet($, cwd, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--", "/dev/null", p])
    const [counted] = r.exitCode <= 1 ? numstat(r.stdout) : []
    if (counted) fresh[p] = counted
  }
  return landFiles(rels, status, numstat(counts.exitCode === 0 ? counts.stdout : ""), fresh)
}

// one land repository of a run in worktrees: its tree, the files its
// commit holds (the planned files that changed, or the commit's once made),
// the other changes left in the worktree, which go with it unrecorded, and
// the main tree's branch the commit goes into.
type Landing = { tree: Tree; files: string[]; dropped: string[]; into: string }

// what land would do in each land repository not landed yet, or why it
// cannot: the main tree on another branch than the run started from, or on
// a detached HEAD, or git failing.
async function landings($: EngineInterface, run: Run): Promise<{ landings: Landing[] } | { problem: string }> {
  const out: Landing[] = []
  const problems: string[] = []
  for (const root of run.landRepos ?? []) {
    const tree = run.trees?.find(t => same(t.path, root))
    if (!tree) {
      problems.push(`${root} is no worktree of the run`)
      continue
    }
    if (tree.landed) continue
    const into = await branchOf($, tree.repo)
    if (into === undefined) problems.push(`git cannot read the branch of the main working tree ${tree.repo}`)
    else if (into === null) problems.push(`the main working tree ${tree.repo} is on a detached HEAD${tree.start === null ? ", as it was when the run started" : ""}; the user switches it to the branch the commit goes into`)
    else if (tree.start !== null && into !== tree.start) problems.push(`the main working tree ${tree.repo} is on ${into}, not on ${tree.start}, where the run started from; the user switches it back to ${tree.start}`)
    if (into === undefined || into === null || (tree.start !== null && into !== tree.start)) continue
    const status = await gitQuiet($, root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])
    if (status.exitCode !== 0) {
      problems.push(`git status failed in ${root}: ${firstLine(status)}`)
      continue
    }
    const planned = filesOf(run, root)
    const changed = [...new Set(statusPaths(status.stdout, root))]
    const ofPlan = (p: string) => planned.some(f => same(f, p))
    let files = changed.filter(ofPlan)
    if (tree.commit !== undefined) {
      const shown = await gitQuiet($, root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", tree.commit])
      files = shown.stdout.split("\0").filter(p => p !== "").map(p => resolve(`${root}/${p}`, root))
    }
    if (files.length === 0) problems.push(`no planned file of ${root} is changed any more, so it has nothing to commit`)
    else out.push({ tree, files, dropped: changed.filter(p => !ofPlan(p)), into })
  }
  return problems.length > 0 ? { problem: problems.join("; ") } : { landings: out }
}

// land of a run in worktrees, on the person's approval of the message in
// 6-land.md and of what goes where: in each land repository the planned
// files that changed are committed in the worktree (by name, the
// repository's git hooks off), the commit is cherry-picked into the main
// tree's branch, and the worktree and its branch go, with whatever else was
// left in it. A cherry-pick git refuses or that conflicts is undone and land
// stops there, the commit kept in the worktree; a repository already landed
// is skipped when advance comes again.
async function landTrees($: EngineInterface, run: Run, dir: string, text: string, answer: string | undefined): Promise<ToolCallResult> {
  const message = landMessage(text)
  if (message === undefined) return { deny: "6-land.md has no commit message: write it in a fenced block under `## 커밋 메시지`, as the rein:land skill says. Then call advance again." }
  // land removes the worktree, and Windows keeps a folder the session is in.
  const root = await sessionRoot($)
  const inside = openTrees(run).find(t => same(root, t.path) || under(root, t.path))
  if (inside) return { deny: `this session is in the run's worktree ${inside.path}, which land removes once the commit is in, and a folder the session is in cannot be removed (on Windows). Call ExitWorktree with action "keep" first, then call advance again. Nothing was asked or committed.` }
  const planned = await landings($, run)
  if ("problem" in planned) {
    await trace($, run, { ev: "tool", stage: "land", tool: ADVANCE, decision: "deny", reason: planned.problem })
    return { deny: `the run cannot land yet: ${planned.problem}. Nothing was committed; the main working trees and the worktrees are as they were. Tell the user; once it is fixed, call advance again.` }
  }
  const rel = (t: Tree, p: string) => p.slice(t.path.length + 1)
  const landed = (run.trees ?? []).filter(t => t.landed)
  // the frame lists what each repository commits, as asked; a repository
  // landed before keeps what it listed then, and its result.
  const before = await readLand($, dir)
  let land: Land = { ...before, repos: (before?.repos ?? []).filter(x => landed.some(t => same(t.repo, x.repo))) }
  for (const l of planned.landings) {
    const rels = l.files.map(p => rel(l.tree, p))
    land.repos.push({ repo: l.tree.repo, branch: l.into, files: await landFilesOf($, l.tree.path, rels, l.tree.commit === undefined ? "head" : { commit: l.tree.commit }), left: l.dropped.map(p => rel(l.tree, p)) })
  }
  await writeLand($, dir, land)
  const facts = [
    `run ${run.runId}의 변경을 커밋해 메인 작업 트리로 가져올까요? 승인하면 저장소마다 워크트리에서 아래 파일만 커밋하고, 메인 작업 트리의 브랜치에 cherry-pick한 뒤, 워크트리와 브랜치 ${treeBranch(run.runId)}를 지웁니다. 저장소의 git hook(pre-commit 등)은 돌지 않습니다.`,
    `커밋 메시지:\n${quoted(message)}`,
    ...planned.landings.map(l => [
      `${l.tree.repo} — ${l.into} 브랜치에 넣음${l.tree.start === null ? " (run을 시작할 때 detached HEAD였으므로 지금 브랜치)" : ""}${l.tree.commit ? ` (워크트리에 이미 커밋함: ${l.tree.commit.slice(0, 12)})` : ""}`,
      `  커밋할 파일: ${l.files.map(p => rel(l.tree, p)).join(", ")}`,
      ...(l.dropped.length > 0 ? [`  커밋하지 않고 워크트리와 함께 지워질 파일: ${l.dropped.map(p => rel(l.tree, p)).join(", ")}`] : []),
    ].join("\n")),
    ...(landed.length > 0 ? [`이미 넣은 저장소: ${landed.map(t => t.repo).join(", ")}`] : []),
  ].join("\n\n")
  if (answer === undefined) {
    await trace($, run, { ev: "tool", stage: "land", tool: ADVANCE, decision: "deny", reason: "no answer" })
    if (run.autopilot) return selfAnswer("", facts, COMMIT)
    return unanswered("", facts, [COMMIT, CANCEL], true)
  }
  if (answer !== COMMIT && answer !== CANCEL) return offLabel("", answer, [COMMIT, CANCEL])
  if (answer === CANCEL) {
    await trace($, run, { ev: "tool", stage: "land", tool: ADVANCE, decision: "deny", answer })
    return { result: "The user did not approve the commit; nothing was committed and the run stays in land. Do what they said (a changed 6-land.md, say), then call advance again: it asks anew." }
  }
  const setTree = (path: string, patch: Partial<Tree>) =>
    mutate($, r => (r?.stage === "land" ? { ...r, trees: r.trees?.map(x => (same(x.path, path) ? { ...x, ...patch } : x)) } : undefined))
  const already = () => (landed.length > 0 ? ` Already in: ${landed.map(x => x.repo).join(", ")}.` : "")
  const cleanup: string[] = []
  for (const l of planned.landings) {
    const t = l.tree
    let commit = t.commit
    if (commit === undefined) {
      const added = await gitQuiet($, t.path, ["add", "-A", "--", ...l.files.map(p => rel(t, p))])
      const made = added.exitCode === 0 ? await gitQuiet($, t.path, ["commit", "-q", "-m", message]) : added
      const head = made.exitCode === 0 ? await gitQuiet($, t.path, ["rev-parse", "HEAD"]) : made
      if (head.exitCode !== 0) {
        await trace($, run, { ev: "error", stage: "land", tool: ADVANCE, repo: t.path, error: firstLine(head) })
        return { deny: `committing in the worktree ${t.path} failed (${firstLine(head)}). Nothing went into ${t.repo}.${already()} Tell the user; once it is fixed, call advance again.` }
      }
      commit = head.stdout.trim()
      await setTree(t.path, { commit })
      await trace($, run, { ev: "commit", stage: "land", repo: t.path, commit, files: l.files })
    }
    const picked = await gitQuiet($, t.repo, ["cherry-pick", commit])
    if (picked.exitCode !== 0) {
      await gitQuiet($, t.repo, ["cherry-pick", "--abort"])
      await trace($, run, { ev: "error", stage: "land", tool: ADVANCE, repo: t.repo, commit, error: firstLine(picked) })
      return { deny: `the commit ${commit} is in the worktree ${t.path}, but \`git cherry-pick\` into ${t.repo} (${l.into}) failed (${firstLine(picked)}). It was undone (cherry-pick --abort), so the main working tree is as it was; the commit stays in the worktree.${already()} git refuses while the main tree has anything staged, or changes of its own to the same files. Tell the user; once they have committed, stashed or unstaged those, call advance again (it asks again).` }
    }
    await setTree(t.path, { landed: true })
    landed.push(t)
    await trace($, run, { ev: "land", stage: "land", repo: t.repo, into: l.into, commit })
    const picks = await gitQuiet($, t.repo, ["rev-parse", "HEAD"])
    cleanup.push(...(await removeTree($, t)))
    // the frame shows each commit as it is in the main tree, and where the
    // worktree is when it could not be removed.
    const removed = !(await $.fs.exists(t.path))
    const done: LandResult = { repo: t.repo, branch: l.into, commit: picks.exitCode === 0 ? picks.stdout.trim() : "", removed, ...(removed ? {} : { folder: t.path }) }
    land = { ...land, result: [...(land.result ?? []).filter(x => !same(x.repo, t.repo)), done] }
    await writeLand($, dir, land)
  }
  await trace($, run, { ev: "exit", stage: "land", pass: true, ...(cleanup.length > 0 ? { cleanup } : {}) })
  return finishRun($, (await getRun($)) ?? run, cleanup)
}

// the run ends: its folder moves to complete/ and its record and
// the session's pointer go, so the session can open a new one. When the
// folder cannot move, the run stays in land marked finished, and advance
// tries again.
async function finishRun($: EngineInterface, run: Run, cleanup: string[] = []): Promise<ToolCallResult> {
  const left = await leaveActive($, run, "complete", { ev: "stage", from: "land", to: null })
  if ("problem" in left) {
    await mutate($, r => (r?.stage === "land" && !r.finished ? { ...r, finished: true } : undefined))
    return { deny: `D144: ${run.trees !== undefined ? "the commits are in" : "the staging is ready"}, but the run folder could not be moved to complete (${left.problem}), so the run stays open in land. Tell the user (on Windows a file in the run folder may be open in another program); once fixed, call mcp__rein__advance: the hook finishes the run.` }
  }
  const done = await folderOf($, "complete", run.runId)
  // the handoff files moved with the folder; the person applies them.
  const handoff = run.handoff?.length
    ? ` The user still has to apply the handoff files by hand, as 2-plan.md's \`## 넘길 것\` says (${done}/2-plan.md): ${run.handoff.map(h => `${done}/handoff/${h}`).join(", ")}. Tell them each file and what to do with it.`
    : ""
  if (run.trees !== undefined) {
    const removed = cleanup.length > 0 ? ` Removing the worktrees did not finish: ${cleanup.join("; ")}.` : ""
    return { result: "The run is finished.", context: [`D60: the run's commit is in the main working tree of ${run.trees.filter(t => t.landed).map(t => t.repo).join(", ")}, with the message in ${done}/6-land.md. The run is finished and closed; its record is in ${done}.${removed}${left.note}${handoff} Tell the user.${left.retro}`] }
  }
  return { result: "The run is finished.", context: [`D60: the planned files that changed are staged in ${(run.landRepos ?? []).join(", ")}. The run is finished and closed; its record is in ${done}. The user commits the staging themselves, with the message in ${done}/6-land.md: give them that path.${left.note}${handoff} Tell the user.${left.retro}`] }
}

// the next round of dev-diff.md: each repository's planned files against HEAD,
// a new (untracked or ignored) one as its whole text.
async function writeDevDiff($: EngineInterface, run: Run, dir: string, why: string | undefined, failFile?: string): Promise<void> {
  const flags = ["--no-renames", "--no-ext-diff", "--no-textconv", "--no-color"]
  const diffs: Record<string, string | undefined> = {}
  for (const repo of run.repos ?? []) {
    const files = filesOf(run, repo)
    if (files.length === 0) {
      diffs[repo] = ""
      continue
    }
    const tracked = await gitQuiet($, repo, ["diff", ...flags, "HEAD", "--", ...files])
    const listed = await gitQuiet($, repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--no-renames", "--", ...files])
    if (tracked.exitCode !== 0 || listed.exitCode !== 0) {
      diffs[repo] = undefined
      continue
    }
    let text: string | undefined = tracked.stdout
    for (const e of statusEntries(listed.stdout, repo).filter(e => e.code === "??" || e.code === "!!")) {
      // --no-index exits 1 when the files differ.
      const r = await gitQuiet($, repo, ["diff", "--no-index", ...flags, "--", "/dev/null", e.path.slice(repo.length + 1)])
      if (r.exitCode > 1) {
        text = undefined
        break
      }
      text += r.stdout
    }
    diffs[repo] = text
  }
  const path = `${dir}/agent/dev-diff.md`
  const fails = `${dir}/agent/fails.md`
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ""
  const failure = failFile && (await $.fs.exists(failFile)) ? await $.fs.read(failFile) : undefined
  const heading = devRound(before, new Date(await $.clock.now()).toISOString(), why)
  // fails.md first: it carries an old dev-diff.md's failures before that is replaced.
  await $.fs.write(fails, devFails((await $.fs.exists(fails)) ? await $.fs.read(fails) : undefined, before, heading, failure))
  await $.fs.write(path, devDiff(heading, diffs))
}

// the hook's own git with the repository's hooks off, as land runs
// it: exit, stdout, stderr.
async function gitQuiet($: EngineInterface, cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const r = await $.process.run(["git", ...GIT_HARDEN, "-c", "core.hooksPath=/dev/null", ...args], { cwd })
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return { exitCode: 127, stdout: "", stderr: String(err) }
  }
}

const firstLine = (r: { stdout: string; stderr: string; exitCode: number }) =>
  (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/)[0]!.slice(0, 300) || `exit ${r.exitCode}`

// how long one `worktree.setup` command may run.
const SETUP_MS = 10 * 60_000

// the branch a main tree is on; null on a detached HEAD; undefined when
// git cannot tell (no repository, no commit yet).
async function branchOf($: EngineInterface, repo: string): Promise<string | null | undefined> {
  const r = await gitQuiet($, repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  if (r.exitCode === 0) return r.stdout.trim()
  if (r.exitCode !== 1) return undefined
  return (await gitQuiet($, repo, ["rev-parse", "--verify", "-q", "HEAD"])).exitCode === 0 ? null : undefined
}

// the run's worktree of a repository, made from its HEAD on a new branch
// rein/<runId>, its folder kept out of the repository's git status. setup is
// run apart (setupTree), once the worktree's config is in place.
async function makeTree($: EngineInterface, repo: string, runId: string, root = false): Promise<Tree | { problem: string }> {
  const start = await branchOf($, repo)
  if (start === undefined) return { problem: `git cannot read the branch or HEAD of ${repo} (a repository needs a first commit)` }
  const [path, branch] = [treePath(repo, runId), treeBranch(runId)]
  const added = await gitQuiet($, repo, ["worktree", "add", "-b", branch, path, "HEAD"])
  if (added.exitCode !== 0) return { problem: `\`git worktree add -b ${branch} ${path} HEAD\` failed in ${repo}: ${firstLine(added)}` }
  await excludeTrees($, repo)
  return { repo, path, branch, start, ...(root ? { root: true as const } : {}) }
}

// .claude/worktrees/ in the repository's info/exclude, so its git status
// does not list the run's worktrees. Best effort: only the status is at stake.
async function excludeTrees($: EngineInterface, repo: string): Promise<void> {
  try {
    const r = await gitQuiet($, repo, ["rev-parse", "--git-path", "info/exclude"])
    if (r.exitCode !== 0 || r.stdout.trim() === "") return
    const file = resolve(r.stdout.trim(), repo)
    const text = (await $.fs.exists(file)) ? await $.fs.read(file) : ""
    if (text.split(/\r?\n/).some(l => l.trim() === `/${WORKTREES}/` || l.trim() === `${WORKTREES}/`)) return
    await $.fs.write(file, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}/${WORKTREES}/\n`)
  } catch {
    // the worktree works the same; git status lists it.
  }
}

// the main tree's .rein/config.json into a worktree made without one (git
// does not track it there), before its worktree.setup runs; intoTrees does
// the same for the worktrees plan makes.
async function carryConfig($: EngineInterface, t: Tree): Promise<void> {
  const [from, to] = [`${t.repo}/.rein/config.json`, `${t.path}/.rein/config.json`]
  if (!(await $.fs.exists(to)) && (await $.fs.exists(from))) await $.fs.write(to, await $.fs.read(from))
}

// `worktree.setup` of the worktree's own .rein/config.json, run in it
// command by command; "" when every one passed or there are none, else the
// one that failed with the end of its output, for the person.
async function setupTree($: EngineInterface, path: string): Promise<string> {
  const file = `${path}/.rein/config.json`
  const text = (await $.fs.exists(file)) ? await $.fs.read(file) : undefined
  if (text === undefined || checkConfig(text) !== undefined) return ""
  for (const cmd of readConfig(text).setup) {
    const r = await runShell($, cmd, path, SETUP_MS)
    if (r.exit !== 0) return `\`${cmd}\` (in ${path}) exited ${r.exit}:\n${quoted(r.out.trim().split(/\r?\n/).slice(-15).join("\n") || "(출력 없음)")}`
  }
  return ""
}

// what the main session reads when worktree.setup failed: the run goes on.
const setupLine = (failed: string[]) =>
  failed.length === 0 ? "" : ` worktree.setup failed, so the worktree may lack what it needs (dependencies, say); the run goes on. Tell the user, and run the command again in the worktree once they have fixed the cause:\n${failed.join("\n")}`

// the run's worktree and its branch gone; the problems, none when both went.
// A folder a program holds (on Windows) fails the removal, but git has
// deleted the files and dropped the worktree by then, so only the empty
// folder is left to delete.
async function removeTree($: EngineInterface, t: Tree): Promise<string[]> {
  const problems: string[] = []
  const removed = await gitQuiet($, t.repo, ["worktree", "remove", "--force", t.path])
  await gitQuiet($, t.repo, ["worktree", "prune"])
  if (removed.exitCode !== 0) {
    const listed = await gitQuiet($, t.repo, ["worktree", "list", "--porcelain"])
    const kept = listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some(l => l.startsWith("worktree ") && same(resolve(l.slice(9).trim(), t.repo), t.path))
    problems.push(kept
      ? `\`git -C ${t.repo} worktree remove --force ${t.path}\` failed (${firstLine(removed)}); the user runs it again once no program holds the folder`
      : `git deleted the worktree's files and dropped it, but could not delete the folder ${t.path} (${firstLine(removed)}): a program holds it. The user deletes the empty folder once that program is closed`)
  }
  const branch = await gitQuiet($, t.repo, ["branch", "-D", t.branch])
  if (branch.exitCode !== 0) problems.push(`\`git -C ${t.repo} branch -D ${t.branch}\`: ${firstLine(branch)}`)
  return problems
}

// the session root, resolved.
async function sessionRoot($: EngineInterface): Promise<string> {
  const raw = slash(await $.session.root())
  return resolve(raw, raw)
}

// the session's own worktree of the run when the session is not in it:
// the run's tools and writes wait until it is.
async function awayFrom($: EngineInterface, run: Run): Promise<Tree | undefined> {
  const home = run.trees?.find(t => t.root)
  return home !== undefined && !same(await sessionRoot($), home.path) ? home : undefined
}

const enterLine = (t: Tree) =>
  `Call EnterWorktree with path ${t.path} (the run's worktree, branch ${t.branch}) before anything else: Rein refuses the run's tools and writes from any other folder.`

const awayDeny = (run: Run, t: Tree) =>
  `the run ${run.runId} works in its own git worktree, ${t.path}, and this session is not in it. ${enterLine(t)} Then call this again.`

// at plan's pass, the run's worktree of each repository 2-plan.md names
// that the session root's tree does not hold and the run has none of yet,
// each from its HEAD, and the judgment moved into the worktrees: the files,
// the repositories, their configs and the files the checks name. Each
// worktree gets the config the person approves (the main tree's, which may
// differ from HEAD's), then its worktree.setup. A run from before worktrees
// passes as it is.
async function intoTrees($: EngineInterface, run: Run, j: Extract<PlanJudgment, { ok: true }>): Promise<{ j: Extract<PlanJudgment, { ok: true }>; trees?: Tree[]; made: Tree[]; setup: string[] } | { problem: string }> {
  if (run.trees === undefined) return { j, made: [], setup: [] }
  const made: Tree[] = []
  for (const repo of j.repos) {
    if ([...run.trees, ...made].some(t => same(t.path, repo) || same(t.repo, repo))) continue
    const t = await makeTree($, repo, run.runId)
    if ("problem" in t) {
      for (const m of made) await removeTree($, m)
      return { problem: t.problem }
    }
    made.push(t)
  }
  const trees = [...run.trees, ...made]
  const move = (p: string) => inTree(trees, p)
  const keyed = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [move(k), v]))
  const setup: string[] = []
  for (const repo of j.repos) {
    const at = move(repo)
    if (same(at, repo)) continue
    const file = `${at}/.rein/config.json`
    const want = j.texts[repo]!
    if (!(await $.fs.exists(file)) || (await $.fs.read(file)) !== want) await $.fs.write(file, want)
    if (made.some(m => same(m.path, at))) {
      const failed = await setupTree($, at)
      if (failed !== "") setup.push(failed)
    }
  }
  const moved = {
    ...j,
    files: j.files.map(move),
    repos: j.repos.map(move),
    hashes: keyed(j.hashes), views: keyed(j.views), texts: keyed(j.texts),
    checks: j.checks.map(k => (k.files ? { ...k, files: k.files.map(move) } : k)),
  }
  return { j: moved, trees, made, setup }
}

// the agent type that runs one aside check of integration qa.
const RUNNER = "rein:e2e-runner"

// a rein:e2e-runner takes the first check startable gives, claimed in the
// run before the agent starts, so the spawns of one message take one check
// each; the hook writes its task (runnerTask) and names the agent after the
// check. It runs in the background: the main session spawns the next ones as
// mcp__rein__status asks, each time a runner finishes.
async function spawnRunner($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  if (run.stage !== "qa-integration" || run.e2e?.path !== "aside" || run.e2e.written !== undefined) {
    return { deny: `${RUNNER} runs a check only while the aside checks of qa-integration wait for their verdicts; the run is in ${run.stage}${run.e2e ? `, e2e: ${run.e2e.path}` : ""}.` }
  }
  if (run.halt) return { deny: `${run.halt.rule}: the run is halted (${run.halt.reason}). Tell the user; once they have fixed it, call mcp__rein__advance.` }
  await reapRunners($)
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return { deny: `D50: ${frozen.problem}. Call mcp__rein__advance: it says what to ask the user.` }
  const e2e = (run.repos ?? []).map(r => frozen.configs[r]?.e2e).find(x => x !== undefined)
  if (!e2e) return { deny: "no repository's config has e2e any more, so no aside check can run. Tell the user." }
  const claim = `claim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  let k: CheckRun | undefined
  const claimed = await mutate($, r => {
    if (r?.stage !== "qa-integration" || r.e2e?.path !== "aside" || !r.e2e.checks || r.halt) return undefined
    k = startable(r.e2e.checks)[0]
    if (!k) return undefined
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k!.name ? { ...x, runner: claim } : x)) } }
  })
  if (!claimed || !k) {
    const open = (await getRun($))?.e2e?.checks?.filter(isOpen) ?? []
    const on = open.filter(x => x.runner !== undefined)
    if (open.length === on.length) return { deny: `every open aside check already has its runner (${on.map(x => x.name).join(", ") || "none open"}); no other is needed. Wait for them.` }
    const waits = open.find(x => x.runner === undefined)!
    return { deny: `check ${waits.name} waits for the runners on ${on.map(x => x.name).join(", ")}: checks run side by side only when none saves and all log in to one app as one account, at most ${AT_ONCE} at once, in 2-plan.md's order. Spawn it once mcp__rein__status asks for a runner.` }
  }
  const release = () => mutate($, r => (r?.e2e?.checks?.some(x => x.runner === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.runner === claim ? { ...x, runner: undefined } : x)) } } : undefined))
  const check = k
  const c = await ctxOf($, claimed)
  const plan = claimed.checks?.find(x => x.name === check.name) ?? { name: check.name, app: check.app ?? Object.keys(e2e.apps)[0]!, todo: check.todo ?? "", expect: check.expect ?? "", saves: check.saves === true, ...(check.account ? { account: check.account } : {}) }
  const prompt = runnerTask(e2e, plan, check, `${c.dir}/${check.evidence ?? `evidence/${check.name}`}`, `${c.dir}/${resultOf(check)}`)
  let result: AgentSpawnResult
  try {
    result = await next({ ...e, prompt, description: check.name, background: true })
  } catch (err) {
    await release()
    throw err
  }
  if (result.deny !== undefined || result.agentId === undefined) {
    await release()
    return result
  }
  const agentId = result.agentId
  reinAgents.add(agentId)
  try {
    const moved = await mutate($, r => (r?.e2e?.checks?.some(x => x.runner === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.runner === claim ? { ...x, runner: agentId } : x)) } } : undefined))
    await trace($, moved ?? run, { ev: "spawn", stage: "qa-integration", agent: RUNNER, agentId, check: check.name, ...(moved ? {} : { lost: true }) })
  } catch (err) {
    await trace($, run, { ev: "error", stage: "qa-integration", agent: RUNNER, agentId, check: check.name, error: String(err) })
  }
  return result
}

// the agent types of the ego path: one drives a check in ego, one judges it
// from the evidence.
const DRIVER = "rein:ego-driver"
const JUDGE = "rein:ego-judge"

const egoOpen = (run: Run) => run.stage === "qa-integration" && run.e2e?.path === "ego" && run.e2e.written === undefined

// a rein:ego-driver takes the first check egoStartable gives, claimed in
// the run before the agent starts, like a rein:e2e-runner. The hook writes
// the attempt's harness.mjs, its settings baked in, and the driver's task;
// the check's clock starts.
async function spawnDriver($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  if (!egoOpen(run)) return { deny: `${DRIVER} drives a check only while the ego checks of qa-integration wait for their verdicts; the run is in ${run.stage}${run.e2e ? `, e2e: ${run.e2e.path}` : ""}.` }
  if (run.halt) return { deny: `${run.halt.rule}: the run is halted (${run.halt.reason}). Tell the user; once they have fixed it, call mcp__rein__advance.` }
  // a SendMessage to a driver that stopped (its hand-off is over, its judge
  // found evidence missing) resumes it through agent.spawn, under its own
  // id, and a hook can only refuse that: it goes on with its own check, so
  // nothing is claimed.
  const resumed = (e as { resume?: { agentId: string } }).resume?.agentId
  if (resumed !== undefined) {
    if (run.e2e?.checks?.some(k => isOpen(k) && k.runner === resumed)) return next(e)
    return { deny: `${resumed} drives no open ego check now, so it is not resumed. Spawn a new ${DRIVER} once mcp__rein__status asks for one.` }
  }
  await reapRunners($)
  const frozen = await frozenConfigs($, run)
  if ("problem" in frozen) return { deny: `D50: ${frozen.problem}. Call mcp__rein__advance: it says what to ask the user.` }
  const e2e = (run.repos ?? []).map(r => frozen.configs[r]?.e2e).find(x => x !== undefined)
  if (!e2e) return { deny: "no repository's config has e2e any more, so no ego check can run. Tell the user." }
  const claim = `claim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  let k: CheckRun | undefined
  const claimed = await mutate($, r => {
    if (!r || !egoOpen(r) || !r.e2e?.checks || r.halt) return undefined
    k = egoStartable(r.e2e.checks)[0]
    if (!k) return undefined
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k!.name ? { ...x, runner: claim } : x)) } }
  })
  if (!claimed || !k?.ego) {
    const open = (await getRun($))?.e2e?.checks?.filter(isOpen) ?? []
    const on = open.filter(x => x.runner !== undefined)
    if (open.every(x => x.runner !== undefined)) return { deny: `every open ego check already has its driver (${on.map(x => x.name).join(", ") || "none open"}); no other is needed. Wait for them.` }
    const waits = open.find(x => x.runner === undefined)!
    return { deny: `check ${waits.name} waits for the drivers on ${on.filter(driving).map(x => x.name).join(", ")}: a check that saves runs alone, checks in one ego profile run together only as one account, at most ${AT_ONCE} at once, in 2-plan.md's order. Spawn it once mcp__rein__status asks for a driver.` }
  }
  const release = () => mutate($, r => (r?.e2e?.checks?.some(x => x.runner === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.runner === claim ? { ...x, runner: undefined } : x)) } } : undefined))
  const check = k
  const c = await ctxOf($, claimed)
  const plan = planCheck(claimed, check, e2e)
  const folder = `${c.dir}/${checkFolder(check)}`
  const now = await $.clock.now()
  let prompt: string
  try {
    await writeHarness($, folder, check, e2e, plan)
    const guide = `${c.dir}/agent/evidence/${EGO_GUIDE}`
    prompt = driverTask(e2e, plan, check, folder, (await $.fs.exists(guide)) ? guide : undefined, roundLimitMs(check, now), await lastRound($, folder))
  } catch (err) {
    await release()
    throw err
  }
  let result: AgentSpawnResult
  try {
    result = await next({ ...e, prompt, description: check.name, background: true })
  } catch (err) {
    await release()
    throw err
  }
  if (result.deny !== undefined || result.agentId === undefined) {
    await release()
    return result
  }
  const agentId = result.agentId
  reinAgents.add(agentId)
  try {
    const moved = await mutate($, r => (r?.e2e?.checks?.some(x => x.runner === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.runner === claim && x.ego ? { ...x, runner: agentId, ego: { ...x.ego, since: x.ego.since ?? now } } : x)) } } : undefined))
    await trace($, moved ?? run, { ev: "spawn", stage: "qa-integration", agent: DRIVER, agentId, check: check.name, ...(moved ? {} : { lost: true }) })
  } catch (err) {
    await trace($, run, { ev: "error", stage: "qa-integration", agent: DRIVER, agentId, check: check.name, error: String(err) })
  }
  return result
}

// a rein:ego-judge takes the first check whose driver is done and no judge
// has; it reads the evidence and writes the check's judge.md.
async function spawnJudge($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  if (!egoOpen(run)) return { deny: `${JUDGE} judges a check only while the ego checks of qa-integration wait for their verdicts; the run is in ${run.stage}${run.e2e ? `, e2e: ${run.e2e.path}` : ""}.` }
  if (run.halt) return { deny: `${run.halt.rule}: the run is halted (${run.halt.reason}). Tell the user; once they have fixed it, call mcp__rein__advance.` }
  await reapRunners($)
  const claim = `claim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  let k: CheckRun | undefined
  const claimed = await mutate($, r => {
    if (!r || !egoOpen(r) || !r.e2e?.checks || r.halt) return undefined
    k = judgeable(r.e2e.checks).filter(x => !isLayoutCheck(x.name))[0]
    if (!k?.ego) return undefined
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k!.name && x.ego ? { ...x, ego: { ...x.ego, judge: claim } } : x)) } }
  })
  if (!claimed || !k?.ego) return { deny: "no ego check waits for a judge now: a judge takes a check once its driver called done(), and a layout check (배치-<id>) takes rein:layout-verifier. Spawn one when mcp__rein__status asks for it." }
  const check = k
  const release = () => mutate($, r => (r?.e2e?.checks?.some(x => x.ego?.judge === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.ego?.judge === claim ? { ...x, ego: { ...x.ego, judge: undefined } } : x)) } } : undefined))
  const c = await ctxOf($, claimed)
  const frozen = await frozenConfigs($, claimed)
  const e2e = "problem" in frozen ? undefined : (claimed.repos ?? []).map(r => frozen.configs[r]?.e2e).find(x => x !== undefined)
  const plan = planCheck(claimed, check, e2e)
  const prompt = egoJudgeTask(plan, check, `${c.dir}/${checkFolder(check)}`, `${c.dir}/${judgeOf(check)}`, check.ego!.driven)
  let result: AgentSpawnResult
  try {
    result = await next({ ...e, prompt, description: `judge ${check.name}`, background: true })
  } catch (err) {
    await release()
    throw err
  }
  if (result.deny !== undefined || result.agentId === undefined) {
    await release()
    return result
  }
  const agentId = result.agentId
  reinAgents.add(agentId)
  const moved = await mutate($, r => (r?.e2e?.checks?.some(x => x.ego?.judge === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.ego?.judge === claim ? { ...x, ego: { ...x.ego, judge: agentId } } : x)) } } : undefined))
  await trace($, moved ?? run, { ev: "spawn", stage: "qa-integration", agent: JUDGE, agentId, check: check.name, ...(moved ? {} : { lost: true }) })
  return result
}

// rein:layout-verifier as the judge of a layout check whose driver called
// done(): the hook renders the screen's to-be and claims the check as
// spawnJudge does; the verdict goes through egoJudged like any judge's.
async function spawnLayoutJudge($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  if (!egoOpen(run)) return { deny: `${LAYOUT_VERIFIER} judges a layout check only while the ego checks of qa-integration wait for their verdicts; the run is in ${run.stage}${run.e2e ? `, e2e: ${run.e2e.path}` : ""}.` }
  if (run.halt) return { deny: `${run.halt.rule}: the run is halted (${run.halt.reason}). Tell the user; once they have fixed it, call mcp__rein__advance.` }
  await reapRunners($)
  const claim = `claim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  let k: CheckRun | undefined
  const claimed = await mutate($, r => {
    if (!r || !egoOpen(r) || !r.e2e?.checks || r.halt) return undefined
    k = judgeable(r.e2e.checks).filter(x => isLayoutCheck(x.name))[0]
    if (!k?.ego) return undefined
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k!.name && x.ego ? { ...x, ego: { ...x.ego, judge: claim } } : x)) } }
  })
  if (!claimed || !k?.ego) return { deny: "no layout check (배치-<id>) waits for a judge now: one does once its driver called done(). Spawn one when mcp__rein__status asks for it." }
  const check = k
  const release = () => mutate($, r => (r?.e2e?.checks?.some(x => x.ego?.judge === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.ego?.judge === claim ? { ...x, ego: { ...x.ego, judge: undefined } } : x)) } } : undefined))
  const c = await ctxOf($, claimed)
  const id = layoutIdOf(check.name)
  const look = claimed.layouts?.find(l => l.anchor === id)?.look ?? ""
  const shot = (await toBeShots($, c.dir, [{ anchor: id, page: "", route: "", look }]))[id]
  const shots = (await shotsIn($, c.dir, checkFolder(check))).map(s => `${c.dir}/${s}`)
  const prompt = builtVerifierTask(id, look, shot ? `${c.dir}/${shot}` : undefined, `${c.dir}/1-mockup.html`, shots, `${c.dir}/${judgeOf(check)}`)
  let result: AgentSpawnResult
  try {
    result = await next({ ...e, prompt, description: `judge ${check.name}`, background: true })
  } catch (err) {
    await release()
    throw err
  }
  if (result.deny !== undefined || result.agentId === undefined) {
    await release()
    return result
  }
  const agentId = result.agentId
  reinAgents.add(agentId)
  layoutVerifiers.add(agentId)
  const moved = await mutate($, r => (r?.e2e?.checks?.some(x => x.ego?.judge === claim) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.ego?.judge === claim ? { ...x, ego: { ...x.ego, judge: agentId } } : x)) } } : undefined))
  await trace($, moved ?? run, { ev: "spawn", stage: "qa-integration", agent: LAYOUT_VERIFIER, agentId, check: check.name, ...(moved ? {} : { lost: true }) })
  return result
}

// check k as 2-plan.md gave it, else as the run kept it.
function planCheck(run: Run, k: CheckRun, e2e: E2e | undefined): Check {
  return run.checks?.find(x => x.name === k.name) ?? run.layoutChecks?.find(x => x.name === k.name) ?? { name: k.name, app: k.app ?? Object.keys(e2e?.apps ?? {})[0] ?? "", todo: k.todo ?? "", expect: k.expect ?? "", saves: k.saves === true, ...(k.account ? { account: k.account } : {}) }
}

// the attempt's harness.mjs, its settings baked in.
async function writeHarness($: EngineInterface, folder: string, k: CheckRun, e2e: E2e, plan: Check): Promise<void> {
  await $.fs.write(`${folder}/${HARNESS_FILE}`, harnessSource({ folder, space: k.ego!.space, profile: k.ego!.profile, app: e2e.apps[plan.app]?.url ?? "", production: e2e.production }))
}

// the folder's round files, by number.
async function roundsIn($: EngineInterface, folder: string): Promise<{ rounds: string[]; names: Set<string> }> {
  const names = new Set((await $.fs.exists(folder)) ? (await $.fs.list(folder)).filter(e => e.kind === "file").map(e => e.name) : [])
  const rounds = [...names].map(n => /^round-(\d{2})\.mjs$/.exec(n)?.[1]).filter((n): n is string => n !== undefined).sort()
  return { rounds, names }
}

const lastRound = async ($: EngineInterface, folder: string) => (await roundsIn($, folder)).rounds.at(-1)

// a driver's round as its call starts: its check must be its own and
// driving (not handed to the user unanswered, not done), with time left and
// no round running; the file the highest round of the folder, not ended
// before, and the Bash timeout within the time left. Marked running; the
// check's clock starts if it was stopped. The round, or why it is refused.
async function egoRoundStart($: EngineInterface, run: Run, c: Ctx, agentId: string, command: string, input: Record<string, unknown>): Promise<{ round: string; check: string } | { deny: string }> {
  const k = run.e2e?.checks?.find(x => x.runner === agentId && isOpen(x))
  if (!k?.ego) return { deny: "this driver's check is closed; write nothing more. Report to the main session and stop." }
  if (k.ego.handoff !== undefined && !k.ego.resumed) return { deny: `check ${k.name}'s space is handed to the user (${k.ego.handoff}). Stop and answer \`넘김: ${k.ego.handoff}\`; the main session resumes you once they are done.` }
  if (k.ego.driven !== undefined) return { deny: `you called done() for check ${k.name}; a judge decides it now. Stop.` }
  if (k.running) return { deny: `a round of check ${k.name} is already running; wait for its result.` }
  const now = await $.clock.now()
  if (usedMs(k, now) >= k.minutes * 60_000) return { deny: await egoOver($, run, k.name, agentId, `ran past its ${k.minutes} minutes`) }
  const folder = `${c.dir}/${checkFolder(k)}`
  const form = roundCommand(command, folder, c.root)
  if ("deny" in form) return form
  const limit = roundLimitMs(k, now)
  if (typeof input.timeout !== "number" || input.timeout < 1000 || input.timeout > limit) return { deny: `give the round a Bash timeout (the timeout parameter) of at most ${limit} ms: check ${k.name} has that much time left, and one call waits at most 10 minutes.` }
  const { rounds, names } = await roundsIn($, folder)
  if (!rounds.includes(form.round)) return { deny: `${form.file} does not exist; write it first.` }
  if (rounds.at(-1) !== form.round) return { deny: `run the newest round, round-${rounds.at(-1)}.mjs: the harness names the evidence after it.` }
  const ended = Object.values(roundEnds(form.round)).find(f => names.has(f))
  if (ended) return { deny: `round ${form.round} already ended (${ended}); write round ${String(Number(form.round) + 1).padStart(2, "0")} instead.` }
  const marked = await mutate($, r => {
    const at = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === k.name && x.runner === agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !at?.ego || at.running) return undefined
    const resumed = at.ego.resumed ? { handoff: undefined, resumed: undefined } : {}
    const ego = { ...at.ego, ...resumed, returned: undefined, round: Number(form.round), since: at.ego.since ?? now }
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k.name ? { ...x, running: true as const, ego } : x)) } }
  })
  if (!marked) return { deny: `check ${k.name}'s round is already running, or the check closed.` }
  return { round: form.round, check: k.name }
}

// right after a driver's round: how it ended (the files the harness left
// for its round, the output), the check's clock, and what the driver does
// next. A round past its Bash timeout leaves its script running inside ego
// (measured), so the hook closes the space and the next round opens it
// afresh. A lost space gets a new attempt once; a second loss closes the
// check with no verdict, as a run past its time does.
async function egoCaptured($: EngineInterface, run: Run, name: string, round: string, agentId: string, result: ToolCallResult): Promise<ToolCallResult> {
  const record = (typeof result.result === "object" && result.result !== null ? result.result : {}) as Record<string, unknown>
  const output = await bashOutput($, result)
  const timedOut = record.timedOutAfterMs !== undefined
  const c = await ctxOf($, run)
  const k = run.e2e?.checks?.find(x => x.name === name)
  if (!k?.ego) return withContext(result, `check ${name} is gone from the run; this result is not used. Report to the main session and stop.`)
  const folder = `${c.dir}/${checkFolder(k)}`
  const { names } = await roundsIn($, folder)
  const ends = roundEnds(round)
  const read = async (f: string) => (names.has(f) ? (JSON.parse(await $.fs.read(`${folder}/${f}`).catch(() => "{}")) as Record<string, unknown>) : undefined)
  const lost = names.has(ends.lost)
  const handoff = await read(ends.handoff).catch(() => ({ what: "(the harness wrote no reason)" }))
  const done = await read(ends.done).catch(() => ({ summary: "" }))
  if (timedOut) {
    await egoRun($, closeScript(oneSpace(k.ego.space)))
    await $.fs.write(`${folder}/${REOPEN_MARK}`, "")
  }
  const now = await $.clock.now()
  const stop = (ego: EgoCheck) => ({ ...ego, spentMs: usedMs({ ...k, ego }, now), since: undefined })
  const next = lost && (k.ego.lost ?? 0) === 0 ? await shotFolder($, c.dir, name) : undefined
  let outcome = ""
  const moved = await mutate($, r => {
    const at = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === name && x.runner === agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !at?.ego) return undefined
    let ego: EgoCheck = at.ego
    let patch: Partial<CheckRun> = {}
    if (handoff) {
      ego = { ...stop(ego), handoff: String(handoff.what ?? "") }
      outcome = "handoff"
    } else if (done) {
      ego = { ...stop(ego), driven: String(done.summary ?? "") }
      outcome = "done"
    } else if (lost && next) {
      ego = { ...ego, lost: (ego.lost ?? 0) + 1, space: spaceName(r.runId, name, next), round: undefined }
      patch = { evidence: next }
      outcome = "attempt"
    } else if (lost) {
      ego = { ...stop(ego), lost: (ego.lost ?? 0) + 1 }
      patch = { over: true }
      outcome = "lost"
    }
    const checks = r.e2e.checks.map(x => (x.name === name ? { ...x, ...patch, running: undefined, ego } : x))
    return { ...r, e2e: { ...r.e2e, checks } }
  })
  if (!moved) return withContext(result, `check ${name} closed or the run moved on while the round ran; this result is not used. Report to the main session and stop.`)
  await trace($, run, { ev: "capture", stage: "qa-integration", check: name, agentId, round, outcome: outcome || roundOutcome(output).kind, timedOut })
  const after = moved.e2e?.checks?.find(x => x.name === name)!
  if (outcome === "lost") {
    const settled = await egoSettle($)
    return withContext(result, `check ${name}'s ego space was lost a second time (the ego browser closed?), so the check is closed with no verdict, as an environment problem. Write nothing. ${await egoSettledLine($, moved, settled)}`)
  }
  if (outcome === "handoff") return withContext(result, `The hook recorded the hand-off of check ${name}; its time stops. Stop now and answer \`넘김: ${after.ego!.handoff}\`. The main session asks the user and resumes you when they are done.`)
  if (outcome === "done") return withContext(result, `The hook recorded done() for check ${name}; its time stops. Stop now and answer \`완료: ${after.ego!.driven}\`. A rein:ego-judge decides it from the evidence.`)
  if (outcome === "attempt") {
    const plan = planCheck(moved, after, undefined)
    const frozen = await frozenConfigs($, moved)
    const e2e = "problem" in frozen ? undefined : (moved.repos ?? []).map(r => frozen.configs[r]?.e2e).find(x => x !== undefined)
    const fresh = `${c.dir}/${checkFolder(after)}`
    if (e2e) await writeHarness($, fresh, after, e2e, plan)
    return withContext(result, `check ${name}'s ego space is gone (the ego browser was closed?). The hook started attempt ${attemptOf(fresh)} in a new space: write round-01.mjs in ${fresh}, its first line now exactly:\n${importLine(fresh)}\nStart over from opening the app; the earlier folder's evidence does not count.`)
  }
  const limit = roundLimitMs(after, now)
  if (usedMs(after, now) >= after.minutes * 60_000) return withContext(result, await egoOver($, moved, name, agentId, `ran past its ${after.minutes} minutes`))
  const said = timedOut
    ? "The round ran past its Bash timeout. Its script goes on inside ego otherwise, so the hook closed the check's space; the next round opens it afresh (log in again if needed)."
    : (() => {
        const o = roundOutcome(output)
        return o.kind === "user" ? "The user holds the space now (ego refused the round). Wait a minute, then run the same round file again."
          : o.kind === "error" ? `The round's script failed (exit code ${o.code}): an error in your code, not the app's. Fix it in the next round.`
            : "The round ran. Write the next round, or end with done() once every part has its evidence."
      })()
  return withContext(result, `${said} Check ${name} has ${Math.floor(limit / 1000)} s of round time left; give the next call a Bash timeout of at most ${limit} ms.`)
}

// check name ran out of time: the hook closes its space (its script
// would run on inside ego) and the check with no verdict (D101 once none is
// open). What the driver is told.
async function egoOver($: EngineInterface, run: Run, name: string, agentId: string, why: string): Promise<string> {
  const k = run.e2e?.checks?.find(x => x.name === name)
  if (k?.ego) await egoRun($, closeScript(oneSpace(k.ego.space)))
  const now = await $.clock.now()
  const moved = await mutate($, r => {
    const at = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === name && x.runner === agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !at?.ego) return undefined
    const ego = { ...at.ego, spentMs: usedMs(at, now), since: undefined }
    return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === name ? { ...x, over: true as const, running: undefined, ego } : x)) } }
  })
  if (!moved) return `check ${name} is already closed. Write nothing; report to the main session and stop.`
  await trace($, run, { ev: "capture", stage: "qa-integration", check: name, agentId, over: true })
  const settled = await egoSettle($)
  return `check ${name} ${why} and is closed with no verdict; the hook closed its ego space. Write nothing. ${await egoSettledLine($, (await getRun($)) ?? moved, settled)}`
}

// once no ego check is open, settleEgo's outcome goes into the run.
async function egoSettle($: EngineInterface): Promise<ReturnType<typeof settleEgo>> {
  let settled: ReturnType<typeof settleEgo>
  await mutate($, r => {
    if (r?.stage !== "qa-integration" || r.e2e?.path !== "ego" || !r.e2e.checks || r.e2e.written !== undefined) return undefined
    settled = settleEgo(r.e2e.checks)
    return settled ? settledRun(r, r.e2e.checks, settled) : undefined
  })
  return settled
}

// right after a judge wrote its check's judge.md: the form, and every file
// a passed part cites must be in the check's folder (else it writes it
// again). 증거 부족
// the first time sends the check back to its driver for what is missing;
// the second time it is 실패. A pass closes the check's space; a failure
// keeps it for the user to look at. Once no check is open, settleEgo.
async function egoJudged($: EngineInterface, c: Ctx, k: CheckRun, result: ToolCallResult): Promise<ToolCallResult> {
  const file = `${c.dir}/${judgeOf(k)}`
  const { names } = await roundsIn($, `${c.dir}/${checkFolder(k)}`)
  const judged = parseJudge(await $.fs.read(file), n => names.has(n))
  if ("problem" in judged) return withContext(result, `${file} was saved, but ${judged.problem} Write it again.`)
  const back = judged.verdict === "증거 부족" && (k.ego?.returns ?? 0) === 0
  const verdict: "통과" | "실패" = judged.verdict === "통과" ? "통과" : "실패"
  const observed = [...judged.parts, ...(judged.verdict === "증거 부족" ? ["(증거 부족이 두 번째라 실패로 봄)"] : [])].join(" / ")
  const folder = checkFolder(k)
  let settled: ReturnType<typeof settleEgo>
  const moved = await mutate($, r => {
    const at = r?.stage === "qa-integration" ? r.e2e?.checks?.find(x => x.name === k.name && x.ego?.judge === c.agentId && isOpen(x)) : undefined
    if (!r?.e2e?.checks || !at?.ego) return undefined
    if (back) {
      const ego: EgoCheck = { ...at.ego, driven: undefined, judge: undefined, returned: judged.missing ?? "", returns: 1 }
      return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k.name ? { ...x, ego } : x)) } }
    }
    const cited = judged.cited.map(f => `${folder}/${f}`)
    const next: CheckRun = { ...at, running: undefined, verdict, observed, session: at.ego.space, cited, shots: cited.filter(f => /\.png$/i.test(f)), ego: { ...at.ego, parts: judged.parts } }
    const checks = r.e2e.checks.map(x => (x.name === k.name ? next : x))
    settled = settleEgo(checks)
    // a layout check counts its screen's differences in a row.
    const id = layoutIdOf(k.name)
    const layoutFails = isLayoutCheck(k.name) ? { ...r.layoutFails, [id]: verdict === "통과" ? 0 : (r.layoutFails?.[id] ?? 0) + 1 } : r.layoutFails
    return { ...settledRun(r, checks, settled), passed: remember(r, next), layoutFails }
  })
  if (!moved) return withContext(result, `check ${k.name} closed or the run moved on; this judgment is not used. Report to the main session and stop.`)
  await trace($, c.run, { ev: "result", stage: "qa-integration", check: k.name, agentId: c.agentId, verdict: back ? "증거 부족" : verdict })
  if (back) return withContext(result, `check ${k.name}: 증거 부족, the first time, so it goes back to its driver ${k.runner} for what is missing. Report this to the main session and stop: it sends the driver what is missing with SendMessage (mcp__rein__status gives it).`)
  if (verdict === "통과") {
    if (isLayoutCheck(k.name)) await tickLayoutBox($, c.dir, layoutIdOf(k.name))
    else await tickBox($, c.dir, k.name, egoTick(k))
    await egoRun($, closeScript(oneSpace(k.ego!.space)))
  }
  const why = judged.verdict === "증거 부족" ? " (증거 부족 a second time counts as 실패)" : ""
  const toDevNote = await layoutsBack($, c.dir, moved, settled)
  return withContext(result, `check ${k.name}: 판정: ${verdict}${why}. ${toDevNote ?? (await egoSettledLine($, moved, settled))}`)
}

// a runner that ended without its check's result (it failed, was stopped,
// or answered without writing it) leaves the check to a new one: its claim
// goes, the minutes it spent stay. A check still being claimed is not
// touched, and when the engine cannot list its agents nothing is.
// On the ego path a driver counts only while it drives: one that handed its
// space off, called done() or waits to collect what its judge found missing
// is idle on purpose, for the main session to resume; a driver's clock stops
// when it is reaped. A judge that ended without its judge.md frees its check
// for another judge.
async function reapRunners($: EngineInterface): Promise<void> {
  const run = await getRun($)
  const idle = (k: CheckRun) => k.ego !== undefined && (k.ego.driven !== undefined || k.ego.handoff !== undefined || k.ego.returned !== undefined)
  const held = run?.e2e?.checks?.filter(k => isOpen(k) && k.runner !== undefined && !k.runner.startsWith("claim:") && !idle(k)) ?? []
  const judging = run?.e2e?.checks?.filter(k => isOpen(k) && k.ego?.judge !== undefined && !k.ego.judge.startsWith("claim:")) ?? []
  if (!run || held.length + judging.length === 0) return
  let alive: Set<string>
  try {
    alive = new Set((await $.agent.list()).filter(a => !["completed", "failed", "killed"].includes(a.status)).map(a => a.id))
  } catch {
    return
  }
  const gone = new Map(held.filter(k => !alive.has(k.runner!)).map(k => [k.name, k.runner!]))
  const judges = new Map(judging.filter(k => !alive.has(k.ego!.judge!)).map(k => [k.name, k.ego!.judge!]))
  if (gone.size + judges.size === 0) return
  const now = await $.clock.now()
  const moved = await mutate($, r => {
    const freed = (k: CheckRun) => isOpen(k) && gone.get(k.name) === k.runner && !idle(k)
    const unjudged = (k: CheckRun) => isOpen(k) && k.ego?.judge !== undefined && judges.get(k.name) === k.ego.judge
    if (!r?.e2e?.checks?.some(k => freed(k) || unjudged(k))) return undefined
    return {
      ...r,
      e2e: {
        ...r.e2e,
        checks: r.e2e.checks.map(k =>
          freed(k) ? { ...k, runner: undefined, running: undefined, ...(k.ego ? { ego: { ...k.ego, spentMs: usedMs(k, now), since: undefined } } : {}) }
            : unjudged(k) ? { ...k, ego: { ...k.ego!, judge: undefined } } : k),
      },
    }
  })
  if (moved) await trace($, moved, { ev: "reap", stage: moved.stage, checks: [...gone.keys()], agents: [...gone.values()], judges: [...judges.keys()] })
}

// each file's SHA-256 (of its bytes as base64) as it is now, "gone"
// when it does not exist, "unreadable" when it cannot be read.
async function sealOf($: EngineInterface, files: string[]): Promise<Seal> {
  const out: Seal = {}
  for (const f of files) {
    if (!(await $.fs.exists(f))) out[f] = "gone"
    else out[f] = await $.fs.read(f, { as: "bytes" }).then(b => sha256Text(b.base64), () => "unreadable")
  }
  return out
}

// a copy of each sealed file as it is now, under agent/sealed/ by its
// seal value: a pass rests on the files as they were, and rein:impact is
// given the diff from that copy once they change.
const copyOf = (dir: string, hash: string) => `${dir}/agent/sealed/${hash}.txt`
async function keepCopies($: EngineInterface, dir: string, seal: Seal): Promise<void> {
  for (const [file, hash] of Object.entries(seal)) {
    if (hash === "gone" || hash === "unreadable" || (await $.fs.exists(copyOf(dir, hash)))) continue
    await $.fs.read(file).then(text => $.fs.write(copyOf(dir, hash), text), () => undefined)
  }
}

// the files dev hands on: the planned files and the handoff files.
const sealFiles = (run: Run, handoffDir: string) => [...(run.planFiles ?? []), ...(run.handoff ?? []).map(h => `${handoffDir}/${h}`)]

// the paths whose value differs from the seal, measured now.
async function broken($: EngineInterface, seal: Seal): Promise<{ changed: string[]; now: Seal }> {
  const now = await sealOf($, Object.keys(seal))
  return { changed: Object.keys(seal).filter(p => seal[p] !== now[p]), now }
}

// the main session is never refused, and what it changes past a judgment
// does not move the run either: the ground of each judgment is measured
// at each judgment (advance, a judged file, resume) and right after the
// main session's writes and commands, and each change is told once (told
// keeps its key). 1-spec.md and 2-plan.md against what was frozen, the
// planned and handoff files against dev's seal.
// Whether the run goes back is the main session's to decide, with goto.
async function drifted($: EngineInterface): Promise<string[]> {
  const run = await getRun($)
  if (!run) return []
  const c = await ctxOf($, run)
  const text = async (name: string) => {
    const path = `${c.dir}/${name}`
    return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  }
  // line endings alone are no change (an editor's rewrite, eol).
  const differs = (now: string | undefined, frozen: string) => now === undefined || eol(now) !== eol(frozen)
  const found: { key: string; line: string }[] = []
  const spec = run.frozen?.spec
  const specNow = await text("1-spec.md")
  if (run.stage !== "spec" && spec !== undefined && differs(specNow, spec)) {
    found.push({ key: `1-spec.md ${specNow === undefined ? "gone" : eol(specNow)}`, line: `${c.dir}/1-spec.md changed after the user approved it; what plan and later judged rests on the approved text. The run stays in ${run.stage}. To have it approved again, call mcp__rein__goto with stage spec.` })
  }
  const plan = run.frozen?.plan
  const planNow = await text("2-plan.md")
  if (run.stage !== "spec" && run.stage !== "plan" && plan !== undefined && differs(planNow, plan)) {
    found.push({ key: `2-plan.md ${planNow === undefined ? "gone" : eol(planNow)}`, line: `${c.dir}/2-plan.md changed after it passed; the run still holds the design as it passed (its files, repositories and e2e checks). The run stays in ${run.stage}. To take the new design, call mcp__rein__goto: for any stage after plan the hook reads 2-plan.md again (dev to build it, qa-integration when only the checks changed).` })
  }
  const sealed = run.sealed
  if (sealed && SEALED.has(run.stage) && !run.finished) {
    const { changed, now } = await broken($, sealed)
    if (changed.length > 0) found.push({ key: `sealed ${changed.map(p => `${p} ${now[p]}`).join(" ")}`, line: `these files changed after dev passed: ${changed.join(", ")}. What review and later judged rests on them as they were. The run stays in ${run.stage}; mcp__rein__goto with stage review has them reviewed again.` })
  }
  const keyed = await Promise.all(found.map(async f => ({ ...f, key: await sha256Text(f.key) })))
  const fresh = keyed.filter(f => !(run.told ?? []).includes(f.key))
  if (fresh.length === 0) return []
  await mutate($, r => (r?.runId === run.runId ? { ...r, told: [...(r.told ?? []), ...fresh.map(f => f.key)] } : undefined))
  await trace($, run, { ev: "drift", stage: run.stage, told: fresh.map(f => f.line) })
  return fresh.map(f => f.line)
}

// A line added to a result, or to its refusal.
const noticed = (result: ToolCallResult, line: string): ToolCallResult =>
  result.deny !== undefined ? ({ ...result, deny: `${result.deny} ${line}` } as ToolCallResult) : withContext(result, line)

// The run file a stage judges after its write went through. The main
// session is told first what changed past a judgment; a Rein agent is not,
// so the main session still hears it.
async function judge($: EngineInterface, c: Ctx, file: string, result: ToolCallResult): Promise<ToolCallResult> {
  const changed = c.agentId === undefined ? await drifted($) : []
  return changed.reduce(noticed, await judgeFile($, c, file, result))
}

async function judgeFile($: EngineInterface, c: Ctx, file: string, result: ToolCallResult): Promise<ToolCallResult> {
  const judged = c.run.stage === "qa-integration" && c.run.e2e?.path === "ego" ? c.run.e2e.checks?.find(k => k.ego?.judge === c.agentId && isOpen(k)) : undefined
  if (judged && file === judgeOf(judged)) return egoJudged($, c, judged, result)
  const check = c.run.stage === "qa-integration" && c.run.e2e?.path !== "ego" ? runnerCheck(c.run, c.agentId) : undefined
  if (check && file === resultOf(check)) return runnerResult($, c, check, result)
  if (c.run.stage === "spec" && file === "agent/grade.md") return gradeExit($, c, result)
  if (c.run.stage === "spec" && file === "1-mockup.html") return sketchExit($, c, result)
  if (c.run.stage === "spec" && file === SPEC_VERDICT) return layoutVerifyExit($, c, result)
  if (c.run.stage === "dev" && file === "agent/dev-items.md") return devExit($, c, result)
  if (c.run.stage === "dev" && file === "agent/deviation.md") return deviationExit($, c, result)
  if (c.run.stage === "review" && file === "agent/review.md") return reviewExit($, c, result)
  if (c.run.stage === "review" && file === GROUPS_FILE) return groupsExit($, c, result)
  const group = c.run.stage === "review" ? (c.run.reviewGroups ?? []).findIndex((_, i) => file === groupFile(i + 1)) : -1
  if (group >= 0) return groupExit($, c, group + 1, result)
  if (c.run.stage === "qa" && file === "agent/qa.md") return qaExit($, c, result)
  if (c.run.stage === "qa" && file === IMPACT_FILE && c.agentId !== undefined && c.run.impact?.agent === c.agentId) return impactExit($, c, result)
  if (c.run.stage === "qa-integration" && file === "agent/e2e.md") return integrationExit($, c, result)
  return result
}

// a source write in dev is recorded before it runs, so the dev-items.md
// judgment counts writes still in flight. "new" when this call added it,
// "kept" when it was there, "left" when the run left dev meanwhile (refuse).
async function recordWrite($: EngineInterface, c: Ctx, path: string): Promise<"new" | "kept" | "left"> {
  const out: { state: "new" | "kept" | "left" } = { state: "left" }
  await mutate($, r => {
    if (r?.stage !== "dev") return undefined
    if (r.writes.some(w => same(w, path))) {
      out.state = "kept"
      return undefined
    }
    out.state = "new"
    return { ...r, writes: [...r.writes, path] }
  })
  if (out.state === "new") await trace($, c.run, { ev: "write", stage: "dev", path })
  return out.state
}

// A recorded write that did not land (refused, errored, or held for review)
// is taken back, only by the call that added it.
async function dropWrite($: EngineInterface, c: Ctx, path: string): Promise<void> {
  await mutate($, r => (r && r.writes.some(w => same(w, path)) ? { ...r, writes: r.writes.filter(w => !same(w, path)) } : undefined))
  await trace($, c.run, { ev: "write", stage: "dev", path, dropped: true })
}

// right after the grader's grade.md went through (its form was
// checked before): the hook scores it against 1-spec.md as it is now and
// records it; the grader is spent.
async function gradeExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const parsed = parseGrade(await $.fs.read(`${c.dir}/agent/grade.md`), DIMENSIONS.map(d => d.name))
  if (!parsed.ok) return withContext(result, `D175: ${parsed.reason} Write grade.md again.`)
  const text = await $.fs.read(`${c.dir}/1-spec.md`)
  const type = specType(text)
  if (type === undefined) return withContext(result, `1-spec.md lost its \`유형:\` line while it was graded, so the grade was not recorded. Put it back (${TYPES.join(", ")}) and spawn rein:grader again.`)
  const hash = await sha256Text(text)
  let grades: Run["grades"] = []
  const moved = await mutate($, r => {
    if (r?.stage !== "spec" || r.grader !== c.agentId) return undefined
    grades = [...(r.grades ?? []), scoreGrade(parsed.dims, text, type, hash, r.asked ?? 0)]
    return { ...r, grader: undefined, grades }
  })
  if (!moved) return withContext(result, "D175: the run left spec, or another grader took over, while this grade was on its way; it was not recorded. Stop.")
  const grade = grades.at(-1)!
  await trace($, moved, { ev: "grade", stage: "spec", agentId: c.agentId, ambiguity: grade.ambiguity, asked: grade.asked, dims: grade.dims })
  return withContext(result, gradeSummary(grades, text))
}

// right after the sketcher's 1-mockup.html went through: the hook records
// which 1-spec.md it drew and what it wrote, so advance can tell when the
// picture is older than the spec.
async function sketchExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const html = await $.fs.read(`${c.dir}/1-mockup.html`)
  const sketched = { spec: await sha256Text(await $.fs.read(`${c.dir}/1-spec.md`)), html: await sha256Text(html) }
  const moved = await mutate($, r => (r?.stage === "spec" && r.sketcher === c.agentId ? { ...r, sketched } : undefined))
  if (!moved) return result
  await trace($, moved, { ev: "sketch", stage: "spec", agentId: c.agentId })
  const line = await checkSketch($, c.dir, html, sketched.html)
  return line === undefined ? result : withContext(result, line)
}

// a to-be drawn from a planning-document picture is rendered and compared
// with it: the hook renders each such screen and has the main
// session spawn rein:layout-verifier. What the main session is told, or
// undefined when no to-be screen names a picture.
async function checkSketch($: EngineInterface, dir: string, html: string, hash: string): Promise<string | undefined> {
  const sources = toBeSources(html)
  const ids = Object.keys(sources)
  if (ids.length === 0) {
    await mutate($, r => (r?.stage === "spec" && r.sketchCheck ? { ...r, sketchCheck: undefined } : undefined))
    return undefined
  }
  const rendered = await renderMockup($, `${dir}/1-mockup.html`, `${dir}/${MOCKUP_SHOTS}`, ids)
  const shots = "shots" in rendered ? Object.fromEntries(Object.keys(rendered.shots).map(id => [id, `${MOCKUP_SHOTS}/${id}.png`])) : {}
  const why = "error" in rendered ? rendered.error : rendered.missing.length > 0 ? `the to-be of ${rendered.missing.map(m => `#${m}`).join(", ")} rendered nothing` : undefined
  const state = why === undefined ? "pending" : "unrendered"
  const moved = await mutate($, r => (r?.stage === "spec" ? { ...r, sketchCheck: { html: hash, sources, shots, state, fails: r.sketchCheck?.fails ?? 0, ...(why ? { why } : {}) } } : undefined))
  if (moved) await trace($, moved, { ev: "sketch-check", stage: "spec", state, screens: ids, ...(why ? { why } : {}) })
  if (why !== undefined) return `The to-be of ${ids.map(i => `#${i}`).join(", ")} is drawn from a planning-document picture, but the hook could not render it to compare (${why}), so the layout is not checked against the picture. Tell the user in one line, and go on.`
  return `The to-be of ${ids.map(i => `#${i}`).join(", ")} is drawn from a planning-document picture. Spawn ${LAYOUT_VERIFIER} (a short prompt does: the hook writes its task) to compare each with its picture, before you call mcp__rein__advance.`
}

// the approval's word on the layout check of the drawing as it is.
function sketchLine(check: Run["sketchCheck"], visual: string): string {
  if (check === undefined) return ""
  const verdict = `${visual.slice(0, visual.lastIndexOf("/"))}/${SPEC_VERDICT}`
  if (check.state === "match") return " 기획서 그림과 배치 비교: 맞음."
  if (check.state === "given-up") return ` 주의: 기획서 그림과 배치가 ${check.fails}번 연달아 달라 다시 그리기를 멈췄습니다. 다른 곳: ${verdict}`
  if (check.state === "unrendered") return ` 주의: 목업을 렌더링하지 못해 기획서 그림과 배치를 비교하지 않았습니다 (${check.why}).`
  return " 주의: 기획서 그림과 배치 비교가 끝나지 않았습니다."
}

// renders the to-be of screens of a 1-mockup.html with a headless Chrome
// (hooks/render-mockup.js): the PNG and measurement of each, by id, or why not.
async function renderMockup($: EngineInterface, html: string, out: string, ids: string[]): Promise<{ shots: Record<string, { png: string; boxes: string }>; missing: string[] } | { error: string }> {
  try {
    const r = await $.process.run(["node", `${slash($.plugin.root)}/hooks/render-mockup.js`, html, out, ...ids], { timeoutMs: 120_000 })
    const last = r.stdout.trim().split(/\r?\n/).at(-1) ?? ""
    const said = JSON.parse(last) as { shots?: { id: string; png: string; boxes: string }[]; missing?: string[]; error?: string }
    if (said.error !== undefined || said.shots === undefined) return { error: said.error ?? `render-mockup.js exited ${r.exitCode}` }
    return { shots: Object.fromEntries(said.shots.map(s => [s.id, { png: s.png, boxes: s.boxes }])), missing: said.missing ?? [] }
  } catch (err) {
    return { error: String(err) }
  }
}

// the to-be of each screen of `## 배치 대조`, rendered for the worker to
// build from: its PNG relative to the run, by id; a screen that did not
// render has none, and the worker reads 1-mockup.html alone.
async function toBeShots($: EngineInterface, dir: string, layouts: Layout[]): Promise<Record<string, string>> {
  if (layouts.length === 0) return {}
  const rendered = await renderMockup($, `${dir}/1-mockup.html`, `${dir}/${MOCKUP_SHOTS}`, layouts.map(l => l.anchor))
  return "shots" in rendered ? Object.fromEntries(Object.keys(rendered.shots).map(id => [id, `${MOCKUP_SHOTS}/${id}.png`])) : {}
}

// rein:layout-verifier in spec, while the last to-be waits for its
// comparison: it runs in the foreground on the hook's task, the rendered
// to-be and the pictures, nothing of the conversation.
async function spawnLayoutVerifier($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const check = run.sketchCheck
  if (run.stage !== "spec" || check?.state !== "pending") return { deny: `${LAYOUT_VERIFIER} compares a to-be of 1-mockup.html with its planning-document picture only when the hook asks for it in spec, after the sketcher drew it.` }
  const dir = await folderOf($, "active", run.runId)
  // the mockup's other to-be screens, which may draw part of the same picture.
  const rest = toBeScreens(await $.fs.read(`${dir}/1-mockup.html`)).filter(id => check.shots[id] === undefined)
  const others = rest.length === 0 ? {} : await toBeShots($, dir, rest.map(anchor => ({ anchor, page: "", route: "", look: "" })))
  const result = await next({ ...e, prompt: specVerifierTask(dir, check.shots, check.sources, others), background: false })
  if (result.deny !== undefined || result.agentId === undefined) return result
  const agentId = result.agentId
  reinAgents.add(agentId)
  layoutVerifiers.add(agentId)
  try {
    const moved = await mutate($, r => (r?.stage === "spec" && r.sketchCheck?.state === "pending" ? { ...r, sketchCheck: { ...r.sketchCheck, agent: agentId } } : undefined))
    if (moved) await trace($, moved, { ev: "spawn", stage: "spec", agent: LAYOUT_VERIFIER, agentId })
  } catch (err) {
    // The agent started; without its id recorded its verdict is refused.
    await trace($, run, { ev: "error", stage: "spec", agent: LAYOUT_VERIFIER, agentId, error: String(err) })
  }
  return result
}

// right after the verifier's layout-verify.md went through: every screen
// matches, or the sketcher draws again with what differs, or, the
// GIVE_UP_AT-th drawing in a row differing, the hook stops and the
// differences go to the approval.
async function layoutVerifyExit($: EngineInterface, c: Ctx, result: ToolCallResult): Promise<ToolCallResult> {
  const check = c.run.sketchCheck
  if (check === undefined || check.agent !== c.agentId || check.state !== "pending") return result
  const parsed = parseLayoutVerdict(await $.fs.read(`${c.dir}/${SPEC_VERDICT}`), Object.keys(check.shots))
  if ("problem" in parsed) return withContext(result, `${SPEC_VERDICT} was not taken: ${parsed.problem}. Write it again.`)
  const differ = parsed.verdicts.filter(v => !v.match)
  const fails = differ.length === 0 ? 0 : check.fails + 1
  const state = differ.length === 0 ? "match" : fails >= GIVE_UP_AT ? "given-up" : "differ"
  const moved = await mutate($, r => (r?.stage === "spec" && r.sketchCheck !== undefined && r.sketchCheck.agent === c.agentId ? { ...r, sketchCheck: { ...r.sketchCheck, agent: undefined, state, fails } } : undefined))
  if (!moved) return withContext(result, "The run left spec, or the drawing changed, while this comparison was on its way; it was not recorded. Stop.")
  await trace($, moved, { ev: "sketch-verdict", stage: "spec", agentId: c.agentId, state, fails, differ: differ.map(v => v.id) })
  if (state === "match") return withContext(result, "Every to-be drawn from a planning-document picture matches its picture. Go on.")
  const where = differ.map(v => `#${v.id}: ${v.diffs.join("; ")}`).join(" / ")
  if (state === "given-up") return withContext(result, `${GIVE_UP_AT} drawings in a row differ from the planning-document picture (${where}). The hook stops redrawing: tell the user what still differs, in one line per screen; the approval names ${SPEC_VERDICT} too. Then go on.`)
  return withContext(result, `The to-be differs from the planning-document picture (${where}). Spawn ${SKETCHER} with to-be in the description again: the hook gives it ${SPEC_VERDICT}. Its drawing is compared again.`)
}

// the sketcher draws 1-mockup.html in spec, on the hook's task: the mode
// from the Agent call's description, the main session's prompt dropped, so
// nothing of the conversation reaches it. The last one spawned is recorded
// and the only one that writes.
async function spawnSketcher($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  if (run.stage !== "spec") return { deny: `${SKETCHER} draws 1-mockup.html in the spec stage only; the run is in ${run.stage}.` }
  const mode = sketchMode(e.description)
  if (mode === undefined) return { deny: `name the mode in the Agent call's description, as-is (before the questions) or to-be (once the grading is over), one of them: the hook drops the prompt, so the description is the only place it is read from.` }
  const dir = await folderOf($, "active", run.runId)
  if (!(await $.fs.exists(`${dir}/1-spec.md`))) return { deny: `${dir}/1-spec.md does not exist yet. Write it, then spawn ${SKETCHER}.` }
  // a to-be that came out different from its planning-document picture is
  // drawn again with what differs.
  const check = run.sketchCheck
  const redraw = mode === "to-be" && check?.state === "differ" ? redrawLines(dir, check.fails, Object.keys(check.shots).map(id => `${MOCKUP_SHOTS}/${id}.boxes.txt`)) : []
  const prompt = await withKnowledge($, sketcherTask(dir, mode, redraw), SKETCHER_USE, run)
  const result = await next({ ...e, prompt, background: false })
  if (result.deny !== undefined || result.agentId === undefined) return result
  const agentId = result.agentId
  reinAgents.add(agentId)
  sketchers.add(agentId)
  try {
    const moved = await mutate($, r => (r?.stage === "spec" ? { ...r, sketcher: agentId } : undefined))
    if (moved) await trace($, moved, { ev: "spawn", stage: "spec", agent: SKETCHER, agentId, mode })
  } catch (err) {
    // The agent started; without its id recorded its 1-mockup.html is refused.
    await trace($, run, { ev: "error", stage: "spec", agent: SKETCHER, agentId, error: String(err) })
  }
  return result
}

// rein:impact, while work qa waits for its judgment: it runs in the
// foreground on the hook's task, the checks in question with their diff.
async function spawnImpact($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const impact = run.impact
  if (run.stage !== "qa" || !impact || impact.verdicts || !run.qaVisit?.passed) return { deny: `${IMPACT} judges only while work qa waits for it (mcp__rein__status shows \`e2e impact:\`); the run is in ${run.stage}.` }
  const c = await ctxOf($, run)
  const doubt = doubtful(run).filter(d => impact.doubt.includes(d.name))
  const result = await next({ ...e, prompt: impactTask(c.dir, run.checks ?? [], doubt), background: false })
  if (result.deny !== undefined || result.agentId === undefined) return result
  const agentId = result.agentId
  reinAgents.add(agentId)
  try {
    const moved = await mutate($, r => (r?.stage === "qa" && r.impact && !r.impact.verdicts ? { ...r, impact: { ...r.impact, agent: agentId } } : undefined))
    if (moved) await trace($, moved, { ev: "spawn", stage: "qa", agent: IMPACT, agentId })
  } catch (err) {
    // The agent started; without its id recorded its impact.md is refused.
    await trace($, run, { ev: "error", stage: "qa", agent: IMPACT, agentId, error: String(err) })
  }
  return result
}

// a grader is spawned only for a 1-spec.md that exists, names its 유형
// and changed since its last grade. The deny text, or undefined.
async function graderRefusal($: EngineInterface, run: Run): Promise<string | undefined> {
  const path = `${await folderOf($, "active", run.runId)}/1-spec.md`
  if (!(await $.fs.exists(path))) return `D175: ${path} does not exist yet. Write it, then spawn rein:grader.`
  const text = await $.fs.read(path)
  if (specType(text) === undefined) return `1-spec.md has no \`유형:\` in its front matter, one of ${TYPES.join(", ")}; the grader scores by it. Add it, then spawn rein:grader.`
  const last = run.grades?.at(-1)
  if (last?.hash === (await sha256Text(text))) {
    return `D175: 1-spec.md has not changed since its last grade (ambiguity ${last.ambiguity}); grading it again gives nothing new. Revise it first, or call mcp__rein__advance.`
  }
  return undefined
}

// the main session asks the user one question per call, at most EVERY
// between grades; no cap in all: the user ends the questions by saying it is
// enough. Counted once it was answered.
async function askGate($: EngineInterface, run: Run, input: Record<string, unknown>, go: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const questions = Array.isArray(input.questions) ? input.questions : []
  const asked = run.asked ?? 0
  let deny: string | undefined
  if (questions.length !== 1) deny = `D175: ask the user one question per call; this call has ${questions.length}.`
  else if (asked - (run.grades?.at(-1)?.asked ?? 0) >= EVERY) {
    deny = `D175: ${EVERY} questions since the last grade. Write the answers into 1-spec.md and spawn rein:grader before the next question.`
  }
  if (deny !== undefined) {
    await trace($, run, { ev: "tool", stage: "spec", tool: "AskUserQuestion", decision: "deny", rule: "D175", deny })
    return { deny }
  }
  const result = await go()
  if (result.deny === undefined) {
    const moved = await mutate($, r => (r?.stage === "spec" ? { ...r, asked: (r.asked ?? 0) + 1 } : undefined))
    if (moved) await trace($, moved, { ev: "ask", stage: "spec", asked: moved.asked })
  }
  return result
}

// G3: the judge's task as the hook writes it. The author's own
// prompt never reaches a reviewer; the arbiter gets it only as a claim.
async function judgeTask($: EngineInterface, c: Ctx, prompt: string): Promise<string> {
  if (c.run.stage === "spec") return graderTask(c.dir, specType(await $.fs.read(`${c.dir}/1-spec.md`))!)
  if (c.run.stage === "dev") return arbiterTask(c.run, c.dir, prompt)
  if (c.run.stage === "review") return reviewTask(c.run, c.root, c.dir)
  const completion = completionLine(await $.fs.read(`${c.dir}/1-spec.md`)) ?? "(1-spec.md has no line under ## 완료 판정)"
  return completionTask(c.run, c.dir, completion)
}

// a split review (review.ts SPLIT_AT): the rein:review-splitter first,
// once, to group the files in review-groups.md; then one rein:reviewer per
// group still to judge, its prompt naming the group as `묶음 <n>`. Each runs in
// the foreground on the hook's task; a respawn replaces the one before.
async function spawnSplitReview($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const c = await ctxOf($, run)
  const planPath = `${c.dir}/2-plan.md`
  const plan = (await $.fs.exists(planPath)) ? await $.fs.read(planPath) : ""
  const splitter = e.subagentType === SPLITTER
  let n = 0
  if (splitter) {
    if (!splits(run)) return { deny: `this change has ${run.writes.length} changed files, too few to split: one rein:reviewer judges it. Spawn rein:reviewer.` }
    if (groupsCover(run, c.dir)) return { deny: `the change is already grouped in ${GROUPS_FILE}.${reviewNext(run, c.dir)}` }
  } else {
    if (!groupsCover(run, c.dir)) return { deny: reviewNext(run, c.dir).trim() }
    n = Number(/묶음\s*(\d+)/.exec(e.prompt ?? "")?.[1] ?? 0)
    if (!pendingGroups(run).includes(n)) return { deny: `name the group to review in the prompt, as \`묶음 <n>\`, one of those still to judge.${reviewNext(run, c.dir)}` }
  }
  const prompt = splitter ? splitterTask(run, c.root, c.dir, plan) : groupTask(run, c.root, c.dir, n, plan)
  const result = await next({ ...e, prompt, background: false })
  if (result.deny !== undefined || result.agentId === undefined) return result
  const agentId = result.agentId
  reinAgents.add(agentId)
  try {
    const moved = await mutate($, r => {
      if (r?.stage !== "review") return undefined
      if (splitter) return { ...r, splitter: agentId }
      if (!r.reviewGroups?.[n - 1]) return undefined
      return { ...r, reviewGroups: r.reviewGroups.map((g, i) => (i === n - 1 ? { ...g, reviewer: agentId } : g)) }
    })
    if (moved) await trace($, moved, { ev: "spawn", stage: "review", agent: e.subagentType, agentId, ...(splitter ? {} : { group: n }) })
  } catch (err) {
    // The agent started; without its id recorded its file is refused.
    await trace($, run, { ev: "error", stage: "review", agent: e.subagentType, agentId, error: String(err) })
  }
  return result
}

// 2-plan.md as it passed, while the run is back in plan on the spec it
// passed on; undefined on a first visit or after the spec was approved again.
const approvedPlan = (run: Run) =>
  run.frozen?.plan !== undefined && run.frozen.planSpec !== undefined && run.frozen.planSpec === run.frozen.spec ? run.frozen.plan : undefined

// a planner or test-planner spawned back in plan after the design passed
// changes only what the change needs; the test-planner gets the lines of
// 2-plan.md changed since it passed.
async function spawnRedesigner($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const approved = approvedPlan(run)
  if (approved === undefined) return next(e)
  const path = `${(await ctxOf($, run)).dir}/2-plan.md`
  const changed = e.subagentType === "rein:test-planner" ? lineDiff(approved, (await $.fs.exists(path)) ? await $.fs.read(path) : approved) : undefined
  return next({ ...e, prompt: `${e.prompt}\n\n${revisitNote(changed)}` })
}

// the design review in plan: a rein:reviewer judges 2-plan.md as it
// passes the form now, against the frozen rules its files bring in, and gives
// its verdict through mcp__rein__plan_review. A new one replaces the last.
async function spawnPlanReviewer($: EngineInterface, run: Run, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const c = await ctxOf($, run)
  if (!(await $.fs.exists(`${c.dir}/2-plan.md`))) return { deny: `${c.dir}/2-plan.md does not exist, so there is no design to review yet.` }
  const judged = await judgePlan($, c)
  if (!judged.ok) return { deny: `2-plan.md does not pass the hook's form yet (${judged.reason}), so it is not reviewed. Call mcp__rein__advance: it says what to fix.` }
  const rules = applicableRules(run.rules, judged.files, c.root, run.outside).map(r => ({ file: ruleFile(r), path: r.path }))
  const hash = await sha256Text(judged.plan)
  // back in plan after the design passed, on the spec it passed on: only
  // what changed since that approved 2-plan.md is reviewed.
  const approved = approvedPlan(run)
  const result = await next({ ...e, prompt: planReviewTask(c.dir, rules, approved !== undefined ? lineDiff(approved, judged.plan) : undefined), background: false })
  if (result.deny !== undefined || result.agentId === undefined) return result
  const agentId = result.agentId
  reinAgents.add(agentId)
  try {
    const moved = await mutate($, r => (r?.stage === "plan" ? { ...r, planReviewer: agentId, planReview: { hash, rules: rules.map(x => x.file) } } : undefined))
    if (moved) await trace($, moved, { ev: "spawn", stage: "plan", agent: "rein:reviewer", agentId, rules: rules.map(x => x.file) })
  } catch (err) {
    // The agent started; without its id recorded its verdict is refused.
    await trace($, run, { ev: "error", stage: "plan", agent: "rein:reviewer", agentId, error: String(err) })
  }
  return result
}

// the plan reviewer's verdict: kept with the 2-plan.md it judged, and one
// trace line with every part as it gave them.
async function planReview($: EngineInterface, input: Record<string, unknown>, agentId: string | undefined): Promise<ToolCallResult> {
  const run = await getRun($)
  if (!run) return { deny: "this session has no run open." }
  const review = run.planReview
  if (run.stage !== "plan" || agentId === undefined || run.planReviewer !== agentId || !review) {
    return { deny: `only the rein:reviewer the hook spawned for the design review in plan calls ${PLAN_REVIEW}, once. Report to the main session and stop.` }
  }
  const path = `${(await ctxOf($, run)).dir}/2-plan.md`
  const now = (await $.fs.exists(path)) ? await sha256Text(await $.fs.read(path)) : undefined
  if (now !== review.hash) {
    await trace($, run, { ev: "tool", stage: "plan", tool: PLAN_REVIEW, agentId, decision: "deny", reason: "2-plan.md changed" })
    return { deny: "2-plan.md changed since this review began, so a verdict would not be of the design as it stands. Report that to the main session and stop; it spawns a new review." }
  }
  const parsed = parsePlanVerdict(input, review.rules)
  if (!parsed.ok) {
    await trace($, run, { ev: "tool", stage: "plan", tool: PLAN_REVIEW, agentId, decision: "deny", reason: parsed.reason })
    return { deny: `${parsed.reason} The hook's rule list: ${review.rules.length > 0 ? review.rules.join(", ") : "none (give rules as [])"}. Call ${PLAN_REVIEW} again.` }
  }
  const verdict = { hash: now, pass: parsed.pass, ...(parsed.why ? { why: parsed.why } : {}) }
  const moved = await mutate($, r => (r?.stage === "plan" && r.planReviewer === agentId && r.planReview?.hash === now ? { ...r, planReview: undefined, planVerdicts: [...(r.planVerdicts ?? []), verdict] } : undefined))
  if (!moved) return { deny: "the run changed while the verdict was given, so nothing was recorded. Report to the main session and stop." }
  const verdicts = moved.planVerdicts ?? []
  await trace($, moved, { ev: "plan-review", stage: "plan", agentId, round: verdicts.length, hash: now, pass: parsed.pass, rules: input.rules, impact: input.impact, spec: input.spec })
  if (parsed.pass) return { result: "Recorded: 통과. Answer the main session with the outcome in one line and stop." }
  const failed = verdicts.filter(v => !v.pass).length
  return { result: `Recorded: 실패 (failed design reviews in this visit to plan: ${failed} of ${PLAN_REVIEWS}). Answer the main session with the outcome and each reason as you gave it, then stop.` }
}

// The plugin's own tools, answered by the hook itself; undefined for any other.
function ownTool($: EngineInterface, tool: string, input: Record<string, unknown>, agentId: string | undefined): Promise<ToolCallResult> | undefined {
  if (tool === OPEN_RUN) return openRun($, input)
  if (tool === PLAN_REVIEW) return planReview($, input, agentId)
  if (tool === ADVANCE) return advance($, input)
  if (tool === STATUS) return status($, input)
  if (tool === PARK) return park($, input)
  if (tool === RESUME) return resume($, input)
  if (tool === GOTO) return goTo($, input)
  return undefined
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e)
    await $.tool.register({
      name: "open_run",
      description:
        "Opens a Rein run for this session. Call it once from the rein:spec skill, with the slug from the rein:slug agent as runId. Refused when the session already has a run or the slug is taken by any run of this project (active, deferred, complete or dropped, here or on the hub). The result also lists this project's deferred runs.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "Slug: lowercase letters, digits, single hyphens." },
          autopilot: { type: "boolean", description: "true only when the user typed /rein:autopilot: the run does not stop for the user at 1-spec.md's and 2-plan.md's approval, the e2e run or the commit." },
        },
        required: ["runId"],
      },
    })
    await $.tool.register({
      name: "advance",
      description:
        `Moves the Rein run on, and where it takes a decision, on that decision: 1-spec.md's approval, a revised plan after a D62 return, a failure the hook stopped the run for, to send it to dev or plan (review, qa or qa-integration), a config that differs from HEAD (plan), a config changed since plan (qa), a qa rerun after the environment was fixed (qa), e2e configured but Aside unavailable (qa or qa-integration), a halted integration qa, a failed aside check (qa-integration), nothing left to commit (qa-integration), the commit (land), and the main session's own git commit. The hook asks no one: called without answer where a decision is needed, it changes nothing and says what is decided and which labels it takes. The user must answer 1-spec.md's approval and both commits: ask them with AskUserQuestion, and never pass an answer they did not give. The one exception is an autopilot run (status shows autopilot: on): where the hook's result says so, you pass 1-spec.md's or 2-plan.md's approval, the e2e run or the run's commit yourself, with said "autopilot". Every other decision is yours, with the user or on your own. answer is the label of the decision; the user's own words, when there are any, go in said. ${MOVES}`,
      inputSchema: {
        type: "object",
        properties: {
          answer: { type: "string", description: "The decision, exactly one of the labels advance named. Omit it until it is decided." },
          said: { type: "string", description: "The user's own words, when they answered; kept in the run's trace." },
        },
      },
    })
    await $.tool.register({
      name: "goto",
      description:
        "Moves the Rein run of this session to any stage, on your own judgment or the user's: back to plan to revise the design, on to land to accept the evidence as it is, qa-integration to run the integration entry again (from a halt, the checks that passed stay passed; refused while an integration check is still open), and so on. The stage starts as entering it would: past plan from the design as it passed, or as the hook reads 2-plan.md now when it changed since (refused when it does not pass); from review on, from the files dev hands on as they are now; qa-integration with its entry, run at once (the qa commands are skipped); land with the repositories whose planned files changed and their HEAD (refused when none changed). What the stages found or approved goes. The commit in land still needs the user's approval.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: GOTO_STAGES, description: "The stage to move the run to." },
          said: { type: "string", description: "The user's own words, when they asked for it; kept in the run's trace." },
        },
        required: ["stage"],
      },
    })
    await $.tool.register({
      name: "plan_review",
      description:
        "Gives the design review's verdict on 2-plan.md in the plan stage of a Rein run. Only the rein:reviewer the hook spawned for that review calls it, once, as its task says; the main session never does. The hook checks the form and records the verdict with the 2-plan.md it judged.",
      inputSchema: {
        type: "object",
        properties: {
          rules: {
            type: "array",
            description: "One entry per rule file the task lists, and no others; [] when it lists none.",
            items: {
              type: "object",
              properties: { file: { type: "string", description: "The rule file's name as the task lists it." }, verdict: { type: "string", enum: ["통과", "실패"] }, why: { type: "string", description: "On 실패: where in 2-plan.md and which rule sentence it breaks." } },
              required: ["file", "verdict"],
            },
          },
          impact: {
            type: "object",
            description: "Whether the design keeps every `유지` reason of 2-plan.md's ## 영향 범위.",
            properties: { verdict: { type: "string", enum: ["통과", "실패"] }, why: { type: "string", description: "On 실패: which line and how the design breaks its reason." } },
            required: ["verdict"],
          },
          spec: {
            type: "object",
            description: "Whether every requirement of 1-spec.md has a design item that carries it out.",
            properties: { verdict: { type: "string", enum: ["통과", "실패"] }, why: { type: "string", description: "On 실패: each requirement no item answers." } },
            required: ["verdict"],
          },
        },
        required: ["rules", "impact", "spec"],
      },
    })
    await $.tool.register({
      name: "status",
      description:
        "Shows the current Rein run: runId, stage, the design's files, frozen project rules and what later stages recorded. With no run open in this session, lists the runs of this project it can resume (deferred, or active in another session) and, when a hub server is set (~/.rein/sync.json), this project's runs on the hub with their links; with runId, it fetches that hub run's documents to a folder to read instead. It also shows whether the local frame server reaches the hub and what is not sent yet. Call it whenever you are unsure where the run stands.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "With no run open: the slug of a run on the hub, as status lists it, whose documents to fetch." },
        },
      },
    })
    await $.tool.register({
      name: "park",
      description:
        "Stops the Rein run of this session, in any stage: to put it aside (resumable later), drop it, or close it as done outside Rein (its change went in by the user's own commits). Called without answer, it changes nothing and says what it takes; decide with the user or on your own, then call again with answer set to the label of the decision and the user's own words, when there are any, in said. Repository files and the staging are left as they are. Refused while the hook is running a judgment's commands.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the user wants to stop, in a sentence." },
          answer: { type: "string", description: "The decision, exactly one of 보류, 폐기, 완료 (Rein 밖에서 반영함), 계속 진행. Omit it until it is decided." },
          said: { type: "string", description: "The user's own words, when they answered; kept in the run's trace." },
        },
        required: ["reason"],
      },
    })
    await $.tool.register({
      name: "resume",
      description:
        "Continues an earlier Rein run of this project in this session: a deferred run, an active one another session left open, or a resumable run on the hub (another PC's; a run past plan starts again from dev there, D222). Called without answer, it changes nothing and says what it takes; decide with the user or on your own, then call again with answer set to the label of the decision and the user's own words, when there are any, in said. Refused while this session has a run open (park it first). mcp__rein__status with no run open lists the candidates; the result names the rein skill to invoke next.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The slug of the run to resume, as status lists it." },
          answer: { type: "string", description: "The decision, exactly 이어서 진행 or 취소. Omit it until it is decided." },
          said: { type: "string", description: "The user's own words, when they answered; kept in the run's trace." },
        },
        required: ["runId"],
      },
    })
    // a run this session held before an update renamed the run files
    // (claude --resume after it).
    const run = await getRun($)
    if (run) await renameFiles($, (await ctxOf($, run)).dir)
    // the frame takes the run up again (claude --resume): session.start
    // carries no text to the main session, so a server started here is told
    // with the next result of a Rein tool (withFrameUrl).
    if (run) {
      await openFrame($, run).catch(() => {})
      await ensureFrame($, run)
    }
    // with a hub set, the local frame server is started or looks again,
    // and what it found at odds last time is toasted.
    const hub = await hubOf($)
    if (hub) {
      await kick($)
      const st = await hubState($, hub)
      const project = await projectName($)
      const [lost, conflicts] = [(st?.lost ?? []).filter(l => l.project === project).length, st?.conflicts?.length ?? 0]
      try {
        if (lost + conflicts > 0) $.ui.toast(`Rein: 서버와 어긋난 것이 있습니다(다른 PC가 가져간 run ${lost}건, 충돌 ${conflicts}건) — mcp__rein__status로 확인하세요`)
      } catch {}
    }
    return result
  })

  // the session takes its run's slug as its name through /rename, once
  // per run. The engine runs a command only after the turn, so the name
  // comes when the turn that opened or resumed the run ends. A rename seen
  // in this session keeps its name, one from before Rein loaded (--name, an
  // earlier launch) not. namedFor goes with a reload of this module (a
  // resume, an update of Rein), so the first run after one reads the name
  // from the transcript: no event a plugin gets under sec-default carries it.
  on("turn.complete", async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined || renamed) return out
    const run = await getRun($)
    if (run && namedFor === undefined && (await sessionTitle($)) === run.runId) namedFor = run.runId
    if (run && run.runId !== namedFor) {
      namedFor = run.runId
      // queued until the session is idle, so awaiting it here would wait on
      // this very turn.
      void $.command.run({ command: "rename", args: run.runId }).catch(() => {})
    }
    return out
  })

  // Rein's own /rename passes here too: any other name is the person's or
  // another plugin's.
  on("command.run", { command: "rename" }, async ($, e, next) => {
    if (e.args !== namedFor) renamed = true
    return next(e)
  })

  // the chip. This is registered before the tool.call that judges, so
  // next(e) is that one and a Rein refusal comes back as out.deny: the frame
  // shows the hook stopping an agent, which is the one thing the stages'
  // marks do not carry. The chip waits until the session has a run.
  // The matcher is what makes two tool.call hooks legal at all: the engine
  // refuses a second registration of an event without one. `{ tool: /./ }`
  // matches every call, so the wrap is over the whole of the judging hook.
  // It also makes sure of the frame server once the call opened the run or
  // moved its stage (ensureFrame), and tells the main session a server it
  // started in a Rein tool's result.
  on("tool.call", { tool: /./ }, async ($, e, next) => {
    const { tool, agentId } = e as { tool: string; agentId?: string }
    const run = lastRun
    // The main session has no agent card, so its chip is the lane's heading.
    const who = typeof agentId === "string" ? agentId : MAIN
    if (run !== undefined) {
      toolBegan(who, tool)
      await redraw($, run)
    }
    const out = await next(e)
    if (run !== undefined) {
      toolEnded(who, out.deny !== undefined ? "deny" : out.isError === true ? "error" : "ok", out.deny === undefined ? undefined : ruleOf(out.deny))
      // the run as the call left it, so a stage it moved stays moved.
      await redraw($, lastRun ?? run)
    }
    if (lastRun !== undefined) await ensureFrame($, lastRun)
    return agentId === undefined && tool.startsWith("mcp__rein__") ? withFrameUrl(out) : out
  })

  // G3: a Rein agent's agentId is only known once next(e)
  // started it, and only in its own stage does its work count. It runs in
  // the foreground, so the session that spawned it reads the outcome before
  // going on.
  on("agent.spawn", async ($, e, next) => {
    const run = await getRun($)
    if (run?.stage === "qa-integration" && e.subagentType === LAYOUT_VERIFIER) return spawnLayoutJudge($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    if (run && e.subagentType === LAYOUT_VERIFIER) return spawnLayoutVerifier($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    if (run && e.subagentType === SKETCHER) return spawnSketcher($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    if (run && e.subagentType === IMPACT) return spawnImpact($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    // the collator reads the images pasted since the run opened, so they are
    // saved to brief/ before it starts.
    if (run?.stage === "spec" && e.subagentType === COLLATOR) await savePastes($, run)
    // each aside check's runner.
    if (run && e.subagentType === RUNNER) return spawnRunner($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    // each ego check's driver and judge.
    if (run && e.subagentType === DRIVER) return spawnDriver($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    if (run && e.subagentType === JUDGE) return spawnJudge($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    // a split review's splitter and its reviewers, one per group.
    if (run?.stage === "review" && (e.subagentType === SPLITTER || (e.subagentType === "rein:reviewer" && splits(run)))) return spawnSplitReview($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    // the design review of 2-plan.md.
    if (run?.stage === "plan" && e.subagentType === "rein:reviewer") return spawnPlanReviewer($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    if (run?.stage === "plan" && (e.subagentType === "rein:planner" || e.subagentType === "rein:test-planner")) return spawnRedesigner($, run, e as AgentSpawnInput, next as (e: AgentSpawnInput) => Promise<AgentSpawnResult>)
    const row = run && (run.stage === "dev" && e.subagentType === WORKER.type ? WORKER : JUDGES[run.stage])
    if (!run || !row || e.subagentType !== row.type) return next(e)
    // G3: one arbiter verdict per plan pass.
    if (row.field === "arbiter" && run.deviation) {
      return { deny: `D22: the arbiter already ruled ${run.deviation.verdict} in this dev pass (${run.deviation.file}); another one cannot be asked until plan passes again.` }
    }
    const refusal = run.stage === "spec" ? await graderRefusal($, run) : undefined
    if (refusal !== undefined) return { deny: refusal }
    const c = await ctxOf($, run)
    const worker = row.field === "worker"
    const prompt = worker ? await withKnowledge($, devTask(c.run, c.dir, c.root, await toBeShots($, c.dir, run.layouts ?? [])), WORKER_USE, run)
      : run.stage === "dev" ? await withKnowledge($, await judgeTask($, c, e.prompt), ARBITER_USE, run)
        : await judgeTask($, c, e.prompt)
    const result = await next({ ...e, prompt, background: false })
    if (result.deny !== undefined || result.agentId === undefined) return result
    const agentId = result.agentId
    reinAgents.add(agentId)
    if (run.stage === "spec") graders.add(agentId)
    try {
      const moved = await mutate($, r => {
        if (r?.stage !== run.stage) return undefined
        return { ...r, [row.field]: agentId }
      })
      if (moved) await trace($, moved, { ev: "spawn", stage: run.stage, agent: row.type, agentId })
    } catch (err) {
      // The agent started; without its id recorded its verdict file is refused.
      await trace($, run, { ev: "error", stage: run.stage, agent: row.type, agentId, error: String(err) })
    }
    return result
  })

  // the engine asks before touching a path outside the working
  // directory, so answer allow for the run's own files: reading and writing
  // anything in the run directory, and in plan and review reading the rule
  // files the run froze. tool.check
  // carries no agentId; tool.call holds each Rein agent to its row.
  on("tool.check", async ($, e, next) => {
    const result = await next(e)
    // a command in a repository of the run outside the session root that
    // the stage's rule passes is allowed; tool.call judges it again by its agent.
    if (e.tool === "Bash") {
      const run = await getRun($)
      const command = (e.input as Record<string, unknown>).command
      if (!run || typeof command !== "string") return result
      const c = await ctxOf($, run)
      const plain = unharden(command)
      const checked = checkChain(plain)
      if ("deny" in checked) return result
      const spec = stageOf(run)
      const ok = (run.outside ?? []).some(r => inFolder(checked.words, r, c.root)) && spec.bash !== undefined && spec.bash(plain, c, e.input as Record<string, unknown>) === undefined
      return ok ? { decision: "allow", reason: "Rein run command in a repository outside the session root (D214)" } : result
    }
    const isRead = READ_TOOLS.has(e.tool)
    if (!isRead && !WRITE_TOOLS.has(e.tool)) return result
    const run = await getRun($)
    if (!run) return closed !== undefined && (await retroAllows($, closed, e.tool, e.input as Record<string, unknown>)) ? { decision: "allow", reason: "Rein retrospective of the run just closed" } : result
    const c = await ctxOf($, run)
    const input = e.input as Record<string, unknown>
    if (isRead) {
      const raw = input.file_path ?? input.path
      if (typeof raw !== "string" || climbs(raw)) return result
      // A Glob pattern or Grep glob could reach past the directory it names.
      const reach = e.tool === "Glob" ? input.pattern : e.tool === "Grep" ? input.glob : undefined
      if (typeof reach === "string" && (climbs(reach) || isAbsolute(reach))) return result
      const path = resolve(raw, c.root)
      const isRule = READS_RULES.has(run.stage) && run.rules.some(r => same(resolve(r.path, c.root), path))
      const isRunFile = same(path, c.dir) || under(path, c.dir)
      // the domain knowledge, read when an agent wants it, in any stage.
      const known = [await projectDir($), ...(await outsideProjects($, run))].map(p => resolve(`${p}/knowledge`, c.root))
      const isKnowledge = known.some(k => same(path, k) || under(path, k))
      // the run's repositories outside the session root.
      const isOutside = (run.outside ?? []).some(r => same(path, r) || under(path, r))
      return isRunFile || isRule || isKnowledge || isOutside ? { decision: "allow", reason: "Rein run file (D110)" } : result
    }
    const path = writeTarget(input, c.root)
    // a planned file outside the session root, where it really lands.
    if (path !== undefined && outside(path, c.root) && (run.planFiles ?? []).some(f => same(f, path))) {
      const real = await landing($, path, c.root)
      return real !== undefined && same(real, path) ? { decision: "allow", reason: "Rein planned file outside the session root (D214)" } : result
    }
    // Where it really lands must be there too (links, junctions).
    if (path === undefined || !under(path, c.dir)) return result
    const [real, dir] = await Promise.all([landing($, path, c.root), landing($, c.dir, c.root)])
    return real !== undefined && under(real, dir ?? c.dir) ? { decision: "allow", reason: "Rein run file (D110)" } : result
  })

  on("tool.call", async ($, e, next) => {
    const { tool, tool_use_id, consent, agentId, ...input } = e as typeof e & Record<string, unknown>
    const isOwn = [OPEN_RUN, ADVANCE, STATUS, PARK, RESUME, GOTO, PLAN_REVIEW].includes(tool as string)
    // the run's decisions are the main session's to make.
    if (typeof agentId === "string" && [ADVANCE, PARK, RESUME, GOTO].includes(tool as string)) {
      return { deny: `D146: ${tool as string} is called only by the main session, not by a subagent. Report to the main session and stop.` }
    }
    const isWrite = WRITE_TOOLS.has(tool)
    const isBash = (tool as string) === "Bash"
    const judged = (isOwn && (tool as string) !== STATUS) || isWrite || isBash || !quietTool(tool)
    let run: Run | undefined
    try {
      if (judged) await retryLegacy($)
      const found = await lookup($)
      run = found.run
      // this session's v0.2.0 run is not moved yet: refuse what Rein would judge.
      if (found.held !== undefined) {
        if ((tool as string) === STATUS) return { result: `${await heldLine($)}\n${((await status($, input)) as { result?: string }).result ?? ""}` }
        return judged ? { deny: await heldLine($) } : next(e)
      }
      // status is never refused; it carries the notice once.
      if (found.lost !== undefined && (tool as string) === STATUS) {
        await dropPointer($, found.lost)
        return { result: `${lostLine(found.lost, false)}\n${((await status($, input)) as { result?: string }).result ?? ""}` }
      }
      // taken over. The first call Rein would judge is refused with the
      // notice, so nothing runs unchecked unseen; then the session has no run.
      if (found.lost !== undefined && judged) {
        await dropPointer($, found.lost)
        return { deny: lostLine(found.lost) }
      }
    } catch (err) {
      if (judged) return failClosed($, undefined, tool, err)
      throw err
    }
    // a run in its own worktree goes on only from there, up to land,
    // which runs from the main tree so the worktree can go.
    if (run && run.stage !== "land" && (isWrite || [ADVANCE, GOTO, PLAN_REVIEW].includes(tool as string))) {
      try {
        const away = await awayFrom($, run)
        if (away) {
          const deny = awayDeny(run, away)
          await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, decision: "deny", deny })
          return { deny }
        }
      } catch (err) {
        return failClosed($, run, tool, err)
      }
    }
    if (isOwn) {
      const before = run
      return ownTool($, tool as string, input, typeof agentId === "string" ? agentId : undefined)!.then(async out => (await closeLeftSpaces($, before), out), err => failClosed($, undefined, tool, err))
    }
    if (!run) return next(e) // D47

    const as = typeof agentId === "string" ? agentId : undefined
    // a hand-back carries the agent's report to the session and is never
    // refused by the grader's, sketcher's or layout verifier's list below.
    const handback = (tool as string) === "SubagentHandback"
    // a grader reads 1-spec.md and writes grade.md (the stage rule judges
    // the write), nothing else; it sees the file, not the conversation.
    if (as !== undefined && graders.has(as) && !handback) {
      try {
        const dir = await folderOf($, "active", run.runId)
        const target = typeof input.file_path === "string" ? resolve(input.file_path, slash(await $.session.root())) : undefined
        const fine = run.stage === "spec" && (target !== undefined && (((tool as string) === "Read" && same(target, `${dir}/1-spec.md`)) || ((tool as string) === "Write" && same(target, `${dir}/agent/grade.md`))))
        if (!fine) {
          const deny = `D175: the grader reads ${dir}/1-spec.md and writes ${dir}/agent/grade.md, nothing else.`
          await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, decision: "deny", rule: "D175", deny })
          return { deny }
        }
      } catch (err) {
        return failClosed($, run, tool, err)
      }
    }
    // a sketcher reads the spec and the code and writes 1-mockup.html (the
    // stage rule judges the write); every other tool is refused.
    if (as !== undefined && sketchers.has(as) && !handback && !["Read", "Grep", "Glob", "Write"].includes(tool as string)) {
      const deny = `the sketcher reads with Read, Grep and Glob and writes 1-mockup.html with Write; ${tool as string} is refused.`
      await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, decision: "deny", deny })
      return { deny }
    }
    // a layout verifier reads the pictures and writes its verdict (the stage
    // rule judges the write); every other tool is refused.
    if (as !== undefined && layoutVerifiers.has(as) && !handback && !["Read", "Write"].includes(tool as string)) {
      const deny = `the layout verifier reads the pictures with Read and writes its verdict with Write; ${tool as string} is refused.`
      await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, decision: "deny", deny })
      return { deny }
    }
    if ((tool as string) === "AskUserQuestion" && run.stage === "spec" && as === undefined) {
      const at = run
      return askGate($, at, input, () => next(e)).catch(err => failClosed($, at, tool, err))
    }
    let scope: { c: Ctx; spec: StageSpec; main: boolean }
    try {
      scope = await scopeOf($, run, as)
    } catch (err) {
      return failClosed($, run, tool, err)
    }
    const stage = scope.spec
    // where a Rein agent's Bash is limited, a tool that runs
    // commands its own way is refused outright; for the worker and a retired
    // agent only the built-in ones. The main session has no limit.
    if (stage.bash && stage.toolRule && (stage.runnersOnly ? runnerTool(tool) : !quietTool(tool))) {
      const deny = `${stage.toolRule}: in the ${run.stage} stage ${tool} is refused; commands run only through Bash, within its rules.`
      await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, decision: "deny", rule: stage.toolRule, deny })
      return { deny }
    }
    let c: Ctx | undefined
    let path: string | undefined
    let recorded: "new" | "kept" | "left" | undefined
    let call = e
    let aside: { check: string; agentId: string; minutes: number } | undefined
    let egoRound: { check: string; agentId: string; round: string } | undefined
    if (isWrite) {
      try {
        c = scope.c
        path = writeTarget(input, c.root)
        if (path !== undefined && run.stage === "qa-integration" && same(path, `${c.dir}/agent/e2e.md`)) {
          const target = path
          c = { ...c, previous: (await $.fs.exists(target)) ? await $.fs.read(target) : "" }
        }
        // the main session writes anything; only Rein agents are held to a row.
        const deny = scope.main
          ? undefined
          : path === undefined
            ? UNSURE
            : ((await writeDeny($, stage, path, c)) ?? stage.preWrite?.(tool, input, path, c))
        if (deny !== undefined) {
          await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, path, decision: "deny", rule: deny.split(":")[0], deny })
          return { deny }
        }
        // counted before it runs, so a parallel write cannot slip past
        // dev-items.md. The main session's count only for planned files: the
        // rest is its environment, which dev does not answer for.
        const counted = !scope.main || (c.run.planFiles ?? []).some(f => path !== undefined && same(f, path))
        if (c.run.stage === "dev" && path !== undefined && counted && !under(path, c.dir)) {
          recorded = await recordWrite($, c, path)
          if (recorded === "left") return { deny: "D49: the run left dev while this write was on its way; it is refused." }
        }
      } catch (err) {
        return failClosed($, run, tool, err)
      }
    }
    // the main session's own git commit waits for the person's approval.
    if (scope.main && (isBash || (tool as string) === "PowerShell") && typeof input.command === "string" && gitCommits(input.command)) {
      try {
        const deny = await commitGate($, run, scope.c, tool as string, input.command)
        if (deny !== undefined) return { deny }
      } catch (err) {
        return failClosed($, run, tool, err)
      }
    }
    // a stage that limits Bash judges the command as given,
    // and a read-only git runs hardened.
    if (isBash && stage.bash) {
      try {
        const command = typeof input.command === "string" ? input.command : ""
        const base = scope.c
        const deny = stage.bash(command, base, input)
        if (deny !== undefined) {
          await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, command, decision: "deny", rule: deny.split(":")[0], deny })
          return { deny }
        }
        // a repository outside the session root runs hardened too.
        const hardened = scope.main ? undefined : (gitRewrite(command, base.root) ?? (run.outside ?? []).map(r => gitRewrite(command, r)).find(h => h !== undefined))
        if (hardened !== undefined) call = { ...e, command: hardened } as typeof e
        // a removed planned file is a write of the run, counted before it runs.
        if (base.run.stage === "dev") {
          const checked = checkChain(command)
          const removed = "words" in checked ? devCommand(checked.words, base.run, base.root) : []
          for (const p of Array.isArray(removed) ? removed : []) {
            if ((await recordWrite($, base, p)) === "left") return { deny: "D49: the run left dev while this command was on its way; it is refused." }
          }
        }
        // a runner's aside call for its open check (runnerRow judged its
        // form), one at a time, marked before it starts.
        // a driver's round, judged against the run as it starts.
        if (run.stage === "qa-integration" && run.e2e?.path === "ego" && as !== undefined && run.e2e.checks?.some(k => k.runner === as && isOpen(k))) {
          const started = await egoRoundStart($, run, base, as, command, input)
          if ("deny" in started) {
            await trace($, run, { ev: "tool", stage: run.stage, tool, agentId, command, decision: "deny", deny: started.deny })
            return { deny: started.deny }
          }
          egoRound = { check: started.check, agentId: as, round: started.round }
        }
        const open = run.stage === "qa-integration" && run.e2e?.path !== "ego" && as !== undefined ? runnerCheck(run, as) : undefined
        if (open && as !== undefined) {
          const minutes = Number(/^\s*timeout\s+(\d+)m\s/.exec(command)?.[1] ?? CALL_MINUTES)
          const marked = await mutate($, r => {
            const k = r?.stage === "qa-integration" ? runnerCheck(r, as) : undefined
            if (!r?.e2e?.checks || !k || k.running) return undefined
            return { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(x => (x.name === k.name ? { ...x, running: true as const } : x)) } }
          })
          if (!marked) return { deny: `check ${open.name}'s aside call is already running, or the check closed.` }
          aside = { check: open.name, agentId: as, minutes }
        }
      } catch (err) {
        return failClosed($, run, tool, err)
      }
    }

    const result = await next(call)
    await trace($, run, {
      ev: "tool",
      stage: run.stage,
      tool,
      agentId,
      input: await traceInput(tool as string, input),
      ran: call === e ? undefined : (call as unknown as Record<string, unknown>).command,
      decision: result.deny !== undefined ? "deny" : "allow",
      deny: result.deny,
      isError: result.isError ?? false,
      textLength: result.text?.length,
      text: clip(result.text),
    })
    // a driver's round, errored or not.
    if (egoRound !== undefined) {
      const { check: name, round } = egoRound
      const unmark = () => mutate($, r => (r?.e2e?.checks?.some(k => k.name === name && k.running) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(k => (k.name === name ? { ...k, running: undefined } : k)) } } : undefined))
      if (result.deny !== undefined) await unmark()
      else {
        try {
          return await egoCaptured($, (await getRun($)) ?? run, name, round, egoRound.agentId, result)
        } catch (err) {
          await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
          await unmark().catch(() => undefined)
          return withContext(result, `Rein could not read the round's result (${String(err)}). Report this to the main session and stop.`)
        }
      }
    }
    // a runner's aside call, errored or not (a timeout is an error).
    if (aside !== undefined) {
      const name = aside.check
      const unmark = () => mutate($, r => (r?.e2e?.checks?.some(k => k.name === name && k.running) ? { ...r, e2e: { ...r.e2e, checks: r.e2e.checks.map(k => (k.name === name ? { ...k, running: undefined } : k)) } } : undefined))
      if (result.deny !== undefined) await unmark()
      else {
        try {
          return await runnerCaptured($, (await getRun($)) ?? run, name, aside.agentId, aside.minutes, result)
        } catch (err) {
          await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
          await unmark().catch(() => undefined)
          return withContext(result, `Rein could not capture the aside result (${String(err)}). Report this to the main session and stop.`)
        }
      }
    }
    // A write held for the owner's review did not land, like a refused one.
    const record = (typeof result.result === "object" && result.result !== null ? result.result : {}) as Record<string, unknown>
    const landed = result.deny === undefined && !result.isError && record.staged !== true
    if (recorded === "new" && !landed && path !== undefined) {
      try {
        await dropWrite($, c!, path)
      } catch (err) {
        await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
      }
    }
    const [target, dir] = [path, c?.dir]
    const artifacts = typeof stage.artifacts === "function" ? stage.artifacts(c?.run ?? run) : stage.artifacts
    const artifact = c && target !== undefined && landed ? artifacts?.find(a => same(target, `${dir}/${a}`)) : undefined
    // anything else the main session wrote or ran may have changed what
    // a judgment stands on; it is measured at once and told.
    if (scope.main && !artifact && result.deny === undefined && ((isWrite && landed) || isBash)) {
      try {
        const changed = await drifted($)
        return changed.length > 0 ? withContext(result, changed.join("\n")) : result
      } catch (err) {
        await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
        return result
      }
    }
    if (!c || target === undefined || !landed) return result
    // The write already went through, so a failed judgment cannot refuse it;
    // the run stays where it is and the agent is told.
    try {
      if (!artifact) return result
      const judged = await judge($, c, artifact, result)
      await closeLeftSpaces($, run)
      return judged
    } catch (err) {
      await trace($, run, { ev: "error", stage: run.stage, tool, error: String(err) })
      return withContext(result, `Rein could not judge this write (${String(err)}); the run stays in ${run.stage}. Write it again.`)
    }
  })
}
