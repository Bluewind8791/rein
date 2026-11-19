"use strict"

const test = require("node:test")
const assert = require("node:assert")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFile } = require("child_process")
const { makeHub } = require("../../frame/hub.js")
const { OfflineError, makeClient, runPath, serverOf, localFiles, digestOf, localRuns } = require("../../frame/sync.js")

const SYNC = path.join(__dirname, "..", "..", "frame", "sync.js")

const tmp = (t, name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// a hub on 127.0.0.1 over a temp root; after(req) runs once the hub has
// answered a request, so a test can change the hub's files between calls
async function hubOn(t, after = () => {}) {
  const root = tmp(t, "rein-hub-")
  const hub = makeHub({ root, peerOk: () => true })
  const at = { ip: "127.0.0.1", port: 0 }
  const handle = hub.handler(at)
  const server = http.createServer((req, res) => {
    res.on("finish", () => after(req))
    handle(req, res)
  })
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  at.port = server.address().port
  t.after(() => server.close())
  return { root, server: `http://127.0.0.1:${at.port}` }
}

const FILES = {
  "1-spec.md": "# Spec\n",
  "agent/record.json": '{"v":1}\n',
  "agent/evidence/x/1/a.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
}

// a run on the hub with FILES, sent through the client as PC-B
async function seed(server) {
  const hub = makeClient({ server, pc: "PC-B" })
  assert.strictEqual((await hub.json("POST", runPath("proj", "login-fix", "create"), { state: "active", uid: "u1" })).status, 201)
  for (const [rel, data] of Object.entries(FILES)) {
    const put = await hub.upload(runPath("proj", "login-fix", "files", ...rel.split("/")), Buffer.from(data))
    assert.strictEqual(put.status, 200)
  }
  return hub
}

// node sync.js pull-run, as the hook runs it: exit code and the last stdout line
function pullRun(server, home) {
  const dest = path.join(home, "proj", "active", "login-fix")
  return new Promise(resolve => {
    execFile(process.execPath, [SYNC, "pull-run", "--server", server, "--pc", "PC-A", "proj", "login-fix", dest], (err, stdout) => {
      resolve({ code: err ? err.code : 0, said: JSON.parse(stdout.trim().split(/\r?\n/).pop()), dest, incoming: path.join(home, "proj", ".incoming-login-fix") })
    })
  })
}

test("pull-run downloads every file of the run and renames the folder into place", async t => {
  const h = await hubOn(t)
  const hub = await seed(h.server)
  const r = await pullRun(h.server, tmp(t, "rein-home-"))
  assert.deepStrictEqual([r.code, r.said], [0, { ok: true, files: 3 }])
  for (const [rel, data] of Object.entries(FILES)) assert.deepStrictEqual(fs.readFileSync(path.join(r.dest, ...rel.split("/"))), Buffer.from(data))
  assert.ok(!fs.existsSync(r.incoming))
  // the local digest is the one the hub lists the run with
  const listed = (await hub.json("GET", "/api/hub/runs?project=proj")).json.runs[0]
  assert.strictEqual(digestOf(localFiles(r.dest)), listed.digest)
})

test("pull-run fails and leaves nothing when a file changes or goes on the hub meanwhile", async t => {
  const cases = [
    [full => fs.writeFileSync(full, "a longer, different picture"), /a\.png changed on the hub/],
    [full => fs.rmSync(full), /answered 404 for agent\/evidence\/x\/1\/a\.png/],
  ]
  for (const [change, why] of cases) {
    let root
    const h = await hubOn(t, req => {
      if (req.url.endsWith("/manifest")) change(path.join(root, "proj", "active", "login-fix", "agent", "evidence", "x", "1", "a.png"))
    })
    root = h.root
    await seed(h.server)
    const r = await pullRun(h.server, tmp(t, "rein-home-"))
    assert.strictEqual(r.code, 1)
    assert.match(r.said.error, why)
    assert.ok(!fs.existsSync(r.incoming))
    assert.ok(!fs.existsSync(r.dest))
  }
})

test("pull-run says why when the hub does not answer", async t => {
  const closed = http.createServer()
  await new Promise(r => closed.listen(0, "127.0.0.1", r))
  const port = closed.address().port
  await new Promise(r => closed.close(r))
  const r = await pullRun(`http://127.0.0.1:${port}`, tmp(t, "rein-home-"))
  assert.strictEqual(r.code, 1)
  assert.match(r.said.error, /ECONNREFUSED/)
  assert.ok(!fs.existsSync(r.incoming))
})

test("a call to a hub that never answers ends after the 3 s header wait", async t => {
  const sockets = new Set()
  const silent = http.createServer(() => {})
  silent.on("connection", s => sockets.add(s))
  await new Promise(r => silent.listen(0, "127.0.0.1", r))
  t.after(() => {
    for (const s of sockets) s.destroy()
    silent.close()
  })
  const hub = makeClient({ server: `http://127.0.0.1:${silent.address().port}`, pc: "PC-A" })
  const start = Date.now()
  await assert.rejects(hub.json("GET", "/api/info"), e => e instanceof OfflineError && /no answer within 3 s/.test(e.message))
  const took = Date.now() - start
  assert.ok(took >= 2900 && took < 4500, `took ${took} ms`)
})

test("local runs: one state per runId, active first; dot folders, frame/ and rules/ are no projects", t => {
  const root = tmp(t, "rein-root-")
  for (const dir of ["proj/drop/a", "proj/active/a", "proj/complete/b", "proj/defer/b", "proj/complete/c", "proj2/drop/d", ".hub/docs/active/x", "frame/active/x", "rules/active/x"]) {
    fs.mkdirSync(path.join(root, ...dir.split("/")), { recursive: true })
  }
  fs.writeFileSync(path.join(root, "proj", "active", "loose.md"), "not a run\n")
  const runs = localRuns(root).map(r => `${r.project}/${r.state}/${r.runId}`).sort()
  assert.deepStrictEqual(runs, ["proj/active/a", "proj/complete/c", "proj/defer/b", "proj2/drop/d"])
  assert.strictEqual(localRuns(root).find(r => r.runId === "a").dir, path.join(root, "proj", "active", "a"))
})

test("local files leave out temp files, Office locks and desktop files; a change moves the hash", t => {
  const dir = tmp(t, "rein-run-")
  for (const rel of ["1-spec.md", "agent/trace.jsonl", "a.md.rein-tmp-1a2b", "~$book.xlsx", ".DS_Store", "brief/Thumbs.db"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), rel)
  }
  const files = localFiles(dir)
  assert.deepStrictEqual(Object.keys(files).sort(), ["1-spec.md", "agent/trace.jsonl"])
  assert.strictEqual(files["1-spec.md"].size, "1-spec.md".length)
  fs.writeFileSync(path.join(dir, "agent", "trace.jsonl"), "agent/trace.jsonl\n{}\n")
  assert.notStrictEqual(localFiles(dir)["agent/trace.jsonl"].hash, files["agent/trace.jsonl"].hash)
})

