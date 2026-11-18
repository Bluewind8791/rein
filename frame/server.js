#!/usr/bin/env node
// The Rein frame: a local web server that shows the runs under ~/.rein
// (or $REIN_HOME) and their artifacts in one page.
//
//   node server.js ensure   start the server unless one is up, print {"url"}
//   node server.js serve    run the server in this process
//   node server.js kick     start the server unless one is up, without
//                           waiting for it; a running one compares every
//                           run with the hub now
//
// When ~/.rein/sync.json names a hub (server), the server also sends this
// PC's runs there (uploader.js).
//
// Zero dependencies; Node 18 or later.
"use strict"

const http = require("http")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn } = require("child_process")
const { makeView, send, json, readJson } = require("./view.js")
const { serverOf } = require("./sync.js")
const { makeUploader } = require("./uploader.js")

const ROOT = path.resolve(process.env.REIN_HOME || path.join(os.homedir(), ".rein"))
// how two servers tell they serve the same root (Windows paths ignore case)
const SAME_ROOT = r => typeof r === "string" && (process.platform === "win32" ? r.toLowerCase() === ROOT.toLowerCase() : r === ROOT)
const INFO = path.join(ROOT, "frame", "server.json")
const BASE_PORT = 7357
const PORT_TRIES = 20
// the server exits after this long with no active run and no open page.
const IDLE_MS = 30 * 60 * 1000
// with files not on the hub yet it waits for them, but at most this long
// after the last change, so a dead hub does not keep it up for good
const UNSENT_MS = 12 * 60 * 60 * 1000
// the frame protocol; ensure and kick ask a server that answers an older
// one (or none) to quit, so one started before an update gives way
const V = 2

// the hub's uploader while sync.json names one
let uploader = null

// the runs, the page and the checklist writes; the run list carries the
// uploader's status as hub
const view = makeView({ root: ROOT, extra: () => ({ hub: uploader ? uploader.status() : null }) })

// sync.json read (again): the uploader follows its server
function configure() {
  const server = serverOf(ROOT)
  if ((uploader ? uploader.server : null) === server) return
  if (uploader) uploader.stop()
  uploader = server ? makeUploader({ root: ROOT, server, onStatus: () => view.broadcast() }) : null
  if (uploader) uploader.start()
  view.broadcast()
}

function quit() {
  try {
    const info = readJson(INFO)
    if (info && info.pid === process.pid) fs.unlinkSync(INFO)
  } catch {}
  process.exit(0)
}

function handler(port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  return async (req, res) => {
    try {
      // only pages this server served may talk to it
      if (!hosts.has(req.headers.host || "")) return send(res, 403, "text/plain", "forbidden")
      const origin = req.headers.origin
      if (origin && !hosts.has(origin.replace(/^https?:\/\//, ""))) return send(res, 403, "text/plain", "forbidden")
      const p = new URL(req.url, "http://x").pathname
      if ((req.method === "GET" || req.method === "HEAD") && p === "/api/ping") return json(res, 200, { rein: true, root: ROOT, v: V })
      if (req.method === "POST" && p === "/api/hub/kick") {
        if (uploader) uploader.kick()
        return json(res, 200, { ok: true, hub: uploader !== null })
      }
      if (req.method === "POST" && p === "/api/quit") {
        res.on("finish", quit)
        return json(res, 200, { ok: true })
      }
      return await view.handle(req, res)
    } catch (e) {
      if (!res.headersSent) send(res, 500, "text/plain", String(e && e.message))
    }
  }
}

// a local call; resolves with the answer's JSON, null on any failure
function call(port, method, p, timeout = 800) {
  return new Promise(resolve => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, timeout }, res => {
      let s = ""
      res.on("data", c => (s += c))
      res.on("end", () => {
        try { resolve(JSON.parse(s)) } catch { resolve(null) }
      })
    })
    req.on("timeout", () => req.destroy())
    req.on("error", () => resolve(null))
    req.end()
  })
}

