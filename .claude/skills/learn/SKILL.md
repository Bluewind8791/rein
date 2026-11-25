---
name: learn
description: 닫힌 Rein run의 회고 후보(이 PC와 허브 서버의 모든 retro.md)를 후보마다 리뷰 에이전트로 병렬 검토해, 이미 반영됐거나 중복이거나 적용할 가치가 없는 후보는 기록만 하고, 나머지는 한 번에 하나씩 문제와 고칠 방법을 쉽게 설명한 뒤 적용할지 사용자에게 묻고, 고른 후보 가운데 하네스·저장소 변경은 이 저장소에 적용해 커밋하고, 도메인 룰·지식 변경은 로컬 카탈로그 사본에 적용해 허브 서버로 보낸다(커밋하지 않음). 사용자가 Rein 회고를 반영·적용·정리해 달라고 할 때(회고 반영, 회고 적용, 회고 정리, learn) 사용.
---

# learn

When a Rein run closes, the `rein:retro` skill writes `7-retro.md` in its run folder (`agent/retro.md` in the runs that closed while it lived in `agent/`, `retro.md` in the folder itself before that, and `7-retro.md` before that too), and the user marks each candidate `채택` or `기각`, or leaves it `후보`. This skill sorts the candidates of every run, asks about the rest one at a time, and takes the approved ones in. A harness or repository change goes into this repository, the source of the plugin, and users get it only after a release. A domain rule or knowledge change goes into this PC's copy of the domain catalog and to the hub server that `~/.rein/sync.json` names; it is not committed, and every PC gets it at its next session start.

Run the steps in order.

## 1. Collect

First bring this PC's catalog copies and shared rules up to date:

```bash
node frame/sync.js refresh
```

Its last line is JSON. `offline: true` means the hub did not answer: tell the user and go on. An error saying `sync.json` names no hub server means domain changes reach only this PC's copies: tell the user. Each `conflict<TAB><local file><TAB><hub copy>` line before it is a file changed here and on the hub since they last agreed; resolve it as in "Conflicts" below, with `node frame/sync.js catalog resolve <local file> --take-hub|--keep-mine`.

The run folders are `~/.rein/<project>/{complete,drop}/<runId>/` (`~` is `USERPROFILE` on Windows). The hub also holds the runs closed on other PCs. Collect them all:

```bash
node .claude/skills/learn/retro-sync.mjs pull
```

It prints one line per run: `<project>/<runId>`, a tab, and the file to read and edit. A run this PC holds has its own run folder's file. A run held by another PC is downloaded, when it has open candidates, under `~/.rein/.hub/learn/`. Where this PC and the hub changed only `상태:` lines, it merges them (a closed status beats an open one, `채택` beats `후보`). When the hub cannot be read, it says so and lists this PC's files only; tell the user.

Then come `conflict<TAB><project>/<runId><TAB><file><TAB><hub copy>` lines, one per retro whose other text differs too. Resolve each as in "Conflicts", with `node .claude/skills/learn/retro-sync.mjs resolve <file> --take-hub|--keep-mine`, before step 2.

After steps 2, 3 and 5, and before you stop, send the `상태:` lines you set:

```bash
node .claude/skills/learn/retro-sync.mjs push
```

It sends each changed file to the hub, so another PC's `/learn` does not ask about it again. It prints one line per file:

- `sent`: the hub has it.
- `offline`: kept here; the next push sends it, and for a run this PC holds also the local frame server. Tell the user.
- `conflict`: the hub's copy changed meanwhile in more than `상태:` lines. Resolve it as in "Conflicts", then push again.
- `failed` with the reason: tell the user; the next push tries again.

### Conflicts

Show the user the difference (`diff <hub copy> <local file>`) and ask with `AskUserQuestion`:

- `서버 것 받기`: `resolve … --take-hub`
- `내 것으로 덮기`: `resolve … --keep-mine`
- `직접 합치기`: edit the local file into the merge with the user, then `resolve … --keep-mine`

A catalog file's hub copy of `-` means the hub deleted it. A retro resolved `--keep-mine` reaches the hub at the next push.

Read each file. A candidate is a `## <title>` section with its `종류:`, `상태:` and `근거:` lines, then either a `문제:` line (a 하네스 candidate: the trouble, with no fix; the reviewer works the fix out) or `제안:` and `대상:` lines (a domain candidate, and a 하네스 candidate from before `문제:`); `근거:`, `문제:` and `제안:` may run on over the following lines. A domain fact the retrospective added itself has `상태: 적용됨 <date>`, `대상:` and `내용:`.

- `상태: 후보` and `상태: 채택` are the open candidates.
- `기각`, `적용됨 …`, `중복 …` and `불필요 …` are closed. Read the `기각` ones only to judge duplicates in step 2; never ask about a closed one.

If no candidate is open, run `push`, tell the user and stop.

## 2. Review

Start one `learn-reviewer` agent per open candidate, all in one message so they run at once. Give each one the retro file's path, the candidate's title and the run's date (the date in its runId, or the retro file's). Each agent judges whether its candidate is still worth applying and plans the change; it answers with `판정:`, `이유:`, `계획:`, `훅 없이:`, `뺀 것:` and `바뀌는 것:` lines and edits nothing.