test("the hub's address comes from sync.json's server only", t => {
  const root = tmp(t, "rein-root-")
  assert.strictEqual(serverOf(root), null)
  fs.writeFileSync(path.join(root, "sync.json"), JSON.stringify({ server: " http://hub-pc:7380/ " }))
  assert.strictEqual(serverOf(root), "http://hub-pc:7380")
  fs.writeFileSync(path.join(root, "sync.json"), JSON.stringify({ remote: "https://github.com/x/runs.git" }))
  assert.strictEqual(serverOf(root), null)
})

// ---------- the uploader ----------

const { makeUploader } = require("../../frame/uploader.js")
const { sha256 } = require("../../frame/text.js")

const SERVER = path.join(__dirname, "..", "..", "frame", "server.js")
// the uploader's timers, short
const FAST = { debounceMs: 20, statusMs: 0, retryMs: 50, retryMaxMs: 200, reconcileMs: 60 * 1000, heartbeatMs: 60 * 1000 }

const until = async (what, ms = 8000) => {
  const end = Date.now() + ms
  for (;;) {
    const got = await what()
    if (got) return got
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`)
    await new Promise(r => setTimeout(r, 20))
  }
}

const write = (dir, rel, data) => {
  const full = path.join(dir, ...rel.split("/"))
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
}

const readJsonFile = file => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

// a hub that logs each request as "<method> <decoded path>", and can go
// down and come back on its port
async function liveHub(t) {
  const root = tmp(t, "rein-hub-")
  const hub = makeHub({ root, peerOk: () => true })
  const at = { ip: "127.0.0.1", port: 0 }
  const log = []
  let server
  const up = async () => {
    server = http.createServer(hub.handler(at))
    server.on("request", req => log.push(`${req.method} ${decodeURIComponent(req.url)}`))
    await new Promise(r => server.listen(at.port, "127.0.0.1", r))
    at.port = server.address().port
  }
  const down = () => new Promise(r => {
    server.closeAllConnections()
    server.close(r)
  })
  await up()
  t.after(() => server.listening && down())
  return {
    root, log, up, down,
    url: () => `http://127.0.0.1:${at.port}`,
    sent: method => log.filter(l => l.startsWith(`${method} `)),
    file: rel => fs.readFileSync(path.join(root, ...rel.split("/")), "utf8"),
    record: (p, id) => readJsonFile(path.join(root, ".hub", "runs", p, `${id}.json`)),
  }
}

