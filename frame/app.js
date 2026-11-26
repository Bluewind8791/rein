// The Rein frame page: run tabs, the status card and stage timeline of the
// open run, and the artifact picked from it. Data comes from /api/runs and
// is fetched again whenever /api/events says something changed.
"use strict"

const CHAIN = ["spec", "plan", "dev", "review", "qa", "e2e", "land"]
const KO = { spec: "명세", plan: "설계", dev: "구현", review: "리뷰", qa: "검증", e2e: "통합 확인", land: "반영" }
const STATUS = { run: "진행 중", ask: "질문 대기", halt: "멈춤", done: "완료", defer: "보류", drop: "버림" }
const TAB_ST = { ask: "질문", halt: "멈춤" }
const ANIM = { run: "walk", ask: "idle", halt: "halt", done: "done", defer: "still", drop: "still" }
const CARD = { run: "", ask: "ask", halt: "halt", done: "done", defer: "held", drop: "held" }
// files every run is expected to write, shown dimmed until they exist
const EXPECTED = { "1-spec": "spec", "2-plan": "plan", "5-checklist": "e2e", "6-land": "land" }
const NUM_STAGE = { 1: "spec", 2: "plan", 3: "dev", 4: "review", 5: "qa", 6: "land", 7: "land" }
// runs opened before the numbered names kept these at the root
const LEGACY = { spec: "spec", plan: "plan", dev: "dev", "qa-integration": "e2e", land: "land" }
const AGENT_FILE = /^(grade|review(-\d+|-groups)?|qa|e2e|test-plan|dev-items|dev-diff|deviation|retro|land-review)$/
const GROUPS = [["active", "진행 중"], ["complete", "완료"], ["defer", "보류"], ["drop", "버림"]]
const VIEWABLE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "svg", "webp", "txt", "json"])
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"])
// what the server opens on this PC (view.js OPEN)
const OPENABLE = new Set(["xlsx", "xls", "csv", "sql", "docx", "pptx"])
// run subfolders and the stage each belongs to
const SUB_STAGE = { brief: "spec", handoff: "land" }
// the location hash of the all-runs page
const RUNS_HASH = "~runs"
// cards a group of the all-runs page shows before 더 보기
const LIST_MAX = 6

const $ = (id) => document.getElementById(id)
const esc = Md.esc
const enc = encodeURIComponent
const shortOf = (s) => (s === "qa-integration" ? "e2e" : s)

let data = null // [{ name, runs: [run] }]
let skew = 0 // server clock minus ours
let ro = false // the hub's page: read only, and each run names its PC
let hub = null // a local page's uploader status (/api/runs hub); null without a server
// list: the all-runs page instead of a run
let sel = readHash() // { project, slug, key, view, side, list }
let lastRun = null // the run selection the all-runs page was opened from
// the all-runs page: the state its cards are filtered to, and the groups shown whole
const rv = { filter: null, more: new Set() }
let sideAt = { page: null, req: null } // the PDF page and the 요구사항 row the right tab was opened for
const sideOff = new Set() // "<project>/<slug>" of runs whose right tab the person closed
let fav = "done"
let shown = null // { id, sig } of what the right pane shows
const openQ = new Set() // "<project>/<slug>" of runs whose open questions are unfolded
let doc = null // { src, run } of the markdown on screen
let drawn = null // { run, a, src, plan } of the spec or land view on screen
let ui = {} // what the person picked in the drawn view: tab, page, row, filter, why
const folded = { active: false, complete: false, defer: true, drop: true }
// 1-mockup.html is shown with the planning documents on its left. The
// explorer stays open until the person folds it into a rail.
// mockShow: the part of each screen shown.
let railFold = false
let mockShow = "after" // "before" | "after" | "both"
const isMock = (run) => !!run && sel.key === "1-mockup"

// what this browser remembers: the theme, the run tabs, the open editor tabs
// of each run and whether the comment panel is closed; storage may be blocked
const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
let theme = lsGet("rein.theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
document.documentElement.dataset.theme = theme
// "<project>/<slug>" -> the artifact keys open as editor tabs, in order
const etabs = (() => { try { return new Map(Object.entries(JSON.parse(lsGet("rein.etabs") || "{}"))) } catch { return new Map() } })()
// the run tabs: open, the "<project>/<slug>" of the runs open as tabs, in
// order; shut, the active runs whose tab the person closed, each with the
// status it was last seen in, so that it opens again when the run starts
// asking or halts
const rtabs = (() => {
  try {
    const j = JSON.parse(lsGet("rein.rtabs") || "{}")
    return { open: Array.isArray(j.open) ? j.open : [], shut: j.shut && typeof j.shut === "object" ? j.shut : {} }
  } catch { return { open: [], shut: {} } }
})()
const saveRtabs = () => lsSet("rein.rtabs", JSON.stringify(rtabs))
let cpOff = lsGet("rein.cpoff") === "1"
// "<project>/<slug>|<stage>" -> whether the person unfolded (true) or folded (false) that stage in the explorer
const stgOpen = new Map()

// ---------- location hash: #<project>/<slug>/<artifact>[/md][&r=<artifact on the right>] ----------
// the all-runs page: #~runs (RUNS_HASH)

function readHash() {
  const de = (s) => {
    try { return decodeURIComponent(s) } catch { return "" }
  }
  const [main, r] = location.hash.slice(1).split("&r=")
  if (main === RUNS_HASH) return { project: null, slug: null, key: null, view: null, side: null, list: true }
  const p = main.split("/").map(de)
  return { project: p[0] || null, slug: p[1] || null, key: p[2] || null, view: p[3] === "md" || p[3] === "html" ? p[3] : null, side: r ? de(r) || null : null, list: false }
}

function writeHash() {
  if (sel.list) {
    if (location.hash !== "#" + RUNS_HASH) history.replaceState(null, "", "#" + RUNS_HASH)
    return
  }
  if (!sel.project || !sel.slug) return
  const h = "#" + [sel.project, sel.slug, sel.key || ""].map(enc).join("/") + (sel.view ? "/" + sel.view : "") + (sel.side ? "&r=" + enc(sel.side) : "")
  if (location.hash !== h) history.replaceState(null, "", h)
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, "0")

function fmtDate(t) {
  const d = new Date(t)
  if (isNaN(d)) return ""
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (s < 60) return `${s}초째`
  if (m < 60) return `${m}분 ${s % 60}초째`
  if (h < 24) return `${h}시간 ${m % 60}분째`
  return `${d}일 ${h % 24}시간째`
}

// how long a run has been open: N일째, N시간째, N분째
function fmtAge(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d > 0 ? `${d}일째` : h > 0 ? `${h}시간째` : `${m}분째`
}

// how long a closed run took
function fmtSpan(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d > 0 ? `${d}일 ${h % 24}시간` : h > 0 ? `${h}시간 ${m % 60}분` : `${m}분`
}

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60)
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------- runs ----------

function artifacts(r) {
  const map = new Map()
  for (const f of r.files) {
    const dot = f.name.lastIndexOf(".")
    const ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase() : ""
    const base = dot > 0 ? f.name.slice(0, dot) : f.name
    const slash = f.name.indexOf("/")
    if (slash > 0) {
      const sub = f.name.slice(0, slash)
      const a = { key: f.name, stage: SUB_STAGE[sub] || "other", sub, label: f.name.slice(slash + 1), mtime: f.mtime }
      // a markdown or HTML file is shown like one at the root, not downloaded
      if (ext === "md") a.md = f
      else if (ext === "html") a.html = f
      else { a.file = f; a.ext = ext }
      map.set(f.name, a)
      continue
    }
    const twin = ext === "md" || ext === "html"
    if (ext === "jsonl" || ext === "log" || ext === "json" || (twin && AGENT_FILE.test(base))) continue
    const num = /^(\d)-/.exec(f.name)
    let stage
    if (/^5-checklist\./.test(f.name)) stage = "e2e"
    else if (num) stage = NUM_STAGE[num[1]] || "other"
    else if (ext === "xlsx") stage = "e2e"
    else if (twin && LEGACY[base]) stage = LEGACY[base]
    else stage = "other"
    const key = twin ? base : f.name
    let a = map.get(key)
    if (!a) map.set(key, (a = { key, stage, label: twin ? base : base.replace("_" + r.slug, ""), mtime: 0 }))
    if (ext === "md") a.md = f
    else if (ext === "html") a.html = f
    else { a.file = f; a.ext = ext }
    a.mtime = Math.max(a.mtime, f.mtime)
  }
  if (r.state === "active") {
    for (const [key, stage] of Object.entries(EXPECTED)) if (!map.has(key)) map.set(key, { key, stage, label: key, none: true, mtime: 0 })
  }
  // the comments on 1-mockup.html not yet reflected
  const mock = map.get("1-mockup")
  if (mock) mock.cn = (r.comments || []).filter((c) => c && (c.status === "draft" || c.status === "sent")).length
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
}

function decorate(project, r) {
  const status = r.state === "active" ? (r.frame && r.frame.state) || "run" : r.state === "complete" ? "done" : r.state
  const stage = shortOf(r.stage) || "spec"
  const idx = CHAIN.indexOf(stage)
  const view = r.state === "active" && r.frame && r.frame.view
  let tones
  if (view && view.stages && view.stages.length) tones = Object.fromEntries(view.stages.map((s) => [s.name, s.tone]))
  else {
    const cur = r.state === "active" ? (status === "halt" ? "bad" : "now") : "held"
    tones = Object.fromEntries(CHAIN.map((s, i) => [s, r.state === "complete" || i < idx ? "done" : i > idx ? "wait" : cur]))
  }
  const touched = Math.max(Date.parse(r.closed || r.opened) || 0, ...r.files.map((f) => f.mtime))
  return { ...r, project, status, stageShort: stage, tones, view: view || null, arts: artifacts(r), touched }
}

const allRuns = () => (data ? data.flatMap((p) => p.runs) : [])
const findRun = (project, slug) => allRuns().find((r) => r.project === project && r.slug === slug)
const activeRuns = () => allRuns().filter((r) => r.state === "active").sort((a, b) => (Date.parse(a.opened) || 0) - (Date.parse(b.opened) || 0))
const newest = (rs) => rs.slice().sort((a, b) => b.touched - a.touched)[0]
const runId = (r) => `${r.project}/${r.slug}`
const runById = () => new Map(allRuns().map((r) => [runId(r), r]))
const openRuns = () => {
  const m = runById()
  return rtabs.open.map((id) => m.get(id)).filter(Boolean)
}

// bring the run tabs up to date with the runs: a run gone from the list loses
// its tab, an active run not seen before gets one, and a closed tab opens
// again when its run starts asking or halts. A run that leaves active is
// forgotten, so it gets a tab again when it is resumed.
const WAITS = new Set(["ask", "halt"])
function syncRtabs() {
  const m = runById()
  const open = rtabs.open.filter((id) => m.has(id))
  const shut = {}
  for (const r of activeRuns()) {
    const id = runId(r)
    if (open.includes(id)) continue
    const was = rtabs.shut[id]
    if (was === undefined || (WAITS.has(r.status) && !WAITS.has(was))) open.push(id)
    else shut[id] = r.status
  }
  const next = { open, shut }
  if (JSON.stringify(next) === JSON.stringify(rtabs)) return
  rtabs.open = open
  rtabs.shut = shut
  saveRtabs()
}

// the run shown always has a tab
function openRtab(run) {
  const id = runId(run)
  if (rtabs.open.includes(id)) return
  rtabs.open.push(id)
  delete rtabs.shut[id]
  saveRtabs()
}

// close a run tab; when it is the run shown, its neighbor is shown instead,
// and the all-runs page when no tab is left
function closeRtab(id) {
  const i = rtabs.open.indexOf(id)
  if (i < 0) return
  rtabs.open.splice(i, 1)
  const r = runById().get(id)
  if (r && r.state === "active") rtabs.shut[id] = r.status
  saveRtabs()
  if (sel.list || id !== `${sel.project}/${sel.slug}`) return renderTop(findRun(sel.project, sel.slug), openRuns())
  const near = runById().get(rtabs.open[Math.min(i, rtabs.open.length - 1)])
  if (near) return pick(near.project, near.slug)
  lastRun = null
  sel = { project: null, slug: null, key: null, view: null, side: null, list: true }
  render()
}

function defaultKey(run) {
  const real = run.arts.filter((a) => !a.none && !a.sub)
  const upto = CHAIN.indexOf(run.stageShort)
  let pool = real.filter((a) => a.stage === run.stageShort)
  if (!pool.length) pool = real.filter((a) => CHAIN.indexOf(a.stage) >= 0 && CHAIN.indexOf(a.stage) <= upto)
  if (!pool.length) pool = real
  return pool.length ? pool.reduce((a, b) => (b.mtime > a.mtime ? b : a)).key : null
}

// the run and artifact to show, from the selection or a sensible default.
function resolve() {
  let run = sel.project && sel.slug ? findRun(sel.project, sel.slug) : null
  if (!run) {
    const proj = data.find((p) => p.name === sel.project)
    const pool = proj ? proj.runs : allRuns()
    run = openRuns().find((r) => pool.includes(r)) || newest(pool) || openRuns()[0] || newest(allRuns()) || null
    if (run && run.slug !== sel.slug) sel.key = sel.side = null
  }
  if (!run) {
    sel = { project: sel.project || (data[0] && data[0].name) || null, slug: null, key: null, view: null, side: null }
    return null
  }
  sel.project = run.project
  sel.slug = run.slug
  if (!sel.key || !run.arts.some((a) => a.key === sel.key && !a.none)) {
    sel.key = defaultKey(run)
    sel.view = null
  }
  if (sel.side && !run.arts.some((a) => a.key === sel.side && !a.none)) sel.side = null
  return run
}

// ---------- rendering ----------

function setHTML(el, html) {
  if (el._html !== html) {
    el.innerHTML = html
    el._html = html
  }
}

// name is a path in the run folder: "1-spec.md", "brief/a.pdf", "agent/e2e.md"
const fileUrl = (run, name) => `/files/${[run.project, run.state, run.slug, ...name.split("/")].map(enc).join("/")}`
// what a link to a run file does: the local page has the server open the
// types it can on this PC; anything else, and every file on the hub's page,
// is downloaded
const fileAct = (name) => (!ro && OPENABLE.has(extOf(name)) ? ["data-open", "열기"] : ["download", "내려받기"])

function render() {
  const list = !!sel.list
  document.querySelector(".body").hidden = list
  $("runs").hidden = !list
  syncRtabs()
  const run = list ? null : resolve()
  if (run) openRtab(run)
  const active = activeRuns()
  fav = active.some((r) => r.status === "halt") ? "halt" : active.some((r) => r.status === "ask") ? "idle" : active.length ? "walk" : "done"
  document.title = run ? `${run.slug} · Rein` : list ? "전체 run · Rein" : "Rein"
  renderTop(run, openRuns())
  renderHub()
  renderStatus(run)
  if (list) {
    renderRuns()
    writeHash()
    return tick()
  }
  const mock = isMock(run)
  const key = mock ? `${run.project}/${run.slug}` : null
  if (cm.key !== key) {
    clearTimeout(cm.timer)
    cm = freshCm(key)
  }
  const railed = railFold
  document.querySelector(".body").classList.toggle("railed", railed)
  $("work").classList.toggle("left", mock)
  $("work").classList.toggle("nocp", mock && cpOff)
  if (run) keepTab(run)
  renderLeft(run, railed)
  if (mock) autoSide(run)
  renderMain(run)
  renderSide(run)
  renderPanel(run, mock)
  if (mock) {
    const a = run.arts.find((x) => x.key === "1-mockup" && x.html)
    if (a) mockScreens(run, a.html)
    sendComments(run)
    drawToggle(run)
  }
  writeHash()
  tick()
}

