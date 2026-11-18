import { isOpen } from "./aside.ts"
import type { Run, Stage } from "./state.ts"

// what the frame shows of a run's progress. The frame is a page the local
// frame server (frame/server.js) serves; the hook cannot reach it, so it
// writes the run's status to agent/frame.json in the run folder and the
// server reads that. Everything that decides what is shown is here, where it
// is tested; the page only lays it out.

// what an agent is doing, as the hook's memory holds it: the tool it
// called last, how many of that tool in a row, whether the call is still
// running, how the last finished one ended and when it ran. A call Rein
// refused ends "deny", and rule is what it was refused by (D110 and the like).
export type End = "ok" | "error" | "deny"
export type Activity = { tool: string; count: number; running: boolean; end: End; rule?: string; since: number; until?: number }
export type Acts = ReadonlyMap<string, Activity>

// The main session's key in Acts. It has no agent card of its own: in spec,
// plan and qa it is the only thing working, so its chip rides beside the run's
// name, where the stages stay the run's own state.
export const MAIN = "main"

// zoetrope's chip: the hammer stands whatever the call did, the mark comes
// after it, a run of the same tool in a row shows its count and a single call
// shows how long it took. The refusal is Rein's own — zoetrope has no word for
// it, and the hook stopping an agent is the one thing the stages' marks do not
// carry.
const TAIL: Record<End, string> = { ok: " ✓", error: " ✗", deny: " ⊘" }

// A compact duration, as zoetrope writes it: 847ms, 1.2s, 42s, 2m3s.
export function fmtDur(ms: number): string {
  const n = Math.max(0, Math.round(ms))
  if (n < 1000) return `${n}ms`
  if (n < 10000) return `${(n / 1000).toFixed(1)}s`
  if (n < 60000) return `${Math.floor(n / 1000)}s`
  return `${Math.floor(n / 60000)}m${Math.floor((n % 60000) / 1000)}s`
}

// A call whose time ticks: a single one still in flight. The page's clock
// adds its time to the label; a run of calls shows its count.
export const ticking = (a: Activity): boolean => a.running && a.count === 1

export const chip = (a: Activity): string => {
  const count = a.count > 1 ? ` ×${a.count}` : ""
  const took = a.count > 1 || a.running ? "" : ` ${fmtDur((a.until ?? a.since) - a.since)}`
  const mark = a.running ? "" : `${TAIL[a.end]}${a.end === "deny" && a.rule !== undefined ? ` ${a.rule}` : ""}`
  return `⚒ ${a.tool}${count}${took}${mark}`
}

const CHAIN: Stage[] = ["spec", "plan", "dev", "review", "qa", "qa-integration", "land"]
const SHORT: Partial<Record<Stage, string>> = { "qa-integration": "qa-int" }

// a stage as the chain shows it: passed, the one the run is in, the one it is
// in while halted or with a design problem, or still to come.
export type Tone = "done" | "now" | "bad" | "wait"

// one agent's pill: the role, whether its glyph breathes (an agent is alive,
// the main session is not), and its call. `since` is set while a single call
// is in flight: the page adds how long it has run to `chip`.
export type Pill = { id: string; name: string; pulse: boolean; chip?: string; end?: End; since?: number }

export type ProgressView = { runId: string; stages: { name: string; tone: Tone }[]; pills: Pill[]; marks: string[] }

// the run's state as the frame's dot and icon show it: halted (or a design
// problem), waiting for the person, or going on.
export type FrameState = "run" | "ask" | "halt"

// where the run works: each worktree's repository (its main working tree),
// the run's branch and the branch it was made from (null: a detached HEAD).
export type FrameTree = { repo: string; branch: string; start: string | null }

// what agent/land.json holds, for the frame: what land commits, as the hook
// found it in git before asking (or, in a run without worktrees, in the
// staging): per repository (its main working tree) the branch the commit goes
// into, each file with its status and line counts (null for a binary file),
// and the changed files left out of the commit; paths relative to the
// repository root, with `/`. result, once the commits are in: per repository
// its commit in the main tree, and whether the worktree is gone (folder, where
// it is when not). The file moves with the run folder and goes to the sync
// remote with it.
export type LandFile = { path: string; status: "A" | "M" | "D"; add: number | null; del: number | null }
export type LandRepo = { repo: string; branch: string; files: LandFile[]; left: string[] }
export type LandResult = { repo: string; branch: string; commit: string; removed: boolean; folder?: string }
export type Land = { repos: LandRepo[]; result?: LandResult[] }

