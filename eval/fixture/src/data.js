// 예시 데이터. 실제 서비스라면 DB에서 읽는다.

export const orders = [
  { id: 1001, member: 3, status: "paid", items: [{ name: "볼펜", price: 1500, qty: 1 }] },
  { id: 1002, member: 7, status: "pending", items: [{ name: "공책", price: 2000, qty: 1 }, { name: "지우개", price: 500, qty: 1 }] },
  { id: 1003, member: 12, status: "paid", items: [{ name: "볼펜", price: 1500, qty: 2 }, { name: "노트", price: 2000, qty: 3 }] },
  { id: 1004, member: 3, status: "cancelled", items: [{ name: "형광펜", price: 1200, qty: 1 }] },
  { id: 1005, member: 21, status: "paid", items: [{ name: "파일철", price: 3000, qty: 1 }] },
  { id: 1006, member: 30, status: "pending", items: [{ name: "자", price: 800, qty: 2 }] },
  { id: 1007, member: 41, status: "paid", items: [{ name: "가위", price: 4500, qty: 1 }, { name: "풀", price: 1000, qty: 1 }] },
  { id: 1008, member: 7, status: "cancelled", items: [{ name: "스테이플러", price: 6000, qty: 1 }] },
]

export const members = Array.from({ length: 45 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0")
  return { id: i + 1, name: `회원${n}`, email: `member${n}@example.com`, joined: `2026-0${(i % 9) + 1}-1${i % 10}` }
})
