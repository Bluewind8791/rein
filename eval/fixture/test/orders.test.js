import { test } from "node:test"
import assert from "node:assert/strict"
import { listOrders, orderTotal } from "../src/orders.js"

test("lists every order", () => {
  assert.equal(listOrders().length, 8)
})

test("a one-item order totals its price", () => {
  const order = { items: [{ name: "볼펜", price: 1500, qty: 1 }] }
  assert.equal(orderTotal(order), 1500)
})
