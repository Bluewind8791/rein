// The module a rein:ego-driver's round imports on its first line. The hook
// writes it into each attempt's evidence folder as harness.mjs, its settings
// baked in, so a round needs no plugin path and an attempt keeps the harness
// it started with. It opens the check's TaskSpace in its ego profile, blocks
// the production hosts on every page (Network.setBlockedURLs with
// urlPatterns: measured to stop only the page's own fetch and XHR, and not
// to last past the round or reach a new page, so it is set again each round
// and on each new page), keeps goto on the app's host, logs every action to
// round-NN.log, and writes the evidence the driver asks for, each file named
// after the round. It reads the round from the highest round-NN.mjs in the
// folder: the hook runs only that one.

export type HarnessConfig = {
  folder: string // the attempt's evidence folder, forward slashes
  space: string // the TaskSpace's name
  profile: string // the ego profile id
  app: string // the app's url
  production: string[] // config e2e.production
}

export const HARNESS_FILE = "harness.mjs"

// markers the hook leaves in the folder for the harness: takeover, the
// user finished what the space was handed off for; reopen, the hook closed
// the space itself (a round ran past its time), so a missing space is not lost.
export const TAKEOVER_MARK = "takeover"
export const REOPEN_MARK = "reopen"

// the files a round's end leaves for the hook to read.
export const handoffFile = (round: string) => `round-${round}-handoff.json`
export const doneFile = (round: string) => `round-${round}-done.json`
export const lostFile = (round: string) => `round-${round}-lost.json`

// the import line every round starts with.
export function importLine(folder: string): string {
  return `import { page, newPage, pages, shot, snapshot, measure, appState, server, network, consoleLog, download, handOff, done } from "${fileUrl(`${folder}/${HARNESS_FILE}`)}"`
}

export function fileUrl(path: string): string {
  const p = path.replace(/\\/g, "/")
  return `file:///${encodeURI(p.replace(/^\/+/, ""))}`
}

export function harnessSource(cfg: HarnessConfig): string {
  return `const CFG = ${JSON.stringify(cfg)}\n${HARNESS}`
}

