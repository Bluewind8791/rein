// Rein retro eval (issue #8): builds a long closed run (ten trace files,
// a large e2e.md and fails.md, a long transcript) with episodes planted at
// its start, middle and end, runs /rein:retro on it, and judges whether
// retro.md caught every planted cause and merged the two episodes that share
// one cause. The readers' notes are judged too, to tell which step lost one.
//
//   node eval/retro.ts [--runs N] [--parallel N]
//   node eval/retro.ts --build <folder>   only build the run, as a home folder
//
// Auth as eval/run.ts. Results: eval/results/retro-<time>/summary.md and one
// folder per run.
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

const EVAL = import.meta.dirname
const REPO = resolve(EVAL, "..")
const JUDGE = "claude-sonnet-5-5"
const RUN_LIMIT_MS = 60 * 60_000

const { values } = parseArgs({ options: { runs: { type: "string", default: "1" }, parallel: { type: "string", default: "1" }, build: { type: "string" } } })
const runs = Number(values.runs)
const parallel = Number(values.parallel)

// ---------------------------------------------------------------- the run

const PROJECT = "shop-admin"
const RUN_ID = "order-total-cancel"
const SESSION = "5e551011-0000-4000-8000-000000000001"
const TRACE_FILES = 10
const TRACE_BYTES = 3 * 1024 * 1024

// the causes planted in the run; C1 has two episodes far apart.
const CAUSES = [
  { id: "C1", kind: "하네스", what: "worker가 2-plan.md 상세 설계에 없는 파일을 쓰려다 같은 거부(D58)를 반복함. 첫 dev(src/orders.js, 4번)와 넷째 날 dev(src/members.js, 3번) 두 곳. 한 항목으로 합쳐져 두 곳을 모두 근거로 들어야 함" },
  { id: "C2", kind: "하네스", what: "qa가 통과한 직후 2-plan.md drift로 qa가 다시 돌았고, 사용자가 「왜 qa를 또 돌려? 방금 다 통과했잖아」라고 따짐" },
  { id: "C3", kind: "도메인 룰", what: "review가 saveOrder가 화면이 보낸 합계(total)를 그대로 저장한다고 실패시켜 dev로 돌아감. 사용자가 「합계는 항상 서버에서 단가×수량 합으로 다시 계산」하라고 함" },
  { id: "C4", kind: "도메인 지식", what: "e2e 확인 order-cancel-filter가 6라운드 실패(취소 주문이 목록에 없음). 사용자가 「취소 주문은 status 9로 저장되고 seed 데이터에 9가 없다」고 설명함" },
  { id: "C5", kind: "하네스", what: "배치 확인(layout-unchecked)으로 멈췄을 때 사용자가 「배치 칸을 매번 5-checklist.md 열어서 손으로 체크해야 해?」라고 불평함" },
  { id: "C6", kind: "도메인 지식", what: "qa의 node --test가 EADDRINUSE :3100으로 dev 회차마다 실패. 사용자가 「3100은 로컬 개발 서버가 쓰니 테스트는 PORT=3200으로」라고 알려 줌" },
]

let clock = Date.parse("2026-03-02T00:30:00Z")
const at = (ms: number) => new Date((clock += ms)).toISOString()
// mulberry32: the same run every time.
let seed = 7
const rand = (n: number) => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n)
}

const STAGES = ["plan", "dev", "qa", "review", "review", "qa-integration", "qa-integration", "dev", "qa-integration", "land"]
const FILES = ["src/orders.js", "src/members.js", "src/server.js", "src/views/orders.html", "test/orders.test.js", "db/seed.sql"]
const REPO_DIR = "C:/work/shop-admin/.claude/worktrees/order-total-cancel"

// a line the hook let through: the bulk of a real trace.
function allowLine(stage: string): string {
  const f = FILES[rand(FILES.length)]!
  const body = "x".repeat(600 + rand(900))
  const input = rand(2) === 0 ? { command: `sed -n '${rand(400)},${rand(400) + 40}p' ${REPO_DIR}/${f}` } : { file_path: `${REPO_DIR}/${f}`, content: { length: body.length, head: body } }
  return JSON.stringify({ t: at(400 + rand(4000)), ev: "tool", stage, tool: rand(2) === 0 ? "Bash" : "Read", agentId: `a${rand(9)}f00d`, input, decision: "allow", isError: false })
}