const ICON = {
  run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/></svg>`,
  all: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>`,
}

// the run tabs, the theme button and the icon rail: run | 전체 run
let rtabOn = null // "<project>/<slug>" of the run tab last shown as on
function renderTop(run, tabs) {
  document.querySelector(".brand").textContent = ro ? "HUB" : "REIN"
  const list = !!sel.list
  const btn = (attr, on, label, icon, count) => `<button type="button" ${attr} class="${on ? "on" : ""}" title="${label}" aria-label="${label}">${icon}${count ? `<span class="n">${count}</span>` : ""}</button>`
  setHTML($("arail"), btn(`data-mode="run"`, !list, "run", ICON.run, 0) +
    btn(`data-allruns`, list, `전체 run ${allRuns().length}`, ICON.all, allRuns().length))
  setHTML($("tabs"), tabs.map((r) => {
    const on = run && r.project === run.project && r.slug === run.slug ? " on" : ""
    const label = r.state === "active" ? TAB_ST[r.status] || r.stageShort : STATUS[r.status]
    return `<div class="rtab${on}" data-p="${esc(r.project)}" data-s="${esc(r.slug)}" title="${esc(r.project)} / ${esc(r.slug)} · ${STATUS[r.status]}${r.pc ? ` · ${esc(r.pc)}` : ""}">` +
      `<span class="d ${r.status}"></span><span>${esc(r.slug)}</span><span class="st ${r.status}">${r.pc ? `${esc(r.pc)} · ` : ""}${label}</span>` +
      `<button type="button" class="x" data-rtabx="${esc(runId(r))}" aria-label="${esc(r.slug)} 닫기">×</button></div>`
  }).join(""))
  // the tab shown is scrolled into sight when it changes
  const onId = run ? runId(run) : null
  if (onId !== rtabOn) {
    rtabOn = onId
    const t = $("tabs").querySelector(".rtab.on")
    if (t) t.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  const dark = theme === "dark"
  setHTML($("theme"), `${dark ? ICON.sun : ICON.moon}${dark ? "라이트" : "다크"}`)
  $("theme").title = dark ? "라이트 모드로 전환" : "다크 모드로 전환"
}

// the status bar: the open run's stage and time, its start, and how many runs are open
function renderStatus(run) {
  const parts = []
  if (ro) parts.push(`<span>허브 · 읽기 전용</span>`)
  if (run) {
    const st = run.stageShort
    const tone = run.status === "run" ? "now" : run.status === "done" ? "done" : run.status === "ask" || run.status === "halt" ? run.status : ""
    const from = Date.parse(run.stages[st] || run.opened)
    const live = run.state === "active" && !isNaN(from)
    parts.push(`<span class="${tone}">● ${esc(st)} ${KO[st] || ""} · ${STATUS[run.status]}</span>`)
    if (live) parts.push(`<span data-from="${from}"></span>`)
    const calls = run.view ? (run.view.pills || []).filter((p) => p.pulse).length : 0
    if (calls) parts.push(`<span>실행 중 ${calls}</span>`)
    const opened = Date.parse(run.opened)
    if (!isNaN(opened)) {
      const to = Date.parse(run.closed)
      const tail = run.state === "active" ? ` · <span data-age="${opened}"></span>` : !isNaN(to) ? ` · 총 ${fmtSpan(to - opened)}` : ""
      parts.push(`<span>시작 ${fmtDate(opened)}${tail}</span>`)
    }
  } else if (sel.list) parts.push(`<span>전체 run ${allRuns().length}</span>`)
  parts.push(`<span>진행 중 run ${activeRuns().length}</span>`)
  setHTML($("sinfo"), parts.join(""))
}

// the local page's badge of the hub server: reached, sending, or not reached
// with what waits; a red dot when runs or files disagree with the hub
function renderHub() {
  const b = $("hubst")
  b.hidden = !hub
  if (!hub) return
  const off = hub.reachable === false
  const text = off ? `서버에 닿지 않음, 미전송 ${hub.unsent}건` : hub.unsent > 0 ? `올리는 중 ${hub.unsent}건` : hub.reachable ? "서버 연결됨" : "서버 확인 중"
  const tip = [hub.server]
  if (hub.unsent > 0) tip.push(`미전송 파일 ${hub.unsent}건 · run ${hub.unsentRuns}개`)
  if (off) tip.push(`마지막 연결: ${hub.lastOkAt ? fmtDate(hub.lastOkAt) : "없음"}`)
  if (hub.error) tip.push(`오류: ${hub.error}`)
  for (const l of hub.lost) tip.push(`다른 PC가 가져간 run: ${l.project}/${l.runId} (${l.pc})`)
  for (const c of hub.collisions) tip.push(`이름이 겹친 run: ${c.project}/${c.runId} (${c.pc}의 다른 run)`)
  for (const c of hub.conflicts) tip.push(`충돌: ${c.kind} ${c.path || `${c.project}/${c.runId}`}`)
  const warn = hub.lost.length + hub.collisions.length + hub.conflicts.length > 0
  setHTML(b, `${warn ? `<span class="wd"></span>` : ""}${esc(text)}`)
  b.title = tip.join("\n")
  b.classList.toggle("off", off)
  if (hub.reachable) b.href = hub.server
  else b.removeAttribute("href")
  const go = $("hubgo")
  go.hidden = !(off && hub.canStart)
  go.disabled = Date.now() < hubStarting
  go.textContent = go.disabled ? "허브 서버 켜는 중…" : "허브 서버 켜기"
}

// until when the start button waits for the hub it started (ms)
let hubStarting = 0

// the hub PC's button: the frame server starts the hub, and the badge turns
// when the uploader reaches it
$("hubgo").addEventListener("click", async () => {
  hubStarting = Date.now() + 15000
  renderHub()
  setTimeout(renderHub, 15000)
  try {
    const res = await fetch("/api/hub/start", { method: "POST" })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    hubStarting = 0
    renderHub()
  }
})

// the all-runs page: a card per run, grouped by state, saying what each run
// was for; with more than one project (and on the hub) each card names its own
function renderRuns() {
  const runs = allRuns()
  const many = ro || data.length > 1
  const chip = (st, label, n) => `<button type="button" class="${rv.filter === st ? "on" : ""}" data-rf="${st || ""}">${label} <b>${n}</b></button>`
  const chips = chip(null, "전체", runs.length) + GROUPS.map(([st, label]) => chip(st, label, runs.filter((r) => r.state === st).length)).join("")
  const groups = GROUPS.filter(([st]) => !rv.filter || rv.filter === st).map(([st, label]) => {
    const rs = runs.filter((r) => r.state === st).sort((a, b) => b.touched - a.touched)
    // a group picked in the filter is shown open and whole
    const only = rv.filter === st
    const fold = folded[st] && !only
    const head = `<button class="rghead" type="button" data-fold="${st}" aria-expanded="${!fold}"><span class="tw">${fold ? "▸" : "▾"}</span>${label}<span class="n">${rs.length}</span></button>`
    if (fold) return `<section class="rgroup">${head}</section>`
    const shown = only || rv.more.has(st) ? rs : rs.slice(0, LIST_MAX)
    const more = rs.length > shown.length ? `<button class="rmore" type="button" data-more="${st}">${label} ${rs.length - shown.length}개 더 보기</button>` : ""
    const body = rs.length ? `<div class="rgrid">${shown.map((r) => runCard(r, many)).join("")}</div>${more}` : `<div class="rempty">없음</div>`
    return `<section class="rgroup">${head}${body}</section>`
  }).join("")
  setHTML($("runs"), `<div class="rhead"><div><h1>전체 run</h1><p>run마다 무슨 작업이었는지</p></div><div class="rfilter">${chips}</div></div>${groups}`)
}

// a line of markdown as plain text: a card is one button, with no links in it
const plain = (t) => esc(String(t).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`+/g, ""))

// what agent/land.json says land committed: files, lines and commits
function landFacts(land) {
  const repos = land && Array.isArray(land.repos) ? land.repos : []
  const files = repos.flatMap((r) => (r && Array.isArray(r.files) ? r.files : []))
  if (!files.length) return ""
  const sum = (k) => files.reduce((n, f) => n + (f && typeof f[k] === "number" ? f[k] : 0), 0)
  const commits = (land && Array.isArray(land.result) ? land.result : []).map((x) => x && x.commit).filter((c) => typeof c === "string" && c)
  return `<span>파일 ${files.length}</span><span class="add">+${sum("add")}</span><span class="del">−${sum("del")}</span>` +
    commits.map((c) => `<span class="cm">${esc(c.slice(0, 7))}</span>`).join("")
}

// one run at a glance: its title and goal; a run in progress shows its stage
// and what it waits on, a closed one what land committed and how long it took
function runCard(r, many) {
  const s = r.summary || {}
  const label = r.state === "complete" ? STATUS.done : `${STATUS[r.status]} · ${r.stageShort}`
  const pj = many ? `<span class="pj">${esc(r.project)}${r.pc ? ` · ${esc(r.pc)}` : ""}</span>` : ""
  const opened = Date.parse(r.opened)
  // every card keeps the line, empty without a reference, so cards stay even
  const ref = s.ref && s.ref !== "없음" ? plain(s.ref) : ""
  let mid = ""
  let facts
  let when
  if (r.state === "active") {
    const segs = CHAIN.map((st) => {
      const t = r.tones[st] || "wait"
      return `<span class="${t === "now" && r.status === "ask" ? "ask" : t}"></span>`
    }).join("")
    const from = Date.parse(r.stages[r.stageShort] || r.opened)
    mid = `<div class="rc-bar"><span class="segs">${segs}</span><span>${esc(r.stageShort)} ${KO[r.stageShort] || ""}${isNaN(from) ? "" : ` · <span data-age="${from}"></span>`}</span></div>`
    const qs = s.questions && s.questions.length ? [`미해결 질문 ${s.questions.length}`] : []
    const calls = r.view ? (r.view.pills || []).filter((p) => p.pulse).map((p) => `${esc(p.name)} 실행 중`) : []
    const as = s.assumed ? [`가정 ${s.assumed}`] : []
    facts = [...qs, ...calls, ...as].map((x) => `<span>${x}</span>`).join("")
    when = isNaN(opened) ? "" : `시작 ${fmtDate(opened)} · <span data-age="${opened}"></span>`
  } else {
    facts = landFacts(r.land)
    const to = Date.parse(r.closed)
    when = fmtDate(r.closed || r.touched) + (!isNaN(to) && !isNaN(opened) ? ` · ${fmtSpan(to - opened)}` : "")
  }
  return `<button class="rcard" type="button" data-p="${esc(r.project)}" data-s="${esc(r.slug)}">` +
    `<div class="rc-h"><span class="sl">${esc(r.slug)}</span>${pj}<span class="rst ${r.status}">${esc(label)}</span></div>` +
    `<div class="rc-t">${plain(s.title || r.slug)}</div>` +
    (s.goal ? `<div class="rc-g">${plain(s.goal)}</div>` : "") +
    `<div class="rc-r"><span class="k">참조</span><span class="v">${ref}</span></div>` +
    mid +
    `<div class="rc-f"><span class="fx">${facts}</span><span class="w">${when}</span></div></button>`
}

function extLabel(a) {
  if (a.md && a.html) return "md·html"
  return a.html ? "html" : a.md ? "md" : a.ext || "파일"
}

function artRow(a) {
  if (a.none) return `<div class="art none"><span class="nm">${esc(a.label)}</span><span class="ext">아직 없음</span></div>`
  const on = (a.key === sel.key ? " on" : "") + (a.sub ? " sub" : "")
  return `<button class="art${on}" type="button" data-key="${esc(a.key)}" title="${esc(a.key)}"><span class="nm">${esc(a.label)}</span>${a.cn ? `<span class="cn" title="반영되지 않은 코멘트 ${a.cn}개">${a.cn}</span>` : ""}<span class="ext">${extLabel(a)}</span></button>`
}

function statusCard(run) {
  const st = run.stageShort
  let what
  if (run.state === "active") {
    const from = Date.parse(run.stages[st] || run.opened)
    what = `${st} ${KO[st] || ""} · ${run.status === "run" ? "" : `${STATUS[run.status]} · `}${isNaN(from) ? "" : `<span data-from="${from}"></span>`}`
  } else if (run.state === "complete") {
    what = `완료${run.closed ? ` · ${fmtDate(run.closed)}` : ""}`
  } else {
    what = `${st}에서 ${STATUS[run.status]} · ${fmtDate(run.closed || run.touched)}`
  }
  let ag = ""
  if (run.view) {
    const pills = (run.view.pills || []).map((p) => {
      const bad = p.end === "error" || p.end === "deny" ? ' class="bad"' : ""
      const chip = p.chip ? ` <span${bad}>${esc(p.chip)}</span>` : ""
      const since = p.since ? ` <span data-since="${p.since}"></span>` : ""
      return `<div class="agent" title="${esc(p.name)}${p.chip ? ` ${esc(p.chip)}` : ""}"><span class="pd ${p.pulse ? "pulse" : "main"}"></span><span>${esc(p.name)}${chip}${since}</span></div>`
    }).join("")
    const marks = (run.view.marks || []).length ? `<div class="marks">${run.view.marks.map((m) => `<span class="mark">${esc(m)}</span>`).join("")}</div>` : ""
    if (pills || marks) ag = `<div class="ag">${pills}${marks}</div>`
  }
  const s = run.summary
  const title = s && s.title ? Md.inline(s.title, { href: linkHref(run) }) : esc(run.slug)
  return `<div class="scard"><canvas class="cv c48" width="24" height="24" data-anim="${ANIM[run.status]}"></canvas>` +
    `<div class="shd"><b class="rtitle">${title}</b><div class="stage ${CARD[run.status]}">${what}</div></div>${summary(run)}${ag}</div>`
}

// a link in a run file, relative to dir of the run folder ("" or "agent/")
const linkHref = (run, dir = "") => (u) => {
  if (/^([a-z][\w+.-]*:|#|\/)/i.test(u)) return u
  const k = u.indexOf("#")
  const p = k < 0 ? u : u.slice(0, k)
  let name = p
  try { name = decodeURIComponent(p) } catch {}
  return fileUrl(run, dir + name) + (k < 0 ? "" : u.slice(k))
}

// goal, reference and open questions under the card's title;
// a line whose data is missing is left out
function summary(run) {
  const s = run.summary
  if (!s) return ""
  const md = (t) => Md.inline(t, { href: linkHref(run) })
  // the title heads the card, the repositories are listed under the stage
  // tree, the start in the status bar
  // without a title the card is headed by the slug already
  const rows = []
  if (s.title) rows.push(["slug", esc(run.slug), "slug"])
  if (s.ref) rows.push(["참조", md(s.ref), ""])
  let chip = ""
  if (s.questions.length) {
    const id = `${run.project}/${run.slug}`
    const open = openQ.has(id)
    chip = `<button class="chip q" type="button" data-sumq="${esc(id)}" aria-expanded="${open}">미해결 ${s.questions.length} · 가정 ${s.assumed} ${open ? "▴" : "▾"}</button>`
    if (open) {
      const qs = s.questions.map((q) => `<span class="m">[?]</span><span>${md(q.q)}</span>` +
        q.a.map((a) => `<span class="m">→</span><span>${md(a)}</span>`).join("")).join("")
      const rest = s.assumptions.length
        ? `<span class="qh">plan의 다른 가정</span><div class="qa">${s.assumptions.map((a) => `<span class="m">·</span><span>${md(a.q)}</span><span class="m">→</span><span>${md(a.a)}</span>`).join("")}</div>`
        : ""
      chip += `<div class="qbox"><div class="qa">${qs}</div>${rest}</div>`
    }
  }
  const parts = [
    s.goal ? `<p class="goal">${md(s.goal)}</p>` : "",
    rows.length ? `<div class="sumrow">${rows.map(([k, v, c]) => `<span class="k">${k}</span><span${c ? ` class="${c}"` : ""}>${v}</span>`).join("")}</div>` : "",
    chip,
  ].join("")
  return parts ? `<div class="sum">${parts}</div>` : ""
}

// rail: the explorer folded to its stage marks
function renderLeft(run, rail = false) {
  if (!run) return setHTML($("left"), `<div class="empty">run이 없습니다</div>`)
  if (rail) {
    const marks = CHAIN.map((s, i) => {
      const tone = run.tones[s] || "wait"
      const stem = i === CHAIN.length - 1 ? "" : `<div class="stem${tone === "done" ? " done" : ""}"></div>`
      return `<div class="rail" title="${s} · ${KO[s]}"><div class="node ${tone}">${tone === "done" ? "✓" : tone === "bad" ? "!" : ""}</div>${stem}</div>`
    }).join("")
    return setHTML($("left"), `<button type="button" class="rlx" title="타임라인 펼치기">»</button>${marks}`)
  }
  // the stage tree: every stage is unfolded until the person folds it
  const id = `${run.project}/${run.slug}`
  const isOpen = (s) => stgOpen.get(`${id}|${s}`) !== false
  const files = (s) => {
    let out = run.arts.filter((a) => a.stage === s && !a.sub).map(artRow).join("")
    for (const sub of Object.keys(SUB_STAGE)) {
      const in_ = run.arts.filter((a) => a.stage === s && a.sub === sub)
      if (in_.length) out += `<div class="subh"><span>${sub}/</span><span class="ext">${in_.length}</span></div>` + in_.map(artRow).join("")
    }
    return out
  }
  const GLYPH = { done: "✓", now: "●", bad: "!", wait: "○", held: "–" }
  const steps = CHAIN.map((s, i) => {
    const tone = run.tones[s] || "wait"
    const when = tone !== "wait" && run.stages[s] ? fmtDate(run.stages[s]) : ""
    const inner = files(s)
    const open = !!inner && isOpen(s)
    return `<button type="button" class="xg ${tone}" data-stg="${s}" aria-expanded="${open}"${inner ? "" : " disabled"}>` +
      `<span class="tw">${inner ? (open ? "▾" : "▸") : ""}</span><span class="g ${tone}">${GLYPH[tone] || ""}</span>` +
      `<span class="nm">${i + 1} ${s}</span><span class="sk">${KO[s]}</span><span class="when">${when}</span></button>` + (open ? inner : "")
  }).join("")
  const others = run.arts.filter((a) => a.stage === "other")
  const otherOpen = others.length && isOpen("other")
  const other = others.length
    ? `<button type="button" class="xg" data-stg="other" aria-expanded="${!!otherOpen}"><span class="tw">${otherOpen ? "▾" : "▸"}</span><span class="g"></span><span class="nm">그 밖의 파일</span><span class="when">${others.length}</span></button>` + (otherOpen ? others.map(artRow).join("") : "")
    : ""
  const trees = (run.summary && run.summary.trees) || []
  const repos = trees.length
    ? `<div class="xh">저장소 ${trees.length}</div>` + trees.map((t) => `<div class="repo" title="${esc([t.repo, t.base, t.branch].filter(Boolean).join(" · "))}">` +
      `<span>${esc(t.repo || "")}</span><span class="b">${esc(t.branch || t.base || "")}</span></div>`).join("")
    : ""
  setHTML($("left"), `<div class="xh">RUN<button type="button" class="rlx fold" data-fold-rail title="탐색기 접기">«</button></div>` + statusCard(run) +
    `<div class="xh">산출물</div>` + steps + other + repos)
}

// the ways an artifact can be shown, its default first: the frame's own
// view of 1-spec.md or 6-land.md, the HTML, the raw markdown, the file
function viewsOf(a) {
  const out = []
  if (DRAWN[a.key] && a.md) out.push("draw")
  if (a.html) out.push("html")
  if (a.md) out.push("md")
  if (!out.length) out.push("file")
  return out
}

const VIEW_LABEL = { draw: "화면 보기", html: "HTML 보기", md: "원본 md" }

// ---------- editor tabs: the artifacts of a run kept open above the main view ----------

const tabKeys = (run) => {
  const id = `${run.project}/${run.slug}`
  const keys = (etabs.get(id) || []).filter((k) => run.arts.some((a) => a.key === k && !a.none))
  etabs.set(id, keys)
  return keys
}

function saveTabs() {
  lsSet("rein.etabs", JSON.stringify(Object.fromEntries(etabs)))
}

// the artifact shown gets a tab, after the tab that was shown before it
let lastTab = null
function keepTab(run) {
  if (!sel.key) return
  const keys = tabKeys(run)
  if (!keys.includes(sel.key)) {
    const at = keys.indexOf(lastTab)
    keys.splice(at < 0 ? keys.length : at + 1, 0, sel.key)
    saveTabs()
  }
  lastTab = sel.key
}

// close a tab; when it is the one shown, its neighbor is shown instead
function closeTab(run, key) {
  const keys = tabKeys(run)
  const i = keys.indexOf(key)
  if (i < 0 || keys.length < 2) return
  keys.splice(i, 1)
  saveTabs()
  if (sel.key === key) {
    sel.key = keys[Math.min(i, keys.length - 1)]
    sel.view = null
  }
  render()
}

function crumb(run, a, view) {
  const keys = tabKeys(run)
  const many = keys.length > 1
  const tabs = keys.map((k) => {
    const x = run.arts.find((y) => y.key === k)
    return `<div class="etab${k === sel.key ? " on" : ""}" title="${esc(k)}"><button type="button" class="nm" data-etab="${esc(k)}">${esc(x.label)}<span class="ext">${extLabel(x)}</span></button>` +
      (many ? `<button type="button" class="ex" data-etabx="${esc(k)}" aria-label="${esc(x.label)} 닫기">×</button>` : "") + `</div>`
  }).join("")
  let right = ""
  if (a) {
    const views = viewsOf(a)
    for (const v of views) if (v !== view) right += `<button type="button" data-view="${v === views[0] ? "" : v}">${VIEW_LABEL[v]}</button>`
    const f = view === "html" ? a.html : view === "md" || view === "draw" ? a.md : a.file
    right += `<a href="${fileUrl(run, f.name)}" target="_blank" rel="noopener">새 탭 ↗</a>`
    if (isMock(run)) {
      const n = commentsOfRun(run).length
      right = `${showSeg()}<span class="ctogw" id="ctog"></span><button type="button" class="cpt${cpOff ? "" : " on"}" data-cpt aria-pressed="${!cpOff}" title="코멘트 패널 ${cpOff ? "열기" : "닫기"}">${ICON.comment}코멘트 ${n}</button>${right}`
    }
  }
  return `<div class="mhd"><div class="etabs">${tabs}</div><span class="sp"></span><div class="macts">${right}</div></div>`
}

// ---------- 1-mockup.html: which part of each screen, and its planning document ----------

const SHOW = { before: "현재", after: "목표", both: "둘 다" }
const showSeg = () => `<span class="seg">${Object.entries(SHOW).map(([k, l]) => `<button type="button" class="${k === mockShow ? "on" : ""}" data-show="${k}">${l}</button>`).join("")}</span>`

// The server sandboxes a run's page, so the frame and the mockup talk by
// message (skills/spec/template.html's script): the frame says which part
// of each screen to show, whether a click picks an element to comment on,
// and the comments to pin; the mockup says which screen was clicked, with
// its `to-be source` (the planning document scrolls to that page), which
// element was picked, which comments found no element and which pin was
// clicked. A mockup from an older template answers none of it.
const mockFrame = () => $("main").querySelector(".pane iframe")

function toMock(msg) {
  const f = mockFrame()
  try { if (f) f.contentWindow.postMessage(msg, "*") } catch {}
}

function dressMock() {
  const run = findRun(sel.project, sel.slug)
  toMock({ rein: "show", show: mockShow })
  toMock({ rein: "comment-mode", on: cm.mode && canComment(run) })
  sendComments(run, true)
  // a mockup that answers the comments is one of this template
  clearTimeout(cm.timer)
  if (cm.old !== false) {
    const key = cm.key
    cm.timer = setTimeout(() => {
      if (cm.key !== key || cm.old !== null) return
      cm.old = true
      cm.mode = false
      renderPanel(findRun(sel.project, sel.slug))
      drawToggle(findRun(sel.project, sel.slug))
    }, 2000)
  }
}

addEventListener("message", (e) => {
  const f = mockFrame()
  const run = findRun(sel.project, sel.slug)
  const m = e.data
  if (!f || e.source !== f.contentWindow || !isMock(run) || !m) return
  if (m.rein === "screen") jumpBrief(run, String(m.source || ""))
  else if (m.rein === "anchors") {
    cm.old = false
    cm.missing = new Set(Array.isArray(m.missing) ? m.missing : [])
    renderPanel(run)
    drawToggle(run)
  } else if (m.rein === "pick" && canComment(run) && typeof m.screen === "string" && m.screen) {
    cm.pick = { screen: m.screen, el: typeof m.el === "string" && m.el ? m.el : null }
    cm.edit = null
    cm.text = ""
    cm.err = null
    openPanel()
    renderPanel(run)
    const t = $("cpanel").querySelector("[data-cin]")
    if (t) {
      t.scrollIntoView({ block: "nearest" })
      t.focus()
    }
  } else if (m.rein === "pin" && Number.isInteger(m.n)) {
    cm.on = m.n
    openPanel()
    renderPanel(run)
    const c = $("cpanel").querySelector(`.ccard[data-cn="${m.n}"]`)
    if (c) c.scrollIntoView({ block: "nearest" })
  }
})

// a new comment or a pin picked in the mockup opens the panel the person closed
function openPanel() {
  if (!cpOff) return
  cpOff = false
  lsSet("rein.cpoff", "0")
  render()
}

// the planning document a `to-be source` names, opened at its page
function jumpBrief(run, source) {
  const src = sourceOf(source)
  const doc = src && briefDocs(run).find((x) => x.id === src.file || x.show.name === src.file)
  if (doc) openSide(doc.id, doc.ext === "pdf" ? src.page : null)
  return !!doc
}

// a `to-be source:` value, `brief/<file> (<page>)`: the file, relative to the
// run folder, and the page (its number before 쪽, else its first number)
function sourceOf(text) {
  const m = /^\s*(.+?)\s*(?:\((.*)\))?\s*$/s.exec(text)
  if (!m || !m[1]) return null
  const p = m[2] ? /(\d+)\s*쪽/.exec(m[2]) || /(\d+)/.exec(m[2]) : null
  return { file: m[1], page: p ? Number(p[1]) : null }
}

// ---------- 1-mockup.html: the person's comments (agent/comments.json) ----------

// The panel right of the mockup. Comments are added only while the run is
// active in spec, and never on the hub's page; the hook hands the drafts to
// the agent at the next prompt, and the agent marks them done or declined.
const CST = { draft: "보내기 전", sent: "보냄", done: "반영됨", declined: "반영 안 함" }
const canComment = (run) => !!run && run.state === "active" && run.stageShort === "spec" && !ro

// key: the run shown; mode: a click on the mockup picks an element; pick:
// { screen, el } being written; edit: the n of the draft being changed; text:
// what the input holds; on: the selected card; missing: the n of comments
// whose element the mockup lacks; old: null until the mockup answers, true
// when it never does; sent: what the mockup was last given; srcs: the
// mockup's screens, id -> { name, source }; basis: the n of the draft whose
// basis box is being picked on the planning document; flash: the n of the
// box to scroll to and flash once it is drawn
const freshCm = (key) => ({ key, mode: false, pick: null, edit: null, text: "", on: null, missing: new Set(), old: null, err: null, busy: false, sent: null, srcs: null, timer: null, basis: null, flash: null })

let cm = freshCm(null)

const commentsOfRun = (run) => (run.comments || []).filter((c) => c && Number.isInteger(c.n) && typeof c.screen === "string").sort((a, b) => a.n - b.n)

// the 코멘트 toggle beside 현재|목표|둘 다, once the mockup answered
function drawToggle(run) {
  const w = $("ctog")
  if (!w) return
  const show = canComment(run) && cm.old === false
  setHTML(w, show ? `<span class="seg"><button type="button" class="${cm.mode ? "on" : ""}" data-cmode title="켜면 목업의 요소를 눌러 코멘트를 답니다 (C)">코멘트</button></span>` : "")
}

function setMode(run, on) {
  cm.mode = on
  toMock({ rein: "comment-mode", on })
  drawToggle(run)
}

function sendComments(run, force = false) {
  const items = commentsOfRun(run).map((c) => ({ n: c.n, screen: c.screen, el: c.el ?? null, status: c.status }))
  const sig = JSON.stringify(items)
  if (!force && sig === cm.sent) return
  cm.sent = sig
  toMock({ rein: "comments", items })
}

// the screens of 1-mockup.html, read from the file: each one's name and
// `to-be source`, which the cards show
async function mockScreens(run, file) {
  const sig = `${run.project}/${run.slug}/${file.mtime}:${file.size}`
  if (cm.srcs && cm.srcs.sig === sig) return
  const mine = (cm.srcs = { sig, map: {} })
  let text
  try {
    text = await (await fetch(fileUrl(run, file.name), { cache: "no-store" })).text()
  } catch {
    return
  }
  if (cm.srcs !== mine) return
  const d = new DOMParser().parseFromString(text, "text/html")
  for (const sec of d.querySelectorAll("section.screen[id]")) {
    // the name is the h2's own text: its #id and pins are in elements
    const h = sec.querySelector(":scope > h2")
    const name = h ? [...h.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("").trim() : ""
    const walk = d.createTreeWalker(sec, NodeFilter.SHOW_COMMENT)
    let n, source = ""
    while ((n = walk.nextNode())) {
      const m = /^\s*to-be source:\s*([\s\S]*?)\s*$/.exec(n.nodeValue)
      if (m) { source = m[1]; break }
    }
    mine.map[sec.id] = { name, source }
  }
  renderPanel(findRun(sel.project, sel.slug))
}

function renderPanel(run, mock = isMock(run)) {
  const p = $("cpanel")
  p.hidden = !mock || cpOff
  if (!mock) return setHTML(p, "")
  const can = canComment(run)
  const canBasis = can && briefDocs(run).some(boxable)
  pickingBasis(run)
  const list = commentsOfRun(run)
  const drafts = list.filter((c) => c.status === "draft").length
  const open = list.filter((c) => c.status === "draft" || c.status === "sent").length
  const where = (screen, el) => {
    const s = cm.srcs && cm.srcs.map[screen]
    return `<span class="cwh" title="#${esc(screen)}${el ? ` · ${esc(el)}` : ""}"><span class="sc">${esc((s && s.name) || "#" + screen)}</span><span class="el">${el ? esc(el) : "화면 전체"}</span></span>`
  }
  const input = (save) => `<textarea class="cin" rows="3" placeholder="코멘트" data-cin>${esc(cm.text)}</textarea>` +
    `<div class="cbt"><button type="button" class="pri" data-cact="${save}"${cm.busy ? " disabled" : ""}>저장</button><button type="button" data-cact="cancel">취소</button><span class="hint">Ctrl+Enter</span></div>`
  const cards = list.map((c) => {
    const st = CST[c.status] ? c.status : "other"
    const s = cm.srcs && cm.srcs.map[c.screen]
    const src = s && s.source ? sourceOf(s.source) : null
    const doc = src && briefDocs(run).find((x) => x.id === src.file || x.show.name === src.file)
    const srcHtml = !src ? ""
      : doc ? `<button type="button" class="csrc" data-csrc="${esc(s.source)}" title="기획서 열에서 보기">${esc(baseOf(doc.id))}${doc.ext === "pdf" && src.page ? ` · p.${src.page}` : ""}</button>`
      : `<span class="csrc">${esc(s.source)}</span>`
    const editing = can && cm.edit === c.n && c.status === "draft"
    // the basis box on the planning document, and setting it while a draft
    let bas = ""
    if (c.basis) bas = `<button type="button" class="cbas" data-cbas title="기획서 열에서 보기">← 기획서 ${Number.isInteger(c.basis.page) ? `p.${c.basis.page}` : esc(baseOf(c.basis.doc))}` +
      `${c.basis.quote ? ` · <q>${esc(c.basis.quote)}</q>` : " · 글자 없음"}</button>`
    let bacts = ""
    if (canBasis && c.status === "draft" && !editing) {
      bacts = cm.basis === c.n ? `<button type="button" data-cact="basis-cancel">고르는 중… (Esc 취소)</button>`
        : c.basis ? `<button type="button" data-cact="basis">다시 지정</button><button type="button" data-cact="basis-clear">근거 지우기</button>`
        : `<button type="button" data-cact="basis">기획서에서 근거 지정</button>`
    }
    let acts = ""
    if (can && !editing && c.status === "draft") acts = `<button type="button" data-cact="edit">고치기</button><button type="button" data-cact="del">지우기</button>`
    else if (can && (c.status === "done" || c.status === "declined")) acts = `<button type="button" data-cact="reopen">다시 열기</button>`
    // a reflected comment whose element went away is shown as it is
    const miss = cm.missing.has(c.n) && c.status !== "done"
    return `<div class="ccard ${st}${cm.on === c.n ? " on" : ""}" data-cn="${c.n}">` +
      `<div class="cct"><span class="cno ${st}">${c.n}</span>${where(c.screen, c.el)}<span class="cst ${st}">${esc(CST[c.status] || String(c.status))}</span></div>` +
      (miss ? `<div class="cmiss">요소 없음</div>` : "") +
      (editing ? input("save-edit") : `<div class="ctx">${esc(c.text || "")}</div>`) +
      (c.note ? `<div class="cnote"><b>Rein</b>${esc(c.note)}</div>` : "") +
      (bas || bacts ? `<div class="cbrow">${bas}<span class="sp"></span>${bacts}</div>` : "") +
      (srcHtml || acts ? `<div class="cact">${srcHtml}<span class="sp"></span>${acts}</div>` : "") + `</div>`
  }).join("")
  const pick = can && cm.pick
    ? `<div class="ccard new"><div class="cct"><span class="cno draft">+</span>${where(cm.pick.screen, cm.pick.el)}<span class="cst draft">새 코멘트</span></div>${input("save-new")}</div>`
    : ""
  let note = ""
  if (cm.old) note = `<div class="cline">이 목업은 코멘트 기능 이전 템플릿으로 그려져 핀과 코멘트 달기가 동작하지 않습니다.</div>`
  else if (!can && !ro) note = `<div class="cline">코멘트는 spec 단계에서만 답니다. 지금은 읽기 전용입니다.</div>`
  const empty = !list.length && !pick
    ? `<div class="cempty">${can && cm.old === false ? "「코멘트」를 켜고 목업의 요소를 누르면 코멘트를 답니다." : "코멘트가 없습니다."}</div>`
    : ""
  const html = `<div class="chd"><b>코멘트</b><span class="cnt">${list.length}${open ? ` · 반영 전 ${open}` : ""}</span></div>${note}` +
    `<div class="clist">${cards}${pick}${empty}</div>` +
    (cm.err ? `<div class="cerr">${esc(cm.err)}</div>` : "") +
    (can ? `<div class="cfoot">다음 입력 때 보낼 코멘트 <b>${drafts}</b>개</div>` : "")
  // the input keeps its focus and caret when the panel is drawn again
  const f = document.activeElement
  const at = f && f.matches && f.matches("#cpanel [data-cin]") ? [f.selectionStart, f.selectionEnd] : null
  const top = p.querySelector(".clist") ? p.querySelector(".clist").scrollTop : 0
  setHTML(p, html)
  if (p.querySelector(".clist")) p.querySelector(".clist").scrollTop = top
  const t = at && p.querySelector("[data-cin]")
  if (t && document.activeElement !== t) {
    t.focus()
    t.setSelectionRange(at[0], at[1])
  }
}

// one change to agent/comments.json; the run list brings the result back
async function postComment(run, body) {
  cm.busy = true
  cm.err = null
  renderPanel(run)
  let ok = false
  try {
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: run.project, runId: run.slug, ...body }),
    })
    if (res.status === 409) cm.err = "지금은 바꿀 수 없습니다. 코멘트는 spec 단계의 진행 중인 run에서만 달고 고칩니다."
    else if (!res.ok) cm.err = `저장하지 못했습니다 (${res.status})`
    ok = res.ok
  } catch {
    cm.err = "저장하지 못했습니다. 프레임 서버에 닿지 않습니다."
  }
  cm.busy = false
  // a basis box leaves the comment being written as it is
  if (ok && body.op !== "basis") {
    cm.pick = null
    cm.edit = null
    cm.text = ""
  }
  renderPanel(findRun(sel.project, sel.slug))
  if (ok) load()
}

function renderMain(run) {
  const main = $("main")
  if (!run) {
    shown = null
    return setHTML(main, `<div class="empty">아직 run이 없습니다. Claude Code에서 /rein:spec 으로 시작하세요.</div>`)
  }
  const a = run.arts.find((x) => x.key === sel.key && !x.none)
  if (!a) {
    shown = null
    return setHTML(main, crumb(run, null) + `<div class="empty">아직 산출물이 없습니다.</div>`)
  }
  const views = viewsOf(a)
  const view = views.includes(sel.view) ? sel.view : views[0]
  const file = view === "html" ? a.html : view === "md" || view === "draw" ? a.md : a.file
  const id = [run.project, run.state, run.slug, a.key, view].join("/")
  // a drawn view reads other files of the run and land.json too
  const sig = `${file.mtime}:${file.size}` + (view === "draw" ? run.files.map((f) => `|${f.name}:${f.mtime}`).join("") + JSON.stringify(run.land) : "")
  const url = fileUrl(run, file.name)
  if (shown && shown.id === id) {
    // the tab bar changes without the view: closed tabs, the comment panel
    const h = main.querySelector(".mhd")
    const head = crumb(run, a, view)
    if (h && h._html !== head) {
      const t = document.createElement("div")
      t.innerHTML = head
      t.firstChild._html = head
      h.replaceWith(t.firstChild)
      main._html = null
    }
    if (shown.sig === sig) return
    shown.sig = sig
    if (view === "md") return showMd(run, file, true)
    if (view === "draw") return showDraw(run, a, true)
    if (view === "html") return reloadFrame(main.querySelector("iframe"))
  }
  shown = { id, sig }
  doc = null
  drawn = null
  ui = {}
  const head = crumb(run, a, view)
  if (view === "draw") {
    setHTML(main, head + `<div class="pane draw"></div>`)
    showDraw(run, a, false)
  } else if (view === "html" || (view === "file" && VIEWABLE.has(a.ext))) {
    setHTML(main, head + `<div class="pane fr"><iframe src="${url}" title="${esc(file.name)}"></iframe></div>`)
  } else if (view === "md") {
    setHTML(main, head + `<div class="pane"><div class="doc"></div></div>`)
    showMd(run, file, false)
  } else {
    const [act, label] = fileAct(file.name)
    setHTML(main, head + `<div class="pane"><div class="doc"><div class="dl"><span class="fn">${esc(file.name)}</span>` +
      `<span class="meta">${fmtSize(file.size)} · ${fmtDate(file.mtime)}</span><a class="btn" href="${url}" ${act}>${label}</a></div></div></div>`)
  }
}

async function showMd(run, file, keep) {
  const id = shown && shown.id
  let src
  try {
    src = await (await fetch(fileUrl(run, file.name), { cache: "no-store" })).text()
  } catch {
    return
  }
  if (!shown || shown.id !== id) return
  const pane = $("main").querySelector(".pane")
  const top = pane.scrollTop
  doc = { src, run }
  const list = file.name === "5-checklist.md"
  const checkable = list && run.state === "active" && !ro
  const d = pane.querySelector(".doc")
  d.innerHTML = Md.render(src, { href: linkHref(run), checkable, item: list ? checkItem : null })
  if (list) dressChecklist(d)
  if (keep) pane.scrollTop = top
}

// 5-checklist.md as cards: a progress box under the title, the how-to list
// as commands, and each check as a card with 할 일 and 기대 side by side
function dressChecklist(d) {
  d.classList.add("ckdoc")
  let seenPage = false
  for (const el of d.children) {
    if (el.tagName === "H2") seenPage = true
    if (!el.matches("ul.ul")) continue
    if (!seenPage) { el.classList.add("howto"); continue }
    let cards = 0
    for (const li of el.children) {
      const head = li.querySelector(":scope > span")
      const strong = head && head.firstElementChild
      if (!strong || strong.tagName !== "STRONG" || head.firstChild !== strong) continue
      li.classList.add("ck")
      cards++
      const sub = li.querySelector(":scope > ul.ul")
      if (!sub) continue
      const items = [...sub.children]
      const lead = (x) => (x.querySelector(":scope > span") || x).textContent.trim()
      const todo = items.find((x) => /^할 일/.test(lead(x)))
      const exp = items.find((x) => /^기대/.test(lead(x)))
      if (!todo || !exp) continue
      sub.classList.add("ckgrid")
      todo.classList.add("todo")
      exp.classList.add("exp")
      let after = false
      for (const x of items) {
        if (x === todo) after = true
        else if (after && x !== exp) x.classList.add("after")
      }
      head.insertAdjacentHTML("beforeend", `<span class="ckn"></span>`)
    }
    if (cards) el.classList.add("cks")
  }
  // each page heading with what follows it, up to the next one, as one card
  for (const h of [...d.querySelectorAll(":scope > h2")]) {
    const sec = document.createElement("section")
    sec.className = "cksec"
    const body = document.createElement("div")
    body.className = "ckb"
    for (let n = h.nextElementSibling; n && !/^H[12]$|^HR$/.test(n.tagName);) {
      const next = n.nextElementSibling
      body.appendChild(n)
      n = next
    }
    h.replaceWith(sec)
    const hd = document.createElement("div")
    hd.className = "cksh"
    hd.append(h)
    hd.insertAdjacentHTML("beforeend", `<span class="ckn"></span>`)
    sec.append(hd, body)
  }
  // "통합 테스트 체크리스트 — title": the kind above the title
  const title = d.querySelector(":scope > h1")
  const top = document.createElement("div")
  top.className = "cktop"
  if (title) {
    const head = document.createElement("div")
    const t = title.textContent
    const k = t.indexOf(" — ")
    if (k > 0 && !title.children.length) {
      head.insertAdjacentHTML("beforeend", `<span class="eb">${esc(t.slice(0, k))}</span>`)
      title.textContent = t.slice(k + 3)
    }
    title.replaceWith(top)
    head.append(title)
    top.append(head)
  }
  top.insertAdjacentHTML("beforeend", `<span class="ckcount"><b></b><span></span></span>`)
  if (!title) d.prepend(top)
  top.insertAdjacentHTML("afterend", `<div class="ckseg"></div>`)
  countChecklist(d)
}

// the counts from the boxes as they are now, again after each click
function countChecklist(d) {
  const top = d && d.querySelector(".cktop")
  if (!top) return
  const count = (el) => {
    const bs = [...el.querySelectorAll("input.cb")]
    return [bs.filter((b) => b.checked).length, bs.length]
  }
  const segs = []
  for (const li of d.querySelectorAll("li.ck")) {
    const [n, all] = count(li)
    const ok = all > 0 && n === all
    li.classList.toggle("ok", ok)
    const c = li.querySelector(":scope > span > .ckn")
    if (c) c.textContent = all ? `${ok ? "✓ " : ""}${n} / ${all}` : ""
    if (all) segs.push(`<i class="${ok ? "ok" : n ? "part" : ""}"></i>`)
  }
  for (const sec of d.querySelectorAll(".cksec")) {
    const [n, all] = count(sec)
    const c = sec.querySelector(".cksh > .ckn")
    c.textContent = all ? `${n} / ${all}` : ""
    c.classList.toggle("ok", all > 0 && n === all)
  }
  const [on, all] = count(d)
  top.querySelector(".ckcount b").textContent = String(on)
  top.querySelector(".ckcount span").textContent = ` / ${all} 칸 확인`
  const seg = d.querySelector(".ckseg")
  if (seg) seg.innerHTML = segs.join("")
}

// a reload keeps the scroll position, except in a run's page or picture: the
// server sandboxes those (an origin of their own), so they reload at the top
function reloadFrame(iframe) {
  if (!iframe) return
  try {
    const w = iframe.contentWindow
    const x = w.scrollX, y = w.scrollY
    iframe.addEventListener("load", () => { try { iframe.contentWindow.scrollTo(x, y) } catch {} }, { once: true })
    w.location.reload()
  } catch {
    iframe.src = iframe.src
  }
}

// ---------- drawn views: 1-spec.md and 6-land.md ----------

// the sections of 1-spec.md the spec view shows, in this order; the others
// (완료 판정, 전제 확인, 현행 동작, 영향 범위, ...) are for the agents.
// 기획서 대조 is what 요구사항 was called before #4.
// A section without its own drawing below is shown as markdown.
const SPEC_SHOWN = ["문제", "범위", "요구사항", "기획서 대조"]

const DRAWN = { "1-spec": { draw: drawSpec }, "6-land": { draw: drawLand, plan: true } }

async function showDraw(run, a, keep) {
  const id = shown && shown.id
  const get = async (name) => {
    const res = await fetch(fileUrl(run, name), { cache: "no-store" })
    return res.ok ? res.text() : null
  }
  let src, plan = null
  try {
    src = await get(a.md.name)
    if (DRAWN[a.key].plan && run.files.some((f) => f.name === "2-plan.md")) plan = await get("2-plan.md")
  } catch {
    return
  }
  if (!shown || shown.id !== id || src === null) return
  drawn = { run, a, src, plan }
  paint(keep)
}

// draw the view from what showDraw read and what the person picked
function paint(keep = true) {
  const pane = $("main").querySelector(".pane.draw")
  if (!pane || !drawn) return
  DRAWN[drawn.a.key].draw(pane, drawn, keep)
}

// "## <name>" sections of a markdown file, fenced code kept, front matter left out
function sectionsOf(src) {
  const lines = src.replace(/\r/g, "").split("\n")
  let i = 0
  if (lines[0] && lines[0].trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---")
    if (end > 0) i = end + 1
  }
  const out = new Map()
  let cur = null
  let fence = false
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*(`{3,}|~{3,})/.test(l)) fence = !fence
    const h = !fence && /^##\s+(.*?)\s*#*\s*$/.exec(l)
    if (h) out.set(h[1], (cur = []))
    else if (!fence && /^#\s/.test(l)) cur = null
    else if (cur) cur.push(l)
  }
  return out
}

