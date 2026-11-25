"use strict"

const test = require("node:test")
const assert = require("node:assert")
const http = require("http")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { makeView } = require("../../frame/view.js")

// a local view over a temp root with one active run; opener records what it
// was asked to open instead of starting a program
async function viewOn(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rein-view-"))
  const run = path.join(root, "proj", "active", "order0101")
  fs.mkdirSync(path.join(run, "handoff"), { recursive: true })
  fs.mkdirSync(path.join(run, "agent"))
  for (const f of ["cases.xlsx", "run.bat", "handoff/patch.sql", "agent/frame.json"]) fs.writeFileSync(path.join(run, f), "x")
  const opened = []
  const view = makeView({ root, opener: full => opened.push(full) })
  const server = http.createServer(view.handle)
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  t.after(() => {
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const open = (file, type = "application/json") =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: "/api/open", headers: { "content-type": type } }, res => {
        res.resume()
        res.on("end", () => resolve(res.statusCode))
      })
      req.on("error", reject)
      req.end(JSON.stringify({ file }))
    })
  return { run, opened, open }
}

test("the local page opens a run file of an allowed type on this PC", async t => {
  const v = await viewOn(t)
  assert.strictEqual(await v.open("/files/proj/active/order0101/cases.xlsx"), 200)
  assert.strictEqual(await v.open("/files/proj/active/order0101/handoff/patch.sql"), 200)
  assert.deepStrictEqual(v.opened, [path.join(v.run, "cases.xlsx"), path.join(v.run, "handoff", "patch.sql")])
})

test("the local page does not open other types, files it may not read, or a body that is not JSON", async t => {
  const v = await viewOn(t)
  assert.strictEqual(await v.open("/files/proj/active/order0101/run.bat"), 400)
  assert.strictEqual(await v.open("/files/proj/active/order0101/agent/frame.json"), 404)
  assert.strictEqual(await v.open("/files/proj/active/order0101/none.xlsx"), 404)
  assert.strictEqual(await v.open("/files/proj/active/order0101/../../../proj/active/order0101/cases.xlsx"), 404)
  assert.strictEqual(await v.open("cases.xlsx"), 404)
  assert.strictEqual(await v.open("/files/proj/active/order0101/cases.xlsx", "text/plain"), 415)
  assert.deepStrictEqual(v.opened, [])
})

// a view over a temp root with one active run in the given stage
async function commentsOn(t, { stage = "spec", readOnly = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rein-view-"))
  const run = path.join(root, "proj", "active", "order0101")
  fs.mkdirSync(path.join(run, "agent"), { recursive: true })
  fs.writeFileSync(path.join(run, "agent", "frame.json"), JSON.stringify({ stage }))
  const view = makeView({ root, readOnly })
  const server = http.createServer(view.handle)
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  t.after(() => {
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const post = body =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: "/api/comments", headers: { "content-type": "application/json" } }, res => {
        let s = ""
        res.on("data", c => { s += c })
        res.on("end", () => {
          let j = null
          try { j = JSON.parse(s) } catch {}
          resolve({ code: res.statusCode, body: j })
        })
      })
      req.on("error", reject)
      req.end(JSON.stringify({ project: "proj", runId: "order0101", ...body }))
    })
  const file = path.join(run, "agent", "comments.json")
  const stored = () => JSON.parse(fs.readFileSync(file, "utf8")).comments
  return { run, view, post, file, stored }
}

