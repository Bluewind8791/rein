import http from "node:http"
import { listOrders } from "./orders.js"
import { listMembers } from "./members.js"
import { ordersPage, membersPage, notFoundPage } from "./render.js"

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost")
    const send = (status, html) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    }
    if (url.pathname === "/") {
      res.writeHead(302, { location: "/orders" })
      return res.end()
    }
    if (url.pathname === "/orders") return send(200, ordersPage(listOrders()))
    if (url.pathname === "/members") return send(200, membersPage(listMembers()))
    send(404, notFoundPage())
  })
}