const cellsOf = (row) => row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
const baseOf = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p
const extOf = (n) => (n.lastIndexOf(".") > 0 ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "")

// ----- spec -----

function drawSpec(pane, d, keep) {
  const { run, src } = d
  const secs = sectionsOf(src)
  const md = (t) => Md.render(t, { href: linkHref(run) })
  const docs = briefDocs(run)
  if (!SPEC_SHOWN.some((n) => secs.has(n))) {
    // not a spec this view can read: the old HTML if there is one, else the markdown
    if (d.a.html) pane.innerHTML = `<iframe src="${fileUrl(run, d.a.html.name)}" title="${esc(d.a.html.name)}"></iframe>`
    else pane.innerHTML = `<div class="sdoc"><div class="doc">${md(src)}</div></div>`
    return
  }
  ui.rows = []
  ui.first = null
  const body = SPEC_SHOWN.filter((n) => secs.has(n)).map((n) => {
    const lines = secs.get(n)
    if (n === "범위") return scopeSec(lines, md)
    if (n === "요구사항" || n === "기획서 대조") return briefSec(run, lines, docs, n)
    return `<h2>${esc(n)}</h2>${md(lines.join("\n"))}`
  }).join("")
  if (!pane.querySelector(".sdoc")) pane.innerHTML = `<div class="sdoc"><div class="doc"></div></div>`
  const top = pane.scrollTop
  pane.querySelector(".sdoc").firstChild.innerHTML = body
  if (keep) pane.scrollTop = top
  if (autoSide(run, ui.first)) {
    renderSide(run)
    writeHash()
  }
}