// a line that went plainly forward.
function noiseLine(stage: string): string {
  switch (rand(4)) {
    case 0: return JSON.stringify({ t: at(2000), ev: "capture", stage, check: `check-${rand(30)}`, agentId: "a1d00d", round: String(rand(9)).padStart(2, "0"), outcome: "ok", timedOut: false })
    case 1: return JSON.stringify({ t: at(2000), ev: "spawn", stage, agent: "rein:worker", agentId: `a${rand(99)}beef` })
    case 2: return JSON.stringify({ t: at(2000), ev: "write", stage, file: `${REPO_DIR}/${FILES[rand(FILES.length)]}`, agentId: "a2beef" })
    default: return JSON.stringify({ t: at(2000), ev: "exit", stage, pass: true, writes: FILES.slice(0, 1 + rand(4)).map(f => `${REPO_DIR}/${f}`) })
  }
}

const D58 = (f: string) => ({ ev: "tool", stage: "dev", tool: "Write", agentId: "a58c0de", file_path: `${REPO_DIR}/${f}`, decision: "deny", rule: "D58", deny: `D58: ${f} is not a file of 2-plan.md's ## 상세 설계, so the worker may not write it. Write only the design's files; report a file the design misses as a deviation.` })

// the planted trace lines: at which trace file (1-based) and how far into it.
type Plant = { file: number; at: number; lines: Record<string, unknown>[]; user?: string }
const PLANTS: Plant[] = [
  { file: 1, at: 0.6, lines: [D58("src/orders.js"), D58("src/orders.js"), D58("src/orders.js"), D58("src/orders.js")] },
  { file: 2, at: 0.5, lines: [{ ev: "exit", stage: "qa", pass: false, results: [{ cmd: "node --test", exit: 1, tail: "Error: listen EADDRINUSE: address already in use :::3100" }] }, { ev: "stage", from: "qa", to: "dev", rule: "D30" }] },
  { file: 3, at: 0.3, lines: [{ ev: "exit", stage: "qa", pass: false, results: [{ cmd: "node --test", exit: 1, tail: "Error: listen EADDRINUSE: address already in use :::3100" }] }], user: "3100 포트는 내 로컬 개발 서버가 쓰고 있어. 테스트는 PORT=3200으로 돌려" },
  { file: 3, at: 0.55, lines: [{ ev: "exit", stage: "qa", pass: true }, { ev: "drift", stage: "qa", told: ["2-plan.md changed after it passed; the run still holds the design as it passed."] }, { ev: "rerun", stage: "qa", results: [{ cmd: "PORT=3200 node --test", exit: 0 }] }], user: "왜 qa를 또 돌려? 방금 다 통과했잖아" },
  { file: 5, at: 0.3, lines: [{ ev: "exit", stage: "review", pass: false, verdict: "fail", reason: "src/orders.js saveOrder stores req.body.total as the screen sent it; the total is never computed on the server" }, { ev: "stage", from: "review", to: "dev", rule: "D30" }], user: "합계는 항상 서버에서 단가×수량 합으로 다시 계산해야 해. 화면에서 온 값은 믿으면 안 돼" },
  { file: 6, at: 0.5, lines: [1, 2, 3, 4, 5, 6].map(r => ({ ev: "capture", stage: "qa-integration", check: "order-cancel-filter", agentId: "a6ca5e", round: `0${r}`, outcome: "fail", timedOut: false })), user: "취소 주문은 status 9로 저장돼. seed 데이터에 9가 하나도 없어서 그래. 테스트 전에 취소 주문을 하나 만들어" },
  { file: 8, at: 0.4, lines: [D58("src/members.js"), D58("src/members.js"), D58("src/members.js")] },
  { file: 9, at: 0.7, lines: [{ ev: "halt", stage: "qa-integration", halt: { rule: "layout-unchecked", reason: "5-checklist.md has layout boxes left empty" } }], user: "배치 칸을 매번 내가 5-checklist.md 열어서 손으로 체크해야 해? 번거로운데 왜 이렇게 돼 있어" },
]

