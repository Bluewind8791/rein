// `paths:` globs, relative to the session root. `**` crosses folders,
// `*` and `?` stay inside one, `{a,b}` is either. Case-insensitive where
// the file system is (a root with a drive letter).

export function globToRegExp(glob: string, ignoreCase: boolean): RegExp {
  const g = glob.trim().replace(/\\/g, "/").replace(/^\.?\//, "")
  let out = ""
  let depth = 0
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!
    if (ch === "*" && g[i + 1] === "*") {
      // `**` crosses folders only as a whole segment; `src/**.ts` is `*`.
      const whole = (i === 0 || g[i - 1] === "/") && (i + 2 === g.length || g[i + 2] === "/")
      const slash = g[i + 2] === "/"
      out += !whole ? "[^/]*" : slash ? "(?:.*/)?" : ".*"
      i += whole && slash ? 2 : 1
    } else if (ch === "*") out += "[^/]*"
    else if (ch === "?") out += "[^/]"
    else if (ch === "{") {
      out += "(?:"
      depth++
    } else if (ch === "}" && depth > 0) {
      out += ")"
      depth--
    } else if (ch === "," && depth > 0) out += "|"
    else out += ch.replace(/[.+^$()|[\]\\{}]/g, "\\$&")
  }
  return new RegExp(`^${out}$`, ignoreCase ? "i" : "")
}

// Whether a path relative to the root matches any of the globs.
export function matchesAny(globs: string[], rel: string, ignoreCase: boolean): boolean {
  return globs.some(glob => globToRegExp(glob, ignoreCase).test(rel))
}
