---
name: setup
description: Rein의 함수 훅이 로드되지 않았으면 원인(Claude Code 버전)을 알리고, 저장소의 Rein 검증 명령을 사용자 확인을 받아 <repository root>/.rein/config.json에 쓰거나, 훅이 쓸 수 없는 config를 고치고, 허브 서버의 도메인 카탈로그에서 사용자가 고른 도메인의 룰과 지식을 ~/.rein/<project>/로 받고, 공용 룰을 받고, 카탈로그·공용 룰의 충돌을 사용자에게 물어 풀고, 다른 PC와 run과 카탈로그를 주고받을 허브 서버 주소를(허브 PC면 허브 폴더도) ~/.rein/sync.json에 정하고, 예전 setup이 Herdr App에 넣은 run 진행 상황 블록(rein mod와 레이아웃 노드)과 ~/.rein/pane/이 남아 있으면 사용자 확인을 받아 지운다. 사용자가 /rein:setup을 입력했을 때, 또는 Rein plan 단계가 쓸 수 있는 .rein/config.json이 없는 저장소에 대해 부를 때 사용.
---

# setup

Prepare the commands `qa` runs in one repository. They belong to the repository, not to a run, so the file stays in the repository. Rein neither commits it nor ignores it; committing it is the repository's choice, and when it is committed `plan` compares it with `HEAD`.

This works outside a run and in any stage of one: the hook does not refuse the main session's writes. In `plan` the file is frozen when plan passes. After plan, a changed config is never used unseen: in `qa` and in a halted integration qa, `mcp__rein__advance` shows the user the change and asks them to approve the config as it is.

The plan stage accepts the file only when it is a JSON object whose `qa` is a non-empty array of commands.

## 0. Function hooks

Rein's hooks load in Claude Code 2.1.287 or later, where function hooks are on by default. Without them the skills and agents still load, but the `mcp__rein__*` tools do not exist and no run can open.

If `mcp__rein__status` is available, directly or as a deferred tool, the hooks are on: go to step 1.

Otherwise run `claude --version` with `Bash`. If it is older than 2.1.287, tell the user to update Claude Code (`claude update`) and start a new session. If it is 2.1.287 or later, the hook module failed to load for another reason: tell the user to look for Rein's error in `/plugin`. Either way set nothing and go on with step 1; writing `.rein/config.json` does not need the hooks.

## 1. Find the repository

The repository root is the directory holding `.git`. Use the path the user gave, or the repository roots a Rein plan named, or else the nearest `.git` ancestor of the working directory. One repository at a time; repeat for each.

If `<repository root>/.rein/config.json` already exists, read it and check it against the rules the hook applies:

- It is a JSON object.
- `qa` is a non-empty array of non-empty command strings.
- `precheck`, when present, is an array of non-empty command strings.
- `worktree`, when present, is an object whose `setup`, if given, is an array of non-empty command strings.
- `e2e`, when present, is an object with `apps` (at least one app, each an http(s) `url` and, if given, a `login` string, a `note` string, a `profile` string and a `profiles` object of strings), a `production` array of hosts (it may be empty), a `backends` array of hosts (empty only when the apps call no backend), and, if given, a `timeout` that is a whole number from 1 to 60. An older `e2e` has one `url` and an `account` instead of `apps`; the hook still reads it as one app named `app`. Offer to rewrite it as `apps` only when the user wants to name a second app or a login.

If it passes, show it to the user and go to step 6; change it only if they ask. If it fails, show the user the file and what is wrong, and ask with `AskUserQuestion` whether to fix it, offering corrected values as options (steps 2 to 4). Write the fix only after they confirm it (step 5).

## 2. Investigate

Look for candidate commands: `package.json` scripts, `Makefile`, CI configuration (for example `.github/workflows`). Read them; do not run them here. Step 3 runs the `qa` candidates once, after the user allows it.