test("a comment is added as a draft, numbered, and shown in the run list", async t => {
  const v = await commentsOn(t)
  const a = await v.post({ op: "add", screen: "order0101", el: "search.status", text: " 상태에 보류 추가 " })
  assert.strictEqual(a.code, 200)
  assert.strictEqual(a.body.comment.id, "c1")
  assert.strictEqual(a.body.comment.n, 1)
  assert.strictEqual(a.body.comment.status, "draft")
  assert.strictEqual(a.body.comment.text, "상태에 보류 추가")
  const b = await v.post({ op: "add", screen: "order0101", el: null, text: "화면 전체" })
  assert.strictEqual(b.body.comment.n, 2)
  assert.strictEqual(b.body.comment.el, null)
  assert.deepStrictEqual(v.stored().map(c => [c.id, c.el, c.status]), [["c1", "search.status", "draft"], ["c2", null, "draft"]])
  const run = v.view.snapshot().projects[0].runs[0]
  assert.deepStrictEqual(run.comments.map(c => c.n), [1, 2])
  assert.deepStrictEqual(fs.readdirSync(path.join(v.run, "agent")).sort(), ["comments.json", "frame.json"])
})

test("a draft is edited and deleted, and its number is not given again", async t => {
  const v = await commentsOn(t)
  await v.post({ op: "add", screen: "order0101", el: "list", text: "a" })
  await v.post({ op: "add", screen: "order0101", el: "list", text: "b" })
  assert.strictEqual((await v.post({ op: "edit", id: "c2", text: "b2" })).body.comment.text, "b2")
  assert.strictEqual((await v.post({ op: "delete", id: "c2" })).code, 200)
  assert.deepStrictEqual(v.stored().map(c => c.id), ["c1"])
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: "list", text: "c" })).body.comment.n, 3)
})

test("only a draft is edited or deleted, and only a done or declined comment reopened", async t => {
  const v = await commentsOn(t)
  const base = { screen: "order0101", el: null, text: "x", at: "2026-11-20T10:00:00.000Z" }
  fs.writeFileSync(v.file, JSON.stringify({ comments: [
    { id: "c1", n: 1, ...base, status: "sent" },
    { id: "c2", n: 2, ...base, status: "done", note: "반영함" },
    { id: "c3", n: 3, ...base, status: "declined", note: "범위 밖" },
  ] }))
  assert.strictEqual((await v.post({ op: "edit", id: "c1", text: "y" })).code, 409)
  assert.strictEqual((await v.post({ op: "delete", id: "c2" })).code, 409)
  assert.strictEqual((await v.post({ op: "reopen", id: "c1" })).code, 409)
  assert.strictEqual((await v.post({ op: "reopen", id: "c9" })).code, 404)
  const r = await v.post({ op: "reopen", id: "c2" })
  assert.strictEqual(r.code, 200)
  assert.deepStrictEqual([r.body.comment.status, r.body.comment.note], ["draft", "반영함"])
  assert.strictEqual((await v.post({ op: "reopen", id: "c3" })).body.comment.status, "draft")
  assert.deepStrictEqual(v.stored().map(c => c.status), ["sent", "draft", "draft"])
})

test("a draft's basis box is set, replaced and cleared; a sent one's is not", async t => {
  const v = await commentsOn(t)
  await v.post({ op: "add", screen: "order0101", el: "search.period", text: "기간 기본값" })
  const box = { doc: "brief/order.pdf", page: 4, x: 0.1, y: 0.2, w: 0.30004, h: 0.1, quote: " 조회 기간:\n 기본 7일 " }
  const a = await v.post({ op: "basis", id: "c1", basis: box })
  assert.strictEqual(a.code, 200)
  assert.deepStrictEqual(a.body.comment.basis, { doc: "brief/order.pdf", page: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.1, quote: "조회 기간: 기본 7일" })
  // an image has no page
  const img = { doc: "brief/order.png", x: 0, y: 0, w: 1, h: 0.5, quote: "" }
  assert.deepStrictEqual((await v.post({ op: "basis", id: "c1", basis: img })).body.comment.basis, img)
  assert.deepStrictEqual(v.stored()[0].basis, img)
  const cleared = await v.post({ op: "basis", id: "c1", basis: null })
  assert.strictEqual(cleared.code, 200)
  assert.strictEqual("basis" in cleared.body.comment, false)
  assert.strictEqual("basis" in v.stored()[0], false)
  for (const bad of [
    { ...box, doc: "1-spec.md" },
    { ...box, doc: "brief/../1-spec.md" },
    { ...box, doc: "brief\\a.pdf" },
    { ...box, page: 0 },
    { ...box, page: 1.5 },
    { ...box, x: 0.8, w: 0.3 },
    { ...box, w: 0 },
    { ...box, y: -0.1 },
    { ...box, quote: 3 },
    { ...box, quote: "x".repeat(501) },
    "brief/order.pdf",
  ]) assert.strictEqual((await v.post({ op: "basis", id: "c1", basis: bad })).code, 400, JSON.stringify(bad))
  const c = v.stored()[0]
  fs.writeFileSync(v.file, JSON.stringify({ comments: [{ ...c, status: "sent" }] }))
  assert.strictEqual((await v.post({ op: "basis", id: "c1", basis: box })).code, 409)
  assert.strictEqual((await v.post({ op: "basis", id: "c9", basis: box })).code, 404)
})

