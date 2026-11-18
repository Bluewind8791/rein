"use strict"

const test = require("node:test")
const assert = require("node:assert")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { makeHub, serve, tailnet } = require("../../frame/hub.js")
const { sha256, bodyHash, treeDigest } = require("../../frame/text.js")

// a hub on 127.0.0.1 over a temp root; peerOk stands in for the tailnet
// check, which null keeps
async function hubOn(t, peerOk = () => true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rein-hub-"))
  const hub = makeHub(peerOk ? { root, peerOk } : { root })
  const at = { ip: "127.0.0.1", port: 0 }
  const server = http.createServer(hub.handler(at))
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  at.port = server.address().port
  t.after(() => {
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const call = (method, p, { pc = "PC-A", body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
      const req = http.request({ host: "127.0.0.1", port: at.port, method, path: p, headers: { host: `127.0.0.1:${at.port}`, ...(pc ? { "x-rein-pc": pc } : {}), ...headers } }, res => {
        const chunks = []
        res.on("data", c => chunks.push(c))
        res.on("end", () => {
          const buf = Buffer.concat(chunks)
          let j = null
          try { j = JSON.parse(String(buf)) } catch {}
          resolve({ status: res.statusCode, headers: res.headers, buf, json: j })
        })
      })
      req.on("error", reject)
      req.end(data)
    })
  const put = (p, text, opts = {}) => call("PUT", p, { ...opts, body: Buffer.from(text), headers: { "x-rein-hash": sha256(text), ...(opts.headers || {}) } })
  const recordFile = (project, runId) => path.join(root, ".hub", "runs", project, `${runId}.json`)
  return { root, at, call, put, recordFile }
}

const R = "/api/runs/proj/login-fix"

test("create once, then claim is a compare-and-swap on gen", async t => {
  const h = await hubOn(t)
  const made = await h.call("POST", `${R}/create`, { body: { state: "defer", uid: "u1" } })
  assert.strictEqual(made.status, 201)
  assert.deepStrictEqual([made.json.record.pc, made.json.record.gen, made.json.record.state, made.json.record.uid], ["PC-A", 1, "defer", "u1"])
  assert.ok(fs.statSync(path.join(h.root, "proj", "defer", "login-fix")).isDirectory())
  const again = await h.call("POST", `${R}/create`, { pc: "PC-B", body: { state: "active" } })
  assert.strictEqual(again.status, 409)
  assert.strictEqual(again.json.error, "exists")
  assert.strictEqual(again.json.record.pc, "PC-A")

  await h.put(`${R}/files/1-spec.md`, "# Spec\n")
  const stale = await h.call("POST", `${R}/claim`, { pc: "PC-B", body: { gen: 0 } })
  assert.strictEqual(stale.status, 409)
  assert.strictEqual(stale.json.error, "changed")
  const won = await h.call("POST", `${R}/claim`, { pc: "PC-B", body: { gen: 1 } })
  assert.strictEqual(won.status, 200)
  assert.deepStrictEqual([won.json.record.pc, won.json.record.state, won.json.record.gen, won.json.record.uid, won.json.record.by], ["PC-B", "active", 2, "u1", "claim"])
  assert.strictEqual(fs.readFileSync(path.join(h.root, "proj", "active", "login-fix", "1-spec.md"), "utf8"), "# Spec\n")
  assert.ok(!fs.existsSync(path.join(h.root, "proj", "defer", "login-fix")))
  // a second claim with the gen it saw before loses
  assert.strictEqual((await h.call("POST", `${R}/claim`, { pc: "PC-C", body: { gen: 1 } })).status, 409)

  await h.call("POST", `${R}/state`, { pc: "PC-B", body: { state: "complete" } })
  const closed = await h.call("POST", `${R}/claim`, { pc: "PC-C", body: { gen: 3 } })
  assert.strictEqual(closed.status, 422)
  assert.strictEqual(closed.json.error, "closed")
  assert.strictEqual((await h.call("POST", "/api/runs/nope/x/claim", { body: { gen: 1 } })).status, 404)
})

test("only the holder writes a run", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  assert.strictEqual((await h.put(`${R}/files/a.md`, "a")).status, 200)
  for (const res of [
    await h.put(`${R}/files/a.md`, "b", { pc: "PC-B" }),
    await h.call("DELETE", `${R}/files/a.md`, { pc: "PC-B" }),
    await h.call("POST", `${R}/state`, { pc: "PC-B", body: { state: "defer" } }),
  ]) {
    assert.strictEqual(res.status, 409)
    assert.strictEqual(res.json.error, "not-holder")
    assert.strictEqual(res.json.holder, "PC-A")
    assert.strictEqual(res.json.record.pc, "PC-A")
  }
  assert.strictEqual(fs.readFileSync(path.join(h.root, "proj", "active", "login-fix", "a.md"), "utf8"), "a")
  // no PC, no write
  assert.strictEqual((await h.put(`${R}/files/a.md`, "c", { pc: "" })).status, 400)
  // no record, no write
  assert.strictEqual((await h.put("/api/runs/proj/other/files/a.md", "c")).status, 404)
})

test("PUT checks the body hash and the preconditions, GET and DELETE follow", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  const bad = await h.call("PUT", `${R}/files/a.md`, { body: Buffer.from("x"), headers: { "x-rein-hash": sha256("y") } })
  assert.strictEqual(bad.status, 400)
  const ok = await h.put(`${R}/files/agent/evidence/1/a.png`, "png")
  assert.deepStrictEqual(ok.json, { size: 3, hash: sha256("png") })
  const got = await h.call("GET", `${R}/files/agent/evidence/1/a.png`)
  assert.strictEqual(String(got.buf), "png")
  assert.strictEqual(got.headers["x-rein-hash"], sha256("png"))
  const miss = await h.put(`${R}/files/agent/evidence/1/a.png`, "png2", { headers: { "if-match": sha256("old") } })
  assert.deepStrictEqual([miss.status, miss.json], [412, { error: "changed", hash: sha256("png") }])
  assert.strictEqual((await h.put(`${R}/files/agent/evidence/1/a.png`, "png2", { headers: { "if-none-match": "*" } })).status, 412)
  assert.strictEqual((await h.put(`${R}/files/agent/evidence/1/a.png`, "png2", { headers: { "if-match": sha256("png") } })).status, 200)
  const man = await h.call("GET", `${R}/manifest`)
  assert.deepStrictEqual(man.json.files, { "agent/evidence/1/a.png": { size: 4, hash: sha256("png2") } })
  assert.strictEqual((await h.call("DELETE", `${R}/files/agent/evidence/1/a.png`)).status, 200)
  assert.strictEqual((await h.call("GET", `${R}/files/agent/evidence/1/a.png`)).status, 404)
  // no temp files left beside the targets
  assert.deepStrictEqual(fs.readdirSync(path.join(h.root, "proj", "active", "login-fix", "agent", "evidence", "1")), [])
  for (const p of [`${R}/files/a%5Cb`, `${R}/files/a%2Fb/..%2F..`, "/api/runs/.hub/x/files/a", "/api/runs/proj/a%3Ab/files/x"]) {
    assert.strictEqual((await h.put(p, "x")).status, 400, p)
  }
})

