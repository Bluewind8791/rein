// The retro files of every closed run, from this PC and the hub that
// ~/.rein/sync.json names (through frame/sync.js).
//
//   node retro-sync.mjs pull     compare each run's file with the hub's copy,
//                                print `<project>/<runId>\t<file>` per run, then
//                                `conflict\t<project>/<runId>\t<file>\t<hub copy>`
//                                for each file the user has to settle
//   node retro-sync.mjs push     send each file changed since it last agreed
//                                with the hub; one line per file sent:
//                                `sent`, `offline`, `conflict` or `failed`
//   node retro-sync.mjs resolve <file> --keep-mine|--take-hub
//                                settle a conflict: --take-hub puts the hub's
//                                copy into the file; --keep-mine keeps the file
//                                as it is now (yours, or merged by hand), and
//                                the next push sends it over the hub's
//
// A run this PC holds keeps its file in its run folder, and its base (the
// file's sha256 when both sides last agreed) in ~/.rein/.hub/base.json under
// "retro:<project>/<runId>", where the local server keeps it too. A run held
// elsewhere is downloaded, when it has open candidates (후보, 채택), into
// ~/.rein/.hub/learn/<project>/<runId>/, its base kept in manifest.json there.
// The side that moved wins. When both moved, copies whose 상태 lines alone
// differ merge (a closed status beats an open one, 채택 beats 후보, the hub's
// wins between two closed); any other difference is a conflict, the hub's copy
// written under ~/.rein/.hub/conflict/retro/. Offline, pull lists this PC's
// files only and push keeps the changes for the next push.

import { createRequire } from "node:module"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const { sha256, RETRO_NAMES, retroMerge } = require("../../../frame/text.js")
const { OfflineError, makeClient, runPath, serverOf, localRuns, writeAtomic, readBase, withBase } = require("../../../frame/sync.js")

const ROOT = resolve(process.env.REIN_HOME || join(homedir(), ".rein"))
const WORK = join(ROOT, ".hub", "learn")
const MANIFEST = join(WORK, "manifest.json")
const COPIES = join(ROOT, ".hub", "conflict", "retro")
const CLOSED = new Set(["complete", "drop"])

const hashOf = file => (existsSync(file) ? sha256(readFileSync(file)) : undefined)
const urlOf = e => runPath(e.project, e.runId, "files", ...e.rel.split("/"))
const why = r => `the hub answered ${r.status}${r.json && r.json.error ? `: ${r.json.error}` : ""}`

// key -> { key, project, runId, rel, file, held, base?, conflict?: { hub, copy } }
function readManifest() {
  if (!existsSync(MANIFEST)) return new Map()
  return new Map(JSON.parse(readFileSync(MANIFEST, "utf8")).entries.map(e => [e.key, e]))
}

const writeManifest = entries => writeAtomic(MANIFEST, JSON.stringify({ entries: [...entries.values()] }, null, 2))

// the hash both sides last agreed on: base.json for a run this PC holds
const baseOf = e => (e.held ? (readBase(ROOT)[`retro:${e.key}`] || {})[e.rel] : e.base)

async function setBase(e, hash) {
  if (!e.held) e.base = hash
  else await withBase(b => { b[`retro:${e.key}`] = { ...(b[`retro:${e.key}`] || {}), [e.rel]: hash } }, ROOT)
}

// the hub's copy beside the file, for the user to compare
async function conflict(e, buf, hash) {
  const copy = join(COPIES, e.project, e.runId, ...e.rel.split("/"))
  await writeAtomic(copy, buf)
  e.conflict = { hub: hash, copy }
  return `conflict\t${e.key}\t${e.file}\t${copy}`
}

const hubOf = () => {
  const server = serverOf(ROOT)
  return server ? makeClient({ server, client: "cli" }) : null
}