const GO_AHEADS = ["진행", "응", "좋아", "그렇게 해", "계속", "/rein:dev", "확인했어", "다음"]

type Said = { t: string; text: string }

function buildTrace(agent: string): Said[] {
  const said: Said[] = []
  for (let f = 1; f <= TRACE_FILES; f++) {
    const stage = STAGES[f - 1]!
    const lines: string[] = []
    let bytes = 0
    const plants = PLANTS.filter(p => p.file === f)
    let next = 0
    while (bytes < TRACE_BYTES) {
      while (next < plants.length && bytes >= plants[next]!.at * TRACE_BYTES) {
        const p = plants[next++]!
        for (const l of p.lines) {
          lines.push(JSON.stringify({ t: at(30_000), ...l }))
          for (let k = 0; k < 3; k++) lines.push(allowLine(stage))
        }
        if (p.user) said.push({ t: at(60_000), text: p.user })
      }
      const l = rand(6) === 0 ? noiseLine(stage) : allowLine(stage)
      lines.push(l)
      bytes += l.length + 1
      if (rand(400) === 0) said.push({ t: at(1000), text: GO_AHEADS[rand(GO_AHEADS.length)]! })
    }
    const name = f === 1 ? "trace.jsonl" : `trace-${f}.jsonl`
    if (f === 1) lines.unshift(JSON.stringify({ t: at(0), ev: "load", ver: "0.81.0", session: SESSION }))
    if (f === TRACE_FILES) lines.push(JSON.stringify({ t: at(60_000), ev: "stage", from: "land", to: null }))
    writeFileSync(join(agent, name), lines.join("\n") + "\n")
    clock += 6 * 3600_000 // a night between trace files
  }
  return said
}

function buildE2e(agent: string) {
  const out = ["## e2e", ""]
  for (let c = 1; c <= 60; c++) {
    const cancel = c === 30
    const id = cancel ? "order-cancel-filter" : `check-${c}`
    out.push(`### ${id}`, "", `확인: 주문 목록 화면에서 ${cancel ? "상태 필터로 「취소」를 고르면 취소 주문만 보인다" : `항목 ${c}이 기대대로 보인다`}`, "")
    const rounds = cancel ? 7 : 1 + rand(3)
    for (let r = 1; r <= rounds; r++) {
      const fail = cancel && r < 7
      out.push(`#### 라운드 ${r}`, "", `- 판정: ${fail ? "실패" : "통과"}`)
      out.push(fail ? "- 근거: 상태 필터에서 「취소」를 골라도 목록이 비어 있음. db/seed.sql의 주문에 취소 주문(status 9)이 하나도 없음" : "- 근거: 화면이 기대와 같음")
      for (let k = 0; k < 30; k++) out.push(`  - 증거 ${k}: ${"화면 요소의 위치와 글자를 기록함 ".repeat(6)}`)
      out.push("")
    }
  }
  out.push("## 완료 판정 대조", "", "- 모든 확인 통과", "")
  writeFileSync(join(agent, "e2e.md"), out.join("\n"))
}

function buildFails(agent: string) {
  const out: string[] = []
  for (let pass = 1; pass <= 12; pass++) {
    const port = pass >= 4 && pass <= 6
    out.push(`## dev ${pass}회차`, "", `실패한 명령: node --test`, "", "```")
    for (let k = 0; k < 300; k++) out.push(`    at Test.run (node:internal/test_runner/test:${k}:7) ${"stack ".repeat(8)}`)
    out.push(port ? "Error: listen EADDRINUSE: address already in use :::3100" : `AssertionError: expected ${pass} to equal ${pass + 1}`, "```", "")
  }
  writeFileSync(join(agent, "fails.md"), out.join("\n"))
}