test("an unknown holder is relabelled to the first PC that writes", async t => {
  const h = await hubOn(t)
  fs.mkdirSync(path.dirname(h.recordFile("proj", "login-fix")), { recursive: true })
  fs.writeFileSync(h.recordFile("proj", "login-fix"), JSON.stringify({ v: 1, project: "proj", runId: "login-fix", pc: "unknown", state: "complete", gen: 4, at: "2026-01-01T00:00:00.000Z", by: "import" }))
  assert.strictEqual((await h.put(`${R}/files/a.md`, "a", { pc: "PC-B" })).status, 200)
  const rec = JSON.parse(fs.readFileSync(h.recordFile("proj", "login-fix"), "utf8"))
  assert.deepStrictEqual([rec.pc, rec.gen, rec.by], ["PC-B", 5, "relabel"])
  assert.strictEqual((await h.put(`${R}/files/a.md`, "b", { pc: "PC-C" })).status, 409)
})

test("a state move goes to the new folder and merges into one already there", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  await h.put(`${R}/files/1-spec.md`, "spec")
  await h.put(`${R}/files/agent/trace.jsonl`, "new\n")
  const moved = await h.call("POST", `${R}/state`, { body: { state: "defer", uid: "u9" } })
  assert.deepStrictEqual([moved.status, moved.json.record.state, moved.json.record.gen, moved.json.record.uid], [200, "defer", 2, "u9"])
  assert.ok(!fs.existsSync(path.join(h.root, "proj", "active", "login-fix")))
  // a move that crashed left part of the run in active/
  const dest = path.join(h.root, "proj", "active", "login-fix")
  fs.mkdirSync(path.join(dest, "agent"), { recursive: true })
  fs.writeFileSync(path.join(dest, "agent", "trace.jsonl"), "old\n")
  fs.writeFileSync(path.join(dest, "left.md"), "left")
  const back = await h.call("POST", `${R}/state`, { body: { state: "active" } })
  assert.strictEqual(back.json.record.gen, 3)
  assert.ok(!fs.existsSync(path.join(h.root, "proj", "defer", "login-fix")))
  assert.deepStrictEqual(
    ["1-spec.md", "agent/trace.jsonl", "left.md"].map(f => fs.readFileSync(path.join(dest, f), "utf8")),
    ["spec", "new\n", "left"],
  )
})

