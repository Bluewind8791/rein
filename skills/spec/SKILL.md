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
   - If it refuses because the session root's repository has not been set up for Rein, invoke the `rein:setup` skill for the repository it names, then call `open_run` again with the same runId.
   - If it refuses because the run's git worktree could not be made, no run was opened. Tell the user what git said (a branch `rein/<slug>` or a folder left from before is theirs to remove), and stop.
   - If the result lists deferred runs and the request continues one of them, ask the user. To resume it, call `mcp__rein__park` for the new run with their `폐기`, then `mcp__rein__resume` with their `이어서 진행`.
4. When plan passes, the run gets its own git worktree of each repository 2-plan.md names, the session root's too: `<repository>/.claude/worktrees/<slug>`, made from HEAD on branch `rein/<slug>`. Changes in the main working tree that are not committed will not be in it; when the request is about them, tell the user. The session stays in the main working tree: never call `EnterWorktree` for a run, since Claude Code then refuses writes to the run's other worktrees.
5. The result gives the absolute path of `1-spec.md`. In this stage write only that file; `rein:as-is` and `rein:sketcher` draw `1-mockup.html` beside it (see Visuals). The hook does not refuse other writes or commands, but the stage's work is the spec; the code comes in dev. Investigate with `Read`, `Grep`, `Glob`, read-only git and other tools (an issue tracker, for one). If `mcp__rein__status` names a domain knowledge list, read it and look there first for the files of a screen or a feature, before you search the code. Every question to the user in this stage, from the first premise question on, goes through `AskUserQuestion` with one question per call; the hook refuses a call with more. When you have several, ask the one the others depend on first.

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
3. **Screens** (`## 화면`): when the change alters the layout of a screen or adds one, the screens it shows, one row each, filled while you check the premise; leave the section out otherwise. `id` is the screen's code (a popup's too, `order0101p01`), the anchor of its picture, and stays the same. `URL` and `진입 파일` say where the screen is, `-` where there is none. `종류` is `변경` for a screen that exists, `새 화면` for a new one, and `새 화면, 따를 화면 <id>` for a new one built in the look of an existing screen, whose as-is is then drawn for reference. `rein:as-is` draws the as-is from this table, the domain knowledge and the code, never from the rest of `1-spec.md`.
4. **Current behaviour**: how it works today and which files and places are involved, as `path:line`. Include the edge cases you found while investigating: empty or missing input, boundary values, failure paths, concurrent use, and behaviour around the change that must stay as it is. Say whether the code handles each one today, with `path:line`. Write only what applies. These are facts, not requirements.
5. **Completion check**: what being done looks like, in **one line**. `qa` checks against this line and nothing else, so write observable behaviour. "Works correctly" cannot be checked; do not write that. If an edge case must hold when the work is done, name it in this line, for example "... also when the list is empty". Edge cases left out of this line are checked by no one after the user approves it.
6. **Impact**: what depends on the code the change will touch, outside that code: callers, contracts others rely on (an API, a type, a schema, an event), configuration values, and documents that describe the behaviour. A symbol search misses much of it; look also for what reaches the code by name or by data: a DB table or column other queries read or write (SQL in a query or ORM mapping file, another service, a batch job), a field of a response that a page template, a script or another system reads, a name in a string (a name the framework resolves at run time, such as an injected component or a template expression, a key in a configuration file, a reflective call), and a flag or setting that switches the behaviour. One line per path, `- <path> — <what relies on it and how>`, the path relative to the session root or absolute, `:line` allowed. Write `없음` when nothing does. These are facts, not decisions: `plan` must answer every path you list (change it, test it, or say why it stays safe), and the hook holds the plan until it does. A dependent that must not break when the work is done belongs in the completion check line too.

7. **Scope** (`## 범위`): which parts of the system the work reaches, beyond the code it touches. A request that names one screen in detail easily hides the API, the batch job or the permission setting it also needs. The table has one row per part, the rows of `template.md` always, and the rows a domain's knowledge adds (see below). Each row's 상태 is `대상` or `제외 (<why>)`, with its ground in `근거`: a `path:line`, or what you searched. Settle a row from the code where the work plainly does not reach that part; where the request leaves it open, mark it `[?]` and ask the user. A row not yet `대상` or `제외` fails the grade.
   - When the domain knowledge list `mcp__rein__status` names has a scope catalog for `## 범위`, read it and add its rows below the template's.

