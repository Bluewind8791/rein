// The domain catalog and the shared rules against the hub: each local tree
// is compared, file by file, with the hub's copy and with base.json (the
// body hashes when both sides last agreed). The side that moved wins; both
// moved is a conflict, and nothing is written. Domains the hub does not have
// are left alone.
//
// Local trees, with their key in base.json:
//   <project>/rules/<domain>, <project>/knowledge/<domain>   a project's copy
//   .hub/catalog/<domain>                                    a checkout (catalog checkout)
//   rules                                                    the shared rules
//
// <root>/.hub/catalog.json keeps the last outcome (what came down, the rules
// whose hub `paths:` differ from the local one, the conflicts); the local
// server shows it in status.json. A conflict's hub copy is written under
// <root>/.hub/conflict/<tree>/<rel>.
//
// Zero dependencies; Node 18 or later.
"use strict"

const fs = require("fs")
const path = require("path")
const { pathsBlock, withPaths, isRule, bodyHash, NAME_OK } = require("./text.js")
const { readJson, listDir } = require("./view.js")
const { OfflineError, makeClient, serverOf, localFiles, writeAtomic, readBase, withBase } = require("./sync.js")

const iso = () => new Date().toISOString()
const LF = text => String(text).replace(/\r\n/g, "\n")
const pathsOf = text => {
  const b = pathsBlock(LF(text))
  return b ? b.text : null
}
// a folder under root that holds runs, not the hub's or the frame's own
const PROJECT_OK = name => NAME_OK(name) && !name.startsWith(".") && name !== "frame" && name !== "rules"

const ok = (r, what) => {
  if (r.status < 200 || r.status > 299) throw new Error(`the hub answered ${r.status} for ${what}${r.json && r.json.error ? `: ${r.json.error}` : ""}`)
  return r.json
}

// ---------- trees ----------

// a tree of a catalog domain: prefix is where its files sit in the domain
// ("rules/", "knowledge/", or "" for a whole checkout)
function domainTree(root, key, domain, prefix) {
  return {
    key, kind: "catalog", dir: path.join(root, ...key.split("/")),
    hashRel: rel => prefix + rel,
    url: rel => "/api/catalog/" + [domain, ...(prefix + rel).split("/")].map(encodeURIComponent).join("/"),
    // the hub's files of this tree as { rel: hash }; null when the hub has no such domain
    hubFiles: catalog => {
      const files = catalog.get(domain)
      if (!files) return null
      return Object.fromEntries(Object.entries(files).filter(([rel]) => rel.startsWith(prefix)).map(([rel, h]) => [rel.slice(prefix.length), h]))
    },
  }
}

const rulesTree = root => ({
  key: "rules", kind: "rules", dir: path.join(root, "rules"),
  hashRel: rel => `rules/${rel}`,
  url: rel => "/api/rules/" + rel.split("/").map(encodeURIComponent).join("/"),
  hubFiles: (catalog, rules) => rules,
})

function localTrees(root) {
  const trees = []
  for (const p of listDir(root)) {
    if (!p.isDirectory() || !PROJECT_OK(p.name)) continue
    for (const kind of ["rules", "knowledge"]) {
      for (const d of listDir(path.join(root, p.name, kind))) if (d.isDirectory()) trees.push(domainTree(root, `${p.name}/${kind}/${d.name}`, d.name, `${kind}/`))
    }
  }
  for (const d of listDir(path.join(root, ".hub", "catalog"))) if (d.isDirectory()) trees.push(domainTree(root, `.hub/catalog/${d.name}`, d.name, ""))
  trees.push(rulesTree(root))
  return trees
}

const fileOf = (t, rel) => path.join(t.dir, ...rel.split("/"))

// a tree's files as { rel: body hash }
function bodies(t) {
  const out = {}
  for (const rel of Object.keys(localFiles(t.dir))) out[rel] = bodyHash(t.hashRel(rel), fs.readFileSync(fileOf(t, rel)))
  return out
}

// the hub's catalog as Map(domain -> { rel: hash }) and its shared rules as { rel: hash }
async function listings(hub, trees) {
  const catalog = trees.some(t => t.kind === "catalog") ? new Map(ok(await hub.json("GET", "/api/catalog"), "the catalog").domains.map(d => [d.id, d.files])) : new Map()
  const rules = trees.some(t => t.kind === "rules") ? ok(await hub.json("GET", "/api/rules"), "the shared rules").files : {}
  return { catalog, rules }
}

// ---------- one tree ----------