const RUN = uid => ({ "1-spec.md": "# Spec\n", "agent/record.json": JSON.stringify({ v: 1, uid }), "agent/evidence/x/1/a.png": "\x89PNG" })

// a REIN_HOME whose sync.json names server, with runs { "<p>/<state>/<id>": { rel: text } }
function homeOf(t, server, runs) {
  const dir = tmp(t, "rein-home-")
  write(dir, "sync.json", JSON.stringify({ server }))
  for (const [run, files] of Object.entries(runs)) for (const [rel, data] of Object.entries(files)) write(dir, `${run}/${rel}`, data)
  return dir
}

function uploaderOf(t, dir, server) {
  const up = makeUploader({ root: dir, server, pc: "PC-A", times: FAST })
  t.after(() => up.stop())
  return up
}

const statusOf = dir => readJsonFile(path.join(dir, ".hub", "status.json"))

test("the first reconcile makes each local run on the hub and sends all its files; the next sends nothing", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1"), "proj/complete/old": { "1-spec.md": "# Old\n" } })
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  const rec = h.record("proj", "login-fix")
  assert.deepStrictEqual([rec.pc, rec.uid, rec.state], ["PC-A", "u1", "active"])
  assert.strictEqual(h.record("proj", "old").state, "complete")
  for (const [rel, data] of Object.entries(RUN("u1"))) assert.strictEqual(h.file(`proj/active/login-fix/${rel}`), data)
  assert.strictEqual(h.file("proj/complete/old/1-spec.md"), "# Old\n")
  assert.strictEqual(h.sent("PUT").length, 4)
  h.log.length = 0
  await up.reconcile()
  assert.deepStrictEqual(h.log, ["GET /api/hub/runs"])
})

test("a change sends one PUT, a deletion one DELETE, a state move one state call", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  const run = path.join(dir, "proj", "active", "login-fix")

  h.log.length = 0
  write(run, "1-spec.md", "# Spec, changed\n")
  up.mark(path.join("proj", "active", "login-fix", "1-spec.md"))
  await until(() => h.file("proj/active/login-fix/1-spec.md") === "# Spec, changed\n")
  assert.deepStrictEqual(h.log, ["PUT /api/runs/proj/login-fix/files/1-spec.md"])

  h.log.length = 0
  fs.rmSync(path.join(run, "agent", "evidence", "x", "1", "a.png"))
  up.mark(path.join("proj", "active", "login-fix", "agent", "evidence", "x", "1", "a.png"))
  await until(() => !fs.existsSync(path.join(h.root, "proj", "active", "login-fix", "agent", "evidence", "x", "1", "a.png")))
  assert.deepStrictEqual(h.log, ["DELETE /api/runs/proj/login-fix/files/agent/evidence/x/1/a.png"])

  h.log.length = 0
  fs.mkdirSync(path.join(dir, "proj", "complete"))
  fs.renameSync(run, path.join(dir, "proj", "complete", "login-fix"))
  up.mark(path.join("proj", "active", "login-fix"))
  up.mark(path.join("proj", "complete", "login-fix"))
  await until(() => h.record("proj", "login-fix").state === "complete")
  assert.deepStrictEqual(h.log, ["POST /api/runs/proj/login-fix/state"])
  assert.strictEqual(h.file("proj/complete/login-fix/1-spec.md"), "# Spec, changed\n")
})