A file the user applies by hand outside the repositories (a DB script, a manual setting) is not a repository file: `plan` names it under `## 넘길 것` and `dev` writes it in the run folder's `handoff/`. When the completion check or the impact names such a file, say it lives in the run's `handoff/`; never give it a repository path such as `sql/`.

And the **reference**: the external issue or ticket number, which goes into the commit message in `land`. It goes in `참조:` of the front matter, in double quotes (`#42` unquoted is a YAML comment).

- If the request has a number, copy it as is, for example `ISSUE-123` or `#42`.
- If not, ask the user for it with `AskUserQuestion` before the run stops for approval (End). Never make one up.
- If the user has none, write `없음`.

And, only when there are any, the **open questions**: what the user chose to leave open, when they answer a question with "later" or say it is enough while gaps are left. One line each under `## 미해결 질문`: `- <question>`. Never put a gap there yourself: a gap the user decides is asked (see Grading and questions). The user sees these lines when they approve the spec, and `plan` writes an assumption for each in `2-plan.md`. Anything undecided inside another section is marked there with `[?]`.

And, when the user has decisions to make, the **decision tree** (`## 결정 트리`): the record of those decisions and what each rests on, from which you pick each question (see Decision tree).

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

## Requirements (`## 요구사항`)

`## 요구사항` lists the requirements this run adds, changes, puts off or drops, one line each. Write it always, with or without a planning document: a request told in words has requirements too. When the run lands, its lines go into the screen documents (see Screen documents), and the next run on the same screen starts from them.

- Only this run's lines. A row a screen document has already is not copied: write only what the request adds, changes or drops.
- Each line ends with the element it is about, `[<data-id>]`: the `data-id` of that element in the to-be, a dot-separated path in lowercase Latin (`search.period`, `list.col.amount`, `toolbar.excel`), or `[-]` for a rule of the whole screen. You name the key, and `rein:sketcher` gives the element that `data-id`. An element a screen document has already keeps its key. When `## 화면` has two or more screens, put the screen id first: `[order0101/search.period]`, `[order0101p01/-]`. A run with no `## 화면` writes its lines without an element.
- The lines of the request itself come first, above any `원본:` line: `- <the requirement> — <status> [<element>]`.
- The status is one of:
  - `포함`: done as asked, or as the document says.
  - `변경: <what instead> (사용자, YYYY-MM-DD)`: the user changed it.
  - `보류 (사용자, YYYY-MM-DD: <why>)`: the user put it off to a later run.
  - `제외 (사용자, YYYY-MM-DD: <why>)`: the user dropped it for good.
  - `[?] <what is undecided>`: the request or the document leaves it open or contradicts itself, or it is not settled yet.
- Only the user changes, puts off or leaves out a requirement. When you think one should change, ask; never write `변경`, `보류` or `제외` on your own.
- When the user settles something about a requirement during the questions, rewrite its line at once.
- These lines are the requirements of the screens. Do not copy them into other sections; `## 문제` says why the work is needed.

### Screen documents

The requirements earlier runs landed live in one screen document per screen, `~/.rein/<project>/requirements/<domain>/<screen id>.md`, a table of rows: 요소 (the `data-id`, or `-`), 요구사항, 상태 (`구현됨`, `보류` or `폐기`), 근거 and the run that last changed it. When `1-spec.md` names a screen of `## 화면` that has one, the write's result gives its path; `mcp__rein__status` names them too.

- Read each one before you write the screen's lines. Its rows are decisions already made.
- When the request touches a row (changes a `구현됨` row, or brings back a `보류` or `폐기` one), ask the user with `AskUserQuestion` before you write the line, showing the row and its 근거.
- `rein:sketcher` keeps the rows `1-spec.md` says nothing of, and `rein:collator` reports where a planning document differs from a row. The hook gives both the documents.
- A screen with no document yet that earlier completed runs touched: the write's result names their `1-spec.md` instead. Read them the same way: what they landed is a decision already made. Land writes the screen's first document from them.

### Planning document

When the request comes with a planning document (a PDF, slides, an HTML page, a drawing of the screens, an image pasted into the conversation), its requirements go under `## 요구사항` too, one block per document.

The run keeps its own copy of each document, in the run folder's `brief/` (the folder of `1-spec.md`), since the original may move or go:

