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

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

test("the first page shows members 1 to 20", async () => {
  const { status, html } = await get("/members")
  assert.equal(status, 200)
  assert.deepEqual(ids(html), range(1, 20))
  assert.deepEqual(ids((await get("/members?page=1")).html), range(1, 20))
})

test("later pages show the next 20 and the rest", async () => {
  assert.deepEqual(ids((await get("/members?page=2")).html), range(21, 40))
  assert.deepEqual(ids((await get("/members?page=3")).html), range(41, 45))
})

test("a page past the end is an empty list", async () => {
  const { status, html } = await get("/members?page=4")
  assert.equal(status, 200)
  assert.deepEqual(ids(html), [])
})
