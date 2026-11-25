---
name: qa
description: The qa stage of a Rein run, both layers (work qa and integration qa). Use when a Rein hook says the run is now in the qa or qa-integration stage and to invoke the rein:qa skill.
---

# qa stage

Two layers, each with its own stage and file:

| Stage | Runs | Checks | File |
|---|---|---|---|
| `qa` | the config's `qa` commands, run by the hook | exit codes only | `qa.md` |
| `qa-integration` | the user by hand, or e2e | the checklist, or the spec's completion line | `5-checklist.md`, `e2e.md` |

The files are in the run directory, next to `1-spec.md`. Call `mcp__rein__status` first; its `stage` says which layer you are in.

You do not fix the code here. A code failure goes back to `dev` through `qa.md`, and the hook decides where the run goes. The hook does not refuse your writes or commands. A design file you change after dev is not reviewed: the hook tells you once and the run stays where it is; `mcp__rein__goto` with `review` has it reviewed again. What you may fix is the environment: files off the design (a helper script the qa commands call, a local setting) are not reviewed or committed, and a `.rein/config.json` you change is approved at the next advance.

**At a gate you decide, with the user; the hook asks no one**. Call `mcp__rein__advance` without `answer`: at a gate it changes nothing and says what is decided, with the labels it takes and what it knows (the failure, the changed config, what aside saw). Show the user that and ask with `AskUserQuestion`, or decide on your own when the choice is plain. Then call `mcp__rein__advance` again with `answer` set to the label of the decision, and the user's own words, when they answered, in `said`. An answer that is no label changes nothing. Below, "ask" means this.

## Layer 1: work qa (`stage: qa`)

### 1. The hook runs the commands

The commands are the `qa` array of `.rein/config.json` in each repository the run changed. **You do not run them; the hook does**, so only one run decides and it runs one way.

Call `mcp__rein__advance`. With no failed run in this qa visit, the hook runs every `qa` command at once without asking anyone. It can take as long as the commands do.

Before you call advance, tell the user not to edit `.rein/config.json` while the commands run: the hook checks the config again after them, and any change, by the code or by hand, fails the run, and the run stops for your decision (`failure-route`).

The result says what happened:

- All pass: the hook wrote `qa.md` from its results and moved the run on. Go on as "The hook decides" below says.
- One fails: the run stays in `qa`. The result shows the failing command and the tail of its output; the whole output of every failing command is in `agent/qa-output.log` in the run directory. Do not read the log yourself: have `rein:triage` decide whose failure it is (step 2). The log can run to hundreds of KiB, so it is read outside your context.

### 2. Triage the failure

Spawn `rein:triage`. In its prompt give it the result's report of the failed run as it is, the absolute path of `qa-output.log` and the path of `qa.md` (`<run directory>/agent/qa.md`). It reads the log and the code, and:

- **the code's**: it writes `qa.md`, with its judgment under `## 실패 원인` (`원인: 구현` or `원인: 설계`), and answers `코드: ...`. The write sends the run to `dev` or `plan` by that judgment, or stops it for your decision; if the `원인:` line is missing or wrong the run stays in `qa` and the result says so: spawn `rein:triage` again. The hook does not run the commands again, since nothing in `qa` can change the code they ran against. Go on as step 3 says.
- **the environment's**: it writes nothing and answers `환경:`, `줄:` and `고칠 것:`. See below.

`qa.md` is judged only after a hook run failed in this qa visit; before that the hook leaves it unjudged.

### When a failure is the environment's

Some failures have nothing to do with the code: the wrong toolchain (for example a JDK older than the build needs), a service the tests need that is not running (a database, a container, Docker itself), no network. Then nobody writes `qa.md`. Writing it sends the run to `dev` or `plan`, and neither can fix the environment.

Tell the user what the triage found (the command that failed, the decisive line of output, what to start or change), keeping its `추측:` mark. Fix what you can with them: a `qa` command that cannot pass for reasons older than this run (errors HEAD already had, say) can be narrowed in `.rein/config.json`, with a helper script beside it if needed; the user approves the changed config at the next advance. A helper git does not track is missing from the next run's worktree, which holds only what git tracks: add a command that copies it from the main working tree to the same config's `worktree.setup` (see `/rein:setup`), and tell the user. When it is fixed, call `mcp__rein__advance`. After a failed run, ask them `다시 돌림` or `취소`; on `다시 돌림` it reruns the `qa` commands, with the same outcomes as above.

