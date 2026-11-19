import { eol } from "./diff.ts"
import { itemPath } from "./parse.ts"

// 2-plan.html: a page that shows each file of 2-plan.md's `## 상세 설계`
// as it is beside what its diff makes of it (Monaco's diff editor), with the
// reason of the hunk under the cursor. The hook writes it when the plan
// waits for the person's approval; it judges nothing.

export type ViewHunk = { label: string; why: string; lines: string[] }
export type ViewItem = { path: string; isNew: boolean; notes: string[]; tests: string[]; hunks: ViewHunk[] }
export type PlanView = {
  title: string
  approach: string
  summary: Record<string, { kind: string; what: string }>
  decisions: { title: string; pick: string; why: string }[]
  items: ViewItem[]
}

// a hunk as placed in the file: the lines it spans on each side (1-based),
// or why it could not be placed.
export type Placed = {
  label: string
  why: string
  minus: number
  plus: number
  ok: boolean
  note?: string
  asis?: [number, number]
  tobe?: [number, number]
}

const NOTE = /^\s*(?:[-*]\s+)?테스트(?: 면제)?\s*:/

export function parsePlanView(text: string): PlanView {
  const lines = eol(text).split("\n")
  const section = (title: string) => {
    const start = lines.findIndex(l => new RegExp(`^##\\s+${title}\\s*$`).test(l))
    if (start < 0) return []
    const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
    return lines.slice(start + 1, end < 0 ? undefined : end)
  }
  const cells = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim())

  const summary: PlanView["summary"] = {}
  for (const l of section("변경 요약")) {
    const [file, kind, what] = cells(l)
    if (file === undefined || kind === undefined || what === undefined || file === "파일" || /^-+$/.test(file)) continue
    summary[file.replace(/`/g, "")] = { kind, what }
  }
  const decisions: PlanView["decisions"] = []
  for (const l of section("결정 사항")) {
    const [title, pick, why] = cells(l)
    if (title === undefined || pick === undefined || why === undefined || title === "결정" || /^-+$/.test(title)) continue
    decisions.push({ title, pick, why })
  }

  const items: ViewItem[] = []
  let fence: "diff" | "other" | undefined
  let hunk: ViewHunk | undefined
  for (const l of section("상세 설계")) {
    const item = items.at(-1)
    const marker = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/.exec(l)
    if (fence) {
      if (marker && marker[2] === "") fence = undefined
      else if (fence === "diff" && item) {
        // `@@ <block> @@ <why>`, or a bare `@@` going on in the same block
        const head = /^@@(?:\s*(.*?)\s*@@\s*(.*))?$/.exec(l)
        if (head) {
          hunk = { label: head[1] ?? "", why: head[2]?.trim() ?? "", lines: [] }
          item.hunks.push(hunk)
        } else if (hunk && !(l[0] !== "+" && /^\s*…/.test(l.slice(1)))) {
          // a `-…(what is left out)` line is a note, not code
          hunk.lines.push(l)
        }
      }
      continue
    }
    if (marker) {
      fence = marker[2] === "diff" ? "diff" : "other"
      hunk = undefined
      continue
    }
    const head = /^###\s+(.*)$/.exec(l)
    if (head) {
      const path = itemPath(head[1]!) ?? head[1]!.trim()
      items.push({ path, isNew: /새 파일/.test(head[1]!), notes: [], tests: [], hunks: [] })
      continue
    }
    if (!item) continue
    const bullet = /^[-*]\s+(.*)$/.exec(l)
    if (bullet) (NOTE.test(l) ? item.tests : item.notes).push(bullet[1]!)
    else if (/^\s+\S/.test(l) && item.notes.length > 0) item.notes[item.notes.length - 1] += `\n${l.trim()}`
  }

  return {
    title: (lines.find(l => l.startsWith("# ")) ?? "# 2-plan").slice(2).trim(),
    approach: section("접근 방법").join("\n").trim(),
    summary,
    decisions,
    items,
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim()
// how far apart two lines of a hunk may lie in the file: a hunk is an
// excerpt and may skip the lines between.
const GAP = 40

// where seq's lines lie in src, in order, from `from` on, each within GAP of
// the one before; whitespace does not count.
function match(src: string[], seq: string[], from: number): number[] | undefined {
  for (let s = from; s < src.length; s++) {
    if (norm(src[s]!) !== norm(seq[0]!)) continue
    const at = [s]
    for (let j = 1; j < seq.length; j++) {
      const last = at.at(-1)!
      let found = -1
      for (let i = last + 1; i <= Math.min(src.length - 1, last + GAP); i++) {
        if (norm(src[i]!) === norm(seq[j]!)) {
          found = i
          break
        }
      }
      if (found < 0) break
      at.push(found)
    }
    if (at.length === seq.length) return at
  }
  return undefined
}

// the file as the hunks make it: each hunk found by its unchanged and `-`
// lines, the lines it skips kept as they are. A hunk not found is left out.
export function applyHunks(asis: string, hunks: ViewHunk[]): { tobe: string; placed: Placed[] } {
  const src = eol(asis).split("\n")
  const placed: Placed[] = []
  const found: { at: number[]; hunk: ViewHunk; p: Placed }[] = []
  let from = 0
  for (const hunk of hunks) {
    const p: Placed = {
      label: hunk.label, why: hunk.why, ok: false,
      minus: hunk.lines.filter(l => l[0] === "-").length,
      plus: hunk.lines.filter(l => l[0] === "+").length,
    }
    placed.push(p)
    const old = hunk.lines.filter(l => l[0] !== "+").map(l => l.slice(1))
    if (hunk.lines.length === 0) {
      p.note = "코드가 없는 hunk입니다"
      continue
    }
    if (old.length === 0) {
      p.note = "그대로 두는 줄이 없어 위치를 정할 수 없습니다"
      continue
    }
    const at = match(src, old, from) ?? match(src, old, 0)
    if (!at) {
      p.note = "지금 파일에서 이 hunk의 줄을 찾지 못했습니다"
      continue
    }
    const clash = found.find(f => at[0]! <= f.at.at(-1)! && f.at[0]! <= at.at(-1)!)
    if (clash) {
      p.note = `앞의 hunk(@@ ${clash.hunk.label} @@)와 자리가 겹칩니다`
      continue
    }
    p.ok = true
    found.push({ at, hunk, p })
    from = at.at(-1)! + 1
  }
  found.sort((a, b) => a.at[0]! - b.at[0]!)
  const tobe: string[] = []
  let i = 0
  for (const { at, hunk, p } of found) {
    tobe.push(...src.slice(i, at[0]))
    const start = tobe.length + 1
    let ptr = at[0]!
    let k = 0
    for (const l of hunk.lines) {
      if (l[0] === "+") {
        tobe.push(l.slice(1))
        continue
      }
      const line = at[k++]!
      tobe.push(...src.slice(ptr, line))
      if (l[0] !== "-") tobe.push(src[line]!)
      ptr = line + 1
    }
    p.asis = [at[0]! + 1, at.at(-1)! + 1]
    p.tobe = [start, Math.max(start, tobe.length)]
    i = ptr
  }
  tobe.push(...src.slice(i))
  return { tobe: tobe.join("\n"), placed }
}

// one file as the page shows it.
export type ViewFile = {
  path: string
  isNew: boolean
  summary?: { kind: string; what: string }
  notes: string[]
  tests: string[]
  asis: string
  tobe: string
  hunks: Placed[]
  error?: string
}

// the page's data: each item with its file as it is (read(path) gives the
// file's text, undefined when there is none).
export async function planViewData(view: PlanView, read: (path: string) => Promise<string | undefined>) {
  const files: ViewFile[] = []
  for (const item of view.items) {
    const file: ViewFile = { path: item.path, isNew: item.isNew, notes: item.notes, tests: item.tests, asis: "", tobe: "", hunks: [] }
    const summary = view.summary[item.path]
    if (summary) file.summary = summary
    if (!item.isNew && item.hunks.length > 0) {
      const asis = await read(item.path)
      if (asis === undefined) {
        file.error = "이 파일을 읽지 못했습니다"
        file.hunks = item.hunks.map(h => ({ label: h.label, why: h.why, ok: false, minus: 0, plus: 0, note: "파일이 없습니다" }))
      } else {
        const { tobe, placed } = applyHunks(asis, item.hunks)
        file.asis = eol(asis)
        file.tobe = tobe
        file.hunks = placed
      }
    }
    files.push(file)
  }
  return { title: view.title, approach: view.approach, decisions: view.decisions, files }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

export function planViewHtml(data: Awaited<ReturnType<typeof planViewData>>): string {
  // `<` escaped so no `</script>` in the code closes the data block
  const json = JSON.stringify(data).replace(/</g, "\\u003c")
  return PAGE.replace("__TITLE__", escapeHtml(data.title)).replace("__DATA__", () => json)
}

const MONACO = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min"

// The page. Its script uses no backticks or `${`, so it sits in this
// template literal as written.
const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --line: #e3e6ea; --text: #1d2228; --muted: #6a737d;
    --accent: #2f6fde; --accent-soft: #e8f0fd; --ok: #1f8a4c; --warn: #b4580a; --warn-soft: #fff3e6;
    --code-bg: #f0f2f5; --why: #fff7d1;
  }
  /* light by default; the header's button switches to dark */
  :root[data-theme="dark"] {
    --bg: #16181c; --panel: #1e2126; --line: #30343b; --text: #e3e6ea; --muted: #9098a3;
    --accent: #6ea0ff; --accent-soft: #233150; --ok: #4cc584; --warn: #f0a050; --warn-soft: #3a2a18;
    --code-bg: #2a2e35; --why: #3b3520;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 13px/1.5 "Pretendard", "Malgun Gothic", system-ui, sans-serif;
    display: grid; grid-template-rows: auto 1fr; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--panel); min-width: 0; }
  header h1 { font-size: 14px; margin: 0; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button, .btn { border: 0; background: var(--panel); color: var(--text); padding: 5px 10px; font: inherit; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on, .btn.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .btn { border: 1px solid var(--line); border-radius: 6px; }
  main { display: grid; grid-template-columns: 220px minmax(0, 1fr) 6px var(--side-w, 340px); min-height: 0; }
  nav { border-right: 1px solid var(--line); overflow: auto; background: var(--panel); }
  nav .f { padding: 7px 12px; cursor: pointer; border-left: 3px solid transparent; }
  nav .f:hover { background: var(--bg); }
  nav .f.on { background: var(--accent-soft); border-left-color: var(--accent); }
  nav .name { font-weight: 600; word-break: break-all; }
  nav .dir { color: var(--muted); font-size: 11px; word-break: break-all; }
  .tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 9px; margin-right: 4px; background: var(--code-bg); color: var(--muted); }
  .tag.ok { color: var(--ok); } .tag.warn { color: var(--warn); background: var(--warn-soft); }
  #centerWrap { display: grid; grid-template-rows: auto 1fr; min-width: 0; min-height: 0; }
  .colhead { display: flex; font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line); background: var(--panel); }
  .colhead div { flex: 1; padding: 3px 12px; }
  #center { position: relative; min-width: 0; min-height: 0; }
  #editor { position: absolute; inset: 0; }
  #placeholder { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; color: var(--muted); padding: 24px; text-align: center; }
  #split { cursor: col-resize; background: var(--line); }
  #split:hover, body.dragging #split { background: var(--accent); }
  body.dragging { cursor: col-resize; user-select: none; }
  aside { overflow: auto; background: var(--panel); padding: 12px 14px 40px; }
  aside h2 { font-size: 12px; color: var(--muted); font-weight: 600; margin: 18px 0 6px; }
  aside h2:first-child { margin-top: 0; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .card.cur { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .card .lbl { font-family: Consolas, monospace; font-weight: 600; margin-bottom: 4px; }
  .b { padding: 6px 8px; border-radius: 6px; margin: 4px 0; }
  .b.why { background: var(--why); }
  code { font-family: Consolas, "D2Coding", monospace; font-size: 12px; background: var(--code-bg); padding: 0 4px; border-radius: 4px; word-break: break-all; }
  .hl { cursor: pointer; padding: 4px 8px; border-radius: 6px; }
  .hl:hover { background: var(--bg); }
  .hl.on { background: var(--accent-soft); }
  .hl .top { display: flex; gap: 8px; align-items: baseline; }
  .hl .n { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .hl .lab { font-family: Consolas, monospace; flex: 1; }
  .hl .w { color: var(--muted); font-size: 12px; margin-left: 18px; }
  .note { color: var(--warn); font-size: 12px; }
  .muted { color: var(--muted); }
  details summary { cursor: pointer; color: var(--muted); margin: 6px 0; }
  .dec { border-top: 1px solid var(--line); padding: 8px 0; }
  .dec b { display: block; margin-bottom: 2px; }
</style>
</head>
<body>
<header>
  <h1 id="title"></h1>
  <div class="seg" id="segHide"><button data-v="1" class="on">변경만</button><button data-v="0">전체</button></div>
  <div class="seg" id="segSide"><button data-v="1" class="on">나란히</button><button data-v="0">한 칸</button></div>
  <button class="btn" id="prev" title="Alt+↑">◀ 이전 변경</button>
  <button class="btn" id="next" title="Alt+↓">다음 변경 ▶</button>
  <button class="btn" id="overview">접근·결정</button>
  <button class="btn" id="theme">라이트 / 다크</button>
</header>
<main>
  <nav id="files"></nav>
  <div id="centerWrap">
    <div class="colhead" id="colhead"><div>as-is (지금 코드)</div><div>to-be (plan의 diff 적용)</div></div>
    <div id="center"><div id="editor"></div><div id="placeholder"></div></div>
  </div>
  <div id="split" title="끌어서 설명 패널 폭 조절 (두 번 누르면 기본 폭)"></div>
  <aside id="side"></aside>
</main>
<script id="data" type="application/json">__DATA__</script>
<script src="${MONACO}/vs/loader.min.js"></script>
<script>
var DATA = JSON.parse(document.getElementById("data").textContent);
var BASE = "${MONACO}";
document.getElementById("title").textContent = DATA.title;

function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function md(s) { return esc(s).replace(/\\x60([^\\x60]+)\\x60/g, "<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>").replace(/\\n/g, "<br>"); }
function base(p) { return p.split("/").pop(); }
function dir(p) { return p.split("/").slice(0, -1).join("/"); }
function lang(p) {
  var ext = p.split(".").pop();
  return { jsp: "html", html: "html", vue: "html", php: "php", java: "java", kt: "kotlin", cs: "csharp", go: "go", rb: "ruby", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", xml: "xml", sql: "sql", css: "css", scss: "scss", md: "markdown", json: "json", py: "python", sh: "shell", yml: "yaml", yaml: "yaml" }[ext] || "plaintext";
}

var state = { file: 0, hunk: -1, hide: true, side: true, overview: false };
var diffEditor = null;

var nav = document.getElementById("files");
DATA.files.forEach(function (f, i) {
  var ok = f.hunks.filter(function (h) { return h.ok; }).length;
  var tag;
  if (f.isNew) tag = '<span class="tag">새 파일</span>';
  else if (!f.hunks.length) tag = '<span class="tag">diff 없음</span>';
  else if (ok < f.hunks.length) tag = '<span class="tag warn">변경 ' + ok + '/' + f.hunks.length + ' 적용</span>';
  else tag = '<span class="tag ok">변경 ' + ok + '곳</span>';
  var el = document.createElement("div");
  el.className = "f";
  el.dataset.i = i;
  el.innerHTML = '<div class="name">' + esc(base(f.path)) + '</div><div class="dir">' + esc(dir(f.path)) + '</div><div>' + tag + '</div>';
  el.onclick = function () { openFile(i); };
  nav.appendChild(el);
});

// the hunk on a line of one side, or one within two lines of it; -1 for none
function hunkAt(f, line, key) {
  var best = -1;
  f.hunks.forEach(function (h, i) {
    if (!h.ok || best >= 0) return;
    var r = h[key];
    if (line >= r[0] && line <= r[1]) best = i;
  });
  if (best >= 0) return best;
  f.hunks.forEach(function (h, i) {
    if (!h.ok || best >= 0) return;
    var r = h[key];
    if (Math.abs(line - r[0]) <= 2 || Math.abs(line - r[1]) <= 2) best = i;
  });
  return best;
}

function renderSide() {
  var side = document.getElementById("side");
  if (state.overview) {
    side.innerHTML = '<h2>접근 방법</h2>' + DATA.approach.split(/\\n\\n+/).map(function (p) { return '<p>' + md(p) + '</p>'; }).join("") +
      '<h2>결정 사항 (' + DATA.decisions.length + ')</h2>' +
      DATA.decisions.map(function (d) { return '<div class="dec"><b>' + md(d.title) + '</b><div>' + md(d.pick) + '</div><details><summary>근거</summary>' + md(d.why) + '</details></div>'; }).join("");
    return;
  }
  var f = DATA.files[state.file];
  var h = "";
  if (f.summary) h += '<h2>이 파일 — ' + esc(f.summary.kind) + '</h2><div>' + md(f.summary.what) + '</div>';
  if (f.error) h += '<p class="note">' + esc(f.error) + '</p>';
  var cur = state.hunk >= 0 ? f.hunks[state.hunk] : null;
  h += '<h2>커서 위치의 변경</h2>';
  if (cur) {
    h += '<div class="card cur"><div class="lbl">@@ ' + esc(cur.label || "(이어서)") + ' @@</div>' +
      '<div class="muted">-' + cur.minus + ' +' + cur.plus + (cur.ok ? ' · to-be ' + cur.tobe[0] + '–' + cur.tobe[1] + '행' : '') + '</div>' +
      (cur.note ? '<div class="note">' + esc(cur.note) + '</div>' : '') +
      (cur.why ? '<div class="b why">' + md(cur.why) + '</div>' : '<div class="b muted">이 hunk에는 사유가 없습니다. 아래 설명을 보세요.</div>') +
      '</div>';
  } else {
    h += '<div class="card"><span class="muted">' + (f.hunks.length ? '변경된 줄에 커서를 두면 그 변경의 사유가 여기 나옵니다.' : 'plan에 이 파일의 diff가 없습니다.') + '</span></div>';
  }
  if (f.hunks.length) {
    h += '<h2>변경 목록 (' + f.hunks.length + ')</h2>' + f.hunks.map(function (x, i) {
      return '<div class="hl' + (i === state.hunk ? ' on' : '') + '" data-h="' + i + '"><div class="top"><span class="n">' + (i + 1) + '</span><span class="lab">' + esc(x.label || "(이어서)") + '</span>' +
        (x.ok ? '<span class="n">-' + x.minus + ' +' + x.plus + '</span>' : '<span class="tag warn">미적용</span>') + '</div>' +
        (x.why ? '<div class="w">' + md(x.why) + '</div>' : '') + '</div>';
    }).join("");
  }
  h += '<h2>이 파일의 설명 (' + f.notes.length + ')</h2>' + f.notes.map(function (b) { return '<div class="b">' + md(b) + '</div>'; }).join("");
  if (f.tests.length) h += '<h2>테스트</h2>' + f.tests.map(function (t) { return '<div class="b">' + md(t) + '</div>'; }).join("");
  side.innerHTML = h;
  side.querySelectorAll(".hl").forEach(function (el) { el.onclick = function () { gotoHunk(+el.dataset.h); }; });
}

function gotoHunk(i) {
  var h = DATA.files[state.file].hunks[i];
  state.hunk = i;
  renderSide();
  if (!h || !h.ok || !diffEditor) return;
  var ed = diffEditor.getModifiedEditor();
  ed.revealLineInCenter(h.tobe[0]);
  ed.setPosition({ lineNumber: h.tobe[0], column: 1 });
  ed.focus();
}

function step(d) {
  var ok = [];
  DATA.files[state.file].hunks.forEach(function (h, i) { if (h.ok) ok.push(i); });
  if (!ok.length) return;
  var pos = ok.indexOf(state.hunk);
  pos = pos < 0 ? (d > 0 ? 0 : ok.length - 1) : (pos + d + ok.length) % ok.length;
  gotoHunk(ok[pos]);
}

function openFile(i) {
  state.file = i;
  state.hunk = -1;
  state.overview = false;
  document.getElementById("overview").classList.remove("on");
  nav.querySelectorAll(".f").forEach(function (el) { el.classList.toggle("on", +el.dataset.i === i); });
  var f = DATA.files[i];
  var ph = document.getElementById("placeholder");
  var hasCode = !f.isNew && f.hunks.some(function (h) { return h.ok; });
  ph.style.display = hasCode ? "none" : "flex";
  // display, not visibility: Monaco puts visibility: visible on its two inner
  // editors, which would keep the last file's diff showing through.
  document.getElementById("editor").style.display = hasCode ? "" : "none";
  document.getElementById("colhead").style.visibility = hasCode && state.side ? "visible" : "hidden";
  if (!hasCode) {
    ph.textContent = f.isNew ? "새 파일 — plan에는 코드가 없고 설명만 있습니다. 오른쪽을 보세요."
      : f.hunks.length ? "plan의 diff를 지금 파일에 맞추지 못했습니다. 오른쪽 변경 목록의 미적용 사유를 보세요."
      : "plan에 이 파일의 diff가 없습니다. 오른쪽 설명을 보세요.";
  }
  if (diffEditor && hasCode) {
    var old = diffEditor.getModel();
    diffEditor.setModel({
      original: monaco.editor.createModel(f.asis, lang(f.path)),
      modified: monaco.editor.createModel(f.tobe, lang(f.path))
    });
    if (old) { old.original.dispose(); old.modified.dispose(); }
    var first = f.hunks.findIndex(function (h) { return h.ok; });
    setTimeout(function () { if (first >= 0) gotoHunk(first); }, 150);
  }
  renderSide();
}

function seg(id, key, apply) {
  var buttons = document.querySelectorAll("#" + id + " button");
  buttons.forEach(function (b) {
    b.onclick = function () {
      state[key] = b.dataset.v === "1";
      buttons.forEach(function (x) { x.classList.toggle("on", x === b); });
      apply();
    };
  });
}
seg("segHide", "hide", function () { if (diffEditor) diffEditor.updateOptions({ hideUnchangedRegions: { enabled: state.hide } }); });
seg("segSide", "side", function () {
  if (diffEditor) diffEditor.updateOptions({ renderSideBySide: state.side });
  document.getElementById("colhead").style.visibility = state.side ? "visible" : "hidden";
});
document.getElementById("prev").onclick = function () { step(-1); };
document.getElementById("next").onclick = function () { step(1); };
document.getElementById("overview").onclick = function () {
  state.overview = !state.overview;
  this.classList.toggle("on", state.overview);
  renderSide();
};
window.addEventListener("keydown", function (e) {
  if (e.altKey && e.key === "ArrowDown") { step(1); e.preventDefault(); }
  if (e.altKey && e.key === "ArrowUp") { step(-1); e.preventDefault(); }
});

// the side panel's width: drag the line before it, double-click for the
// default; remembered in this browser
var SIDE_KEY = "rein.planView.sideWidth";
function setSide(w) {
  var max = Math.max(260, window.innerWidth - 220 - 300);
  w = Math.min(Math.max(w, 260), max);
  document.documentElement.style.setProperty("--side-w", w + "px");
  return w;
}
try { var saved = +localStorage.getItem(SIDE_KEY); if (saved) setSide(saved); } catch (e) {}
var split = document.getElementById("split");
split.addEventListener("pointerdown", function (e) {
  split.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
  function move(ev) { setSide(window.innerWidth - ev.clientX - 3); }
  function up(ev) {
    split.removeEventListener("pointermove", move);
    split.removeEventListener("pointerup", up);
    document.body.classList.remove("dragging");
    try { localStorage.setItem(SIDE_KEY, String(setSide(window.innerWidth - ev.clientX - 3))); } catch (err) {}
  }
  split.addEventListener("pointermove", move);
  split.addEventListener("pointerup", up);
});
split.addEventListener("dblclick", function () {
  document.documentElement.style.removeProperty("--side-w");
  try { localStorage.removeItem(SIDE_KEY); } catch (e) {}
});

document.getElementById("theme").addEventListener("click", function () {
  var r = document.documentElement;
  r.dataset.theme = r.dataset.theme === "dark" ? "light" : "dark";
  if (window.monaco) monaco.editor.setTheme(r.dataset.theme === "dark" ? "vs-dark" : "vs");
});

window.MonacoEnvironment = {
  getWorkerUrl: function () {
    return "data:text/javascript;charset=utf-8," + encodeURIComponent("self.MonacoEnvironment={baseUrl:'" + BASE + "/'};importScripts('" + BASE + "/vs/base/worker/workerMain.js');");
  }
};
require.config({ paths: { vs: BASE + "/vs" } });
require(["vs/editor/editor.main"], function () {
  diffEditor = monaco.editor.createDiffEditor(document.getElementById("editor"), {
    automaticLayout: true, readOnly: true, originalEditable: false,
    theme: document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs",
    renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false,
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
    fontFamily: "Consolas, 'D2Coding', monospace", fontSize: 13, minimap: { enabled: false },
    scrollBeyondLastLine: false, ignoreTrimWhitespace: false
  });
  function onCursor(key) {
    return function (e) {
      var h = hunkAt(DATA.files[state.file], e.position.lineNumber, key);
      if (h !== state.hunk) { state.hunk = h; renderSide(); }
    };
  }
  diffEditor.getModifiedEditor().onDidChangeCursorPosition(onCursor("tobe"));
  diffEditor.getOriginalEditor().onDidChangeCursorPosition(onCursor("asis"));
  openFile(0);
});
</script>
</body>
</html>
`