- Copy each document file the user gives into `brief/` as soon as the run is open, keeping its file name: `mkdir -p "<run folder>/brief" && cp "<document>" "<run folder>/brief/"`.
- For a `.pptx`, also make its PDF next to the copy: `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/pptx-to-pdf.ps1" "<run folder>/brief/<name>.pptx"`. It writes `<name>.pdf` beside it, keeping what lies off the slides. When it fails (exit 2: PowerPoint is not installed), keep the `.pptx` alone and go on.
- The images the user pasted with the request are there already: the hook saves them as `brief/paste-1.png`, `brief/paste-2.png`, … in paste order (the extension follows the image type). An image pasted later in the spec talk is saved with the next number as `rein:collator` starts, and when `1-spec.md` is approved.

Then write the section:

- Read the whole document in scope, every page: the text and the pictures. A callout, an arrow or a numbered note on a screenshot is a requirement too.
- One block per document: a line ``원본: `brief/<file>` (<pages>)`` naming the copy in `brief/` (for slides, the `.pptx`), then that document's lines right below it, until the next `원본:` line.
- `(<pages>)` maps the page numbers printed on the document, which the lines use, to the file's own pages (a PDF's pages, a deck's slides, counted from 1), and so gives the pages in scope: `(p.3~p.5 = 1~3쪽)`, `(p.7 = 2쪽)`. When the document prints no page numbers, the lines use the file's pages: `(p.1~p.<N> = 1~<N>쪽)`. An image has no pages: no parentheses, and its lines have no `p.<n>`.
- Go through each document page by page, in its order, one line per requirement: `- p.<n> <the requirement> — <status> [<element>]` (for an image, `- <the requirement> — <status> [<element>]`), with the statuses above. One line holds one thing: a table's columns, a click and what it opens, a default value, a button and where it sits, a rule. The layout of a new or changed screen goes here too: how many columns each table has, the order of the fields, which cells are clickable. Keep the document's words where you can; do not summarize several requirements into one line.
- A requirement a screen document already holds as it is needs no line. One the document asks anew or otherwise than a row does gets its line, and the question above (ask before you write it).

`rein:collator` checks the section against the document, only when there is a planning document. It reads `1-spec.md` and the documents its `원本:` lines name, never the conversation, so give it the path of `1-spec.md` alone; the hook adds the screen documents. It answers with the requirements that have no line, the `포함` lines that say something else than the document, and, under `지난 결정과 다름:`, the requirements of the document that differ from a row of a screen document; it does not report `변경`, `보류`, `제외` or `[?]` lines.

1. Once the first `1-spec.md` is written, before the first picture and the first grade, spawn `rein:collator`. Add each missing requirement as a `포함` line, or `[?]` when the document leaves it open, and correct each line it reports. For each difference from a screen document, ask the user which holds, and write their answer as the line. When it could not read part of a document, tell the user.
2. In End, before you call `mcp__rein__advance`, spawn it again if `1-spec.md` changed since it last ran, and do the same with its answer.

## Visuals (`1-mockup.html`)

`1-mockup.html` sits next to `1-spec.md`, only when a picture makes the change easier to understand. You decide whether it does:

- The change alters the layout of a screen, or adds a screen: draw it. This is required.
- The change alters a flow, states, a structure or how data moves, and a diagram helps: draw it, in End only.
- Anything else, such as a wording fix or a one-line bug: no picture. Do not spawn the agents below.

Two agents draw it, and the hook joins their files into `1-mockup.html`:

- `rein:as-is` draws each screen of `## 화면` as it is now, whole, from that table, the domain knowledge and the code, into `agent/asis.html`. The code does not change during spec, so it draws each screen once.
- `rein:sketcher` draws the target of each screen in the as-is's look, with pins on it, into `agent/tobe.html`: a yellow pin marks each `[?]` where it applies, a red pin each line of `## 미해결 질문`, a gray pin a rule the spec settles. It reads `1-spec.md`, the planning documents its `원본:` lines name and the as-is, never the code or the conversation. The user reads the target as the planning document of the work, so it is drawn from the start and kept up with the answers.

1. **First**, once the first `1-spec.md` with its `## 화면` is written, with `[?]` where something is undecided, and before the first grade: spawn `rein:as-is`, then `rein:sketcher` in the foreground. The hook refuses the sketcher while a screen of `## 화면` has no as-is. A `[?]` part is drawn as the planning document's picture shows it, or as the screen is now. Tell the user the path in one line: keep it open while answering; the yellow pins are what you will ask about.
2. **After each answer** you write into `1-spec.md` that changes what a screen shows (a `[?]` settled, a requirement changed or left out), spawn `rein:sketcher` again with `run_in_background: true`, and ask your next question without waiting for it. Only the last one spawned writes, so a drawing still under way when you spawn the next is dropped. When the answer adds a screen to `## 화면`, spawn `rein:as-is` first, in the foreground: it draws only the screens not drawn yet.
3. **In End**, before you call `mcp__rein__advance`, if `1-spec.md` changed since the last drawing, spawn `rein:sketcher` in the foreground. When the user asks for changes, revise and grade again, then draw again.

