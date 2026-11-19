import type { ToolCallResult } from "claude-code"
import type { ConfigView } from "./config.ts"
import type { Cause, Check, Layout } from "./parse.ts"
import { isOpen, startable } from "./aside.ts"
import { egoStartable, judgeable } from "./ego.ts"
import { same } from "./paths.ts"

export type Stage = "spec" | "plan" | "dev" | "review" | "qa" | "qa-integration" | "land"

// what dev handed on, by path: each planned and handoff file's SHA-256
// (of its bytes as base64), "gone" when it does not exist.
export type Seal = Record<string, string>

// a rule file as open_run froze it. paths null means no `paths:` list,
// so the rule always applies.
// repo: a rule of a repository outside the session root, from that
// repository's project folder; its globs are relative to repo and it applies
// to repo's files only.
// shared: from ~/.rein/rules, held to every repository of the run.
export type Rule = { name: string; path: string; hash: string; paths: string[] | null; repo?: string; shared?: true }

// a git worktree the run works in. repo is the repository's main working
// tree, path the worktree under its .claude/worktrees/<runId> on branch,
// start the branch the main tree was on when it was made (null: a detached
// HEAD). Plan makes one for each repository it names; the session stays
// in the main tree. root: a run from before that made the session root's
// own at open_run and had the session work in it. commit: land's commit
// in it; landed: that commit is in the main tree too, so a retry skips the
// repository.
export type Tree = { repo: string; path: string; branch: string; start: string | null; root?: true; commit?: string; landed?: true }