test("a closed run's retro takes a write from any PC with a precondition", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  // an open run: the holder only
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r0", { pc: "PC-B", headers: { "if-none-match": "*" } })).status, 409)
  await h.call("POST", `${R}/state`, { body: { state: "complete" } })
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r1", { pc: "PC-B" })).status, 428)
  // the holder goes through the same check
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r1")).status, 428)
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r1", { pc: "PC-B", headers: { "if-none-match": "*" } })).status, 200)
  const lost = await h.put(`${R}/files/retro.md`, "r2", { pc: "PC-C", headers: { "if-none-match": "*" } })
  assert.deepStrictEqual([lost.status, lost.json.hash], [412, sha256("r1")])
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r2", { pc: "PC-C", headers: { "if-match": sha256("old") } })).status, 412)
  assert.strictEqual((await h.put(`${R}/files/retro.md`, "r2", { pc: "PC-C", headers: { "if-match": sha256("r1") } })).status, 200)
  assert.strictEqual((await h.put(`${R}/files/agent/retro.md`, "a", { pc: "PC-C", headers: { "if-none-match": "*" } })).status, 200)
  // other files of the closed run stay the holder's
  assert.strictEqual((await h.put(`${R}/files/1-spec.md`, "x", { pc: "PC-C", headers: { "if-none-match": "*" } })).status, 409)
  // the retro exception does not relabel or change the record
  assert.strictEqual(JSON.parse(fs.readFileSync(h.recordFile("proj", "login-fix"), "utf8")).pc, "PC-A")
})

test("docs gives the documents a person reads, up to 3 MB", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  const files = {
    "1-spec.md": "spec",
    "1-mockup.html": "<p>m</p>",
    "brief/기획서.md": "brief",
    "handoff/notes.md": "notes",
    "agent/qa.md": "qa",
    "agent/trace.jsonl": "{}\n",
    "agent/evidence/x/1/a.md": "deep",
    "brief/a.xlsx": "xlsx",
    "z-big.md": "x".repeat(3 * 1024 * 1024),
  }
  for (const [rel, text] of Object.entries(files)) assert.strictEqual((await h.put(`${R}/files/${rel.split("/").map(encodeURIComponent).join("/")}`, text)).status, 200, rel)
  const got = await h.call("GET", `${R}/docs`)
  assert.deepStrictEqual(Object.keys(got.json.files).sort(), ["1-mockup.html", "1-spec.md", "agent/qa.md", "brief/기획서.md", "handoff/notes.md"])
  assert.strictEqual(got.json.files["brief/기획서.md"], "brief")
  assert.deepStrictEqual(got.json.skipped, ["z-big.md"])
})