function buildTranscript(path: string, said: Said[]) {
  const lines: string[] = []
  const pad = "도구 결과 ".repeat(400)
  for (const s of said.sort((a, b) => a.t.localeCompare(b.t))) {
    for (let k = 0; k < 20; k++) {
      lines.push(JSON.stringify({ type: "assistant", timestamp: s.t, message: { role: "assistant", content: [{ type: "text", text: `작업을 이어 갑니다 ${k}` }] } }))
      lines.push(JSON.stringify({ type: "user", timestamp: s.t, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${k}`, content: pad }] } }))
    }
    lines.push(JSON.stringify({ type: "user", origin: { kind: "human" }, timestamp: s.t, message: { role: "user", content: s.text } }))
  }
  writeFileSync(path, lines.join("\n") + "\n")
}

function buildRun(home: string): { dir: string; transcript: string } {
  const project = join(home, ".rein", PROJECT)
  const dir = join(project, "complete", RUN_ID)
  const agent = join(dir, "agent")
  mkdirSync(agent, { recursive: true })
  mkdirSync(join(project, "knowledge", "shop"), { recursive: true })
  mkdirSync(join(project, "rules", "shop"), { recursive: true })
  writeFileSync(join(project, "knowledge", "shop", "orders.md"), "---\ndescription: 주문 화면의 파일 위치\n---\n# 주문\n\n- 주문 목록 화면: src/views/orders.html, 서버: src/orders.js\n")
  writeFileSync(join(project, "rules", "shop", "style.md"), "---\ndescription: 코드 스타일\npaths:\n  - src/**/*.js\n---\n# 스타일\n\n- 세미콜론 없이 쓴다\n")
  writeFileSync(join(dir, "1-spec.md"), "# 주문 합계와 취소 필터\n\n## 요구사항\n\n- 주문 저장 때 합계를 저장한다\n- 주문 목록에 상태 필터(취소 포함)를 더한다\n")
  writeFileSync(join(dir, "2-plan.md"), "# 설계\n\n## 상세 설계\n\n### src/orders.js\n\n- saveOrder가 합계를 저장\n\n### src/views/orders.html\n\n- 상태 필터\n")
  writeFileSync(join(dir, "5-checklist.md"), "# 체크리스트\n\n- [x] **배치 주문 목록**\n")
  writeFileSync(join(dir, "6-land.md"), "# land\n\n```\nfeat: 주문 합계와 취소 필터\n```\n")
  writeFileSync(join(agent, "review.md"), "# review\n\n판정: 통과\n")
  const said = buildTrace(agent)
  buildE2e(agent)
  buildFails(agent)
  const transcripts = join(home, ".claude", "projects", "C--work-shop-admin")
  mkdirSync(transcripts, { recursive: true })
  const transcript = join(transcripts, `${SESSION}.jsonl`)
  buildTranscript(transcript, said)
  return { dir, transcript }
}

// ---------------------------------------------------------------- judging

type Verdict = { id: string; inRetro: boolean; inNotes: boolean; item: string; merged?: boolean }

async function judge(retro: string, notes: string, env: Record<string, string | undefined>, cwd: string): Promise<Verdict[]> {
  const prompt = [
    "회고 결과를 채점한다. 아래 「심은 원인」마다, retro.md와 reader 메모에 그 원인이 나오는지 판정한다.",
    "",
    "- inRetro: retro.md의 어느 항목(## 제목)이 그 원인을 다루면 true. item에 그 제목을 쓴다. 없으면 false, item은 빈 문자열.",
    "- inNotes: reader 메모에 그 원인의 일화가 하나라도 적혀 있으면 true.",
    "- C1만 merged를 쓴다: 첫 dev의 src/orders.js 거부와 넷째 날의 src/members.js 거부가 retro.md의 한 항목에 함께 근거로 나오면 true, 따로 나오거나 하나만 나오면 false.",
    "",
    "## 심은 원인",
    ...CAUSES.map(c => `- ${c.id} (${c.kind}): ${c.what}`),
    "",
    "## retro.md",
    retro || "(없음)",
    "",
    "## reader 메모",
    notes || "(없음)",
    "",
    'JSON 배열만 출력한다: [{"id":"C1","inRetro":true,"inNotes":true,"item":"<제목>","merged":true}, ...]',
  ].join("\n")
  let text = ""
  for await (const m of query({ prompt, options: { model: JUDGE, tools: [], maxTurns: 1, settingSources: [], strictMcpConfig: true, env, cwd } })) {
    if (m.type === "result" && m.subtype === "success") text = m.result
  }
  try {
    return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1))
  } catch {
    return CAUSES.map(c => ({ id: c.id, inRetro: false, inNotes: false, item: `judge failed: ${text.slice(0, 80)}` }))
  }
}

// ---------------------------------------------------------------- one run

type Outcome = { name: string; verdicts: Verdict[]; readers: number; parts: number; items: number; minutes: number; cost: number; model: string; stopped: string }

async function runOne(n: number): Promise<Outcome> {
  const name = `retro-${n}`
  const out = join(results, name)
  mkdirSync(out)
  const root = join(scratch, name)
  const home = join(root, "home")
  const work = join(root, PROJECT)
  mkdirSync(home, { recursive: true })
  mkdirSync(work, { recursive: true })
  const { dir, transcript: runTranscript } = buildRun(home)
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    CLAUDE_CODE_OAUTH_TOKEN: token,
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ANTHROPIC_API_KEY: undefined,
  }
  const slash = (p: string) => p.replace(/\\/g, "/")
  // what the hook says when a run closes (retroFor), as the session would hear it.
  const prompt = `/rein:retro The run is finished and its folder moved to complete/. Run folder: ${slash(dir)}. The main session's transcripts: ${slash(runTranscript)}.`
  const transcript = join(out, "transcript.jsonl")
  let model = ""
  let cost = 0
  let stopped = ""
  const started = Date.now()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), RUN_LIMIT_MS)
  try {
    for await (const m of query({
      prompt,
      options: {
        cwd: work,
        env,
        settingSources: [],
        strictMcpConfig: true,
        plugins: [{ type: "local", path: plugin }],
        permissionMode: "default",
        maxTurns: 500,
        abortController: abort,
        // the user picks nothing: the candidates stay 후보.
        canUseTool: async (tool, input) => (tool === "AskUserQuestion" ? { behavior: "deny", message: "사용자가 답하지 않고 질문을 닫음" } : { behavior: "allow", updatedInput: input }),
      },
    }) as AsyncIterable<SDKMessage>) {
      appendFileSync(transcript, JSON.stringify(m) + "\n")
      if (m.type === "system" && m.subtype === "init") model = m.model
      if (m.type === "result") {
        cost = m.total_cost_usd
        stopped = m.subtype === "success" ? "" : m.subtype
      }
    }
  } catch (err) {
    stopped = abort.signal.aborted ? `time limit (${RUN_LIMIT_MS / 60_000} min)` : `error: ${String(err)}`
  } finally {
    clearTimeout(timer)
    try {
      process.kill(JSON.parse(readFileSync(join(home, ".rein", "frame", "server.json"), "utf8")).pid)
    } catch {}
  }

  const agent = join(dir, "agent")
  const retroPath = join(dir, "7-retro.md")
  const retro = existsSync(retroPath) ? readFileSync(retroPath, "utf8") : ""
  const readDir = join(agent, "retro-read")
  const noteFiles = existsSync(readDir) ? readdirSync(readDir).filter(f => /^\d+\.md$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)) : []
  const notes = noteFiles.map(f => `### ${f}\n${readFileSync(join(readDir, f), "utf8")}`).join("\n\n")
  writeFileSync(join(out, "retro.md"), retro)
  writeFileSync(join(out, "notes.md"), notes)
  // the readers the main session spawned, and the parts retro-parts.js named.
  const messages = readFileSync(transcript, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as { type: string; parent_tool_use_id?: string | null; message?: { content?: unknown } })
  const blocks = (type: string) => messages.filter(m => m.type === type && !m.parent_tool_use_id).flatMap(m => (Array.isArray(m.message?.content) ? m.message.content : []) as Record<string, unknown>[])
  const readers = blocks("assistant").filter(b => b.type === "tool_use" && (b.input as { subagent_type?: string }).subagent_type === "rein:retro-reader").length
  const parts = blocks("user").map(b => (b.type === "tool_result" ? String(typeof b.content === "string" ? b.content : JSON.stringify(b.content)) : "")).map(t => /\{"parts":.*\}/.exec(t)?.[0]).filter(Boolean).map(t => { try { return (JSON.parse(t!) as { parts: unknown[] }).parts.length } catch { return 0 } })[0] ?? 0
  const verdicts = await judge(retro, notes, env, root)
  writeFileSync(join(out, "verdicts.json"), JSON.stringify(verdicts, null, 2))
  return {
    name,
    verdicts,
    readers,
    parts,
    items: (retro.match(/^## /gm) ?? []).length,
    minutes: Math.round((Date.now() - started) / 6000) / 10,
    cost,
    model,
    stopped,
  }
}

// ---------------------------------------------------------------- main

const tokenFile = join(homedir(), ".rein-eval-token")
if (values.build) {
  mkdirSync(values.build, { recursive: true })
  console.log(JSON.stringify(buildRun(values.build)))
  process.exit(0)
}
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "")
if (!token) throw new Error(`set CLAUDE_CODE_OAUTH_TOKEN or write ${tokenFile} (from \`claude setup-token\`)`)

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const results = join(EVAL, "results", `retro-${stamp}`)
mkdirSync(results, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), "rein-retro-eval-"))
const plugin = join(scratch, "plugin")
cpSync(REPO, plugin, { recursive: true, filter: src => !/[\\/](eval|\.git|node_modules|\.rein|\.claude|\.obsidian)$/.test(src) })

const passed = (o: Outcome) => CAUSES.every(c => o.verdicts.find(v => v.id === c.id)?.inRetro) && o.verdicts.find(v => v.id === "C1")?.merged === true

const outcomes: Outcome[] = []
let next = 0
await Promise.all(Array.from({ length: Math.min(parallel, runs) }, async () => {
  while (next < runs) {
    const o = await runOne(++next)
    outcomes.push(o)
    console.log(`${passed(o) ? "PASS" : "FAIL"} ${o.name} (${o.minutes} min)${o.stopped ? ` — ${o.stopped}` : ""}`)
  }
}))
outcomes.sort((a, b) => a.name.localeCompare(b.name))

const mark = (v: Verdict | undefined) => (v ? `${v.inRetro ? "✔" : "✘"}${v.inNotes ? "" : " (메모 없음)"}` : "?")
const lines = [
  `# Rein retro eval ${stamp}`,
  "",
  `Rein ${JSON.parse(readFileSync(join(REPO, ".claude-plugin", "plugin.json"), "utf8")).version}, model ${outcomes[0]?.model ?? "?"}, judge ${JUDGE}`,
  "",
  ...CAUSES.map(c => `- ${c.id} (${c.kind}): ${c.what}`),
  "",
  `통과 ${outcomes.filter(passed).length}/${outcomes.length}`,
  "",
  `| run | 통과 | ${CAUSES.map(c => c.id).join(" | ")} | C1 합침 | 항목 | 몫 | reader | 분 | 비용 USD | 멈춘 이유 |`,
  `|---|---|${CAUSES.map(() => "---|").join("")}---|---|---|---|---|---|---|`,
  ...outcomes.map(o => `| ${o.name} | ${passed(o) ? "✔" : "✘"} | ${CAUSES.map(c => mark(o.verdicts.find(v => v.id === c.id))).join(" | ")} | ${o.verdicts.find(v => v.id === "C1")?.merged ? "✔" : "✘"} | ${o.items} | ${o.parts} | ${o.readers} | ${o.minutes} | ${o.cost.toFixed(2)} | ${o.stopped} |`),
  "",
]
writeFileSync(join(results, "summary.md"), lines.join("\n"))
console.log(`통과 ${outcomes.filter(passed).length}/${outcomes.length} — ${join(results, "summary.md")}`)
try {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
} catch (err) {
  console.warn(`could not remove ${scratch}: ${String(err)}`)
}
