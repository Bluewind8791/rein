#!/usr/bin/env node
// The Rein hub's client: the HTTP calls to the hub that ~/.rein/sync.json
// (or $REIN_HOME/sync.json) names, the local runs and their file hashes,
// and the commands the hook runs.
//
//   node sync.js pull-run --server <url> --pc <pc> <project> <runId> <dest>
//       download a hub run's files beside dest, check their hashes and
//       rename the folder into place; the last line says
//       {"ok":true,"files":n} or {"error":"..."}
//   node sync.js refresh | catalog list|take|checkout|push|resolve | rules pull|push|resolve | status
//       the domain catalog and the shared rules against the hub sync.json
//       names (catalog.js); a conflict prints
//       conflict<TAB><local file><TAB><hub copy> before the last line
//
// Zero dependencies; Node 18 or later.
"use strict"

const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { sha256, fileHash, treeDigest, safeRel, pcName } = require("./text.js")
const { readJson, listDir, STATES } = require("./view.js")

const ROOT = path.resolve(process.env.REIN_HOME || path.join(os.homedir(), ".rein"))
const VERSION = (readJson(path.join(__dirname, "..", ".claude-plugin", "plugin.json")) || {}).version || "0"
// connecting, and then the answer's headers, each take at most this long
const CONNECT_MS = 3000
// a JSON call takes at most this long in all
const JSON_MS = 5000
// a file transfer takes at most FILE_MS plus FILE_STEP_MS for every FILE_STEP bytes
const FILE_MS = 10 * 1000
const FILE_STEP_MS = 1000
const FILE_STEP = 256 * 1024
// files the uploader sends at most this large, as the hub takes them
const FILE_CAP = 512 * 1024 * 1024
const TMP = ".rein-tmp-"
// local runs, in the state that wins when one runId sits in several
const PREFER = ["active", "defer", "complete", "drop"]

// the hub did not answer: no connection, a timeout, or a cut transfer
class OfflineError extends Error {
  constructor(message) {
    super(message)
    this.name = "OfflineError"
  }
}

// ---------- the hub over HTTP ----------

// one request; resolves with { status, headers, buf } for any answer, and
// rejects with OfflineError when there is none in time.
function request(server, method, p, { headers = {}, body = null, totalMs }) {
  const url = new URL(server.replace(/\/+$/, "") + p)
  const mod = url.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    let done = false
    let wait = null
    let total = null
    const finish = () => {
      done = true
      clearTimeout(wait)
      clearTimeout(total)
    }
    const fail = message => {
      if (done) return
      finish()
      req.destroy()
      reject(new OfflineError(message))
    }
    const req = mod.request(url, { method, headers: body ? { ...headers, "content-length": body.length } : headers })
    wait = setTimeout(() => fail(`no connection within ${CONNECT_MS / 1000} s`), CONNECT_MS)
    total = setTimeout(() => fail(`not done within ${totalMs / 1000} s`), totalMs)
    // the body is sent: the headers come within CONNECT_MS
    req.on("finish", () => {
      clearTimeout(wait)
      if (!done) wait = setTimeout(() => fail(`no answer within ${CONNECT_MS / 1000} s`), CONNECT_MS)
    })
    req.on("response", res => {
      clearTimeout(wait)
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => {
        if (done) return
        finish()
        resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) })
      })
      res.on("error", e => fail(e.message))
    })
    req.on("error", e => fail(e.message))
    if (body) req.end(body)
    else req.end()
  })
}

const fileMs = size => FILE_MS + Math.ceil(size / FILE_STEP) * FILE_STEP_MS

// "/api/runs/<project>/<runId>[/<more>...]", each segment encoded
const runPath = (project, runId, ...more) => "/api/runs/" + [project, runId, ...more].map(encodeURIComponent).join("/")

