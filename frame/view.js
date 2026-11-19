// The Rein frame's view of one root: it reads the runs under it and serves
// the page, the run list, the run files and the change events.
//
//   makeView({ root, readOnly, recordOf, debounceMs, extra, opener })
//
// readOnly refuses checklist writes and opening files; opener(full) opens a
// file on this PC (openFile unless given); recordOf(project, slug) gives a run's
// record, whose pc the run list then carries; extra() gives more fields of
// the run list.
//
// Zero dependencies; Node 18 or later.
"use strict"

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { NAME_OK } = require("./text.js")

const STATES = ["active", "complete", "defer", "drop"]
const DEBOUNCE_MS = 200
const HEARTBEAT_MS = 25 * 1000

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/md.js": ["md.js", "text/javascript; charset=utf-8"],
  "/mascot.js": ["mascot.js", "text/javascript; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
}

const TYPES = {
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".log": "text/plain; charset=utf-8",
}
// shown in the browser; anything else is a download.
const INLINE = new Set([".md", ".txt", ".log", ".html", ".htm", ".json", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"])
// a run's page or picture may carry scripts: they run in a sandbox with an
// origin of their own, so they cannot call this server's API as the page
const SANDBOX = new Set([".html", ".htm", ".svg"])
const SANDBOX_CSP = "sandbox allow-scripts allow-popups"
// opened on this PC, by the program the OS gives the type; only types that
// carry no code a click would run
const OPEN = new Set([".xlsx", ".xls", ".csv", ".sql", ".docx", ".pptx"])

// ---------- reading runs ----------

function isDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }) } catch { return [] }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null }
}

// trace files in the order they were written: trace.jsonl, trace-2.jsonl, ...
// Older runs kept them at the run root instead of agent/.
function traceFiles(runDir) {
  for (const dir of [path.join(runDir, "agent"), runDir]) {
    const names = listDir(dir)
      .filter(d => d.isFile() && /^trace(-\d+)?\.jsonl$/.test(d.name))
      .map(d => d.name)
    if (names.length === 0) continue
    const num = n => (n === "trace.jsonl" ? 1 : Number(n.slice(6, -6)))
    return names.sort((a, b) => num(a) - num(b)).map(n => path.join(dir, n))
  }
  return []
}

// what a trace file says about stages, read incrementally: a trace grows by
// a line per tool call, and only its stage moves matter here.
const traceCache = new Map()

function scanTrace(file) {
  let st
  try { st = fs.statSync(file) } catch { return { open: null, moves: [] } }
  let c = traceCache.get(file)
  if (!c || st.size < c.offset) c = { offset: 0, open: null, load: null, moves: [] }
  if (st.size > c.offset) {
    const fd = fs.openSync(file, "r")
    try {
      const buf = Buffer.alloc(st.size - c.offset)
      fs.readSync(fd, buf, 0, buf.length, c.offset)
      const end = buf.lastIndexOf(10)
      if (end >= 0) {
        for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
          const isStage = line.includes('"ev":"stage"')
          if (!isStage && (c.open !== null || !line.includes('"ev":"load"'))) continue
          let e
          try { e = JSON.parse(line) } catch { continue }
          if (e.ev === "load" && c.open === null) {
            c.open = e.t
            // where the run's worktree is; runs before worktrees have none of these
            c.load = { worktree: e.worktree ?? null, branch: e.branch ?? null, start: "start" in e ? e.start ?? "detached" : null }
          }
          if (e.ev === "stage") c.moves.push({ t: e.t, from: e.from ?? null, to: e.to ?? null })
        }
        c.offset += end + 1
      }
    } finally {
      fs.closeSync(fd)
    }
  }
  traceCache.set(file, c)
  return c
}

const SHORT = { "qa-integration": "qa-int" }

// the stage the trace ends in, when each stage was last entered, when the run
// opened and when it closed.
function traceInfo(runDir) {
  let open = null
  let load = null
  const moves = []
  for (const f of traceFiles(runDir)) {
    const c = scanTrace(f)
    if (open === null) { open = c.open; load = c.load }
    moves.push(...c.moves)
  }
  const stages = {}
  let stage = null
  let closed = null
  for (const m of moves) {
    if (m.to === null) { closed = m.t; continue }
    if (m.to !== m.from) stages[SHORT[m.to] ?? m.to] = m.t
    stage = m.to
  }
  return { opened: open ?? (moves[0] ? moves[0].t : null), closed, stage, stages, load }
}

