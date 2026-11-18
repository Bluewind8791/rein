"use strict"

const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawnSync } = require("child_process")

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "import-rein-runs.js")
const noGit = !!spawnSync("git", ["--version"]).error
const ENV = { ...process.env, GIT_AUTHOR_NAME: "rein", GIT_AUTHOR_EMAIL: "rein@localhost", GIT_COMMITTER_NAME: "rein", GIT_COMMITTER_EMAIL: "rein@localhost" }

function git(args, { cwd, index, stdin } = {}) {
  const r = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, input: stdin, env: index ? { ...ENV, GIT_INDEX_FILE: index } : ENV })
  assert.strictEqual(r.status, 0, String(r.stderr))
  return String(r.stdout).trim()
}

// refPart in hooks/lib/sync.ts
function refPart(name) {
  let out = ""
  for (const byte of Buffer.from(name, "utf8")) {
    const ch = String.fromCharCode(byte)
    out += /[A-Za-z0-9_-]/.test(ch) || (ch === "." && out !== "") ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  }
  return out
}

// one snapshot as sendSnapshot pushed it: the folder's files and the record
function snapshot(gd, tmp, rec, files) {
  const folder = path.join(tmp, "src", rec.runId)
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true })
    fs.writeFileSync(path.join(folder, rel), data)
  }
  const index = path.join(tmp, `index-${rec.runId}`)
  git([`--git-dir=${gd}`, "read-tree", "--empty"], { index })
  git([`--git-dir=${gd}`, `--work-tree=${folder}`, "add", "-A", "--", "."], { cwd: folder, index })
  const blob = git([`--git-dir=${gd}`, "hash-object", "-w", "--stdin"], { stdin: `${JSON.stringify(rec, null, 2)}\n` })
  git([`--git-dir=${gd}`, "update-index", "--add", "--cacheinfo", `100644,${blob},.sync/record.json`], { index })
  const tree = git([`--git-dir=${gd}`, "write-tree"], { index })
  const commit = git([`--git-dir=${gd}`, "commit-tree", "--no-gpg-sign", tree, "-m", `${rec.event}: ${rec.project}/${rec.runId}`])
  git([`--git-dir=${gd}`, "update-ref", `refs/heads/runs/${refPart(rec.project)}/${rec.runId}`, commit])
}

const BINARY = Buffer.from([0, 1, 2, 13, 10, 255, 254, 0, 10])
const KOREAN = "예제 프로젝트"
const RUN = { v: 2, runId: "login-fix", stage: "plan", rules: [], writes: [], retries: 0 }
const ACTIVE = { v: 1, project: "rein", runId: "login-fix", pc: "PC-A", state: "active", stage: "plan", title: "로그인 고침", at: "2026-11-10T09:00:00.000Z", event: "plan", portable: true, run: RUN }
const CLOSED = { v: 1, project: KOREAN, runId: "old-run", pc: "unknown", state: "complete", stage: "land", title: "Old", at: "2026-11-01T09:00:00.000Z", event: "complete", portable: true }

function importer(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
}

