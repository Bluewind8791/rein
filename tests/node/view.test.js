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
