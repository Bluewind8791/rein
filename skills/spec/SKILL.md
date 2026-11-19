---
name: spec
description: 요구사항이나 버그 보고로 Rein run을 시작하고 spec 단계를 진행한다. 사용자가 작업할 요구사항이나 버그 보고와 함께 /rein:spec을 입력했을 때 사용.
---

# spec stage

Take the user's request and write down **what is to be solved** and **how things are now**. Do not work out how to solve it.

## 0. Open the run first

This skill turns the run on. Do this before writing anything.

If `mcp__rein__status` is not available, not even as a deferred tool, the hook module did not load. Stop and write nothing. Tell the user to run `/rein:setup`, which finds the cause (most often a Claude Code older than 2.1.287), then start a new session and run `/rein:spec` again.

1. Call `mcp__rein__status`.
   - If this session already has a run open and the user wants something else, do not open a second one. Ask the user with `AskUserQuestion` whether to put the run aside (`보류`) or drop it (`폐기`), and call `mcp__rein__park` with the reason and their answer. If they keep it, stop and carry on with that run.
   - With no run open, status lists the runs of this project that can be resumed (deferred, or left active in another session). If the user asks to continue earlier work, or the request matches one of them, ask the user with `AskUserQuestion` whether to resume it. If yes, call `mcp__rein__resume` with its runId and `answer: "이어서 진행"` instead of opening a run. Then invoke the skill the result names and stop here. If what a judgment stood on changed while it was parked (an approved `1-spec.md`, a passed `2-plan.md`, a design file after dev), the result says so and the run went back to where that judgment is made again. Tell the user and invoke the skill the result names.
2. Spawn the `rein:slug` agent with the user's request. It returns one slug.
3. Call `mcp__rein__open_run` with `{ "runId": "<slug>" }`.
   - If it refuses because the session already has a run, **stop here**. Tell the user which run and stage are open. Do not open a second one.
   - If it refuses because the slug is taken or malformed, ask `rein:slug` again with the refusal text and retry.
   - If it refuses because the run's git worktree could not be made, no run was opened. Tell the user what git said (a branch `rein/<slug>` or a folder left from before is theirs to remove), and stop.
   - If the result lists deferred runs and the request continues one of them, ask the user. To resume it, call `mcp__rein__park` for the new run with their `폐기`, then `mcp__rein__resume` with their `이어서 진행`.
4. When plan passes, the run gets its own git worktree of each repository 2-plan.md names, the session root's too: `<repository>/.claude/worktrees/<slug>`, made from HEAD on branch `rein/<slug>`. Changes in the main working tree that are not committed will not be in it; when the request is about them, tell the user. The session stays in the main working tree: never call `EnterWorktree` for a run, since Claude Code then refuses writes to the run's other worktrees.
5. The result gives the absolute path of `1-spec.md`. In this stage write only that file; `rein:sketcher` draws `1-mockup.html` beside it (see Visuals). The hook does not refuse other writes or commands, but the stage's work is the spec; the code comes in dev. Investigate with `Read`, `Grep`, `Glob`, read-only git and other tools (an issue tracker, for one). If `mcp__rein__status` names a domain knowledge list, read it and look there first for the files of a screen or a feature, before you search the code.

## Output

One file, `1-spec.md`, at the path `open_run` returned.

It opens with a front matter block, before the title:

- `slug`: the runId `open_run` took.
- `유형`: `feature` (something new), `bugfix` (something broken) or `improvement` (something that works, changed). The grader weighs and scores the spec by it, and the hook refuses the grader without it. When the request could be read as two, ask the user.
- `목표`: in one line, what the user gets when this is done. Not the completion check: that says how to see it is done.
- `작성일`: today, as `YYYY-MM-DD`.
- `참조`: the reference (below), in double quotes.