If the user finds with you that the failure is the code's after all, spawn `rein:triage` again with what they found.

### 3. The hook decides

The result of advance, or the triage's answer and `mcp__rein__status`, tells you where the run went:

- still `qa`, status shows `e2e impact:`: the commands passed, but checks that passed in an earlier visit rest on files changed since. Spawn `rein:impact` in the foreground, prompt `judge the impact`; the hook writes its task (the checks and the diff since each passed). It writes `agent/impact.md`, and the hook then writes `5-checklist.md`: a check it found untouched comes checked and does not run again; the others run. Call `mcp__rein__status` when it is done and go on as below. If it ended without writing `impact.md`, call `mcp__rein__advance`: every check in question then runs again.
- `qa-integration` with `e2e: wait` in status: `2-plan.md` has e2e checks, so the run stops for the user. See "Waiting for the user" below.
- `qa-integration` otherwise: go on to layer 2 below.
- `dev`: the triage judged the failure an implementation problem (`qa.md`). Invoke the `rein:dev` skill.
- `plan`: the triage judged the failure a design problem (`## 실패 원인` of `qa.md`). Tell the user what failed, with the evidence the failure files give (an output line, a `path:line`); a cause no file shows is your guess: say `추측` and how to check it. Then invoke the `rein:plan` skill; the revised plan is approved through `mcp__rein__advance`.
- still `qa`, `halt: failure-route`: the run stopped for your decision. See "When the run is halted" below.
- still `qa`, `D141`, status shows `halt: D141`: the commands passed a hook run (status: `qa visit: a hook rerun passed`), but a repository's config has `e2e` and Aside is not available. The run does not pass without e2e. Tell the user: they start the Aside app, or decide to go on without e2e. Then ask them `Aside를 켰음, 다시 확인` or `e2e 없이 진행` through `mcp__rein__advance`.
  - `Aside를 켰음, 다시 확인`: the hook checks Aside again. Still down: the run stays halted. Up: the entry runs, and it can still halt on a production url or backend or an app that does not answer; the result says which. Then see "When the run is halted".
  - `e2e 없이 진행`: the hook writes a `## e2e` that says so and enters integration qa; the completion check then has only the code to go on.
- still `qa`, `halt: failure-route`, with a result saying a command rewrote `.rein/config.json`: the code under test changed its own checks. That counts as a failing qa that no agent judged: decide dev or plan as `failure-route` below says; at the next qa the user approves the changed config or not.
- still `qa`, `D50`: a `.rein/config.json` is missing, unusable or changed since plan passed. That is not a code problem. Tell the user which repository and why, and fix the file with them if it needs fixing. Then ask them `새 config 승인` or `그대로` through `mcp__rein__advance`, showing the change it gives. On approval it freezes the configs as they are now, and any `D141` halt and the visit's last run are dropped, since they ran under the old config. Then call `mcp__rein__advance` again: the hook runs the commands under the new config with no answer needed. If the configs are still unusable, advance says why. A config from before `D142` lacks `e2e.backends`; the user adds it.

## Layer 2: integration qa (`stage: qa-integration`)

### Waiting for the user (`e2e: wait`)

When `2-plan.md` has e2e checks, the work qa passing does not start integration qa. The hook writes `5-checklist.md` in the run directory and nothing runs: a checklist by page, each page with the menus that reach it (`접근`) and its app, each check with what to do, what must show and the account to log in as. Tell the user, giving its absolute path, that they choose how to test:

- by hand: they test the screens by the checklist and check every box (`- [x]`), the `배치 <id>` boxes of `## 화면 배치 대조` too, then type `/rein:land`;
- by a browser agent: they type `/rein:e2e`, which runs them in Ego unless they ask for Aside; a check whose every expectation box they checked already does not run (it passes as theirs), and the hook checks the boxes of each check that passes;
- or they tell you a problem they found.

In a run in worktrees, check the port of each app the checks open now, before you tell them, as "Integration qa runs" below says: a config changed after `/rein:e2e` cannot be approved without going back to qa.