If there are apps to drive for `e2e`, find each one (a change can reach several, an admin web and a mobile web, say) and how to log in to it: a test account, its password, and the way in (a login form, say, and any shortcut to avoid). Then find **where each sends its requests**: the dev server's proxy (for example `server.proxy` in `vite.config.*`, `devServer.proxy` in webpack, `rewrites` in `next.config.*`), API origin constants in the source (`API_ORIGIN`, `BASE_URL`, `baseURL` in an HTTP client), and `.env*` files (`VITE_*`, `NEXT_PUBLIC_*`, `REACT_APP_*`). A local address such as `localhost:5173` can still send every API call to production through one of these. Write down each host you find and where.

## 3. Try the `qa` candidates

A command can pass its form and verify nothing: `qa: ["true"]` exits 0 in a hundredth of a second, and every run after it reports a `qa` that checked nothing. The hook cannot judge what a command verifies, so the user has to see it work.

Show the `qa` candidates and ask with `AskUserQuestion` whether to run them once, now. Say what running them means here: these are the repository's own commands, not yet approved, and they run in the working tree.

If the user says no, go to step 4 and let them approve the commands as text, the way they did before. Long commands and a half-set-up environment are reasons to say no.

If they say yes, run the `qa` commands with `Bash`, in the order they are listed, from the repository root. Run **only** `qa`: the production guards only start working once the config is written.

Give each command at most 10 minutes, the same as a run gives it, and put no cap on the total: what the user sees here has to predict what the run will do. For each command report the exit code, how long it took, and the last 20 lines of its output.

A failure does not block anything. It may be the environment, and the call is the user's.

## 4. Confirm with the user

Ask with `AskUserQuestion`, the candidates as options. **Never write the file without the user's confirmation.**

- `qa`: fast commands such as typecheck and unit tests. Required.
- `precheck`: only compile or type checks that finish in tens of seconds (`npm run typecheck`, say). The hook runs them in each worktree before review, so that code that does not compile goes back to dev without a review; a failure counts as one implementation failure. Tests stay in `qa`. May be left out; then review starts as before. Ask whether to add it.
- `e2e`: what the e2e agent needs to drive the apps. Leave it out if the user says there is no app to drive. When present:
  - `apps`, required: one entry per app, `"<name>": {"url": "...", "login": "..."}`. The name is what `2-plan.md`'s checks say under `- 앱:` (a short word: `admin`, `mobile`). `url` is the address to drive; never offer a production address as a candidate. `login`, optional, is one free sentence: the account, its password, and how to log in (for example "tester / test-pass, log in with the id and password form"). When every test account shares one password, the sentence can give only the way in and that password ("id and password form; the password is test-pass for every account"): each check in `2-plan.md` then names its account under `- 계정:`, so runs that test as different accounts need no config change. Tell the user the login goes into every aside command and stays in Rein's trace and in the Aside session, so it must be a test account. `note`, optional, is one free sentence of what every check of the app must mind, for example "after login a welcome tour opens; press Skip, since finishing it changes the account's settings". The hook puts it into every aside and ego command and once per page into `5-checklist.md`, so checks do not repeat it in their steps. Ask whether the app has such a thing; never put a password in it, since the person reads it.
  - `production`, required: the list of production hosts, `[]` if none. **Always ask for it**: the hook checks each app's `url` and every `backends` host against it and blocks e2e on production. The match is by host only (case, port, user info and a trailing dot ignored): `app.example.com` matches that host exactly, and `*.example.com` matches every host under `example.com` (not `example.com` itself; list it too if it is production).
  - `backends`, required: the hosts the apps send requests to, from step 2. `[]` only when the app calls no backend. **Always ask for it**: show what you found and where, and let the user correct it. If a backend is a production host, warn the user that e2e would act on production through the app, and offer to leave `e2e` out (or to point the app at a local backend first). Never offer a production backend as a safe candidate. The hook trusts this list; it cannot see where the app really sends requests.
  - The plan stage refuses a config whose `e2e` has no app with an http(s) `url`, no `production` array, no `backends` array, or a `timeout` that is not a whole number from 1 to 60.
  - `profile` and `profiles`, per app, optional: the ego profiles the checks run in when the user chooses Ego at `/rein:e2e`. Ask whether they will use Ego; if not, leave both out. If they will, see "Ego profiles" below.
  - `timeout`, optional: minutes one e2e check may take, default 30, at most 60. A single check can set its own in `2-plan.md`.
  - `model`, `effort`, optional: passed to the e2e agent; without them the user's own settings apply.