1. **Problem**: what is wrong and why. When the request asks for two or more results that can each be done or fail on its own (a screen change, an export, a notification), list them below it under `결과물 (사용자 확인, YYYY-MM-DD):`, one per line, so that a result told in detail does not hide the ones told in a few words. With one result, leave the list out. See Results.
2. **Premise check**: what you checked of the request's own claims, and what the code says (see Doubt the request).
3. **Current behaviour**: how it works today and which files and places are involved, as `path:line`. Include the edge cases you found while investigating: empty or missing input, boundary values, failure paths, concurrent use, and behaviour around the change that must stay as it is. Say whether the code handles each one today, with `path:line`. Write only what applies. These are facts, not requirements.
4. **Completion check**: what being done looks like, in **one line**. `qa` checks against this line and nothing else, so write observable behaviour. "Works correctly" cannot be checked; do not write that. If an edge case must hold when the work is done, name it in this line, for example "... also when the list is empty". Edge cases left out of this line are checked by no one after the user approves it.
5. **Impact**: what depends on the code the change will touch, outside that code: callers, contracts others rely on (an API, a type, a schema, an event), configuration values, and documents that describe the behaviour. A symbol search misses much of it; look also for what reaches the code by name or by data: a DB table or column other queries read or write (SQL in mapper XML, another service, a batch job), a field of a response that a JSP, a script or another system reads, a name in a string (a bean or EL name, a key in a properties file, a reflective call), and a flag or setting that switches the behaviour. One line per path, `- <path> — <what relies on it and how>`, the path relative to the session root or absolute, `:line` allowed. Write `없음` when nothing does. These are facts, not decisions: `plan` must answer every path you list (change it, test it, or say why it stays safe), and the hook holds the plan until it does. A dependent that must not break when the work is done belongs in the completion check line too.

6. **Scope** (`## 범위`): which parts of the system the work reaches, beyond the code it touches. A request that names one screen in detail easily hides the API, the batch job or the permission setting it also needs. The table has one row per part, the rows of `template.md` always, and the rows a domain's knowledge adds (see below). Each row's 상태 is `대상` or `제외 (<why>)`, with its ground in `근거`: a `path:line`, or what you searched. Settle a row from the code where the work plainly does not reach that part; where the request leaves it open, mark it `[?]` and ask the user. A row not yet `대상` or `제외` fails the grade.
   - When the domain knowledge list `mcp__rein__status` names has a scope catalog for `## 범위`, read it and add its rows below the template's.

A file the user applies by hand outside the repositories (a DB script, a manual setting) is not a repository file: `plan` names it under `## 넘길 것` and `dev` writes it in the run folder's `handoff/`. When the completion check or the impact names such a file, say it lives in the run's `handoff/`; never give it a repository path such as `sql/`.

And the **reference**: the external issue or ticket number, which goes into the commit message in `land`. It goes in `참조:` of the front matter, in double quotes (`#42` unquoted is a YAML comment).

- If the request has a number, copy it as is, for example `ISSUE-123` or `#42`.
- If not, ask the user for it with `AskUserQuestion` before the run stops for approval (End). Never make one up.
- If the user has none, write `없음`.

And, only when there are any, the **open questions**: what the user chose to leave open, when they answer a question with "later" or say it is enough while gaps are left. One line each under `## 미해결 질문`: `- <question>`. Never put a gap there yourself: a gap the user decides is asked (see Grading and questions). The user sees these lines when they approve the spec, and `plan` writes an assumption for each in `2-plan.md`. Anything undecided inside another section is marked there with `[?]`.

Write the file in Korean, in the form of `template.md` in this skill's directory. Read it with `Read` before you write `1-spec.md`, and keep its front matter keys and headings exactly as they are.

Leave out `## 미해결 질문` when nothing is open.

## Doubt the request (`## 전제 확인`)

The request is a claim, not a fact. A planning document says a screen is new; a user says something is broken. Either can be wrong: the screen was built in an earlier round, the bug cannot happen the way it was told. Check each claim against the code before you build the spec on it, and write what you checked under `## 전제 확인`, one line per claim.

