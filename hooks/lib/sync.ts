import { isAbsolute, under } from "./paths.ts"
import { sharedRulesOf } from "./rules.ts"
import type { Run, Stage } from "./state.ts"

// what the hub keeps of a run (its record: who holds it, in which state,
// gen counting its changes) and what the run's agent/record.json says of it,
// which the hook writes and the local frame server sends with the run's files.
// run is the record as toPortable made it, for an active or deferred run only.
export type HubRecord = { project: string; runId: string; uid?: string; pc: string; state: "active" | "defer" | "complete" | "drop"; gen: number; at: string }
export type HubInfo = { uid?: string; stage: Stage; title: string; at: string; event: string; portable: boolean; run?: Run }
// a run as the hub lists it.
export type HubRun = HubRecord & { stage: Stage; title: string; portable: boolean; resumable: boolean; link: string }

// ~/.rein/.hub/status.json as the local frame server writes it: whether it
// reaches the hub, how many files are not sent yet, and the runs and files
// it found at odds with the hub. A retro conflict names its run, any other its path;
// a lost run, when the server first found it so.
export type HubStatus = {
  at?: string
  reachable?: boolean
  checkedAt?: string
  lastOkAt?: string
  error?: string
  unsent?: number
  lost?: { project: string; runId: string; pc: string; local?: string; at?: string }[]
  collisions?: { project: string; runId: string; pc: string }[]
  conflicts?: { kind: string; path?: string; project?: string; runId?: string }[]
}

// the stages a run on another PC continues from as it is; past them
// the code is missing there.
const PLANNED = new Set<Stage>(["spec", "plan"])

// a path under the session root, the project's ~/.rein folder or the
// shared rules folder ~/.rein/rules is kept relative to it, so the other PC
// may keep them elsewhere; the run is portable when no absolute path is left
// (a repository outside the root keeps one).
const ROOT = "{root}"
const REIN = "{rein}"
const RULES = "{rules}"

function mapPaths(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value)
  if (Array.isArray(value)) return value.map(v => mapPaths(v, fn))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapPaths(v, fn)]))
  return value
}

function anyAbsolute(value: unknown): boolean {
  if (typeof value === "string") return isAbsolute(value)
  if (Array.isArray(value)) return value.some(anyAbsolute)
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => isAbsolute(k) || anyAbsolute(v))
  return false
}

// A run in the session root's worktree keeps its paths relative to that
// worktree, wherever the session is: the other PC makes its own worktree
// and puts the paths back under it (its repo shown as the worktree itself).
// The worktrees go as where they were and from which repository, without
// what land did in them; the other PC makes them anew from its own HEAD.
export function toPortable(run: Run, root: string, rein: string): { run: Run; portable: boolean } {
  const home = run.trees?.find(t => t.root)
  const base = home ? home.path : root
  const rules = sharedRulesOf(rein)
  const swap = (s: string) =>
    under(s, rein) || s === rein ? REIN + s.slice(rein.length)
      : under(s, rules) ? RULES + s.slice(rules.length)
      : under(s, base) || s === base ? ROOT + s.slice(base.length) : s
  const trees = run.trees?.map(t => ({ repo: t.root ? t.path : t.repo, path: t.path, branch: t.branch, start: t.start, ...(t.root ? { root: true as const } : {}) }))
  const out = mapPaths({ ...clearSession(run), ...(trees ? { trees } : {}) }, swap) as Run
  return { run: out, portable: !anyAbsolute(out) }
}

export function fromPortable(run: Run, root: string, rein: string): Run {
  const rules = sharedRulesOf(rein)
  const back = (s: string) =>
    s.startsWith(REIN) ? rein + s.slice(REIN.length) : s.startsWith(RULES) ? rules + s.slice(RULES.length) : s.startsWith(ROOT) ? root + s.slice(ROOT.length) : s
  return mapPaths(run, back) as Run
}

// what belongs to the session that held the run, not the run.
export function clearSession(r: Run): Run {
  return {
    ...r, status: undefined, owner: undefined,
    grader: undefined, worker: undefined, arbiter: undefined, reviewer: undefined, verifier: undefined, splitter: undefined,
    reviewGroups: r.reviewGroups?.map(g => ({ ...g, reviewer: undefined })),
    busy: undefined, commit: undefined,
    e2e: r.e2e && { ...r.e2e, checks: r.e2e.checks?.map(k => ({ ...k, runner: undefined, running: undefined })) },
  }
}

// a run past plan taken up on another PC, which has none of its code,
// goes back to right after plan passed: dev, with its writes, seals and retries gone and every later stage's record with them.
export function afterPlan(r: Run): Run {
  if (PLANNED.has(r.stage)) return r
  return {
    ...r, stage: "dev", writes: [], retries: 0, sealed: undefined,
    failFile: undefined, deviation: undefined, keepRetries: undefined, d62: undefined, e2e: undefined, passed: undefined, halt: undefined,
    landRepos: undefined, heads: undefined, commit: undefined,
    qaVisit: undefined, qaFailure: undefined, finished: undefined, verifier: undefined, reviewGroups: undefined,
  }
}

// whether taking the run up on another PC sends it back.
export const pastPlan = (stage: Stage) => !PLANNED.has(stage)
