#!/usr/bin/env node
// The Rein hub: the server on the always-on PC that keeps every PC's runs
// under one root, says which PC holds each run, and shows them read-only.
// It also keeps the domain catalog and the shared rules every PC syncs.
//
//   node hub.js serve --root <dir> [--port 7380] [--bind <ip>]   (or $REIN_HUB_ROOT)
//   node hub.js print-task --root <dir>   the schtasks line that starts it at logon
//
// It listens on this PC's Tailscale address only and answers tailnet peers only.
//
// Zero dependencies; Node 18 or later.
"use strict"

const http = require("http")
const fs = require("fs")
const path = require("path")
const os = require("os")
const crypto = require("crypto")
const { execFile } = require("child_process")
const { makeView, send, json, streamFile, readJson, listDir, STATES } = require("./view.js")
const { pathsBlock, withPaths, sha256, hashes, fileHash, isRule, bodyHash, treeDigest, NAME_OK, safeRel, RETRO_NAMES, retroOpen } = require("./text.js")

const PORT = 7380
// no Tailscale address yet (at logon), or the socket failed: try again after this
const RETRY_MS = 15 * 1000
const CLOSED = new Set(["complete", "drop"])
// a run's documents the hook reads at most this much of at once
const DOCS_CAP = 3 * 1024 * 1024
// files the uploader sends at most this large
const FILE_CAP = 512 * 1024 * 1024
const TMP = ".rein-tmp-"
// a project folder; dot folders and rules/ are the hub's own
const PROJECT_OK = p => NAME_OK(p) && !p.startsWith(".") && p !== "rules"

// ---------- the tailnet ----------

// a peer address on the tailnet: 100.64.0.0/10 or fd7a:115c:a1e0::/48
function tailnet(addr) {
  const a = String(addr || "").replace(/^::ffff:/i, "")
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(a)
  if (m) return Number(m[1]) >= 64 && Number(m[1]) <= 127
  return /^fd7a:115c:a1e0:/i.test(a)
}

// a Host (or Origin's host) a tailnet page may use: the bound address, the
// MagicDNS short name (no dots) or a *.ts.net name, with the hub's port.
function hostOk(value, at) {
  const m = /^([^:[\]]+):(\d+)$/.exec(value || "")
  if (!m || m[2] !== String(at.port)) return false
  const name = m[1].toLowerCase()
  return name === at.ip || !name.includes(".") || name.endsWith(".ts.net")
}

const TAILSCALE = process.platform === "win32" ? "C:/Program Files/Tailscale/tailscale.exe"
  : process.platform === "darwin" ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  : "tailscale"

// the address to listen on: --bind, else `tailscale ip -4`, else an interface
// in 100.64.0.0/10; null when there is none yet. Never 0.0.0.0.
async function bindAddress(bind) {
  if (bind) return bind
  const ip = await new Promise(resolve =>
    execFile(TAILSCALE, ["ip", "-4"], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : String(out).split(/\r?\n/)[0].trim())),
  )
  if (ip && tailnet(ip)) return ip
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if ((i.family === "IPv4" || i.family === 4) && tailnet(i.address)) return i.address
  }
  return null
}

// ---------- files ----------

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// rename, again a few times when Windows says EPERM or EBUSY (a reader or the
// watcher holds the target for a moment). Synchronous, so a check before it
// and the rename are one step.
function rename(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to) } catch (e) {
      if (i >= 5 || (e.code !== "EPERM" && e.code !== "EBUSY")) throw e
      sleepSync(50 * (i + 1))
    }
  }
}

