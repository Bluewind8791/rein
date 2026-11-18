#!/usr/bin/env node
// Copies the runs PCs sent to the old git sync remote (refs/heads/runs/*)
// onto the hub's root. Run it once, before any PC is given the hub's address.
//
//   node import-rein-runs.js --remote <url|path> --root <hub root> [--git-dir <bare repo>] [--dry-run] [--force]
//
// Each run lands in <root>/<project>/<state>/<runId>/ with its agent/record.json,
// and the hub's record .hub/runs/<project>/<runId>.json says which PC holds it.
// A run the hub has a record of is left alone, unless --force. --git-dir
// reuses a bare repository (~/.rein/.sync/repo.git) instead of a temp one.
//
// Zero dependencies; Node 18 or later.
"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")
const crypto = require("crypto")
const { spawnSync } = require("child_process")
const { readJson, STATES } = require("../frame/view.js")
const { NAME_OK } = require("../frame/text.js")

// where the old snapshots kept the run's record (RECORD in hooks/lib/sync.ts)
const RECORD = ".sync/record.json"
// a project folder; dot folders and rules/ are the hub's own
const PROJECT_OK = p => NAME_OK(p) && !p.startsWith(".") && p !== "rules"

// git asks no one (a credential or SSH prompt fails at once), keeps the
// bytes as they are and runs no repository hooks, as the hook's sync did.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }
const CONFIG = ["-c", "core.autocrlf=false", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false", "-c", "core.pager=cat"]

function git(args, { index, cwd } = {}) {
  const r = spawnSync("git", [...CONFIG, ...args], { cwd, env: index ? { ...ENV, GIT_INDEX_FILE: index } : ENV, maxBuffer: 256 * 1024 * 1024, windowsHide: true })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(String(r.stderr).trim().split(/\r?\n/)[0] || `git ${args.find(a => !a.startsWith("-"))} failed`)
  return String(r.stdout)
}

// write a temp file beside file, then rename it into place
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.rein-tmp-${crypto.randomBytes(4).toString("hex")}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// refs/rein/<project>/<runId>, the project as refPart in hooks/lib/sync.ts
// wrote it: every byte but letters, digits, "_", "-" and a later "." as %XX.
function runsOf(gd) {
  const out = []
  for (const line of git([`--git-dir=${gd}`, "for-each-ref", "--format=%(objectname) %(refname)", "refs/rein/"]).split(/\r?\n/)) {
    const [sha, ref] = line.split(" ")
    const parts = (ref || "").split("/").slice(2)
    if (parts.length !== 2) continue
    let project
    try { project = decodeURIComponent(parts[0]) } catch { project = parts[0] }
    out.push({ sha, project, runId: parts[1] })
  }
  return out
}

function importRuns({ remote, root, gitDir, dryRun, force, log }) {
  root = path.resolve(root)
  const gd = gitDir ? path.resolve(gitDir) : fs.mkdtempSync(path.join(os.tmpdir(), "rein-import-"))
  const index = path.join(gd, "index-import")
  const n = { imported: 0, skipped: 0, failed: 0 }
  try {
    if (!gitDir) git(["init", "--bare", "-q", gd])
    git([`--git-dir=${gd}`, "fetch", "-q", "--no-tags", "--prune", remote, "+refs/heads/runs/*:refs/rein/*"])
    for (const { sha, project, runId } of runsOf(gd)) {
      const name = `${project}/${runId}`
      let rec
      try { rec = JSON.parse(git([`--git-dir=${gd}`, "show", `${sha}:${RECORD}`])) } catch {}
      if (!rec || rec.v !== 1 || typeof rec.pc !== "string" || !STATES.includes(rec.state)) {
        n.failed++
        log(`failed ${name}: no readable ${RECORD}`)
        continue
      }
      if (!PROJECT_OK(project) || !NAME_OK(runId)) {
        n.failed++
        log(`failed ${name}: not a name the hub keeps`)
        continue
      }
      const recFile = path.join(root, ".hub", "runs", project, `${runId}.json`)
      const had = readJson(recFile)
      if (had && !force) {
        n.skipped++
        log(`skipped ${name}: on the hub already`)
        continue
      }
      const what = `${name} (${rec.state}, ${rec.pc})`
      if (dryRun) {
        n.imported++
        log(`would import ${what}`)
        continue
      }
      try {
        // --force: the hub's copy goes, wherever its record put it
        const dir = path.join(root, project, rec.state, runId)
        if (had && STATES.includes(had.state)) fs.rmSync(path.join(root, project, had.state, runId), { recursive: true, force: true })
        fs.rmSync(dir, { recursive: true, force: true })
        fs.mkdirSync(root, { recursive: true })
        git([`--git-dir=${gd}`, "read-tree", sha], { index })
        git([`--git-dir=${gd}`, `--work-tree=${root}`, "checkout-index", "-a", "-f", `--prefix=${project}/${rec.state}/${runId}/`], { index, cwd: root })
        fs.rmSync(path.join(dir, ".sync"), { recursive: true, force: true })
        // the snapshot's time stays, so the runs keep their order on the hub
        writeJson(path.join(dir, "agent", "record.json"), {
          v: 1, project, runId, stage: rec.stage, title: rec.title, at: rec.at, event: "import", portable: rec.portable,
          ...(rec.run !== undefined ? { run: rec.run } : {}),
        })
        writeJson(recFile, { v: 1, project, runId, pc: rec.pc, state: rec.state, gen: 1, at: rec.at, by: "import" })
        n.imported++
        log(`imported ${what}`)
      } catch (e) {
        n.failed++
        log(`failed ${name}: ${e && e.message}`)
      }
    }
    if (!dryRun) writeJson(path.join(root, ".hub", "imported.json"), { at: new Date().toISOString(), remote, count: n.imported })
  } finally {
    if (gitDir) fs.rmSync(index, { force: true })
    else fs.rmSync(gd, { recursive: true, force: true })
  }
  return n
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

if (require.main === module) {
  const remote = arg("--remote")
  const root = arg("--root")
  if (!remote || !root) {
    console.error("usage: node import-rein-runs.js --remote <url|path> --root <hub root> [--git-dir <bare repo>] [--dry-run] [--force]")
    process.exit(2)
  }
  const dryRun = process.argv.includes("--dry-run")
  try {
    const n = importRuns({ remote, root, gitDir: arg("--git-dir"), dryRun, force: process.argv.includes("--force"), log: m => console.log(m) })
    console.log(`${n.imported} ${dryRun ? "to import" : "imported"}, ${n.skipped} skipped, ${n.failed} failed`)
    process.exit(n.failed > 0 ? 1 : 0)
  } catch (e) {
    console.error(e && e.message)
    process.exit(1)
  }
}
