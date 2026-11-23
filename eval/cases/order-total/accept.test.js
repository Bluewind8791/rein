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

const totals = html => Object.fromEntries([...html.matchAll(/<tr[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<td class="total">([^<]*)<\/td>/g)].map(m => [m[1], m[2]]))

test("each order total is price × quantity summed", async () => {
  const { status, html } = await get("/orders")
  assert.equal(status, 200)
  const t = totals(html)
  assert.equal(t["1003"], "9,000원")
  assert.equal(t["1006"], "1,600원")
  assert.equal(t["1001"], "1,500원")
  assert.equal(t["1007"], "5,500원")
})