// what one sync did; trees are the keys it compared
const outcome = () => ({ trees: [], sent: [], updated: [], pathsChanged: [], conflicts: [] })

async function download(hub, t, rel) {
  const got = await hub.download(t.url(rel))
  if (got.status !== 200) throw new Error(`the hub answered ${got.status} for ${fileOf(t, rel)}`)
  return got.buf
}

// the hub's copy into the local file; a rule keeps its local `paths:`
async function takeHub(hub, t, rel, said) {
  const file = fileOf(t, rel)
  const buf = await download(hub, t, rel)
  let data = buf
  if (fs.existsSync(file) && isRule(t.hashRel(rel))) {
    const [mine, theirs] = [pathsOf(fs.readFileSync(file)), pathsOf(buf)]
    data = withPaths(LF(buf), mine)
    if (mine !== theirs) said.pathsChanged.push({ file, local: mine, hub: theirs })
  }
  await writeAtomic(file, data)
  said.updated.push(file)
  return bodyHash(t.hashRel(rel), buf)
}

// a conflict: the hub's copy (h, when it has one) goes under .hub/conflict/
async function conflict(root, hub, t, rel, l, h, said) {
  const copy = path.join(root, ".hub", "conflict", ...t.key.split("/"), ...rel.split("/"))
  if (h) await writeAtomic(copy, await download(hub, t, rel))
  else fs.rmSync(copy, { force: true })
  said.conflicts.push({ kind: t.kind, tree: t.key, path: fileOf(t, rel), local: l || null, hub: h || null, copy: h ? copy : null })
}

// the local file to the hub: if-match b, or if-none-match * when b is none.
// The hash both sides now have; undefined on a conflict.
async function push(root, hub, t, rel, l, b, said) {
  const file = fileOf(t, rel)
  const r = await hub.upload(t.url(rel), fs.readFileSync(file), b ? { "if-match": b } : { "if-none-match": "*" })
  if (r.status === 200) {
    said.sent.push(file)
    return r.json.hash
  }
  if (r.status !== 412) ok(r, file)
  const h = r.json && r.json.hash
  // another sync sent the same body meanwhile
  if (h === l) return l
  await conflict(root, hub, t, rel, l, h, said)
}

// one tree against the hub's files, by the table of plan 5.3 (L local, H
// hub, B base); a file gone here but on the hub comes back.
async function syncTree(root, hub, t, hubFiles, said) {
  said.trees.push(t.key)
  const base = readBase(root)[t.key] || {}
  const local = bodies(t)
  // rel -> the hash both sides now have, or null when neither has the file
  const agreed = {}
  for (const rel of [...new Set([...Object.keys(local), ...Object.keys(hubFiles), ...Object.keys(base)])].sort()) {
    const [l, h, b] = [local[rel], hubFiles[rel], base[rel]]
    if (l === h) {
      if (b !== (l || undefined)) agreed[rel] = l || null
    } else if (!l || l === b) {
      // only the hub's copy moved
      if (h) agreed[rel] = await takeHub(hub, t, rel, said)
      else {
        fs.rmSync(fileOf(t, rel), { force: true })
        said.updated.push(fileOf(t, rel))
        agreed[rel] = null
      }
    } else if (h === b) {
      // only this PC's copy moved, or it is new here
      const now = await push(root, hub, t, rel, l, b, said)
      if (now) agreed[rel] = now
    } else {
      await conflict(root, hub, t, rel, l, h, said)
    }
  }
  if (Object.keys(agreed).length) {
    await withBase(all => {
      const m = { ...(all[t.key] || {}) }
      for (const [rel, h] of Object.entries(agreed)) {
        if (h === null) delete m[rel]
        else m[rel] = h
      }
      if (Object.keys(m).length) all[t.key] = m
      else delete all[t.key]
    }, root)
  }
}

// <root>/.hub/catalog.json: the last outcome; conflicts of trees not compared
// this time stay
async function record(root, said) {
  const file = path.join(root, ".hub", "catalog.json")
  const was = readJson(file) || {}
  const conflicts = [...(was.conflicts || []).filter(c => !said.trees.includes(c.tree)), ...said.conflicts]
  await writeAtomic(file, JSON.stringify({ at: iso(), updated: said.updated, pathsChanged: said.pathsChanged, conflicts }, null, 2))
}

// the trees pick chooses against the hub; the outcome
async function sync(root, hub, pick = () => true) {
  const trees = localTrees(root).filter(pick)
  const { catalog, rules } = await listings(hub, trees)
  const said = outcome()
  for (const t of trees) {
    const files = t.hubFiles(catalog, rules)
    if (files) await syncTree(root, hub, t, files, said)
  }
  await record(root, said)
  return said
}

