"use strict"

const test = require("node:test")
const assert = require("node:assert")
const { body, withPaths, pathsBlock, bodyHash, sha256, treeDigest, safeRel, retroOpen, RETRO_NAMES, pcName } = require("../../frame/text.js")

const RULE = "---\npaths:\n  - src/**/*.ts\n  - lib/*.ts\ndescription: x\n---\n# Rule\n\nDo this.\n"

test("bodyHash ignores the paths: entry of a rule and CRLF", () => {
  const fitted = RULE.replace("src/**/*.ts", "app/**/*.ts")
  assert.strictEqual(bodyHash("rules/a/r.md", fitted), bodyHash("rules/a/r.md", RULE))
  assert.strictEqual(bodyHash("rules/a/r.md", Buffer.from(RULE.replace(/\n/g, "\r\n"))), bodyHash("rules/a/r.md", RULE))
  // the body itself counts
  assert.notStrictEqual(bodyHash("rules/a/r.md", RULE.replace("Do this.", "Do that.")), bodyHash("rules/a/r.md", RULE))
  // outside rules/**/*.md, paths: is text like any other
  assert.notStrictEqual(bodyHash("knowledge/a.md", fitted), bodyHash("knowledge/a.md", RULE))
  assert.strictEqual(bodyHash("knowledge/a.md", RULE.replace(/\n/g, "\r\n")), sha256(RULE))
})

test("withPaths puts back the paths: entry body drops", () => {
  const paths = pathsBlock(RULE).text
  assert.strictEqual(withPaths(body(RULE), paths), RULE)
  // a new body takes the local globs
  const fitted = withPaths(RULE, "paths:\n  - app/**/*.ts")
  assert.strictEqual(withPaths(RULE.replace("Do this.", "Do that."), pathsBlock(fitted).text), fitted.replace("Do this.", "Do that."))
  assert.strictEqual(withPaths(RULE, null), body(RULE))
  assert.strictEqual(withPaths("# no front matter\n", "paths: a/*"), "---\npaths: a/*\n---\n# no front matter\n")
  assert.strictEqual(withPaths("---\nx: 1\n---\nbody\n", "paths: a/*"), "---\npaths: a/*\nx: 1\n---\nbody\n")
})

test("treeDigest is the same whatever order the files come in", () => {
  assert.strictEqual(treeDigest({ b: "2", a: "1" }), treeDigest({ a: "1", b: "2" }))
  assert.strictEqual(treeDigest({ a: "1", b: "2" }), sha256("a\0" + "1\nb\0" + "2\n"))
  assert.notStrictEqual(treeDigest({ a: "1" }), treeDigest({ a: "2" }))
})

test("retroOpen counts candidates still 후보 or 채택", () => {
  const text = "## A\n상태: 후보\n\n## B\r\n상태: 채택\r\n\n## C\n상태: 적용됨 abc123\n\n## D\n상태: 보류 이유\n"
  assert.strictEqual(retroOpen(text), 2)
  assert.strictEqual(retroOpen("## A\n상태: 적용됨 2026-11-18\n"), 0)
  assert.deepStrictEqual(RETRO_NAMES, ["agent/retro.md", "retro.md", "7-retro.md"])
})

test("safeRel takes / paths of plain segments only", () => {
  for (const ok of ["a.md", "agent/evidence/x/1/a.png", "brief/기획서.xlsx"]) assert.ok(safeRel(ok), ok)
  for (const bad of ["", "/a", "a/", "a//b", "../a", "a/../b", "./a", "a\\b", "C:/a", "a:b", "a\0b", undefined]) assert.ok(!safeRel(bad), String(bad))
})

test("pcName follows the hook's order", () => {
  const calls = []
  const run = answers => argv => {
    calls.push(argv.join(" "))
    const a = answers[argv[0]]
    if (a instanceof Error) throw a
    return a
  }
  assert.strictEqual(pcName({ COMPUTERNAME: "PC-A", HOSTNAME: "h" }, run({})), "PC-A")
  assert.strictEqual(pcName({ HOSTNAME: "linux-box" }, run({})), "linux-box")
  assert.deepStrictEqual(calls, [])
  assert.strictEqual(pcName({}, run({ scutil: "Example-Mac\n", hostname: "dhcp-1.local" })), "Example-Mac")
  assert.strictEqual(pcName({}, run({ scutil: new Error("ENOENT"), hostname: "box\n" })), "box")
  assert.strictEqual(pcName({}, run({ scutil: "", hostname: new Error("ENOENT") })), "unknown")
  assert.deepStrictEqual(calls, ["scutil --get LocalHostName", "scutil --get LocalHostName", "hostname", "scutil --get LocalHostName", "hostname"])
})
