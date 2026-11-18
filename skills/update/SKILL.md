---
name: update
description: 설치된 Rein 플러그인을 최신 릴리스로 업데이트하고(마켓플레이스 갱신 뒤 설치 scope로 plugin update), 프로젝트들이 받은 도메인 룰과 지식을 새 카탈로그로 맞춘다. 사용자가 /rein:update를 입력했을 때만 사용.
disable-model-invocation: true
---

# update

The session-start notice points here. The script below already ran when this skill loaded:

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/plugin-update.js"`

Report its result to the user in one or two lines. If it updated the plugin, tell them to run `/reload-plugins`: the running session keeps the old version until then. If it failed, show the failing line and stop; do not retry or run other commands.

## Domains

After the plugin update, the script synced the domains every `~/.rein/<project>/` took with the new catalog and listed what it did under `Domains:`. Files copied, updated or deleted there are done; list their paths to the user. A rule's `paths:` globs stay local: `/rein:setup` may have fitted them to the repository. Rules apply from the next run (an open run keeps the rules it froze); knowledge applies at once.

Two kinds of line need the user:

- `conflict`: the local copy was changed and the script left it alone. Group these by project and domain (the path is `~/.rein/<project>/<rules|knowledge>/<domain>/...`) and ask with `AskUserQuestion` once per group, showing each file; past 20, show the first 20 and the count. Options: take the catalog's files (copy each `catalog:` file over its local copy with `Bash` `cp`, and delete each local file gone from the catalog), or keep the local copies as they are.
- `paths changed in the catalog`: the catalog changed the globs of a rule whose globs were fitted locally. The rule took the new body and kept its local globs. Ask with `AskUserQuestion` once per file, showing both lists. Options: keep the local globs, or take the catalog's (replace the `paths:` entry in the local file with the `catalog:` one, and change nothing else).

Then check the `paths:` globs of the rules this session's project got from the catalog: each `copied` or `updated` line under `~/.rein/<project>/rules/`, and each rule there whose catalog file or catalog globs the user took above. `<project>` is the session root's folder name; when the session root is a linked worktree (its `.git` is a file reading `gitdir: <main repository>/.git/worktrees/<name>`), it is the main repository's folder name. A glob is relative to the session root, and a rule without `paths:` always applies. Count the files each glob matches with `Glob` from the session root. A glob that matches nothing makes its rule never apply, without any error. Tell the user each such glob and ask with `AskUserQuestion` whether to change it. Write new globs into the local copy only, and only the ones the user gave. Other projects' rules are not checked, since nothing here tells which repository a project is: when the script wrote rules there, list them and say their globs are unchecked.

Write nothing else under `~/.rein/`. Tell the user the absolute paths you wrote or deleted.