// the side tab's width: dragged by the bar beside it, kept in this browser
// for the next page; the right tab and the planning documents left of
// 1-mockup.html each keep their own.
const BRIEF_W = "rein.sideWidth"
const BRIEF_LW = "rein.leftWidth"
function dragWidth(grip) {
  const split = grip.parentElement
  const set = (w, left) => {
    const max = split.clientWidth ? Math.max(260, split.clientWidth - 320) : Infinity
    w = Math.round(Math.min(Math.max(w, 260), max))
    split.style.setProperty(left ? "--bwl" : "--bw", `${w}px`)
    return w
  }
  try { const w = Number(localStorage.getItem(BRIEF_W)); if (w) set(w, false) } catch {}
  try { const w = Number(localStorage.getItem(BRIEF_LW)); if (w) set(w, true) } catch {}
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    split.classList.add("drag")
    const left = split.classList.contains("left")
    const w0 = split.querySelector(".sbrief").offsetWidth
    const move = (ev) => set(left ? w0 + ev.clientX - e.clientX : w0 + e.clientX - ev.clientX, left)
    const up = () => {
      grip.removeEventListener("pointermove", move)
      split.classList.remove("drag")
      try { localStorage.setItem(left ? BRIEF_LW : BRIEF_W, String(set(split.querySelector(".sbrief").offsetWidth, left))) } catch {}
    }
    grip.addEventListener("pointermove", move)
    grip.addEventListener("pointerup", up, { once: true })
    grip.addEventListener("pointercancel", up, { once: true })
  })
}

