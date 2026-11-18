// The Rein mascot (2b): a 24x24 pixel horse in five sequences, ported as is
// from the Claude Design mockup "Rein Frame v2".
//   still, walk (run), idle (waiting for an answer), halt, done
const Mascot = (() => {
  let cache = null

  function frames() {
    if (cache) return cache
    const mk = () => Array.from({ length: 24 }, () => Array(24).fill(""))
    const rect = (g, x, y, w, h, c) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < 24 && i >= 0 && i < 24) g[j][i] = c
    }
    const line = (g, x0, y0, x1, y1, c) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1
      for (let k = 0; k <= n; k++) rect(g, Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), 2, 2, c)
    }
    const draw = (o) => {
      const g = mk()
      const mx = o.mx || 0, my = o.my === undefined ? 12 : o.my, ly = o.ly === undefined ? 1 : o.ly
      const lift = o.lift || []
      line(g, mx + 18, my + 2, 21, ly + 3, "r")
      rect(g, 18, ly, 6, 4, "r"); rect(g, 19, ly + 1, 4, 2, "")
      rect(g, mx + 2, my, 12, 8, "o")
      rect(g, mx, my + 4, 16, 2, "o")
      rect(g, mx + 2, my + 1, 12, 1, "r")
      const ex = o.eyes === "right" ? 1 : 0
      if (o.eyes === "closed") { rect(g, mx + 4, my + 3, 1, 1, ""); rect(g, mx + 11, my + 3, 1, 1, "") }
      else { rect(g, mx + 4 + ex, my + 2, 1, 2, ""); rect(g, mx + 11 + ex, my + 2, 1, 2, "") }
      ;[3, 5, 10, 12].forEach((c) => {
        const top = my + 8, h = 21 - top + 1 - (lift.indexOf(c) >= 0 ? 1 : 0)
        rect(g, mx + c, top, 1, h, "o")
      })
      rect(g, mx + 16, my + 3, 3, 3, "y"); rect(g, mx + 17, my + 4, 1, 1, "")
      return g
    }
    const all = [3, 5, 10, 12]
    const seq = {
      still: [[{}, 1000]],
      walk: [[{}, 170], [{ my: 11, lift: [5, 12], ly: 2 }, 170], [{}, 170], [{ my: 11, lift: [3, 10], ly: 2 }, 170]],
      idle: [[{}, 2200], [{ eyes: "closed" }, 130], [{}, 260], [{ eyes: "closed" }, 130], [{}, 1400], [{ eyes: "right" }, 1500], [{}, 600]],
      halt: [[{}, 900], [{ ly: 0, my: 11, lift: all }, 140], [{ ly: 0, my: 10, lift: all, eyes: "closed" }, 260], [{ ly: 0, my: 11, lift: all, eyes: "closed" }, 120], [{ ly: 0, eyes: "closed" }, 2200]],
      done: [[{}, 1800], [{ my: 11, lift: all }, 90], [{ my: 9, lift: all }, 140], [{ my: 10, lift: all }, 110], [{ my: 11, lift: all }, 80], [{ eyes: "closed" }, 900], [{}, 300]],
    }
    const out = {}
    Object.keys(seq).forEach((k) => {
      const fr = seq[k].map(([o, ms]) => ({ g: draw(o), ms }))
      out[k] = { fr, total: fr.reduce((s, f) => s + f.ms, 0) }
    })
    cache = out
    return out
  }

  const COLORS = { o: "#D97757", r: "#8a5a33", y: "#e2b857" }

  function paint(cv, g) {
    const ctx = cv.getContext("2d")
    ctx.clearRect(0, 0, 24, 24)
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const c = g[y][x]
      if (c) { ctx.fillStyle = COLORS[c]; ctx.fillRect(x, y, 1, 1) }
    }
  }

  function pick(a, t) {
    let m = t % a.total, i = 0
    while (m >= a.fr[i].ms) { m -= a.fr[i].ms; i++ }
    return i
  }

  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // every canvas[data-anim] on the page, and the favicon, which follows
  // favicon() (a sequence name). A timer, not requestAnimationFrame, so the
  // favicon keeps moving in a background tab, slowed by the browser.
  function start(favicon) {
    const F = frames()
    const last = new WeakMap()
    const t0 = performance.now()
    const fav = document.createElement("canvas")
    fav.width = fav.height = 24
    let favKey = ""
    const link = document.querySelector("link[rel=icon]")
    const tick = () => {
      const t = performance.now() - t0
      document.querySelectorAll("canvas[data-anim]").forEach((cv) => {
        const name = cv.getAttribute("data-anim")
        const a = F[name]
        if (!a) return
        const i = still ? 0 : pick(a, t)
        const key = name + i
        if (last.get(cv) === key) return
        last.set(cv, key)
        paint(cv, a.fr[i].g)
      })
      const name = favicon()
      const a = F[name] || F.done
      const i = still ? 0 : pick(a, t)
      if (name + i !== favKey) {
        favKey = name + i
        paint(fav, a.fr[i].g)
        link.href = fav.toDataURL("image/png")
      }
    }
    tick()
    setInterval(tick, 40)
  }

  return { start }
})()