They may type `/rein:land` or `/rein:e2e` here, or in a new session with this run's slug (its runId) as the argument.

In an autopilot run (status shows `autopilot: on`) the run does not wait here: the hook's result says to call `mcp__rein__advance` with `e2e 실행 (Ego)` and `said` set to `autopilot`. Do that, then go on as below for the ego path.

Then stop until the user chooses, and do not run aside, ego or the checks yourself. Without an answer advance only says what it takes (`직접 확인 완료`, `e2e 실행 (Aside)`, `e2e 실행 (Ego)`, `dev로 보냄`, `plan으로 보냄`).

### Comparing the layout (`halt: layout-unchecked`)

When `2-plan.md` has `## 배치 대조` (`1-mockup.html` draws a to-be), `5-checklist.md` ends with `## 화면 배치 대조`: one `배치 <id>` box per to-be screen, with the menus that reach it and what to compare. The hook writes these boxes whenever work qa passes, e2e or not, and once integration qa has passed the run does not go to land while one is empty: it halts with `layout-unchecked`.

On the ego path the hook compares them for the person. Each screen whose box is empty is an ego check of its own, `배치-<id>`: a `rein:ego-driver` opens the screen as built and screenshots it, and `rein:layout-verifier`, not `rein:ego-judge`, judges it against the to-be the hook rendered (`mcp__rein__status` says which to spawn: `e2e layout judges to spawn now`). A pass checks the screen's box. When every check has its verdict and only layout checks failed, the run goes back to dev on its own with `agent/layout-fails.md` (counted as an implementation failure, so the hidden cap applies); invoke the rein:dev skill. A layout check failing beside another failed check halts with D173 as any failed check does. Aside and tests do not judge a layout: on those paths the person compares each screen as built with its to-be.

Tell the user, giving the absolute paths of `5-checklist.md` and `1-mockup.html`: they open each screen beside its to-be (`1-mockup.html#<id>`), check its box when the layout matches, then type `/rein:land`; or they tell you a layout that differs. Then stop. Without an answer advance says what it takes (`직접 확인 완료`, `dev로 보냄`, `plan으로 보냄`).

- `/rein:land`: call `mcp__rein__advance` with `직접 확인 완료`. With a layout box still empty it refuses and names it; show the user, and if they say it matches, check it (`- [ ]` to `- [x]`) and call again. With every box checked the run goes on to land as integration qa left it.
- a layout that differs: write it under `## 찾은 문제` of `5-checklist.md` as in "When the user found a problem", and on their `dev로 보냄` or `plan으로 보냄` call advance with it.

A box the user checked before integration qa passed counts: the run then goes to land with no halt.

### When the user found a problem

While the run waits, the user may tell you a screen does not work. Talk it through with them until it is clear what is wrong. Then write it at the end of `5-checklist.md`, under `## 찾은 문제`: each problem with the check it came from, what they did and what they saw. Ask them with `AskUserQuestion` whether the code is wrong (`dev로 보냄`) or the design is (`plan으로 보냄`), and on that answer call `mcp__rein__advance` with it. The run goes to `dev` or `plan` with `5-checklist.md` as what to fix. Invoke the skill of the stage it went to. After dev, the next work qa writes a fresh checklist.

If what they found is the environment or the data, not the code, there is nothing to send: once it is fixed they test again.

### Integration qa runs

The user typed `/rein:e2e` (the `rein:e2e` skill passes `e2e 실행 (Aside)` or `e2e 실행 (Ego)`), or integration qa runs on its own: a plan with no e2e checks, or one from an older version. The hook has already picked the e2e path. Call `mcp__rein__status` and read `e2e:`. Do not choose or change the path.

On the aside path, spawn the `rein:e2e-runner` agents status asks for; on the ego path, the `rein:ego-driver` and `rein:ego-judge` agents; as below.