- **A bug report**: follow the code path the report describes and see whether the symptom can happen. Write the condition under which it happens and where, as `path:line`: `- <reported symptom> — 재현: <condition>, <path:line>`. If the code cannot produce it, write `재현 안 됨: <why>, <path:line>`.
- **A new screen, popup or feature**, from a planning document or from the user: search whether it already exists anywhere, not only under the menu or folder where it would go. Search its name as the request words it, the planning document's section number (code comments cite it, for example `§2.9.4`), and the `title:` of the domain knowledge's pages in every domain. Write what you searched and what you found: `- <what the request calls new> — 검색: <names, section numbers, places> → 없음` or `→ 있음: <path:line>`.
- **What the request points at** (a screen, menu, tab, column or value): the request's words may not name the thing the requester sees. A relayed request (`~라고 함`, a Q&A or ticket) loses the original words, the same name can mean several places, and a value is often made in one place and shown in others. Search where the named thing appears (screen titles, menus, column headers, the knowledge's `title:`) and what else shows the same value. When more than one place fits, or the request is relayed and its words do not match one place exactly, ask the user with `AskUserQuestion`, before working out any formula, which one the requester means, with their original words if the user has them. Write it as `- 대상 — <screen / column> (<who>, YYYY-MM-DD)`.
- Never write that something does not exist from a look at one menu or one folder.

When a check contradicts the request (the bug does not happen as reported, or the new thing already exists), ask the user with `AskUserQuestion` at once, before any other question: show what you found, and ask whether to go on as asked, change the request, or drop the run. Write their answer on that line.

## Results (`결과물` in `## 문제`)

A request often tells one result in detail and the others in a few words, and the questions then follow the detailed one. Before the first grade, read the request for the results it asks for, each one something that can be done or fail on its own. Do not count the steps or fields of one result as results.

When there are two or more, confirm the list with the user with `AskUserQuestion` before the first grade: the first question, after any premise question (see Doubt the request). Show the list and ask whether a result is missing, or should be merged, split or left out of this run. Write the confirmed list into `## 문제`. A result the user leaves out stays on the list as `- <result> — 제외 (사용자, YYYY-MM-DD: <why>)`.

The grader checks that the completion line covers every result on the list not marked `제외`.

## Planning document (`## 기획서 대조`)

When the request comes with a planning document (a PDF, slides, an HTML page, a drawing of the screens, an image pasted into the conversation), its requirements go into `1-spec.md` under `## 기획서 대조`, one line each. Without one, leave the section out.

The run keeps its own copy of each document, in the run folder's `brief/` (the folder of `1-spec.md`), since the original may move or go:

- Copy each document file the user gives into `brief/` as soon as the run is open, keeping its file name: `mkdir -p "<run folder>/brief" && cp "<document>" "<run folder>/brief/"`.
- For a `.pptx`, also make its PDF next to the copy: `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/pptx-to-pdf.ps1" "<run folder>/brief/<name>.pptx"`. It writes `<name>.pdf` beside it, keeping what lies off the slides. When it fails (exit 2: PowerPoint is not installed), keep the `.pptx` alone and go on.
- The images the user pasted with the request are there already: the hook saves them as `brief/paste-1.png`, `brief/paste-2.png`, … in paste order (the extension follows the image type). An image pasted later in the spec talk is saved with the next number as `rein:collator` starts, and when `1-spec.md` is approved.

Then write the section:

