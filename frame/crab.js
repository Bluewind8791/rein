// The status card's crab: Pixel HQ's "Classic duck" figure (the Claude crab
// at a desk), ported from Herdr gpui-kit rects and .loop() to SVG rects that
// loop with the ck-y, ck-x and ck-o animations in app.css. The laptop lid's
// logo is left out. Moods:
//   stab (typing), angry (waving), scowl (waving, urgent), happy (cheering),
//   content (coffee break), snooze, urge (alarm)
//
// Ported from https://github.com/bnhan2710/pixel-hq/blob/main/mods/company-agents/duck.js
// under its license:
//
// MIT License
//
// Copyright (c) 2026 bnhan2710
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
const Crab = (() => {
  const W = 368, H = 240, ROOM = 118 // the desk props reach left of the body
  const BODY = "#D97757", SHADE = "#B5593B", EYE = "#2A1A14", BADGE = "#F4E9DC", BADGE_TOP = "#8C4A33"
  const AMBER = "#F2C94C", MUG = "#F4E9DC", STEAM = "#FFFFFF"

  const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
  // a group that loops one property between a and b: y and x in canvas units, o opacity
  const loop = (inner, k, a, b, ms, ease) =>
    `<g class="ck-${k}" style="--a:${k === "o" ? a : a + "px"};--b:${k === "o" ? b : b + "px"};animation-duration:${ms}ms;animation-timing-function:${ease}">${[].concat(inner).join("")}</g>`
  const g = (inner) => `<g>${inner.join("")}</g>`

  function parts(m) {
    const typing = m === "stab", waving = m === "angry" || m === "scowl", urgent = m === "scowl"
    const cheer = m === "happy", snoozing = m === "snooze", urging = m === "urge"
    const rest = m === "content" || snoozing || urging

    // eyes: open slots; arches when cheering; wide when urging; closed lines on a break
    const arch = (x, y) => [r(x, y + 5, 10, 15, EYE), r(x + 25, y + 5, 10, 15, EYE), r(x + 5, y, 25, 10, EYE)]
    const eyes = cheer ? [...arch(48, 52), ...arch(157, 52)]
      : urging ? [r(52, 38, 26, 34, EYE), r(152, 38, 26, 34, EYE), r(56, 42, 10, 12, "#ffffff"), r(156, 42, 10, 12, "#ffffff"), r(194, 28, 10, 14, "#89dceb"), r(196, 22, 6, 6, "#89dceb")]
      : rest ? [r(52, 66, 36, 8, EYE), r(152, 66, 36, 8, EYE)]
      : [r(55, 42, 20, 30, EYE), r(164, 42, 20, 30, EYE)]

    // claws: typing alternates them, waving raises the right one, cheering flaps both
    let left = r(0, 122, 25, 40, SHADE), right = r(225, 122, 25, 40, SHADE)
    if (typing) {
      left = loop(left, "y", 0, -12, 240, "ease-in-out")
      right = loop(right, "y", -12, 0, 240, "ease-in-out")
    } else if (waving) {
      right = loop(r(225, 55, 25, 85, SHADE), "y", -7, 11, urgent ? 260 : 480, "ease-in-out")
    } else if (cheer) {
      left = loop(r(0, 60, 25, 80, SHADE), "y", -10, 10, 300, "ease-in-out")
      right = loop(r(225, 60, 25, 80, SHADE), "y", 10, -10, 300, "ease-in-out")
    } else if (urging) {
      left = loop(r(0, 120, 25, 40, SHADE), "y", 0, -8, 180, "ease-in-out")
      right = loop(r(225, 112, 25, 40, SHADE), "y", 0, 8, 180, "ease-in-out")
    }

    // the desk props
    let props
    if (typing) {
      const SILVER = "#c9ced6", EDGE = "#a7adb8", DECK = "#aeb4c0"
      props = loop(r(40, 56, 170, 44, "#8fd0ff"), "o", 0.06, 0.2, 900, "ease-in-out") + g([
        r(36, 100, 178, 88, SILVER), r(36, 100, 178, 4, "#e6e9ee"), r(36, 184, 178, 4, EDGE),
        r(36, 104, 4, 80, "#d9dde3"), r(210, 104, 4, 80, EDGE),
        r(22, 188, 206, 10, DECK), r(22, 198, 206, 4, "#8d93a0"),
      ])
    } else if (waving) {
      const bar = (x) => [r(x, 6, 16, 52, AMBER), r(x, 66, 16, 16, AMBER)]
      props = loop(urgent ? [...bar(-84), ...bar(-58)] : bar(-70), "o", 0.25, 1, urgent ? 280 : 560, "linear")
    } else if (cheer) {
      const star = (x, y) => [r(x, y + 12, 36, 12, AMBER), r(x + 12, y, 12, 36, AMBER)]
      props = loop([...star(-80, 20), ...star(-46, 78)], "o", 0.2, 1, 420, "ease-in-out")
    } else if (urging) {
      const ALARM = "#fab387", DARK = "#181825", BELL = "#f9e2af", LEG = "#b5593b"
      props = loop([
        r(-84, 120, 52, 48, ALARM), r(-78, 114, 40, 60, ALARM), r(-76, 122, 36, 44, DARK),
        r(-60, 132, 4, 16, BELL), r(-56, 140, 12, 4, BELL), r(-60, 140, 4, 4, "#ff5370"),
        r(-86, 102, 18, 10, BELL), r(-82, 96, 10, 6, ALARM), r(-38, 102, 18, 10, BELL), r(-34, 96, 10, 6, ALARM),
        r(-62, 100, 12, 8, "#cdd6f4"), r(-82, 172, 8, 14, LEG), r(-34, 172, 8, 14, LEG),
      ], "x", -3, 3, 100, "linear") + loop([
        r(-94, 124, 4, 14, BELL), r(-102, 118, 4, 26, ALARM), r(-16, 124, 4, 14, BELL), r(-8, 118, 4, 26, ALARM),
      ], "o", 0.2, 1, 200, "linear")
    } else if (snoozing) {
      const z = (x, y, w, c) => {
        const t = Math.max(2, Math.round(w * 0.22)), d = Math.max(2, Math.round(w * 0.26))
        return [r(x, y, w, t, c), r(x + Math.round(w * 0.52), y + Math.round(w * 0.22), d, d, c),
          r(x + Math.round(w * 0.24), y + Math.round(w * 0.48), d, d, c), r(x, y + Math.round(w * 0.74), w, t, c)]
      }
      props = loop([...z(-72, 84, 16, "#b4befe"), ...z(-52, 54, 22, "#cdd6f4"), ...z(-28, 20, 28, "#89b4fa")], "y", 0, -16, 1800, "ease-out") +
        g([r(-86, 132, 56, 54, MUG), r(-30, 142, 16, 28, MUG), r(-76, 142, 36, 8, "#3c3836")])
    } else {
      props = loop([r(-76, 96, 8, 28, STEAM), r(-56, 84, 8, 36, STEAM)], "o", 0.1, 0.8, 1500, "ease-in-out") +
        g([r(-86, 132, 56, 54, MUG), r(-30, 142, 16, 28, MUG), r(-76, 142, 36, 8, "#6B3F2A")])
    }

    // the body, with its company badge, bobs, or hops when cheering
    const inner = [left, right, r(25, 0, 200, 200, BODY), ...eyes,
      r(181, 82, 6, 38, BADGE_TOP), r(163, 120, 42, 56, BADGE), r(163, 120, 42, 12, BADGE_TOP), r(174, 140, 20, 16, SHADE), r(170, 162, 28, 6, SHADE),
      props]
    const body = cheer ? loop(inner, "y", 0, -18, 300, "ease-in-out")
      : urging ? loop(inner, "y", 0, 3, 160, "linear")
      : snoozing ? loop(inner, "y", 0, 8, 1800, "ease-in-out")
      : typing ? loop(inner, "y", 0, 3, 480, "ease-in-out")
      : loop(inner, "y", 0, 7, 1200, "ease-out")

    const legs = [45, 90, 145, 190].map((x, i) => {
      const leg = r(ROOM + x, 200, 22, 40, SHADE)
      return cheer ? loop(leg, "y", i % 2 ? -6 : 0, i % 2 ? 0 : -6, 600, "ease-in-out") : leg
    })
    return legs.join("") + `<g transform="translate(${ROOM} 0)">${body}</g>`
  }

  // the crab in mood m, height pixels tall, props included
  function svg(m, height) {
    return `<svg class="crab" viewBox="0 0 ${W} ${H}" width="${Math.round(height * W / H)}" height="${height}" shape-rendering="crispEdges" aria-hidden="true">${parts(m)}</svg>`
  }

  return { svg }
})()