// The run in $.store under runs:<project>/<runId>, while it is
// active or deferred; the session points to it.
export type Run = {
  v: 2
  stage: Stage
  runId: string
  status?: "active" | "defer" // the run's state while it has a record
  owner?: string // the session that holds the run while it is active
  uid?: string // a random id open_run makes; a takeover on another PC keeps it, so the hub tells it from another PC's run of the same slug. Absent: a run from before
  claimed?: string // when this PC last took the run up from the hub (ISO time, just before its claim); a lost entry of ~/.rein/.hub/status.json found before it is from before the takeover
  trees?: Tree[] // the run's worktrees ([] until plan names a repository when the session root is no repository); absent: a run opened before worktrees, which works in the main tree and whose land only stages
  rules: Rule[]
  planFiles?: string[] // resolved, set when plan passes
  repos?: string[] // nearest .git ancestor of each plan file
  outside?: string[] // repositories outside the session root 2-plan.md named; their projects' rules are frozen
  handoff?: string[] // the file names of 2-plan.md's `## 넘길 것`, written in dev under <run dir>/handoff/
  checks?: Check[] // 2-plan.md's `## e2e 확인` as it passed ([] for 없음 or no e2e); absent: a plan from an older version
  layouts?: Layout[] // 2-plan.md's `## 배치 대조` as it passed, one per to-be screen of 1-mockup.html; absent: none
  writes: string[] // source writes made in dev (by the worker, and the main session's of planned files), kept across retries
  retries: number // the implementation failures the reviewer or the triage judged since the design last passed, for the hidden cap (dev.ts FAIL_CAP); shown nowhere. A record from an older version counted every return to dev here, and goes on from that count
  failFile?: string // what dev reads on a retry
  worker?: string // agentId of the rein:worker writing the code in dev
  arbiter?: string // G3, agentId of the rein:arbiter spawned in dev
  reviewer?: string // agentId of the rein:reviewer spawned in review
  splitter?: string // agentId of the rein:review-splitter spawned in review, when the change is large enough to split (review.ts SPLIT_AT)
  reviewGroups?: ReviewGroup[] // the split review's groups from review-groups.md, kept across a dev retry and a plan pass while they hold every changed file; gone by goto
  verifier?: string // agentId of the integration qa reviewer (trace only)
  deviation?: { verdict: "합당" | "부당"; file: string } // G3, the arbiter's last verdict
  keepRetries?: true // G3, plan was re-entered by a 합당: its next pass keeps the retries
  d62?: true // plan was re-entered as a design problem: the approval of the next pass resets the retries
  e2e?: E2eState // decided by the hook on entering qa-integration
  passed?: Passed[] // aside checks that passed, kept past a move back to dev or review, and past a plan pass for a check it gives as it was with no config changed; gone when a config is approved
  impact?: Impact // rein:impact's judgment of the passes whose files changed since, for the seal it was asked under
  halt?: { rule: "D100" | "D101" | "D120" | "D141" | "D173" | "D174" | "completion-failed" | "ego-unavailable" | "ego-profile-missing" | "layout-unchecked" | "failure-route"; reason: string; file?: string } // G11, an environment problem; the run stays (D141: in qa or qa-integration; D120: a config changed during integration qa; D173: an aside or ego check failed; D174: the handoff files may not be applied yet, only a run halted by an older version; completion-failed: the completion check failed, and the main session decides where the run goes; ego-unavailable: the user chose Ego and ego-browser did not answer; ego-profile-missing: the user chose Ego and a check has no ego profile; layout-unchecked: integration qa passed, and a layout box of 5-checklist.md is still empty; failure-route: in review, qa or qa-integration, a failure no agent judged or an implementation failure at the hidden cap, and the main session sends the run to dev or plan, which reads file)
  browser?: "aside" | "ego" // the browser the user last chose for e2e (/rein:e2e); absent: ego
  configHashes?: Record<string, string> // SHA-256 of each repository's config.json when plan passed
  configSeen?: Record<string, ConfigView> // what the person last approved of each config (plan or a freeze)
  landRepos?: string[] // G10, repositories with a planned file changed, fixed on entering land
  busy?: { what: string; at: number } // one judgment that runs commands at a time
  heads?: Record<string, string> // HEAD per repository on entering land (a record; nothing judges on it)
  commit?: { command: string; approved?: true } // the main session's refused git commit, and whether the person approved it to run once
  qaVisit?: QaVisit // this visit to qa; gone on every move back to dev, review or plan
  qaFailure?: QaFailure // the last hook rerun of the qa commands that failed, of any visit
  finished?: true // land passed; only the move to complete/ is left
  frozen?: { spec?: string; plan?: string; planSpec?: string } // 1-spec.md as the person approved it and 2-plan.md as it passed; planSpec, 1-spec.md as approved when 2-plan.md passed: while it is still the approved one, a design review back in plan judges only what changed since 2-plan.md passed
  sealed?: Seal // the planned and handoff files as dev passed
  planReviewer?: string // agentId of the rein:reviewer spawned last in plan to judge 2-plan.md
  planReview?: { hash: string; rules: string[] } // what that reviewer judges: SHA-256 of 2-plan.md and the rule files, as at its spawn; gone once it gave its verdict
  planVerdicts?: PlanVerdict[] // this visit's design reviews of 2-plan.md, oldest first; gone when plan passes or goto moves the run
  grader?: string // agentId of the rein:grader spawned in spec
  sketcher?: string // agentId of the rein:sketcher spawned last in spec
  sketched?: { spec: string; html: string } // sha256 of 1-spec.md and of 1-mockup.html when the sketcher last wrote it; either one changed since means the picture is not of 1-spec.md as it is
  layoutChecks?: Check[] // the ego checks of integration qa made from `## 배치 대조`, one per to-be screen whose box was empty at the entry
  layoutFails?: Record<string, number> // per to-be screen, the layout checks in a row that found the screen as built different from the to-be
  sketchCheck?: SketchCheck // the to-be screens drawn from a planning-document picture, and rein:layout-verifier's comparison of the last drawing with it
  asked?: number // the questions the main session asked the user in spec
  grades?: Grade[] // every grade of 1-spec.md, oldest first
  autopilot?: true // opened by /rein:autopilot: the main session itself passes 1-spec.md's approval, 2-plan.md's (reviewed, config as at HEAD), the e2e run in Ego and the commit, with said "autopilot", where the hook's result says so
  waits?: { stage: "spec" | "plan"; hash: string } // advance found 1-spec.md (as graded) or 2-plan.md (as reviewed) ready and the run stopped for the person; it waits for /rein:plan or /rein:dev while the stage and the file's SHA-256 are still these
  traceBroken?: { at: string; problem: string } // the first trace write that failed; trace.jsonl misses lines from then
  told?: string[] // the changes past a judgment the main session was told of, one key each, so each is told once
}

// one grade of 1-spec.md as the hook scored it: the SHA-256 of the text
// graded, the questions asked by then, the ambiguity and each dimension's
// score (capped: no quote of it was found in 1-spec.md) and first gap.
// one design review of 2-plan.md: the file's SHA-256 it judged, whether
// every part passed and, on a failure, the reasons as the reviewer gave them.
export type PlanVerdict = { hash: string; pass: boolean; why?: string }