- Read the whole document in scope, every page: the text and the pictures. A callout, an arrow or a numbered note on a screenshot is a requirement too.
- One block per document: a line ``원본: `brief/<file>` (<pages>)`` naming the copy in `brief/` (for slides, the `.pptx`), then that document's lines right below it, until the next `원본:` line.
- `(<pages>)` maps the page numbers printed on the document, which the lines use, to the file's own pages (a PDF's pages, a deck's slides, counted from 1), and so gives the pages in scope: `(p.3~p.5 = 1~3쪽)`, `(p.7 = 2쪽)`. When the document prints no page numbers, the lines use the file's pages: `(p.1~p.<N> = 1~<N>쪽)`. An image has no pages: no parentheses, and its lines have no `p.<n>`.
- Go through each document page by page, in its order, one line per requirement: `- p.<n> <the requirement> — <status>` (for an image, `- <the requirement> — <status>`). One line holds one thing: a table's columns, a click and what it opens, a default value, a button and where it sits, a rule. The layout of a new or changed screen goes here too: how many columns each table has, the order of the fields, which cells are clickable. Keep the document's words where you can; do not summarize several requirements into one line.
- The status is one of:
  - `포함`: done as the document says.
  - `변경: <what instead> (사용자, YYYY-MM-DD)`: the user changed it.
  - `제외 (사용자, YYYY-MM-DD: <why>)`: the user left it out.
  - `[?] <what is undecided>`: the document leaves it open or contradicts itself, or it is not settled yet.
- Only the user changes or leaves out a requirement. When you think one should change, ask; never write `변경` or `제외` on your own.
- When the user settles something about a requirement during the questions, rewrite its line at once.
- These lines are the requirements of the screens. Do not copy them into other sections; `## 문제` says why the work is needed.

`rein:collator` checks the section against the document. It reads `1-spec.md` and the documents its `원본:` lines name, never the conversation, so give it the path of `1-spec.md` alone. It answers with the requirements that have no line and the `포함` lines that say something else than the document; it does not report `변경`, `제외` or `[?]` lines.

1. Once the first `1-spec.md` is written, before the as-is picture and the first grade, spawn `rein:collator`. Add each missing requirement as a `포함` line, or `[?]` when the document leaves it open, and correct each line it reports. When it could not read part of a document, tell the user.
2. In End, before you call `mcp__rein__advance`, spawn it again if `1-spec.md` changed since it last ran, and do the same with its answer.

## Visuals (`1-mockup.html`)

`rein:sketcher` draws `1-mockup.html` next to `1-spec.md`, only when a picture makes the change easier to understand. You decide whether it does:

- The change alters the layout of a screen, or adds a screen: draw it. This is required.
- The change alters a flow, states, a structure or how data moves, and a diagram helps: draw it, at the to-be step only.
- Anything else, such as a wording fix or a one-line bug: no picture. Do not spawn the sketcher.

It draws twice:

1. **as-is**, before the questions. Once the first `1-spec.md` is written, with `[?]` where something is undecided, and before the first grade, spawn `rein:sketcher` with `as-is` in the Agent call's description. It draws the screens as they are now and puts each `[?]` as a yellow note where it belongs. Tell the user the path in one line: keep it open while answering; the yellow notes are what you will ask about.
2. **to-be**, once the grading is over: the grade passes or the user says it is enough. Before you call `mcp__rein__advance` in End, spawn `rein:sketcher` with `to-be` in the description. It rewrites the file: the as-is above, the target below, and each line of `## 미해결 질문` as a red note. When the user asks for changes, revise and grade again, then draw the to-be again.

How to work with it:

