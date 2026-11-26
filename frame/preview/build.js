#!/usr/bin/env node
// Builds a static copy of the frame page over the made-up runs in
// frame/preview/runs, to look at screen changes without a server (and to
// publish as one page):
//
//   node frame/preview/build.js [outDir]     (default frame/preview/out)
//
// The run list is what the real server would give for those runs, with the
// clock held at NOW so ages read the same every build.
"use strict"

const fs = require("fs")
const path = require("path")
const { makeView } = require("../view.js")

const FRAME = path.join(__dirname, "..")
const RUNS = path.join(__dirname, "runs")
const NOW = Date.parse("2026-11-26T15:00:00+09:00")
const out = path.resolve(process.argv[2] || path.join(__dirname, "out"))

// the text a build edits must still be there, or the copy would quietly differ
function swap(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`${file}: "${from}" not found`)
  return text.split(from).join(to)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, "data"), { recursive: true })

// a file's time follows its run's trace, not when the repository was checked out
const snap = makeView({ root: RUNS }).snapshot()
for (const p of snap.projects) {
  for (const r of p.runs) {
    const t = Math.max(...[r.opened, r.closed, ...Object.values(r.stages)].map(x => Date.parse(x) || 0))
    for (const f of r.files) f.mtime = t
  }
}
fs.writeFileSync(path.join(out, "data", "runs.json"), JSON.stringify({ now: NOW, ...snap }))

// the files the page may open: each run's root, brief/ and handoff/ files
for (const p of snap.projects) {
  for (const r of p.runs) {
    for (const f of r.files) {
      const to = path.join(out, "files", p.name, r.state, r.slug, ...f.name.split("/"))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(RUNS, p.name, r.state, r.slug, ...f.name.split("/")), to)
    }
  }
}

for (const f of ["app.css", "md.js", "mascot.js"]) fs.copyFileSync(path.join(FRAME, f), path.join(out, f))
// run files are read next to the page, not from the server's root
const app = fs.readFileSync(path.join(FRAME, "app.js"), "utf8")
fs.writeFileSync(path.join(out, "app.js"), swap(app, "`/files/${", "`files/${", "app.js"))
fs.copyFileSync(path.join(__dirname, "shim.js"), path.join(out, "shim.js"))
let index = fs.readFileSync(path.join(FRAME, "index.html"), "utf8")
index = swap(index, "<title>Rein</title>", "<title>Rein 프레임 미리보기</title>", "index.html")
index = swap(index, '<script src="mascot.js">', '<script src="shim.js"></script>\n<script src="mascot.js">', "index.html")
fs.writeFileSync(path.join(out, "index.html"), index)

console.log(out)