// write a temp file beside file, then rename it into place
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}${TMP}${crypto.randomBytes(4).toString("hex")}`
  fs.writeFileSync(tmp, data)
  try { rename(tmp, file) } catch (e) {
    try { fs.unlinkSync(tmp) } catch {}
    throw e
  }
}

// a run's (or a catalog folder's) files as { rel: full path }, temp files left out
function runFiles(runDir) {
  const out = {}
  const walk = (dir, prefix) => {
    for (const d of listDir(dir)) {
      if (d.name.includes(TMP)) continue
      const full = path.join(dir, d.name)
      if (d.isDirectory()) walk(full, `${prefix}${d.name}/`)
      else if (d.isFile()) out[prefix + d.name] = full
    }
  }
  walk(runDir, "")
  return out
}

function manifest(runDir) {
  const files = {}
  for (const [rel, full] of Object.entries(runFiles(runDir))) {
    try {
      const st = fs.statSync(full)
      files[rel] = { size: st.size, hash: fileHash(full, st) }
    } catch {}
  }
  return files
}

// move a run folder; when the destination is there already (a move that
// crashed), merge file by file, then remove the source.
function moveRun(from, to) {
  if (from === to) return
  if (!fs.existsSync(from)) return fs.mkdirSync(to, { recursive: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (!fs.existsSync(to)) return rename(from, to)
  for (const [rel, full] of Object.entries(runFiles(from))) {
    const dest = path.join(to, ...rel.split("/"))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    rename(full, dest)
  }
  fs.rmSync(from, { recursive: true, force: true })
}

// a request body as a Buffer; null when it is over limit
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on("data", c => {
      n += c.length
      if (n <= limit) chunks.push(c)
    })
    req.on("end", () => resolve(n > limit ? null : Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

async function readBody(req) {
  const b = await readRaw(req, 64 * 1024)
  try { return JSON.parse(String(b)) } catch { return null }
}

// ---------- the hub ----------

// peerOk decides which peer addresses may talk to the hub; tests pass their own.
function makeHub({ root, peerOk = tailnet }) {
  const ROOT = path.resolve(root)
  const RECORDS = path.join(ROOT, ".hub", "runs")
  const DOMAINS = path.join(ROOT, ".hub", "domains")
  const RULES = path.join(ROOT, "rules")

  const recFile = (project, runId) => path.join(RECORDS, project, `${runId}.json`)
  const recordOf = (project, runId) => readJson(recFile(project, runId))
  const runDir = rec => path.join(ROOT, rec.project, rec.state, rec.runId)
  const infoOf = rec => readJson(path.join(runDir(rec), "agent", "record.json"))

  // a record changed: gen goes up
  function save(rec, change, by) {
    const next = { ...rec, ...change, gen: (rec.gen || 0) + 1, at: new Date().toISOString(), by }
    writeAtomic(recFile(rec.project, rec.runId), JSON.stringify(next, null, 2))
    return next
  }

  // the run's page, its list and its change events, read-only
  const view = makeView({ root: ROOT, readOnly: true, recordOf, debounceMs: 1000 })

  // the records of one project, or of all
  function records(project) {
    const projects = project ? [project] : listDir(RECORDS).filter(d => d.isDirectory()).map(d => d.name)
    const out = []
    for (const p of projects) {
      for (const d of listDir(path.join(RECORDS, p))) {
        if (!d.isFile() || !d.name.endsWith(".json")) continue
        const rec = readJson(path.join(RECORDS, p, d.name))
        if (rec) out.push(rec)
      }
    }
    return out
  }

  function listing(req, project) {
    const runs = []
    for (const rec of records(project)) {
      const p = rec.project
      const info = infoOf(rec) || {}
      const run = info.stage && info.title ? null : view.runOf(p, rec.state, rec.runId)
      const portable = info.portable === true
      runs.push({
        project: p,
        runId: rec.runId,
        uid: rec.uid,
        pc: rec.pc,
        state: rec.state,
        gen: rec.gen,
        at: rec.at,
        stage: info.stage || (run && run.stage) || null,
        title: info.title || (run && run.summary.title) || rec.runId,
        portable,
        resumable: !CLOSED.has(rec.state) && portable && info.run !== undefined,
        digest: treeDigest(Object.fromEntries(Object.entries(manifest(runDir(rec))).map(([rel, f]) => [rel, f.hash]))),
        link: `http://${req.headers.host}/#${encodeURIComponent(p)}/${encodeURIComponent(rec.runId)}`,
      })
    }
    return { runs }
  }

  // the md and html files a person reads, and agent/'s md files, up to DOCS_CAP
  function docs(dir) {
    const files = {}
    const skipped = []
    let total = 0
    for (const [rel, full] of Object.entries(runFiles(dir)).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const parts = rel.split("/")
      const ok = parts.length === 1 || (parts.length === 2 && ["brief", "handoff"].includes(parts[0]))
        ? /\.(md|html?)$/i.test(rel)
        : parts.length === 2 && parts[0] === "agent" && /\.md$/i.test(rel)
      if (!ok) continue
      const size = fs.statSync(full).size
      if (total + size > DOCS_CAP) { skipped.push(rel); continue }
      total += size
      files[rel] = fs.readFileSync(full, "utf8")
    }
    return { files, skipped }
  }

  // the record when pc may write the run, relabelling an "unknown" holder to
  // pc; otherwise answers 404 or 409 and gives null.
  function holder(res, project, runId, pc) {
    const rec = recordOf(project, runId)
    if (!rec) return json(res, 404, { error: "unknown run" }), null
    if (rec.pc === "unknown") return save(rec, { pc }, "relabel")
    if (rec.pc !== pc) return json(res, 409, { error: "not-holder", holder: rec.pc, record: rec }), null
    return rec
  }

  // /api/runs/<project>/<runId>[/<op>[/<rel>]]
  async function runApi(req, res, parts) {
    let seg
    try { seg = parts.map(decodeURIComponent) } catch { return json(res, 400, { error: "bad path" }) }
    const [project, runId, op = "", ...rest] = seg
    if (!PROJECT_OK(project) || !NAME_OK(runId)) return json(res, 400, { error: "bad path" })
    const rel = rest.join("/")
    if (op === "files" && !safeRel(rel)) return json(res, 400, { error: "bad path" })
    const m = req.method
    const pc = req.headers["x-rein-pc"]

    if (m === "GET") {
      const rec = recordOf(project, runId)
      if (!rec) return json(res, 404, { error: "unknown run" })
      if (op === "") return json(res, 200, { record: rec, info: infoOf(rec) })
      if (op === "manifest") return json(res, 200, { record: rec, files: manifest(runDir(rec)) })
      if (op === "docs") return json(res, 200, docs(runDir(rec)))
      if (op === "files") {
        const full = path.join(runDir(rec), ...rel.split("/"))
        let st
        try { st = fs.statSync(full) } catch {}
        if (!st || !st.isFile()) return json(res, 404, { error: "no file" })
        return streamFile(res, full, { "content-type": "application/octet-stream", "cache-control": "no-store", "x-rein-hash": fileHash(full, st) }, () => json(res, 404, { error: "no file" }))
      }
      return json(res, 404, { error: "not found" })
    }

    if (typeof pc !== "string" || pc === "") return json(res, 400, { error: "x-rein-pc missing" })

    if (m === "POST" && op === "create") {
      const b = await readBody(req)
      if (!b || !STATES.includes(b.state)) return json(res, 400, { error: "bad body" })
      const had = recordOf(project, runId)
      if (had) return json(res, 409, { error: "exists", record: had })
      const record = { v: 1, project, runId, uid: typeof b.uid === "string" ? b.uid : undefined, pc, state: b.state, gen: 1, at: new Date().toISOString(), by: "create" }
      fs.mkdirSync(runDir(record), { recursive: true })
      writeAtomic(recFile(project, runId), JSON.stringify(record, null, 2))
      return json(res, 201, { record })
    }

    if (m === "POST" && op === "state") {
      const b = await readBody(req)
      if (!b || !STATES.includes(b.state)) return json(res, 400, { error: "bad body" })
      const rec = holder(res, project, runId, pc)
      if (!rec) return
      if (rec.state === b.state && (rec.uid || typeof b.uid !== "string")) return json(res, 200, { record: rec })
      moveRun(runDir(rec), runDir({ ...rec, state: b.state }))
      // a legacy record takes the uid the run has
      const uid = rec.uid || (typeof b.uid === "string" ? b.uid : undefined)
      return json(res, 200, { record: save(rec, { state: b.state, uid }, "state") })
    }

    if (m === "POST" && op === "claim") {
      const b = await readBody(req)
      if (!b || !Number.isInteger(b.gen)) return json(res, 400, { error: "bad body" })
      const rec = recordOf(project, runId)
      if (!rec) return json(res, 404, { error: "unknown run" })
      if (CLOSED.has(rec.state)) return json(res, 422, { error: "closed" })
      if (b.gen !== rec.gen) return json(res, 409, { error: "changed", record: rec })
      moveRun(runDir(rec), runDir({ ...rec, state: "active" }))
      return json(res, 200, { record: save(rec, { pc, state: "active" }, "claim") })
    }

    if (m === "PUT" && op === "files") {
      const data = await readRaw(req, FILE_CAP)
      if (!data) return json(res, 413, { error: "too large" })
      if (req.headers["x-rein-hash"] !== sha256(data)) return json(res, 400, { error: "x-rein-hash does not match the body" })
      let rec = recordOf(project, runId)
      if (!rec) return json(res, 404, { error: "unknown run" })
      // a closed run's retro: any PC's /learn writes it, against the hash it last saw
      const retro = CLOSED.has(rec.state) && RETRO_NAMES.includes(rel)
      const ifMatch = req.headers["if-match"]
      const ifNone = req.headers["if-none-match"]
      if (retro && !ifMatch && ifNone !== "*") return json(res, 428, { error: "if-match or if-none-match: * required" })
      if (!retro && !(rec = holder(res, project, runId, pc))) return
      const full = path.join(runDir(rec), ...rel.split("/"))
      let hash = null
      try { hash = fileHash(full) } catch {}
      if ((ifMatch && ifMatch !== hash) || (ifNone === "*" && hash !== null)) return json(res, 412, { error: "changed", hash })
      writeAtomic(full, data)
      const st = fs.statSync(full)
      hashes.set(full, { size: st.size, mtime: st.mtimeMs, hash: req.headers["x-rein-hash"] })
      return json(res, 200, { size: st.size, hash: req.headers["x-rein-hash"] })
    }

    if (m === "DELETE" && op === "files") {
      const rec = holder(res, project, runId, pc)
      if (!rec) return
      fs.rmSync(path.join(runDir(rec), ...rel.split("/")), { force: true })
      return json(res, 200, { ok: true })
    }

    return json(res, 405, { error: "method not allowed" })
  }

  // each closed run's retro file; hash is the file's sha256, the if-match of its PUT
  function retros(project) {
    const out = []
    for (const rec of records(project)) {
      if (!CLOSED.has(rec.state)) continue
      const rel = RETRO_NAMES.find(n => fs.existsSync(path.join(runDir(rec), ...n.split("/"))))
      if (!rel) continue
      const full = path.join(runDir(rec), ...rel.split("/"))
      out.push({ project: rec.project, runId: rec.runId, state: rec.state, pc: rec.pc, rel, hash: fileHash(full), open: retroOpen(fs.readFileSync(full, "utf8")) })
    }
    return { retros: out }
  }

  // { rel: body hash } of a folder's files; prefix makes rel what bodyHash reads
  const bodyHashes = (dir, prefix) =>
    Object.fromEntries(Object.entries(runFiles(dir)).map(([rel, full]) => [rel, bodyHash(prefix + rel, fs.readFileSync(full))]))

  function catalog() {
    const domains = []
    for (const d of listDir(DOMAINS)) {
      if (!d.isDirectory()) continue
      const dir = path.join(DOMAINS, d.name)
      const meta = readJson(path.join(dir, "domain.json")) || {}
      domains.push({ id: d.name, name: meta.name || d.name, description: meta.description || "", files: bodyHashes(dir, "") })
    }
    return { domains }
  }

  // one catalog or shared-rules file, read and written against its body hash.
  // hashRel is its path as bodyHash reads it. Any PC writes, with a precondition;
  // a rule file keeps the hub's `paths:` unless x-rein-paths: replace.
  async function textFile(req, res, full, hashRel) {
    const m = req.method
    const read = () => { try { return fs.readFileSync(full) } catch { return null } }
    if (m === "GET") {
      const buf = read()
      if (!buf) return json(res, 404, { error: "no file" })
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-rein-hash": bodyHash(hashRel, buf) })
      return res.end(buf)
    }
    if (m !== "PUT" && m !== "DELETE") return json(res, 405, { error: "method not allowed" })
    const pc = req.headers["x-rein-pc"]
    if (typeof pc !== "string" || pc === "") return json(res, 400, { error: "x-rein-pc missing" })
    const data = m === "PUT" ? await readRaw(req, FILE_CAP) : null
    if (m === "PUT" && !data) return json(res, 413, { error: "too large" })
    const ifMatch = req.headers["if-match"]
    const ifNone = m === "PUT" ? req.headers["if-none-match"] : undefined
    if (!ifMatch && ifNone !== "*") return json(res, 428, { error: m === "PUT" ? "if-match or if-none-match: * required" : "if-match required" })
    const buf = read()
    const hash = buf ? bodyHash(hashRel, buf) : null
    if ((ifMatch && ifMatch !== hash) || (ifNone === "*" && buf)) return json(res, 412, { error: "changed", hash })
    if (m === "DELETE") {
      fs.rmSync(full, { force: true })
      return json(res, 200, { ok: true })
    }
    let text = data
    if (buf && isRule(hashRel) && req.headers["x-rein-paths"] !== "replace") {
      const b = pathsBlock(String(buf).replace(/\r\n/g, "\n"))
      text = withPaths(String(data).replace(/\r\n/g, "\n"), b ? b.text : null)
    }
    writeAtomic(full, text)
    return json(res, 200, { hash: bodyHash(hashRel, text) })
  }

  // /api/catalog/<domain>/<rel> (inCatalog) or /api/rules/<rel>
  function textApi(req, res, parts, inCatalog) {
    let seg
    try { seg = parts.map(decodeURIComponent) } catch { return json(res, 400, { error: "bad path" }) }
    const domain = inCatalog ? seg.shift() : null
    const rel = seg.join("/")
    if ((inCatalog && !NAME_OK(domain)) || !safeRel(rel)) return json(res, 400, { error: "bad path" })
    const base = inCatalog ? path.join(DOMAINS, domain) : RULES
    return textFile(req, res, path.join(base, ...rel.split("/")), inCatalog ? rel : `rules/${rel}`)
  }

  // the client API; false when the path is the page's
  async function api(req, res, p) {
    const get = req.method === "GET"
    if (get && p === "/api/info") return json(res, 200, { rein: true, hub: true, v: 1, now: new Date().toISOString(), imported: readJson(path.join(ROOT, ".hub", "imported.json")) }), true
    if (get && p === "/api/ping") return json(res, 200, { rein: true, hub: true, readOnly: true }), true
    if (get && p === "/api/runs") return json(res, 200, { now: Date.now(), hub: true, readOnly: true, ...view.snapshot() }), true
    if (get && p === "/api/hub/runs") {
      const project = new URL(req.url, "http://x").searchParams.get("project")
      if (project !== null && !PROJECT_OK(project)) return json(res, 400, { error: "bad project" }), true
      return json(res, 200, listing(req, project)), true
    }
    if (get && p === "/api/retros") {
      const project = new URL(req.url, "http://x").searchParams.get("project")
      if (project !== null && !PROJECT_OK(project)) return json(res, 400, { error: "bad project" }), true
      return json(res, 200, retros(project)), true
    }
    if (get && p === "/api/catalog") return json(res, 200, catalog()), true
    if (get && p === "/api/rules") return json(res, 200, { files: bodyHashes(RULES, "rules/") }), true
    if (p.startsWith("/api/runs/")) return await runApi(req, res, p.slice("/api/runs/".length).split("/")), true
    if (p.startsWith("/api/catalog/")) return await textApi(req, res, p.slice("/api/catalog/".length).split("/"), true), true
    if (p.startsWith("/api/rules/")) return await textApi(req, res, p.slice("/api/rules/".length).split("/"), false), true
    return false
  }

  // at is the bound { ip, port } the Host check compares with
  function handler(at) {
    return async (req, res) => {
      try {
        // tailnet peers only, and only pages addressed to this hub (DNS rebinding)
        if (!peerOk(req.socket.remoteAddress)) return send(res, 403, "text/plain", "forbidden")
        if (!hostOk(req.headers.host, at)) return send(res, 403, "text/plain", "forbidden")
        const origin = req.headers.origin
        if (origin && !hostOk(origin.replace(/^https?:\/\//, ""), at)) return send(res, 403, "text/plain", "forbidden")
        if (await api(req, res, new URL(req.url, "http://x").pathname)) return
        return await view.handle(req, res)
      } catch (e) {
        if (!res.headersSent) send(res, 500, "text/plain", String(e && e.message))
      }
    }
  }

  return { root: ROOT, view, handler }
}

// ---------- the process ----------

// whether anything answers HTTP at ip:port: the hub hub.json names, or
// whatever took its port. Its peer check may refuse this PC, so any answer counts.
function answers(ip, port, timeout = 800) {
  return new Promise(resolve => {
    const req = http.get({ host: ip, port, path: "/api/info", timeout }, res => {
      res.resume()
      resolve(true)
    })
    req.on("timeout", () => req.destroy())
    req.on("error", () => resolve(false))
  })
}

// listen, and again RETRY_MS after there is no address yet or the socket
// fails. Resolves with { server, at } the first time it listens.
async function serve({ root, port = PORT, bind = null, peerOk, log = m => console.error(m) }) {
  if (bind && !tailnet(bind)) throw new Error(`the hub listens on a Tailscale address only (100.64.0.0/10 or fd7a:115c:a1e0::/48), not on ${bind}`)
  const hub = makeHub({ root, peerOk })
  const INFO = path.join(hub.root, ".hub", "hub.json")
  const was = readJson(INFO)
  if (was && was.pid !== process.pid && was.ip && (await answers(was.ip, was.port))) throw new Error(`a hub for ${hub.root} already runs at http://${was.ip}:${was.port}/`)
  const at = { ip: null, port }
  const server = http.createServer(hub.handler(at))
  fs.mkdirSync(path.dirname(INFO), { recursive: true })
  hub.view.watch()
  return new Promise(resolve => {
    const start = async () => {
      const ip = await bindAddress(bind)
      if (!ip) {
        log(`no Tailscale address yet; trying again in ${RETRY_MS / 1000} s`)
        return setTimeout(start, RETRY_MS)
      }
      server.listen(port, ip, () => {
        at.ip = ip
        at.port = server.address().port
        writeAtomic(INFO, JSON.stringify({ pid: process.pid, ip, port: at.port, startedAt: new Date().toISOString() }))
        log(`Rein hub for ${hub.root} at http://${ip}:${at.port}/`)
        resolve({ server, at, info: INFO })
      })
    }
    server.on("error", e => {
      log(`${e && e.message}; listening again in ${RETRY_MS / 1000} s`)
      server.close(() => {})
      setTimeout(start, RETRY_MS)
    })
    start()
  })
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

if (require.main === module) {
  const cmd = process.argv[2]
  const root = arg("--root") || process.env.REIN_HUB_ROOT
  if ((cmd === "serve" || cmd === "print-task") && !root) {
    console.error("the hub's folder: --root <dir> or REIN_HUB_ROOT")
    process.exit(2)
  }
  if (cmd === "serve") {
    serve({ root, port: arg("--port") ? Number(arg("--port")) : PORT, bind: arg("--bind") || null })
      .then(({ info }) => {
        const quit = () => {
          try { if ((readJson(info) || {}).pid === process.pid) fs.unlinkSync(info) } catch {}
          process.exit(0)
        }
        process.on("SIGINT", quit)
        process.on("SIGTERM", quit)
        process.on("SIGHUP", quit)
      })
      .catch(e => {
        console.error(e && e.message)
        process.exit(1)
      })
  } else if (cmd === "print-task") {
    const tr = `"${process.execPath}" "${__filename}" serve --root "${path.resolve(root)}"`
    console.log(`schtasks /Create /SC ONLOGON /TN "Rein hub" /TR "${tr.replace(/"/g, '\\"')}" /F`)
  } else {
    console.error("usage: node hub.js serve|print-task --root <dir> [--port 7380] [--bind <ip>]")
    process.exit(2)
  }
}

module.exports = { makeHub, serve, tailnet, hostOk }
