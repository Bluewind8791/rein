// /rein:update. Refreshes the marketplace, updates the installed plugin in
// the scope it was installed in, then brings the domains each project took up
// to the new catalog, except the domains the hub ~/.rein/sync.json names
// has: the local server syncs those. The session needs /reload-plugins after.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const { syncDomains } = require("./domain-sync.js")
const { makeClient, serverOf, readBase } = require("../frame/sync.js")

// A skill's ! block gets no CLAUDE_PLUGIN_ROOT in its env; this file sits in <root>/hooks.
const root = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(__dirname)

function same(a, b) {
  const norm = p => path.resolve(p).replace(/\\/g, "/").replace(/\/$/, "")
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

function within(dir, project) {
  let at = path.resolve(dir)
  for (;;) {
    if (same(at, project)) return true
    const up = path.dirname(at)
    if (up === at) return false
    at = up
  }
}

// The install attached to this project first, else the user-scope one.
function pick(name) {
  const file = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json")
  const plugins = JSON.parse(fs.readFileSync(file, "utf8")).plugins || {}
  const found = []
  for (const [id, installs] of Object.entries(plugins)) {
    if (!id.startsWith(`${name}@`)) continue
    for (const install of installs) found.push({ id, marketplace: id.slice(name.length + 1), ...install })
  }
  const here = found.filter(i => i.projectPath && within(process.cwd(), i.projectPath))
  here.sort((a, b) => b.projectPath.length - a.projectPath.length)
  return here[0] || found.find(i => i.scope === "user")
}

// claude may be a .cmd shim on Windows, which only a shell can start.
function claude(args, cwd) {
  console.log(`> claude ${args.join(" ")}`)
  const r = spawnSync("claude", args, { cwd, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 180000 })
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim()
  if (out) console.log(out)
  if (r.error) console.log(r.error.message)
  return r.status === 0
}

async function main() {
  const { name } = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"))
  const install = pick(name)
  if (!install) {
    console.log(`${name}: no install found in installed_plugins.json for this project or the user scope. Nothing updated.`)
    return
  }
  const cwd = install.projectPath || process.cwd()
  if (!claude(["plugin", "marketplace", "update", install.marketplace], cwd)) {
    console.log("Marketplace update failed; the plugin was not updated.")
    return
  }
  // The full id: a bare name fails with Plugin "<name>" not found.
  if (!claude(["plugin", "update", install.id, "-s", install.scope], cwd)) {
    console.log("Plugin update failed.")
    return
  }
  console.log("Updated. Run /reload-plugins to load the new version.")
  await domains(name)
}

// the ids of the domains the hub has; an empty set when no hub is set. When
// the hub does not answer within 3 s, the domains this PC synced with it
// before (a tree of theirs in ~/.rein/.hub/base.json) are its.
async function hubDomains(reinDir) {
  const server = serverOf(reinDir)
  if (!server) return new Set()
  const late = new Promise(resolve => setTimeout(resolve, 3000, null).unref())
  const r = await Promise.race([makeClient({ server, client: "update" }).json("GET", "/api/catalog").catch(() => null), late])
  if (r && r.status === 200 && r.json && Array.isArray(r.json.domains)) return new Set(r.json.domains.map(d => d.id))
  const tree = /^(?:[^/]+\/(?:rules|knowledge)|\.hub\/catalog)\/([^/]+)$/
  return new Set(Object.keys(readBase(reinDir)).map(k => tree.exec(k)).filter(Boolean).map(m => m[1]))
}

// The new version sits in its own cache folder; installed_plugins.json names it.
async function domains(name) {
  const install = pick(name)
  if (!install || !install.installPath) {
    console.log("Domains: the updated install has no installPath. Domains not synced.")
    return
  }
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
  const skip = await hubDomains(path.join(home, ".rein"))
  if (skip.size) console.log(`Domains on the hub, synced by the local server: ${[...skip].join(", ")}`)
  let result
  try {
    result = syncDomains(root, install.installPath, path.join(home, ".rein"), skip)
  } catch (e) {
    console.log(`Domains: sync failed: ${e && e.message ? e.message : e}`)
    return
  }
  const { done, conflicts, paths } = result
  if (!done.length && !conflicts.length && !paths.length) {
    console.log("Domains: up to date.")
    return
  }
  console.log("Domains:")
  for (const d of done) console.log(`  ${d.action}: ${d.file}`)
  for (const c of conflicts) {
    if (c.reason === "changed") console.log(`  conflict, local copy changed: ${c.file} (catalog: ${c.catalog})`)
    else console.log(`  conflict, gone from the catalog but local copy changed: ${c.file}`)
  }
  for (const p of paths) {
    console.log(`  paths changed in the catalog, local paths kept: ${p.file}`)
    const show = globs => (globs ?? "(none)").replace(/\n/g, "\n             ")
    console.log(`    local:   ${show(p.local)}`)
    console.log(`    catalog: ${show(p.catalog)}`)
  }
}

if (require.main === module) main().catch(e => console.log(`Update failed: ${e && e.message ? e.message : e}`))

module.exports = { hubDomains }
