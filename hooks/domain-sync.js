// After /rein:update, brings each domain a ~/.rein/<project>/ took (its
// rules/<domain>/ or knowledge/<domain>/ exists) up to the new catalog. The
// base is the catalog of the plugin that runs this, the one the local copy
// most likely came from. A local file whose body still equals the base takes
// the new one; its `paths:` stays local, since /rein:setup fits the globs to
// the repository. Anything else is left for the user to decide.
const fs = require("fs")
const path = require("path")
const { pathsBlock, body, withPaths } = require("../frame/text.js")

function files(dir, rel = "") {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...files(path.join(dir, e.name), r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

function dirs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
}

// With LF line endings: a cache checkout or an editor may turn LF into CRLF,
// which is no change.
function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null
}

function pathsOf(text) {
  const b = pathsBlock(text)
  return b ? b.text : null
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

// done: { file, action } for each write or delete.
// conflicts: { file, catalog, reason } — "changed" (the local body is not
// the base's) or "removed" (gone from the catalog, the local copy changed).
// paths: { file, local, catalog } — the catalog changed the globs of a file
// whose globs were fitted locally; the file took the new body, kept its globs.
// skip: the domains left alone (the hub has them).
function syncDomains(baseRoot, newRoot, reinDir, skip = new Set()) {
  const done = []
  const conflicts = []
  const paths = []
  for (const domain of dirs(path.join(newRoot, "domains"))) {
    if (skip.has(domain)) continue
    for (const project of dirs(reinDir)) {
      const local = kind => path.join(reinDir, project, kind, domain)
      if (!fs.existsSync(local("rules")) && !fs.existsSync(local("knowledge"))) continue
      for (const kind of ["rules", "knowledge"]) {
        const newDir = path.join(newRoot, "domains", domain, kind)
        const baseDir = path.join(baseRoot, "domains", domain, kind)
        const rels = [...new Set([...files(newDir), ...files(baseDir)])].sort()
        for (const rel of rels) {
          const file = path.join(local(kind), rel)
          const catalog = path.join(newDir, rel)
          const n = read(catalog)
          const b = read(path.join(baseDir, rel))
          const l = read(file)
          if (n !== null) {
            if (l === null) {
              write(file, n)
              done.push({ file, action: "copied" })
            } else if (l === n) {
              continue
            } else if (b !== null && body(l) === body(b)) {
              const pl = pathsOf(l)
              if (pl === pathsOf(b)) {
                write(file, n)
                done.push({ file, action: "updated" })
                continue
              }
              const next = withPaths(n, pl)
              if (next !== l) {
                write(file, next)
                done.push({ file, action: "updated, local paths kept" })
              }
              if (pathsOf(b) !== pathsOf(n)) paths.push({ file, local: pl, catalog: pathsOf(n) })
            } else if (body(l) === body(n)) {
              // the new body with local globs already, as after a second
              // /rein:update before /reload-plugins
              continue
            } else {
              conflicts.push({ file, catalog, reason: "changed" })
            }
          } else if (l !== null) {
            if (body(l) === body(b)) {
              fs.unlinkSync(file)
              done.push({ file, action: "deleted" })
            } else {
              conflicts.push({ file, catalog: null, reason: "removed" })
            }
          }
        }
      }
    }
  }
  return { done, conflicts, paths }
}

module.exports = { syncDomains }