test("a run another PC holds is sent nothing: lost with the same uid, a collision with another or a uid missing", async t => {
  const h = await liveHub(t)
  const b = makeClient({ server: h.url(), pc: "PC-B" })
  for (const [id, uid] of [["login-fix", "u1"], ["other", "u9"], ["legacy", "u3"], ["imported", undefined], ["gone", "u4"]]) {
    assert.strictEqual((await b.json("POST", runPath("proj", id, "create"), { state: "active", uid })).status, 201)
  }
  const dir = homeOf(t, h.url(), {
    "proj/active/login-fix": RUN("u1"),
    "proj/defer/other": RUN("u2"),
    "proj/active/legacy": { "1-spec.md": "# Legacy\n" },
    "proj/active/imported": RUN("u5"),
    "proj/drop/gone": RUN("u4"),
  })
  h.log.length = 0
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  assert.deepStrictEqual(h.log, ["GET /api/hub/runs"])
  const st = await until(() => { const s = statusOf(dir); return s && s.lost.length === 1 && s.collisions.length === 3 && s })
  assert.deepStrictEqual(st.lost.map(l => [l.project, l.runId, l.pc, l.local]), [["proj", "login-fix", "PC-B", "active"]])
  assert.deepStrictEqual(st.collisions.map(c => c.runId).sort(), ["imported", "legacy", "other"])
  assert.ok(st.collisions.every(c => c.project === "proj" && c.pc === "PC-B"))
  assert.strictEqual(st.unsent, 0)
})

test("a new run of this PC under the name of an older one on the hub is a collision: the old run is left as it is", async t => {
  const h = await liveHub(t)
  const a = makeClient({ server: h.url(), pc: "PC-A" })
  assert.strictEqual((await a.json("POST", runPath("proj", "fix-x", "create"), { state: "complete", uid: "old" })).status, 201)
  assert.strictEqual((await a.upload(runPath("proj", "fix-x", "files", "1-spec.md"), Buffer.from("# old spec\n"))).status, 200)
  assert.strictEqual((await a.upload(runPath("proj", "fix-x", "files", "retro.md"), Buffer.from("old retro\n"), { "if-none-match": "*" })).status, 200)
  // the old run is gone from this PC; a new one of the same name was made offline
  const dir = homeOf(t, h.url(), { "proj/active/fix-x": { "1-spec.md": "# NEW spec\n", "agent/record.json": JSON.stringify({ uid: "new" }) } })
  h.log.length = 0
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  assert.deepStrictEqual(h.log, ["GET /api/hub/runs"])
  const st = await until(() => { const s = statusOf(dir); return s && s.collisions.length === 1 && s })
  assert.deepStrictEqual(st.collisions, [{ project: "proj", runId: "fix-x", pc: "PC-A" }])
  assert.deepStrictEqual([st.lost, st.unsent], [[], 0])
  assert.deepStrictEqual([h.record("proj", "fix-x").state, h.record("proj", "fix-x").uid], ["complete", "old"])
  assert.strictEqual(h.file("proj/complete/fix-x/1-spec.md"), "# old spec\n")
  assert.strictEqual(h.file("proj/complete/fix-x/retro.md"), "old retro\n")
})

test("a change after another PC took the run over shows it lost at once, with nothing unsent", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  const b = makeClient({ server: h.url(), pc: "PC-B" })
  assert.strictEqual((await b.json("POST", runPath("proj", "login-fix", "claim"), { gen: h.record("proj", "login-fix").gen })).status, 200)
  h.log.length = 0
  write(dir, "proj/active/login-fix/1-spec.md", "# Spec, changed\n")
  write(dir, "proj/active/login-fix/2-plan.md", "# Plan\n")
  up.mark(path.join("proj", "active", "login-fix", "2-plan.md"))
  const st = await until(() => { const s = statusOf(dir); return s && s.lost.length === 1 && s })
  assert.deepStrictEqual(st.lost.map(l => [l.runId, l.pc, l.local]), [["login-fix", "PC-B", "active"]])
  assert.deepStrictEqual([st.unsent, st.unsentRuns, st.error], [0, 0, null])
  assert.ok(h.sent("PUT").length <= 2)
  assert.strictEqual(h.file("proj/active/login-fix/1-spec.md"), "# Spec\n")
  // the next change sends nothing
  h.log.length = 0
  write(dir, "proj/active/login-fix/3-more.md", "x")
  up.mark(path.join("proj", "active", "login-fix", "3-more.md"))
  await until(() => h.log.length > 0)
  await new Promise(r => setTimeout(r, 100))
  assert.deepStrictEqual(h.log, ["GET /api/runs/proj/login-fix"])
})

test("offline: the unsent files are counted, and sent once the hub is back", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const up = uploaderOf(t, dir, h.url())
  up.start()
  await up.reconcile()
  await h.down()
  write(dir, "proj/active/login-fix/1-spec.md", "# Spec, offline\n")
  write(dir, "proj/active/login-fix/2-plan.md", "# Plan\n")
  up.mark(path.join("proj", "active", "login-fix", "2-plan.md"))
  const st = await until(() => { const s = statusOf(dir); return s && s.reachable === false && s.unsent === 2 && s })
  assert.strictEqual(st.unsentRuns, 1)
  assert.ok(st.error)
  assert.ok(Date.parse(st.lastOkAt) <= Date.parse(st.checkedAt))
  await h.up()
  await until(() => { const s = statusOf(dir); return s && s.reachable === true && s.unsent === 0 })
  assert.strictEqual(h.file("proj/active/login-fix/1-spec.md"), "# Spec, offline\n")
  assert.strictEqual(h.file("proj/active/login-fix/2-plan.md"), "# Plan\n")
})