test("Host, Origin and peer checks", async t => {
  const h = await hubOn(t)
  const port = h.at.port
  const ping = headers => h.call("GET", "/api/info", { headers })
  assert.strictEqual((await ping({})).status, 200)
  assert.strictEqual((await ping({ host: `hub-pc:${port}` })).status, 200)
  assert.strictEqual((await ping({ host: `hub-pc.tailnet.ts.net:${port}` })).status, 200)
  assert.strictEqual((await ping({ host: `hub-pc:${port}`, origin: `http://hub-pc:${port}` })).status, 200)
  for (const headers of [{ host: `evil.example:${port}` }, { host: "hub-pc:1" }, { host: "hub-pc" }, { origin: `http://evil.example:${port}` }]) {
    assert.strictEqual((await ping(headers)).status, 403, JSON.stringify(headers))
  }
  // the real peer check: 127.0.0.1 is not on the tailnet
  const strict = await hubOn(t, null)
  assert.strictEqual((await strict.call("GET", "/api/info")).status, 403)
  for (const a of ["100.64.0.1", "100.127.255.254", "::ffff:100.100.1.2", "fd7a:115c:a1e0::1", "FD7A:115C:A1E0:ab12::5"]) assert.ok(tailnet(a), a)
  for (const a of ["100.63.0.1", "100.128.0.1", "127.0.0.1", "192.168.0.10", "::1", "fd7a:115c:a1e1::1", undefined]) assert.ok(!tailnet(a), String(a))
})

test("serve refuses to listen anywhere but on a Tailscale address", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rein-hub-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const bind of ["0.0.0.0", "::", "0", "::0", "0:0:0:0:0:0:0:0", "127.0.0.1", "192.168.0.10", "100.128.0.1"]) {
    await assert.rejects(serve({ root, bind, port: 0, log: () => {} }), /Tailscale address only/, bind)
  }
  assert.ok(!fs.existsSync(path.join(root, ".hub", "hub.json")))
})

test("a run file gone between its look-up and its read is a 404, and the hub keeps running", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  await h.put(`${R}/files/1-spec.md`, "# spec\n")
  await h.put(`${R}/files/1-mockup.html`, "<p>mockup</p>")
  for (const [url, rel] of [[`${R}/files/1-spec.md`, "1-spec.md"], ["/files/proj/active/login-fix/1-mockup.html", "1-mockup.html"]]) {
    const full = path.join(h.root, "proj", "active", "login-fix", rel)
    const stat = fs.statSync
    // the file goes right after the hub looked at it, as a DELETE or a state move at that moment would
    fs.statSync = (p, ...r) => {
      const st = stat(p, ...r)
      if (p === full) {
        fs.statSync = stat
        fs.rmSync(full)
      }
      return st
    }
    t.after(() => { fs.statSync = stat })
    const r = await h.call("GET", url)
    assert.strictEqual(r.status, 404, url)
  }
  assert.strictEqual((await h.call("GET", "/api/info")).status, 200)
})

test("a run's page or picture is served sandboxed, so its scripts cannot call the API as the page", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  for (const [rel, text] of [["1-mockup.html", "<script>fetch('/api/rules/x.md',{method:'PUT'})</script>"], ["shot.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>"], ["1-spec.md", "# spec\n"]]) {
    await h.put(`${R}/files/${rel}`, text)
  }
  const get = rel => h.call("GET", `/files/proj/active/login-fix/${rel}`)
  for (const rel of ["1-mockup.html", "shot.svg"]) {
    const r = await get(rel)
    assert.strictEqual(r.status, 200, rel)
    assert.strictEqual(r.headers["content-security-policy"], "sandbox allow-scripts allow-popups", rel)
    assert.strictEqual(r.headers["x-content-type-options"], "nosniff", rel)
  }
  const md = await get("1-spec.md")
  assert.deepStrictEqual([md.status, md.headers["content-security-policy"], md.headers["x-content-type-options"], String(md.buf)], [200, undefined, "nosniff", "# spec\n"])
  // a sandboxed page's requests carry Origin: null, which the hub refuses
  const r = await h.put("/api/rules/x.md", "evil", { headers: { origin: "null", "if-none-match": "*" } })
  assert.strictEqual(r.status, 403)
})