// one group of a split review: its title and files as review-groups.md
// gives them, the rein:reviewer judging it now, and its last verdict with
// the seal of its files it was given on.
export type ReviewGroup = { title: string; files: string[]; reviewer?: string; verdict?: { pass: boolean; seal: Seal; cause?: Cause } }

// spec's layout check of 1-mockup.html: the drawing it is of
// (SHA-256), its to-be screens with a planning-document picture and their
// rendered PNGs (relative to the run), the rein:layout-verifier on it, the
// state, and the drawings in a row that came out different.
// pending: the verifier is to compare; match: every screen matches; differ:
// the sketcher draws again; given-up: a drawing got no closer, or GIVE_UP_AT in a row differed, the
// differences go to the approval; unrendered: no browser rendered it (why).
export type SketchCheck = {
  html: string
  sources: Record<string, string>
  shots: Record<string, string>
  agent?: string
  state: "pending" | "match" | "differ" | "given-up" | "unrendered"
  fails: number
  last?: Record<string, string[]> // the differences of the last drawing that differed, by screen, given to the verifier of the next
  why?: string
}

export type Grade = { hash: string; asked: number; ambiguity: number; dims: { name: string; score: number; capped?: true; gap?: string }[] }

// a run folder is <project>/<state>/<runId>, so the project folder is
// two above it.
export function projectOf(dir: string): string {
  const up = dir.slice(0, dir.lastIndexOf("/"))
  return up.slice(0, up.lastIndexOf("/"))
}

// what happened in the current qa visit. passed: a hook run
// of the qa commands passed (only then may the D141 answers enter
// integration); reruns: the reruns the user asked for; failed: the last hook
// run of this visit failed, so qaFailure is from here, qa.md may report it,
// and the next advance asks the user before it runs the commands again.
export type QaVisit = { passed?: true; reruns: number; failed?: true }

// the first failing command of a hook rerun and the tail of its output.
export type QaFailure = { root: string; cmd: string; exit: number; tail: string }

// the e2e path; on the aside path every check of
// 2-plan.md's `## e2e 확인` with its runner and what was captured for it;
// the `## e2e` section the hook wrote
// itself (every path). wait: the hook wrote 5-checklist.md and nothing ran
// yet; the person tests by hand or runs /rein:e2e. manual: the person
// checked every box of 5-checklist.md.
export type E2eState = {
  path: "aside" | "ego" | "none" | "wait" | "manual"
  checks?: CheckRun[]
  written?: string
}

// one aside check as it runs: its limit and the minutes
// spent by calls that timed out; runner, the rein:e2e-runner agent that
// took it (a claim until the agent started), and running, its aside call is
// on its way; the session, the 관측 line and the verdict its runner wrote;
// over, its time ran out and the hook stopped its session, so it has no
// verdict; person, the person passed its failure as what the code did
// before (기존 동작으로 진행). evidence, the folder aside saves its
// screenshots in, relative to the run directory; shots, the PNGs found
// there with the verdict; unshot, aside said 통과 but saved none, so the
// hook counts it 실패. todo, expect, account, app and saves, the check as
// 2-plan.md gave it, for the runner and ## e2e (absent in a record from
// before they were kept). carried, its pass is from an earlier visit, none
// of its files changed since, or rein:impact found the change does not
// touch it (cleared). checked, its pass is the person's: they
// checked every box of its expectation in 5-checklist.md before /rein:e2e,
// so nothing ran it. exec and varied, only in a record from before
// runners: the command the hook built, and a run in another form. ego, the
// check's state on the ego path (runner is then its rein:ego-driver);
// cited, the evidence files the judge's passed parts cite.
export type CheckRun = { name: string; minutes: number; spent: number; exec?: string; todo?: string; expect?: string; account?: string; app?: string; saves?: true; runner?: string; running?: true; session?: string; observed?: string; verdict?: "통과" | "실패"; over?: true; person?: true; evidence?: string; shots?: string[]; unshot?: true; varied?: true; carried?: true; cleared?: true; checked?: true; cited?: string[]; ego?: EgoCheck }

// one check on the ego path. profile, the ego profile id it runs in;
// space, its TaskSpace's name for this attempt; spentMs, the time it used
// before since, which is when its clock last started (absent while it is
// handed off or waits); round, its last round started (running while it
// runs); handoff, what the user must do in the browser, while the space is
// theirs; resumed, the user finished it and the driver may take the space
// back; driven, the driver called done(); judge, the rein:ego-judge on it;
// returned, the judge's missing evidence, sent back to the driver once;
// lost, attempts whose space vanished; human, the user took the check to
// test by hand; parts, the judge's lines; cites, the files they cite.
export type EgoCheck = {
  profile: string
  space: string
  spentMs: number
  since?: number
  round?: number
  handoff?: string
  resumed?: true
  driven?: string
  judge?: string
  returned?: string
  returns?: number
  lost?: number
  human?: true
  parts?: string[]
}

