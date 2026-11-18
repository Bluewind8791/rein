---
name: autopilot
description: 작은 작업을 Rein run 하나로 시작해, spec 질문 말고는 사람을 기다리지 않고 land까지 진행한다. 사용자가 작업할 요구사항이나 버그 보고와 함께 /rein:autopilot을 입력했을 때만 사용.
disable-model-invocation: true
---

# autopilot

The user typed `/rein:autopilot` with a request instead of `/rein:spec`: they judged the work small enough to go from spec to land in one go. The request: `$ARGUMENTS`.

## Start

Invoke the `rein:spec` skill with the request and follow it, with one difference: in its step 0.3 call `mcp__rein__open_run` with `{ "runId": "<slug>", "autopilot": true }`. Everything else in spec is as that skill says: the spec's questions are asked as usual.

## What changes

The run records `autopilot: on` (`mcp__rein__status` shows it). Where a run would stop for the user, the hook's result says `autopilot run` and names the answer to pass yourself. Pass it with `said` set to `autopilot`, tell the user in one line what passed with the paths the result gives, and go on with the skill the next result names. That happens at four points:

- `1-spec.md`'s approval at the end of spec (`승인`), instead of the user typing `/rein:plan`.
- `2-plan.md`'s approval at the end of plan (`승인`), instead of `/rein:dev`, when the design passed its review and every `.rein/config.json` is as at HEAD.
- The integration test, once work qa passed with e2e checks (`e2e 실행 (Ego)`), instead of the user testing by hand or typing `/rein:e2e`.
- The commit in land (`커밋`), instead of the user's approval.

Pass the answer only where the hook's result says `autopilot run`. Everywhere else, do what the stage's skill says, the user's questions included:

- The spec's questions, and the reference (`참조:`).
- A plan that failed its design review twice, or a config that differs from HEAD: the hook waits for the user as in any run.
- What only a person can check in integration qa: a to-be screen of `1-mockup.html` to compare (`layout-unchecked`), an ego check handed to the user (a login, a second factor), a check the user takes by hand, and whether the change is in the app the checks open. Stop there and tell the user what to do.
- A halt: you judge it as the stage's skill says, and ask the user when you cannot.

The run never pushes. When it closes, the retrospective runs as usual.
