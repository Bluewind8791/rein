// A small markdown renderer for Rein's run files: frontmatter, headings,
// paragraphs, (nested) lists with checkboxes, tables, fenced code,
// blockquotes, and inline code, bold, italics and links. A paragraph, list
// item or table cell holding "[?]" is an open question and is highlighted.
//
// Md.render(src, ctx) -> html
// Md.inline(text, ctx) -> html of one line's inline markup
//   ctx.href(url)    -> url to use for a link
//   ctx.checkable    -> true when checkboxes can be clicked
//   ctx.item(text, lines) -> optional; for a list item without its own
//                       checkbox, [text, html] to show text and html after it
// Each checkbox carries data-line, its 1-based line number in src.
const Md = (() => {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c])

  const LIST = /^(\s*)([-*+]|\d+[.)])(\s+|$)(.*)$/
  const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
  const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/
  const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
  const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  const Q = "[?]"

  const indentOf = (s) => s.match(/^\s*/)[0].replace(/\t/g, "    ").length

  function isBlockStart(L, i) {
    const s = L[i].s
    return LIST.test(s) || FENCE.test(s) || HEAD.test(s) || HR.test(s) || /^\s*>/.test(s) ||
      (/^\s*\|/.test(s) && i + 1 < L.length && SEP.test(L[i + 1].s))
  }

  function fmt(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
      .replace(/\[\?\]/g, '<b class="qm">[?]</b>')
  }

  function inline(s, ctx) {
    const keep = []
    const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`
    s = s.replace(/(`+)(.+?)\1(?!`)/g, (_, __, c) => hold(`<code class="ref">${esc(c.trim())}</code>`))
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const h = esc(ctx.href(u))
      return hold(`<a class="img" href="${h}" target="_blank" rel="noopener"><img src="${h}" alt="${esc(t)}" loading="lazy"></a>`)
    })
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, t, u) =>
      hold(`<a href="${esc(ctx.href(u))}" target="_blank" rel="noopener">${fmt(esc(t))}</a>`))
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => hold(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`))
    s = fmt(esc(s))
    while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i])
    return s
  }

  function cells(s) {
    let t = s.trim()
    if (t.startsWith("|")) t = t.slice(1)
    if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1)
    return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
  }

  function table(L, i, ctx) {
    const head = cells(L[i].s)
    const align = cells(L[i + 1].s).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : ""))
    const td = (tag, c, k) => {
      const a = align[k] ? ` style="text-align:${align[k]}"` : ""
      const q = c.includes(Q) ? ' class="oq"' : ""
      return `<${tag}${a}${q}>${inline(c, ctx)}</${tag}>`
    }
    let html = `<div class="tbl"><table><thead><tr>${head.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>`
    i += 2
    while (i < L.length && /^\s*\|/.test(L[i].s)) {
      html += `<tr>${cells(L[i].s).map((c, k) => td("td", c, k)).join("")}</tr>`
      i++
    }
    return [html + "</tbody></table></div>", i]
  }

  function list(L, i, ctx) {
    const m0 = LIST.exec(L[i].s)
    const ind = indentOf(m0[1])
    const ordered = /\d/.test(m0[2])
    let html = ""
    while (i < L.length) {
      if (!L[i].s.trim()) {
        let k = i
        while (k < L.length && !L[k].s.trim()) k++
        const n = k < L.length && LIST.exec(L[k].s)
        if (!n || indentOf(n[1]) !== ind || /\d/.test(n[2]) !== ordered) break
        i = k
      }
      const m = LIST.exec(L[i].s)
      if (!m || indentOf(m[1]) !== ind || /\d/.test(m[2]) !== ordered) break
      const gap = m[3].length > 4 ? 1 : Math.max(1, m[3].length)
      const content = ind + m[2].length + gap
      const box = { n: L[i].n }
      const para = [m[4]]
      const body = []
      let j = i + 1
      while (j < L.length) {
        const t = L[j].s
        if (!t.trim()) {
          let k = j
          while (k < L.length && !L[k].s.trim()) k++
          if (k < L.length && indentOf(L[k].s) > ind) {
            for (; j < k; j++) body.push({ s: "", n: L[j].n })
            continue
          }
          break
        }
        const ti = indentOf(t)
        if (ti > ind) {
          const line = { s: t.replace(/^\s*/, " ".repeat(Math.max(0, ti - content))), n: L[j].n }
          if (body.length === 0 && !isBlockStart([line], 0)) para.push(t.trim())
          else body.push(line)
          j++
          continue
        }
        if (body.length === 0 && !isBlockStart(L, j)) {
          para.push(t.trim())
          j++
          continue
        }
        break
      }
      let text = para.join(" ")
      let check = ""
      const c = /^\[([ xX])\]\s*/.exec(text)
      if (c) {
        text = text.slice(c[0].length)
        const on = c[1] !== " " ? " checked" : ""
        check = `<input type="checkbox" class="cb" data-line="${box.n}"${on}${ctx.checkable ? "" : " disabled"}>`
      }
      let after = ""
      if (!c && ctx.item) [text, after] = ctx.item(text, body) || [text, ""]
      const cls = [c ? "task" : "", text.includes(Q) ? "oq" : ""].filter(Boolean).join(" ")
      html += `<li${cls ? ` class="${cls}"` : ""}>${check}<span>${inline(text, ctx)}${after}</span>${body.length ? blocks(body, ctx) : ""}</li>`
      i = j
    }
    const start = ordered && parseInt(m0[2], 10) !== 1 ? ` start="${parseInt(m0[2], 10)}"` : ""
    return [ordered ? `<ol class="ul"${start}>${html}</ol>` : `<ul class="ul">${html}</ul>`, i]
  }

  function blocks(L, ctx) {
    const out = []
    let i = 0
    while (i < L.length) {
      const s = L[i].s
      let m
      if (!s.trim()) { i++; continue }
      if ((m = FENCE.exec(s))) {
        const mark = m[1]
        const body = []
        i++
        while (i < L.length && !new RegExp(`^\\s*${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(L[i].s)) body.push(L[i++].s)
        i++
        out.push(`<pre class="quote"><code>${esc(body.join("\n"))}</code></pre>`)
      } else if ((m = HEAD.exec(s))) {
        const lv = m[1].length
        out.push(lv === 1 ? `<h1 class="rtitle">${inline(m[2], ctx)}</h1>` : `<h${lv}>${inline(m[2], ctx)}</h${lv}>`)
        i++
      } else if (HR.test(s)) {
        out.push("<hr>")
        i++
      } else if (/^\s*\|/.test(s) && i + 1 < L.length && SEP.test(L[i + 1].s)) {
        const [h, n] = table(L, i, ctx)
        out.push(h)
        i = n
      } else if (/^\s*>/.test(s)) {
        const inner = []
        while (i < L.length && /^\s*>/.test(L[i].s)) {
          inner.push({ s: L[i].s.replace(/^\s*> ?/, ""), n: L[i].n })
          i++
        }
        out.push(`<blockquote>${blocks(inner, ctx)}</blockquote>`)
      } else if (LIST.test(s)) {
        const [h, n] = list(L, i, ctx)
        out.push(h)
        i = n
      } else {
        const para = [s.trim()]
        i++
        while (i < L.length && L[i].s.trim() && !isBlockStart(L, i)) para.push(L[i++].s.trim())
        const text = para.join(" ")
        out.push(text.includes(Q)
          ? `<div class="open-q"><span>${inline(text, ctx)}</span></div>`
          : `<p>${inline(text, ctx)}</p>`)
      }
    }
    return out.join("\n")
  }

  function frontmatter(L) {
    if (!L.length || L[0].s.trim() !== "---") return [null, L]
    let end = 1
    while (end < L.length && !/^(---|\.\.\.)\s*$/.test(L[end].s)) end++
    if (end >= L.length) return [null, L]
    const pairs = []
    for (const { s } of L.slice(1, end)) {
      const m = /^([^:\s][^:]*):\s*(.*)$/.exec(s)
      if (m) pairs.push([m[1].trim(), m[2].trim().replace(/^(["'])(.*)\1$/, "$2")])
      else if (pairs.length && s.trim()) pairs[pairs.length - 1][1] += " " + s.trim()
    }
    return [pairs, L.slice(end + 1)]
  }

  function render(src, ctx) {
    const L = src.replace(/\r/g, "").split("\n").map((s, i) => ({ s, n: i + 1 }))
    const [fm, rest] = frontmatter(L)
    const head = fm && fm.length
      ? `<div class="fm">${fm.map(([k, v]) => `<span class="k">${esc(k)}</span><span>${inline(v, ctx)}</span>`).join("")}</div>`
      : ""
    const body = blocks(rest, ctx)
    // the title goes above the frontmatter, as in the mockup
    const t = /^<h1 class="rtitle">[\s\S]*?<\/h1>/.exec(body)
    return t ? t[0] + head + body.slice(t[0].length) : head + body
  }

  return { render, esc, inline }
})()