// an aside or ego check that passed, with the seal's value as it passed of
// each file its `- 파일:` names, or of every sealed file when it names none.
export type Passed = CheckRun & { files: Seal }

// whether the code changed since a pass touches its check, asked of
// rein:impact when work qa passes: sealed, the seal it was asked under (a
// later seal voids it); doubt, the checks whose pass is in question; agent,
// the rein:impact on it; verdicts, per check, once it wrote impact.md (a
// check it gave no verdict is affected).
export type Impact = { sealed: Seal; doubt: string[]; agent?: string; verdicts?: Record<string, { affected: boolean; why: string }> }

// writes as status shows them: against planFiles, only where they differ.
function writesLines(writes: string[], planFiles: string[] | undefined): string[] {
  if (!planFiles) return ["writes:", ...writes.map(w => `- ${w}`)]
  const unwritten = planFiles.filter(f => !writes.some(w => same(w, f)))
  const unplanned = writes.filter(w => !planFiles.some(f => same(f, w)))
  if (unwritten.length === 0 && unplanned.length === 0) return ["writes: the same files as planFiles"]
  return ["writes: the files of planFiles, with these differences:", ...unwritten.map(f => `- not written: ${f}`), ...unplanned.map(w => `- written, not in planFiles: ${w}`)]
}