// ---------- the run summary: 1-spec.md, 2-plan.md and the trace's load line ----------

// a file's parse, done again only when its mtime or size moves
const parseCache = new Map()

function parsed(file, parse) {
  let st
  try { st = fs.statSync(file) } catch { return null }
  const c = parseCache.get(file)
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.val
  let val = null
  try { val = parse(fs.readFileSync(file, "utf8")) } catch {}
  parseCache.set(file, { mtime: st.mtimeMs, size: st.size, val })
  return val
}

const FENCE = /^\s*(`{3,}|~{3,})/
const QMARK = /^\(미해결 질문\)\s*/

// the lines under "## <name>" up to the next heading, fenced code left out
function section(lines, name) {
  const out = []
  let on = false
  let fence = false
  for (const l of lines) {
    if (FENCE.test(l)) { fence = !fence; continue }
    if (fence) continue
    if (/^#{1,2}\s/.test(l)) {
      if (on) break
      on = l.replace(/^#+\s+/, "").trim() === name
    } else if (on) out.push(l)
  }
  return out
}

function parseSpec(src) {
  const lines = src.split(/\r?\n/)
  const fm = {}
  let body = lines
  if (lines[0] && lines[0].trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---")
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^([^:\s][^:]*):\s*(.*)$/.exec(l)
        if (m) fm[m[1].trim()] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2").trim()
      }
      body = lines.slice(end + 1)
    }
  }
  let title = null
  let fence = false
  for (const l of body) {
    if (FENCE.test(l)) { fence = !fence; continue }
    const m = !fence && /^#\s+(.*?)\s*#*\s*$/.exec(l)
    if (m) { title = m[1]; break }
  }
  const questions = section(body, "미해결 질문")
    .map(l => /^[-*+]\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map(m => m[1].replace(/^\[\?\]\s*/, "").trim())
    .filter(q => q && q !== "없음")
  return { title, goal: fm["목표"] || null, ref: fm["참조"] || null, questions }
}

// the cells of a markdown table row; a | inside backticks or after \ is text
function cells(row) {
  let t = row.trim()
  if (t.startsWith("|")) t = t.slice(1)
  const out = []
  let cur = ""
  let tick = 0
  for (let k = 0; k < t.length; k++) {
    const ch = t[k]
    if (ch === "\\" && t[k + 1] === "|") { cur += "|"; k++; continue }
    if (ch === "`") {
      let n = 1
      while (t[k + n] === "`") n++
      if (tick === 0) tick = n
      else if (tick === n) tick = 0
      cur += t.slice(k, k + n)
      k += n - 1
      continue
    }
    if (ch === "|" && tick === 0) { out.push(cur.trim()); cur = ""; continue }
    cur += ch
  }
  if (cur.trim() !== "") out.push(cur.trim())
  return out
}

// the rows of the "## 결정 사항" table whose 근거 starts with "가정:"
function parsePlan(src) {
  const rows = section(src.split(/\r?\n/), "결정 사항").filter(l => /^\s*\|/.test(l))
  if (rows.length < 2) return []
  const head = cells(rows[0])
  const col = (name, dflt) => (head.includes(name) ? head.indexOf(name) : dflt)
  const [d, c, why] = [col("결정", 0), col("채택", 1), col("근거", 2)]
  return rows.slice(1)
    .filter(r => !/^\s*\|?\s*:?-{2,}/.test(r))
    .map(cells)
    .filter(r => /^가정\s*[:：]/.test(r[why] || ""))
    .map(r => ({ decision: (r[d] || "").replace(QMARK, ""), choice: r[c] || "" }))
}

// a question and a 결정 cell are the same once spacing and end punctuation
// are gone, or when one holds the other (the planner shortens a question or
// splits one into two rows)
const norm = s => s.replace(/\s+/g, " ").replace(/[\s.?？]+$/, "").trim()
const sameQ = (q, d) => q === d || (Math.min(q.length, d.length) >= 4 && (q.includes(d) || d.includes(q)))