// a client of one hub, as this PC; client says who calls ("frame" or "cli")
function makeClient({ server, pc = pcName(), client = "frame" }) {
  const base = { "x-rein-pc": pc, "x-rein-client": `${client}/${VERSION}` }
  return {
    server,
    pc,
    // { status, json }, json null when the answer is no JSON
    async json(method, p, body) {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
      const r = await request(server, method, p, { headers: data ? { ...base, "content-type": "application/json" } : base, body: data, totalMs: JSON_MS })
      let json = null
      try { json = JSON.parse(String(r.buf)) } catch {}
      return { status: r.status, json }
    },
    // PUT raw bytes with their hash; headers adds if-match and the like
    async upload(p, buf, headers = {}) {
      const r = await request(server, "PUT", p, { headers: { ...base, ...headers, "x-rein-hash": sha256(buf) }, body: buf, totalMs: fileMs(buf.length) })
      let json = null
      try { json = JSON.parse(String(r.buf)) } catch {}
      return { status: r.status, json }
    },
    // { status, buf, hash }, hash being the bytes' own sha256; size, when
    // known, sets the time it may take
    async download(p, size = 0) {
      const r = await request(server, "GET", p, { headers: base, totalMs: fileMs(size) })
      return { status: r.status, buf: r.buf, hash: sha256(r.buf) }
    },
  }
}

// the hub's address from <root>/sync.json; null when it names none
function serverOf(root = ROOT) {
  const said = readJson(path.join(root, "sync.json"))
  const server = said && typeof said.server === "string" ? said.server.trim().replace(/\/+$/, "") : ""
  return /^https?:\/\/./.test(server) ? server : null
}

// the hub's folder from <root>/sync.json, set only on the PC that runs the
// hub; null elsewhere
function hubRootOf(root = ROOT) {
  const said = readJson(path.join(root, "sync.json"))
  const dir = said && typeof said.hubRoot === "string" ? said.hubRoot.trim() : ""
  return dir ? path.resolve(dir) : null
}

// ---------- local runs and their files ----------

// a file that never goes to the hub: temp files, Office locks, the
// desktop's own files
const skipped = name => name.includes(TMP) || name.startsWith("~$") || name === ".DS_Store" || name === "Thumbs.db"

// a run folder's files as { rel: { size, hash } }, the skipped ones, those
// over FILE_CAP and those with a name the hub refuses left out
function localFiles(runDir) {
  const out = {}
  const walk = (dir, prefix) => {
    for (const d of listDir(dir)) {
      const full = path.join(dir, d.name)
      if (d.isDirectory()) walk(full, `${prefix}${d.name}/`)
      else if (d.isFile() && !skipped(d.name) && safeRel(prefix + d.name)) {
        try {
          const st = fs.statSync(full)
          if (st.size <= FILE_CAP) out[prefix + d.name] = { size: st.size, hash: fileHash(full, st) }
        } catch {}
      }
    }
  }
  walk(runDir, "")
  return out
}

// the digest the hub lists a run with, over { rel: { hash } }
const digestOf = files => treeDigest(Object.fromEntries(Object.entries(files).map(([rel, f]) => [rel, f.hash])))

// the runs under root as [{ project, state, runId, dir }]: every project
// folder but dot folders, frame/ and rules/; a runId in several states
// counts once, in the first state of PREFER.
function localRuns(root = ROOT) {
  const runs = []
  for (const p of listDir(root)) {
    if (!p.isDirectory() || p.name.startsWith(".") || p.name === "frame" || p.name === "rules") continue
    const seen = new Set()
    for (const state of PREFER) {
      for (const r of listDir(path.join(root, p.name, state))) {
        if (!r.isDirectory() || seen.has(r.name)) continue
        seen.add(r.name)
        runs.push({ project: p.name, state, runId: r.name, dir: path.join(root, p.name, state, r.name) })
      }
    }
  }
  return runs
}

// ---------- pull-run ----------

// rename, again a few times when Windows says EPERM or EBUSY (a virus
// scanner holds a file just written)
async function rename(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to) } catch (e) {
      if (i >= 5 || (e.code !== "EPERM" && e.code !== "EBUSY")) throw e
      await new Promise(r => setTimeout(r, 200 * (i + 1)))
    }
  }
}

