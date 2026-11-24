---
name: retro
description: The retrospective of a Rein run that just closed. Use when a Rein hook says the run is closed and to invoke the rein:retro skill.
---

# retro

The run is closed: finished in land, ended without a commit, or closed by park (`폐기` or `완료`). This looks back on it for what should go into the Rein plugin or the domain knowledge. The domain facts it finds go into the domain knowledge at once. The harness trouble and the domain rules are recorded as candidates for the user to pick; the `learn` skill of the Rein repository works out and applies the fix later.

The hook's message gave the run folder and the main session's transcripts. Until a new run opens, the hook lets reading them and the project's domain rules and knowledge, writing `agent/retro.md` and the files in `agent/retro-read/` in the run folder, and writing the project's domain knowledge through without a permission prompt.

A long run's trace, `e2e.md`, `fails.md` and transcripts are far more than one agent reads to the end. So readers read them first, each about 300 KB of them, and the retro agent works from their notes.

Give each agent only what its step names. Do not add what you remember of the run, its trouble, or what to look for: in a long run you remember its last days, and an agent pointed at them looks no further.

## 1. Cut the records into parts

Run with `Bash`:

```
node ${CLAUDE_PLUGIN_ROOT}/frame/retro-parts.js "<run folder>" "<transcript>" …
```

with the run folder and each transcript's path from the hook's message (no transcript when none was found). It writes the trace without the tool calls it let through, and what the user said in the transcripts, into `<run folder>/agent/retro-read/`, and cuts those and `agent/e2e.md` and `agent/fails.md` into parts. Its last output line is JSON: `{"parts":[{"out":"<notes file>","read":[{"file":"<file>","lines":"<from>-<to>"}, …]}, …]}`, or `{"error":"..."}`.

On an error, tell the user what it said and go on to step 3 without notes.

## 2. The readers

Spawn one `rein:retro-reader` per part, all in one message so they run at once, and wait for them all. Give each only its part: each `file` with its `lines`, and its `out` as the file to write.

When a reader answers without having written its `out`, spawn it once more for the same part.

## 3. The retro agent

Spawn `rein:retro` and wait for it. Give it the run folder and the transcripts' paths exactly as the hook's message gave them, or say that none was found, and today's date. Nothing else.

It adds the domain facts it found to `~/.rein/<project>/knowledge/<domain>/`, writes `<run folder>/agent/retro.md` and answers with one line per item, a domain fact it added marked `(적용됨)`, or `제안 없음`.

## 4. Send the domain facts

Skip this step when the answer marks nothing `(적용됨)`.

Send them to the hub with `node ${CLAUDE_PLUGIN_ROOT}/frame/sync.js catalog push`, run with `Bash`. Its last output line is JSON:

- `sent` lists the files the hub took.
- `offline: true`: the hub did not answer. The files stay here, and the local frame server sends them when it next reaches the hub.
- An error saying `sync.json` names no hub server: the facts reach only this PC's copy.
- Each `conflict<TAB><local file><TAB><hub copy>` line before it is a file changed here and on the hub since they last agreed. Show the user the difference (`diff <hub copy> <local file>`; a hub copy of `-` means the hub deleted the file) and ask with `AskUserQuestion`:
  - 서버 것 받기: `catalog resolve <local file> --take-hub`; the fact added there is lost, so say so.
  - 내 것으로 덮기: `catalog resolve <local file> --keep-mine`
  - 직접 합치기: edit the local file into the merge with the user, then `catalog resolve <local file> --keep-mine`

Then tell the user what went into the domain knowledge: per fact, its title, the `대상:` file and its `내용:`, and how it was sent. They can edit the file if a fact is wrong.

## 5. The user picks

The candidates are the items with `상태: 후보`. When there are none, skip to step 7; on `제안 없음`, tell the user the retrospective found nothing first.

Otherwise read `retro.md` and show each candidate: its title, `종류:`, a short `근거:`, and for a 하네스 candidate its `문제:`, for the others its `제안:`. Give the path of `retro.md` too. Then ask with `AskUserQuestion` which are worth fixing, with `multiSelect`: one option per candidate, its title as the label and its `문제:` or `제안:` cut short as the description. With more than four candidates, number them in the text and ask the user to name the ones to keep instead.

## 6. Record the answer

With `Edit`, set the `상태:` line of each candidate in `retro.md`: `채택` for one the user kept, `기각` for the rest. When the user changed a candidate while answering (its text, its 대상), change it in the file too.

If the user dismisses the question, leave every `상태: 후보`. Tell them the candidates stay in `retro.md` undecided.

Tell the user how many were kept, and that the Rein repository's `learn` skill works out the fix for them and applies it.

## 7. Close

End your answer with one line saying, in Korean, that the run is over, from what the hook's message that closed the run said. Name where its change went: the repositories (and branches) the commit went into; staged in the repositories, for the user to commit; or no commit (ended without one, `폐기`, `완료`). Name its record folder, the run folder above. The user reads this line to know the work is done.

## Do not

- Edit domain rules, or any plugin or repository file.
- Edit domain knowledge, except a merge the user asked for in step 4.
- Write anything in the run folder but `agent/retro.md`; `retro-parts.js` and the readers write `agent/retro-read/`.
- Mark a candidate `채택` that the user did not pick.
