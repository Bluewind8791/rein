---
name: uninstall
description: 플러그인을 지우기 전에 Rein이 이 머신에 남긴 것(run 기록, 플러그인의 run 상태, 사용자가 동의하면 규칙·지식과 저장소 config)을 정리한다. 사용자가 /rein:uninstall을 입력했을 때만 사용.
disable-model-invocation: true
---

# uninstall

Clean up Rein's leftovers so a later install starts from nothing. Nothing is deleted before the user confirms it.

The plugin's own files go with `/plugin uninstall`, and so does this skill, so run it first.

## 1. No run open

Call `mcp__rein__status`. If this session has a run open, stop and tell the user: run records cannot be removed while the run uses them. They finish the run or park it (`mcp__rein__park`), then run `/rein:uninstall` again.

Runs open in other sessions are not checked. Tell the user that any Rein session still open will lose its run, and that deferred runs (status lists them) go too.

## 2. Collect

List what exists; delete nothing yet.

- **Run records**: one folder per run, in either layout:
  - `~/.rein/<project>/<state>/<runId>/`, where `<state>` is `active`, `defer`, `complete` or `drop`. These four are containers, not runs: list the run folders inside them.
  - `~/.rein/<project>/<runId>/`, from an older version: any other folder directly under `~/.rein/<project>/` except `rules/`, `knowledge/` and the four containers.

  Each holds one run's `1-spec.md`, `2-plan.md`, the stage files and `trace.jsonl`.
- **Update-check cache**: `~/.rein/update-check.json`, the latest release the session-start notice last saw. It is a file, not a project folder. It goes with the run state.
- **Run state**: every `rein_*.json` in `~/.claude/plugins/store/`, the plugin's key-value store. It holds the active and deferred runs by slug and which session holds which.
- **Rules**: every `~/.rein/<project>/rules/*.md` and `rules/<domain>/*.md`. The user wrote these or took them from the domain catalog; `review` checks against them. Also the shared rules every project's runs check: `~/.rein/rules/*.md` and `~/.rein/rules/<domain>/*.md`. `~/.rein/rules/` is no project folder: do not look for run records in it.
- **Knowledge**: everything under `~/.rein/<project>/knowledge/<domain>/`, folders too, taken from the domain catalog.
- **Repository configs**: every `<repository root>/.rein/config.json`. Look at or below the working directory (skip `node_modules`), and in the repository (nearest `.git` ancestor) of each `### <file path>` item under `## 상세 설계` in a run's `2-plan.md` found above. These belong to the repository and may be committed.

Use `ls` and `find` through `Bash`. `~` is the home directory (`USERPROFILE` on Windows).

If nothing exists, tell the user and go to step 5.

## 3. Confirm

Show the user the list, grouped as above, with counts and absolute paths. Then ask with `AskUserQuestion`, one question at a time:

1. Delete the run records and the run state? This is the default cleanup.
2. If rules exist: delete the rules too? Offer to keep them.
3. If knowledge exists: delete the knowledge too? Offer to keep it.
4. If repository configs exist: which of them to delete? Use `multiSelect`, one option per file, and say which ones git tracks (`git -C <repository root> ls-files --error-unmatch .rein/config.json`). Deleting a tracked one leaves a change in that repository to commit or restore.

Delete only what the user chose.

## 4. Delete

Delete with `rm -rf` on the exact paths, one `Bash` call per group:

- run records: each run folder, then each `active`, `defer`, `complete` and `drop` container left empty
- run state: each store file, and `~/.rein/update-check.json`
- rules: `~/.rein/<project>/rules`, and `~/.rein/rules`
- knowledge: `~/.rein/<project>/knowledge`
- configs: each chosen `config.json`, and its `.rein` folder if it is then empty

Then remove each `~/.rein/<project>` left empty, and `~/.rein` if it is empty.

List what was deleted and what was kept.

## 5. Uninstall the plugin

Tell the user the plugin itself is removed with:

```
claude plugin uninstall rein@rein
claude plugin marketplace remove rein
```

The second line only when Rein was installed from its own marketplace. A reinstall is then `claude plugin marketplace add <marketplace>` and `claude plugin install rein@rein`.