// local edits not on the hub yet: files of a tree that synced before whose
// body is not the base's, or that are new
function unsent(root) {
  const base = readBase(root)
  let n = 0
  for (const t of localTrees(root)) {
    const b = base[t.key]
    if (!b) continue
    for (const [rel, l] of Object.entries(bodies(t))) if (b[rel] !== l) n++
  }
  return n
}

// ---------- take, resolve ----------

// a project's copy of each domain: files only on the hub are copied, those
// with the same body left (their local `paths:` too). A domain whose files
// differ, or that has files the hub lacks, is only reported unless
// overwrite; deleteExtra deletes those extra files.
async function take(root, hub, project, domains, { overwrite = false, deleteExtra = false } = {}) {
  if (!PROJECT_OK(project)) throw new Error(`not a project name: ${project}`)
  const { catalog } = await listings(hub, [{ kind: "catalog" }])
  for (const d of domains) if (!catalog.has(d)) throw new Error(`the hub has no domain ${d}`)
  const out = []
  for (const domain of domains) {
    const trees = ["rules", "knowledge"].map(kind => domainTree(root, `${project}/${kind}/${domain}`, domain, `${kind}/`))
    const said = { domain, taken: false, written: [], deleted: [], differing: [], extra: [] }
    const writes = []
    for (const t of trees) {
      const local = bodies(t)
      const hubFiles = t.hubFiles(catalog)
      for (const rel of Object.keys(local)) if (!(rel in hubFiles)) said.extra.push(fileOf(t, rel))
      for (const [rel, h] of Object.entries(hubFiles)) {
        if (local[rel] === h) continue
        const buf = await download(hub, t, rel)
        writes.push({ t, rel, buf })
        if (!local[rel]) continue
        const [mine, theirs] = [pathsOf(fs.readFileSync(fileOf(t, rel))), pathsOf(buf)]
        said.differing.push(isRule(t.hashRel(rel)) && mine !== theirs ? { file: fileOf(t, rel), paths: { local: mine, hub: theirs } } : { file: fileOf(t, rel) })
      }
    }
    out.push(said)
    if ((said.differing.length || said.extra.length) && !overwrite) continue
    for (const { t, rel, buf } of writes) {
      await writeAtomic(fileOf(t, rel), buf)
      said.written.push(fileOf(t, rel))
    }
    if (deleteExtra) {
      for (const file of said.extra) fs.rmSync(file, { force: true })
      said.deleted = said.extra
    }
    for (const t of trees) {
      const hubFiles = t.hubFiles(catalog)
      const got = Object.fromEntries(writes.filter(w => w.t === t).map(w => [w.rel, bodyHash(t.hashRel(w.rel), w.buf)]))
      await withBase(all => { all[t.key] = { ...hubFiles, ...got } }, root)
    }
    said.taken = true
  }
  return { project, domains: out }
}

// a conflict settled: mine sends the local file over the hub's current copy,
// otherwise the hub's copy comes down (a rule keeps its local `paths:`)
async function resolve(root, hub, file, mine) {
  const full = path.resolve(file)
  const t = localTrees(root).find(t => {
    const rel = path.relative(t.dir, full)
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
  })
  if (!t) throw new Error(`not a file of a catalog copy or the shared rules: ${full}`)
  const rel = path.relative(t.dir, full).split(path.sep).join("/")
  const { catalog, rules } = await listings(hub, [t])
  const hubFiles = t.hubFiles(catalog, rules)
  if (!hubFiles) throw new Error(`the hub has no domain for ${full}`)
  const h = hubFiles[rel]
  const said = outcome()
  let now
  if (mine) {
    if (!fs.existsSync(full)) throw new Error(`${full} is not there to keep`)
    now = await push(root, hub, t, rel, bodyHash(t.hashRel(rel), fs.readFileSync(full)), h, said)
  } else if (h) {
    now = await takeHub(hub, t, rel, said)
  } else {
    fs.rmSync(full, { force: true })
    now = null
  }
  if (now === undefined) return { file: full, conflicts: said.conflicts }
  await withBase(all => {
    const m = { ...(all[t.key] || {}) }
    if (now === null) delete m[rel]
    else m[rel] = now
    all[t.key] = m
  }, root)
  const kept = path.join(root, ".hub", "catalog.json")
  const was = readJson(kept)
  if (was) await writeAtomic(kept, JSON.stringify({ ...was, conflicts: (was.conflicts || []).filter(c => path.resolve(c.path) !== full) }, null, 2))
  fs.rmSync(path.join(root, ".hub", "conflict", ...t.key.split("/"), ...rel.split("/")), { force: true })
  return { file: full, resolved: mine ? "mine" : "hub" }
}

