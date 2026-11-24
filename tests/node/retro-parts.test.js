"use strict"

const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { main, pieces, pack, said, PART } = require("../../frame/retro-parts.js")

const tmp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retro-parts-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test("said keeps what the user typed, answered and gave with a refusal", () => {
  const user = (content, extra = {}) => ({ type: "user", message: { content }, ...extra })
  assert.strictEqual(said(user("왜 다시 돌아갔어?", { origin: { kind: "human" } })), "왜 다시 돌아갔어?")
  assert.strictEqual(said(user("<task-notification> done", { origin: { kind: "task-notification" } })), undefined)
  assert.strictEqual(said(user("skill text", { isMeta: true })), undefined)
  // an older transcript has no origin
  assert.strictEqual(said(user([{ type: "text", text: "plan 다시" }])), "plan 다시")
  assert.strictEqual(said(user("<local-command-stdout>x</local-command-stdout>")), undefined)
  const answer = user([{ type: "tool_result", content: "answered" }], { toolUseResult: { answers: { "어디로?": "plan" }, annotations: { "어디로?": { notes: "설계가 틀림" } } } })
  assert.strictEqual(said(answer), "질문: 어디로?\n답: plan (메모: 설계가 틀림)")
  const refused = user([{ type: "tool_result", content: "The user doesn't want to proceed. To tell you how to proceed, the user said:\n그 파일은 건드리지 마" }])
  assert.strictEqual(said(refused), "(도구 거절) 그 파일은 건드리지 마")
  assert.strictEqual(said(user([{ type: "tool_result", content: "ok" }])), undefined)
})

test("pieces cut a large file at line ends into about PART bytes each", t => {
  const dir = tmp(t)
  const file = path.join(dir, "e2e.md")
  const line = "x".repeat(1023)
  fs.writeFileSync(file, `${line}\n`.repeat(700))
  const ps = pieces(file)
  assert.strictEqual(ps.length, 3)
  assert.strictEqual(ps[0].from, 1)
  assert.strictEqual(ps.at(-1).to, 700)
  for (let i = 1; i < ps.length; i++) assert.strictEqual(ps[i].from, ps[i - 1].to + 1)
  for (const p of ps) assert.ok(p.size <= PART)
})

test("pack puts small files together and a full piece alone", () => {
  const p = (file, size) => ({ file, from: 1, to: 2, size })
  const parts = pack([p("a", PART - 10), p("b", 100), p("c", 200)])
  assert.deepStrictEqual(parts.map(x => x.read.map(r => r.file)), [["a"], ["b", "c"]])
})

test("main writes the trace without passed calls and the user's words, and names the parts", async t => {
  const run = tmp(t)
  const agent = path.join(run, "agent")
  fs.mkdirSync(path.join(agent, "retro-read"), { recursive: true })
  fs.writeFileSync(path.join(agent, "retro-read", "old.md"), "stale")
  fs.writeFileSync(path.join(agent, "trace.jsonl"), [
    '{"t":"1","ev":"load"}',
    '{"t":"2","ev":"tool","tool":"Read","decision":"allow"}',
    '{"t":"3","ev":"tool","tool":"Write","decision":"deny","rule":"D1"}',
  ].join("\n") + "\n")
  fs.writeFileSync(path.join(agent, "trace-2.jsonl"), '{"t":"4","ev":"stage","from":"review","to":"dev"}\n')
  fs.writeFileSync(path.join(agent, "trace-10.jsonl"), '{"t":"5","ev":"halt"}\n')
  fs.writeFileSync(path.join(agent, "e2e.md"), "## e2e\n")
  const transcript = path.join(run, "s1.jsonl")
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: "assistant", message: { content: "hi" } }),
    JSON.stringify({ type: "user", origin: { kind: "human" }, timestamp: "T1", message: { content: "왜 거부됐어?" } }),
  ].join("\n") + "\n")
  const { parts } = await main([run, transcript])
  const dir = path.join(agent, "retro-read")
  assert.ok(!fs.existsSync(path.join(dir, "old.md")))
  assert.strictEqual(fs.readFileSync(path.join(dir, "trace.txt"), "utf8"), [
    'trace.jsonl:1\t{"t":"1","ev":"load"}',
    'trace.jsonl:3\t{"t":"3","ev":"tool","tool":"Write","decision":"deny","rule":"D1"}',
    'trace-2.jsonl:1\t{"t":"4","ev":"stage","from":"review","to":"dev"}',
    'trace-10.jsonl:1\t{"t":"5","ev":"halt"}',
  ].join("\n") + "\n")
  assert.strictEqual(fs.readFileSync(path.join(dir, "user.md"), "utf8"), "### s1.jsonl:2 T1\n왜 거부됐어?\n")
  const slash = p => p.replace(/\\/g, "/")
  assert.deepStrictEqual(parts, [{
    out: slash(path.join(dir, "1.md")),
    read: [
      { file: slash(path.join(dir, "trace.txt")), lines: "1-4" },
      { file: slash(path.join(agent, "e2e.md")), lines: "1-1" },
      { file: slash(path.join(dir, "user.md")), lines: "1-2" },
    ],
  }])
})
