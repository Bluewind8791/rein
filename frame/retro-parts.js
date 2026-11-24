#!/usr/bin/env node
// The parts of a closed run that the rein:retro skill hands to its readers.
//
//   node retro-parts.js <run folder> [<transcript.jsonl> ...]
//
// Writes into <run folder>/agent/retro-read/ (emptied first):
//   trace.txt  the trace's lines but the passed tool calls ("decision":"allow"),
//              trace.jsonl, trace-2.jsonl, … in order, each line as
//              <file>:<line><TAB><the line>
//   user.md    what the user said in the transcripts: typed messages, answers
//              to AskUserQuestion and words given with a refused tool call
// then cuts trace.txt, agent/e2e.md, agent/fails.md and user.md into parts of
// about PART bytes at line ends, a small file sharing a part with the next.
// The last output line is {"parts":[{"out":"<dir>/1.md","read":[{"file","lines"}]}]}
// or {"error":"..."}.
//
// Zero dependencies; Node 18 or later.
"use strict"

const fs = require("fs")
const path = require("path")
const readline = require("readline")
const { traceFiles } = require("./view.js")

const PART = 300 * 1024
// a user message longer than this is cut: a pasted log or document.
const MESSAGE = 4000

const slash = p => p.replace(/\\/g, "/")

// the trace but the passed tool calls, each line as <file>:<line><TAB><line>.
function traceText(run) {
  const out = []
  for (const file of traceFiles(run)) {
    const name = path.basename(file)
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    lines.forEach((l, i) => {
      if (l.trim() !== "" && !l.includes('"decision":"allow"')) out.push(`${name}:${i + 1}\t${l}`)
    })
  }
  return out.join("\n")
}

const cut = s => (s.length > MESSAGE ? `${s.slice(0, MESSAGE)}\n… (${s.length - MESSAGE}자 생략)` : s)

const textOf = content =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.filter(c => c && c.type === "text").map(c => c.text).join("\n")
      : ""

// what the user said on one transcript line, or undefined.
function said(o) {
  if (o.type !== "user" || o.isMeta || o.isSidechain || !o.message) return undefined
  const content = o.message.content
  const answers = o.toolUseResult && o.toolUseResult.answers
  if (answers && typeof answers === "object") {
    const notes = (o.toolUseResult.annotations && typeof o.toolUseResult.annotations === "object") ? o.toolUseResult.annotations : {}
    return Object.entries(answers).map(([q, a]) => {
      const note = notes[q] && notes[q].notes ? ` (메모: ${notes[q].notes})` : ""
      return `질문: ${q}\n답: ${a}${note}`
    }).join("\n")
  }
  if (Array.isArray(content) && content.some(c => c && c.type === "tool_result")) {
    for (const c of content) {
      const t = c && c.type === "tool_result" ? textOf(c.content) : ""
      const at = t.indexOf("the user said:")
      if (at >= 0) return `(도구 거절) ${t.slice(at + "the user said:".length).trim()}`
    }
    return undefined
  }
  const text = textOf(content).trim()
  if (text === "") return undefined
  // a newer transcript marks what the user typed; an older one does not.
  if (o.origin && typeof o.origin === "object") return o.origin.kind === "human" ? text : undefined
  if (/^<(local-command|task-notification|system-reminder)/.test(text) || text.startsWith("This session is being continued")) return undefined
  return text
}

async function userText(transcripts) {
  const out = []
  for (const file of transcripts) {
    if (!fs.existsSync(file)) continue
    const name = path.basename(file)
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
    let n = 0
    for await (const l of rl) {
      n++
      if (!l.includes('"type":"user"')) continue
      let o
      try { o = JSON.parse(l) } catch { continue }
      const s = said(o)
      if (s !== undefined) out.push(`### ${name}:${n} ${o.timestamp || ""}\n${cut(s)}\n`)
    }
  }
  return out.join("\n")
}

// a file's lines cut into pieces of about PART bytes, each {file, from, to, size}.
function pieces(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n")
  if (lines.at(-1) === "") lines.pop()
  const sizes = lines.map(l => Buffer.byteLength(l) + 1)
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total === 0) return []
  const k = Math.ceil(total / PART)
  const each = total / k
  const out = []
  let from = 1
  let size = 0
  sizes.forEach((s, i) => {
    size += s
    if ((size >= each && out.length < k - 1) || i === sizes.length - 1) {
      out.push({ file: slash(file), from, to: i + 1, size })
      from = i + 2
      size = 0
    }
  })
  return out
}

// pieces packed in order into parts of at most PART bytes; a piece over it
// is a part alone.
function pack(all) {
  const parts = []
  let cur = { read: [], size: 0 }
  for (const p of all) {
    if (cur.read.length > 0 && cur.size + p.size > PART) {
      parts.push(cur)
      cur = { read: [], size: 0 }
    }
    cur.read.push({ file: p.file, lines: `${p.from}-${p.to}` })
    cur.size += p.size
  }
  if (cur.read.length > 0) parts.push(cur)
  return parts
}

async function main(argv) {
  const [run, ...transcripts] = argv
  if (!run || !fs.existsSync(run)) throw new Error(`no run folder: ${run}`)
  const agent = path.join(run, "agent")
  const dir = path.join(agent, "retro-read")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const trace = traceText(run)
  if (trace !== "") fs.writeFileSync(path.join(dir, "trace.txt"), trace + "\n")
  const user = await userText(transcripts)
  if (user !== "") fs.writeFileSync(path.join(dir, "user.md"), user)
  const files = [path.join(dir, "trace.txt"), path.join(agent, "e2e.md"), path.join(agent, "fails.md"), path.join(dir, "user.md")].filter(f => fs.existsSync(f))
  const parts = pack(files.flatMap(pieces)).map((p, i) => ({ out: slash(path.join(dir, `${i + 1}.md`)), read: p.read }))
  return { parts }
}

module.exports = { main, pieces, pack, said, PART }

if (require.main === module) {
  main(process.argv.slice(2))
    .then(r => console.log(JSON.stringify(r)))
    .catch(e => {
      console.log(JSON.stringify({ error: String(e && e.message ? e.message : e) }))
      process.exitCode = 1
    })
}
