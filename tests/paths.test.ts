import { describe, expect, test } from "claude-code/testing"
import { unsure } from "../hooks/lib/paths.ts"
import { DIR, REIN, world } from "./world.ts"

// Spellings that land somewhere other than they read: refused by their
// spelling, or caught where they really land. Rein's agents are held to a
// row; each stage's here, writing as its agent.

const FILES = ["E:/proj/src/login.ts"]
const AGENT = "agent-1"
const FIELD: Record<string, string> = { dev: "worker", review: "reviewer", "qa-integration": "verifier" }
const run = (stage: string) => ({ v: 2, stage, runId: "login-fix", rules: [], planFiles: FILES, repos: ["E:/proj"], writes: [], retries: 0, [FIELD[stage]!]: AGENT })
const write = (file_path: string) => ({ tool: "Write", file_path, content: "x", agentId: AGENT }) as never
const refused = expect.objectContaining({ deny: expect.stringContaining("D46: in the dev stage the only Rein file") })

const TRICKS = [
  "~/.rein/proj/active/login-fix/1-spec.md",
  "//?/C:/Users/u/.rein/proj/active/login-fix/2-plan.md",
  "\\\\?\\C:\\Users\\u\\.rein\\proj\\active\\login-fix\\2-plan.md",
  "C:/Users/u/.rein./proj/active/login-fix/2-plan.md",
  "E:/proj/.rein/config.json.",
  "E:/proj/.rein /config.json",
  "E:/proj/src/login.ts::$DATA",
  "/c/Users/u/.rein/proj/active/login-fix/1-spec.md",
  "C:/USERS/U/.REIN/PROJ/ACTIVE/LOGIN-FIX/1-SPEC.MD",
]

describe("path spellings", () => {
  test("the spelling guard", () => {
    for (const p of TRICKS.slice(0, 7)) expect([p, unsure(p)]).toEqual([p, true])
    for (const p of ["E:/proj/src/a.ts", "./src/a.ts", "src/.eslintrc", "E:\\proj\\a.ts"]) expect([p, unsure(p)]).toEqual([p, false])
  })

  for (const stage of ["dev", "review", "qa-integration"]) {
    test(`every trick is refused in ${stage}`, async ($, on) => {
      world(on, { "E:/proj/.git/HEAD": "" }, undefined, run(stage))
      // Spellings the guard cannot check get one answer in every stage; the
      // rest resolve to 1-spec.md and meet the stage's own rule.
      const own: Record<string, string> = { dev: "D43", review: "D117", "qa-integration": "D74" }
      for (const p of TRICKS.slice(0, 7)) {
        expect([p, await $.tool.call(write(p))]).toEqual([p, expect.objectContaining({ deny: expect.stringContaining("D46: the path names no file, or spells it") })])
      }
      for (const p of TRICKS.slice(7)) {
        expect([p, await $.tool.call(write(p))]).toEqual([p, expect.objectContaining({ deny: expect.stringMatching(new RegExp(`^${own[stage]}:`)) })])
      }
    })
  }

  test("a link into ~/.rein is caught where it lands", async ($, on) => {
    const real = (p: string) => (p.toLowerCase().startsWith("e:/proj/link") ? `${DIR}${p.slice("E:/proj/link".length)}` : undefined)
    world(on, {}, undefined, run("dev"), { real })
    expect(await $.tool.call(write("E:/proj/link/2-plan.md"))).toEqual(expect.objectContaining({ deny: expect.stringContaining("D46: 2-plan.md cannot be written in dev") }))
    expect(await $.tool.call(write("E:/proj/src/login.ts"))).toEqual(expect.objectContaining({ result: "ok" }))
  })

  test("a link to a config.json is caught where it lands", async ($, on) => {
    const real = (p: string) => (p === "E:/proj/src/cfg.json" ? "E:/proj/.rein/config.json" : undefined)
    world(on, {}, undefined, run("dev"), { real })
    expect(await $.tool.call(write("E:/proj/src/cfg.json"))).toEqual(expect.objectContaining({ deny: expect.stringContaining("config.json") }))
  })

  test("the rules folder is refused in dev by any spelling", async ($, on) => {
    world(on, {}, undefined, run("dev"))
    expect(await $.tool.call(write(`${REIN}/rules/api.md`))).toEqual(refused)
    expect(await $.tool.call(write(`${REIN.toUpperCase()}/RULES/api.md`))).toEqual(refused)
  })
})