test("the run listing carries the record, the info, the digest and the link", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active", uid: "u1" } })
  const info = { v: 1, uid: "u1", project: "proj", runId: "login-fix", stage: "plan", title: "로그인 고침", at: "2026-11-18T00:00:00.000Z", event: "spec", portable: true, run: { stage: "plan" } }
  await h.put(`${R}/files/agent/record.json`, JSON.stringify(info))
  await h.put(`${R}/files/1-spec.md`, "# 스펙 제목\n")
  // a run with no record.json: stage and title from the trace and 1-spec.md
  await h.call("POST", "/api/runs/proj/old/create", { pc: "PC-B", body: { state: "defer" } })
  await h.put("/api/runs/proj/old/files/1-spec.md", "# 옛 run\n", { pc: "PC-B" })
  await h.put("/api/runs/proj/old/files/agent/trace.jsonl", '{"ev":"stage","t":1,"from":"spec","to":"plan"}\n', { pc: "PC-B" })
  await h.call("POST", "/api/runs/other/x/create", { body: { state: "complete" } })
  // a temp file a crash left behind is not part of the digest
  fs.writeFileSync(path.join(h.root, "proj", "active", "login-fix", "1-spec.md.rein-tmp-ab12"), "junk")

  const all = await h.call("GET", "/api/hub/runs", { headers: { host: `hub-pc:${h.at.port}` } })
  assert.strictEqual(all.json.runs.length, 3)
  const list = await h.call("GET", "/api/hub/runs?project=proj")
  const byId = Object.fromEntries(list.json.runs.map(r => [r.runId, r]))
  assert.deepStrictEqual(Object.keys(byId).sort(), ["login-fix", "old"])
  const r = byId["login-fix"]
  assert.deepStrictEqual(
    [r.project, r.uid, r.pc, r.state, r.gen, r.stage, r.title, r.portable, r.resumable],
    ["proj", "u1", "PC-A", "active", 1, "plan", "로그인 고침", true, true],
  )
  assert.strictEqual(r.digest, treeDigest({ "1-spec.md": sha256("# 스펙 제목\n"), "agent/record.json": sha256(JSON.stringify(info)) }))
  assert.strictEqual(r.link, `http://127.0.0.1:${h.at.port}/#proj/login-fix`)
  assert.strictEqual(all.json.runs.find(x => x.runId === "login-fix").link, `http://hub-pc:${h.at.port}/#proj/login-fix`)
  const o = byId.old
  assert.deepStrictEqual([o.pc, o.state, o.stage, o.title, o.portable, o.resumable], ["PC-B", "defer", "plan", "옛 run", false, false])
  assert.strictEqual((await h.call("GET", "/api/hub/runs?project=..")).status, 400)

  const one = await h.call("GET", R)
  assert.deepStrictEqual([one.json.record.gen, one.json.info.run], [1, { stage: "plan" }])
  assert.strictEqual((await h.call("GET", "/api/runs/proj/none")).status, 404)
})

test("the hub page is read-only and names each run's PC", async t => {
  const h = await hubOn(t)
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  const ping = await h.call("GET", "/api/ping")
  assert.deepStrictEqual(ping.json, { rein: true, hub: true, readOnly: true })
  const runs = await h.call("GET", "/api/runs")
  assert.strictEqual(runs.json.hub, true)
  assert.strictEqual(runs.json.readOnly, true)
  assert.deepStrictEqual(runs.json.projects.map(p => p.name), ["proj"])
  assert.strictEqual(runs.json.projects[0].runs[0].pc, "PC-A")
  const page = await h.call("GET", "/")
  assert.strictEqual(page.status, 200)
  assert.match(String(page.buf), /<html|<!doctype/i)
  const check = await h.call("POST", "/api/checklist", { body: {}, headers: { "content-type": "application/json" } })
  assert.strictEqual(check.status, 405)
  const info = await h.call("GET", "/api/info")
  assert.deepStrictEqual([info.json.rein, info.json.hub, info.json.v, info.json.imported], [true, true, 1, null])
})