// the ping of a Rein server for this root on port, else null
async function ping(port, timeout) {
  const j = await call(port, "GET", "/api/ping", timeout)
  return j && j.rein === true && SAME_ROOT(j.root) ? j : null
}

const current = j => typeof j.v === "number" && j.v >= V

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = e => { server.off("listening", onListening); reject(e) }
    const onListening = () => { server.off("error", onError); resolve() }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, "127.0.0.1")
  })
}

async function serve() {
  fs.mkdirSync(path.dirname(INFO), { recursive: true })
  const server = http.createServer()
  let port = null
  for (let i = 0; i < PORT_TRIES && port === null; i++) {
    try {
      await listen(server, BASE_PORT + i)
      port = BASE_PORT + i
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e
      // a Rein server for the same root already answers here: leave it to
      // that one, unless it is older (it was asked to quit)
      const j = await ping(BASE_PORT + i)
      if (j && current(j)) process.exit(0)
    }
  }
  if (port === null) throw new Error(`no free port in ${BASE_PORT}-${BASE_PORT + PORT_TRIES - 1}`)
  server.on("request", handler(port))
  fs.writeFileSync(INFO, JSON.stringify({ port, pid: process.pid }))

  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
  process.on("SIGHUP", quit)

  configure()
  view.watch(name => {
    if (name === "sync.json") configure()
    else if (uploader) uploader.mark(name)
  })

  let busy = Date.now()
  setInterval(() => {
    const unsent = uploader !== null && uploader.unsent() > 0 && Date.now() - uploader.lastChange() < UNSENT_MS
    if (view.clients.size > 0 || view.anyActive() || unsent) busy = Date.now()
    else if (Date.now() - busy >= IDLE_MS) quit()
  }, 60 * 1000).unref()
}

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code))
}

// the running server's port when it speaks the current protocol; an older
// one is asked to quit (null). One that refuses (/api/quit came with
// protocol 2) or still answers a second later is ended by its pid.
async function running() {
  const info = readJson(INFO)
  const j = info && info.port ? await ping(info.port) : null
  if (j && current(j)) return info.port
  if (!j) return null
  const said = await call(info.port, "POST", "/api/quit")
  for (let i = 0; i < 10 && said && said.ok === true && (await ping(info.port, 300)); i++) await new Promise(r => setTimeout(r, 100))
  const still = await ping(info.port, 300)
  if (still && !current(still) && Number.isInteger(info.pid) && info.pid > 0 && info.pid !== process.pid) {
    try { process.kill(info.pid) } catch {}
  }
  return null
}

function start() {
  const child = spawn(process.execPath, [__filename, "serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  })
  child.unref()
}

async function ensure() {
  const url = port => `http://127.0.0.1:${port}/`
  const port = await running()
  if (port) return out({ url: url(port), started: false }, 0)
  start()
  const until = Date.now() + 5000
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 100))
    const now = readJson(INFO)
    const j = now && now.port ? await ping(now.port, 500) : null
    if (j && current(j)) return out({ url: url(now.port), started: true }, 0)
  }
  out({ error: "the frame server did not answer within 5 s" }, 1)
}

// the hook's session start: a running server compares every run with the
// hub now; else one is started, not waited for
async function kick() {
  const port = await running()
  if (!port) {
    start()
    return out({ started: true }, 0)
  }
  await call(port, "POST", "/api/hub/kick")
  out({ started: false }, 0)
}

const cmd = process.argv[2]
if (cmd === "serve") {
  serve().catch(e => {
    console.error(e && e.message)
    process.exit(1)
  })
} else if (cmd === "ensure") {
  ensure().catch(e => out({ error: String(e && e.message) }, 1))
} else if (cmd === "kick") {
  kick().catch(e => out({ error: String(e && e.message) }, 1))
} else {
  console.error("usage: node server.js ensure|serve|kick")
  process.exit(2)
}