// ---------- the commands (frame/sync.js runs them) ----------

function hubOf(root) {
  const server = serverOf(root)
  if (!server) throw new Error(`${path.join(root, "sync.json")} names no hub server`)
  return makeClient({ server, client: "cli" })
}

// conflict<TAB><local file><TAB><hub copy, or - when the hub deleted it>
const printConflicts = conflicts => {
  for (const c of conflicts) console.log(`conflict\t${c.path}\t${c.copy || "-"}`)
}

// a sync the command asked for; offline, the local edits still to send
async function syncCommand(root, pick) {
  try {
    const said = await sync(root, hubOf(root), pick)
    printConflicts(said.conflicts)
    const { trees, ...rest } = said
    return rest
  } catch (e) {
    if (e instanceof OfflineError) return { offline: true, error: e.message, unsent: unsent(root) }
    throw e
  }
}

async function resolveCommand(root, rest, opts) {
  if (!rest[0] || opts["keep-mine"] === opts["take-hub"]) throw new Error("usage: resolve <file> --keep-mine|--take-hub")
  const said = await resolve(root, hubOf(root), rest[0], !!opts["keep-mine"])
  if (said.conflicts) printConflicts(said.conflicts)
  return said
}

const isCatalog = t => t.kind === "catalog"

const commands = {
  refresh: root => syncCommand(root),

  async catalog(root, [sub, ...rest], opts) {
    if (sub === "list") {
      const listed = ok(await hubOf(root).json("GET", "/api/catalog"), "the catalog").domains
      const projects = listDir(root).filter(p => p.isDirectory() && PROJECT_OK(p.name)).map(p => p.name)
      return {
        domains: listed.map(d => ({
          id: d.id, name: d.name, description: d.description, files: Object.keys(d.files).length,
          taken: projects.filter(p => ["rules", "knowledge"].some(kind => fs.existsSync(path.join(root, p, kind, d.id)))),
          checkout: fs.existsSync(path.join(root, ".hub", "catalog", d.id)),
        })),
      }
    }
    if (sub === "take") {
      const [project, ...domains] = rest
      if (!project || !domains.length) throw new Error("usage: catalog take <project> <domain>... [--overwrite] [--delete-extra]")
      return take(root, hubOf(root), project, domains, { overwrite: !!opts.overwrite, deleteExtra: !!opts["delete-extra"] })
    }
    if (sub === "checkout") {
      const [domain] = rest
      if (!domain || !NAME_OK(domain)) throw new Error("usage: catalog checkout <domain>")
      const hub = hubOf(root)
      const { catalog } = await listings(hub, [{ kind: "catalog" }])
      if (!catalog.has(domain)) throw new Error(`the hub has no domain ${domain}`)
      const t = domainTree(root, `.hub/catalog/${domain}`, domain, "")
      const said = outcome()
      await syncTree(root, hub, t, t.hubFiles(catalog), said)
      await record(root, said)
      printConflicts(said.conflicts)
      return { dir: t.dir, updated: said.updated, conflicts: said.conflicts }
    }
    if (sub === "push") return syncCommand(root, isCatalog)
    if (sub === "resolve") return resolveCommand(root, rest, opts)
    throw new Error("usage: catalog list|take|checkout|push|resolve")
  },

  async rules(root, [sub, ...rest], opts) {
    if (sub === "pull" || sub === "push") return syncCommand(root, t => !isCatalog(t))
    if (sub === "resolve") return resolveCommand(root, rest, opts)
    throw new Error("usage: rules pull|push|resolve")
  },

  // status.json as the local server last wrote it, with the catalog's
  // outcome and conflicts as catalog.json has them now
  status(root) {
    const st = readJson(path.join(root, ".hub", "status.json")) || {}
    const kept = readJson(path.join(root, ".hub", "catalog.json"))
    const conflicts = [...(st.conflicts || []).filter(c => c.kind === "retro"), ...((kept && kept.conflicts) || [])]
    printConflicts(conflicts.filter(c => c.path))
    return { ...st, conflicts, catalog: kept && { at: kept.at, updated: kept.updated, pathsChanged: kept.pathsChanged } }
  },
}

module.exports = { commands, sync, unsent, take, resolve }