// <repo>/.claude/worktrees/<runId> -> <repo folder name>
function repoOf(worktree) {
  const parts = worktree.split(/[\\/]+/).filter(Boolean)
  const k = parts.lastIndexOf("worktrees")
  return k >= 2 && parts[k - 1] === ".claude" ? parts[k - 2] : null
}

// <repo path> -> its folder name
const baseName = repo => repo.split(/[\/]+/).filter(Boolean).pop() || repo

// where the run works: the trees the hook last wrote to frame.json (every
// repository plan named), else the trace's load line (the session root's)
function treesOf(frame, load) {
  if (frame && Array.isArray(frame.trees) && frame.trees.length)
    return frame.trees.map(t => ({ repo: baseName(t.repo), base: t.start ?? "detached", branch: t.branch }))
  if (load && load.worktree) return [{ repo: repoOf(load.worktree), base: load.start, branch: load.branch }]
  return []
}

// what the status card says about a run whatever artifact is open
function summary(runDir, load, frame) {
  const first = names => names.map(n => path.join(runDir, n)).find(f => fs.existsSync(f))
  const specFile = first(["1-spec.md", "spec.md"])
  const planFile = first(["2-plan.md", "plan.md"])
  const spec = (specFile && parsed(specFile, parseSpec)) || { title: null, goal: null, ref: null, questions: [] }
  const rows = (planFile && parsed(planFile, parsePlan)) || []
  const questions = spec.questions.map(q => ({ q, a: [] }))
  const assumptions = []
  for (const r of rows) {
    const hit = questions.find(x => sameQ(norm(x.q), norm(r.decision)))
    if (hit) hit.a.push(r.choice)
    else assumptions.push({ q: r.decision, a: r.choice })
  }
  return {
    title: spec.title,
    goal: spec.goal,
    ref: spec.ref,
    trees: treesOf(frame, load),
    questions,
    assumptions,
    assumed: rows.length,
  }
}

// run subfolders whose files the person reads: planning documents copied at
// spec, and files handed over at land. Listed as "<folder>/<file>".
const SUBS = ["brief", "handoff"]

function rootFiles(runDir) {
  const out = []
  const add = (dir, prefix) => {
    for (const d of listDir(dir)) {
      if (!d.isFile()) continue
      try {
        const st = fs.statSync(path.join(dir, d.name))
        out.push({ name: prefix + d.name, size: st.size, mtime: Math.round(st.mtimeMs) })
      } catch {}
    }
  }
  add(runDir, "")
  for (const sub of SUBS) add(path.join(runDir, sub), sub + "/")
  return out.sort((a, b) => (a.name < b.name ? -1 : 1))
}

// ---------- serving ----------

function send(res, code, type, body) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" })
  res.end(body)
}