- The hook writes the sketcher's task and drops your prompt, so a short prompt does. The description must name exactly one of `as-is` and `to-be`; the hook refuses the spawn otherwise.
- The sketcher reads `1-spec.md`, the planning documents its `원본:` lines name, and the code, never the conversation. Anything the picture must show has to be in `1-spec.md` first.
- When the request comes with a planning document, the layout of each new or changed screen is in `## 기획서 대조` (see Planning document) and in the document's own picture of it. The sketcher lays the to-be out as that picture does, in the look of the existing screen it follows; without a picture, it follows `## 기획서 대조`, and without that, the existing screen's layout.
- A to-be drawn from a picture is checked against it. After the sketcher writes it, the hook renders each such screen and its result tells you to spawn `rein:layout-verifier` (a short prompt does; the hook writes its task). It compares the rendered to-be with the picture, screen by screen. When one differs, the hook's answer tells you to spawn `rein:sketcher` with `to-be` again, and it draws with what differs; do so until the verifier says every screen matches. After five drawings in a row that differ, the hook stops the loop: tell the user what still differs. When the hook could not render the mockup (no Chrome or Edge), it says so: tell the user and go on. Approval names the result.
- Its answer lists the anchors, `#<id>` per screen. When a question is about a region of a screen, cite its anchor, for example `1-mockup.html#order0101`, and point at what is there instead of describing it in code terms. Without a picture, name the screen, the region and the label in words.
- The picture never blocks the spec. If the sketcher fails or answers `not drawn`, go on, and tell the user what is missing.
- Do not write `1-mockup.html` yourself. The hook does not refuse it, but advance then tells the user the picture is older than `1-spec.md`.
- `1-spec.md` stays the spec. The hook checks only `1-spec.md`, `plan` works from it, and `qa` checks only the completion line. A picture adds no requirement: if the to-be shows something that must hold when the work is done, say it in the completion line.

## Grading and questions

A grader that sees only `1-spec.md` scores it, and you close its gaps one question at a time. The hook keeps the pace. Start once `1-spec.md` is written and, when a screen changes, its as-is is drawn (see Visuals).

1. Spawn the `rein:grader` agent. The hook writes its task and drops your prompt, so a short one does. It runs in the foreground, reads only `1-spec.md` and writes `grade.md`. Its answer is the hook's summary: the ambiguity, each dimension's score, and what to do next. `mcp__rein__status` shows the same.
   - The dimensions: 문제, 완료 판정 and 경계 조건, which the user decides; 현행 동작 and 영향 범위, which are facts. Each `유형` weighs them its own way, and the grader scores each against anchors for 0.2, 0.6 and 1.0 written for that `유형`.
   - Ambiguity = 1 − Σ(score × weight). It passes at 0.25 or less, unless a hard gate holds: a `## 범위` that is missing, lacks a row of the template, or has a row neither `대상` nor `제외`.
   - The grader cannot be spawned again until `1-spec.md` changes.
2. If the grade passes, go to End.
3. Otherwise do what the summary says:
   - A fact with a gap (현행 동작, 영향 범위): read the code and fill it in. Never ask the user for a fact.
   - Ask the user **one** question with `AskUserQuestion`, on the first gap of the weakest dimension the summary names, citing the anchor of the screen region it is about when there is a picture. One question per call; the hook refuses more.
   - Open the question with one line on where the grading stands, so the user sees why they are asked: the dimension it is about, its score and the ambiguity of the last grade, for example `[완료 판정 0.4 · 모호도 0.42]`.
   - Put the option you recommend first, with `(추천)` at the end of its label, and word the question so that choosing it is a plain yes: the user never has to say no to something first to take it. Recommend only what the code, the planning document or another screen's precedent supports, and say which in the option's description. When nothing supports one option over the others, recommend none.
   - Write the question for someone who knows the screens, not the code. Its first sentence says how it works now and what would change, in the words the screen shows; leave out column, table and class names. A word the screen does not show (a status code such as `01`, a term from the code or the data), and a term of the business the user may not know even when the screen shows it (an accounting term such as 감가상각누계액 or 유동자산), gets its meaning in the same sentence, with a small example in numbers. When the options give different numbers or rows, show a few real rows of each side by side.
   - When the question settles how a screen behaves in a state the planning document does not draw (no data for the period, a failed lookup, a missing value), first find how other screens of the same app show that state, in the same menu first. Offer those as the options, each with its `path:line`. If the user picks a way no screen uses, say so on the spec line: `(선례 없음)`.
   - Write the answer into `1-spec.md` at once, before the next question.
   - The user may answer with a question of their own instead: what a word or an option means, how it works today, whether the planning document says so, how another screen does it, or a request to explain it more simply. That is not an answer, even when it leans one way ("X만 빼면 되는 거 아니야?"). Do not write it into `1-spec.md` as a decision, and do not move on to another gap. Investigate if it needs the code or the data, then answer it in text, in the screen's words. End with your question again, reworded with what you just explained, and stop the turn. Their next message answers it; write that into `1-spec.md`. When they ask for simpler words, keep to them for every question after, not only this one.
   - After 3 questions, spawn the grader again. The hook refuses a 4th question until a grade comes in.
   - If the summary says the last three grades barely moved, the questions are going in circles. Ask from another angle, one of these, each at most once per run:
     - **The opposite**: question the assumption under the gap. "If this condition did not hold, would the answer change?" It shows whether the condition is a real requirement or a habit.
     - **The smallest version**: ask what the smallest result is that would still be worth having. When the user narrows the request, rewrite the completion line to match; whatever they leave for later goes to `## 미해결 질문` only when they say so.
     - **The core**: when the words for the thing keep shifting between answers (a screen, a list and a report for the same thing), ask which one screen, value or record the request is about, before any detail.