test("comments are refused outside spec, on the read-only page, and when malformed", async t => {
  const plan = await commentsOn(t, { stage: "plan" })
  assert.strictEqual((await plan.post({ op: "add", screen: "order0101", el: null, text: "x" })).code, 409)
  assert.strictEqual(fs.existsSync(plan.file), false)
  const ro = await commentsOn(t, { readOnly: true })
  assert.strictEqual((await ro.post({ op: "add", screen: "order0101", el: null, text: "x" })).code, 405)
  const v = await commentsOn(t)
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: null, text: "x", runId: "none" })).code, 409)
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: null, text: "x", runId: ".." })).code, 400)
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: null, text: "  " })).code, 400)
  assert.strictEqual((await v.post({ op: "add", screen: "", el: null, text: "x" })).code, 400)
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: 3, text: "x" })).code, 400)
  assert.strictEqual((await v.post({ op: "move", id: "c1" })).code, 400)
  fs.writeFileSync(v.file, "{ not json")
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: null, text: "x" })).code, 500)
  assert.strictEqual(fs.readFileSync(v.file, "utf8"), "{ not json")
})

test("a run moved out of the active folder takes no comments", async t => {
  const v = await commentsOn(t)
  const done = path.join(path.dirname(path.dirname(v.run)), "complete", "order0101")
  fs.mkdirSync(path.dirname(done), { recursive: true })
  fs.renameSync(v.run, done)
  assert.strictEqual((await v.post({ op: "add", screen: "order0101", el: null, text: "x" })).code, 409)
})

test("the page loads pdf.js from the plugin, not the internet", async t => {
  const v = await commentsOn(t)
  const server = http.createServer(v.view.handle)
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  t.after(() => server.close())
  for (const p of ["/vendor/pdfjs/pdf.min.js", "/vendor/pdfjs/pdf.worker.min.js"]) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`)
    assert.strictEqual(res.status, 200)
    assert.match(res.headers.get("content-type"), /^text\/javascript/)
    assert.ok((await res.text()).length > 100000)
  }
})

test("a download the client drops does not keep the file open", async t => {
  const { streamFile } = require("../../frame/view.js")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rein-stream-"))
  const file = path.join(dir, "big.bin")
  fs.writeFileSync(file, Buffer.alloc(32 * 1024 * 1024, 1))
  let closed
  const done = new Promise(r => (closed = r))
  const server = http.createServer((req, res) => {
    res.on("close", () => setTimeout(closed, 100))
    streamFile(res, file, { "content-type": "application/octet-stream" }, () => res.end())
  })
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  t.after(() => {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  await new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port: server.address().port, path: "/" }, res => {
      res.once("data", () => {
        req.destroy()
        resolve()
      })
    })
    req.on("error", () => {})
  })
  await done
  // Windows refuses to replace a file another handle still holds open
  const tmp = `${file}.new`
  fs.writeFileSync(tmp, "y")
  fs.renameSync(tmp, file)
  assert.strictEqual(fs.readFileSync(file, "utf8"), "y")
})
