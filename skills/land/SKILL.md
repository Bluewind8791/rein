---
name: land
description: The land stage of a Rein run. Use when a Rein hook says the run is now in the land stage and to invoke the rein:land skill, or when the user typed /rein:land after testing the integration checklist by hand.
argument-hint: "[slug]"
---

# land stage

Bring the finished work into one commit per repository, with the message in `6-land.md`. No PR, no push. Call `mcp__rein__status` to see the land repositories (`land repositories:`), the run's worktrees (`worktrees:`) and the project's Rein rules (`rules:`).

How depends on the run:

- **A run in worktrees** (status shows `worktrees:`, or the land repositories are under `.claude/worktrees/`): the hook commits. Skip step 1. Write `6-land.md` (step 2), then advance asks the user to approve the commit (step 3, "In worktrees"). You do not stage or commit yourself.
- **A run without worktrees** (opened before Rein made them): leave the work staged; the user commits it themselves, and nothing is asked. Do steps 1, 2 and 3.

## 0. The user tested by hand

When the user typed `/rein:land`, they tested the screens by `5-checklist.md` themselves: the run waits for it in `qa-integration`, with `e2e: wait` or `halt: layout-unchecked` (with the halt, they compared the layout of each to-be screen). When the hook sent you here (the run is already in land), skip this section.

The user may type it in this session or in a new one, with the run's slug (its runId) as the argument or with none. The argument: `$ARGUMENTS`.

1. Call `mcp__rein__status`, and pick the run:
   - This session has a run open. No slug, or its slug: that run. Another slug: this session holds one run, so ask the user with `AskUserQuestion` whether to put the open run aside (`보류`) or drop it (`폐기`), and call `mcp__rein__park` with the reason and their answer (it says what it takes); then the slug's run is the one. If they keep the open run, stop.
   - No run open: status lists the resumable runs of this project, each with the skills it `waits for`. A slug: that run, whatever it waits for. No slug: the runs that wait for `/rein:land`. One: that run. Several: ask the user with `AskUserQuestion` which, one option per run (its runId and title). None: tell the user no run waits for `/rein:land`, show them the resumable runs, and stop.
2. When the run is not this session's, call `mcp__rein__resume` with its runId, `answer` set to `이어서 진행` and the user's command in `said`. Typing the skill is their answer: do not ask them to confirm. If the result says another session held the run, tell the user. If resume refuses, tell the user what it says and stop.
3. Call `mcp__rein__status`. When it does not show `waits for the user: they type` with `/rein:land`, approve nothing: tell the user where the run stands and carry on there with the skill of its stage (the one resume named, if it ran). When it does show it, go on below, whatever skill resume named.
4. Typing it is their answer: call `mcp__rein__advance` with `answer` set to `직접 확인 완료`.

- The run moved to land: go on with step 1.
- Refused because boxes are still empty: show the user the boxes the refusal lists. If they say those passed, check them in `5-checklist.md` (`- [ ]` to `- [x]`) and call advance again with the same answer. If one failed, see "When the user found a problem" in the `rein:qa` skill.
- `D95` (nothing to commit) or `D120` (a config changed): follow what the result says.

## 1. Stage (a run without worktrees)

For each land repository, see which planned files (the file list of `2-plan.md`) changed: `git -C <repository> status --porcelain`. Stage exactly those, by name: `git -C <repository> add -- <path>...`. No `-A`, no `.`, no `-u`, no globs, no directories, no other files. Unstage a file the user staged before only with their consent.

## 2. Write 6-land.md

Write `6-land.md` in the run directory with `Write`. It is the page the user reads to approve the commit (or, without worktrees, to commit), in Korean. The hook commits with the fenced block under `## 커밋 메시지`, as it is. In a run in worktrees, list under `## 스테이징` the planned files that changed in each land repository (`git -C <repository> status --porcelain`): they are what the hook commits. Give each land repository a `### <repository>` heading, and below it one file per line, its path relative to the repository.

````
# <the title of 1-spec.md>

## 커밋 메시지

```text
<the message>
```

## 스테이징

### <repository>

- <staged path>
- <staged path>
````

The message follows the project's commit convention when one is set: in its Rein rules (a rule outranks the repository's documents), else in a land repository's `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` or `.github/CONTRIBUTING.md`. Otherwise use the default form:

```
[<reference>] <summary of the change>

<why it changed>

<behaviour before. behaviour after.>
```

- One title line, then a blank line. In the default form, ideally within 50 characters and never over 72, and no `feat:` or `fix:` prefixes.
- The reference is the `참조:` line in the front matter of `1-spec.md`, copied as it is without its quotes. Under a convention it goes where the convention puts it, else in a last body line `Refs: <reference>`. When it says `없음`, write no reference (in the default form, no brackets). Never invent one.
- If the repositories' conventions differ, use the default form and say so in `6-land.md`: one message serves every repository.

## 3. Finish

### In worktrees

