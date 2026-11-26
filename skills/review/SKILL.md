---
name: review
description: The review stage of a Rein run. Use when a Rein hook says the run is now in the review stage and to invoke the rein:review skill.
---

# review stage

The changed code is read and checked on two things: does it follow the detailed design in `2-plan.md`, and does it keep the project rules that apply. You run nothing here; testing belongs to `qa`. Only when the repository's `.rein/config.json` has `precheck` commands (a quick compile or typecheck) does the hook run them first, so that code that does not compile goes back to dev without a review.

You do not judge. The `rein:reviewer` agent does, because the session that wrote the code must not grade it. Only that agent's `review.md` counts; the hook lets your writes through, but they move nothing.

## 0. The precheck, when status shows it

Call `mcp__rein__status`. When it shows `precheck: pending`, call `mcp__rein__advance` before spawning any reviewer; the hook refuses a reviewer until then. The hook runs the config's precheck commands in each worktree:

- all pass: status shows `precheck: passed`. Go on with step 1.
- one fails: the hook writes the report to `agent/precheck.md` and the run goes to `dev` with it as `failFile`, counted like a reviewer's implementation failure. Invoke the `rein:dev` skill. When the failures reached the hook's limit, the run stops in review with `halt: failure-route` instead: see step 3.

Without a `precheck:` line, skip this step.

## 1. Get the lists from the hook

Call `mcp__rein__status`. In review it shows:

1. the changed files: what the hook recorded during dev, under `Changed files`
2. the rules to check, by file name with their absolute paths, or none

Use these lists as they are. Do not work out the rules yourself, and do not take the changed files from `git diff --name-only`: new files would be missing.

When the change has 10 or more changed files, status also says the review is split: too much for one reviewer to read. Then go to step 2a instead of step 2.

## 2a. A split review

1. When status says to spawn `rein:review-splitter`, spawn it and wait for it. The hook writes its task, so a one-line prompt will do. It groups the files that a reviewer must read together in `review-groups.md` and answers with the number of groups.
2. Call `mcp__rein__status`. It names the groups to review. Spawn one `rein:reviewer` per group, all in one message so they run at the same time, each with the prompt `묶음 <n>` and nothing else: the hook writes each group's task, with its files, its rules and where its design lies in `2-plan.md`. Each writes `review-<n>.md` in the form below.
3. When they are done, go on to step 3. Once every group has its verdict the hook decides as for one review: all 통과 is qa, any 실패 goes to dev or plan with a `review.md` the hook wrote from the failed groups: plan when any failed group's `## 실패 원인` says 설계. A group a reviewer wrote nothing for that passed the hook is still to review: spawn its reviewer again.

After a retry through dev, or after the run went back through plan, status names only the groups to review again: those that failed, and those that passed but whose files changed since. A retry that wrote a file no group holds has the change grouped anew, from 1.

## 2. Spawn the reviewer

Spawn `rein:reviewer` and wait for it. The hook replaces your prompt with the task below, filled in from its own record, and runs it in the foreground, so a one-line prompt will do. For reference, the task says:

> Review a Rein run's changes. Do not fix anything.
>
> Design: the `## 상세 설계` section of `<run dir>/2-plan.md`.
> Changed files: `<the list from status>`. See existing files with `git -C <repository root> diff`; read new files with `Read`.
> Rules: `<each rule file name and absolute path from status, or "none">`.
>
> Check that every change follows the design, and that it keeps every listed rule. A rule that clashes with the design is still `실패`. Do not compare against the spec's completion check; that is qa's.
>
> Then look for bugs and security holes in what the change added or changed (empty input, null, boundaries, swallowed errors, concurrency, idempotency, guards that hide a broken invariant; unescaped user input into SQL, a shell or HTML, missing authentication or authorization). Flag one only when you can trace it from a caller, as path:line, to what goes wrong; leave out hypotheticals, nits and what you would just write differently. A flagged problem makes `## 정확성` `실패`.
>
> For each line of `2-plan.md`'s `## 변경 전 실패`, find the test case that makes the assertion and show, as path:line in the code before the change, where it gives the old result, so the assertion fails there. When no test case makes it, or it would pass before the change, `## 설계 대조` is `실패`.
>
> Write `<run dir>/agent/review.md` in exactly this form:
>
> ```markdown
> ## 설계 대조
>
> 판정: 통과
>
> (on 실패: what differs from the design, as path:line and the design item)
>
> ## 룰 체크
>
> - `api.md` — 판정: 통과
>
> (on 실패: which rule was broken where, as path:line and the rule sentence)
>
> ## 정확성
>
> 판정: 통과
>
> (on 실패: one line per problem: where, as path:line, the caller path that reaches it, and what goes wrong)
>
> ## 변경 전 실패
>
> - <test file> — <test case>: <path:line before the change> gives <the old result>, so <the assertion> fails
> ```
>
> `## 변경 전 실패` is there only when `2-plan.md` names assertions, one line each, also on a pass, and holds no verdict.
>
> On a `실패`, also judge whether the code or the design must change, from `<run dir>/agent/fails.md` (a round for each time dev passed after a failure, quoting the failure it set out to fix; a run from before fails.md has them under `### 읽은 실패` in each round of `<run dir>/agent/dev-diff.md`): `설계` when what fails is what the design asks for, or an earlier round already quoted the same failure; `구현` otherwise. Add, only on a failure:
>
> ```markdown
> ## 실패 원인
>
> 원인: 구현
> ```
>
> with `원인: 구현` or `원인: 설계` on a line of its own, then why on the lines below.
>
> Each verdict is exactly `통과` or `실패`. `## 룰 체크` has one line per listed rule file, by file name, and no others. With no rules listed, it holds only the line `적용 대상 없음`. What you write on a failure is all dev or plan gets to fix it, so be specific.

## 3. Follow the outcome

When the reviewer is done, call `mcp__rein__status` and act on the stage:

- `qa`: the review passed. Invoke the `rein:qa` skill.
- `dev`: the reviewer judged the failure an implementation problem; `failFile` is `review.md`. Invoke the `rein:dev` skill.
- `plan`: the reviewer judged the failure a design problem (`## 실패 원인` of `review.md`). Tell the user what failed, with the evidence the failure files give (an output line, a `path:line`); a cause no file shows is your guess: say `추측` and how to check it. Then invoke the `rein:plan` skill. The revised `2-plan.md` moves on once it is approved through `mcp__rein__advance`.
- still `review`, `halt: failure-route`: the implementation failures (the reviewer's, or a failed precheck) reached the hook's limit, so the run stopped. Read the file the halt names (`review.md` or `precheck.md`), decide whether the code or the design must change, and call `mcp__rein__advance` with `dev로 보냄` or `plan으로 보냄`; when you cannot decide it alone, ask the user. Then invoke the skill of the stage the run went to. Do not spawn the reviewer again during this halt.
- still `review`: the reviewer wrote nothing that passed the hook. Spawn it again with the same task. In a split review, status names the groups still to review; spawn a reviewer for each of them.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are. `폐기` also removes the run's worktrees and their branch, and what was not committed in them; `보류` and `완료` keep them. Park is refused while the hook is running commands; call it again once that is done.

## Do not

- Write `review.md`, `review-groups.md` or `review-<n>.md`. Only the reviewer's and the splitter's writes count; yours moves nothing.
- Fix code unless the user asks you to. A failure goes back to `dev`; a design file you change now is reviewed with the rest, and one you change after review is told to you (`mcp__rein__goto` with `review` has it reviewed again).