How to work with them:

- The hook writes both agents' tasks and drops your prompt, so a short prompt does. The one exception: when the user says the as-is of a screen differs from the real one, spawn `rein:as-is` with the screen's id and what the user said as the prompt. With every screen of `## 화면` drawn, the hook passes that prompt on, and it draws that screen again; the hook then joins it into `1-mockup.html` with the target as it is. The as-is is checked by no one else.
- Anything the target must show has to be in `1-spec.md` first. When the sketcher's answer lists gaps under `spec에 없음:`, the target needed something `1-spec.md` does not say, and the sketcher did not make it up. Fill each: a fact (how the screen works today) from the code, a decision by asking the user, one question at a time as in Grading and questions. Then spawn `rein:sketcher` again.
- When the request comes with a planning document, the layout of each new or changed screen is in `## 요구사항` (see Planning document) and in the document's own picture of it. The sketcher lays the target out as that picture does, in the look of the as-is; without a picture, it follows `## 요구사항`, and without that, the as-is's layout.
- A target drawn from a picture is checked against it twice: after the first drawing, and in End, when advance finds the drawing not compared yet. The hook renders each such screen and tells you to spawn `rein:layout-verifier` (a short prompt does; the hook writes its task). It compares the rendered target with the picture, screen by screen. When one differs, the hook's answer tells you to spawn `rein:sketcher` again in the foreground, and it draws with what differs; do so until the verifier says every screen matches. When a drawing gets no closer to the picture, the hook stops the loop: tell the user what still differs. When the hook could not render the mockup (no Chrome or Edge), it says so: tell the user and go on. Approval names the result. A drawing redone for an answer is not compared.
- The sketcher's answer lists the anchors, `#<id>` per screen. When a question is about a region of a screen, cite its anchor, for example `1-mockup.html#order0101`, and point at what is there instead of describing it in code terms. Without a picture, name the screen, the region and the label in words.
- The picture never blocks the spec. If an agent fails or answers `not drawn`, go on, and tell the user what is missing.
- Do not write `1-mockup.html`, `agent/asis.html` or `agent/tobe.html` yourself. The hook does not refuse it, but advance then tells the user the picture is older than `1-spec.md`.
- `1-spec.md` stays the spec. The hook checks only `1-spec.md`, `plan` works from it, and `qa` checks only the completion line. A picture adds no requirement: if the target shows something that must hold when the work is done, say it in the completion line.

### The user's comments

While the run is in spec, the user can pin comments on the to-be in the frame, each on an element or on a whole screen. The hook hands the ones they saved to you with their next message, in a block that lists each one's number, screen, element and words, and for one they reopened, your last note on it. For each comment handed over:

1. When its meaning is unclear, or it can be read two ways, ask the user in the chat before you write anything.
2. Write it into `1-spec.md` at once, as you would an answer. A requirement it adds, changes, puts off or leaves out becomes a line of `## 요구사항` ending with the element the comment is on: `포함`, `변경: <what instead> (사용자, YYYY-MM-DD)`, `보류 (사용자, YYYY-MM-DD: <why>)` or `제외 (사용자, YYYY-MM-DD: <why>)`; anything else, rewrite the part of `1-spec.md` it is about.
3. Spawn `rein:sketcher` again as after an answer (see Visuals), once for all the comments of one message.
4. Mark it with `mcp__rein__comment`: `status: "done"` and a one-line `note` on what changed, or `status: "declined"` and a one-line `note` on why not (it contradicts what the user settled before, say). The user reads the note on the comment's card. When you are unsure whether to decline, ask the user first.

A comment the user reopens comes again with their next message; handle it the same way.

## Decision tree (`## 결정 트리`)

The user's decisions often rest on one another: whether a limit on rows matters depends on whether the export takes the current page or the whole search result. A question asked before the decision it rests on gets an answer built on a guess, and the answer is thrown away later. `## 결정 트리` lists the user's decisions with what each rests on, so that you ask only those whose ground is settled.

