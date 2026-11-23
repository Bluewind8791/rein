// Rein eval runner (issue #6): runs each case's request through
// /rein:autopilot on a fresh copy of the fixture app, with a user simulator
// answering the spec's questions, then judges the run by its trace and by
// the case's hidden acceptance test.
//
//   node eval/run.ts [case ...] [--runs N] [--parallel N]
//
// Auth: CLAUDE_CODE_OAUTH_TOKEN, else ~/.rein-eval-token (from `claude setup-token`).
// Results: eval/results/<time>/summary.md and one folder per run.
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

const EVAL = import.meta.dirname
const REPO = resolve(EVAL, "..")
const SIMULATOR = "claude-haiku-5-5"
const RUN_LIMIT_MS = 120 * 60_000

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "3" }, parallel: { type: "string", default: "3" } },
})
const runs = Number(values.runs)
const parallel = Number(values.parallel)
const allCases = readdirSync(join(EVAL, "cases"))
const cases = positionals.length > 0 ? positionals : allCases
for (const c of cases) if (!allCases.includes(c)) throw new Error(`no case ${c}; cases: ${allCases.join(", ")}`)

const tokenFile = join(homedir(), ".rein-eval-token")
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "")
if (!token) throw new Error(`set CLAUDE_CODE_OAUTH_TOKEN or write ${tokenFile} (from \`claude setup-token\`)`)

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const results = join(EVAL, "results", stamp)
mkdirSync(results, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), "rein-eval-"))

// The plugin as the session loads it: the repository without eval/, so the
// model has no way to the hidden acceptance tests.
const plugin = join(scratch, "plugin")
cpSync(REPO, plugin, { recursive: true, filter: src => !/[\\/](eval|\.git|node_modules|\.rein|\.claude|\.obsidian)$/.test(src) })

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })

type Outcome = {
  name: string
  closed: boolean // the run folder is in complete/ and the trace has land → closed
  halts: number
  errors: number
  commits: number // commits on top of the fixture's own
  accept: boolean
  questions: number
  outside: number // questions the intent document did not cover
  minutes: number
  cost: number
  model: string
  stopped: string // why the session ended, when it was not a closed run
}

const envFor = (home: string): Record<string, string | undefined> => ({
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  CLAUDE_CODE_OAUTH_TOKEN: token,
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ANTHROPIC_API_KEY: undefined,
})

type Question = { question: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }

// The user simulator: answers one AskUserQuestion call from the case's intent
// document, or "나중에 정하자" for what the document does not settle.
async function simulate(intent: string, questions: Question[], env: Record<string, string | undefined>, cwd: string, log: string) {
  const prompt = [
    "너는 소프트웨어 작업을 요청한 사람이다. 개발 도구가 너에게 질문했다. 아래 「진짜 의도」 문서만 근거로 답한다.",
    "",
    "규칙:",
    "- 문서가 답을 정하면, 그 답에 맞는 선택지의 label을 그대로 쓴다. 맞는 선택지가 없으면 문서에 맞게 짧은 문장으로 답한다.",
    "- 문서가 정하지 않은 것이면 정확히 「나중에 정하자」로 답하고 inIntent를 false로 둔다. 지어내지 않는다.",
    "- 질문이 요청 내용을 확인하는 것이면(예: 결과물 목록이 맞는지) 문서에 비추어 답한다.",
    "",
    "## 진짜 의도",
    intent,
    "",
    "## 질문 (JSON)",
    JSON.stringify(questions, null, 2),
    "",
    '질문마다 하나씩, 같은 순서로 JSON 배열만 출력한다: [{"answer": "<label 또는 문장>", "inIntent": true}]',
  ].join("\n")
  let text = ""
  for await (const m of query({ prompt, options: { model: SIMULATOR, tools: [], maxTurns: 1, settingSources: [], strictMcpConfig: true, env, cwd } })) {
    if (m.type === "result" && m.subtype === "success") text = m.result
  }
  let parsed: { answer: string; inIntent: boolean }[]
  try {
    parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1))
  } catch {
    parsed = questions.map(() => ({ answer: "나중에 정하자", inIntent: false }))
  }
  appendFileSync(log, JSON.stringify({ questions, simulator: text, answers: parsed }) + "\n")
  return questions.map((q, i) => ({ q, answer: parsed[i]?.answer ?? "나중에 정하자", inIntent: parsed[i]?.inIntent ?? false }))
}

function findRun(home: string): { state: string; dir: string } | undefined {
  const rein = join(home, ".rein")
  if (!existsSync(rein)) return
  for (const project of readdirSync(rein)) {
    for (const state of ["complete", "active", "defer", "drop"]) {
      const at = join(rein, project, state)
      if (!existsSync(at)) continue
      const [runId] = readdirSync(at)
      if (runId) return { state, dir: join(at, runId) }
    }
  }
}

