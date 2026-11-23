"use strict"

const test = require("node:test")
const assert = require("node:assert")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFile } = require("child_process")
const { makeHub } = require("../../frame/hub.js")
const { makeClient } = require("../../frame/sync.js")
const { sync, take, resolve } = require("../../frame/catalog.js")
const { makeUploader } = require("../../frame/uploader.js")
const { bodyHash } = require("../../frame/text.js")

const SYNC = path.join(__dirname, "..", "..", "frame", "sync.js")

const tmp = (t, name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const write = (dir, rel, data) => {
  const full = path.join(dir, ...rel.split("/"))
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
}

const read = (dir, rel) => {
  try { return fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8") } catch { return null }
}

const readJsonFile = file => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

// a hub on 127.0.0.1 over a temp root, logging "<method> <decoded path>"
async function hubOn(t) {
  const root = tmp(t, "rein-hub-")
  const hub = makeHub({ root, peerOk: () => true })
  const at = { ip: "127.0.0.1", port: 0 }
  const log = []
  const server = http.createServer(hub.handler(at))
  server.on("request", req => log.push(`${req.method} ${decodeURIComponent(req.url)}`))
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  at.port = server.address().port
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const url = `http://127.0.0.1:${at.port}`
  return {
    root, log, url,
    // a file of domain dom on the hub (rel under the domain), or of its shared rules ("rules:<rel>")
    put: (rel, text) => write(root, rel.startsWith("rules:") ? `rules/${rel.slice(6)}` : `.hub/domains/dom/${rel}`, text),
    get: rel => read(root, rel.startsWith("rules:") ? `rules/${rel.slice(6)}` : `.hub/domains/dom/${rel}`),
    rm: rel => fs.rmSync(path.join(root, ".hub", "domains", "dom", ...rel.split("/"))),
  }
}

// a REIN_HOME whose sync.json names the hub
function homeOf(t, server) {
  const dir = tmp(t, "rein-home-")
  write(dir, "sync.json", JSON.stringify({ server }))
  return dir
}

const RULE = (paths, text) => `---\n${paths}\n---\n${text}`
const HUB_PATHS = 'paths:\n  - "src/**"'
const FITTED = 'paths:\n  - "app/**"'

// node sync.js <args> with REIN_HOME: the exit code, the lines before the
// last, and the last line as JSON
function cli(home, ...args) {
  return new Promise(resolve => {
    execFile(process.execPath, [SYNC, ...args], { env: { ...process.env, REIN_HOME: home } }, (err, stdout) => {
      const lines = stdout.trim().split(/\r?\n/)
      resolve({ code: err ? err.code : 0, said: JSON.parse(lines.pop()), lines })
    })
  })
}

test("the pull table: each side's change goes the other way, both changed is a conflict, a domain the hub lacks is left alone", async t => {
  const h = await hubOn(t)
  const files = {
    "domain.json": '{"name":"Dom"}\n',
    "rules/a.md": RULE(HUB_PATHS, "# A\n"),
    "knowledge/same.md": "same\n",
    "knowledge/hub.md": "hub\n",
    "knowledge/mine.md": "mine\n",
    "knowledge/both.md": "both\n",
    "knowledge/conf.md": "conf\n",
    "knowledge/del.md": "del\n",
    "knowledge/cd.md": "cd\n",
  }
  for (const [rel, text] of Object.entries(files)) h.put(rel, text)
  const home = homeOf(t, h.url)
  const hub = makeClient({ server: h.url, pc: "PC-A", client: "cli" })
  const taken = await take(home, hub, "proj", ["dom"])
  assert.strictEqual(taken.domains[0].taken, true)
  write(home, "proj/rules/other/x.md", "not on the hub\n")
  const K = rel => `proj/knowledge/dom/${rel}`
  const base = () => readJsonFile(path.join(home, ".hub", "base.json"))

  // the local copy fits the rule's globs, and the hub changes its body
  write(home, "proj/rules/dom/a.md", RULE(FITTED, "# A\n"))
  h.put("rules/a.md", RULE(HUB_PATHS, "# A, changed on the hub\n"))
  h.put("knowledge/hub.md", "hub, changed\n")
  write(home, K("mine.md"), "mine, changed\n")
  h.put("knowledge/both.md", "both, changed\n")
  write(home, K("both.md"), "both, changed\n")
  h.put("knowledge/conf.md", "conf, the hub's\n")
  write(home, K("conf.md"), "conf, mine\n")
  h.rm("knowledge/del.md")
  h.rm("knowledge/cd.md")
  write(home, K("cd.md"), "cd, mine\n")
  write(home, K("new.md"), "new here\n")

  h.log.length = 0
  const said = await sync(home, hub)
  // same, changed: downloaded, the rule with its local globs
  assert.strictEqual(read(home, "proj/rules/dom/a.md"), RULE(FITTED, "# A, changed on the hub\n"))
  assert.deepStrictEqual(said.pathsChanged, [{ file: path.join(home, "proj", "rules", "dom", "a.md"), local: FITTED, hub: HUB_PATHS }])
  assert.strictEqual(read(home, K("hub.md")), "hub, changed\n")
  // changed, same: sent with if-match
  assert.strictEqual(h.get("knowledge/mine.md"), "mine, changed\n")
  // changed, changed with equal bodies: the base moves, nothing is sent
  assert.strictEqual(base()["proj/knowledge/dom"]["both.md"], bodyHash("knowledge/both.md", "both, changed\n"))
  assert.ok(!h.log.includes("PUT /api/catalog/dom/knowledge/both.md"))
  // changed, changed: a conflict, neither side written, the hub's copy beside it
  assert.strictEqual(read(home, K("conf.md")), "conf, mine\n")
  assert.strictEqual(h.get("knowledge/conf.md"), "conf, the hub's\n")
  // same, deleted on the hub: deleted here
  assert.strictEqual(read(home, K("del.md")), null)
  // changed, deleted on the hub: a conflict, no hub copy
  assert.strictEqual(read(home, K("cd.md")), "cd, mine\n")
  // a new local file: sent with if-none-match
  assert.strictEqual(h.get("knowledge/new.md"), "new here\n")
  const copy = path.join(home, ".hub", "conflict", "proj", "knowledge", "dom", "conf.md")
  assert.deepStrictEqual(said.conflicts, [
    { kind: "catalog", tree: "proj/knowledge/dom", path: path.join(home, "proj", "knowledge", "dom", "cd.md"), local: bodyHash("knowledge/cd.md", "cd, mine\n"), hub: null, copy: null },
    { kind: "catalog", tree: "proj/knowledge/dom", path: path.join(home, "proj", "knowledge", "dom", "conf.md"), local: bodyHash("knowledge/conf.md", "conf, mine\n"), hub: bodyHash("knowledge/conf.md", "conf, the hub's\n"), copy },
  ])
  assert.strictEqual(fs.readFileSync(copy, "utf8"), "conf, the hub's\n")
  // the domain the hub lacks: untouched, no base
  assert.strictEqual(read(home, "proj/rules/other/x.md"), "not on the hub\n")
  assert.strictEqual(base()["proj/rules/other"], undefined)
  assert.ok(!h.log.some(l => l.includes("/other/")))
  // the outcome is kept for status.json
  const kept = readJsonFile(path.join(home, ".hub", "catalog.json"))
  assert.deepStrictEqual([kept.conflicts.length, kept.pathsChanged.length], [2, 1])

  // agreed: the next sync sends and fetches nothing but the listings
  write(home, K("conf.md"), "conf, the hub's\n")
  fs.rmSync(path.join(home, ...K("cd.md").split("/")))
  h.log.length = 0
  const again = await sync(home, hub)
  assert.deepStrictEqual(h.log, ["GET /api/catalog", "GET /api/rules"])
  assert.deepStrictEqual(again.conflicts, [])
  assert.strictEqual(readJsonFile(path.join(home, ".hub", "catalog.json")).conflicts.length, 0)
})

test("shared rules: the first sync agrees on equal bodies whatever their globs, and hashes with the rules/ prefix", async t => {
  const h = await hubOn(t)
  h.put("rules:same.md", RULE(HUB_PATHS, "# Same\n"))
  h.put("rules:diff.md", "# Diff, the hub's\n")
  h.put("rules:hub.md", "# Hub\n")
  const home = homeOf(t, h.url)
  write(home, "rules/same.md", RULE(FITTED, "# Same\n"))
  write(home, "rules/diff.md", "# Diff, mine\n")
  write(home, "rules/local.md", "# Local\n")

  const pulled = await cli(home, "rules", "pull")
  assert.strictEqual(pulled.code, 0)
  const copy = path.join(home, ".hub", "conflict", "rules", "diff.md")
  assert.deepStrictEqual(pulled.lines, [`conflict\t${path.join(home, "rules", "diff.md")}\t${copy}`])
  assert.deepStrictEqual(pulled.said.sent, [path.join(home, "rules", "local.md")])
  assert.strictEqual(read(home, "rules/hub.md"), "# Hub\n")
  assert.strictEqual(h.get("rules:local.md"), "# Local\n")
  assert.strictEqual(read(home, "rules/same.md"), RULE(FITTED, "# Same\n"))
  assert.deepStrictEqual(readJsonFile(path.join(home, ".hub", "base.json")).rules, {
    "hub.md": bodyHash("rules/hub.md", "# Hub\n"),
    "local.md": bodyHash("rules/local.md", "# Local\n"),
    "same.md": bodyHash("rules/same.md", RULE(HUB_PATHS, "# Same\n")),
  })

  // a body edit goes up; the hub keeps its own globs
  write(home, "rules/same.md", RULE(FITTED, "# Same, edited\n"))
  const pushed = await cli(home, "rules", "push")
  assert.deepStrictEqual(pushed.said.sent, [path.join(home, "rules", "same.md")])
  assert.strictEqual(h.get("rules:same.md"), RULE(HUB_PATHS, "# Same, edited\n"))
})

test("take reports differing and extra files and writes nothing, then --overwrite and --delete-extra", async t => {
  const h = await hubOn(t)
  h.put("domain.json", "{}\n")
  h.put("rules/a.md", RULE(HUB_PATHS, "# A\n"))
  h.put("knowledge/k.md", "k\n")
  h.put("knowledge/new.md", "new\n")
  const home = homeOf(t, h.url)
  write(home, "proj/rules/dom/a.md", RULE(FITTED, "# A, mine\n"))
  write(home, "proj/knowledge/dom/k.md", "k\n")
  write(home, "proj/knowledge/dom/extra.md", "extra\n")
  const P = rel => path.join(home, "proj", ...rel.split("/"))

  const first = await cli(home, "catalog", "take", "proj", "dom")
  assert.strictEqual(first.code, 0)
  assert.deepStrictEqual(first.said, {
    project: "proj",
    domains: [{ domain: "dom", taken: false, written: [], deleted: [], differing: [{ file: P("rules/dom/a.md"), paths: { local: FITTED, hub: HUB_PATHS } }], extra: [P("knowledge/dom/extra.md")] }],
  })
  assert.strictEqual(read(home, "proj/knowledge/dom/new.md"), null)
  assert.strictEqual(readJsonFile(path.join(home, ".hub", "base.json")), null)

  const kept = await cli(home, "catalog", "take", "proj", "dom", "--overwrite")
  assert.deepStrictEqual([kept.said.domains[0].taken, kept.said.domains[0].written.sort(), kept.said.domains[0].deleted], [true, [P("knowledge/dom/new.md"), P("rules/dom/a.md")], []])
  assert.strictEqual(read(home, "proj/rules/dom/a.md"), RULE(HUB_PATHS, "# A\n"))
  assert.strictEqual(read(home, "proj/knowledge/dom/extra.md"), "extra\n")

  const gone = await cli(home, "catalog", "take", "proj", "dom", "--overwrite", "--delete-extra")
  assert.deepStrictEqual([gone.said.domains[0].written, gone.said.domains[0].deleted], [[], [P("knowledge/dom/extra.md")]])
  assert.strictEqual(read(home, "proj/knowledge/dom/extra.md"), null)
  assert.deepStrictEqual(readJsonFile(path.join(home, ".hub", "base.json"))["proj/knowledge/dom"], {
    "k.md": bodyHash("knowledge/k.md", "k\n"),
    "new.md": bodyHash("knowledge/new.md", "new\n"),
  })

  const unknown = await cli(home, "catalog", "take", "proj", "nope")
  assert.deepStrictEqual([unknown.code, unknown.said], [1, { error: "the hub has no domain nope" }])
})

test("a push conflict prints the local file and the hub's copy; resolve keeps mine or takes the hub's", async t => {
  const h = await hubOn(t)
  h.put("knowledge/a.md", "a\n")
  h.put("knowledge/b.md", "b\n")
  h.put("rules/r.md", RULE(HUB_PATHS, "# R\n"))
  const home = homeOf(t, h.url)
  const hub = makeClient({ server: h.url, pc: "PC-A", client: "cli" })
  await take(home, hub, "proj", ["dom"])
  write(home, "proj/rules/dom/r.md", RULE(FITTED, "# R\n"))
  const A = path.join(home, "proj", "knowledge", "dom", "a.md")
  const B = path.join(home, "proj", "knowledge", "dom", "b.md")
  const R = path.join(home, "proj", "rules", "dom", "r.md")
  // another PC's /learn changed the same files
  h.put("knowledge/a.md", "a, theirs\n")
  h.put("knowledge/b.md", "b, theirs\n")
  h.put("rules/r.md", RULE(HUB_PATHS, "# R, theirs\n"))
  fs.writeFileSync(A, "a, mine\n")
  fs.writeFileSync(B, "b, mine\n")
  fs.writeFileSync(R, RULE(FITTED, "# R, mine\n"))

  const pushed = await cli(home, "catalog", "push")
  const copy = rel => path.join(home, ".hub", "conflict", "proj", ...rel.split("/"))
  assert.strictEqual(pushed.code, 0)
  assert.deepStrictEqual(pushed.lines, [
    `conflict\t${R}\t${copy("rules/dom/r.md")}`,
    `conflict\t${A}\t${copy("knowledge/dom/a.md")}`,
    `conflict\t${B}\t${copy("knowledge/dom/b.md")}`,
  ])
  assert.deepStrictEqual([pushed.said.sent, pushed.said.conflicts.length], [[], 3])
  assert.strictEqual(fs.readFileSync(copy("knowledge/dom/a.md"), "utf8"), "a, theirs\n")
  // status shows them as catalog.json keeps them
  const st = await cli(home, "status")
  assert.deepStrictEqual(st.said.conflicts.map(c => [c.kind, c.path]), [["catalog", R], ["catalog", A], ["catalog", B]])

  const mine = await cli(home, "catalog", "resolve", A, "--keep-mine")
  assert.deepStrictEqual(mine.said, { file: A, resolved: "mine" })
  assert.strictEqual(h.get("knowledge/a.md"), "a, mine\n")
  assert.ok(!fs.existsSync(copy("knowledge/dom/a.md")))

  const theirs = await cli(home, "catalog", "resolve", B, "--take-hub")
  assert.deepStrictEqual(theirs.said, { file: B, resolved: "hub" })
  assert.strictEqual(fs.readFileSync(B, "utf8"), "b, theirs\n")
  // a rule taken from the hub keeps its local globs
  await cli(home, "catalog", "resolve", R, "--take-hub")
  assert.strictEqual(fs.readFileSync(R, "utf8"), RULE(FITTED, "# R, theirs\n"))

  assert.deepStrictEqual(readJsonFile(path.join(home, ".hub", "catalog.json")).conflicts, [])
  const base = readJsonFile(path.join(home, ".hub", "base.json"))
  assert.deepStrictEqual([base["proj/knowledge/dom"]["a.md"], base["proj/knowledge/dom"]["b.md"]], [bodyHash("knowledge/a.md", "a, mine\n"), bodyHash("knowledge/b.md", "b, theirs\n")])
  h.log.length = 0
  assert.deepStrictEqual((await cli(home, "refresh")).lines, [])
  assert.ok(!h.log.some(l => l.startsWith("PUT ")))
})

test("checkout, list, and an offline push that counts the edits still to send", async t => {
  const h = await hubOn(t)
  h.put("domain.json", '{"name":"Dom","description":"the dom domain"}\n')
  h.put("knowledge/k.md", "k\n")
  const home = homeOf(t, h.url)
  const out = await cli(home, "catalog", "checkout", "dom")
  const dir = path.join(home, ".hub", "catalog", "dom")
  assert.deepStrictEqual(out.said, { dir, updated: [path.join(dir, "domain.json"), path.join(dir, "knowledge", "k.md")], conflicts: [] })
  const listed = await cli(home, "catalog", "list")
  assert.deepStrictEqual(listed.said, { domains: [{ id: "dom", name: "Dom", description: "the dom domain", files: 2, taken: [], checkout: true }] })

  fs.writeFileSync(path.join(dir, "knowledge", "k.md"), "k, edited offline\n")
  write(home, "sync.json", JSON.stringify({ server: "http://127.0.0.1:9" }))
  const off = await cli(home, "catalog", "push")
  assert.strictEqual(off.code, 0)
  assert.deepStrictEqual([off.said.offline, off.said.unsent], [true, 1])
})

test("the local server syncs the catalog at start and on kick, not on a plain reconcile, and status.json shows it", async t => {
  const h = await hubOn(t)
  h.put("knowledge/k.md", "k\n")
  const home = homeOf(t, h.url)
  await take(home, makeClient({ server: h.url, pc: "PC-A", client: "cli" }), "proj", ["dom"])
  const up = makeUploader({ root: home, server: h.url, pc: "PC-A", times: { statusMs: 0 } })
  t.after(() => up.stop())
  h.put("knowledge/k.md", "k, changed\n")
  up.start()
  await up.reconcile()
  assert.strictEqual(read(home, "proj/knowledge/dom/k.md"), "k, changed\n")
  const statusOf = () => readJsonFile(path.join(home, ".hub", "status.json")) || {}
  for (let i = 0; i < 100 && !statusOf().catalog; i++) await new Promise(r => setTimeout(r, 20))
  assert.deepStrictEqual(statusOf().catalog.updated, [path.join(home, "proj", "knowledge", "dom", "k.md")])

  h.log.length = 0
  await up.reconcile()
  assert.ok(!h.log.includes("GET /api/catalog"))
  await up.kick()
  assert.ok(h.log.includes("GET /api/catalog"))
})

test("screen documents: requirements/ of each domain a project took goes both ways, and take leaves them out", async t => {
  const h = await hubOn(t)
  h.put("domain.json", '{"name":"Dom"}\n')
  h.put("knowledge/k.md", "k\n")
  h.put("requirements/order0101.md", "| 요소 | 요구사항 |\n")
  const home = homeOf(t, h.url)
  const hub = makeClient({ server: h.url, pc: "PC-A", client: "cli" })
  await take(home, hub, "proj", ["dom"])
  // take brings the knowledge only; the next sync brings the screen documents
  assert.strictEqual(read(home, "proj/knowledge/dom/k.md"), "k\n")
  assert.strictEqual(read(home, "proj/requirements/dom/order0101.md"), null)
  await sync(home, hub)
  assert.strictEqual(read(home, "proj/requirements/dom/order0101.md"), "| 요소 | 요구사항 |\n")
  // one land wrote here is sent
  write(home, "proj/requirements/dom/member0101.md", "| - | 조회는 회원팀만 |\n")
  // a project with no domain keeps its documents here only
  write(home, "solo/requirements/order0101.md", "here only\n")
  await sync(home, hub)
  assert.strictEqual(h.get("requirements/member0101.md"), "| - | 조회는 회원팀만 |\n")
  assert.ok(!h.log.some(l => l.includes("here only") || l.includes("solo")))
})