4. If the user says it is enough (`충분`, or the like), move each gap still open to `## 미해결 질문`, then go to End. Show them the ambiguity left, as advance gives it, when the run stops for their approval.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, at any point, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are.

## Do not

- Propose or design a solution. That is `plan`'s job.
- Split scope into "in / out" lists. Three exceptions: the rows of `## 범위`, one per part of the system, the `제외` lines of `## 기획서 대조`, the user's own decisions about a planning document, and the `제외` lines of the results in `## 문제`, the user's own decisions about the request.
- Turn the completion check into a list of acceptance criteria. It is one line, even when it names edge cases.
- Edit source code. The worker writes it in dev.

Keep this stage light. Investigate first, then write the problem and the completion check on top of what you found.

## End

**Human approval is required**. The run stops once `1-spec.md` is ready, and the user approves it by typing `/rein:plan`: the `rein:plan` skill passes their answer to `mcp__rein__advance`. You do not ask for the approval, and you never pass `승인` yourself; the hook cannot tell. (`mcp__rein__goto` can move the run past spec without it; use it only when the user asks for that.) The one exception is an autopilot run (`/rein:autopilot`, status shows `autopilot: on`): when advance's result in step 3 says `autopilot run`, pass `승인` with `said` set to `autopilot` as it says, tell the user in one line, and go on with the skill the result names instead of steps 4 and 5.

1. Make sure the reference is filled in (see above). With a planning document, spawn `rein:collator` again if `1-spec.md` changed since it last ran (see Planning document).
2. Make sure the last grade is of `1-spec.md` as it is now. If you changed it after the grade, spawn `rein:grader` again; advance refuses otherwise. If the change gets a picture, draw its to-be now (see Visuals).
3. Call `mcp__rein__advance` without `answer`. The hook first checks that `1-spec.md` has a line under `## 완료 판정`, a filled `참조:` in the front matter and a `## 영향 범위` section with at least one `- <path> — ...` line or `없음`; if one is missing it refuses, so add it and call again. Then it answers that the run waits for the user, with what it knows: the ambiguity, `1-mockup.html` if there is one, with a warning when it is older than `1-spec.md`, the lines of `## 미해결 질문` if any, and, when the run came back to spec, what changed since the user approved it. If `1-mockup.html` is older, spawn `rein:sketcher` with `to-be` and call advance again; if that fails, keep the warning for the user.
4. Tell the user in a few lines what the spec says, with the absolute path of `1-spec.md`, and of `1-mockup.html` if there is one, and everything step 3 gave. Tell them how to go on: they type `/rein:plan` to approve it, here or in a new session (`/rein:plan <slug>` there, the slug being this run's runId); or they tell you what to change; when the grade does not pass, they may also want more questions. Then stop.
5. When the user tells you what to change, revise `1-spec.md` as they said, grade it again and come back to step 3. When they want more questions, go back to Grading and questions.