On the aside and ego paths, each time the checks start after the run came from qa (from the wait, through `/rein:e2e`), make sure before you spawn the first agent that the change is in the app the checks open: restarted, redeployed or rebuilt as that app needs. Coming from qa means dev wrote code. If you started or restarted that app yourself in this conversation after dev last wrote code, from the tree that has the code, it has the change: do not ask. Otherwise ask the user with `AskUserQuestion`. Do not ask either when the checks run again with the code unchanged (`실패 항목만 다시 돌리기`, or `다시 돌리기` on a halted run). If it is not in the app yet, wait until they say it is: the checks would look at the old code. In a run in worktrees (status shows `worktrees:`), the code is only in the worktree: an app started from the main working tree does not have it. Then an app you started counts only if you started it from the worktree, and the question says the app must be started from the worktree, giving its path. Before you start it, check whether the port in the app's `url` is already listening. If an app from another tree holds it, start the worktree's app on a free port, and change that app's `url` and the matching `backends` entry in the worktree's `.rein/config.json` to that port. Do this while the run waits, before the user types `/rein:e2e`: the advance that `/rein:e2e` calls then shows the change and asks `새 config 승인` or `그대로`. Once the checks have started, advance cannot approve a changed config, and the agents' spawns are refused: move the run with `mcp__rein__goto` to `qa`, where advance asks `새 config 승인`, reruns the qa commands, and the run waits for `/rein:e2e` again.

Before the first spawn, also check that every host in the app's `backends` answers (a port that listens is enough). If one does not, tell the user which, and wait until they say it is up: a screen whose backend is down shows errors or no data, and a layout check judged on it fails for the environment, not the code.

If `2-plan.md` has `## 넘길 것` (files the user applies by hand), ask in that same question whether they applied them, naming each file under `<run dir>/handoff/` and what to do with it as `2-plan.md` says. Ask about them once in this conversation; do not ask again after the run comes back to qa-integration unless a handoff file changed. If they have not applied them, wait until they say so: e2e would fail on them.

In a run in worktrees, before the first spawn also check whether the branch the run started from moved on. Status lists each worktree as `<worktree> (<repository>, branch rein/<slug>, from <branch>)`; for each, run `git -C <repository> log --oneline rein/<slug>..<branch> -- <planned files of that repository>`. If it lists commits, that branch got commits since the worktree was made that change the same files, and land's cherry-pick would conflict. Tell the user, and with their consent bring the worktree onto that branch: `git -C <worktree> rebase --autostash <branch>` (the run's changes are not committed in the worktree; git puts them back on top, with conflict markers where they clash), resolve the conflicts, then `git -C <worktree> reset` so the run's changes stay uncommitted, as land expects, and drop the `autostash` entry git kept in `git stash list`. Then call `mcp__rein__goto` with stage `review`: the merged code is reviewed and qa'd, and e2e then runs once, on it.

### e2e: aside

Each check of `2-plan.md`'s `## e2e 확인` is run by one `rein:e2e-runner` agent: it writes aside's prompt from the check, runs aside, and writes the check's result file. Up to five run at once. Status lists every check (`e2e check <name>: ...`) and how many runners to spawn now (`e2e runners to spawn now: <n>`).

1. Spawn that many `rein:e2e-runner` agents, in the background, all in one message. Give each the same short prompt (`run the next e2e check`): the hook picks each one's check, in `2-plan.md`'s order, and writes its task. Checks run side by side only when none of them saves and all log in to one app as one account; any other check waits for the runners before it, so status may ask for fewer than five.
2. Wait for the runners. Each time one finishes, call `mcp__rein__status`:
   - `e2e runners to spawn now` is there: spawn that many more, as in step 1.
   - a runner ended without writing its result: the hook frees its check, and status asks for a runner for it again.
   - every check has its verdict and no `halt:`: the hook wrote `## e2e` in `e2e.md`. Go on to the completion check below.
   - `halt:`: see "When the run is halted". The run halts only once no check is open: a check that failed (`D173`), or one whose time ran out (`D101`), waits for the others to finish.
3. Do not run aside for a check yourself, and do not write a result file or `## e2e`: only a runner's result counts, and the hook writes `## e2e` from the results.

When a check's time (`e2e.timeout`, or the check's `시간`) runs out, the hook stops its aside session and closes the check with no verdict; if it could not stop the session, the runner reports the command for the user to stop it. That is an environment problem, not the code's; see "When the run is halted" below.

### e2e: ego