const HARNESS = String.raw`const fs = await import("node:fs/promises")
const folder = CFG.folder
const appHost = new URL(CFG.app).hostname.toLowerCase()
const files = await fs.readdir(folder)
const rounds = files.map(f => /^round-(\d+)\.mjs$/.exec(f)).filter(Boolean).map(m => m[1]).sort()
const round = rounds.at(-1) ?? "01"
const at = name => folder + "/" + name
const counts = {}
const next = kind => { counts[kind] = (counts[kind] ?? 0) + 1; return "round-" + round + "-" + kind + "-" + counts[kind] }
const clip = (v, n = 300) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s === undefined ? "" : s.length > n ? s.slice(0, n) + "…" : s }
const log = async line => fs.appendFile(at("round-" + round + ".log"), JSON.stringify({ t: new Date().toISOString(), ...line }) + "\n")
const saved = name => console.log("[rein] saved " + name)
const exists = async name => fs.access(at(name)).then(() => true, () => false)

// a relative url is the app's, unless the page is on the app's host.
const base = async raw => { const u = await raw.url().catch(() => undefined); return u && hostOf(u) === appHost ? u : CFG.app }
const hostOf = s => { try { return new URL(s).hostname.toLowerCase().replace(/\.+$/, "") } catch { return undefined } }
const isProduction = url => {
  const host = hostOf(url)
  if (host === undefined) return false
  return CFG.production.some(p => {
    const e = p.trim().toLowerCase()
    if (e.startsWith("*.")) return host.endsWith("." + e.slice(2))
    return (hostOf(e.includes("://") ? e : "http://" + e) ?? e) === host
  })
}
const patterns = CFG.production.map(p => ({ urlPattern: "*://" + p.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") + "/*", block: true }))

// the space: the check's own, by name. A new one opens in the check's
// profile; a space this attempt had that is gone is lost, unless the hook
// closed it itself.
const listed = (await listTaskSpaces()).find(s => s.name === CFG.space)
const earlier = rounds.length > 1 || files.some(f => /^round-\d+\.log$/.test(f))
let task
if (!listed) {
  if (earlier && !(await exists("reopen"))) {
    await fs.writeFile(at("round-" + round + "-lost.json"), JSON.stringify({ space: CFG.space }))
    await log({ action: "space", result: "lost" })
    console.log("[rein] the space " + CFG.space + " is gone (the ego browser was closed?). Stop this round; the hook says what follows.")
    process.exit(0)
  }
  await fs.rm(at("reopen"), { force: true })
  task = await taskSpace(CFG.space, { profileId: CFG.profile })
} else if (listed.ownership === "agentDelegatedToUser") {
  if (!(await exists("takeover"))) {
    console.log("[rein] the space " + CFG.space + " is still handed to the user. Stop this round and report it.")
    process.exit(0)
  }
  task = await takeOverTaskSpace(listed.id)
  await fs.rm(at("takeover"), { force: true })
  await log({ action: "takeOver", result: "ok" })
} else task = await taskSpace(CFG.space)

const blocked = new Set()
async function guard(raw) {
  if (blocked.has(raw.label)) return
  blocked.add(raw.label)
  await raw.cdp("Network.enable")
  await raw.cdp("Runtime.enable")
  await raw.cdp("Log.enable")
  if (patterns.length > 0) await raw.cdp("Network.setBlockedURLs", { urlPatterns: patterns })
}
const buffers = new Map()
async function drain(raw) {
  const ev = await raw.events().catch(() => [])
  const list = buffers.get(raw.label) ?? []
  list.push(...ev)
  buffers.set(raw.label, list)
  return list
}
async function guardAll() {
  for (const p of await task.pages()) await guard(p)
}

const ACTIONS = new Set(["goto", "reload", "click", "dblclick", "hover", "dragAndDrop", "fill", "selectOption", "focus", "press", "setInputFiles", "waitForFileChooser", "waitForURL", "waitForSelector", "waitForLoadState", "waitForFunction", "waitForTimeout", "waitForEvent", "evaluate", "fetch", "acceptDialog", "dismissDialog", "close"])
const INPUT = new Set(["click", "move", "down", "up", "wheel", "dblclick", "press", "type", "insertText", "paste"])

async function after(raw) {
  await guardAll()
  const url = await raw.url().catch(() => undefined)
  if (url !== undefined && isProduction(url)) {
    await log({ page: raw.label, action: "guard", url, result: "a production host" })
    throw new Error("[rein] the page reached the production host " + url + "; stop and report it as the check's failure.")
  }
  return url
}

function wrapInput(raw, obj, kind) {
  return new Proxy(obj, {
    get(target, prop) {
      const v = target[prop]
      if (typeof v !== "function" || !INPUT.has(prop)) return v
      return async (...args) => {
        try {
          const out = await v.apply(target, args)
          await log({ page: raw.label, action: kind + "." + prop, target: clip(args), url: await after(raw), result: "ok" })
          return out
        } catch (e) {
          await log({ page: raw.label, action: kind + "." + prop, target: clip(args), result: "error", error: clip(String(e.message ?? e)) })
          throw e
        }
      }
    },
  })
}

function wrap(raw) {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === "raw") return undefined
      if (prop === "cdp") return () => { throw new Error("[rein] page.cdp is not allowed in a Rein round; use evaluate or the harness functions.") }
      if (prop === "mouse" || prop === "keyboard") return wrapInput(target, target[prop], prop)
      const v = target[prop]
      if (typeof v !== "function") return v
      if (!ACTIONS.has(prop)) return v.bind(target)
      return async (...args) => {
        if (prop === "goto") {
          const to = new URL(String(args[0]), await base(target))
          if (to.hostname.toLowerCase() !== appHost) {
            await log({ page: target.label, action: "goto", target: to.href, result: "refused" })
            throw new Error("[rein] goto stays on the app's host " + appHost + "; " + to.href + " is refused.")
          }
          args[0] = to.href
        }
        // the dialog being answered, from page.info() (measured: its type and
        // message, ego-browser 0.6.1.11), so the log has its text.
        const d = prop === "acceptDialog" || prop === "dismissDialog" ? (await target.info().catch(() => undefined))?.dialog : undefined
        try {
          const out = await v.apply(target, args)
          await drain(target)
          await log({ page: target.label, action: prop, target: clip(prop === "evaluate" ? String(args[0]) : args), ...(d ? { dialog: { type: d.type, message: d.message } } : {}), url: await after(target), result: "ok" })
          return out
        } catch (e) {
          await log({ page: target.label, action: prop, target: clip(prop === "evaluate" ? String(args[0]) : args), result: "error", error: clip(String(e.message ?? e)) })
          throw e
        }
      }
    },
  })
}

// a dialog the last round left open: a new process cannot see it, and every
// call to its page times out but this one, which closes it (measured: about
// 15 s with one open, at once with none). Dismissed, so a confirm it asked
// is not done.
for (const p of await task.pages()) {
  if (!(await p.cdp("Page.handleJavaScriptDialog", { accept: false }).then(() => true, () => false))) continue
  await log({ page: p.label, action: "dismissDialog", result: "a dialog the last round left open" })
  console.log("[rein] page " + p.label + " had a dialog the last round left open; it was dismissed (a confirm counts as cancelled). If the action it followed is needed, do it again and handle its dialog in the same round.")
}

await guardAll()
const raw1 =(await task.pages())[0] ?? task.page("p1")
await guard(raw1)

export const page = wrap(raw1)
export async function newPage() {
  const raw = await task.newPage()
  await guard(raw)
  await log({ page: raw.label, action: "newPage", result: "ok" })
  return wrap(raw)
}
export async function pages() {
  const all = await task.pages()
  for (const p of all) await guard(p)
  return all.map(wrap)
}
const rawOf = p => (p ? task.page(p.label) : raw1)

async function record(kind, note, data) {
  const name = next(kind) + ".json"
  await fs.writeFile(at(name), JSON.stringify({ note, ...data }, null, 2))
  await log({ action: kind, target: clip(note), result: name })
  saved(name)
  return name
}

export async function shot(note, opts = {}) {
  const raw = rawOf(opts.page)
  const name = next("shot") + ".png"
  // a screenshot fails while ego's window is minimized (at once) or closed
  // (a CDP timeout after 15 s), and keeps failing until the user opens it.
  await raw.screenshot({ path: at(name), ...(opts.fullPage ? { fullPage: true } : {}) }).catch(async e => {
    if (/window is minimized|timed out: Page\.captureScreenshot/.test(String(e?.message ?? e))) await handOff("ego 창이 닫혔거나 최소화되어 스크린샷을 찍을 수 없습니다. ego 창을 열어 화면에 띄워 두세요(다른 창에 가려져도 됩니다).")
    throw e
  })
  await fs.appendFile(at("round-" + round + "-shots.txt"), name + ": " + note + "\n")
  await log({ page: raw.label, action: "shot", target: clip(note), url: await raw.url().catch(() => undefined), result: name })
  saved(name)
  return name
}
export async function snapshot(note, opts = {}) {
  const raw = rawOf(opts.page)
  const text = await raw.snapshot(opts.scope ? { scope: opts.scope, ...(opts.root ? { root: opts.root } : {}) } : undefined)
  const name = next("snapshot") + ".txt"
  await fs.writeFile(at(name), "# " + note + "\n# " + (await raw.url().catch(() => "")) + "\n\n" + text)
  await log({ page: raw.label, action: "snapshot", target: clip(note), result: name })
  saved(name)
  return text
}
async function evaluated(kind, note, fn, arg, opts = {}) {
  const raw = rawOf(opts.page)
  const result = await (arg === undefined ? raw.evaluate(fn) : raw.evaluate(fn, arg))
  await record(kind, note, { url: await raw.url().catch(() => undefined), code: String(fn), arg: arg ?? null, result })
  return result
}
export const measure = (note, fn, arg, opts) => evaluated("measure", note, fn, arg, opts)
export const appState = (note, fn, arg, opts) => evaluated("state", note, fn, arg, opts)
export async function server(note, url, init = {}, opts = {}) {
  const raw = rawOf(opts.page)
  const to = new URL(url, await base(raw))
  if (isProduction(to.href)) throw new Error("[rein] " + to.href + " is a production host.")
  const r = await raw.fetch(to.href, init)
  await record("server", note, { request: { url: to.href, method: init.method ?? "GET", body: init.body ?? null }, status: r.status, headers: r.headers, body: typeof r.body === "string" && r.body.length > 200000 ? r.body.slice(0, 200000) + "…" : r.body })
  return r
}
export async function network(note, opts = {}) {
  const raw = rawOf(opts.page)
  const ev = await drain(raw)
  const sent = new Map()
  for (const e of ev) {
    if (e.method === "Network.requestWillBeSent") sent.set(e.params.requestId, { url: e.params.request.url, method: e.params.request.method, type: e.params.type, postData: clip(e.params.request.postData ?? "", 2000) || undefined })
    if (e.method === "Network.responseReceived" && sent.has(e.params.requestId)) Object.assign(sent.get(e.params.requestId), { status: e.params.response.status })
    if (e.method === "Network.loadingFailed" && sent.has(e.params.requestId)) Object.assign(sent.get(e.params.requestId), { failed: e.params.errorText, blocked: e.params.blockedReason })
  }
  const all = [...sent.values()].filter(r => !/^(chrome|data|blob):/.test(r.url))
  const requests = opts.filter ? all.filter(r => r.url.includes(opts.filter)) : all
  await record("network", note, { requests })
  return requests
}
export async function consoleLog(note, opts = {}) {
  const raw = rawOf(opts.page)
  const ev = await drain(raw)
  const lines = ev.flatMap(e =>
    e.method === "Runtime.consoleAPICalled" ? [{ level: e.params.type, text: (e.params.args ?? []).map(a => a.value ?? a.description ?? "").join(" ") }]
      : e.method === "Runtime.exceptionThrown" ? [{ level: "exception", text: e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text }]
        : e.method === "Log.entryAdded" ? [{ level: e.params.entry.level, text: e.params.entry.text, url: e.params.entry.url }]
          : [])
  await record("console", note, { lines })
  return lines
}
export async function download(note, trigger, opts = {}) {
  const raw = rawOf(opts.page)
  const waiting = raw.waitForEvent("download", { timeout: opts.timeout ?? 30000 })
  await trigger()
  const d = await waiting
  const name = next("download") + "-" + String(d.suggestedFilename()).replace(/[\\/:*?"<>|]/g, "_")
  await d.saveAs(at(name))
  await record("download-note", note, { file: name, url: d.url() })
  saved(name)
  return name
}
export async function handOff(what) {
  await task.handOff()
  await fs.writeFile(at("round-" + round + "-handoff.json"), JSON.stringify({ what, space: CFG.space }))
  await log({ action: "handOff", target: clip(what), result: "ok" })
  console.log("[rein] handed the space " + CFG.space + " to the user: " + what)
  process.exit(0)
}
export async function done(summary) {
  await fs.writeFile(at("round-" + round + "-done.json"), JSON.stringify({ summary }))
  await log({ action: "done", target: clip(summary), result: "ok" })
  console.log("[rein] done: " + summary)
  process.exit(0)
}
`
