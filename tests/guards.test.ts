import { describe, expect } from "claude-code/testing"
import { itemPath } from "../hooks/lib/parse.ts"
import { same, under } from "../hooks/lib/paths.ts"
import { DIR, REIN, world, test } from "./world.ts"

// Guards that hold in every stage: the main session in a stage not built
// yet, the reads tool.check allows, and path spelling.

const write = (file_path: string) => ({ tool: "Write", file_path, content: "x" }) as never
const allow = expect.objectContaining({ decision: "allow" })
const ask = { decision: "ask" }

describe("a stage the hook does not know", () => {
  // the main session is not held to a row, whatever the stage.
  test("the main session still writes", async ($, on) => {
    world(on, {}, undefined, { stage: "weird", runId: "login-fix" })
    expect(await $.tool.call(write(`${DIR}/6-land.md`))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.call(write("E:/proj/src/a.ts"))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await $.tool.check({ tool: "Write", input: { file_path: `${DIR}/6-land.md`, content: "x" } } as never)).toEqual(allow)
    expect(await $.tool.check({ tool: "Write", input: { file_path: `${REIN}/rules/api.md`, content: "x" } } as never)).toEqual(ask)
  })
})

describe("read allowance", () => {
  test("a Glob pattern or Grep glob that climbs or is absolute is not auto-allowed", async ($, on) => {
    world(on, {})
    const glob = (pattern: string) => ({ tool: "Glob", input: { path: DIR, pattern } }) as never
    const grep = (g: string) => ({ tool: "Grep", input: { path: DIR, pattern: "x", glob: g } }) as never
    expect(await $.tool.check(glob("*.md"))).toEqual(allow)
    expect(await $.tool.check(glob("../../**/*.md"))).toEqual(ask)
    expect(await $.tool.check(glob("C:/Users/u/**"))).toEqual(ask)
    expect(await $.tool.check(glob("/etc/*"))).toEqual(ask)
    expect(await $.tool.check(grep("**/*.md"))).toEqual(allow)
    expect(await $.tool.check(grep("../*"))).toEqual(ask)
  })
})

describe("paths", () => {
  test("case folds only for paths with a drive letter", () => {
    expect(same("E:/Proj/a.ts", "e:/proj/A.ts")).toBe(true)
    expect(same("/home/u/a.ts", "/home/u/A.ts")).toBe(false)
    expect(under("E:/PROJ/src/a.ts", "e:/proj")).toBe(true)
    expect(under("/Home/u/a.ts", "/home/u")).toBe(false)
  })

  test("an item names one path and at most a new-file note", () => {
    expect(itemPath("src/a.ts")).toBe("src/a.ts")
    expect(itemPath("`src/a.ts` — 새 파일")).toBe("src/a.ts")
    expect(itemPath("src/a.ts (새 파일)")).toBe("src/a.ts")
    expect(itemPath("`docs/my file.md`")).toBe("docs/my file.md")
    expect(itemPath("src/a.ts 수정")).toBeUndefined()
    expect(itemPath("my file.md")).toBeUndefined()
    expect(itemPath("")).toBeUndefined()
  })
})