- `worktree.setup`: commands the hook runs once in each git worktree it makes for a run (`<repository>/.claude/worktrees/<slug>`, from HEAD), before the run works there. A worktree holds only what git tracks (`.rein/config.json` itself is copied from the main working tree when git does not track it), so dependencies (`node_modules`) and ignored files (`.env`) are missing: offer the install command step 2 found (`npm ci`, say) and a copy of an ignored file the commands need. May be left out. A failure is told to the user, and the run goes on. Each command runs from the worktree's root with at most 10 minutes. Ask whether to add it.

## 5. Write the file

Write the confirmed values to `<repository root>/.rein/config.json`:

```json
{
  "qa": ["npm run typecheck", "npm test"],
  "precheck": ["npm run typecheck"],
  "e2e": {
    "apps": {
      "admin": { "url": "http://localhost:8090", "login": "tester / test-pass, id and password form", "note": "after login press Skip on the welcome tour", "profile": "Tester1", "profiles": { "tester2": "Tester2" } },
      "mobile": { "url": "http://localhost:3000" }
    },
    "production": ["app.example.com"],
    "backends": ["localhost:8080"],
    "timeout": 30
  },
  "worktree": { "setup": ["npm ci"] }
}
```

Commands run in array order. Tell the user the absolute path you wrote.

### Ego profiles

On the Ego path each check runs in an ego profile, so accounts keep their cookies apart and checks of different accounts can run at once. The hook only reads profiles; the ego API cannot create them, so the user makes them in the ego browser.

1. Ask how the app logs in to its test accounts: one password for every account, or fixed test accounts with their own passwords. Either way the app's `login` sentence holds it, as above.
2. List the accounts the checks log in as: the app's own login account, and every account a `- 계정:` line names (ask the user, or read a plan's `## e2e 확인`).
3. Ask the user to make one ego profile per account with the ego browser's add-profile menu, named so they recognise it (`Tester1`, `Tester2`), and to log in to the app once in each if they like (a profile keeps its cookies).
4. Check the names with `ego-browser nodejs`, a script on stdin: `console.log(JSON.stringify(await profiles()))`. With Bash, write the one line to a file and run `ego-browser nodejs < <file>`. Show the user the names ego lists; a name the config gives must be one of them, exactly.
5. Write the app's default profile as `"profile": "<name>"` (the profile of the app's own login account; required on the Ego path) and each other account's as `"profiles": { "<account>": "<name>" }`, the account spelled as the `- 계정:` lines spell it.

If `ego-browser` is not found, ego lite is not installed or Claude Code started before ego put it on the PATH: tell the user to install or start ego lite and restart Claude Code. If a Rein run is in `plan`, `2-plan.md` has to be written again for the hook to judge it with the new file.

## 6. Domains

The hub server (step 7) keeps the catalog of domain rules and knowledge. Each domain is a folder there: `domain.json` with the `name` the user sees and a one-line `description`, `rules/*.md` and `knowledge/`, whose `.md` files may sit in folders. Do this step once, after the last repository; skip it when the plan stage invoked this skill for a missing config. A taken domain is copied to `~/.rein/<project>/rules/<domain>/` and `~/.rein/<project>/knowledge/<domain>/`. `~` is the home directory (`USERPROFILE` on Windows). `<project>` is the session root's folder name; when the session root is a linked worktree (its `.git` is a file reading `gitdir: <main repository>/.git/worktrees/<name>`), it is the main repository's folder name.

The rules `review` checks are the ones frozen when a run opens: a domain taken now applies from the next run. Knowledge reaches the agents at once. Once taken, the copies stay current on their own: at each session start the local frame server downloads what changed on the hub and sends what changed here.