// what the server reads from agent/frame.json: the run, its stage as the run
// records it, its state, what to show, its worktrees, and when the hook wrote
// it (ms epoch). The file moves with the run folder, so the trees stay
// readable once the run is closed.
export type FrameStatus = { runId: string; stage: Stage; state: FrameState; view: ProgressView; trees: FrameTree[]; updated: number }

// G3: the agents the stage the run is in counts on.
function agentsOf(run: Run): { role: string; id: string }[] {
  const rows: [string, string | undefined][] = [
    ["rein:grader", run.grader],
    ["rein:worker", run.worker],
    ["rein:arbiter", run.arbiter],
    ["rein:reviewer", run.reviewer ?? run.verifier],
  ]
  return rows.flatMap(([role, id]) => (id === undefined ? [] : [{ role, id }]))
}

// what the run already knows, in its own words.
function marksOf(run: Run): string[] {
  const out: string[] = []
  if (run.deviation) out.push(`이탈 ${run.deviation.verdict}`)
  if (run.failFile) out.push(`실패 기록 ${run.failFile}`)
  if (run.qaVisit?.failed) out.push("qa 실패")
  if (run.halt) out.push(`멈춤 ${run.halt.rule}`)
  if (run.d62) out.push("설계 문제")
  return out
}

function pillOf(id: string, name: string, pulse: boolean, act: Activity | undefined): Pill {
  if (act === undefined) return { id, name, pulse }
  return { id, name, pulse, chip: chip(act), ...(act.running ? {} : { end: act.end }), ...(ticking(act) ? { since: act.since } : {}) }
}

// the run's name, its chain of stages, a pill per agent (the main session's
// first), and what the run already knows.
export function progressView(run: Run, acts: Acts): ProgressView {
  const now = CHAIN.indexOf(run.stage as Stage)
  const trouble = run.halt !== undefined || run.d62 === true
  const tone = (i: number): Tone => (now < 0 || i > now ? "wait" : i < now ? "done" : trouble ? "bad" : "now")
  const main = acts.get(MAIN)
  return {
    runId: run.runId,
    stages: CHAIN.map((s, i) => ({ name: SHORT[s] ?? s, tone: tone(i) })),
    pills: [
      ...(main === undefined ? [] : [pillOf(MAIN, MAIN, false, main)]),
      ...agentsOf(run).map(a => pillOf(a.id, a.role.replace("rein:", ""), true, acts.get(a.id))),
    ],
    marks: marksOf(run),
  }
}

// halted while the run says so; waiting for the person while spec or plan
// stopped for their approval (the file's hash is the hook's to check),
// integration qa waits for their hand test or /rein:e2e, an ego check is in
// their hands, or the main session's question to them is open; else going on.
export function frameState(run: Run, acts: Acts): FrameState {
  if (run.halt !== undefined || run.d62 === true) return "halt"
  if (run.waits !== undefined && run.waits.stage === run.stage) return "ask"
  if (run.stage === "qa-integration" && run.e2e?.path === "wait") return "ask"
  if (run.stage === "qa-integration" && run.e2e?.checks?.some(k => isOpen(k) && k.ego?.handoff !== undefined && !k.ego.resumed)) return "ask"
  const main = acts.get(MAIN)
  return main?.running === true && main.tool === "AskUserQuestion" ? "ask" : "run"
}

// what agent/frame.json holds, written `updated`.
export function frameStatus(run: Run, acts: Acts, updated: number): FrameStatus {
  const trees = (run.trees ?? []).map(t => ({ repo: t.repo, branch: t.branch, start: t.start }))
  return { runId: run.runId, stage: run.stage, state: frameState(run, acts), view: progressView(run, acts), trees, updated }
}
