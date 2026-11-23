import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "./src/server.js"

async function get(path) {
  const server = createServer().listen(0)
  await new Promise(r => server.once("listening", r))
  try {
    const res = await fetch(`http://localhost:${server.address().port}${path}`)
    return { status: res.status, html: await res.text() }
  } finally {
    server.close()
  }
}

const ids = html => [...html.matchAll(/<tr[^>]*data-id="(\d+)"/g)].map(m => Number(m[1]))

test("status=paid shows only paid orders", async () => {
  const { status, html } = await get("/orders?status=paid")
  assert.equal(status, 200)
  assert.deepEqual(ids(html), [1001, 1003, 1005, 1007])
})

test("status=cancelled shows only cancelled orders", async () => {
  assert.deepEqual(ids((await get("/orders?status=cancelled")).html), [1004, 1008])
})

test("no status shows every order", async () => {
  assert.deepEqual(ids((await get("/orders")).html), [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008])
})