// 범위: the 대상 rows as chips, the 제외 rows on one line with their reasons folded
function scopeSec(lines, md) {
  const rows = lines.filter((l) => /^\s*\|/.test(l))
  if (rows.length < 3) return `<h2>범위</h2>${md(lines.join("\n"))}`
  const head = cellsOf(rows[0])
  const col = head.indexOf("상태") >= 0 ? head.indexOf("상태") : 1
  const name = Math.max(0, head.indexOf("구성 요소"))
  const on = [], off = [], open = []
  for (const r of rows.slice(1)) {
    if (/^\s*\|?\s*:?-{2,}/.test(r)) continue
    const c = cellsOf(r)
    const what = c[name] || "", st = c[col] || ""
    const x = /^제외\s*(?:\((.*)\))?\s*(.*)$/.exec(st)
    if (x) off.push({ what, why: (x[1] || x[2] || "").trim() })
    else if (st.includes("[?]")) open.push({ what, why: st })
    else on.push({ what, why: st.replace(/^대상\s*/, "") })
  }
  const chip = (x, cls = "") => `<span class="chip${cls}" title="${esc(x.why)}">${Md.inline(x.what, { href: (u) => u })}</span>`
  let html = `<h2>범위 <span class="cnt">대상 ${on.length} · 제외 ${off.length}${open.length ? ` · [?] ${open.length}` : ""}</span></h2>`
  if (on.length || open.length) html += `<div class="scope"><span class="lab t">대상</span>${on.map((x) => chip(x)).join("")}${open.map((x) => chip(x, " q")).join("")}</div>`
  if (off.length) {
    html += `<div class="scope"><span class="lab x">제외</span><span>${off.map((x) => esc(x.what)).join(" · ")}</span>` +
      `<button type="button" class="why" data-why>이유 ${ui.why ? "▴" : "▾"}</button></div>`
    if (ui.why) html += `<ul class="ul whys">${off.map((x) => `<li><b>${esc(x.what)}</b> — ${Md.inline(x.why || "이유 없음", { href: (u) => u })}</li>`).join("")}</ul>`
  }
  return html
}

const STATUS_WORD = /포함|변경|보류|제외|\[\?\]/
const STATUS_CLS = { 포함: "inc", 변경: "chg", 보류: "hold", 제외: "exc", "[?]": "q" }

// one row of 요구사항: "p.N <requirement> — <status>[: <detail>] [<element>]";
// the status word is looked for anywhere, as older rows put it elsewhere.
// The element, the mockup's data-id (`-`: the whole screen), is the last
// bracket of the line that is not [?].
function briefRow(line) {
  const em = /\s\[([^\]?][^\]]*)\]\s*$/.exec(line)
  const el = em ? em[1].trim() : null
  const text = em ? line.slice(0, em.index) : line
  const pm = /^p\.(\d+)\s+/.exec(text)
  const k = text.indexOf(" — ")
  const req = (k < 0 ? text : text.slice(0, k)).slice(pm ? pm[0].length : 0)
  const tail = k < 0 ? "" : text.slice(k + 3)
  const sm = STATUS_WORD.exec(tail) || STATUS_WORD.exec(text)
  const status = sm ? sm[0] : null
  const detail = sm && tail.startsWith(sm[0]) ? tail.slice(sm[0].length).replace(/^\s*[:：.,]?\s*/, "") : tail
  return { p: pm ? Number(pm[1]) : null, req, status, detail, q: text.includes("[?]"), el }
}

