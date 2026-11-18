// Pure text helpers shared by the frame, the hub and hooks/domain-sync.js.
//
// Zero dependencies; Node 18 or later.
"use strict"

const crypto = require("crypto")
const fs = require("fs")
const { execFileSync } = require("child_process")

// The lines of the `paths:` entry in the front matter, as rulePaths in
// lib/rules.ts reads it; null when there is none. text has LF line endings.
function pathsBlock(text) {
  const lines = text.split("\n")
  if (lines[0].trim() !== "---") return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
  if (end < 0) return null
  const at = lines.findIndex((l, i) => i > 0 && i < end && /^paths[ \t]*:/.test(l))
  if (at < 0) return null
  let stop = at + 1
  if (!lines[at].replace(/^paths[ \t]*:/, "").trim()) {
    for (let i = at + 1; i < end; i++) {
      if (/^[ \t]*-/.test(lines[i])) stop = i + 1
      else if (!/^[ \t]*(#.*)?$/.test(lines[i])) break
    }
  }
  return { lines, start: at, stop, text: lines.slice(at, stop).join("\n") }
}

function body(text) {
  const b = pathsBlock(text)
  return b ? [...b.lines.slice(0, b.start), ...b.lines.slice(b.stop)].join("\n") : text
}

// text with its `paths:` entry replaced by paths (null drops it).
function withPaths(text, paths) {
  const b = pathsBlock(text)
  const add = paths === null ? [] : [paths]
  if (b) return [...b.lines.slice(0, b.start), ...add, ...b.lines.slice(b.stop)].join("\n")
  if (paths === null) return text
  const lines = text.split("\n")
  if (lines[0].trim() === "---" && lines.findIndex((l, i) => i > 0 && l.trim() === "---") > 0) {
    return [lines[0], paths, ...lines.slice(1)].join("\n")
  }
  return `---\n${paths}\n---\n${text}`
}

const sha256 = data => crypto.createHash("sha256").update(data).digest("hex")

// a file's sha256, hashed again only when its size or mtime moves
const hashes = new Map()

function fileHash(full, st = fs.statSync(full)) {
  const c = hashes.get(full)
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.hash
  const hash = sha256(fs.readFileSync(full))
  hashes.set(full, { size: st.size, mtime: st.mtimeMs, hash })
  return hash
}

// a rule file, rules/**/*.md, whose `paths:` entry each PC fits to its repository
const isRule = rel => /^rules\/.+\.md$/.test(rel)

// a catalog or rules file's hash: LF line endings, and for a rule file
// without the `paths:` entry.
function bodyHash(rel, buf) {
  const text = String(buf).replace(/\r\n/g, "\n")
  return sha256(isRule(rel) ? body(text) : text)
}

// one hash for a set of files, given as { rel: hash }
function treeDigest(files) {
  const lines = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(rel => `${rel}\0${files[rel]}\n`)
  return sha256(lines.join(""))
}

// one path segment: no ".", "..", separator, ":" or NUL
const NAME_OK = s => s !== "" && s !== "." && s !== ".." && !/[\\/:\0]/.test(s)

// a relative path with / separators whose every segment passes NAME_OK
const safeRel = rel => typeof rel === "string" && rel.split("/").every(NAME_OK)

// a run's retro file, in the order the runs wrote it over time
const RETRO_NAMES = ["agent/retro.md", "retro.md", "7-retro.md"]

// how many candidates of a retro are still open (상태: 후보 or 채택)
const retroOpen = text => text.split("\n").filter(l => /^상태:\s*(후보|채택)\s*$/.test(l.replace(/\r$/, ""))).length

// two copies of a retro whose 상태 lines alone differ, merged by the rule of
// .claude/skills/learn/retro-sync.mjs: a closed status beats an open one
// (후보, 채택), 채택 beats 후보, and theirs wins when both are closed. null
// when other text differs too.
function retroMerge(mine, theirs) {
  const shape = t => t.split("\n").map(l => (l.startsWith("상태:") ? "상태:" : l.replace(/\r$/, ""))).join("\n")
  if (shape(mine) !== shape(theirs)) return null
  const open = l => /^상태:\s*(후보|채택)\s*$/.test(l)
  const ours = mine.split("\n").map(l => l.replace(/\r$/, ""))
  return theirs.split("\n").map((line, i) => {
    const t = line.replace(/\r$/, "")
    const m = ours[i]
    if (!t.startsWith("상태:") || m === t) return line
    const pick = open(m) && open(t) ? (/채택/.test(m) ? m : t) : open(m) ? t : open(t) ? m : t
    return pick + (line.endsWith("\r") ? "\r" : "")
  }).join("\n")
}

// this PC's name, in the hook's order (syncOf, hostOf in hooks/register.ts):
// COMPUTERNAME, HOSTNAME, then on a Mac LocalHostName, then `hostname`.
function pcName(env = process.env, run = argv => execFileSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })) {
  if (env.COMPUTERNAME) return env.COMPUTERNAME
  if (env.HOSTNAME) return env.HOSTNAME
  for (const argv of [["scutil", "--get", "LocalHostName"], ["hostname"]]) {
    try {
      const name = String(run(argv)).trim()
      if (name !== "") return name
    } catch {}
  }
  return "unknown"
}

module.exports = { pathsBlock, body, withPaths, sha256, hashes, fileHash, isRule, bodyHash, treeDigest, NAME_OK, safeRel, RETRO_NAMES, retroOpen, retroMerge, pcName }