test("the retro listing gives each closed run's retro file with its open count", async t => {
  const h = await hubOn(t)
  const retro = "## 하나\n상태: 후보\n\n## 둘\n상태: 반영함\n\n## 셋\n상태: 채택\n"
  await h.call("POST", `${R}/create`, { body: { state: "active" } })
  await h.put(`${R}/files/retro.md`, retro)
  await h.call("POST", `${R}/state`, { body: { state: "complete" } })
  await h.call("POST", "/api/runs/proj/gone/create", { pc: "PC-B", body: { state: "active" } })
  await h.put("/api/runs/proj/gone/files/agent/retro.md", "## 하나\n상태: 버림\n", { pc: "PC-B" })
  await h.call("POST", "/api/runs/proj/gone/state", { pc: "PC-B", body: { state: "drop" } })
  // open runs and closed runs with no retro are left out
  await h.call("POST", "/api/runs/proj/open/create", { body: { state: "active" } })
  await h.put("/api/runs/proj/open/files/retro.md", retro)
  await h.call("POST", "/api/runs/other/bare/create", { body: { state: "complete" } })

  const all = await h.call("GET", "/api/retros")
  const byId = Object.fromEntries(all.json.retros.map(r => [r.runId, r]))
  assert.deepStrictEqual(Object.keys(byId).sort(), ["gone", "login-fix"])
  assert.deepStrictEqual(byId["login-fix"], { project: "proj", runId: "login-fix", state: "complete", pc: "PC-A", rel: "retro.md", hash: sha256(retro), open: 2 })
  assert.deepStrictEqual([byId.gone.state, byId.gone.pc, byId.gone.rel, byId.gone.open], ["drop", "PC-B", "agent/retro.md", 0])
  assert.deepStrictEqual((await h.call("GET", "/api/retros?project=other")).json, { retros: [] })
  assert.strictEqual((await h.call("GET", "/api/retros?project=.hub")).status, 400)
})

const RULE = "---\npaths:\n  - \"src/**\"\n---\n# 규칙\n본문\n"

test("the catalog lists each domain's files by body hash and serves them", async t => {
  const h = await hubOn(t)
  const dom = path.join(h.root, ".hub", "domains", "web")
  fs.mkdirSync(path.join(dom, "rules"), { recursive: true })
  fs.mkdirSync(path.join(dom, "knowledge"), { recursive: true })
  fs.writeFileSync(path.join(dom, "domain.json"), JSON.stringify({ name: "Web", description: "설명" }))
  fs.writeFileSync(path.join(dom, "rules", "a.md"), RULE)
  fs.writeFileSync(path.join(dom, "knowledge", "k.md"), "지식\n")
  fs.writeFileSync(path.join(dom, "knowledge", "k.md.rein-tmp-ab12"), "junk")
  fs.mkdirSync(path.join(h.root, ".hub", "domains", "bare"))

  const cat = await h.call("GET", "/api/catalog")
  assert.deepStrictEqual(cat.json.domains.sort((a, b) => (a.id < b.id ? -1 : 1)), [
    { id: "bare", name: "bare", description: "", files: {} },
    { id: "web", name: "Web", description: "설명", files: {
      "domain.json": sha256(JSON.stringify({ name: "Web", description: "설명" })),
      "knowledge/k.md": sha256("지식\n"),
      "rules/a.md": sha256("---\n---\n# 규칙\n본문\n"),
    } },
  ])
  const got = await h.call("GET", "/api/catalog/web/rules/a.md")
  assert.strictEqual(String(got.buf), RULE)
  assert.strictEqual(got.headers["x-rein-hash"], bodyHash("rules/a.md", RULE))
  assert.strictEqual((await h.call("GET", "/api/catalog/web/rules/none.md")).status, 404)
  for (const p of ["/api/catalog/..%2Fx/a.md", "/api/catalog/web/..", "/api/catalog/web/"]) assert.strictEqual((await h.call("GET", p)).status, 400, p)
})

