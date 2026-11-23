import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "../src/server.js"

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

test("the orders page shows a row per order", async () => {
  const { status, html } = await get("/orders")
  assert.equal(status, 200)
  assert.equal(html.match(/<tr data-id=/g).length, 8)
})

test("the members page shows a row per member", async () => {
  const { status, html } = await get("/members")
  assert.equal(status, 200)
  assert.equal(html.match(/<tr data-id=/g).length, 45)
})

test("an unknown page is 404", async () => {
  assert.equal((await get("/nope")).status, 404)
})