// G2: the run as the status tool shows it, only the fields that are set.
export function renderRun(run: Run): string {
  const lines = [`runId: ${run.runId}`, `stage: ${run.stage}`]
  if (run.autopilot) lines.push("autopilot: on (where the hook's result says so, pass the answer yourself with said \"autopilot\")")
  if (run.failFile) lines.push(`failFile: ${run.failFile}`)
  if (run.planFiles) lines.push(`planFiles:`, ...run.planFiles.map(f => `- ${f}`))
  if (run.repos) lines.push(`repos:`, ...run.repos.map(r => `- ${r}`))
  if (run.trees?.length) lines.push(`worktrees:`, ...run.trees.map(t => `- ${t.path} (${t.repo}, branch ${t.branch}, from ${t.start ?? "a detached HEAD"}${t.landed ? ", landed" : ""})`))
  if (run.handoff?.length) lines.push(`handoff (D163, in the run directory's handoff/):`, ...run.handoff.map(h => `- ${h}`))
  if (run.writes.length > 0) lines.push(...writesLines(run.writes, run.planFiles))
  if (run.stage === "spec" && (run.asked || run.grades?.length)) lines.push(`questions asked (D175): ${run.asked ?? 0}`)
  for (const g of run.stage === "spec" ? (run.grades ?? []) : []) lines.push(`grade after ${g.asked} questions: ambiguity ${g.ambiguity}`)
  const last = run.stage === "spec" ? run.grades?.at(-1) : undefined
  if (last) lines.push(...last.dims.map(d => `- ${d.name}: ${d.score}${d.capped ? " (capped, no quote found)" : ""}${d.gap ? ` — 빈칸: ${d.gap}` : ""}`))
  lines.push(run.rules.length > 0 ? "rules:" : "rules: none frozen")
  for (const r of run.rules) lines.push(`- ${r.path} (${r.shared ? "shared, every repository of the run; " : ""}${r.paths === null ? "no paths: list, always applies" : `paths: ${r.paths.join(", ")}`})`)
  if (run.worker) lines.push(`worker: ${run.worker} (writes the code, then dev-items.md)`)
  if (run.arbiter) lines.push(`arbiter: ${run.arbiter} (may write deviation.md)`)
  if (run.reviewer) lines.push(`reviewer: ${run.reviewer} (may write review.md)`)
  if (run.splitter) lines.push(`review splitter: ${run.splitter} (may write review-groups.md)`)
  for (const [i, g] of (run.reviewGroups ?? []).entries()) {
    const state = g.reviewer ? `rein:reviewer ${g.reviewer} on it` : g.verdict ? (g.verdict.pass ? "통과" : "실패") : "not reviewed yet"
    lines.push(`review group ${i + 1} (${g.title}, ${g.files.length} files): ${state}`)
  }
  if (run.planReviewer && run.planReview) lines.push(`plan reviewer: ${run.planReviewer} (gives its verdict through mcp__rein__plan_review)`)
  for (const [i, v] of (run.planVerdicts ?? []).entries()) lines.push(`design review ${i + 1}: ${v.pass ? "통과" : "실패"}`)
  if (run.grader) lines.push(`grader: ${run.grader} (may write grade.md)`)
  if (run.sketcher) lines.push(`sketcher: ${run.sketcher} (may write 1-mockup.html)`)
  if (run.sketchCheck) lines.push(`layout check of 1-mockup.html: ${run.sketchCheck.state}${run.sketchCheck.agent ? `, rein:layout-verifier ${run.sketchCheck.agent} on it` : ""}${run.sketchCheck.fails > 0 ? `, ${run.sketchCheck.fails} drawings in a row differed` : ""}`)
  if (run.verifier) lines.push(`verifier: ${run.verifier}`)
  if (run.deviation) lines.push(`deviation: ${run.deviation.verdict} (${run.deviation.file})`)
  if (run.d62) lines.push("d62: the revised 2-plan.md waits for approval through mcp__rein__advance")
  if (run.halt) lines.push(`halt: ${run.halt.rule}: ${run.halt.reason}`)
  if (run.qaVisit) {
    const v = run.qaVisit
    lines.push(`qa visit: ${v.passed ? "a hook rerun passed" : "no hook rerun passed yet"}, ${v.failed ? "the last hook run failed" : "no hook run failed"}, advance reruns: ${v.reruns}`)
  }
  if (run.stage === "qa" && run.qaVisit?.passed && run.impact && !run.impact.verdicts) lines.push(`e2e impact: ${run.impact.agent ? `rein:impact ${run.impact.agent} judges` : "spawn rein:impact (in the foreground) to judge"} whether the change since their pass touches ${run.impact.doubt.join(", ")}`)
  if (run.qaFailure) lines.push(`last failing qa rerun: \`${run.qaFailure.cmd}\` (${run.qaFailure.root}) — exit ${run.qaFailure.exit}`)
  const e2e = run.e2e
  if (e2e) {
    lines.push(`e2e: ${e2e.path}${e2e.path === "wait" ? " (5-checklist.md is out; the user tests by hand, then /rein:land, or runs /rein:e2e)" : ""}`)
    for (const k of e2e.checks ?? []) {
      const session = k.session ? `, 세션 ${k.session}` : ""
      const at = k.verdict
        ? `판정: ${k.verdict}${k.person ? " (사람 판단: 기존 동작)" : ""}${k.varied ? " (hook 명령과 다르게 실행됨)" : ""}${session}`
        : k.ego ? egoLine(k)
          : k.over ? `ran past its ${k.minutes} minutes and the hook stopped it${session}`
            : k.runner ? `rein:e2e-runner ${k.runner} on it${session}, ${k.spent} of ${k.minutes} minutes spent` : `waiting for a runner, limit ${k.minutes} minutes`
      lines.push(`e2e check ${k.name}: ${at}`)
      if (k.observed !== undefined) lines.push(`  관측: ${k.observed}`)
    }
    const start = run.halt || e2e.path !== "aside" ? 0 : startable(e2e.checks ?? []).length
    if (start > 0) lines.push(`e2e runners to spawn now: ${start} rein:e2e-runner, in the background, in one message`)
    if (e2e.path === "ego" && !run.halt && e2e.written === undefined) {
      const checks = e2e.checks ?? []
      const drivers = egoStartable(checks).length
      const judges = judgeable(checks).filter(k => !k.name.startsWith("배치-")).length
      const layouts = judgeable(checks).length - judges
      if (drivers > 0) lines.push(`e2e drivers to spawn now: ${drivers} rein:ego-driver, in the background, in one message`)
      if (judges > 0) lines.push(`e2e judges to spawn now: ${judges} rein:ego-judge, in the background, in one message`)
      if (layouts > 0) lines.push(`e2e layout judges to spawn now: ${layouts} rein:layout-verifier, in the background, in one message`)
      for (const k of checks.filter(x => isOpen(x) && x.ego?.handoff !== undefined && !x.ego.resumed)) lines.push(`e2e hand-off: check ${k.name}'s space ${k.ego!.space} waits for the user: ${k.ego!.handoff}. Tell the user now and call mcp__rein__advance: it asks them.`)
      for (const k of checks.filter(x => isOpen(x) && x.ego?.resumed)) lines.push(`e2e resume: the user finished check ${k.name}'s hand-off; resume its rein:ego-driver ${k.runner} with SendMessage, if you have not.`)
      for (const k of checks.filter(x => isOpen(x) && x.ego?.returned !== undefined)) lines.push(`e2e missing evidence: send rein:ego-driver ${k.runner} of check ${k.name} with SendMessage what its judge found missing: ${k.ego!.returned}`)
    }
  }
  if (run.heads) lines.push("heads:", ...Object.entries(run.heads).map(([repo, head]) => `- ${repo}: ${head}`))
  if (run.landRepos) lines.push(`land repositories: ${run.landRepos.join(", ")}`)
  if (run.commit) lines.push(run.commit.approved ? "main session commit (D182): the user approved it; it runs once as it was" : "main session commit (D182): refused until the user answers; mcp__rein__advance takes that answer first")
  if (run.finished) lines.push("finished: the staging is ready, but the run folder could not move to complete; mcp__rein__advance finishes the run")
  if (run.traceBroken) lines.push(`trace broken (D109): a write to trace.jsonl failed at ${run.traceBroken.at} (${run.traceBroken.problem}); the trace misses lines from then, so it is an incomplete record`)
  return lines.join("\n")
}

