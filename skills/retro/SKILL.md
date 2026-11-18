---
name: retro
description: The retrospective of a Rein run that just closed. Use when a Rein hook says the run is closed and to invoke the rein:retro skill.
---

# retro

The run is closed: finished in land, ended without a commit, or closed by park (`폐기` or `완료`). This looks back on it for what should go into the Rein plugin or the domain knowledge, and records what the user keeps. It applies nothing: the `learn` skill of the Rein repository does that later.

The hook's message gave the run folder and the main session's transcripts. Until a new run opens, the hook lets reading them and the project's domain rules and knowledge, and writing `agent/retro.md` in the run folder, through without a permission prompt.

## 1. The retro agent

Spawn `rein:retro` and wait for it. Give it the run folder and the transcripts' paths exactly as the hook's message gave them, or say that none was found.

It writes `<run folder>/agent/retro.md` and answers with one line per candidate, or `제안 없음`.

## 2. The user picks

On `제안 없음`, tell the user the retrospective found nothing, and close (step 4).

Otherwise read `retro.md` and show each candidate: its title, `종류:`, `제안:` and a short `근거:`. Give the path of `retro.md` too. Then ask with `AskUserQuestion` which to keep, with `multiSelect`: one option per candidate, its title as the label and its `제안:` cut short as the description. With more than four candidates, number them in the text and ask the user to name the ones to keep instead.

## 3. Record the answer

With `Edit`, set the `상태:` line of each candidate in `retro.md`: `채택` for one the user kept, `기각` for the rest. When the user changed a candidate while answering (its text, its 대상), change it in the file too.

If the user dismisses the question, leave every `상태: 후보`. Tell them the candidates stay in `retro.md` undecided.

Tell the user how many were kept, and that the Rein repository's `learn` skill applies them to the plugin.

## 4. Close

End your answer with one line saying, in Korean, that the run is over, from what the hook's message that closed the run said. Name where its change went: the repositories (and branches) the commit went into; staged in the repositories, for the user to commit; or no commit (ended without one, `폐기`, `완료`). Name its record folder, the run folder above. The user reads this line to know the work is done.

## Do not

- Edit domain rules or knowledge, or any plugin or repository file.
- Write anything in the run folder but `agent/retro.md`.
- Mark a candidate `채택` that the user did not pick.
