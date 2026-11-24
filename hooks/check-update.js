// at session start, tell the user when the installed Rein is older than
// the latest release tag. It never updates anything and never blocks a session:
// every path ends in exit 0.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"))
  } catch {
    return {}
  }
}

// Numeric parts compared in order; a missing part counts as 0.
function compare(a, b) {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

// git ls-remote takes the same credential path as the marketplace clone, so a
// private repository works where an unauthenticated raw download gets 404.
function latestTag(name, repository) {
  const out = execFileSync("git", ["ls-remote", "--tags", repository], {
    encoding: "utf8",
    timeout: 2000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  })
  const prefix = `refs/tags/${name}--v`
  let latest
  for (const line of out.split("\n")) {
    const ref = (line.split("\t")[1] || "").trim().replace(/\^\{\}$/, "")
    if (!ref.startsWith(prefix)) continue
    const version = ref.slice(prefix.length)
    if (!/^\d+(\.\d+)*$/.test(version)) continue
    if (latest === undefined || compare(version, latest) > 0) latest = version
  }
  return latest
}

function main() {
  if (readStdin().source === "compact") return
  const root = process.env.CLAUDE_PLUGIN_ROOT
  // A local dev install (junction, --plugin-dir) would read an unpushed tree as an update.
  if (!root || !root.replace(/\\/g, "/").includes("/plugins/cache/")) return

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"))
  } catch {
    return
  }
  const { name, version, repository } = manifest
  if (typeof name !== "string" || typeof version !== "string") return

  const cacheDir = path.join(os.homedir(), `.${name}`)
  const cacheFile = path.join(cacheDir, "update-check.json")
  let latest
  try {
    if (typeof repository === "string") latest = latestTag(name, repository)
  } catch {
    latest = undefined
  }
  if (latest !== undefined) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ latest, checkedAt: new Date().toISOString() }) + "\n", "utf8")
    } catch {
      // A cache that cannot be written only costs the offline fallback.
    }
  }
  if (latest === undefined) {
    try {
      latest = JSON.parse(fs.readFileSync(cacheFile, "utf8")).latest
    } catch {
      return
    }
  }
  if (typeof latest !== "string" || compare(latest, version) <= 0) return

  let systemMessage = `[${name}] 업데이트 있음: 설치 ${version} → 최신 ${latest} - /${name}:update 로 적용(그 뒤 /reload-plugins)`
  // The same two commands /rein:update runs, for a terminal outside the session.
  let install
  try {
    install = require("./plugin-update.js").pick(name)
  } catch {
    install = undefined
  }
  if (install) {
    systemMessage += `, 터미널에서는 claude plugin marketplace update ${install.marketplace} 후 claude plugin update ${install.id}`
  }
  process.stdout.write(JSON.stringify({ systemMessage }) + "\n")
}

try {
  main()
} catch {
  // Offline, behind a proxy, or anything else: the session goes on.
}
// exitCode, not exit(): exit() can cut off a pending stdout write to a pipe.
process.exitCode = 0