test("offline from the start, a run unchanged since the hub last confirmed it counts nothing", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const first = makeUploader({ root: dir, server: h.url(), pc: "PC-A", times: FAST })
  await first.reconcile()
  first.stop()
  const run = path.join(dir, "proj", "active", "login-fix")
  assert.deepStrictEqual(readJsonFile(path.join(dir, ".hub", "seen.json")), { "proj/login-fix": { state: "active", digest: digestOf(localFiles(run)) } })
  await h.down()
  // a new server process: nothing seen in memory
  write(dir, "proj/active/new-run/1-spec.md", "# New\n")
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  assert.strictEqual(up.unsent(), 1)
  write(run, "1-spec.md", "# Spec, offline\n")
  await up.reconcile()
  assert.strictEqual(up.unsent(), 1 + Object.keys(RUN("u1")).length)
})

test("a closed run's retro goes by its base: first upload, the hub's change, this PC's change, a 상태-only merge, a conflict", async t => {
  const h = await liveHub(t)
  const RETRO = "# Retro\n\n## A\n상태: 후보\n\n## B\n상태: 후보\n\n## C\n상태: 후보\n"
  const dir = homeOf(t, h.url(), { "proj/complete/r1": { "1-spec.md": "# R1\n", "retro.md": RETRO } })
  const local = path.join(dir, "proj", "complete", "r1", "retro.md")
  const base = () => (readJsonFile(path.join(dir, ".hub", "base.json")) || {})["retro:proj/r1"]
  const b = makeClient({ server: h.url(), pc: "PC-B" })
  const learn = async text => {
    const r = await b.upload(runPath("proj", "r1", "files", "retro.md"), Buffer.from(text), { "if-match": sha256(h.file("proj/complete/r1/retro.md")) })
    assert.strictEqual(r.status, 200)
  }
  const up = uploaderOf(t, dir, h.url())

  // no base yet: this PC's copy goes up
  await up.reconcile()
  assert.strictEqual(h.file("proj/complete/r1/retro.md"), RETRO)
  assert.deepStrictEqual(base(), { "retro.md": sha256(RETRO) })

  // another PC's /learn changed the hub's copy: it comes down
  const theirs = RETRO.replace("## A\n상태: 후보", "## A\n상태: 적용됨 abc")
  await learn(theirs)
  await up.reconcile()
  assert.strictEqual(fs.readFileSync(local, "utf8"), theirs)
  assert.deepStrictEqual(base(), { "retro.md": sha256(theirs) })

  // this PC changed it: it goes up against the hub's hash
  const mine = theirs.replace("## B\n상태: 후보", "## B\n상태: 채택")
  fs.writeFileSync(local, mine)
  await up.reconcile()
  assert.strictEqual(h.file("proj/complete/r1/retro.md"), mine)
  assert.deepStrictEqual(base(), { "retro.md": sha256(mine) })

  // both changed 상태 lines only: closed beats open, 채택 beats 후보
  fs.writeFileSync(local, mine.replace("## B\n상태: 채택", "## B\n상태: 기각"))
  await learn(mine.replace("## C\n상태: 후보", "## C\n상태: 채택"))
  await up.reconcile()
  const merged = mine.replace("## B\n상태: 채택", "## B\n상태: 기각").replace("## C\n상태: 후보", "## C\n상태: 채택")
  assert.strictEqual(fs.readFileSync(local, "utf8"), merged)
  assert.strictEqual(h.file("proj/complete/r1/retro.md"), merged)
  assert.deepStrictEqual(base(), { "retro.md": sha256(merged) })

  // both changed other text: a conflict, and neither copy is written
  const here = merged + "\n메모\n"
  const there = merged.replace("# Retro", "# Retro of r1")
  fs.writeFileSync(local, here)
  await learn(there)
  await up.reconcile()
  assert.strictEqual(fs.readFileSync(local, "utf8"), here)
  assert.strictEqual(h.file("proj/complete/r1/retro.md"), there)
  assert.deepStrictEqual(base(), { "retro.md": sha256(merged) })
  const st = await until(() => { const s = statusOf(dir); return s && s.conflicts.length === 1 && s })
  assert.deepStrictEqual(st.conflicts, [{ kind: "retro", project: "proj", runId: "r1", local: sha256(here), hub: sha256(there) }])
})