// a file written whole through a temp file beside it, so no reader sees
// half of it
async function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}${TMP}${Math.random().toString(36).slice(2, 10)}`
  fs.writeFileSync(tmp, data)
  try { await rename(tmp, file) } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

// ---------- bases: what this PC and the hub last agreed on ----------

// <root>/.hub/base.json: { "<tree>": { "<rel>": "<hash>" } }, each file's
// hash the last time both sides had the same. The local server and the
// commands both change it, so every change holds base.lock, made with
// O_EXCL and taken over once it is older than LOCK_STALE_MS.
const LOCK_STALE_MS = 30 * 1000

const readBase = (root = ROOT) => readJson(path.join(root, ".hub", "base.json")) || {}

// fn changes the bases it is given; they are written back after it
async function withBase(fn, root = ROOT) {
  const lock = path.join(root, ".hub", "base.lock")
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"))
      break
    } catch (e) {
      if (e.code !== "EEXIST") throw e
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true }) } catch {}
      await new Promise(r => setTimeout(r, 50))
    }
  }
  try {
    const base = readBase(root)
    const said = await fn(base)
    await writeAtomic(path.join(root, ".hub", "base.json"), JSON.stringify(base, null, 2))
    return said
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

// every file of the hub's run into dest (~/.rein/<p>/active/<runId>):
// downloaded into ~/.rein/<p>/.incoming-<runId>, each checked against the
// manifest's hash, then renamed into place. The number of files; on
// failure the incoming folder is gone and dest untouched.
async function pullRun({ server, pc, project, runId, dest }) {
  const hub = makeClient({ server, pc, client: "cli" })
  const incoming = path.join(path.dirname(path.dirname(dest)), `.incoming-${runId}`)
  if (fs.existsSync(dest)) throw new Error(`${dest} is there already`)
  fs.rmSync(incoming, { recursive: true, force: true })
  try {
    const m = await hub.json("GET", runPath(project, runId, "manifest"))
    if (m.status !== 200 || !m.json || !m.json.files) throw new Error(`the hub answered ${m.status} for the files of ${project}/${runId}`)
    const files = Object.entries(m.json.files)
    fs.mkdirSync(incoming, { recursive: true })
    for (const [rel, f] of files) {
      if (!safeRel(rel)) throw new Error(`the hub named a file outside the run: ${rel}`)
      const got = await hub.download(runPath(project, runId, "files", ...rel.split("/")), f.size)
      if (got.status !== 200) throw new Error(`the hub answered ${got.status} for ${rel}`)
      if (got.hash !== f.hash) throw new Error(`${rel} changed on the hub while it downloaded`)
      const full = path.join(incoming, ...rel.split("/"))
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, got.buf)
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await rename(incoming, dest)
    return files.length
  } catch (e) {
    fs.rmSync(incoming, { recursive: true, force: true })
    throw e
  }
}

// ---------- the commands ----------

// options that take no value
const FLAGS = new Set(["overwrite", "delete-extra", "keep-mine", "take-hub"])

// --name value options (true for FLAGS) and the rest in order
function parse(args) {
  const opts = {}
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) rest.push(args[i])
    else if (FLAGS.has(args[i].slice(2))) opts[args[i].slice(2)] = true
    else opts[args[i].slice(2)] = args[++i]
  }
  return { opts, rest }
}

// a catalog.js command over ROOT; required here, since catalog.js requires this file
const catalogCommand = name => async args => {
  const { opts, rest } = parse(args)
  return require("./catalog.js").commands[name](ROOT, rest, opts)
}

const COMMANDS = {
  async "pull-run"(args) {
    const { opts, rest } = parse(args)
    const [project, runId, dest] = rest
    if (!opts.server || !dest) throw new Error("usage: node sync.js pull-run --server <url> --pc <pc> <project> <runId> <dest>")
    return { ok: true, files: await pullRun({ server: opts.server, pc: opts.pc || pcName(), project, runId, dest }) }
  },
  refresh: catalogCommand("refresh"),
  catalog: catalogCommand("catalog"),
  rules: catalogCommand("rules"),
  status: catalogCommand("status"),
}

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code))
}

// before the commands run: catalog.js, which they require, requires this file
module.exports = { OfflineError, makeClient, runPath, serverOf, hubRootOf, fileHash, localFiles, digestOf, localRuns, pullRun, writeAtomic, readBase, withBase }

if (require.main === module) {
  const command = COMMANDS[process.argv[2]]
  if (!command) {
    console.error(`usage: node sync.js ${Object.keys(COMMANDS).join("|")} ...`)
    process.exit(2)
  }
  command(process.argv.slice(3)).then(
    said => out(said, 0),
    e => out({ error: String(e && e.message) }, 1),
  )
}
