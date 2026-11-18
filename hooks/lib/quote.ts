// Text the person reads in a question (relayed by the main session) that came from a command's
// output or a file the run's code could write: fenced, every line behind
// "> ", and nothing that could close the fence, break a line without a "> ",
// move the cursor or reorder the text. Line breaks of every kind split
// lines; control, zero-width and bidi characters show as \uXXXX; backticks
// become '; the body is capped with a marker.
const LIMIT = 2000
const BREAKS = /\r\n|\r|\n|\u2028|\u2029|\x85/
const HIDDEN = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

export function quoted(text: string): string {
  const lines = text.replace(/\x60/g, "'").split(BREAKS)
  const shown = lines.map(l => l.replace(HIDDEN, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`))
  let body = shown.map(l => `> ${l}`).join("\n")
  if (body.length > LIMIT) body = `${body.slice(0, LIMIT)}\n> … (${body.length - LIMIT}자 더 있음, 잘림)`
  return `\`\`\`text\n${body}\n\`\`\``
}
