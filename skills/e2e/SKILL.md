---
name: e2e
description: Runs a Rein run's integration test through aside or the ego browser, while integration qa waits for the user after the work qa passed. Use only when the user typed /rein:e2e.
disable-model-invocation: true
argument-hint: "[slug]"
---

# e2e

The user typed `/rein:e2e`: they want a browser agent to run the integration test of the open Rein run, instead of testing `5-checklist.md` by hand. Typing it is their answer to run it; you do not ask them again whether to run it.

## Finding the run

The user may type it in this session or in a new one, with the run's slug (its runId) as the argument or with none; the argument may also hold `aside` (see "Running it"), which is not a slug. The argument: `$ARGUMENTS`.

1. Call `mcp__rein__status`, and pick the run:
   - This session has a run open. No slug, or its slug: that run. Another slug: this session holds one run, so ask the user with `AskUserQuestion` whether to put the open run aside (`보류`) or drop it (`폐기`), and call `mcp__rein__park` with the reason and their answer (it says what it takes); then the slug's run is the one. If they keep the open run, stop.
   - No run open: status lists the resumable runs of this project, each with the skills it `waits for`. A slug: that run, whatever it waits for. No slug: the runs that wait for `/rein:e2e`. One: that run. Several: ask the user with `AskUserQuestion` which, one option per run (its runId and title). None: tell the user no run waits for `/rein:e2e`, show them the resumable runs, and stop.
2. When the run is not this session's, call `mcp__rein__resume` with its runId, `answer` set to `이어서 진행` and the user's command in `said`. Typing the skill is their answer: do not ask them to confirm. If the result says another session held the run, tell the user. If it says to call `EnterWorktree`, do that now with the path it gives: the run goes on only in its worktree. If resume refuses, tell the user what it says and stop.
3. Call `mcp__rein__status`. When it does not show `waits for the user: they type` with `/rein:e2e`, approve nothing: tell the user where the run stands and carry on there with the skill of its stage (the one resume named, if it ran). When it does show it, go on below, whatever skill resume named.

## Running it

1. Pick the browser without asking the user:
   - `Ego`, the default: in the ego browser, a `rein:ego-driver` drives each check and records evidence beyond screenshots (measurements, the app's state, server responses, network, console, downloads), and a `rein:ego-judge` decides each check from that evidence alone. Each check runs in the ego profile of its account (`e2e.apps.<app>.profile` and `profiles`, set by `/rein:setup`).
   - `Aside`, only when the user asked for Aside, in the argument (`aside`, with or without a slug) or in their words: aside, the browser agent, runs each check and says what it saw; its screenshots are the evidence.
2. Call `mcp__rein__advance` with `answer` set to `e2e 실행 (Ego)` or `e2e 실행 (Aside)`, and the user's words in `said`. The hook runs the integration qa entry in that browser; reruns of this run use it too.
   - The aside or ego path: invoke the `rein:qa` skill and follow its layer 2. Before you spawn the first agent, make sure the change is in the app the checks open, as that skill says.
   - `D141` (Aside unavailable): nothing ran and the run still waits. Tell the user: they start the Aside app and type `/rein:e2e` again, or test by `5-checklist.md` by hand.
   - A halt (`halt:` in status), `ego-unavailable` and `ego-profile-missing` included: invoke the `rein:qa` skill; its "When the run is halted" says what to ask.
   - `D50` (a config changed): follow what advance says; it asks the user first.