// 원본: `brief/a.pptx` (p.3~p.5 = 1~3쪽, p.7 = 4쪽)
function briefSrc(t) {
  const m = /^`([^`]+)`\s*(?:\((.*)\))?/.exec(t) || /^(.*?)\s*(?:\((.*)\))?\s*$/.exec(t)
  const path = m[1].trim()
  const maps = []
  for (const x of (m[2] || "").matchAll(/p\.(\d+)(?:\s*~\s*p\.(\d+))?\s*=\s*(\d+)(?:\s*~\s*\d+)?\s*쪽/g)) {
    maps.push({ a: Number(x[1]), b: Number(x[2] || x[1]), at: Number(x[3]) })
  }
  return { path, name: baseOf(path), note: m[2] || "", brief: /^brief\//.test(path) ? path.slice(6) : null, maps }
}

// the file page a printed page number is on, or null
function pageOf(src, n) {
  const m = src.maps.find((x) => n >= x.a && n <= x.b)
  return m ? m.at + n - m.a : null
}

function briefSec(run, lines, docs, title) {
  // groups: each 원본 line with the rows under it; consecutive 원본 lines
  // (older runs listed them all on top) share the rows that follow
  const groups = []
  let cur = null
  let srcLine = false
  const need = () => cur || (groups.push((cur = { srcs: [], items: [] })), cur)
  for (const l of lines) {
    if (!l.trim()) continue
    const o = /^원본\s*[:：]\s*(.*)$/.exec(l.trim())
    if (o) {
      if (cur && srcLine) cur.srcs.push(briefSrc(o[1]))
      else groups.push((cur = { srcs: [briefSrc(o[1])], items: [] }))
      srcLine = true
      continue
    }
    srcLine = false
    const h = /^#{3,6}\s+(.*)$/.exec(l)
    const r = /^[-*+]\s+(.*)$/.exec(l)
    need().items.push(h ? { head: h[1] } : r ? briefRow(r[1]) : { plain: l.trim() })
  }
  const all = groups.flatMap((g) => g.items.filter((x) => x.req !== undefined))
  const nChg = all.filter((x) => x.status === "변경").length
  const nQ = all.filter((x) => x.q).length
  const keep = (x) => !ui.filter || (ui.filter === "chg" ? x.status === "변경" : x.q)
  const ctx = { href: linkHref(run) }
  const filt = [[null, "전체", all.length], ["chg", "변경", nChg], ["q", "[?]", nQ]]
    .map(([f, label, n]) => `<button type="button" class="${(ui.filter || null) === f ? "on" : ""}" data-filter="${f || ""}">${label} <b>${n}</b></button>`).join("")
  let html = `<h2>${esc(title)} <span class="cnt">${all.length}줄</span></h2><div class="bfilter">${filt}</div>`
  for (const g of groups) {
    const rows = g.items.filter((x) => x.req !== undefined)
    // the tab of the brief/ file this group reads, when it has exactly one
    const doc = g.srcs.length === 1 && g.srcs[0].brief ? docs.find((x) => x.id === "brief/" + g.srcs[0].brief || x.show.name === "brief/" + g.srcs[0].brief) : null
    if (doc && !ui.first) ui.first = doc.id
    const names = g.srcs.map((s) => `<span class="nm" title="${esc(s.path)}">${esc(s.name)}</span><span class="rel">${s.note ? `(${esc(s.note)})` : ""}</span>`).join("")
    const cnt = `${rows.length}줄${rows.some((x) => x.status === "변경") ? ` · 변경 ${rows.filter((x) => x.status === "변경").length}` : ""}${rows.some((x) => x.q) ? ` · [?] ${rows.filter((x) => x.q).length}` : ""}`
    // the lines above every 원본 line come from the request itself
    const head = g.srcs.length
      ? `<${doc ? `button type="button" data-tab="${esc(doc.id)}"` : "div"} class="bgh"><span class="srcs">${names}</span><span class="cnt">${cnt}</span></${doc ? "button" : "div"}>`
      : rows.length && title === "요구사항" ? `<div class="bgh"><span class="srcs"><span class="nm">요청</span></span><span class="cnt">${cnt}</span></div>` : ""
    let body = ""
    for (const x of g.items) {
      if (x.head !== undefined) { body += `<div class="bsub">${Md.inline(x.head, ctx)}</div>`; continue }
      if (x.plain !== undefined) { body += `<div class="brow plain">${Md.inline(x.plain, ctx)}</div>`; continue }
      // a row jumps to its page of a PDF, or shows its image; numbered
      // before filtering so a picked row stays picked
      let jump = null
      if (doc && doc.ext === "pdf" && x.p !== null && pageOf(g.srcs[0], x.p) !== null) jump = { tab: doc.id, page: pageOf(g.srcs[0], x.p) }
      else if (doc && IMAGE.has(doc.ext)) jump = { tab: doc.id, page: null }
      const i = jump ? ui.rows.push({ ...jump, req: x.req }) - 1 : -1
      if (!keep(x)) continue
      const badges = (x.status ? `<span class="sb ${STATUS_CLS[x.status]}">${esc(x.status)}</span>` : "") + (x.q && x.status !== "[?]" ? `<span class="sb q">[?]</span>` : "")
      const inner = `<span class="rq">${x.p !== null ? `<span class="pn">p.${x.p}</span>` : ""}${Md.inline(x.req, ctx)}${x.el ? `<span class="el">[${esc(x.el)}]</span>` : ""}</span><span class="st">${badges}</span>` +
        (x.detail ? `<span class="dt">${Md.inline(x.detail, ctx)}</span>` : "")
      if (jump) {
        body += `<button type="button" class="brow${ui.row === i ? " on" : ""}" data-row="${i}" title="${jump.page ? `${jump.page}쪽으로` : "그림 보기"}">${inner}</button>`
      } else body += `<div class="brow">${inner}</div>`
    }
    html += `<div class="bgrp">${head}${body}</div>`
  }
  return html
}

// the documents of brief/ the right tab opens for 요구사항, by artifact
// key. A .pptx stands for the PDF of the same name.
function briefDocs(run) {
  const files = run.files.filter((f) => f.name.startsWith("brief/"))
  const has = new Set(files.map((f) => f.name.slice(6)))
  const docs = []
  for (const f of files) {
    const name = f.name.slice(6)
    const ext = extOf(name)
    const base = ext ? name.slice(0, -ext.length - 1) : name
    if (ext === "pdf" && (has.has(base + ".pptx") || has.has(base + ".ppt"))) continue
    const twin = ext === "pptx" || ext === "ppt" ? files.find((x) => x.name === `brief/${base}.pdf`) : null
    docs.push({ id: f.name, ext: twin ? "pdf" : ext, show: twin || f })
  }
  return docs
}

// ---------- the right tab: one artifact beside the main view ----------

// open the planning document on the right when nothing is there yet and the
// person has not closed the right tab in this run: key if it is one, else
// the first document of brief/. True when it opened one.
function autoSide(run, key) {
  if (sel.side || sideOff.has(`${run.project}/${run.slug}`)) return false
  const docs = briefDocs(run)
  const k = docs.some((d) => d.id === key) ? key : docs.length ? docs[0].id : null
  if (!k) return false
  sel.side = k
  sideAt = { page: null, req: null }
  return true
}

function openSide(key, page = null, req = null) {
  sel.side = key
  sideAt = { page, req }
  renderSide(findRun(sel.project, sel.slug))
  writeHash()
}

function closeSide() {
  sel.side = null
  sideOff.add(`${sel.project}/${sel.slug}`)
  renderSide(null)
  writeHash()
  if (drawn && ui.row !== null && ui.row !== undefined) {
    ui.row = null
    paint()
  }
}

// how the right tab shows an artifact: its HTML, else its markdown, else the
// file. A .pptx shows the PDF of the same name and offers itself as a download.
function sideDoc(run, a) {
  if (a.html) return { file: a.html, how: "frame" }
  if (a.md) return { file: a.md, how: "md" }
  let ext = a.ext, file = a.file, dl = null
  if (ext === "pptx" || ext === "ppt") {
    const twin = run.files.find((x) => x.name === a.file.name.slice(0, -ext.length) + "pdf")
    if (twin) { file = twin; dl = a.file; ext = "pdf" }
  }
  const how = IMAGE.has(ext) ? "img" : ext === "pdf" || ext === "html" || ext === "htm" || VIEWABLE.has(ext) ? "frame" : "dl"
  return { file, dl, ext, how }
}

function renderSide(run) {
  const aside = $("side")
  const a = run && sel.side ? run.arts.find((x) => x.key === sel.side && !x.none) : null
  $("work").classList.toggle("one", !a)
  aside.hidden = $("grip").hidden = !a
  if (!a) {
    aside._sig = null
    aside._doc = null
    closePdf(aside)
    aside.innerHTML = ""
    return
  }
  const d = sideDoc(run, a)
  const page = d.ext === "pdf" ? sideAt.page : null
  const url = fileUrl(run, d.file.name)
  // beside 1-mockup.html a PDF is drawn by pdf.js, every page in one column,
  // and a page asked for is scrolled to; elsewhere the browser's viewer opens it
  const own = d.ext === "pdf" && $("work").classList.contains("left")
  const sig = [run.project, run.state, run.slug, a.key, own ? "pdf.js" : page].join("/")
  const ver = `${d.file.mtime}:${d.file.size}`
  aside._doc = d.file.name
  // the viewer is rebuilt only when it shows something else, so a PDF keeps
  // its place; a changed file is reloaded where it is scrolled to
  if (aside._sig !== sig) {
    aside._sig = sig
    aside._ver = ver
    aside._at = null
    closePdf(aside)
    let view
    if (own) view = `<div class="pdfv"></div>`
    else if (d.how === "frame") view = `<iframe src="${url}${page ? `#page=${page}` : ""}" title="${esc(d.file.name)}"></iframe>`
    else if (d.how === "img") view = `<div class="bimg"><div class="pgc"><img src="${url}" alt="${esc(d.file.name)}"><div class="bxs"></div></div></div>`
    else if (d.how === "md") view = `<div class="doc"></div>`
    else {
      const [act, label] = fileAct(d.file.name)
      view = `<div class="dl"><span class="fn">${esc(d.file.name)}</span><span class="meta">${fmtSize(d.file.size)}</span><a class="btn" href="${url}" ${act}>${label}</a></div>`
    }
    aside.innerHTML = `<div class="bhead"></div><div class="bview${own ? " own" : ""}">${view}</div><div class="bft"></div>`
    if (own) openPdf(aside, url)
    if (d.how === "md") sideMd(run, d.file, aside, sig, false)
    // beside 1-mockup.html an image is shown large on a click, as a PDF page is
    if (d.how === "img") {
      aside.querySelector(".bimg .pgc").addEventListener("click", (e) => {
        if (e.target.closest(".bpin") || !$("work").classList.contains("left")) return
        openZoom({ img: aside.querySelector(".bimg img").src, doc: aside._doc })
      })
    }
  } else if (aside._ver !== ver) {
    aside._ver = ver
    if (own) {
      const at = aside._pdf.cur
      closePdf(aside)
      aside.querySelector(".pdfv").innerHTML = ""
      openPdf(aside, url).go(at)
    } else if (d.how === "md") sideMd(run, d.file, aside, sig, true)
    else if (d.how === "frame") reloadFrame(aside.querySelector("iframe"))
    else if (d.how === "img") aside.querySelector("img").src = `${url}?v=${enc(ver)}`
  }
  if (own && aside._at !== sideAt) {
    aside._at = sideAt
    if (page) aside._pdf.go(page)
  }
  // a planning document among several shows them all as tabs
  const docs = briefDocs(run)
  const name = docs.length > 1 && docs.some((x) => x.id === a.key)
    ? `<span class="btabs">${docs.map((x) => `<button type="button" class="btab${x.id === a.key ? " on" : ""}" data-btab="${esc(x.id)}" title="${esc(x.id)}">${esc(baseOf(x.id))}</button>`).join("")}</span>`
    : `<span class="fn" title="${esc(d.file.name)}">${esc(d.file.name)}</span>`
  const head = `<div class="bhd">${name}` +
    (own ? `<span class="pg" data-pdfpg>${aside._pdf.label()}</span>` : page ? `<span class="pg">${page}쪽</span>` : "") +
    `<a href="${url}" target="_blank" rel="noopener">새 탭 ↗</a>` +
    `<button type="button" class="bx" data-sidex title="${$("work").classList.contains("left") ? "기획서 닫기" : "우측 탭 닫기"}">×</button></div>`
  const [dlAct, dlLabel] = d.dl ? fileAct(d.dl.name) : []
  const foot = [
    sideAt.req ? `<span>선택한 줄: <b>${Md.inline(sideAt.req, { href: (u) => u })}</b></span>` : "",
    d.dl ? `<span>원본 <a href="${fileUrl(run, d.dl.name)}" ${dlAct}>${esc(baseOf(d.dl.name))}</a> ${dlLabel}</span>` : "",
  ].filter(Boolean).join("")
  // while a comment's basis box is being picked
  const boxes = own || d.how === "img"
  const hint = !$("work").classList.contains("left") || pickingBasis(run) === null ? ""
    : `<div class="bpick">${boxes ? `코멘트 ${cm.basis}의 근거: 쪽을 눌러 크게 본 뒤 끌어서 상자를 그리세요.` : "이 문서에는 근거 상자를 그릴 수 없습니다. PDF나 이미지 기획서를 고르세요."} Esc 취소</div>`
  setHTML(aside.querySelector(".bhead"), head + hint)
  setHTML(aside.querySelector(".bft"), foot)
  aside.querySelector(".bft").hidden = !foot
  paintBoxes(run)
}

// ----- the comments' basis boxes on the planning documents (PDF or image) -----

const boxable = (d) => d.ext === "pdf" || IMAGE.has(d.ext)
// the planning document a comment's basis box is on
const basisDocOf = (run, c) => (c.basis ? briefDocs(run).find((x) => x.show.name === c.basis.doc || x.id === c.basis.doc) : null)

// the n of the draft whose basis box is being picked, or null; picking ends
// when that comment is gone, no longer a draft, or cannot be changed
function pickingBasis(run) {
  if (cm.basis !== null && !(canComment(run) && commentsOfRun(run).some((c) => c.n === cm.basis && c.status === "draft"))) cm.basis = null
  return cm.basis
}

const boxStyle = (b) => `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`

// the boxes of the document beside the mockup, on its pages in the column
// and on the page shown large; a box asked for is scrolled to and flashed
function paintBoxes(run) {
  const aside = $("side")
  const name = $("work").classList.contains("left") ? aside._doc : null
  const list = run && name ? commentsOfRun(run).filter((c) => c.basis && c.basis.doc === name) : []
  for (const host of document.querySelectorAll("#side .bxs, #pzoom .bxs")) {
    const page = host.dataset.page ? Number(host.dataset.page) : undefined
    const here = list.filter((c) => c.basis.page === page)
    setHTML(host, here.map((c) => {
      const st = c.status === "done" || c.status === "declined" ? c.status : ""
      return `<div class="bbox ${st}${cm.on === c.n ? " on" : ""}" data-bn="${c.n}" style="${boxStyle(c.basis)}">` +
        `<button type="button" class="bpin ${st}" data-bn="${c.n}" title="코멘트 ${c.n}">${c.n}</button></div>`
    }).join(""))
    const f = cm.flash !== null && host.closest("#side") ? host.querySelector(`.bbox[data-bn="${cm.flash}"]`) : null
    if (f) {
      cm.flash = null
      f.scrollIntoView({ block: "center" })
      f.classList.add("flash")
    }
  }
}

// the document of a comment's basis box in the column, scrolled to the box
function showBasis(run, c) {
  const d = basisDocOf(run, c)
  if (!d) return
  cm.flash = c.n
  const page = Number.isInteger(c.basis.page) ? c.basis.page : null
  if (sel.side !== d.id) return openSide(d.id, page)
  const pdf = $("side")._pdf
  if (pdf && page) pdf.go(page)
  paintBoxes(run)
}

// pick the basis box of draft c: the column shows a document a box can be
// drawn on, and a page shown large takes the box
function startBasis(run, c) {
  cm.basis = c.n
  cm.on = c.n
  renderPanel(run)
  const docs = briefDocs(run).filter(boxable)
  if (docs.some((d) => d.id === sel.side)) return renderSide(run)
  const d = basisDocOf(run, c) || docs[0]
  if (d) openSide(d.id, c.basis && Number.isInteger(c.basis.page) ? c.basis.page : null)
}

function stopBasis(run) {
  cm.basis = null
  renderSide(run)
  renderPanel(run)
}

// the text of a PDF page inside box b (fractions of the page), in the
// order pdf.js reads it; "" when there is none
async function textIn(page, b) {
  try {
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    let s = ""
    for (const it of tc.items) {
      if (typeof it.str !== "string" || !it.transform) continue
      const [x, y] = vp.convertToViewportPoint(it.transform[4] + it.width / 2, it.transform[5] + it.height / 2)
      const fx = x / vp.width, fy = y / vp.height
      if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) s += it.str + (it.hasEOL ? " " : "")
    }
    return s.replace(/\s+/g, " ").trim().slice(0, 500)
  } catch {
    return ""
  }
}

// a drag on the page shown large draws the basis box of the comment being
// picked; on release the box is saved and the page closes
function drawOn(host, src) {
  const tmp = host.querySelector(".bdraw")
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const at = (e) => {
    const r = host.getBoundingClientRect()
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]
  }
  const rect = (a, b) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) })
  let from = null
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".bpin")) return
    e.preventDefault()
    host.setPointerCapture(e.pointerId)
    from = at(e)
  })
  host.addEventListener("pointermove", (e) => {
    if (from) setHTML(tmp, `<div class="bbox tmp" style="${boxStyle(rect(from, at(e)))}"></div>`)
  })
  host.addEventListener("pointerup", async (e) => {
    if (!from) return
    const b = rect(from, at(e))
    from = null
    setHTML(tmp, "")
    // a click, not a drag
    if (b.w < 0.01 || b.h < 0.01) return
    const run = findRun(sel.project, sel.slug)
    const c = run && commentsOfRun(run).find((x) => x.n === pickingBasis(run))
    if (!c) return closeZoom()
    const quote = src.page ? await textIn(src.page, b) : ""
    closeZoom()
    cm.basis = null
    cm.flash = c.n
    renderSide(run)
    postComment(run, { op: "basis", id: c.id, basis: { doc: src.doc, ...(src.page ? { page: src.n } : {}), ...b, quote } })
  })
}

// ----- planning documents drawn by pdf.js (vendor/pdfjs, loaded on first use) -----

let pdfjs = null

function pdfLib() {
  return pdfjs || (pdfjs = new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "vendor/pdfjs/pdf.min.js"
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js"
      resolve(window.pdfjsLib)
    }
    s.onerror = () => {
      pdfjs = null
      reject(new Error("pdf.js"))
    }
    document.head.appendChild(s)
  }))
}

// the PDF at url drawn into the side tab's .pdfv: each page under a 「기획서 ·
// p.N / 전체」 label, painted as it nears the view; the column head follows
// the page at the top. aside._pdf: { cur, label(), go(n), close() }
function openPdf(aside, url) {
  const box = aside.querySelector(".pdfv")
  const st = { cur: 1, total: 0, want: null, closed: false, task: null, io: null, pages: [] }
  const head = () => {
    const pg = aside.querySelector("[data-pdfpg]")
    if (pg) pg.textContent = st.label()
  }
  st.label = () => (st.total ? `p.${st.cur} / ${st.total}` : "")
  st.go = (n) => {
    const sec = st.pages[n - 1]
    if (!sec) return void (st.want = n)
    st.want = null
    // the head names the page asked for, even when the last pages cannot
    // scroll up to the top
    const was = box.scrollTop
    box.scrollTop = sec.offsetTop - 12
    st.skip = box.scrollTop !== was
    st.cur = n
    head()
  }
  st.close = () => {
    st.closed = true
    if (st.io) st.io.disconnect()
    if (st.task) st.task.destroy()
  }
  const paint = (sec) => {
    if (sec._painted) return
    sec._painted = true
    const vp = sec._page.getViewport({ scale: 1 })
    const scale = Math.min(4, ((box.clientWidth - 28) * devicePixelRatio) / vp.width)
    const v = sec._page.getViewport({ scale })
    const c = sec.querySelector("canvas")
    c.width = Math.floor(v.width)
    c.height = Math.floor(v.height)
    sec._page.render({ canvasContext: c.getContext("2d"), viewport: v })
  }
  box.addEventListener("scroll", () => {
    if (st.closed) return
    if (st.skip) {
      st.skip = false
      return
    }
    let cur = 1
    for (const [i, sec] of st.pages.entries()) if (sec.offsetTop - box.scrollTop < 80) cur = i + 1
    if (cur !== st.cur) {
      st.cur = cur
      head()
    }
  })
  box.addEventListener("click", (e) => {
    const sec = e.target.closest(".pg")
    if (!st.closed && sec && sec._page && !e.target.closest(".bpin")) openZoom({ page: sec._page, n: st.pages.indexOf(sec) + 1, total: st.total, doc: aside._doc })
  })
  aside._pdf = st
  ;(async () => {
    try {
      const lib = await pdfLib()
      if (st.closed) return
      st.task = lib.getDocument({ url })
      const doc = await st.task.promise
      st.total = doc.numPages
      st.io = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) paint(x.target) }, { root: box, rootMargin: "100% 0px" })
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        if (st.closed) return
        const vp = page.getViewport({ scale: 1 })
        const sec = document.createElement("div")
        sec.className = "pg"
        sec.title = "크게 보기"
        sec.innerHTML = `<div class="lab"><b>기획서</b> · p.${n} / ${doc.numPages}</div>` +
          `<div class="pgc"><canvas style="aspect-ratio: ${vp.width} / ${vp.height}"></canvas><div class="bxs" data-page="${n}"></div></div>`
        sec._page = page
        box.appendChild(sec)
        st.pages.push(sec)
        st.io.observe(sec)
        if (st.want === n) st.go(n)
        paintBoxes(findRun(sel.project, sel.slug))
      }
      head()
    } catch {
      if (!st.closed) box.innerHTML = `<div class="empty">기획서를 그리지 못했습니다.</div>`
    }
  })()
  return st
}

function closePdf(aside) {
  closeZoom()
  if (aside._pdf) aside._pdf.close()
  aside._pdf = null
}

// one page large over the planning documents and the mockup, with its basis
// boxes; while a basis box is picked, a drag on it draws one. src: { page,
// n, total, doc } for a PDF page, { img, doc } for an image. Esc or a click
// outside the page closes it
function openZoom(src) {
  closeZoom()
  const run = findRun(sel.project, sel.slug)
  const pick = pickingBasis(run)
  const z = document.createElement("div")
  z.id = "pzoom"
  z.className = "pzoom"
  z.style.right = `${$("cpanel").hidden ? 0 : $("cpanel").offsetWidth}px`
  const lab = src.page ? `p.${src.n} / ${src.total}` : esc(baseOf(src.doc))
  z.innerHTML = `<div class="pzbox"><div class="lab"><b>기획서</b> · ${lab}<button type="button" class="evx" title="닫기 (Esc)">×</button></div>` +
    (pick !== null ? `<div class="zhint">끌어서 코멘트 ${pick}의 근거 상자를 그리세요. Esc 취소</div>` : "") +
    `<div class="pgc zpg${pick !== null ? " can" : ""}">${src.page ? "<canvas></canvas>" : `<img src="${esc(src.img)}" alt="">`}` +
    `<div class="bxs"${src.page ? ` data-page="${src.n}"` : ""}></div><div class="bdraw"></div></div></div>`
  $("work").appendChild(z)
  if (src.page) {
    const vp = src.page.getViewport({ scale: 1 })
    const v = src.page.getViewport({ scale: Math.min(6, ((z.clientWidth - 64) * devicePixelRatio) / vp.width) })
    const c = z.querySelector("canvas")
    c.width = Math.floor(v.width)
    c.height = Math.floor(v.height)
    src.page.render({ canvasContext: c.getContext("2d"), viewport: v })
  }
  if (pick !== null) drawOn(z.querySelector(".zpg"), src)
  paintBoxes(run)
}

function closeZoom() {
  const z = $("pzoom")
  if (z) z.remove()
  return !!z
}

async function sideMd(run, file, aside, sig, keep) {
  let src
  try {
    src = await (await fetch(fileUrl(run, file.name), { cache: "no-store" })).text()
  } catch {
    return
  }
  if (aside._sig !== sig) return
  const box = aside.querySelector(".bview")
  const top = box.scrollTop
  const k = file.name.lastIndexOf("/")
  box.querySelector(".doc").innerHTML = Md.render(src, { href: linkHref(run, file.name.slice(0, k + 1)) })
  if (keep) box.scrollTop = top
}

// ----- land -----

// 6-land.md: the fenced message under ## 커밋 메시지, and ## 스테이징 as
// [{ repo, files }]. Staging lines are "- <repo>: <path>, <path>" (older runs)
// or one file per line under a repository line or heading.
function landOf(src) {
  const secs = sectionsOf(src)
  let message = null
  const msg = secs.get("커밋 메시지")
  if (msg) {
    const at = msg.findIndex((l) => /^\s*(`{3,}|~{3,})/.test(l))
    if (at >= 0) {
      const mark = /^\s*(`{3,}|~{3,})/.exec(msg[at])[1]
      const end = msg.findIndex((l, k) => k > at && l.trim().startsWith(mark))
      message = msg.slice(at + 1, end < 0 ? undefined : end).join("\n")
    }
  }
  const staging = []
  const unq = (t) => t.trim().replace(/^`(.*)`$/, "$1").trim()
  const lines = (secs.get("스테이징") || []).filter((l) => l.trim())
  let cur = null
  lines.forEach((l, i) => {
    const h = /^#{3,6}\s+(.*)$/.exec(l)
    const m = /^(\s*)[-*+]\s+(.*)$/.exec(l)
    if (h) return staging.push((cur = { repo: unq(h[1]).replace(/:$/, ""), files: [] }))
    if (!m) return
    const text = m[2].trim()
    // "- <repo>: <path>, <path>", "- <repo>:", or "- <repo>" with indented files below
    const c = /^(.*?):(?:\s+(.*))?$/.exec(text)
    const nested = i + 1 < lines.length && /^\s+[-*+]\s/.test(lines[i + 1])
    if (!m[1] && (c || nested)) {
      staging.push((cur = { repo: unq(c ? c[1] : text), files: c && c[2] ? c[2].split(/,\s*/).map(unq).filter(Boolean) : [] }))
    } else if (cur) cur.files.push(unq(text))
  })
  return { message, staging }
}

// the repository folder name of a main tree or worktree path
function repoName(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  const k = parts.lastIndexOf("worktrees")
  return k >= 2 && parts[k - 1] === ".claude" ? parts[k - 2] : parts.pop() || p
}

// 2-plan.md ## 넘길 것: file name -> what the person does with it
function handoffOf(plan) {
  const out = new Map()
  if (!plan) return out
  let cur = null
  for (const l of sectionsOf(plan).get("넘길 것") || []) {
    const h = /^###\s+(.*)$/.exec(l)
    if (h) {
      const name = baseOf(h[1].replace(/\s*(—\s*새 파일|\(새 파일\))\s*$/, "").trim().replace(/^`(.*)`$/, "$1"))
      out.set(name, (cur = []))
    } else if (cur) cur.push(l)
  }
  return out
}

function drawLand(pane, d) {
  const { run, src } = d
  const { message, staging } = landOf(src)
  const land = run.land
  if (message === null && !land) {
    pane.innerHTML = `<div class="sdoc"><div class="doc">${Md.render(src, { href: linkHref(run) })}</div></div>`
    return
  }
  const trees = (run.summary && run.summary.trees) || []
  const repos = land
    ? land.repos.map((r) => ({ name: repoName(r.repo), branch: r.branch, files: r.files, left: r.left }))
    : staging.map((s) => {
      const name = repoName(s.repo)
      const t = trees.find((x) => x.repo === name)
      return { name, branch: t ? t.base : null, files: s.files.map((p) => ({ path: p, status: null, add: null, del: null })), left: null }
    })
  const result = land && land.result
  const files = repos.flatMap((r) => r.files)
  const add = files.reduce((n, f) => n + (f.add || 0), 0)
  const del = files.reduce((n, f) => n + (f.del || 0), 0)
  const counted = files.some((f) => f.add !== null || f.del !== null)
  const left = repos.flatMap((r) => r.left || [])
  const todo = handoffOf(d.plan)
  const hfiles = run.files.filter((f) => f.name.startsWith("handoff/"))
  const hnames = [...new Set([...hfiles.map((f) => f.name.slice(8)), ...todo.keys()])]
  const xlsx = run.files.filter((f) => !f.name.includes("/") && extOf(f.name) === "xlsx")
  const md = (t) => Md.render(t, { href: linkHref(run) })

  const where = result
    ? result.map((r) => `<div class="v"><span class="hash" title="${esc(r.commit)}">${esc(r.commit.slice(0, 7))}</span> <span class="s">${esc(r.branch)} ← ${esc(repoName(r.repo))}</span></div>`).join("")
    : repos.map((r) => `<div class="v">${r.branch ? `${esc(r.branch)} <span class="s">← ${esc(r.name)}</span>` : esc(r.name)}</div>`).join("")
  const strip = `<div class="lstrip">` +
    `<div><div class="k">${result ? "커밋함" : "어디로"}</div>${where}</div>` +
    `<div><div class="k">커밋</div><div class="v">${files.length}개${counted ? ` <span class="add">+${add}</span> <span class="del">−${del}</span>` : ""}</div></div>` +
    `<div><div class="k">남는 파일</div><div class="v">${land ? left.length : "—"}</div></div>` +
    `<div><div class="k">넘길 파일</div><div class="v">${hnames.length}</div></div></div>`

  let l = ""
  if (result) {
    l += `<div class="lres">${result.map((r) => `<div><b>${esc(repoName(r.repo))}</b> · ${esc(r.branch)} · <span class="mono">${esc(r.commit.slice(0, 7))}</span> 커밋함 · ` +
      (r.removed ? "워크트리 정리함" : `워크트리 남음${r.folder ? `: <span class="mono">${esc(r.folder)}</span>` : ""}`) + `</div>`).join("")}</div>`
  }
  if (message !== null) l += `<div class="lh">커밋 메시지<button type="button" data-copy>복사</button></div><pre class="cmsg">${esc(message)}</pre>`
  if (hnames.length) {
    l += `<div class="lh">넘길 파일 <span class="s">handoff/</span></div>` + hnames.map((n) => {
      const f = hfiles.find((x) => x.name === "handoff/" + n)
      const what = todo.get(n)
      return `<div class="hcard"><div class="top"><span class="ftag">${esc(extOf(n).toUpperCase() || "FILE")}</span><span class="nm">${esc(n)}</span>` +
        (!f ? `<span class="go s">파일 없음</span>`
          : fileAct(f.name)[0] === "data-open" ? `<a class="go" href="${fileUrl(run, f.name)}" data-open title="이 PC에서 열기">↗</a>`
          : `<a class="go" href="${fileUrl(run, f.name)}" target="_blank" rel="noopener" title="새 탭에서 열기">↗</a>`) + `</div>` +
        (what && what.some((x) => x.trim()) ? `<div class="hb">${md(what.join("\n"))}</div>` : "") + `</div>`
    }).join("")
  }
  for (const f of xlsx) {
    const [act, label] = fileAct(f.name)
    l += `<a class="xl" href="${fileUrl(run, f.name)}" ${act}><span class="ftag x">XLSX</span>${esc(f.name)}<span class="s">${label}</span></a>`
  }

  const TAG = { A: "추가", M: "수정", D: "삭제" }
  const row = (p, f) => {
    const k = p.lastIndexOf("/")
    const nums = f ? (f.add === null && f.del === null && f.status ? `<span class="s">바이너리</span><span></span>` : `<span class="add">${f.add ? `+${f.add}` : ""}</span><span class="del">${f.del ? `−${f.del}` : ""}</span>`) : "<span></span><span></span>"
    return `<div class="lf"><span class="ltag ${f && f.status ? f.status : "n"}">${f && f.status ? TAG[f.status] || f.status : ""}</span>` +
      `<span class="nm">${esc(p.slice(k + 1))}${k > 0 ? `<span class="dir">${esc(p.slice(0, k + 1))}</span>` : ""}</span>${nums}</div>`
  }
  let r = `<div class="lh">커밋할 파일</div>`
  for (const x of repos) {
    r += `<div class="lrepo"><div class="lrh"><span>${esc(x.name)}</span>${x.branch ? `<span class="s">→</span><span class="br">${esc(x.branch)}</span>` : ""}</div>` +
      (x.files.length ? x.files.map((f) => row(f.path, f)).join("") : `<div class="lf none">없음</div>`) + `</div>`
  }
  if (left.length) {
    const tree = trees.some((t) => t.branch)
    r += `<div class="lh">남는 파일 <span class="s">커밋 안 함${tree ? " · 워크트리와 함께 사라짐" : ""}</span></div>`
    for (const x of repos.filter((x) => x.left && x.left.length)) {
      r += `<div class="lrepo left">${repos.length > 1 ? `<div class="lrh"><span>${esc(x.name)}</span></div>` : ""}${x.left.map((p) => row(p, null)).join("")}</div>`
    }
  }
  pane.innerHTML = `${strip}<div class="lcols"><div class="lcol">${l}</div><div class="lcol">${r}</div></div>`
}

// ---------- 5-checklist.md: who ticked a check, and its evidence ----------

// the mark the hook leaves at the end of a check's title line when it ticks
// it: a link to the evidence (an ego one may be followed by " · 사용한 데이터:
// …"), or plain words in older runs
const TICK = /\s\((?:\[([^\]]+)\]\(([^)\s]+)\)(?: · (.*))?|(ego 통과|aside 통과|이전 통과 유지 — .*|사용자가 기존 동작으로 판단))\)\s*$/

// Md item hook: a check's title line gets a badge of who passed it
function checkItem(text, body) {
  if (!/^\*\*/.test(text)) return null
  const m = TICK.exec(text)
  let kind, why = "", link = null
  if (m) {
    why = m[1] || m[4]
    link = m[1] ? m[2] : null
    kind = /^ego 통과/.test(why) ? "ego" : /^aside 통과/.test(why) ? "aside" : /^이전 통과 유지/.test(why) ? "keep" : /^사용자가 기존 동작/.test(why) ? "person" : null
    if (!kind) return null
    text = text.slice(0, m.index)
  } else {
    // no mark and every box checked: the person checked it
    const boxes = body.map((l) => /^\s*[-*+]\s+\[([ xX])\]/.exec(l.s)).filter(Boolean)
    if (!boxes.length || boxes.some((b) => b[1] === " ")) return null
    kind = "person"
    why = "사람이 직접 체크함"
  }
  const t = /^\*\*(.+?)\*\*/.exec(text)
  const n = /`([^`]+)`\s*$/.exec(text)
  const title = t ? t[1] : text
  const name = n ? n[1] : title
  const label = kind === "keep" ? `유지 · ${/파일 변경 없음/.test(why) ? "파일 변경 없음" : "영향 없음 판정"}` : kind === "person" ? "사람" : kind
  const attrs = `class="bdg ${kind}" title="${esc(m && m[3] ? `${why} · ${m[3]}` : why)}"`
  const badge = link
    ? `<button type="button" ${attrs} data-ev="${esc(link)}" data-title="${esc(title)}" data-name="${esc(name)}">${esc(label)} ↗</button>`
    : `<span ${attrs}>${esc(label)}</span>`
  return [text, badge]
}

let ev = null // the evidence modal: { kind, lines, i, shot, ... }

const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }
const SHOT = /[\w.-]+\.(?:png|jpe?g|webp|gif|json|txt|log|mjs)\b/gi

// judge.md's "- <expectation>: <verdict> — <why>" lines
function judgeLines(src) {
  return src.replace(/\r/g, "").split("\n").filter((l) => /^[-*]\s+/.test(l)).map((l) => {
    const t = l.replace(/^[-*]\s+/, "")
    const m = /^(.+?):\s*([^:—]{1,12}?)\s+—\s+(.*)$/.exec(t)
    if (!m) return { expect: t, verdict: "", why: "", files: [] }
    return { expect: m[1], verdict: m[2].trim(), why: m[3], files: [...new Set(m[3].match(SHOT) || [])] }
  })
}

async function openEvidence(run, link, title, name) {
  const k = link.indexOf("#")
  const segs = (k < 0 ? link : link.slice(0, k)).split("/").map(dec)
  const frag = k < 0 ? null : dec(link.slice(k + 1))
  const path = segs.join("/")
  let kind = null
  if (segs[0] === "agent" && segs[1] === "evidence" && segs[segs.length - 1] === "judge.md") kind = "ego"
  else if (path === "agent/e2e.md" && frag) kind = "aside"
  if (!kind) return window.open(fileUrl(run, path), "_blank", "noopener")
  ev = { run, kind, title, name, path, i: 0, shot: null, error: null }
  drawEvidence()
  try {
    const res = await fetch(fileUrl(run, path), { cache: "no-store" })
    if (!res.ok) throw new Error(String(res.status))
    const src = await res.text()
    if (!ev || ev.path !== path) return
    const when = Date.parse(res.headers.get("last-modified"))
    ev.when = isNaN(when) ? null : when
    if (kind === "ego") {
      ev.dir = segs.slice(0, -1).join("/")
      ev.attempt = segs[segs.length - 2]
      ev.lines = judgeLines(src)
      const v = /^판정\s*[:：]\s*(.+)$/m.exec(src)
      ev.verdict = v ? v[1].trim() : ""
    } else {
      // the "### <name>" section of e2e.md
      const lines = src.replace(/\r/g, "").split("\n")
      const at = lines.findIndex((l) => /^###\s+/.test(l) && l.replace(/^###\s+/, "").trim() === frag)
      if (at < 0) throw new Error("no section")
      let end = at + 1
      while (end < lines.length && !/^#{1,3}\s/.test(lines[end])) end++
      ev.section = lines.slice(at + 1, end).join("\n")
      const a = new RegExp(`evidence/${frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/\\s]+)/`).exec(ev.section)
      ev.attempt = a ? a[1] : null
      ev.dir = a ? `agent/evidence/${frag}/${a[1]}` : null
      const v = /^-\s*결과\s*[:：]\s*(.+)$/m.exec(ev.section)
      ev.verdict = v ? v[1].trim() : ""
    }
  } catch {
    if (ev && ev.path === path) ev.error = "증거 파일을 읽지 못했습니다"
  }
  if (ev && ev.path === path) drawEvidence()
}

function closeEvidence() {
  ev = null
  const m = $("evm")
  if (m) m.remove()
}

const isImg = (n) => IMAGE.has(extOf(n))

function drawEvidence() {
  let m = $("evm")
  if (!m) {
    m = document.createElement("div")
    m.id = "evm"
    m.className = "evm"
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest(".evx")) return closeEvidence()
      const i = e.target.closest("[data-evi]")
      if (i) { ev.i = Number(i.dataset.evi); ev.shot = null; return drawEvidence() }
      const s = e.target.closest("[data-shot]")
      if (s) { ev.shot = s.dataset.shot; drawEvidence() }
    })
    document.body.appendChild(m)
  }
  const { run } = ev
  const meta = [ev.name !== ev.title ? ev.name : "", ev.attempt ? `시도 ${ev.attempt}` : "", ev.when ? fmtDate(ev.when) : ""].filter(Boolean).join(" · ")
  const links = (ev.kind === "ego" ? `<a href="${fileUrl(run, ev.path)}" target="_blank" rel="noopener">judge.md ↗</a>` : `<a href="${fileUrl(run, ev.path)}" target="_blank" rel="noopener">e2e.md ↗</a>`) +
    (ev.dir ? `<a href="${fileUrl(run, ev.dir)}" target="_blank" rel="noopener">증거 폴더 ↗</a>` : "")
  const head = `<div class="evhd"><span class="bdg ${ev.kind}">${ev.kind}${ev.verdict ? ` ${esc(ev.verdict)}` : ""}</span><b>${esc(ev.title)}</b>` +
    `<span class="meta">${esc(meta)}</span><span class="sp"></span>${links}<button type="button" class="evx" title="닫기 (Esc)">×</button></div>`
  let body
  if (ev.error) body = `<div class="empty">${esc(ev.error)}</div>`
  else if (ev.kind === "aside" && ev.section !== undefined) {
    body = `<div class="evdoc"><div class="doc">${Md.render(ev.section, { href: linkHref(run, "agent/") })}</div></div>`
  } else if (ev.kind === "ego" && ev.lines) {
    const at = (f) => fileUrl(run, `${ev.dir}/${f}`)
    const mark = (v) => (v === "통과" ? `<span class="v ok">✓</span>` : v === "실패" ? `<span class="v bad">✗</span>` : `<span class="v unk">?</span>`)
    const list = ev.lines.map((x, i) => `<button type="button" class="evi${i === ev.i ? " on" : ""}" data-evi="${i}">${mark(x.verdict)}` +
      `<span class="t">${Md.inline(x.expect, { href: (u) => u })}</span>${x.files.length ? `<span class="f">${x.files.map(esc).join(" · ")}</span>` : ""}</button>`).join("")
    const x = ev.lines[ev.i]
    let right = `<div class="empty">기대 줄이 없습니다</div>`
    if (x) {
      const shots = x.files.filter(isImg)
      const big = ev.shot && x.files.includes(ev.shot) ? ev.shot : shots[0]
      const bigHtml = big
        ? `<a class="evbig" href="${at(big)}" target="_blank" rel="noopener" title="원본 크기로 보기"><img src="${at(big)}" alt="${esc(big)}"></a>`
        : `<div class="evbig"><span class="none">스크린샷 없음</span></div>`
      const thumbs = x.files.map((f) => isImg(f)
        ? `<button type="button" class="th${f === big ? " on" : ""}" data-shot="${esc(f)}" title="${esc(f)}"><img src="${at(f)}" alt="${esc(f)}"></button>`
        : `<a class="th file" href="${at(f)}" target="_blank" rel="noopener" title="${esc(f)}">${esc(f)}</a>`).join("")
      right = `${bigHtml}<div class="evvs"><b>${esc(x.verdict || "판정 없음")}</b>${x.why ? ` — ${Md.inline(x.why, { href: (u) => u })}` : ""}</div>${thumbs ? `<div class="evth">${thumbs}</div>` : ""}`
    }
    body = `<div class="evbd"><div class="evl">${list}</div><div class="evr">${right}</div></div>`
  } else body = `<div class="empty">불러오는 중…</div>`
  const top = m.querySelector(".evl") ? m.querySelector(".evl").scrollTop : 0
  m.innerHTML = `<div class="evbox" role="dialog" aria-modal="true">${head}${body}</div>`
  const l = m.querySelector(".evl")
  if (l) {
    l.scrollTop = top
    const on = l.querySelector(".evi.on")
    if (on) on.scrollIntoView({ block: "nearest" })
  }
}

// keys while the modal is open: ↑↓ move between lines, Esc closes
function evKey(e) {
  if (e.key === "Escape") { closeEvidence(); return true }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && ev.lines && ev.lines.length) {
    e.preventDefault()
    ev.i = Math.max(0, Math.min(ev.lines.length - 1, ev.i + (e.key === "ArrowDown" ? 1 : -1)))
    ev.shot = null
    drawEvidence()
    return true
  }
  return false
}