Each check of `2-plan.md`'s `## e2e 확인` runs in the ego browser, in its own TaskSpace and in the ego profile of its account. A `rein:ego-driver` drives it in rounds through the Rein harness, which records the evidence; when the driver calls `done()`, a `rein:ego-judge` decides the check from the evidence alone. On a check that changes a screen (not a `대조` check), the driver also measures the layout and the judge decides one more part, `레이아웃`: a select or input wider than its widest content plus 60px, a grid whose columns do not fill its container or overflow it, or fields that share a row or a column out of line by more than 3px fail the check, among the elements the expectation says appear or change on the screen (an element the task only uses is noted, not failed; a check that expects only a printed or downloaded file passes it). Up to five drivers run at once; judges only read files. Other runs and people test on the same data, so a check with `데이터 조건` may run on other data than its task names: its driver checks the task's data against the conditions with the MCP tools it has (read only; the hook records each call in the check's folder), and finds other data that fits or makes it through the app and puts it back. Its judge decides the conditions before the expectation. When no data fits and none can be made, the judge says `데이터 없음`: the check fails, and the `D173` question marks it so the user prepares data and picks the rerun of the failed checks. Status lists every check and what to do now:

- `e2e drivers to spawn now: <n>`: spawn that many `rein:ego-driver` agents, in the background, all in one message, each with the short prompt `run the next e2e check`. The hook picks each one's check, writes its task and drops your prompt, so a hint written there never reaches the driver. To pass a driver what an earlier attempt learned about reaching the screen (a URL parameter the page needs, a modal to close first), send it with `SendMessage` to its agent id once it is spawned; never what the check should show. A check that saves runs alone, and checks in one ego profile run together only as one account.
- `e2e judges to spawn now: <n>`: spawn that many `rein:ego-judge` agents the same way, prompt `judge the next e2e check`.
- `e2e hand-off: ...`: a driver handed its space to the user (a login, a second factor, a captcha, a file picker, a browser prompt). Tell the user at once what to do in which ego space, then call `mcp__rein__advance`; it asks `끝냈음, 이어서` or `이 check는 사람이 확인`. Ask the user with `AskUserQuestion` and pass their answer. On `끝냈음, 이어서`, resume that check's driver with `SendMessage` (to its agent id, as advance says): the user finished, write the next round. On `이 check는 사람이 확인`, the check closes with no verdict and stays in `5-checklist.md` for the user. The other checks keep running meanwhile, and the check's time stops while the space is the user's.
- `e2e missing evidence: ...`: the judge found evidence missing the first time. Send that driver what is missing with `SendMessage` (to its agent id); it collects only that and calls `done()` again, and a new judge is asked for. Missing a second time is 실패. When it is missing because the app answered with an error (an error response, an error dialog, an empty screen), and more so when several checks stop at the same request, find the cause first, with the user when it is the environment or the data (a server log, a missing column, a backend). Send the driver back only once that same request answers without the error: a second miss fails the check. If the code is at fault, send it as it is; the failed check reaches D173, where `dev로 보냄` takes it.

Each time an agent finishes, call `mcp__rein__status` and act on it the same way. A driver that ended in the middle of its work frees its check for a new driver. When no check is open:

- every check passed: the hook wrote `## e2e` in `e2e.md`. Go on to the completion check below.
- `halt:`: see "When the run is halted". A failed check halts the run with `D173`, as on the aside path; its ego space stays open for the user to look at.
- `e2e: wait` again: some check went to the user by `이 check는 사람이 확인`. `5-checklist.md` has the passed checks ticked; tell the user to test the rest by hand and check them, then type `/rein:land`, or type `/rein:e2e` again.

Do not drive a check or write a round, a result or `## e2e` yourself: only the agents' work counts. The hook closes a check's space when its time runs out (the check closes with no verdict, `D101`), closes a passed check's space, and closes every space of the run when it leaves integration qa, is put aside or dropped.

### e2e: none

There was no e2e to run, and the hook wrote a passing `## e2e` into `e2e.md`. Do not change that section.

### The completion check

When `## e2e` says `판정: 통과`, spawn `rein:reviewer` and wait for it. The hook replaces your prompt with the task below and runs it in the foreground. For reference, the task says:

> Check a Rein run's completion line. Do not fix anything.
>
> The line, from `<run dir>/1-spec.md` under `## 완료 판정`: `<the line, copied exactly>`.
> What e2e checked: the `## e2e` section of `<run dir>/agent/e2e.md`. What changed: `git -C <repository root> diff`, and new files read with `Read`. How each part of the line is checked: `## 완료 판정 덮기` of `<run dir>/2-plan.md`; a part nothing shows, or only checks the user passed as 기존 동작 cover, makes it 실패. A check passed as 기존 동작 whose only failed part is 레이아웃 still shows what its 기대 says: count it.
>
> Decide only whether that line is now true. Do not ask for anything the line does not say.
>
> Keep `## e2e` exactly as it is and add after it, by `Edit`, or `Write` of the whole file with `## e2e` unchanged, this form, the <...> filled in:
>
> ```markdown
> ## 완료 판정 대조
>
> > <the line, quoted character for character>
>
> - "<part>" — 통과 — <what showed it>
> - "<part>" — 실패 — <why it is not shown>
>
> 판정: <통과 or 실패>
> ```
>
> The verdict is exactly `통과` or `실패`. The quote must equal the spec's line exactly, or the hook does not accept it.

That form, and the form of `## e2e`, come from one template, `hooks/stages/qaTemplate.ts` in the plugin.

If `## e2e` says `판정: 실패`, do not spawn the reviewer: the run is halted for the user.

### The hook decides

After each `e2e.md` write by the reviewer the hook checks both sections, the verdicts, the quote, and the e2e evidence. Call `mcp__rein__status` when the reviewer is done and act on the stage:

- `land`: invoke the `rein:land` skill.
- `dev`: e2e failed (the user sent the run to dev). Invoke the `rein:dev` skill.
- `plan`: the user, or you at a `failure-route` halt, sent it to plan, or `1-spec.md` has no completion line. Tell the user what failed, with the evidence the failure files give (an output line, a `path:line`); a cause no file shows is your guess: say `추측` and how to check it. Then invoke the `rein:plan` skill; the revised plan is approved through `mcp__rein__advance`.
- still `qa-integration`, `halt: completion-failed`: the completion check failed. The run stays here; advance does not move it. Show the user each part the reviewer marked `실패` and why, as `e2e.md` says, decide with them where the run goes, and call `mcp__rein__goto`: `plan` to revise the design, `land` to accept the evidence as it is, or `qa-integration` to run the entry again (the checks that passed stay passed) and then the completion check, after you fixed a check's wording, say.
- still `qa-integration`: the result named what is missing; fix that. If status shows `halt:`, tell the user and stop.
- still `qa-integration`, `halt: layout-unchecked`: integration qa passed, but a `배치 <id>` box of `5-checklist.md` is still empty. See "Comparing the layout" below.
- still `qa-integration`, `D95` (nothing to commit): the checks passed, but git shows no planned file changed, for example because the user committed it during the run. Tell the user, then ask them through `mcp__rein__advance`: `plan으로 되돌림` (back to plan, then invoke the `rein:plan` skill) or `run 종료` (the run ends without a commit; tell the user it is closed).

## Fixing a check's wording

If an aside check of `2-plan.md` names a wrong path, a missing step, a filter that hides the row or a screenshot that cannot show what it must, you may fix `## e2e 확인` (and `## 완료 판정 덮기` to match) in `2-plan.md`. The hook tells you `2-plan.md` changed and keeps the run where it is. When only the checks changed, call `mcp__rein__goto` with `qa-integration`: the hook reads `2-plan.md` again (it must pass), skips the qa commands and runs the integration entry with the new checks; dev, review and qa do not run again. For a change to the design itself, go to `dev` or `plan` instead.

## When the run is halted

Status shows `halt:` with the reason. Advance moves nothing while it stands, until the halt is released; `mcp__rein__goto` moves the run anywhere. Tell the user the reason, and call `mcp__rein__advance` once it is fixed. If the fix is in `.rein/config.json` (for example `e2e`), fix it with them; they approve the change through advance. What to ask depends on the halt:

- `D100` (a production url or a production backend of the app) or `D101` (an app that did not answer, or a check whose time ran out): ask whether to run integration qa again (`다시 돌리기` or `그대로 멈춤`); `다시 돌리기` redoes the entry from the start. If `.rein/config.json` changed since it was frozen, advance first gives the change: ask `새 config 승인` or `그대로`; after an approval, ask the release question. If the config is still unusable, the run stays halted and advance says why.
- `D120` (a config changed after the aside checks ran, before the run could go to land): the e2e result is not used. Advance first gives the change: ask `새 config 승인` or `그대로`; after an approval ask again, and `다시 돌리기` redoes the entry.
- `D173` (an aside or ego check failed): show the user each failed check and what aside or the judge saw, as advance gives them, and ask `dev로 보냄` (a code problem: back to dev), `plan으로 보냄` (a design problem: to plan), `실패 항목만 다시 돌리기` (they fixed the environment or the data: the checks that passed keep their result, the failed ones run again; or the user tested a failed check by hand: they check every box of its expectation in `5-checklist.md` first, and it passes as theirs without running), `기존 동작으로 진행` (not this change: the hook marks it in `## e2e` and the completion check follows; a part of the completion line only that check covers is not shown; advance names those parts on its `이 경우 확인되지 않는 조각:` line, so pass that line on) or `그대로 멈춤`. Tell them too what a control check showed. `/rein:land` does not take a `D173` halt; do not offer it here.
- `ego-unavailable` (the user chose Ego and ego did not answer: ego lite is not running, or `ego-browser` was not on the PATH when Claude Code started): ask `Ego를 켰음, 다시 확인` (the entry runs again in ego), `Aside로 실행` (it runs in Aside instead, and reruns use Aside) or `e2e 없이 진행`.
- `ego-profile-missing` (the user chose Ego and a check has no ego profile: `e2e.apps.<app>.profile` is not set, an account of `- 계정:` is not in `e2e.apps.<app>.profiles`, or ego has no profile by that name): the user fixes it with `/rein:setup`; ask `rein:setup으로 채웠음, 다시 확인`, `Aside로 실행` or `e2e 없이 진행`. A config they change is approved through advance first.
- `D141` (Aside unavailable with e2e configured): ask `Aside를 켰음, 다시 확인` or `e2e 없이 진행`, as in layer 1. If `.rein/config.json` changed since it was frozen, advance first gives the change: ask `새 config 승인` or `그대로`; after an approval, ask the Aside question.
- `completion-failed` (the completion check failed): advance does not release it; see "The hook decides" above.
- `layout-unchecked` (integration qa passed, and a layout box is still empty): see "Comparing the layout" below.
- `failure-route` (in review, qa or qa-integration: a failure no agent judged, a command rewriting `.rein/config.json` during qa, or implementation failures at the hook's limit): read the reason and the failure file status and advance give, decide whether the code or the design must change, and call `mcp__rein__advance` with `dev로 보냄` or `plan으로 보냄`. When you cannot decide it alone, ask the user with `AskUserQuestion`. Then invoke the skill of the stage the run went to.

Every entry into integration qa starts `e2e.md` over: empty on the aside and ego paths until a check closes (from then on the hook rewrites `## e2e` with each check so far, open ones `결과: 진행 중`, the section `판정: 미정`, until every check has its verdict), only the hook's `## e2e` on the other paths. What the file held moves to `## 이전 진입` at its end, headings one level down; leave that section as it is. `goto qa-integration` is refused while a check is still open: wait for its agents. A rerun in the same visit (`다시 돌리기`, `실패 항목만 다시 돌리기`) keeps the checks that passed and runs only the others. After a move back to dev or review, a check that passed keeps its pass while none of the files it rests on changed (those on its `- 파일:`, or every planned file when it names none), or when `rein:impact` found the change does not touch it: its box in `5-checklist.md` comes checked, and with every check's pass kept the run goes straight to the completion check. A box the user unchecks again has that check run at `/rein:e2e`.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are. `폐기` also removes the run's worktrees and their branch, and what was not committed in them; `보류` and `완료` keep them. Park is refused while the hook is running commands; call it again once that is done.

## Do not

- Fix the code. A code failure goes to `dev` through the triage's `qa.md`.
- Read `qa-output.log` to sort out a failure yourself. `rein:triage` does.
- Run the qa commands in place of the hook, or an aside or ego check in place of its agents: only their runs count.
- Judge the completion line yourself, or write `## 완료 판정 대조`. Only the reviewer's write is a verdict; to go on past a failed one, use `mcp__rein__goto`.
