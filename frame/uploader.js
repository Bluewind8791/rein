// The uploader: the part of the local frame server that sends this PC's
// runs to the hub ~/.rein/sync.json names. It never downloads a run.
//
//   makeUploader({ root, server, pc, times, onStatus })
//
// A reconcile (at start, on kick, on reconnect, every RECONCILE_MS) lists
// the hub's runs and, for each local run whose files differ, creates it,
// moves its state and sends the files that differ. A change the watcher
// reports sends that run's differences DEBOUNCE_MS later. A run whose hub
// record has another uid is a collision, whichever PC holds it; a run another
// PC holds is lost when both have the same uid, a collision when either has
// none. Either is sent nothing. <root>/.hub/status.json says how it went. At start, on kick
// and on reconnect, the domain catalog and the shared rules are synced too
// (catalog.js).
//
// Zero dependencies; Node 18 or later.
"use strict"

const fs = require("fs")
const path = require("path")
const { sha256, RETRO_NAMES, retroMerge, pcName } = require("./text.js")
const { readJson, STATES } = require("./view.js")
const { OfflineError, makeClient, runPath, localFiles, digestOf, localRuns, writeAtomic, readBase, withBase } = require("./sync.js")
const catalog = require("./catalog.js")

const CLOSED = new Set(["complete", "drop"])
// files sent at once
const UPLOADS = 2
const TIMES = {
  // a changed run is sent this long after its last change
  debounceMs: 2000,
  // the safety net: every run is compared again this often
  reconcileMs: 10 * 60 * 1000,
  // status.json is written this often even when nothing changed
  heartbeatMs: 60 * 1000,
  // status.json is written this long after a change, changes in between with it
  statusMs: 500,
  // offline, the hub is tried again after retryMs, doubling up to retryMaxMs
  retryMs: 5000,
  retryMaxMs: 60 * 1000,
}

const iso = () => new Date().toISOString()

// the hub refused a write because another PC holds the run now
class Moved extends Error {
  constructor(record) {
    super(`PC ${record.pc} holds the run now`)
    this.record = record
  }
}

