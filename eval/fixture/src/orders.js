import { orders } from "./data.js"

export const STATUS_LABELS = { paid: "결제 완료", pending: "결제 대기", cancelled: "취소" }

export function listOrders() {
  return orders
}

// 주문 합계 금액
export function orderTotal(order) {
  return order.items.reduce((sum, item) => sum + item.price, 0)
}