test("imports the git remote's runs onto the hub's root", { skip: noGit && "git is missing" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rein-import-test-"))
  try {
    const remote = path.join(tmp, "remote.git")
    const root = path.join(tmp, "hub")
    git(["init", "--bare", "-q", remote])
    snapshot(remote, tmp, ACTIVE, { "1-spec.md": "# Spec\n", "agent/trace.jsonl": "{}\n", "evidence/shot.png": BINARY })
    snapshot(remote, tmp, CLOSED, { "1-spec.md": "# 기획\r\n", "retro.md": "상태: 후보\n" })

    // --dry-run says what it would do and writes nothing
    let r = importer(["--remote", remote, "--root", root, "--dry-run"])
    assert.strictEqual(r.status, 0, r.stderr)
    assert.match(r.stdout, /would import rein\/login-fix \(active, PC-A\)/)
    assert.match(r.stdout, /2 to import, 0 skipped, 0 failed/)
    assert.ok(!fs.existsSync(root))

    r = importer(["--remote", remote, "--root", root])
    assert.strictEqual(r.status, 0, r.stderr)
    assert.match(r.stdout, /imported 예제 프로젝트\/old-run \(complete, unknown\)/)
    assert.match(r.stdout, /2 imported, 0 skipped, 0 failed/)

    // the files as they were, without .sync/
    const active = path.join(root, "rein", "active", "login-fix")
    assert.strictEqual(fs.readFileSync(path.join(active, "1-spec.md"), "utf8"), "# Spec\n")
    assert.deepStrictEqual(fs.readFileSync(path.join(active, "evidence", "shot.png")), BINARY)
    assert.ok(!fs.existsSync(path.join(active, ".sync")))
    const closed = path.join(root, KOREAN, "complete", "old-run")
    assert.strictEqual(fs.readFileSync(path.join(closed, "1-spec.md"), "utf8"), "# 기획\r\n")
    assert.ok(!fs.existsSync(path.join(closed, ".sync")))

    const read = p => JSON.parse(fs.readFileSync(p, "utf8"))
    assert.deepStrictEqual(read(path.join(active, "agent", "record.json")),
      { v: 1, project: "rein", runId: "login-fix", stage: "plan", title: "로그인 고침", at: ACTIVE.at, event: "import", portable: true, run: RUN })
    assert.deepStrictEqual(read(path.join(closed, "agent", "record.json")),
      { v: 1, project: KOREAN, runId: "old-run", stage: "land", title: "Old", at: CLOSED.at, event: "import", portable: true })
    assert.deepStrictEqual(read(path.join(root, ".hub", "runs", "rein", "login-fix.json")),
      { v: 1, project: "rein", runId: "login-fix", pc: "PC-A", state: "active", gen: 1, at: ACTIVE.at, by: "import" })
    assert.deepStrictEqual(read(path.join(root, ".hub", "runs", KOREAN, "old-run.json")),
      { v: 1, project: KOREAN, runId: "old-run", pc: "unknown", state: "complete", gen: 1, at: CLOSED.at, by: "import" })
    let imported = read(path.join(root, ".hub", "imported.json"))
    assert.strictEqual(imported.remote, remote)
    assert.strictEqual(imported.count, 2)
    assert.ok(!Number.isNaN(Date.parse(imported.at)))

    // run again: what the hub has stays
    fs.writeFileSync(path.join(active, "1-spec.md"), "# Changed on the hub\n")
    r = importer(["--remote", remote, "--root", root])
    assert.strictEqual(r.status, 0, r.stderr)
    assert.match(r.stdout, /skipped rein\/login-fix: on the hub already/)
    assert.match(r.stdout, /0 imported, 2 skipped, 0 failed/)
    assert.strictEqual(fs.readFileSync(path.join(active, "1-spec.md"), "utf8"), "# Changed on the hub\n")
    assert.strictEqual(read(path.join(root, ".hub", "imported.json")).count, 0)

    // --force takes the remote's copy again, from wherever the hub had moved it
    const record = path.join(root, ".hub", "runs", "rein", "login-fix.json")
    fs.writeFileSync(record, JSON.stringify({ ...read(record), state: "defer", gen: 4 }))
    fs.mkdirSync(path.join(root, "rein", "defer"))
    fs.renameSync(active, path.join(root, "rein", "defer", "login-fix"))
    r = importer(["--remote", remote, "--root", root, "--force"])
    assert.strictEqual(r.status, 0, r.stderr)
    assert.match(r.stdout, /2 imported, 0 skipped, 0 failed/)
    assert.ok(!fs.existsSync(path.join(root, "rein", "defer", "login-fix")))
    assert.strictEqual(fs.readFileSync(path.join(active, "1-spec.md"), "utf8"), "# Spec\n")
    assert.strictEqual(read(record).gen, 1)
    assert.strictEqual(read(record).state, "active")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
