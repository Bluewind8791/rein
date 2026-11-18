// Path handling shared by the stages. Nothing here touches $: the engine
// follows $ only into functions of register.ts itself.

export const slash = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")

// G14: forward slashes, a relative path taken under root, Git Bash's /e/…
// read as e:/… when root has a drive letter, "." and ".." folded. Case is
// kept for the file system; compare with same() and under().
export function resolve(path: string, root: string): string {
  let p = path.replace(/\\/g, "/")
  if (/^[A-Za-z]:\//.test(root)) p = p.replace(/^\/([A-Za-z])(?=\/|$)/, (_, d: string) => `${d.toUpperCase()}:`)
  if (!/^([A-Za-z]:)?\//.test(p)) p = `${root}/${p}`
  const [head, ...rest] = p.split("/")
  const out: string[] = []
  for (const seg of rest) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") out.pop()
    else out.push(seg)
  }
  return `${head}/${out.join("/")}`
}

// Case folds only for a path with a drive letter: Windows file systems
// ignore case, POSIX ones do not. Both sides are resolve()d first.
const fold = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p)

export const same = (a: string, b: string) => fold(a) === fold(b)

export const under = (path: string, dir: string) => fold(path).startsWith(fold(dir).replace(/\/$/, "") + "/")

// An absolute spelling, drive, root or home, that a pattern could reach out with.
export const isAbsolute = (p: string) => /^([A-Za-z]:)?[\\/]|^~/.test(p)

// A ".." segment could climb out after a prefix or equality check matches.
export const climbs = (path: string) => path.replace(/\\/g, "/").split("/").includes("..")

// A spelling the engine or Windows reads differently from resolve(): `~`
// (expanded), `\\` or `//` (device and network paths), a segment ending in
// a dot or space (Windows drops them), a colon past the drive letter (an
// alternate data stream), or ".." (climbs out after a prefix check).
export function unsure(path: string): boolean {
  const p = path.replace(/\\/g, "/")
  if (/^~|^\/\//.test(p) || climbs(p)) return true
  const segments = p.replace(/^[A-Za-z]:/, "").split("/")
  return segments.some(s => s.includes(":") || (s !== "." && /[. ]$/.test(s)))
}

// The path a write tool names, resolved; undefined when it names none or
// spells it in a way the hook cannot check (unsure).
export function writeTarget(input: Record<string, unknown>, root: string): string | undefined {
  const path = input.file_path ?? input.notebook_path
  if (typeof path !== "string" || unsure(path)) return undefined
  return resolve(path, root)
}

// a linked worktree's .git is a file, `gitdir: <main>/.git/worktrees/<name>`.
// The main repository's folder name, else undefined (a .git folder, a
// submodule's .git file, a bare repository).
export function worktreeMain(gitFile: string, root: string): string | undefined {
  const dir = /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(gitFile)?.[1]
  if (dir === undefined) return undefined
  return /\/([^/]+)\/\.git\/worktrees\/[^/]+$/.exec(resolve(dir, root))?.[1]
}