// elapsed times that count up: the current stage and calls in flight
function tick() {
  const now = Date.now() + skew
  document.querySelectorAll("[data-from]").forEach((el) => { el.textContent = fmtElapsed(now - Number(el.dataset.from)) })
  document.querySelectorAll("[data-since]").forEach((el) => { el.textContent = fmtClock(now - Number(el.dataset.since)) })
  document.querySelectorAll("[data-age]").forEach((el) => { el.textContent = fmtAge(now - Number(el.dataset.age)) })
}

$("arail").addEventListener("click", (e) => {
  if (e.target.closest("[data-allruns]")) {
    if (sel.list) return
    lastRun = { ...sel }
    sel = { project: null, slug: null, key: null, view: null, side: null, list: true }
    return render()
  }
  if (!e.target.closest("[data-mode]") || !sel.list) return
  // the run left for the all-runs page, unless its tab was closed since
  const back = lastRun && rtabs.open.includes(`${lastRun.project}/${lastRun.slug}`)
  sel = back ? { ...lastRun, list: false } : { project: null, slug: null, key: null, view: null, side: null, list: false }
  render()
})

// ---------- events ----------

function pick(project, slug) {
  sel = { project, slug, key: null, view: null, side: null, list: false }
  render()
}

$("tabs").addEventListener("click", (e) => {
  const x = e.target.closest("[data-rtabx]")
  if (x) return closeRtab(x.dataset.rtabx)
  const t = e.target.closest(".rtab")
  if (t) pick(t.dataset.p, t.dataset.s)
})