Record each verdict other than `열림` at once, without asking, by setting the candidate's `상태:` line with `Edit`:

- `적용됨 …`: `상태: 적용됨 <short commit hash>`, or `상태: 적용됨 이미 반영` when no commit is named.
- `이미 있는 지침 <path>`: `상태: 불필요 이미 있는 지침 <path>`
- `불필요 <reason>`: `상태: 불필요 <reason>`

Then compare the `열림` candidates with each other. A candidate is a **duplicate** when it asks for the same change as another one, by its plan more than its wording. Keep the one with the clearest `근거:` and plan as the representative, and set the others `상태: 중복 <project>/<runId> <representative's title>`. When you ask about the representative in step 3, use the evidence of all of them.

An open candidate that asks for the same change as a `기각` one stays open. Its question in step 3 says that run's user rejected it before.

Then tell the user, in one message, what you recorded: per candidate its project, runId, title and new `상태:`, with the reason in a line.

## 3. Ask one by one

The reviewers' plans are where each remaining candidate goes and what to write there. Read the files a plan names before you explain it, and fix a plan that does not fit them.

A candidate's count is the number of runs it comes from: its own, its duplicates', and those of `기각` candidates that ask for the same change.

When a plan is a new hook check, take it only when the count is two or more. With a count of one, take its `훅 없이:` plan and put the hook check under 참고.

Then take the candidates one at a time, grouped by `종류:`, the highest count first in each group. For each one, first write a message in Korean for someone who has not read the retro or the code:

- **제목**: the candidate's title, its `종류:`, and its count as `반복: N개 run` with those runs (a `기각` one marked so).
- **무슨 문제인가**: what happened in the run, in plain words. Which stage, what the agent or the user did, what it cost (how many refusals, which stage was redone, what the user had to correct). Explain the Rein terms and rule IDs it uses (`D155`, `goto`, `judge`) in a few words, or leave them out.
- **어떻게 고칠까**: the files to change and what changes in each, as before and after in plain words. Quote the sentence to add when it is short. Say what the user or the agents will see differently afterwards.
- **참고**: anything else that bears on the choice: a `기각` candidate it repeats, the reviewer's `뺀 것:` and why, a part that is a guess of the retro agent.

Then ask with `AskUserQuestion`, one question about this candidate alone, with these options:

- `적용`: make the change as described.
- `고쳐서 적용`: the user says what to change (through `Other` or the next message); restate the changed plan in a line.
- `보류`: decide another time.
- `기각`: do not make it.

Do not edit anything before the answer. Record each answer before the next question: `기각` sets `상태: 기각` with `Edit`; `보류` leaves the line as it is; `적용` and `고쳐서 적용` wait for step 4.

When every open candidate is asked, list what is to be applied.

## 4. Apply and verify

Make the approved edits.

- For a hook change, write the failing test in `tests/` first.
- A domain candidate (`도메인 지식`, `도메인 룰`) changes this PC's copy: `~/.rein/<project>/knowledge/<domain>/...` or `~/.rein/<project>/rules/<domain>/...`. When this PC has no project with that domain, run `node frame/sync.js catalog checkout <domain>` and edit under the `dir` it answers (`~/.rein/.hub/catalog/<domain>/`). Leave a rule's `paths:` as it is: it was fitted to this PC's repository, and the hub keeps its own.
- After the domain edits, send them with `node frame/sync.js catalog push`. `sent` lists the files the hub took. Resolve its `conflict` lines as in "Conflicts". `offline: true` keeps them here; the local frame server sends them when it next reaches the hub. Tell the user.
- A domain rule reaches each PC at its next session start, and applies from the next run there: a run checks the rules it froze when it opened.

Then:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test   # when hooks/ or tests/ changed
claude plugin validate .                                  # when skills/, agents/ or .claude-plugin/ changed
```

A failure stops here: show the failing line and fix it with the user before going on.

## 5. Commit

Domain candidates are not committed. Set each one's line with `Edit` once its files are sent or kept for sending: `상태: 적용됨 <YYYY-MM-DD>`, today's date.

Commit each harness or repository candidate on its own, so each change traces back to its run. Follow the style of `git log`: a `feat:`, `fix:` or `docs:` prefix. Name the run in the body (`Retro: <project>/<runId>`), one line per run when duplicates came from several. Show the message and the staged files, and commit after the user approves.

Then set each committed candidate's line with `Edit`: `상태: 적용됨 <short commit hash>`.

## 6. Release

Tell the user what was committed, what was sent to the hub, and what was recorded. Committed changes reach users only after a release: offer the `release` skill. Domain changes need no release.

## Do not

- Ask about, or apply, a closed candidate.
- Apply a candidate the user did not answer `적용` or `고쳐서 적용`.
- Ask about several candidates in one question.
- Edit anything under `~/.rein/` except the `상태:` lines of the retro files and, for an approved domain candidate, the catalog copies (`~/.rein/<project>/rules/<domain>/`, `~/.rein/<project>/knowledge/<domain>/`, `~/.rein/.hub/catalog/<domain>/`).
- Push or release without the user asking.