- Write it with the first `1-spec.md`, one line per decision the user has to make: each `[?]` of any section (`## 범위` and `## 요구사항` too), and later each gap a grade names. A fact the code fills never goes in it. The questions on the premise and on the results come first, outside the tree. With nothing to ask, leave the section out.
- One line per decision: `- Q<n> <the decision> — 선행: <the Q numbers it rests on, or 없음> — 위치: <the section its answer goes in> — <status>`. Number the lines in the order you add them. A number never changes; it never starts with `D`.
- The status is one of:
  - `열림`: not answered yet.
  - `결정: <the answer> (사용자, YYYY-MM-DD)`.
  - `정리됨: <why>`: an answer made it unneeded.
  - `미룸 (사용자, YYYY-MM-DD)`: the user left it open.
- Keep a closed line: change its status, never delete it.
- The tree only records. Write each answer into the section `위치:` names, as before (the `[?]` there settled). The grader does not score the tree, and `plan` designs from the other sections.
- **The frontier** is the set of `열림` lines whose every `선행` line is `결정`. Ask only from it, the line on the weakest dimension of the last grade first.
- After each answer, update the tree before the next question: mark the line answered, mark `정리됨` each line the answer made unneeded, add each decision the answer opened with its `선행`, then take the frontier again.
- When a line becomes `정리됨`, look at each line that rests on it: mark it `정리됨` too, or, when it still needs an answer, take the number out of its `선행` (`없음` when none is left). Otherwise it never reaches the frontier.
- When the user leaves a question open, mark its line `미룸`, and with it every `열림` line that rests on it, directly or through other lines. Write the question under `## 미해결 질문` as well.
- When the user points out a dependence the tree missed, fix that line's `선행`, and set back to `열림` the lines answered before the decision they rest on.

## Grading and questions

A grader that sees only `1-spec.md` scores it, and you close its gaps one question at a time. The hook keeps the pace. Start once `1-spec.md` is written and, when a screen changes, its first picture is drawn (see Visuals).

1. Spawn the `rein:grader` agent. The hook writes its task and drops your prompt, so a short one does. It runs in the foreground, reads only `1-spec.md` and writes `grade.md`. Its answer is the hook's summary: the ambiguity, each dimension's score, and what to do next. `mcp__rein__status` shows the same.
   - The dimensions: 문제, 완료 판정 and 경계 조건, which the user decides; 현행 동작 and 영향 범위, which are facts. Each `유형` weighs them its own way, and the grader scores each against anchors for 0.2, 0.6 and 1.0 written for that `유형`.
   - Ambiguity = 1 − Σ(score × weight). It passes at 0.25 or less, unless a hard gate holds: a `## 범위` that is missing, lacks a row of the template, or has a row neither `대상` nor `제외`.
   - The grader cannot be spawned again until `1-spec.md` changes.
2. If the grade passes, go to End.
3. Otherwise do what the summary says:
   - A fact with a gap (현행 동작, 영향 범위): read the code and fill it in. Never ask the user for a fact.
   - Add the gap of the weakest dimension the summary names to `## 결정 트리`, with the decisions it rests on, unless a line holds it already. Then ask the user **one** question with `AskUserQuestion`, from the tree's frontier (see Decision tree), citing the anchor of the screen region it is about when there is a picture.
   - Open the question with one line on where the grading stands, so the user sees why they are asked: the dimension it is about, its score and the ambiguity of the last grade, for example `[완료 판정 0.4 · 모호도 0.42]`.
   - Put the option you recommend first, with `(추천)` at the end of its label, and word the question so that choosing it is a plain yes: the user never has to say no to something first to take it. Recommend only what the code, the planning document or another screen's precedent supports, and say which in the option's description. When nothing supports one option over the others, recommend none.
   - Write the question for someone who knows the screens, not the code. Its first sentence says how it works now and what would change, in the words the screen shows; leave out column, table and class names. A word the screen does not show (a status code such as `01`, a term from the code or the data), and a term of the business the user may not know even when the screen shows it (an accounting or legal term, say), gets its meaning in the same sentence, with a small example in numbers. When the options give different numbers or rows, show a few real rows of each side by side.
   - When the question settles how a screen behaves in a state the planning document does not draw (no data for the period, a failed lookup, a missing value), first find how other screens of the same app show that state, in the same menu first. Offer those as the options, each with its `path:line`. If the user picks a way no screen uses, say so on the spec line: `(선례 없음)`.
   - Write the answer into `1-spec.md` at once, and update `## 결정 트리`, before the next question.
   - The user may answer with a question of their own instead: what a word or an option means, how it works today, whether the planning document says so, how another screen does it, or a request to explain it more simply. That is not an answer, even when it leans one way ("X만 빼면 되는 거 아니야?"). Do not write it into `1-spec.md` as a decision, and do not move on to another gap. Investigate if it needs the code or the data, then answer it in text, in the screen's words. End with your question again, reworded with what you just explained, and stop the turn. Their next message answers it; write that into `1-spec.md`. When they ask for simpler words, keep to them for every question after, not only this one.
   - After 3 questions, spawn the grader again. The hook refuses a 4th question until a grade comes in.
   - If the summary says the last three grades barely moved, the questions are going in circles. Ask from another angle, one of these, each at most once per run:
     - **The opposite**: question the assumption under the gap. "If this condition did not hold, would the answer change?" It shows whether the condition is a real requirement or a habit.
     - **The smallest version**: ask what the smallest result is that would still be worth having. When the user narrows the request, rewrite the completion line to match; whatever they leave for later goes to `## 미해결 질문` only when they say so.
     - **The core**: when the words for the thing keep shifting between answers (a screen, a list and a report for the same thing), ask which one screen, value or record the request is about, before any detail.
