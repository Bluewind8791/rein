---
name: dev
description: The dev stage of a Rein run. Use when a Rein hook says the run is now in the dev stage and to invoke the rein:dev skill, or when the user typed /rein:dev to approve 2-plan.md.
argument-hint: "[slug]"
---

# dev stage

Have the detailed design turned into code. The `rein:worker` agent writes it; you run the stage.

## The user typed `/rein:dev`

Typing it approves the run's `2-plan.md`, which waits for it once plan is done. When the hook sent you here (the run is already in dev), skip this section.

The user may type it in this session or in a new one, with the run's slug (its runId) as the argument or with none. The argument: `$ARGUMENTS`.

1. Call `mcp__rein__status`, and pick the run:
   - This session has a run open. No slug, or its slug: that run. Another slug: this session holds one run, so ask the user with `AskUserQuestion` whether to put the open run aside (`보류`) or drop it (`폐기`), and call `mcp__rein__park` with the reason and their answer (it says what it takes); then the slug's run is the one. If they keep the open run, stop.
   - No run open: status lists the resumable runs of this project, each with the skills it `waits for`. A slug: that run, whatever it waits for. No slug: the runs that wait for `/rein:dev`. One: that run. Several: ask the user with `AskUserQuestion` which, one option per run (its runId and title). None: tell the user no run waits for `/rein:dev`, show them the resumable runs, and stop.
2. When the run is not this session's, call `mcp__rein__resume` with its runId, `answer` set to `이어서 진행` and the user's command in `said`. Typing the skill is their answer: do not ask them to confirm. If the result says another session held the run, tell the user. If resume refuses, tell the user what it says and stop.
3. Call `mcp__rein__status`. When it does not show `waits for the user: they type` with `/rein:dev`, approve nothing: tell the user where the run stands and carry on there with the skill of its stage (the one resume named, if it ran). When it does show it, go on below, whatever skill resume named.
4. Call `mcp__rein__advance` with `answer` set to `승인` and the user's words in `said`. The run is now in dev: go on with First below. If it refuses, tell the user what it says and stop.

## First

Call `mcp__rein__status`. It shows how many files the design has and, on a retry, `failFile`. If `failFile` is set, this is a retry: the hook tells the worker to read that file (`review.md`, `qa.md`, `e2e.md`, or `precheck.md` when the config's precheck commands failed before review) and fix what it reports.

## Do

1. Spawn the `rein:worker` agent. Its prompt does not matter: the hook writes its whole task from the run (the design's files, the handoff files, the file to fix from on a retry) and records it. It runs in the foreground.
2. When it returns, call `mcp__rein__status`.
   - `stage: review`: its `dev-items.md` passed. Invoke the `rein:review` skill. The worker is spent.
   - `stage: dev` and the worker reported that the design cannot be followed: see below.
   - `stage: dev` otherwise: its `dev-items.md` did not pass, or it stopped early. Spawn `rein:worker` again; the new one replaces it.

The worker is held to the design: it writes only the design's files, `dev-items.md` and the handoff files, runs only `rm` of listed files, read-only git and commands that read, and every file it writes is recorded. Its `dev-items.md` is the only one the hook judges.

You are not held to that. You may fix the environment: a local setting, a helper script, a fixture outside the design. Those files are not reviewed and not committed. A design file you change yourself is recorded as a change of the run, and the reviewer sees it. Leave the design's files to the worker unless the user asks otherwise.

## When the design cannot be followed

The worker stops and tells you why. Spawn the `rein:arbiter` agent. In its prompt, say what the design is missing, why the change is needed, and which files it concerns. The hook writes the arbiter's task itself and passes your text along as a claim.

Do not decide yourself. The arbiter can be asked once per plan pass. When it finishes, call `mcp__rein__status`.

- `arbiter:` still listed and no `deviation:`: no verdict was recorded (the arbiter ended without an accepted `deviation.md`). Spawn it again.
- `stage: plan`: the arbiter agreed. Tell the user the design has to change and invoke the `rein:plan` skill.
- `stage: dev` with `deviation: 부당`: the arbiter disagreed. Read `deviation.md` for why, and spawn `rein:worker` again: the design stands.

A file the worker wrote outside the design stays recorded; undoing it does not help. If the arbiter already ruled in this dev pass, the run cannot leave dev: tell the user. If they want to give it up, call `mcp__rein__park`.

## Judgments that stand on files

`1-spec.md` and `2-plan.md` are frozen once approved or passed. If one of them changes, the hook tells you once and the run stays where it is; the run keeps the design it passed with. To have the change judged, move the run with `mcp__rein__goto`: `spec` (approved again) or a stage past plan (the hook reads `2-plan.md` again). Change them only when the user wants the requirement or the design changed.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are. `폐기` also removes the run's worktrees and their branch, and what was not committed in them; `보류` and `완료` keep them. Park is refused while the hook is running commands; call it again once that is done.