// the run tabs scroll sideways under a mouse wheel too
$("tabs").addEventListener("wheel", (e) => {
  const el = $("tabs")
  if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}, { passive: false })

$("theme").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark"
  document.documentElement.dataset.theme = theme
  lsSet("rein.theme", theme)
  renderTop(findRun(sel.project, sel.slug), openRuns())
})

$("runs").addEventListener("click", (e) => {
  const f = e.target.closest("[data-rf]")
  if (f) {
    rv.filter = f.dataset.rf || null
    return renderRuns()
  }
  const g = e.target.closest("[data-fold]")
  if (g) {
    folded[g.dataset.fold] = !folded[g.dataset.fold]
    return renderRuns()
  }
  const m = e.target.closest("[data-more]")
  if (m) {
    rv.more.add(m.dataset.more)
    return renderRuns()
  }
  const r = e.target.closest(".rcard")
  if (r) pick(r.dataset.p, r.dataset.s)
})

document.addEventListener("click", (e) => {
  $("cmenu").hidden = true
  // a page shown large closes on a click anywhere but on it
  if (!e.target.closest("#pzoom .zpg, .pdfv .pg, .bimg .pgc")) closeZoom()
  // a basis box's pin picks its comment and scrolls the mockup to it
  const pin = e.target.closest(".bpin[data-bn]")
  const run = pin && findRun(sel.project, sel.slug)
  if (run) {
    cm.on = Number(pin.dataset.bn)
    renderPanel(run)
    paintBoxes(run)
    const c = $("cpanel").querySelector(`.ccard[data-cn="${cm.on}"]`)
    if (c) c.scrollIntoView({ block: "nearest" })
    toMock({ rein: "focus", n: cm.on })
  }
})
document.addEventListener("keydown", (e) => {
  if (ev && evKey(e)) return
  if (e.key === "Escape" && closeZoom()) return
  if (e.key === "Escape" && cm.basis !== null) return stopBasis(findRun(sel.project, sel.slug))
  if (e.key === "Escape") $("cmenu").hidden = true
  // C: the comment mode, when focus is not in a text field
  const t = e.target
  if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey && !(t.closest && t.closest("input, textarea, select, [contenteditable]"))) {
    const run = findRun(sel.project, sel.slug)
    if (isMock(run) && canComment(run) && cm.old === false) setMode(run, !cm.mode)
  }
})

// the comment panel: pick a card, write, change, delete or reopen a comment
$("cpanel").addEventListener("click", (e) => {
  const run = findRun(sel.project, sel.slug)
  if (!run) return
  const s = e.target.closest("[data-csrc]")
  if (s) return jumpBrief(run, s.dataset.csrc)
  const card = e.target.closest(".ccard[data-cn]")
  const n = card ? Number(card.dataset.cn) : null
  const c = n !== null ? commentsOfRun(run).find((x) => x.n === n) : null
  if (c && e.target.closest("[data-cbas]")) {
    cm.on = c.n
    renderPanel(run)
    return showBasis(run, c)
  }
  const b = e.target.closest("[data-cact]")
  if (b) {
    const act = b.dataset.cact
    if (act === "cancel") {
      cm.pick = cm.edit = null
      cm.text = ""
      return renderPanel(run)
    }
    if (act === "save-new" || act === "save-edit") return saveInput(run)
    if (!c) return
    if (act === "edit") {
      cm.edit = c.n
      cm.pick = null
      cm.text = c.text || ""
      renderPanel(run)
      const t = $("cpanel").querySelector("[data-cin]")
      if (t) t.focus()
      return
    }
    if (act === "del") {
      if (confirm(`코멘트 ${c.n}을 지울까요?`)) postComment(run, { op: "delete", id: c.id })
      return
    }
    if (act === "reopen") return postComment(run, { op: "reopen", id: c.id })
    if (act === "basis") return startBasis(run, c)
    if (act === "basis-cancel") return stopBasis(run)
    if (act === "basis-clear") return postComment(run, { op: "basis", id: c.id, basis: null })
    return
  }
  if (!c || e.target.closest("textarea")) return
  cm.on = c.n
  renderPanel(run)
  toMock({ rein: "focus", n: c.n })
})

$("cpanel").addEventListener("input", (e) => {
  if (e.target.matches("[data-cin]")) cm.text = e.target.value
})

$("cpanel").addEventListener("keydown", (e) => {
  if (!e.target.matches("[data-cin]")) return
  const run = findRun(sel.project, sel.slug)
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    saveInput(run)
  } else if (e.key === "Escape") {
    e.stopPropagation()
    cm.pick = cm.edit = null
    cm.text = ""
    renderPanel(run)
  }
})

function saveInput(run) {
  if (!run || cm.busy || !cm.text.trim()) return
  if (cm.pick) postComment(run, { op: "add", screen: cm.pick.screen, el: cm.pick.el, text: cm.text })
  else if (cm.edit !== null) {
    const c = commentsOfRun(run).find((x) => x.n === cm.edit)
    if (c) postComment(run, { op: "edit", id: c.id, text: cm.text })
  }
}

// right-click on an artifact of the timeline: open it in the right tab
document.addEventListener("contextmenu", (e) => {
  const a = e.target.closest("#left .art[data-key]")
  const m = $("cmenu")
  if (!a) {
    m.hidden = true
    return
  }
  e.preventDefault()
  m.dataset.key = a.dataset.key
  m.hidden = false
  m.style.left = `${Math.min(e.clientX, innerWidth - m.offsetWidth - 8)}px`
  m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 8)}px`
})

$("cmenu").addEventListener("click", (e) => {
  e.stopPropagation()
  const m = $("cmenu")
  m.hidden = true
  if (e.target.closest("[data-side]")) openSide(m.dataset.key)
})

$("side").addEventListener("click", (e) => {
  if (e.target.closest("[data-sidex]")) return closeSide()
  const t = e.target.closest("[data-btab]")
  if (t && t.dataset.btab !== sel.side) openSide(t.dataset.btab)
})

dragWidth($("grip"))

// the mockup's page, each time it loads (a load does not bubble: caught on its way down)
$("main").addEventListener("load", (e) => {
  if (e.target.tagName === "IFRAME" && isMock(findRun(sel.project, sel.slug))) dressMock()
}, true)

$("left").addEventListener("click", (e) => {
  if (document.querySelector(".body.railed")) {
    railFold = false
    return render()
  }
  if (e.target.closest("[data-fold-rail]")) {
    railFold = true
    return render()
  }
  const q = e.target.closest("[data-sumq]")
  if (q) {
    const id = q.dataset.sumq
    if (!openQ.delete(id)) openQ.add(id)
    return render()
  }
  const g = e.target.closest("[data-stg]")
  if (g) {
    stgOpen.set(`${sel.project}/${sel.slug}|${g.dataset.stg}`, g.getAttribute("aria-expanded") !== "true")
    return render()
  }
  const a = e.target.closest(".art[data-key]")
  if (!a) return
  sel.key = a.dataset.key
  sel.view = null
  render()
})

$("main").addEventListener("click", (e) => {
  const tx = e.target.closest("[data-etabx]")
  if (tx) return closeTab(findRun(sel.project, sel.slug), tx.dataset.etabx)
  const tb = e.target.closest("[data-etab]")
  if (tb) {
    if (tb.dataset.etab === sel.key) return
    sel.key = tb.dataset.etab
    sel.view = null
    return render()
  }
  if (e.target.closest("[data-cpt]")) {
    cpOff = !cpOff
    lsSet("rein.cpoff", cpOff ? "1" : "0")
    return render()
  }
  const v = e.target.closest("[data-view]")
  if (v) {
    sel.view = v.dataset.view || null
    return render()
  }
  const s = e.target.closest("[data-show]")
  if (s) {
    mockShow = s.dataset.show
    for (const b of $("main").querySelectorAll("[data-show]")) b.classList.toggle("on", b === s)
    toMock({ rein: "show", show: mockShow })
    return
  }
  if (e.target.closest("[data-cmode]")) {
    const run = findRun(sel.project, sel.slug)
    return setMode(run, !cm.mode)
  }
  const b = e.target.closest(".bdg[data-ev]")
  if (b && doc) return openEvidence(doc.run, b.dataset.ev, b.dataset.title, b.dataset.name)
  const c = e.target.closest("[data-copy]")
  if (c) {
    const pre = $("main").querySelector(".cmsg")
    if (pre && navigator.clipboard) navigator.clipboard.writeText(pre.textContent).then(() => { c.textContent = "복사됨" }, () => {})
    return
  }
  if (!drawn) return
  const t = e.target.closest("[data-tab]")
  if (t) {
    openSide(t.dataset.tab)
    ui.row = null
    return paint()
  }
  const r = e.target.closest("[data-row]")
  if (r) {
    const x = ui.rows[Number(r.dataset.row)]
    openSide(x.tab, x.page, x.req)
    ui.row = Number(r.dataset.row)
    return paint()
  }
  const f = e.target.closest("[data-filter]")
  if (f) {
    ui.filter = f.dataset.filter || null
    return paint()
  }
  if (e.target.closest("[data-why]")) {
    ui.why = !ui.why
    paint()
  }
})

// a checkbox of 5-checklist.md: write it back to the file
$("main").addEventListener("change", async (e) => {
  const cb = e.target.closest("input.cb")
  if (!cb || !doc) return
  const line = Number(cb.dataset.line)
  const parts = doc.src.split(/(\r?\n)/)
  const r = doc.run
  cb.disabled = true
  const d = cb.closest(".doc")
  countChecklist(d)
  try {
    const res = await fetch("/api/checklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: r.project, state: r.state, slug: r.slug, line, text: parts[(line - 1) * 2], checked: cb.checked }),
    })
    if (!res.ok) throw new Error(String(res.status))
    parts[(line - 1) * 2] = (await res.json()).text
    doc.src = parts.join("")
  } catch {
    cb.checked = !cb.checked
    countChecklist(d)
    if (shown) shown.sig = ""
    load()
  } finally {
    cb.disabled = false
  }
})

// a file the server opens on this PC; when it cannot, the file is downloaded
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a[data-open]")
  if (!a) return
  e.preventDefault()
  try {
    const res = await fetch("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: a.getAttribute("href") }),
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    const d = document.createElement("a")
    d.href = a.href
    d.download = ""
    d.click()
  }
})

window.addEventListener("hashchange", () => {
  sel = readHash()
  if (data) render()
})

let loading = null
let again = false

async function load() {
  if (loading) { again = true; return loading }
  loading = (async () => {
    try {
      const j = await (await fetch("/api/runs", { cache: "no-store" })).json()
      skew = j.now - Date.now()
      ro = j.readOnly === true
      hub = j.hub && typeof j.hub === "object" ? j.hub : null
      data = j.projects.map((p) => ({ name: p.name, runs: p.runs.map((r) => decorate(p.name, r)) }))
      render()
    } catch {}
  })()
  await loading
  loading = null
  if (again) { again = false; load() }
}

Mascot.start(() => fav)
setInterval(tick, 1000)
load()
const es = new EventSource("/api/events")
es.addEventListener("change", () => load())
es.addEventListener("open", () => { if (data) load() })
