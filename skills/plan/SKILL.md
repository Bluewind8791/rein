---
name: plan
description: The plan stage of a Rein run. Use when a Rein hook says the run is now in the plan stage and to invoke the rein:plan skill, or when the user typed /rein:plan to approve 1-spec.md. It does not start a run.
argument-hint: "[slug]"
---

# plan stage

Take the approved spec and have **how** the work is done designed, in one file, `2-plan.md`. The `rein:planner` agent designs it and writes it; you run the stage. You spawn it once per visit to plan and continue it with `SendMessage`, so it keeps what it investigated. In between you have `rein:test-planner` decide the verification (the tests, the e2e checks and how the completion line is covered), and you handle what needs the user. Planning is the heaviest reading of a run, so it happens outside your context.

The user approves the plan, by typing `/rein:dev`. The hook does not judge `2-plan.md` when it is written, so the planner may leave it unfinished; when the planner is done you call `mcp__rein__advance`, the hook judges the form of `2-plan.md`, and only a plan that passes reaches the user's approval. Before that, a `rein:reviewer` reviews the design against the rules its files bring in, its `## 영향 범위` and `1-spec.md` (step 5).

## The user typed `/rein:plan`

Typing it approves the run's `1-spec.md`, which waits for it once spec is done. When the hook sent you here (the run is already in plan), skip this section.

The user may type it in this session or in a new one, with the run's slug (its runId) as the argument or with none. The argument: `$ARGUMENTS`.

1. Call `mcp__rein__status`, and pick the run:
   - This session has a run open. No slug, or its slug: that run. Another slug: this session holds one run, so ask the user with `AskUserQuestion` whether to put the open run aside (`보류`) or drop it (`폐기`), and call `mcp__rein__park` with the reason and their answer (it says what it takes); then the slug's run is the one. If they keep the open run, stop.
   - No run open: status lists the resumable runs of this project, each with the skills it `waits for`. A slug: that run, whatever it waits for. No slug: the runs that wait for `/rein:plan`. One: that run. Several: ask the user with `AskUserQuestion` which, one option per run (its runId and title). None: tell the user no run waits for `/rein:plan`, show them the resumable runs, and stop.
2. When the run is not this session's, call `mcp__rein__resume` with its runId, `answer` set to `이어서 진행` and the user's command in `said`. Typing the skill is their answer: do not ask them to confirm. If the result says another session held the run, tell the user. If resume refuses, tell the user what it says and stop.
3. Call `mcp__rein__status`. When it does not show `waits for the user: they type` with `/rein:plan`, approve nothing: tell the user where the run stands and carry on there with the skill of its stage (the one resume named, if it ran). When it does show it, go on below, whatever skill resume named.
4. Call `mcp__rein__advance` with `answer` set to `승인` and the user's words in `said`. The run is now in plan: go on with the steps below, keeping the result's note (the rules frozen for this run, the domain knowledge). If it refuses, tell the user what it says and stop.

## What you may write

Nothing, as a rule: the planner writes `2-plan.md` in the run directory, and `<repository root>/.rein/config.json` is written only through the `rein:setup` skill, after the user confirms it. The hook does not refuse your writes or commands, but leave `2-plan.md` to the planner and the code to the worker, in dev. `1-spec.md` is approved and frozen: if it changes, the run goes back to spec and the user approves it again.