// What a stage rule sees: the run, its directory and the session root, both
// resolved (paths.ts), and the agent loop the call runs in (absent on main).
// qa-integration's write rule sees the file as it stands before the write.
export type Ctx = { run: Run; dir: string; root: string; agentId?: string; previous?: string }

// a write goes through, is refused with the text, or goes through only
// when `repo` holds .git, which register.ts looks up (only it may touch $).
export type WriteVerdict = { allow: true } | { deny: string } | { repo: string; deny: string }

// One row of the stage table. `preWrite` checks what a write would put in
// before it happens; `artifacts` are the run files register.ts judges right
// after their write went through.
export type StageSpec = {
  write: (path: string | undefined, c: Ctx) => WriteVerdict
  preWrite?: (tool: string, input: Record<string, unknown>, path: string, c: Ctx) => string | undefined
  bash?: (command: string, c: Ctx, input: Record<string, unknown>) => string | undefined // a deny text; absent, Bash is not limited
  toolRule?: string // with bash: the decision that also refuses every command-running tool but Bash
  runnersOnly?: true // with toolRule: refuse only the built-in runners, not other MCP servers' tools
  artifacts?: string[] | ((run: Run) => string[])
}

// an open ego check as status shows it.
function egoLine(k: CheckRun): string {
  const ego = k.ego!
  const minutes = `${Math.floor(ego.spentMs / 60_000)}+ of ${k.minutes} minutes used${ego.since !== undefined ? ", its clock running" : ""}`
  const space = `space ${ego.space}`
  if (ego.human) return `the user tests it by hand (its space was handed off), ${space}`
  if (k.over) return (ego.lost ?? 0) >= 2 ? `its ego space was lost twice; closed with no verdict` : `ran past its ${k.minutes} minutes; the hook closed its space`
  const judge = k.name.startsWith("배치-") ? "rein:layout-verifier" : "rein:ego-judge"
  if (ego.judge) return `${judge} ${ego.judge} judging it, ${space}`
  if (ego.driven !== undefined) return `driven (done: ${ego.driven}); waiting for a ${judge}, ${space}`
  if (ego.handoff !== undefined) return `${ego.resumed ? "the user finished the hand-off; its driver resumes" : `handed to the user: ${ego.handoff}`}, ${space}, driver ${k.runner}`
  if (ego.returned !== undefined) return `the judge found evidence missing; its driver ${k.runner} collects it once resumed, ${space}`
  if (k.runner) return `rein:ego-driver ${k.runner} on it${ego.round ? `, round ${ego.round}${k.running ? " running" : ""}` : ""}, ${space}, ${minutes}`
  return `waiting for a rein:ego-driver, ${space}, ${minutes}`
}

// A v0.0.3 run has only stage and runId: no frozen rules, nothing written.
export function normalizeRun(raw: unknown): Run | undefined {
  if (!raw || typeof raw !== "object") return undefined
  return { v: 2, rules: [], writes: [], retries: 0, ...(raw as Partial<Run>) } as Run
}

export function withContext(result: ToolCallResult, line: string): ToolCallResult {
  return { ...result, context: [...(result.context ?? []), line] } as ToolCallResult
}