test("offline after a restart, a run another PC holds counts nothing", async t => {
  const h = await liveHub(t)
  const b = makeClient({ server: h.url(), pc: "PC-B" })
  for (const [id, uid] of [["login-fix", "u1"], ["other", "u9"]]) {
    assert.strictEqual((await b.json("POST", runPath("proj", id, "create"), { state: "active", uid })).status, 201)
  }
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1"), "proj/active/other": RUN("u2") })
  const first = makeUploader({ root: dir, server: h.url(), pc: "PC-A", times: FAST })
  await first.reconcile()
  first.stop()
  assert.deepStrictEqual(readJsonFile(path.join(dir, ".hub", "seen.json")), { "proj/login-fix": { elsewhere: "PC-B" }, "proj/other": { elsewhere: "PC-B" } })
  await h.down()
  write(dir, "proj/active/login-fix/1-spec.md", "# Spec, offline\n")
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  assert.strictEqual(up.status().reachable, false)
  assert.strictEqual(up.unsent(), 0)
})

test("a closed run's retro sent against a hub copy that changed meanwhile merges at once", async t => {
  const h = await liveHub(t)
  const RETRO = "# Retro\n\n## A\n상태: 후보\n\n## B\n상태: 후보\n"
  const dir = homeOf(t, h.url(), { "proj/complete/r1": { "1-spec.md": "# R1\n", "retro.md": RETRO } })
  const local = path.join(dir, "proj", "complete", "r1", "retro.md")
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  // another PC's /learn, then this PC's, before any reconcile
  const b = makeClient({ server: h.url(), pc: "PC-B" })
  const theirs = RETRO.replace("## A\n상태: 후보", "## A\n상태: 채택")
  assert.strictEqual((await b.upload(runPath("proj", "r1", "files", "retro.md"), Buffer.from(theirs), { "if-match": sha256(RETRO) })).status, 200)
  fs.writeFileSync(local, RETRO.replace("## B\n상태: 후보", "## B\n상태: 기각"))
  up.mark(path.join("proj", "complete", "r1", "retro.md"))
  const merged = theirs.replace("## B\n상태: 후보", "## B\n상태: 기각")
  await until(() => h.file("proj/complete/r1/retro.md") === merged)
  assert.strictEqual(fs.readFileSync(local, "utf8"), merged)
  const st = await until(() => { const s = statusOf(dir); return s && s.unsent === 0 && s })
  assert.deepStrictEqual([st.conflicts, st.error], [[], null])

  // other text on both sides: a conflict at once, neither copy written
  const there = merged.replace("# Retro", "# Retro of r1")
  assert.strictEqual((await b.upload(runPath("proj", "r1", "files", "retro.md"), Buffer.from(there), { "if-match": sha256(merged) })).status, 200)
  const here = merged + "\n메모\n"
  fs.writeFileSync(local, here)
  up.mark(path.join("proj", "complete", "r1", "retro.md"))
  const c = await until(() => { const s = statusOf(dir); return s && s.conflicts.length === 1 && s })
  assert.deepStrictEqual(c.conflicts, [{ kind: "retro", project: "proj", runId: "r1", local: sha256(here), hub: sha256(there) }])
  assert.strictEqual(h.file("proj/complete/r1/retro.md"), there)
  assert.strictEqual(fs.readFileSync(local, "utf8"), here)
})

test("a closed run's retro with no base yet does not overwrite a different hub copy: 상태 lines merge, other text conflicts", async t => {
  const h = await liveHub(t)
  const ORIG = "# 회고\n\n## 1\n상태: 후보\n\n## 2\n상태: 후보\n"
  // as the importer leaves a run this PC held, and another PC's /learn changed it since
  const seedRun = (id, hubText) => {
    write(h.root, `.hub/runs/proj/${id}.json`, JSON.stringify({ v: 1, project: "proj", runId: id, pc: "PC-A", state: "complete", gen: 1, by: "import" }))
    write(h.root, `proj/complete/${id}/retro.md`, hubText)
  }
  const learned = ORIG.replace("상태: 후보", "상태: 반영")
  seedRun("merge", learned)
  const other = ORIG.replace("# 회고", "# 회고 (B)")
  seedRun("clash", other)
  const mine = ORIG + "\n메모\n"
  const dir = homeOf(t, h.url(), { "proj/complete/merge": { "retro.md": ORIG }, "proj/complete/clash": { "retro.md": mine } })
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  assert.strictEqual(h.file("proj/complete/merge/retro.md"), learned)
  assert.strictEqual(fs.readFileSync(path.join(dir, "proj", "complete", "merge", "retro.md"), "utf8"), learned)
  assert.strictEqual(h.file("proj/complete/clash/retro.md"), other)
  assert.strictEqual(fs.readFileSync(path.join(dir, "proj", "complete", "clash", "retro.md"), "utf8"), mine)
  const st = await until(() => { const s = statusOf(dir); return s && s.conflicts.length === 1 && s })
  assert.deepStrictEqual(st.conflicts, [{ kind: "retro", project: "proj", runId: "clash", local: sha256(mine), hub: sha256(other) }])
})