When you are unsure where the run stands (its stage, the frozen rules, later the design's files), call `mcp__rein__status`. It only reads.

## Coming back to plan

The run can come back here from `dev`. Call `mcp__rein__status` to see why:

- `deviation: 합당 (<path>)`: the arbiter found the design cannot be followed.
- `d62:` with a `failFile`: the revised plan is approved before dev runs again. The cause is one of: a failure of review, qa or integration qa judged a design problem (by the reviewer or the triage, by you at a `failure-route` halt, or by the user), the user sent the commit back in `land`, git showed nothing to commit and plan was chosen, or `1-spec.md` has no completion line.

Show the user what went wrong and agree with them what the design should change. Then run the steps below with a new planner: never continue the planner of an earlier visit to plan, even when its agent ID still answers. It carries that visit's whole investigation, and on a large change one more round of it can fill its context. The new one reads the reason and `2-plan.md` as it stands itself; you add what the user wants changed to its prompt.

When the design was approved before in this run, the hook adds that to the task of each planner and test-planner you spawn, and gives the test-planner the lines of `2-plan.md` changed since the approval. Both then change only what the change reaches, so the e2e checks it leaves as they were keep their passes. Spawn the test-planner every visit all the same: whether the change reaches a test or a check is its call, and with nothing reached it changes nothing.

To go elsewhere instead (`qa-integration` when only the checks changed, say), use `mcp__rein__goto`.

## Steps

### 1. Planner, first call

Spawn `rein:planner` with the prompt `첫 호출`, plus what the user wants changed when the run came back. Keep its agent ID: you continue this same agent below. It reads the spec and the run's state itself, writes `2-plan.md` without tests in the run directory and answers:

```
설계: <path>
config 없음: <repository roots> | 없음
사람에게: <question> | 없음
```

### 2. What needs you

- For each repository under `config 없음`, invoke the `rein:setup` skill for that repository root. It asks the user to confirm the commands before it writes anything.
- For each `사람에게` line, ask the user with `AskUserQuestion`. Keep their answers for step 4.

### 3. Verification

Spawn the `rein:test-planner` agent once the configs of step 2 are written: it reads them for the e2e checks. Nobody but it decides the tests, the e2e checks and how the completion line is covered: fewer of them means less work for the design, and nobody reviews this stage. In its prompt give it:

1. the path of `2-plan.md`: the file list with what to do in each file is under its `## 상세 설계`
2. the completion check line, under `## 완료 판정` of `1-spec.md` (give the path)
3. the affected paths, under `## 영향 범위` of `2-plan.md`, with what relies on each
4. the path of the domain knowledge list that status names, if there is one: it may hold the domain's test conventions and screens
5. when the run came back to plan, what the user wants changed

Keep its agent ID. It writes its answer into `agent/test-plan.md` in the folder of `2-plan.md`, and answers with that path (`검증:`) and its `사람에게` lines, and after the design was approved before, a `바꾼 것:` line. For each `사람에게` line, ask the user with `AskUserQuestion`, then continue it with `SendMessage` and their answers; it changes the file again. If it can no longer be continued, spawn it anew with the same prompt and the answers.

### 4. Planner, continued

Continue the same planner with `SendMessage`: the path of `test-plan.md`, the test-planner's `바꾼 것:` line if it gave one (here and each time below you give the planner that path again), and the user's answers from step 2 if any. When `바꾼 것:` is `없음` and there are no answers, there is nothing to add: skip to step 5. Do not copy the file's content into the message: the planner reads it, so `>` and the like reach `2-plan.md` as the test-planner wrote them. It adds them to `2-plan.md`, finishes it and answers as in step 1. Handle `config 없음` and `사람에게` as in step 2, then continue it again with the answers. If it can no longer be continued (the session was resumed, say), spawn `rein:planner` anew with the same message; it reads `2-plan.md` as it stands.

### 5. Approval

Call `mcp__rein__advance` without `answer`.

- When the hook refuses, it names what `2-plan.md` lacks. Continue the planner with that refusal, then call advance again. A missing or unusable `.rein/config.json` is yours: invoke `rein:setup` for it first. When the refusal is about the tests, `## e2e 확인` or `## 완료 판정 덮기`, continue the test-planner with it first and give the planner the path of `test-plan.md` again.
- When the hook asks for a design review, spawn `rein:reviewer` in the foreground with the prompt `설계 리뷰`; the hook writes its task. It gives its verdict to the hook and answers with the outcome. On 통과, call advance again. On 실패, continue the planner with the reviewer's reasons as it gave them; it answers with a `고친 것:` line per reason. When it changed the design's file list, continue the test-planner with the new `2-plan.md` first, and give the planner the path of `test-plan.md` again. Then call advance again: a changed design is reviewed anew.
- After the second failed review in this visit to plan, the hook no longer asks for a passing one. Show the user the reasons and what the planner changed, and ask them in your own words how to go on: more fixes (a new review is up to them), or the approval as the design stands. The approval question then quotes the last reasons.
- When it passes, the run waits for the user, and the result gives what the hook knows. Show the user the top of `2-plan.md`, from the title to `## 접근 방법`: `## 변경 요약` and `## 결정 사항` are written for them. Show also any `.rein/config.json` difference the result quotes, and the absolute path of `2-plan.md`, and of `2-plan.html` when the result names it: the hook wrote it, a page that shows each file's diff beside the file as it is, with the reason of each change. Tell them how to go on: they type `/rein:dev` to approve it, here or in a new session (`/rein:dev <slug>` there, the slug being this run's runId), or they tell you what to change. Then stop. Do not ask for the approval, and never pass `승인` yourself, except when the result says the user is not asked here (an autopilot run, or a design that came back to plan in this session): then pass `승인` with `said` as it says, tell the user in one line with the paths, and go on with the skill the next result names.
- When the user tells you what to change: continue the planner with it (the user fixes a config difference, or `/rein:setup` does with their confirmation), then go back to the top of this step. When the change is about the tests or the checks, or the planner changed the design's file list, continue the test-planner with the user's words and the new `2-plan.md` first, and give the planner the path of `test-plan.md` again.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are. `폐기` also removes the run's worktrees and their branch, and what was not committed in them; `보류` and `완료` keep them. Park is refused while the hook is running commands; call it again once that is done.

## Do not

- Design or write `2-plan.md` yourself. The planner does.
- Edit source code. The worker writes it in dev.
- Touch `1-spec.md`.
- Ask the user to approve the plan before advance passes it.
- Write `.rein/config.json` outside the `rein:setup` skill.
- Decide tests, exemptions or e2e checks yourself.
- Judge the design review yourself, or pass the planner a reason the reviewer did not give.
