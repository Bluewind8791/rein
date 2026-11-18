// Renders the to-be of screens of a Rein run's 1-mockup.html to PNG with a
// headless Chrome (or Edge), for rein:layout-verifier to compare with the
// planning document's picture or with the screen as built, and for the
// worker to build from. The hook runs it as
//   node render-mockup.js <1-mockup.html> <out folder> <id> [<id> ...]
// and reads one JSON line from stdout:
//   {"shots":[{"id","png","boxes"}],"missing":[<id>]}  exit 0
//   {"error":"<why>"}                                  exit 2
// For each id it shows only that `.screen`, hides its notes (the sketcher's
// remarks, not the screen), clips the union of its `.after` blocks, and writes <out>/<id>.png and <out>/<id>.boxes.txt: one line per
// element of the to-be (tag.class "text" x,y w×h, relative to the to-be), the
// measurement the sketcher reads when the picture keeps coming out different.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn, execFileSync } = require("child_process")

const [, , html, out, ...ids] = process.argv

function fail(why) {
  process.stdout.write(JSON.stringify({ error: why }) + "\n")
  process.exit(2)
}

function browser() {
  const set = process.env.REIN_CHROME
  if (set) return fs.existsSync(set) ? set : undefined
  const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean)
  const candidates = process.platform === "win32"
    ? pf.flatMap(p => [path.join(p, "Google/Chrome/Application/chrome.exe"), path.join(p, "Microsoft/Edge/Application/msedge.exe")])
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : []
  const found = candidates.find(p => fs.existsSync(p))
  if (found) return found
  for (const name of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8" }).trim() || undefined
    } catch {}
  }
  return undefined
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// the DevTools port Chrome writes to its profile folder once it listens.
async function portOf(profile) {
  for (let i = 0; i < 100; i++) {
    try {
      const [port] = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)
      if (port) return port
    } catch {}
    await sleep(100)
  }
  return undefined
}

function client(url) {
  const ws = new WebSocket(url)
  let next = 0
  const waiting = new Map()
  const events = []
  ws.onmessage = m => {
    const msg = JSON.parse(String(m.data))
    if (msg.id !== undefined && waiting.has(msg.id)) {
      const { ok, ko } = waiting.get(msg.id)
      waiting.delete(msg.id)
      msg.error ? ko(new Error(msg.error.message)) : ok(msg.result)
    } else if (msg.method) events.push(msg.method)
  }
  const open = new Promise((ok, ko) => ((ws.onopen = ok), (ws.onerror = () => ko(new Error("the DevTools socket did not open")))))
  return {
    open,
    events,
    send: (method, params = {}) => new Promise((ok, ko) => {
      const id = ++next
      waiting.set(id, { ok, ko })
      ws.send(JSON.stringify({ id, method, params }))
    }),
    close: () => ws.close(),
  }
}

// in the page: show only the screen, then measure the union of its `.after`
// blocks and each element in them.
const MEASURE = id => `(() => {
  const screen = document.getElementById(${JSON.stringify(id)})
  if (!screen) return null
  for (const s of document.querySelectorAll(".screen")) s.style.display = s === screen ? "" : "none"
  for (const n of screen.querySelectorAll(".note")) n.style.display = "none"
  const afters = [...screen.querySelectorAll(".after")]
  if (afters.length === 0) return null
  const rects = afters.map(a => a.getBoundingClientRect())
  const x = Math.min(...rects.map(r => r.left)) + scrollX, y = Math.min(...rects.map(r => r.top)) + scrollY
  const w = Math.max(...rects.map(r => r.right)) + scrollX - x, h = Math.max(...rects.map(r => r.bottom)) + scrollY - y
  const boxes = []
  for (const a of afters) for (const el of a.querySelectorAll("*")) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cls = [...el.classList].join(".")
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ").slice(0, 30)
    boxes.push(el.tagName.toLowerCase() + (cls ? "." + cls : "") + (own ? ' "' + own + '"' : "") + " " + Math.round(r.left + scrollX - x) + "," + Math.round(r.top + scrollY - y) + " " + Math.round(r.width) + "x" + Math.round(r.height))
  }
  return { x, y, w, h, boxes }
})()`

async function main() {
  if (!html || !out || ids.length === 0) fail("usage: node render-mockup.js <1-mockup.html> <out folder> <id> [<id> ...]")
  if (!fs.existsSync(html)) fail(`${html} does not exist`)
  if (typeof WebSocket !== "function") fail(`Node ${process.version} has no WebSocket; Node 22 or later renders the mockup`)
  const exe = browser()
  if (!exe) fail("no Chrome or Edge found; set REIN_CHROME to a Chromium browser to render the mockup")
  fs.mkdirSync(out, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rein-render-"))
  const chrome = spawn(exe, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1600,1000", "about:blank"], { stdio: "ignore" })
  try {
    const port = await portOf(profile)
    if (!port) fail(`${path.basename(exe)} did not open its DevTools port`)
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find(t => t.type === "page")
    if (!page) fail(`${path.basename(exe)} opened no page`)
    const cdp = client(page.webSocketDebuggerUrl)
    await cdp.open
    await cdp.send("Page.enable")
    await cdp.send("Page.navigate", { url: "file:///" + encodeURI(path.resolve(html).replace(/\\/g, "/").replace(/^\/+/, "")) })
    for (let i = 0; i < 100 && !cdp.events.includes("Page.loadEventFired"); i++) await sleep(100)
    const shots = []
    const missing = []
    for (const id of ids) {
      const m = (await cdp.send("Runtime.evaluate", { expression: MEASURE(id), returnByValue: true })).result.value
      if (!m || m.w < 1 || m.h < 1) {
        missing.push(id)
        continue
      }
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: m.x, y: m.y, width: m.w, height: m.h, scale: 1 } })
      const png = path.join(out, `${id}.png`)
      const boxes = path.join(out, `${id}.boxes.txt`)
      fs.writeFileSync(png, Buffer.from(shot.data, "base64"))
      fs.writeFileSync(boxes, m.boxes.join("\n") + "\n")
      shots.push({ id, png: png.replace(/\\/g, "/"), boxes: boxes.replace(/\\/g, "/") })
    }
    cdp.close()
    process.stdout.write(JSON.stringify({ shots, missing }) + "\n")
  } finally {
    chrome.kill()
    await sleep(300)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

main().catch(e => fail(String(e && e.message ? e.message : e)))