4. If the user says it is enough (`충분`, or the like), move each gap still open to `## 미해결 질문`, mark each `열림` line of `## 결정 트리` `미룸`, then go to End. Show them the ambiguity left, as advance gives it, when the run stops for their approval.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it. The commit in land still needs the user's approval.

## Stopping the run

If the user wants to stop, put aside or abandon the run, at any point, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are.

## Do not

- Propose or design a solution. That is `plan`'s job.
- Split scope into "in / out" lists. Three exceptions: the rows of `## 범위`, one per part of the system, the `보류` and `제외` lines of `## 요구사항`, the user's own decisions about a requirement, and the `제외` lines of the results in `## 문제`, the user's own decisions about the request.
- Turn the completion check into a list of acceptance criteria. It is one line, even when it names edge cases.
- Edit source code. The worker writes it in dev.

Keep this stage light. Investigate first, then write the problem and the completion check on top of what you found.

## End

**Human approval is required**. The run stops once `1-spec.md` is ready, and the user approves it by typing `/rein:plan`: the `rein:plan` skill passes their answer to `mcp__rein__advance`. You do not ask for the approval, and you never pass `승인` yourself; the hook cannot tell. (`mcp__rein__goto` can move the run past spec without it; use it only when the user asks for that.) The one exception is an autopilot run (`/rein:autopilot`, status shows `autopilot: on`): when advance's result in step 3 says `autopilot run`, pass `승인` with `said` set to `autopilot` as it says, tell the user in one line, and go on with the skill the result names instead of steps 4 and 5.

1. Make sure the reference is filled in (see above). With a planning document, spawn `rein:collator` again if `1-spec.md` changed since it last ran (see Planning document).
2. Make sure the last grade is of `1-spec.md` as it is now. If you changed it after the grade, spawn `rein:grader` again; advance refuses otherwise. If the change gets a picture and `1-spec.md` changed since the last drawing, draw it again now, in the foreground (see Visuals).
3. Call `mcp__rein__advance` without `answer`. The hook first checks that `1-spec.md` has a line under `## 완료 판정`, a filled `참조:` in the front matter and a `## 영향 범위` section with at least one `- <path> — ...` line or `없음`; if one is missing it refuses, so add it and call again. While a comment of the user on `1-mockup.html` is not marked, it refuses too, handing over the ones they saved since their last message: handle them (see The user's comments), grade again and call again. When the drawing was not compared with its planning-document picture yet, it refuses too and says what to spawn: do it, then call again (see Visuals). Then it answers that the run waits for the user, with what it knows: the ambiguity, `1-mockup.html` if there is one, with a warning when it is older than `1-spec.md`, the lines of `## 미해결 질문` if any, and, when the run came back to spec, what changed since the user approved it. If `1-mockup.html` is older, spawn `rein:sketcher` in the foreground and call advance again; if that fails, keep the warning for the user.
4. Tell the user in a few lines what the spec says, with the absolute path of `1-spec.md`, and of `1-mockup.html` if there is one, and everything step 3 gave. Tell them how to go on: they type `/rein:plan` to approve it, here or in a new session (`/rein:plan <slug>` there, the slug being this run's runId); or they tell you what to change; when the grade does not pass, they may also want more questions. Then stop.
5. When the user tells you what to change, revise `1-spec.md` as they said, grade it again and come back to step 3. When they want more questions, go back to Grading and questions.