Every command below is `node ${CLAUDE_PLUGIN_ROOT}/frame/sync.js <command>`, run with `Bash`. Its last output line is JSON; a conflict prints a line `conflict<TAB><local file><TAB><hub copy>` before it.

1. List the domains with `catalog list`. It answers `domains`, each with `id`, `name`, `description` and `taken` (the projects that took it). When it ends with `{"error": …}` (no `server` in `~/.rein/sync.json`, or the hub does not answer), tell the user that a first catalog download needs the hub, so set it in step 7 and come back; go to step 7, and do this step again after it. If there are no domains, go to sub-step 6. Mark each domain this project already took.
2. Ask with `AskUserQuestion` which domains to take, with `multiSelect`: one option per domain, its `name` as the label and its description as the description. With more than four domains, show the list as text and ask the user to name the domains instead. If they take none, go to sub-step 6.
3. Take them with `catalog take <project> <domain>...`. It compares each file by its text without the rule's `paths:`, so a rule whose globs alone differ counts as the same and keeps the local globs. A domain whose answer has no `differing` or `extra` file is taken (`taken: true`, its new files in `written`). A domain with either was left as it was (`taken: false`): ask with `AskUserQuestion` once for that domain. Show each differing file and each extra file; past 20 of either, show the first 20 and the count. For a differing rule with `paths` (`local`, `hub`), show both lists: the user may have fitted the globs to this repository. Options:
   - Overwrite, and delete the extra files: `catalog take <project> <domain> --overwrite --delete-extra`
   - Overwrite, and keep the extra files: `catalog take <project> <domain> --overwrite`. Say that the kept files are sent to the hub's catalog as new files at the next sync, so every PC gets them.
   - Keep as it is: no command. Say that at the next sync the differing files show as conflicts (sub-step 7 resolves them) and the extra files are sent to the hub's catalog as new files.
4. Write nothing else under `~/.rein/<project>/`. An overwrite writes the hub's rules with the hub's `paths:`.
5. Check the `paths:` globs of each rule written in step 3 (`written`). A glob is relative to the session root, and a rule without `paths:` always applies. Count the files each glob matches with `Glob` from the session root. A glob that matches nothing makes its rule never apply, without any error. Tell the user each such glob and ask with `AskUserQuestion` whether to change it. Write new globs into the local copy only, and only the ones the user gave.
6. Take the shared rules (`~/.rein/rules/`, applied in every project) with `rules pull`. Offline it answers `offline: true`: tell the user and go on.
7. Resolve the conflicts. Run `status`: its `conflict` lines are the catalog and shared-rule files changed here and on the hub since they last agreed. For each, show the user the difference (`diff <hub copy> <local file>`; a hub copy of `-` means the hub deleted the file) and ask with `AskUserQuestion`:
   - 서버 것 받기: `catalog resolve <local file> --take-hub`
   - 내 것으로 덮기: `catalog resolve <local file> --keep-mine`
   - 직접 합치기: edit the local file into the merge with the user, then `catalog resolve <local file> --keep-mine`
   `rules resolve` does the same for a file under `~/.rein/rules/`. An answer with `conflicts` again means the hub changed once more: ask again. A `conflicts` entry of kind `retro` is a retro file; the Rein repository's `/learn` resolves it, so only tell the user.
8. Tell the user the absolute paths you wrote or deleted.

## 7. Hub server

Rein can send each run's files to a hub server, so another PC can see the run or take it up, and keeps the domain catalog there. The hub is `node frame/hub.js serve --root <folder>` on an always-on PC of the user's Tailscale network, and answers only that network. Each PC names it in `~/.rein/sync.json`; without `server` there nothing is sent and runs stay on this PC. Do this step once, after step 6; skip it when the plan stage invoked this skill for a missing config.