Land runs from the main working tree: the hook removes the worktree once the commit is in, and on Windows a folder the session is in cannot be removed. When the session is in the run's worktree (the session root is under `.claude/worktrees/`), call `ExitWorktree` with `action: "keep"` first. Advance refuses until you do.

Call `mcp__rein__advance` without `answer`. It changes nothing: it checks that `6-land.md` has the message and that each main working tree is on the branch the run started from, and says what the user approves. For each repository: the branch the commit goes into, the files committed, and the files left in the worktree that are not planned, which go with the worktree uncommitted. Ask the user with `AskUserQuestion`, showing all of it. Then call `mcp__rein__advance` with `answer` set to `커밋` or `취소` and their own words in `said`. Never pass an answer the user did not give. In an autopilot run, the result says `autopilot run` instead: ask no one, tell the user in one line what is committed where, and call `mcp__rein__advance` with `커밋` and `said` set to `autopilot`.

On `커밋` the hook, per repository, commits the planned files that changed in the worktree, by name, with the repository's git hooks off. It then cherry-picks the commit into the main working tree's branch, and removes the worktree and its branch `rein/<slug>`.

- Refused before anything was committed because a main working tree is on another branch than the run started from, or on a detached HEAD: tell the user. Once they have switched it, call advance again; it asks again.
- Refused because the cherry-pick failed: git refuses while the main working tree has anything staged, or changes of its own to the same files. The hook undid it (`cherry-pick --abort`): the main working tree is as it was, and the commit stays in the worktree. Tell the user what the refusal says. Once they have committed, stashed or unstaged those changes, call advance again. It asks again and skips the commit already made while it is still the worktree's HEAD (if the worktree was reset since, it commits anew; if it was rebased keeping the commit, it lands the rebased commit, which must be the only commit on top of the branch: with several it stops and asks to squash them), and any repository already landed.
  Or the branch has commits made after the worktree that change the same files (`git -C <repository> log --oneline rein/<slug>..<branch>` lists them). Then tell the user; with their consent, in the worktree run `git -C <worktree> rebase <branch>`, resolve the conflicts and continue the rebase, then `git -C <worktree> reset <branch>`: the run's changes stand uncommitted on top of the branch, and land commits them anew. Call `mcp__rein__goto` with stage `review`, as the drift line says: the merged code is reviewed and qa'd before it lands.
- `취소`: nothing was committed. Do what the user said (a changed message in `6-land.md`, say), then call advance again.
- `The run is finished.`: the commit is in each main working tree, and the run is closed. Tell the user, giving the absolute path of `6-land.md` the result names. If it says removing a worktree did not finish (a program held its folder), tell the user what is left: an empty folder to delete, or the command to run again. Handoff files and the retrospective are as below.

### Without worktrees

Call `mcp__rein__advance` without `answer`. The hook checks that `6-land.md` exists and that the staging of each land repository is exactly its planned files that changed.

- Refused because a planned file that changed is not staged: stage it (step 1) and call advance again.
- Refused because files are staged that are not planned-and-changed (the user staged them before): tell the user, and with their consent run the `git -C <repository> restore --staged -- <path>...` the refusal names (or they run it), then call advance again.
- `The run is finished.`: the run is closed and its folder moved to `complete/`. Tell the user the staging is ready in each repository and give them the absolute path of `6-land.md` there, which the result names: they commit with that message. If the result names handoff files, tell the user each file and what `2-plan.md`'s `## 넘길 것` says to do with it: they are not in any commit. Then invoke the `rein:retro` skill, as the result says.
- `D144`: the run folder could not be moved (on Windows a file in it may be open in another program). Tell the user; once they have closed it, call `mcp__rein__advance` again.

## Moving the run

`mcp__rein__goto` moves the run to any stage, on your judgment or the user's: back to `plan` to revise the design, on to `land` to accept the evidence as it is, `qa-integration` to run the integration entry again. The hook sets the stage up as entering it would and says what to do next; pass the user's words in `said` when they asked for it.

## Stopping the run

If the user wants to stop, put aside or abandon the run, call `mcp__rein__park` with their reason. Call it first without `answer`: it changes nothing and says what it takes: `보류` (resume later), `폐기` (drop it), `완료 (Rein 밖에서 반영함)` (the change already went in outside Rein, by the user's own commits) or `계속 진행`. Decide with the user, then call `mcp__rein__park` again with the same reason, `answer` set to that label and the user's own words in `said`. Repository files and the staging stay as they are. `폐기` also removes the run's worktrees and their branch, and what was not committed in them; `보류` and `완료` keep them. Park is refused while the hook is running commands; call it again once that is done.

## Do not

- Run `git commit` yourself: the hook commits a run in worktrees on the user's approval, and the user commits one without. If they ask you to, the hook refuses your `git commit` until they approve it: its refusal gives the message and the command. Ask the user with `AskUserQuestion`, showing both, pass their answer to `mcp__rein__advance` (`커밋` or `취소`; advance takes it before anything else), and on `커밋` run the same command again, unchanged.
- Undo a commit, or run `git reset`, `git stash`, `git checkout` or `git push`, unless the user asks.
