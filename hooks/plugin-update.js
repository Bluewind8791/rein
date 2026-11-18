// /rein:update. Refreshes the marketplace and updates the installed plugin in
// the scope it was installed in. The session needs /reload-plugins after.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

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
}

if (require.main === module) main().catch(e => console.log(`Update failed: ${e && e.message ? e.message : e}`))
