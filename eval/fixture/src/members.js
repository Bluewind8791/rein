import { members } from "./data.js"

export function listMembers() {
  return members
}

export function findMember(id) {
  return members.find(m => m.id === id)
}