1. If `~/.rein/sync.json` has `server`, show it to the user and check it as in 3. Change it only if they ask (from 2); otherwise go to 6.
2. Ask with `AskUserQuestion` for the hub's address, `http://<magicdns-name>:7380`: the hub PC's Tailscale MagicDNS name, and 7380 unless the hub runs with another `--port`. The other option is `지금은 안 함`; then stop here. Say that no code is sent, but the run files are (`1-spec.md`, `2-plan.md` with its file list and design, and the code and output `review.md` and `qa.md` quote).
3. Check that this PC reaches it: run `curl -s -m 5 <url>/api/info` with `Bash`. A hub answers JSON with `"hub":true`. If it does not, show the user the error and what to check (the hub PC is on and runs the hub, this PC is on the same tailnet: `tailscale status`), and write nothing until it passes or they tell you to write it anyway.
4. If `~/.rein/sync.json` still has `remote` (the git remote of the old sync) and the hub answered `"imported":null`, stop here and write nothing. Tell the user to import the old runs into the hub first, on the hub PC, from the Rein plugin's folder: `node scripts/import-rein-runs.js --remote <that remote> --root <the hub's folder>`. A PC that gets `server` before the import sends its own old copies first, and the PC that really holds a run then sees it as lost.
5. Write `~/.rein/sync.json` as `{ "server": "<url>" }`: drop `remote` and keep any other key the file has. Tell the user the absolute path.
6. If `~/.rein/.sync/` exists (the old sync's git cache, about 0.5 GB; nothing reads it now), run `node ${CLAUDE_PLUGIN_ROOT}/frame/server.js kick`, which starts sending this PC's runs, then `node ${CLAUDE_PLUGIN_ROOT}/frame/sync.js status`. While `reachable` is `null`, the server has not looked yet: run `status` again a few seconds later. When it shows `reachable: true` and `unsent: 0`, ask with `AskUserQuestion` whether to delete `~/.rein/.sync/`, and delete it with `rm -r` only if they say so. Otherwise leave it, and tell the user it can go once status shows nothing unsent.
7. Tell the user that each PC needs its own `sync.json` with the same address, and that `mcp__rein__status` with no run open lists this project's runs on the hub. If step 6 stopped for want of the hub, do step 6 now.
8. If this PC runs the hub, the frame server starts the hub again when it finds it gone, and the frame page shows a button that starts it; both need the hub's folder in `sync.json`. Do this sub-step when `sync.json` has `server` and its host's first label equals this PC's `hostname` (ignoring case); otherwise skip it. If `sync.json` already has `hubRoot`, show it and change it only if the user asks. Otherwise ask with `AskUserQuestion` for the folder this PC's hub serves (its `--root`, the folder holding `.hub/`); the other option is `이 PC는 허브 PC가 아님`, and then write nothing. Check that the folder has `.hub/`; if it does not, say so and ask again. Write it to `sync.json` as `hubRoot` (absolute path), keeping the other keys, and tell the user that the hub writes what it does and why it stopped to `<that folder>/.hub/hub.log`.

## 8. Remove the Herdr App block

Rein used to show a run's progress in a block of the Herdr App layout (the desktop app `herdr-app`, not the Herdr TUI `herdr`): the `rein` mod, which read `~/.rein/pane/<session id>.json`. The frame page now shows it, and the hook writes neither file nor block any more. This step removes what an earlier `/rein:setup` installed on this PC. Do it once, after step 7. Skip it when the plan stage invoked this skill for a missing config.

1. The Herdr App's home is `$HERDR_APP_HOME`, else `~/.config/herdr-app/`. Look for:
   - the folder `<home>/mods/rein/`;
   - each `<home>/layouts/*.json` with a node whose `id` is `rein` and whose `content` is `{ "mod": "rein" }`;
   - the folder `~/.rein/pane/`.
   If none is there, stop here.
2. Ask with `AskUserQuestion` whether to remove them. Show each absolute path found, and for a layout the node to be removed. Say that the frame page replaces the block. Options: remove, or `지금은 안 함`. If they choose not now, stop here.
3. Remove with `Bash`: `rm -r` the mod folder and `~/.rein/pane/`. In each layout file, delete only the `rein` node from its parent's `children`, and change nothing else in the file.
4. If the Herdr App is installed (`herdr-app` runs), run `herdr-app status`. If `errors` names a layout you changed, show the user the error.
5. Tell the user the absolute paths you removed or changed.