function makeUploader({ root, server, pc = pcName(), times = {}, onStatus = () => {} }) {
  const T = { ...TIMES, ...times }
  const hub = makeClient({ server, pc })
  const STATUS = path.join(root, ".hub", "status.json")
  const SEEN = path.join(root, ".hub", "seen.json")
  // what the hub has of each run ("<project>/<runId>") as last seen:
  // { record, files }, or { record, elsewhere: true } when another PC holds it
  const known = new Map()
  // per run, the files not on the hub yet (state moves count one)
  const pending = new Map()
  const lost = new Map()
  const collisions = new Map()
  const conflicts = new Map()
  // per run, { state, digest } when its files last equalled the hub's, or
  // { elsewhere: <pc> } when the hub's record is not this run's, kept across
  // restarts so an offline start counts only what changed since
  const seen = new Map(Object.entries(readJson(SEEN) || {}))
  const state = { reachable: null, checkedAt: null, lastOkAt: null, error: null, sending: null }
  // the catalog and rules edits not sent, as last counted offline
  let catalogUnsent = 0
  // the catalog and rules are synced at the next reconcile that reaches the hub
  let refresh = false
  let lastChange = Date.now()
  let stopped = false
  const timers = { runs: new Map(), status: null, retry: null, reconcile: null, intervals: [] }
  let delay = T.retryMs

  // ---------- status.json ----------

  // the catalog's last outcome comes from catalog.json, which the commands write too
  function current() {
    const counts = [...pending.values()]
    const kept = readJson(path.join(root, ".hub", "catalog.json"))
    return {
      v: 1, pid: process.pid, pc, server,
      reachable: state.reachable, checkedAt: state.checkedAt, lastOkAt: state.lastOkAt, error: state.error,
      unsent: counts.reduce((a, n) => a + n, 0) + catalogUnsent, unsentRuns: counts.filter(n => n > 0).length, sending: state.sending,
      lost: [...lost.values()], collisions: [...collisions.values()], conflicts: [...conflicts.values(), ...((kept && kept.conflicts) || [])],
      catalog: kept && { at: kept.at, updated: kept.updated, pathsChanged: kept.pathsChanged },
    }
  }

  let written = ""
  let shown = null

  // written when it changed (or force, the heartbeat); the frame hears of a change
  async function writeStatus(force) {
    timers.status = null
    const now = current()
    const text = JSON.stringify(now)
    if (!force && text === written) return
    const changed = text !== written
    written = text
    shown = { ...now, at: iso() }
    try { await writeAtomic(STATUS, JSON.stringify(shown, null, 2)) } catch {}
    if (changed) onStatus(shown)
  }

  function touch() {
    if (!timers.status && !stopped) timers.status = setTimeout(() => writeStatus(false), T.statusMs)
  }

  function online() {
    clearTimeout(timers.retry)
    timers.retry = null
    delay = T.retryMs
    const now = iso()
    Object.assign(state, { reachable: true, checkedAt: now, lastOkAt: now, error: null })
    touch()
  }

  // a call failed. Offline (true), the hub is tried again later; any other
  // failure is noted and the next reconcile tries that run again.
  function failed(e) {
    state.error = String(e && e.message)
    touch()
    if (!(e instanceof OfflineError)) return false
    Object.assign(state, { reachable: false, checkedAt: iso() })
    refresh = true
    if (!timers.retry && !stopped) {
      timers.retry = setTimeout(() => {
        timers.retry = null
        reconcile()
      }, delay)
      delay = Math.min(delay * 2, T.retryMaxMs)
    }
    return true
  }

  // ---------- one run ----------

  // what the hub lacks of a run beside what it has: files that differ or are
  // missing there, and files gone here. A closed run's retro goes by its base.
  function diff(run, files, have) {
    const retro = rel => CLOSED.has(run.state) && RETRO_NAMES.includes(rel)
    return {
      puts: Object.keys(files).filter(rel => !retro(rel) && (!have[rel] || have[rel].hash !== files[rel].hash)),
      dels: Object.keys(have).filter(rel => !retro(rel) && !files[rel]),
    }
  }

  // the files still to send against the hub as last seen; every file of a
  // run never seen there, unless it is as seen.json last confirmed it
  function unsentOf(run, files, last) {
    if (last && last.elsewhere) return 0
    if (!last) {
      const s = seen.get(`${run.project}/${run.runId}`)
      if (s && s.elsewhere) return 0
      return s && s.state === run.state && s.digest === digestOf(files) ? 0 : Object.keys(files).length
    }
    const { puts, dels } = diff(run, files, last.files)
    return puts.length + dels.length + (last.record.state !== run.state ? 1 : 0)
  }

  // two files at a time, across runs
  let busy = 0
  const waiting = []
  async function slot(fn) {
    while (busy >= UPLOADS) await new Promise(r => waiting.push(r))
    busy++
    try { return await fn() } finally {
      busy--
      const next = waiting.shift()
      if (next) next()
    }
  }

  // one PUT of the file as it is now, the hub's answer ({ status: 0 } when the
  // file is gone here); have learns what the hub got
  async function put(run, rel, have, headers = {}) {
    let buf
    try { buf = fs.readFileSync(path.join(run.dir, ...rel.split("/"))) } catch { return { status: 0 } }
    const sending = `${run.project}/${run.runId}/${rel}`
    state.sending = sending
    touch()
    try {
      const r = await hub.upload(runPath(run.project, run.runId, "files", ...rel.split("/")), buf, headers)
      if (r.status === 200) have[rel] = { size: buf.length, hash: sha256(buf) }
      return r
    } finally {
      if (state.sending === sending) state.sending = null
      touch()
    }
  }

  const ok = (r, what) => {
    if (r.status === 409 && r.json && r.json.error === "not-holder" && r.json.record) throw new Moved(r.json.record)
    if (r.status < 200 || r.status > 299) throw new Error(`the hub answered ${r.status} for ${what}${r.json && r.json.error ? `: ${r.json.error}` : ""}`)
    return r.json
  }

  // what the hub's record is to the local run with uid: "mine", "lost"
  // (another PC holds this very run) or "collision" (another run of the same
  // name). The uids decide before the PCs; with a uid missing, a record of
  // this PC (or of none) is this run's, another PC's a collision.
  function whose(record, uid) {
    const here = record.pc === pc || record.pc === "unknown"
    if (record.uid && uid) return record.uid !== uid ? "collision" : here ? "mine" : "lost"
    return here ? "mine" : "collision"
  }

  // a run whose hub record is not this run's: lost or a collision. A copy in
  // drop/ is let go already.
  async function elsewhere(run, key, record, kind) {
    known.set(key, { record, elsewhere: true })
    pending.delete(key)
    await remember(key, { elsewhere: record.pc })
    const was = lost.get(key)
    lost.delete(key)
    collisions.delete(key)
    touch()
    if (run.state === "drop") return
    if (kind === "collision") collisions.set(key, { project: run.project, runId: run.runId, pc: record.pc })
    else lost.set(key, { project: run.project, runId: run.runId, pc: record.pc, local: run.state, at: was && was.pc === record.pc ? was.at : iso() })
  }

  // a local run against the hub. seen is what the hub has of it (a listing
  // row with its digest, or known's { record, files }); null when the hub
  // has no record of it, undefined when the hub is to be asked. Offline,
  // only its unsent files are counted.
  async function syncRun(run, seen) {
    const key = `${run.project}/${run.runId}`
    const files = localFiles(run.dir)
    if (state.reachable === false) return void pending.set(key, unsentOf(run, files, known.get(key)))
    let record = null
    let have = null
    const uid = (readJson(path.join(run.dir, "agent", "record.json")) || {}).uid
    try {
      if (seen === undefined) {
        const r = await hub.json("GET", runPath(run.project, run.runId))
        seen = r.status === 404 ? null : { record: ok(r, key).record }
      }
      record = seen && seen.record
      if (!record) {
        const r = await hub.json("POST", runPath(run.project, run.runId, "create"), { state: run.state, uid })
        // another PC made it meanwhile
        if (r.status === 409 && r.json && r.json.record) seen = { record: (record = r.json.record) }
        else [record, have] = [ok(r, key).record, {}]
      }
      const kind = whose(record, uid)
      if (kind !== "mine") return await elsewhere(run, key, record, kind)
      lost.delete(key)
      collisions.delete(key)
      // a legacy record takes the run's uid with a state call
      if (record.state !== run.state || (!record.uid && uid)) {
        record = ok(await hub.json("POST", runPath(run.project, run.runId, "state"), { state: run.state, uid }), key).record
      }
      if (!have) have = seen.files ? { ...seen.files } : seen.digest === digestOf(files) ? { ...files } : null
      if (!have) {
        const m = ok(await hub.json("GET", runPath(run.project, run.runId, "manifest")), key)
        record = m.record
        have = m.files
      }
      const { puts, dels } = diff(run, files, have)
      pending.set(key, puts.length + dels.length)
      touch()
      const sent = await Promise.allSettled(puts.map(rel => slot(async () => {
        const r = await put(run, rel, have)
        if (r.status !== 200 && r.status !== 0) ok(r, `${key}/${rel}`)
      })))
      const bad = sent.find(s => s.status === "rejected")
      if (bad) throw bad.reason
      for (const rel of dels) {
        ok(await hub.json("DELETE", runPath(run.project, run.runId, "files", ...rel.split("/"))), `${key}/${rel}`)
        delete have[rel]
      }
      if (CLOSED.has(run.state)) await retros(run, key, have)
      known.set(key, { record, files: have })
      pending.delete(key)
      await remember(key, { state: run.state, digest: digestOf(files) })
    } catch (e) {
      // another PC took the run since its record was last seen
      if (e instanceof Moved && whose(e.record, uid) !== "mine") return await elsewhere(run, key, e.record, whose(e.record, uid))
      // offline, the hub keeps what it got; otherwise it is asked again
      if (e instanceof OfflineError && record && have) known.set(key, { record, files: have })
      else known.delete(key)
      pending.set(key, unsentOf(run, files, known.get(key)))
      throw e
    } finally {
      touch()
    }
  }

  // the run's files equal the hub's ({ state, digest }), or its record is
  // another run's ({ elsewhere }): seen.json keeps it
  async function remember(key, now) {
    if (JSON.stringify(seen.get(key)) === JSON.stringify(now)) return
    seen.set(key, now)
    try { await writeAtomic(SEEN, JSON.stringify(Object.fromEntries(seen))) } catch {}
  }

  // ---------- retro of a closed run ----------

  const agree = (tree, rel, hash) => withBase(b => { b[tree] = { ...(b[tree] || {}), [rel]: hash } }, root)

  // the retro files of a closed run this PC holds, against base.json (the
  // hashes when both sides last agreed): another PC's /learn may write the
  // hub's copy. The side that moved wins. Both moved, or no base yet and the
  // copies differ, is a conflict, unless only 상태 lines differ: then they
  // merge. A PUT that finds the hub's copy changed meanwhile compares again.
  async function retros(run, key, have) {
    conflicts.delete(key)
    for (const rel of RETRO_NAMES) {
      for (let tries = 1; !(await retro(run, key, rel, have)); tries++) {
        if (tries === 3) throw new Error(`the hub's ${key}/${rel} changed while it was being sent, 3 times`)
        const m = ok(await hub.json("GET", runPath(run.project, run.runId, "manifest")), key)
        if (m.files[rel]) have[rel] = m.files[rel]
        else delete have[rel]
      }
    }
  }

  // one retro file; false when the hub's copy changed under a PUT
  async function retro(run, key, rel, have) {
    const tree = `retro:${key}`
    const url = runPath(run.project, run.runId, "files", ...rel.split("/"))
    const full = path.join(run.dir, ...rel.split("/"))
    let L
    try { L = sha256(fs.readFileSync(full)) } catch {}
    const H = have[rel] && have[rel].hash
    const B = (readBase(root)[tree] || {})[rel]
    if (L === H) {
      if (L && B !== L) await agree(tree, rel, L)
      return true
    }
    if (!L || (L === B && H)) {
      // only the hub's copy moved
      if (H === B) return true
      const got = await hub.download(url, have[rel].size)
      ok(got, `${key}/${rel}`)
      await writeAtomic(full, got.buf)
      await agree(tree, rel, got.hash)
      return true
    }
    if (!H || (B !== undefined && H === B)) {
      // only this PC's copy moved, or the hub has none
      const r = await put(run, rel, have, H ? { "if-match": H } : { "if-none-match": "*" })
      if (r.status === 412) return false
      if (r.status === 0) return true
      ok(r, `${key}/${rel}`)
      await agree(tree, rel, have[rel].hash)
      return true
    }
    const got = await hub.download(url, have[rel].size)
    ok(got, `${key}/${rel}`)
    const mine = fs.readFileSync(full, "utf8")
    const merged = retroMerge(mine, String(got.buf))
    if (merged === null) {
      conflicts.set(key, { kind: "retro", project: run.project, runId: run.runId, local: L, hub: got.hash })
      return true
    }
    if (merged !== mine) await writeAtomic(full, merged)
    const hash = sha256(merged)
    if (hash !== got.hash) {
      const r = await hub.upload(url, Buffer.from(merged), { "if-match": got.hash })
      if (r.status === 412) return false
      ok(r, `${key}/${rel}`)
      have[rel] = { size: Buffer.byteLength(merged), hash }
    }
    await agree(tree, rel, hash)
    return true
  }

  // ---------- reconcile, changes ----------

  // one run at a time per run: a reconcile and a change never send it together
  const locks = new Map()
  function lockRun(key, fn) {
    const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn)
    locks.set(key, next)
    next.catch(() => {}).then(() => { if (locks.get(key) === next) locks.delete(key) })
    return next
  }

  // runs gone from this PC are no longer counted or reported
  function sweep(runs) {
    const here = new Set(runs.map(r => `${r.project}/${r.runId}`))
    for (const m of [known, pending, lost, collisions, conflicts, seen]) for (const k of [...m.keys()]) if (!here.has(k)) m.delete(k)
  }

  async function reconcileOnce() {
    const runs = localRuns(root)
    sweep(runs)
    let listed = new Map()
    try {
      const r = await hub.json("GET", "/api/hub/runs")
      const runsOf = ok(r, "its runs")
      listed = new Map((runsOf && runsOf.runs || []).map(x => [`${x.project}/${x.runId}`, { record: x, digest: x.digest }]))
      online()
    } catch (e) {
      // offline, the runs below are only counted, and so are catalog edits
      if (!failed(e)) return
      catalogUnsent = catalog.unsent(root)
    }
    for (const run of runs) {
      const key = `${run.project}/${run.runId}`
      try { await lockRun(key, () => syncRun(run, listed.get(key) || null)) } catch (e) { failed(e) }
    }
    if (refresh && state.reachable) {
      refresh = false
      try {
        await catalog.sync(root, hub)
        catalogUnsent = 0
      } catch (e) {
        if (failed(e)) catalogUnsent = catalog.unsent(root)
      }
    }
    touch()
  }

  let running = null
  let again = false
  // a reconcile asked for while one runs follows it
  function reconcile() {
    if (stopped) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await reconcileOnce().catch(failed)
      } while (again && !stopped)
    })().finally(() => { running = null })
    return running
  }

  // a changed run is sent once its changes pause
  async function flush(key) {
    const run = localRuns(root).find(r => `${r.project}/${r.runId}` === key)
    if (!run) return
    // a run another PC held may be this PC's again (resumed from the hub)
    const last = known.get(key)
    try { await lockRun(key, () => syncRun(run, last && !last.elsewhere ? last : undefined)) } catch (e) { failed(e) }
  }

  // a watch event's name under root (null when unknown): the run it names is
  // sent soon; any other name compares every run
  function mark(name) {
    if (stopped) return
    lastChange = Date.now()
    const parts = name ? name.split(/[\\/]/) : []
    const key = parts.length >= 3 && STATES.includes(parts[1]) ? `${parts[0]}/${parts[2]}` : ""
    clearTimeout(timers.runs.get(key))
    timers.runs.set(key, setTimeout(() => {
      timers.runs.delete(key)
      ;(key ? flush(key) : reconcile()).catch(() => {})
    }, T.debounceMs))
  }

  function start() {
    refresh = true
    reconcile()
    timers.intervals.push(setInterval(reconcile, T.reconcileMs), setInterval(() => writeStatus(true), T.heartbeatMs))
    for (const t of timers.intervals) t.unref()
  }

  function stop() {
    stopped = true
    for (const t of timers.runs.values()) clearTimeout(t)
    clearTimeout(timers.status)
    clearTimeout(timers.retry)
    for (const t of timers.intervals) clearInterval(t)
  }

  return {
    server,
    start,
    stop,
    mark,
    reconcile,
    // a kick: compare every run now, and sync the catalog and rules
    kick: () => {
      refresh = true
      return reconcile()
    },
    status: () => shown || { ...current(), at: iso() },
    unsent: () => current().unsent,
    lastChange: () => lastChange,
  }
}

module.exports = { makeUploader }