test("a catalog PUT or DELETE needs a precondition and keeps the hub's paths", async t => {
  const h = await hubOn(t)
  const file = path.join(h.root, ".hub", "domains", "web", "rules", "a.md")
  const A = "/api/catalog/web/rules/a.md"
  const put = (text, headers, pc) => h.call("PUT", A, { pc, body: Buffer.from(text), headers })

  assert.strictEqual((await put(RULE, {})).status, 428)
  assert.strictEqual((await put(RULE, { "if-none-match": "*" }, "")).status, 400)
  const made = await put(RULE, { "if-none-match": "*" })
  assert.deepStrictEqual([made.status, made.json.hash], [200, bodyHash("rules/a.md", RULE)])
  assert.deepStrictEqual([(await put(RULE, { "if-none-match": "*" })).status, (await put(RULE, { "if-none-match": "*" })).json.hash], [412, made.json.hash])

  // a PC's fitted globs, with CRLF: the hub keeps its own and takes the body
  const mine = "---\r\npaths:\r\n  - \"app/**\"\r\n---\r\n# 규칙\r\n새 본문\r\n"
  const stale = await put(mine, { "if-match": sha256("old") })
  assert.deepStrictEqual([stale.status, stale.json], [412, { error: "changed", hash: made.json.hash }])
  const took = await put(mine, { "if-match": made.json.hash })
  assert.strictEqual(took.status, 200)
  assert.strictEqual(fs.readFileSync(file, "utf8"), "---\npaths:\n  - \"src/**\"\n---\n# 규칙\n새 본문\n")
  assert.strictEqual(took.json.hash, bodyHash("rules/a.md", mine))
  // x-rein-paths: replace takes the globs too
  const all = "---\npaths:\n  - \"lib/**\"\n---\n# 규칙\n새 본문\n"
  const replaced = await put(all, { "if-match": took.json.hash, "x-rein-paths": "replace" })
  assert.deepStrictEqual([replaced.status, replaced.json.hash], [200, took.json.hash])
  assert.strictEqual(fs.readFileSync(file, "utf8"), all)
  // a knowledge file is taken as sent
  const k = await h.call("PUT", "/api/catalog/web/knowledge/k.md", { body: Buffer.from("---\npaths: x\n---\nk"), headers: { "if-none-match": "*" } })
  assert.deepStrictEqual([k.status, k.json.hash], [200, sha256("---\npaths: x\n---\nk")])

  assert.strictEqual((await h.call("DELETE", A, {})).status, 428)
  assert.strictEqual((await h.call("DELETE", A, { headers: { "if-match": sha256("old") } })).status, 412)
  assert.deepStrictEqual((await h.call("DELETE", A, { headers: { "if-match": took.json.hash } })).json, { ok: true })
  assert.ok(!fs.existsSync(file))
  const absent = await h.call("DELETE", A, { headers: { "if-match": took.json.hash } })
  assert.deepStrictEqual([absent.status, absent.json.hash], [412, null])
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), [])
})

test("shared rules work the same way, hashed as rules/<rel>", async t => {
  const h = await hubOn(t)
  const file = path.join(h.root, "rules", "general", "r.md")
  const A = "/api/rules/general/r.md"
  assert.deepStrictEqual((await h.call("GET", "/api/rules")).json, { files: {} })
  assert.strictEqual((await h.call("PUT", A, { body: Buffer.from(RULE) })).status, 428)
  const made = await h.call("PUT", A, { body: Buffer.from(RULE), headers: { "if-none-match": "*" } })
  // the paths: entry is not part of the hash
  assert.strictEqual(made.json.hash, bodyHash("rules/general/r.md", "---\npaths:\n  - \"x/**\"\n---\n# 규칙\n본문\n"))
  assert.deepStrictEqual((await h.call("GET", "/api/rules")).json, { files: { "general/r.md": made.json.hash } })
  assert.strictEqual((await h.call("GET", A)).headers["x-rein-hash"], made.json.hash)

  const mine = "---\npaths:\n  - \"x/**\"\n---\n# 규칙\n바뀜\n"
  assert.strictEqual((await h.call("PUT", A, { body: Buffer.from(mine), headers: { "if-match": sha256("old") } })).status, 412)
  const took = await h.call("PUT", A, { body: Buffer.from(mine), headers: { "if-match": made.json.hash } })
  assert.strictEqual(took.status, 200)
  assert.strictEqual(fs.readFileSync(file, "utf8"), "---\npaths:\n  - \"src/**\"\n---\n# 규칙\n바뀜\n")
  assert.strictEqual((await h.call("DELETE", A, { headers: { "if-match": took.json.hash } })).status, 200)
  assert.strictEqual((await h.call("GET", A)).status, 404)
  // the shared rules folder is not a project
  assert.deepStrictEqual((await h.call("GET", "/api/runs")).json.projects, [])
})