test("status.json holds exactly the fields the hook and the frame read", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const up = uploaderOf(t, dir, h.url())
  await up.reconcile()
  const st = await until(() => { const s = statusOf(dir); return s && s.unsent === 0 && s.sending === null && s })
  assert.deepStrictEqual(Object.keys(st).sort(), ["at", "catalog", "checkedAt", "collisions", "conflicts", "error", "lastOkAt", "lost", "pc", "pid", "reachable", "sending", "server", "unsent", "unsentRuns", "v"])
  const { at, checkedAt, lastOkAt, ...rest } = st
  assert.deepStrictEqual(rest, { v: 1, pid: process.pid, pc: "PC-A", server: h.url(), reachable: true, error: null, unsent: 0, unsentRuns: 0, sending: null, lost: [], collisions: [], conflicts: [], catalog: null })
  for (const when of [at, checkedAt, lastOkAt]) assert.ok(Date.now() - Date.parse(when) < 10 * 1000, when)
  assert.deepStrictEqual(up.status(), st)
})

// a GET of a local server, as JSON
const getJson = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path: p }, res => {
    let s = ""
    res.on("data", c => (s += c))
    res.on("end", () => resolve(JSON.parse(s)))
  }).on("error", reject)
})

// a server from before the protocol version for root, in its own process: its
// ping has no v and it answers POST /api/quit 405, as frame servers before
// protocol 2 do; ping adds to its ping answer. It writes server.json; resolves
// with its { child, port, asked() }.
async function oldServer(t, root, ping = {}) {
  const src = `
    const http = require("http"), fs = require("fs"), path = require("path")
    const root = ${JSON.stringify(root)}
    const s = http.createServer((q, r) => {
      if (q.method === "POST") { console.log("asked"); r.writeHead(405, { "content-type": "text/plain" }); return r.end("method not allowed") }
      r.setHeader("content-type", "application/json")
      r.end(q.url === "/api/ping" ? JSON.stringify({ rein: true, root, ...${JSON.stringify(ping)} }) : "{}")
    })
    s.listen(0, "127.0.0.1", () => {
      fs.writeFileSync(path.join(root, "frame", "server.json"), JSON.stringify({ port: s.address().port, pid: process.pid }))
      console.log("port " + s.address().port)
    })`
  fs.mkdirSync(path.join(root, "frame"), { recursive: true })
  const child = require("child_process").spawn(process.execPath, ["-e", src], { stdio: ["ignore", "pipe", "inherit"] })
  let out = ""
  child.stdout.on("data", c => (out += c))
  const exited = new Promise(r => child.on("exit", r))
  t.after(() => child.kill())
  const port = Number((await until(() => /port (\d+)/.exec(out)))[1])
  return { port, exited, asked: () => out.includes("asked") }
}

test("kick ends an older server that refuses to quit and starts one; kicking a running one makes it compare every run", async t => {
  const h = await liveHub(t)
  const dir = homeOf(t, h.url(), { "proj/active/login-fix": RUN("u1") })
  const old = await oldServer(t, dir)
  const kick = () => new Promise(resolve => {
    execFile(process.execPath, [SERVER, "kick"], { env: { ...process.env, REIN_HOME: dir } }, (err, stdout) => resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop())))
  })
  const info = () => readJsonFile(path.join(dir, "frame", "server.json"))
  const listings = () => h.log.filter(l => l === "GET /api/hub/runs").length
  const oldPid = info().pid
  try {
    assert.deepStrictEqual(await kick(), { started: true })
    assert.ok(old.asked())
    await old.exited
    const { port } = await until(() => { const i = info(); return i && i.pid !== oldPid && i })
    assert.strictEqual((await getJson(port, "/api/ping")).v, 2)
    await until(() => fs.existsSync(path.join(h.root, "proj", "active", "login-fix", "1-spec.md")))
    const runs = await until(async () => { const r = await getJson(port, "/api/runs"); return r.hub && r.hub.reachable === true && r })
    assert.strictEqual(runs.hub.server, h.url())
    const before = listings()
    assert.deepStrictEqual(await kick(), { started: false })
    await until(() => listings() > before)
  } finally {
    const i = info()
    if (i && i.pid !== oldPid) {
      try { process.kill(i.pid) } catch {}
      await until(() => getJson(i.port, "/api/ping").then(() => false, () => true))
    }
  }
})