const json = (res, code, obj) => send(res, code, "application/json; charset=utf-8", JSON.stringify(obj))

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0
    const chunks = []
    req.on("data", c => {
      n += c.length
      if (n > limit) { reject(new Error("too large")); req.destroy() } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

const BOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/

// an evidence folder as a page of links to its files and folders
function serveDir(res, f, urlPath) {
  const base = urlPath.replace(/\/+$/, "")
  const rows = listDir(f.full)
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(d => {
      const n = d.name + (d.isDirectory() ? "/" : "")
      return `<li><a href="${base}/${encodeURIComponent(d.name)}">${n.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)}</a></li>`
    })
  const title = f.file.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
  send(res, 200, "text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:13px ui-monospace,Consolas,monospace;padding:16px"><ul>${rows.join("")}</ul>`)
}

// a file's bytes with headers; missing() answers when it cannot be opened
// (gone since it was looked at). A read failing later cuts the answer.
function streamFile(res, full, headers, missing) {
  const s = fs.createReadStream(full)
  s.on("open", () => {
    res.writeHead(200, headers)
    s.pipe(res)
  })
  s.on("error", () => {
    if (res.headersSent) res.destroy()
    else missing()
  })
}

function serveFile(res, f) {
  const ext = path.extname(f.file).toLowerCase()
  const headers = { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store", "last-modified": f.mtime.toUTCString(), "x-content-type-options": "nosniff" }
  if (!INLINE.has(ext)) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(f.file)}`
  if (SANDBOX.has(ext)) headers["content-security-policy"] = SANDBOX_CSP
  streamFile(res, f.full, headers, () => send(res, 404, "text/plain", "not found"))
}

// the file opened by the program the OS gives its type, not waited for. On
// Windows the path goes through the environment to the shell's own open:
// explorer.exe splits it at commas, and cmd's start reads & and ^ in it.
function openFile(full) {
  const [cmd, args] = process.platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[void][Diagnostics.Process]::Start($env:REIN_OPEN)"]]
    : process.platform === "darwin" ? ["open", [full]]
    : ["xdg-open", [full]]
  // not detached: a detached PowerShell starts no program (Excel stayed shut)
  const c = spawn(cmd, args, { stdio: "ignore", windowsHide: true, env: { ...process.env, REIN_OPEN: full } })
  c.on("error", () => {})
  c.unref()
}

function makeView({ root, readOnly = false, recordOf = null, debounceMs = DEBOUNCE_MS, extra = null, opener = openFile }) {
  const ROOT = path.resolve(root)

  // a project is a folder directly under the root with a run state folder.
  function projects() {
    return listDir(ROOT)
      .filter(d => d.isDirectory() && STATES.some(s => isDir(path.join(ROOT, d.name, s))))
      .map(d => d.name)
      .sort()
  }

  function runOf(project, state, slug) {
    const runDir = path.join(ROOT, project, state, slug)
    const trace = traceInfo(runDir)
    // a closed run's frame.json is its last, so only its trees still hold
    const last = readJson(path.join(runDir, "agent", "frame.json"))
    const frame = state === "active" ? last : null
    const run = {
      project,
      slug,
      state,
      stage: (frame && frame.stage) || trace.stage,
      frame,
      opened: trace.opened,
      closed: trace.closed,
      stages: trace.stages,
      summary: summary(runDir, trace.load, last),
      // what land commits; kept after the run closes, with the commit's result
      land: readJson(path.join(runDir, "agent", "land.json")),
      files: rootFiles(runDir),
    }
    if (recordOf) run.pc = (recordOf(project, slug) || {}).pc ?? null
    return run
  }

  function snapshot() {
    return {
      projects: projects().map(name => ({
        name,
        runs: STATES.flatMap(state =>
          listDir(path.join(ROOT, name, state))
            .filter(d => d.isDirectory())
            .map(d => runOf(name, state, d.name)),
        ),
      })),
    }
  }

  function anyActive() {
    return projects().some(p => listDir(path.join(ROOT, p, "active")).some(d => d.isDirectory()))
  }

  // the run folder and file a /files/<project>/<state>/<slug>/<path> URL names,
  // or null when the path is not one the page may open: a file at the run's
  // root, in brief/ or handoff/, agent/e2e.md, or anything under
  // agent/evidence/ (a folder there is listed).
  function filePath(urlPath) {
    const parts = urlPath.slice("/files/".length).split("/")
    if (parts.length < 4) return null
    let dec
    try { dec = parts.map(decodeURIComponent) } catch { return null }
    const [project, state, slug, ...rest] = dec
    if (!dec.every(NAME_OK) || !STATES.includes(state)) return null
    const ok = rest.length === 1 ? rest[0] !== "agent"
      : rest.length === 2 && SUBS.includes(rest[0]) ? true
      : rest[0] === "agent" && (rest.length === 2 ? rest[1] === "e2e.md" : rest[1] === "evidence")
    if (!ok) return null
    const runDir = path.resolve(ROOT, project, state, slug)
    const full = path.resolve(runDir, ...rest)
    if (!full.startsWith(runDir + path.sep) || path.dirname(path.dirname(path.dirname(runDir))) !== ROOT) return null
    let st
    try { st = fs.statSync(full) } catch { return null }
    const dir = st.isDirectory()
    if (!st.isFile() && !(dir && rest[1] === "evidence")) return null
    return { runDir, full, file: rest[rest.length - 1], dir, mtime: st.mtime }
  }

  // toggle one checkbox line of a run's 5-checklist.md, if that line still
  // reads as the page saw it.
  async function checklist(req, res) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) return json(res, 415, { error: "json only" })
    let b
    try { b = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: "bad body" }) }
    const { project, state, slug, line, text, checked } = b || {}
    if (![project, state, slug].every(s => typeof s === "string" && NAME_OK(s)) || !STATES.includes(state)) return json(res, 400, { error: "bad run" })
    if (!Number.isInteger(line) || line < 1 || typeof text !== "string" || typeof checked !== "boolean") return json(res, 400, { error: "bad line" })
    const file = path.join(ROOT, project, state, slug, "5-checklist.md")
    let src
    try { src = fs.readFileSync(file, "utf8") } catch { return json(res, 404, { error: "no checklist" }) }
    const parts = src.split(/(\r?\n)/)
    const i = (line - 1) * 2
    if (i >= parts.length || parts[i] !== text) return json(res, 409, { error: "the line changed" })
    const m = BOX.exec(text)
    if (!m) return json(res, 409, { error: "not a checkbox line" })
    parts[i] = `${m[1]}[${checked ? "x" : " "}]${m[3]}`
    fs.writeFileSync(file, parts.join(""))
    json(res, 200, { ok: true, text: parts[i] })
  }

  // open a run file the page names by its /files/ URL on this PC
  async function open(req, res) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) return json(res, 415, { error: "json only" })
    let b
    try { b = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: "bad body" }) }
    const file = b && b.file
    const f = typeof file === "string" && file.startsWith("/files/") ? filePath(file) : null
    if (!f || f.dir) return json(res, 404, { error: "no file" })
    if (!OPEN.has(path.extname(f.file).toLowerCase())) return json(res, 400, { error: "not a type this opens" })
    opener(f.full)
    json(res, 200, { ok: true })
  }

  const clients = new Set()

  function broadcast() {
    for (const res of clients) res.write("event: change\ndata: {}\n\n")
  }

  function events(req, res) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" })
    res.write("retry: 2000\n\n")
    clients.add(res)
    const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS)
    req.on("close", () => {
      clearInterval(beat)
      clients.delete(res)
    })
  }

  // the page's routes; the server checks Host and Origin before this.
  async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://x")
      const p = url.pathname
      if (req.method === "POST" && p === "/api/checklist") {
        // only the run's own PC writes its folder
        if (readOnly) return send(res, 405, "text/plain", "read only")
        return await checklist(req, res)
      }
      if (req.method === "POST" && p === "/api/open") {
        // the file is on the PC that serves the page, not the one viewing it
        if (readOnly) return send(res, 405, "text/plain", "read only")
        return await open(req, res)
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "method not allowed")
      if (p === "/api/runs") return json(res, 200, { now: Date.now(), ...(extra ? extra() : {}), ...snapshot() })
      if (p === "/api/events") return events(req, res)
      if (p.startsWith("/files/")) {
        const f = filePath(p)
        if (!f) return send(res, 404, "text/plain", "not found")
        return f.dir ? serveDir(res, f, p) : serveFile(res, f)
      }
      const s = STATIC[p]
      if (s) return send(res, 200, s[1], fs.readFileSync(path.join(__dirname, s[0])))
      send(res, 404, "text/plain", "not found")
    } catch (e) {
      if (!res.headersSent) send(res, 500, "text/plain", String(e && e.message))
    }
  }

  // watch the whole root but frame/ and .hub/ (the servers' own files); on a
  // change that alters what /api/runs shows, tell the pages. A trace grows
  // with every tool call, so compare snapshots instead of signalling every
  // write. onName(name) hears every change, name null when unknown.
  function watch(onName = () => {}) {
    let timer = null
    let last = JSON.stringify(snapshot())
    const own = [path.join("frame") + path.sep, ".hub" + path.sep]
    const fire = () => {
      timer = null
      const now = JSON.stringify(snapshot())
      if (now === last) return
      last = now
      broadcast()
    }
    const start = () => {
      try {
        const w = fs.watch(ROOT, { recursive: true }, (_, name) => {
          if (name && own.some(dir => (String(name) + path.sep).startsWith(dir))) return
          onName(name ? String(name) : null)
          if (timer) clearTimeout(timer)
          timer = setTimeout(fire, debounceMs)
        })
        w.on("error", () => {
          w.close()
          setTimeout(start, 1000)
        })
      } catch {
        setTimeout(start, 1000)
      }
    }
    start()
  }

  return { root: ROOT, clients, runOf, snapshot, anyActive, handle, watch, broadcast }
}

module.exports = { makeView, send, json, streamFile, readJson, listDir, STATES }