async function pull() {
  const old = readManifest()
  const hub = hubOf()
  let listed = null
  if (!hub) console.error(`${join(ROOT, "sync.json")} names no hub server; this PC's retro files only`)
  else {
    try {
      const r = await hub.json("GET", "/api/retros")
      if (r.status !== 200 || !r.json || !r.json.retros) throw new Error(why(r))
      listed = new Map(r.json.retros.map(x => [`${x.project}/${x.runId}`, x]))
    } catch (err) {
      console.error(`hub not read (${err.message}); this PC's retro files only`)
    }
  }

  const entries = new Map()
  // closed runs this PC holds
  for (const run of localRuns(ROOT)) {
    if (!CLOSED.has(run.state)) continue
    const rel = RETRO_NAMES.find(n => existsSync(join(run.dir, ...n.split("/"))))
    if (!rel) continue
    const key = `${run.project}/${run.runId}`
    entries.set(key, { key, project: run.project, runId: run.runId, rel, file: join(run.dir, ...rel.split("/")), held: true })
  }
  // runs held elsewhere: working copies from earlier pulls, and the hub's runs with open candidates
  for (const e of old.values()) if (!e.held && !entries.has(e.key) && existsSync(e.file)) entries.set(e.key, { ...e })
  if (listed) {
    for (const [key, x] of listed) {
      if (entries.has(key) || !x.open) continue
      entries.set(key, { key, project: x.project, runId: x.runId, rel: x.rel, file: join(WORK, x.project, x.runId, ...x.rel.split("/")), held: false })
    }
  }

  if (!listed) {
    // the conflicts found before still stand
    for (const e of entries.values()) if (old.get(e.key) && old.get(e.key).conflict) e.conflict = old.get(e.key).conflict
  } else {
    try {
      for (const e of entries.values()) {
        delete e.conflict
        const x = listed.get(e.key)
        // the hub has no such file (yet): push sends this one
        if (!x || x.rel !== e.rel) continue
        const [L, H, B] = [hashOf(e.file), x.hash, baseOf(e)]
        if (L === H) {
          if (B !== H) await setBase(e, H)
          continue
        }
        // only this side moved: push sends it
        if (L && H === B) continue
        const got = await hub.download(urlOf(e))
        if (got.status !== 200) {
          console.error(`${e.key}: ${why(got)}`)
          continue
        }
        // only the hub's copy moved, or this PC has none
        if (!L || L === B) {
          await writeAtomic(e.file, got.buf)
          await setBase(e, got.hash)
          continue
        }
        // both moved, or they never agreed
        const mine = readFileSync(e.file, "utf8")
        const merged = retroMerge(mine, String(got.buf))
        if (merged === null) {
          await conflict(e, got.buf, got.hash)
          continue
        }
        if (merged !== mine) await writeAtomic(e.file, merged)
        await setBase(e, got.hash)
      }
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err
      console.error(`hub not reached (${err.message}); the files not compared yet are listed as this PC has them`)
    }
  }

  for (const [key, e] of entries) if (!existsSync(e.file)) entries.delete(key)
  await writeManifest(entries)
  for (const e of entries.values()) console.log(`${e.key}\t${e.file}`)
  for (const e of entries.values()) if (e.conflict) console.log(`conflict\t${e.key}\t${e.file}\t${e.conflict.copy}`)
}

// one file to the hub, if-match its base; a hub copy that moved since is
// merged when only 상태 lines differ
async function send(hub, e, buf, B) {
  const r = await hub.upload(urlOf(e), buf, B ? { "if-match": B } : { "if-none-match": "*" })
  if (r.status === 200) {
    await setBase(e, sha256(buf))
    return `sent\t${e.key}`
  }
  if (r.status === 404 && e.held) return `failed\t${e.key}\tthe hub has no such run yet; the local server sends it with the run`
  if (r.status !== 412) return `failed\t${e.key}\t${why(r)}`
  const got = await hub.download(urlOf(e))
  if (got.status !== 200) return `failed\t${e.key}\t${why(got)}`
  const mine = buf.toString("utf8")
  const merged = retroMerge(mine, String(got.buf))
  if (merged === null) return conflict(e, got.buf, got.hash)
  if (merged !== mine) await writeAtomic(e.file, merged)
  const hash = sha256(merged)
  if (hash !== got.hash) {
    const again = await hub.upload(urlOf(e), Buffer.from(merged), { "if-match": got.hash })
    if (again.status !== 200) return `failed\t${e.key}\t${why(again)}; push again`
  }
  await setBase(e, hash)
  return `sent\t${e.key}`
}

async function push() {
  if (!existsSync(MANIFEST)) throw new Error("no manifest: run pull first")
  const entries = readManifest()
  const hub = hubOf()
  if (!hub) {
    console.error(`${join(ROOT, "sync.json")} names no hub server; nothing sent`)
    return
  }
  let offline = false
  for (const e of entries.values()) {
    if (!existsSync(e.file)) continue
    if (e.conflict) {
      console.log(`conflict\t${e.key}\t${e.file}\t${e.conflict.copy}`)
      continue
    }
    const buf = readFileSync(e.file)
    const B = baseOf(e)
    if (sha256(buf) === B) continue
    if (offline) {
      console.log(`offline\t${e.key}`)
      continue
    }
    try {
      console.log(await send(hub, e, buf, B))
    } catch (err) {
      if (!(err instanceof OfflineError)) console.log(`failed\t${e.key}\t${err.message}`)
      else {
        offline = true
        console.log(`offline\t${e.key}`)
      }
    }
  }
  await writeManifest(entries)
}

async function settle(args) {
  const file = args.find(a => !a.startsWith("--"))
  const [mine, hubs] = [args.includes("--keep-mine"), args.includes("--take-hub")]
  if (!file || mine === hubs) throw new Error("usage: node retro-sync.mjs resolve <file> --keep-mine|--take-hub")
  const entries = readManifest()
  const e = [...entries.values()].find(e => resolve(e.file) === resolve(file))
  if (!e || !e.conflict) throw new Error(`no conflict for ${file}: run pull first`)
  if (hubs) await writeAtomic(e.file, readFileSync(e.conflict.copy))
  await setBase(e, e.conflict.hub)
  rmSync(e.conflict.copy, { force: true })
  delete e.conflict
  await writeManifest(entries)
  console.log(`resolved\t${e.key}\t${hubs ? "hub" : "mine"}`)
}

const [command, ...args] = process.argv.slice(2)
const run = { pull, push, resolve: () => settle(args) }[command]
if (!run) {
  console.error("usage: node retro-sync.mjs pull|push|resolve <file> --keep-mine|--take-hub")
  process.exit(2)
}
try {
  await run()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
