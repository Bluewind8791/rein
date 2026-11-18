---
name: release
description: Pushes Rein's main branch and, when the commits since the last release change what users install, releases it (version bump, release commit, rein--v<version> tag) so the session-start notice reaches installed copies. Use whenever pushing this repository, and when the user asks to deploy or release (푸시, 배포, 릴리스).
---

# release

Every push of this repository goes through here. Installed copies only move when `version` changes, and the session-start notice only sees a release through its `rein--v<version>` tag. A push that skips either leaves users on the old version with no notice.

Run the steps in order. If a step fails, stop, show the failing line, and do not push.

## 1. Commit what is pending

If the working tree has changes the user asked to ship, commit them first as usual: a Korean message after an English type prefix (`feat: …`, `fix: …`), as in `git log`, `Closes #N` where it applies, and no `Co-Authored-By` or other AI attribution trailer. Then the tree must be clean (`git status --porcelain` empty) and the branch must be `main`.

## 2. Verify

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test
claude plugin validate .
tsc --noEmit -p .
for f in $(git ls-files '*.js' '*.mjs' ':!tests/*'); do node --check "$f" || exit 1; done
node --test tests/node/*.test.js
grep -n '^const VERSION' hooks/register.ts
```

All tests must pass. `validate` may warn about the missing author and marketplace description, the missing plugin icon (`ICON_MISSING`), a plugin directory check, that the root `CLAUDE.md` is not loaded as plugin context (it is for working on this repository), and TypeScript errors in `hooks/` and `tests/` such as `TS5097` (`.ts` import paths) or `TS2304` (`setTimeout`), which come from checking each file without `tsconfig.json`; `tsc --noEmit -p .` is the type check that counts, and it must report no errors. Anything else is a failure. `VERSION` in `hooks/register.ts` must equal `version` in `.claude-plugin/plugin.json`; if it does not, set it to that and commit it as `fix: sync the hook's VERSION with plugin.json` before going on.

## 3. Decide the version

```bash
git describe --tags --abbrev=0 --match 'rein--v*'
git log <tag>..HEAD --format=%s
git diff --name-only <tag>..HEAD
```

- No commits since the tag: nothing to release. Push (step 5 without the tag) if `origin/main` is behind, then report.
- Every changed file is under `docs/`, `tests/` or `.claude/`, or is `.gitignore` or `CLAUDE.md`: users get nothing new. Push without a release.
- Otherwise release. While the version is `0.x`: any `feat` commit or breaking change (`!` after the type, or `BREAKING CHANGE` in the body) bumps the minor and resets the patch (`0.3.0` to `0.4.0`); anything else bumps the patch (`0.3.0` to `0.3.1`). Go to `1.0.0` or bump the major only when the user asks.

Tell the user the old and new version and the reason in one line before going on.

## 4. Bump

Set `version` in `.claude-plugin/plugin.json` and `const VERSION` in `hooks/register.ts` (trace and run records carry it) to the new version. Change nothing else. Commit only those two files, with this message alone (no `Co-Authored-By` trailer):

```
chore: release <version>
```

## 5. Push and tag

```bash
git push origin main
claude plugin tag --push .
```

Push the branch before the tag, so the tag never points at a commit the remote does not have. `claude plugin tag` checks that `plugin.json` and the marketplace entry agree and refuses a dirty tree or an existing tag. Never pass `--force`: a tag that already exists means this version was released; bump again instead.

## 6. Confirm

```bash
git ls-remote --tags origin rein--v<version>
git status -sb
```

The tag must be on the remote and `main` in sync with `origin/main`.

## End

Report the commits pushed, the new version and tag (or that no release was needed and why). Remind the user that installed copies pick it up with `/rein:update` and `/reload-plugins`; an install older than `0.3.0` has no `/rein:update` and needs `claude plugin marketplace update rein` then `claude plugin update rein@rein -s <scope>`.
