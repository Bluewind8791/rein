import { STATUS_LABELS, orderTotal } from "./orders.js"
import { findMember } from "./members.js"

const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const won = n => `${n.toLocaleString("ko-KR")}원`

function page(title, body) {
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}nav a{margin-right:12px}</style>
</head>
<body>
<nav><a href="/orders">주문 목록</a><a href="/members">회원 목록</a></nav>
<h1>${escape(title)}</h1>
${body}
</body>
</html>`
}

export function ordersPage(orders) {
  const rows = orders.map(o => {
    const member = findMember(o.member)
    const items = o.items.map(i => `${i.name} × ${i.qty}`).join(", ")
    return `<tr data-id="${o.id}" data-status="${o.status}"><td>${o.id}</td><td>${escape(member ? member.name : "-")}</td><td>${escape(items)}</td><td class="total">${won(orderTotal(o))}</td><td>${STATUS_LABELS[o.status]}</td></tr>`
  })
  return page("주문 목록", `<table>
<thead><tr><th>주문 번호</th><th>회원</th><th>상품</th><th>합계</th><th>상태</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>`)
}

export function membersPage(members) {
  const rows = members.map(m => `<tr data-id="${m.id}"><td>${m.id}</td><td>${escape(m.name)}</td><td>${escape(m.email)}</td><td>${m.joined}</td></tr>`)
  return page("회원 목록", `<table>
<thead><tr><th>번호</th><th>이름</th><th>이메일</th><th>가입일</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>`)
}

export function notFoundPage() {
  return page("찾을 수 없음", "<p>없는 화면입니다.</p>")
}