test("kick ends a server of an older plugin version on the same protocol and starts one of this version", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rein-frame-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const old = await oldServer(t, dir, { v: 2, version: "0.0.1" })
  const kick = () => new Promise(resolve => {
    execFile(process.execPath, [SERVER, "kick"], { env: { ...process.env, REIN_HOME: dir } }, (err, stdout) => resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop())))
  })
  const info = () => readJsonFile(path.join(dir, "frame", "server.json"))
  const oldPid = info().pid
  const mine = readJsonFile(path.join(__dirname, "..", "..", ".claude-plugin", "plugin.json")).version
  try {
    assert.deepStrictEqual(await kick(), { started: true })
    assert.ok(old.asked())
    await old.exited
    const { port } = await until(() => { const i = info(); return i && i.pid !== oldPid && i })
    assert.strictEqual((await getJson(port, "/api/ping")).version, mine)
    assert.deepStrictEqual(await kick(), { started: false })
  } finally {
    const i = info()
    if (i && i.pid !== oldPid) {
      try { process.kill(i.pid) } catch {}
      await until(() => getJson(i.port, "/api/ping").then(() => false, () => true))
    }
  }
})

// a Rein server for root in its own process, on the first free one of the
// frame's ports. It quits when asked, or with mute takes connections and
// never answers. It writes server.json only with named; resolves with its
// { port, pid, exited }.
async function frameLike(t, root, { named = false, mute = false } = {}) {
  const src = `
    const http = require("http"), fs = require("fs"), path = require("path")
    const root = ${JSON.stringify(root)}
    const s = http.createServer((q, r) => {
      if (${mute}) return
      r.setHeader("content-type", "application/json")
      if (q.method === "POST") { r.end('{"ok":true}'); return setTimeout(() => process.exit(0), 20) }
      r.end(q.url === "/api/ping" ? JSON.stringify({ rein: true, root, v: 2 }) : "{}")
    })
    s.on("listening", () => {
      const port = s.address().port
      if (${named}) fs.writeFileSync(path.join(root, "frame", "server.json"), JSON.stringify({ port, pid: process.pid }))
      console.log("port " + port)
    })
    const at = p => s.once("error", () => at(p + 1)).listen(p, "127.0.0.1")
    at(7357)`
  fs.mkdirSync(path.join(root, "frame"), { recursive: true })
  const child = require("child_process").spawn(process.execPath, ["-e", src], { stdio: ["ignore", "pipe", "inherit"] })
  let out = ""
  child.stdout.on("data", c => (out += c))
  const exited = new Promise(r => child.on("exit", r))
  t.after(() => child.kill())
  const port = Number((await until(() => /port (\d+)/.exec(out)))[1])
  return { port, pid: child.pid, exited }
}

const kickIn = dir => new Promise(resolve => {
  execFile(process.execPath, [SERVER, "kick"], { env: { ...process.env, REIN_HOME: dir } }, (err, stdout) => resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop())))
})

test("kick asks a server server.json no longer names to quit", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rein-frame-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const orphan = await frameLike(t, dir)
  const info = () => readJsonFile(path.join(dir, "frame", "server.json"))
  try {
    assert.deepStrictEqual(await kickIn(dir), { started: true })
    await orphan.exited
  } finally {
    const i = await until(info)
    try { process.kill(i.pid) } catch {}
    await until(() => getJson(i.port, "/api/ping").then(() => false, () => true))
  }
})

test("kick leaves the server server.json names alone while it is too busy to answer, and starts none beside it", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rein-frame-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const busy = await frameLike(t, dir, { named: true, mute: true })
  const before = readJsonFile(path.join(dir, "frame", "server.json"))
  assert.deepStrictEqual(await kickIn(dir), { started: false })
  assert.deepStrictEqual(readJsonFile(path.join(dir, "frame", "server.json")), before)
  assert.strictEqual(before.port, busy.port)
})