async function runOne(caseName: string, n: number): Promise<Outcome> {
  const name = `${caseName}-${n}`
  const out = join(results, name)
  mkdirSync(out)
  const root = join(scratch, name)
  const home = join(root, "home")
  const work = join(root, "shop-admin")
  mkdirSync(home, { recursive: true })
  cpSync(join(EVAL, "fixture"), work, { recursive: true })
  git(work, "init", "-q")
  git(work, "config", "user.name", "Rein Eval")
  git(work, "config", "user.email", "eval@example.com")
  git(work, "add", "-A")
  git(work, "commit", "-q", "-m", "fixture")

  const dir = join(EVAL, "cases", caseName)
  const request = readFileSync(join(dir, "request.md"), "utf8").trim()
  const intent = readFileSync(join(dir, "intent.md"), "utf8")
  const env = envFor(home)
  const transcript = join(out, "transcript.jsonl")
  const simLog = join(out, "simulator.jsonl")
  let questions = 0
  let outside = 0
  let model = ""
  let cost = 0
  let stopped = ""
  const started = Date.now()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), RUN_LIMIT_MS)

  try {
    for await (const m of query({
      prompt: `/rein:autopilot ${request}`,
      options: {
        cwd: work,
        env,
        settingSources: [],
        strictMcpConfig: true,
        plugins: [{ type: "local", path: plugin }],
        permissionMode: "default",
        maxTurns: 1000,
        abortController: abort,
        canUseTool: async (tool, input) => {
          if (tool !== "AskUserQuestion") return { behavior: "allow", updatedInput: input }
          const qs = (input.questions ?? []) as Question[]
          const answered = await simulate(intent, qs, env, root, simLog)
          questions += answered.length
          outside += answered.filter(a => !a.inIntent).length
          return { behavior: "allow", updatedInput: { ...input, answers: Object.fromEntries(answered.map(a => [a.q.question, a.answer])) } }
        },
      },
    }) as AsyncIterable<SDKMessage>) {
      appendFileSync(transcript, JSON.stringify(m) + "\n")
      if (m.type === "system" && m.subtype === "init") model = m.model
      if (m.type === "result") {
        cost = m.total_cost_usd
        stopped = m.subtype === "success" ? m.result.slice(-300) : m.subtype
      }
    }
  } catch (err) {
    stopped = abort.signal.aborted ? `time limit (${RUN_LIMIT_MS / 60_000} min)` : `error: ${String(err)}`
  } finally {
    clearTimeout(timer)
  }

  const run = findRun(home)
  const trace = run && existsSync(join(run.dir, "agent", "trace.jsonl"))
    ? readFileSync(join(run.dir, "agent", "trace.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
    : []
  if (run) cpSync(run.dir, join(out, "run"), { recursive: true })
  const closed = run?.state === "complete" && trace.some(e => e.ev === "stage" && e.from === "land" && e.to === null)
  const halts = trace.filter(e => e.ev === "halt").length
  const errors = trace.filter(e => e.ev === "error").length
  const commits = Number(git(work, "rev-list", "--count", "HEAD").stdout.trim() || "1") - 1

  // The hidden acceptance test, on the main tree as land left it.
  cpSync(join(dir, "accept.test.js"), join(work, "accept.test.js"))
  const accepted = spawnSync("node", ["--test", "accept.test.js"], { cwd: work, encoding: "utf8" })
  writeFileSync(join(out, "accept.txt"), accepted.stdout + accepted.stderr)
  rmSync(join(work, "accept.test.js"))
  writeFileSync(join(out, "diff.patch"), git(work, "diff", "HEAD~" + commits).stdout)

  return {
    name,
    closed,
    halts,
    errors,
    commits,
    accept: accepted.status === 0,
    questions,
    outside,
    minutes: Math.round((Date.now() - started) / 6000) / 10,
    cost,
    model,
    stopped: closed ? "" : stopped || (run ? `run left in ${run.state}/` : "no run opened"),
  }
}

const passed = (o: Outcome) => o.closed && o.halts === 0 && o.errors === 0 && o.commits > 0 && o.accept

const jobs = cases.flatMap(c => Array.from({ length: runs }, (_, i) => () => runOne(c, i + 1)))
const outcomes: Outcome[] = []
let next = 0
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
  while (next < jobs.length) {
    const o = await jobs[next++]!()
    outcomes.push(o)
    console.log(`${passed(o) ? "PASS" : "FAIL"} ${o.name} (${o.minutes} min)${o.stopped ? ` — ${o.stopped.split("\n").pop()}` : ""}`)
  }
}))
outcomes.sort((a, b) => a.name.localeCompare(b.name))

const yes = (b: boolean) => (b ? "✔" : "✘")
const lines = [
  `# Rein eval ${stamp}`,
  "",
  `Rein ${JSON.parse(readFileSync(join(REPO, ".claude-plugin", "plugin.json"), "utf8")).version}, commit ${git(REPO, "rev-parse", "--short", "HEAD").stdout.trim()}${git(REPO, "status", "--porcelain").stdout.trim() ? " (uncommitted changes)" : ""}, model ${outcomes[0]?.model ?? "?"}, simulator ${SIMULATOR}`,
  "",
  `통과 ${outcomes.filter(passed).length}/${outcomes.length}`,
  "",
  "| run | 통과 | land 닫힘 | halt | error | 커밋 | 인수 | 질문 (의도 밖) | 분 | 비용 USD | 멈춘 이유 |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...outcomes.map(o => `| ${o.name} | ${yes(passed(o))} | ${yes(o.closed)} | ${o.halts} | ${o.errors} | ${o.commits} | ${yes(o.accept)} | ${o.questions} (${o.outside}) | ${o.minutes} | ${o.cost.toFixed(2)} | ${o.stopped.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 120)} |`),
  "",
]
writeFileSync(join(results, "summary.md"), lines.join("\n"))
console.log(`통과 ${outcomes.filter(passed).length}/${outcomes.length} — ${join(results, "summary.md")}`)
// A process the run left (a git or node child on Windows) can hold a file a
// while: retry, then leave the folder to the OS's temp cleanup.
try {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
} catch (err) {
  console.warn(`could not remove ${scratch}: ${String(err)}`)
}
