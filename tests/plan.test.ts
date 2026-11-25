import { describe, expect } from "claude-code/testing"
import { relay, COVER, DIR, grade, planned, REIN, reviewed, SESSION, spawned, SPEC_TEXT, store, world, test } from "./world.ts"

// The plan stage: its write allowlist, the approval at advance once
// 2-plan.md has the form, and the rules open_run freezes for it.

const RULES = `${REIN}/rules`
const PLAN_RUN = { stage: "plan", runId: "login-fix" }
const ADVANCE = { tool: "mcp__rein__advance" } as never

const write = (file_path: string, content = "x") => ({ tool: "Write", file_path, content }) as never
// what the hook said with a write it let through.
const said = (r: unknown) => (r as { context?: string[] }).context ?? []
const read = (file_path: string) => ({ tool: "Read", input: { file_path } }) as never

const PLAN = `# 로그인 재시도

## 접근 방법

재시도 횟수를 세션에 둔다.

## 상세 설계

### \`src/login.ts\`
- 재시도 횟수를 센다
- 테스트: tests/login.test.ts

### tests/login.test.ts — 새 파일
- 세 번째 실패에서 잠기는지 본다
- 테스트: tests/login.test.ts

### src/login.css
- 경고 색을 바꾼다
- 테스트 면제: 스타일만 바뀐다
${COVER}`

const QA = JSON.stringify({ qa: ["npm test"] })

// A repository at the session root, one nested under it, one outside it;
// the first two have their verification commands.
const REPOS = {
  "E:/proj/.git/HEAD": "",
  "E:/proj/.rein/config.json": QA,
  "E:/proj/api/.git/HEAD": "",
  "E:/proj/api/.rein/config.json": QA,
  "E:/other/.git/HEAD": "",
  [`${DIR}/1-spec.md`]: SPEC_TEXT,
}

describe("plan", () => {
  test("a 2-plan.md write is not judged; advance judges it and the person's approval moves the run to dev", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), PLAN_RUN)
    const w = await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("## 접근 방법", "## 방법")))
    expect(said(w)).toEqual([])
    expect(await relay($, ADVANCE)).toEqual({ deny: expect.stringContaining("D45: 2-plan.md does not pass yet, so the run stays in plan: 2-plan.md has no `## 접근 방법` section.") })
    expect(questions).toHaveLength(0)
    expect(said(await $.tool.call(write(`${DIR}/2-plan.md`, PLAN)))).toEqual([])
    expect((store.get("runs:proj/login-fix") as { stage: string }).stage).toBe("plan")
    await reviewed($)
    const r = await relay($, ADVANCE)
    expect(questions[0]).toContain(`2-plan.md가 승인을 기다립니다. /rein:dev를 입력하면 승인하고 dev 단계로 넘어갑니다. (${DIR}/2-plan.md)`)
    expect(r).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
    const context = (r as { context?: string[] }).context?.join("\n") ?? ""
    expect(context).toContain("now in the dev stage. Invoke the rein:dev skill")
    expect(context).toContain("E:/proj/src/login.ts, E:/proj/tests/login.test.ts, E:/proj/src/login.css")
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"repos":["E:/proj"]`)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"stage","from":"plan","to":"dev"`)
    // 2-plan.md as it passed, put back if a command rewrites it.
    expect((store.get("runs:proj/login-fix") as { frozen?: { plan?: string } }).frozen?.plan).toBe(PLAN)
    expect(await relay($, ADVANCE)).toEqual({ deny: expect.stringContaining("D112: advance does not move the dev stage as the run stands.") })
  })

  test("rein:planner is the main session's hand: its unfinished 2-plan.md is not judged, and the finished one goes on at advance", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const spawn = { tool_use_id: "p", prompt: "첫 호출", description: "plan", subagentType: "rein:planner", background: false }
    const { agentId } = (await $.agent.spawn(spawn as never)) as { agentId?: string }
    const as = (file_path: string, content: string) => ({ tool: "Write", file_path, content, agentId }) as never
    expect(said(await $.tool.call(as(`${DIR}/2-plan.md`, PLAN.replace(/- 테스트.*\n/g, ""))))).toEqual([])
    expect(said(await $.tool.call(as(`${DIR}/2-plan.md`, PLAN)))).toEqual([])
    await reviewed($)
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "승인" } as never)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
  })

  test("advance without a 2-plan.md asks nothing", async ($, on) => {
    world(on, { ...REPOS }, () => "승인", PLAN_RUN)
    expect(await relay($, ADVANCE)).toEqual({ deny: `D112: ${DIR}/2-plan.md does not exist. Write it before asking for approval.` })
  })

  test("without the user's /rein:dev the run waits in plan, and status says so", async ($, on) => {
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, () => undefined, PLAN_RUN)
    await reviewed($)
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining("this waits for the user; nothing changed. Tell them what the hook knows below, giving the paths, then stop. They read it and type /rein:dev to approve it") })
    expect(((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result).toContain("waits for the user: they type /rein:dev")
    expect((store.get("runs:proj/login-fix") as { stage: string }).stage).toBe("plan")
  })

  test("while 2-plan.md waits for the user, 2-plan.html shows its diffs against the files as they are", async ($, on) => {
    const diff = "\n```diff\n@@ retry @@ 세 번째 실패에서 잠근다\n let tries = 0\n-tries++\n+if (++tries >= 3) lock()\n```\n"
    const plan = PLAN.replace("- 테스트: tests/login.test.ts\n", `- 테스트: tests/login.test.ts\n${diff}`)
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: plan, "E:/proj/src/login.ts": "let tries = 0\ntries++\n" }
    world(on, files, () => undefined, PLAN_RUN)
    await reviewed($)
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining(`코드 변경은 브라우저로 열어 지금 코드와 나란히 볼 수 있습니다. (${DIR}/2-plan.html)`) })
    const page = files[`${DIR}/2-plan.html`] ?? ""
    expect(page).toContain("세 번째 실패에서 잠근다")
    expect(page).toContain("if (++tries >= 3) lock()")
  })

  test("a backslash 2-plan.md path is the same artifact", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    expect(await planned($, PLAN, `${DIR.replace(/\//g, "\\")}\\2-plan.md`)).toContain("now in the dev stage")
  })

  test("a design in a nested repository names that repository", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    world(on, files, undefined, PLAN_RUN)
    await planned($, PLAN.replace(/src\/login\.css/, "api/src/a.ts"))
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"repos":["E:/proj","E:/proj/api"]`)
  })

  test("a missing section keeps the run in plan", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    expect(await planned($, PLAN.replace("## 접근 방법", "## 방법"))).toContain("D45: 2-plan.md does not pass yet, so the run stays in plan: 2-plan.md has no `## 접근 방법` section.")
  })

  test("a design without file items keeps the run in plan", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    expect(await planned($, "## 접근 방법\n\n간단히.\n\n## 상세 설계\n\n파일 하나를 고친다.\n")).toContain("has no `### <file path>` item")
  })

  test("an item without a test line keeps the run in plan until an Edit adds it", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const broken = PLAN.replace("- 테스트 면제: 스타일만 바뀐다\n", "")
    const r = await planned($, broken)
    expect(r).toContain("D68")
    expect(r).toContain("src/login.css")
    const edit = {
      tool: "Edit",
      file_path: `${DIR}/2-plan.md`,
      old_string: "- 경고 색을 바꾼다\n",
      new_string: "- 경고 색을 바꾼다\n- 테스트 면제: 스타일만 바뀐다\n",
    } as never
    expect(said(await $.tool.call(edit))).toEqual([])
    await reviewed($)
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "승인" } as never)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
  })

  test("a test file named on a 테스트: line needs an item of its own, an existing one too (D68, D49 ③)", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const existing = PLAN.replace("### tests/login.test.ts — 새 파일", "### tests/other.test.ts — 새 파일").replace("- 테스트: tests/login.test.ts\n\n### src/login.css", "- 테스트: tests/other.test.ts\n\n### src/login.css")
    const text = await planned($, existing)
    expect(text).toContain("D68: 2-plan.md does not pass yet, so the run stays in plan: these test files named on a `테스트:` line have no `### <path>` item of their own: tests/login.test.ts.")
    const listed = existing.replace("### src/login.css", "### tests/login.test.ts\n- 잠금 경우를 더한다\n- 테스트: tests/login.test.ts\n\n### src/login.css")
    expect(await planned($, listed)).toContain("now in the dev stage")
  })

  test("a heading inside a code fence is not an item", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const fenced = "## 접근 방법\n\n예시.\n\n## 상세 설계\n\n```\n### src/a.ts\n- 테스트: t.ts\n```\n"
    expect(await planned($, fenced)).toContain("has no `### <file path>` item")
  })

  test("a repository without config.json keeps the run in plan until rein:setup wrote it", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    delete files["E:/proj/api/.rein/config.json"]
    world(on, files, undefined, PLAN_RUN)
    const design = PLAN.replace(/src\/login\.css/, "api/src/a.ts")
    const context = await planned($, design)
    expect(context).toContain(
      "D50: 2-plan.md does not pass yet, so the run stays in plan: these repositories have no usable .rein/config.json: E:/proj/api/.rein/config.json (it does not exist).",
    )
    expect(context).toContain("Invoke the rein:setup skill for each (it asks the user before it writes)")
    expect(files[`${DIR}/agent/trace.jsonl`]).not.toContain(`"to":"dev"`)
    expect(await $.tool.call(write("E:/proj/api/.rein/config.json", QA))).toEqual(expect.objectContaining({ result: "ok" }))
    expect(await planned($, design)).toContain("now in the dev stage")
  })

  test("every repository missing config.json is named", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    delete files["E:/proj/.rein/config.json"]
    delete files["E:/proj/api/.rein/config.json"]
    world(on, files, undefined, PLAN_RUN)
    expect(await planned($, PLAN.replace(/src\/login\.css/, "api/src/a.ts"))).toContain(
      "E:/proj/.rein/config.json (it does not exist), E:/proj/api/.rein/config.json (it does not exist).",
    )
  })

  test("an unusable config.json keeps the run in plan and says why", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    world(on, files, undefined, PLAN_RUN)
    const cases: [string, string][] = [
      ["{ qa: [", "it is not valid JSON"],
      ["[]", "it is not a JSON object"],
      [JSON.stringify({ qa: [] }), "`qa` must be a non-empty array of command strings"],
      [JSON.stringify({ qa: ["npm test", 3] }), "`qa` must be a non-empty array of command strings"],
      [JSON.stringify({ qa: ["npm test"], e2e: { url: "http://localhost:5173", production: [] } }), "`e2e.backends` must be an array of the hosts the app sends requests to (empty only when it calls no backend)"],
    ]
    for (const [text, reason] of cases) {
      files["E:/proj/.rein/config.json"] = text
      expect(await planned($, PLAN)).toContain(`E:/proj/.rein/config.json (${reason})`)
    }
    files["E:/proj/.rein/config.json"] = `\uFEFF${JSON.stringify({ qa: ["npm test"] })}`
    expect(await planned($, PLAN)).toContain("now in the dev stage")
  })

  test("a file outside every git repository keeps the run in plan", async ($, on) => {
    world(on, { "E:/proj/api/.git/HEAD": "", "E:/proj/api/.rein/config.json": QA, "E:/other/.git/HEAD": "" }, undefined, PLAN_RUN)
    const design = PLAN.replace("### `src/login.ts`", "### api/src/login.ts")
      .replace("### tests/login.test.ts — 새 파일", "### E:/loose/a.ts")
      .replace("### src/login.css", `### ${DIR}/agent/dev-diff.md`)
      .replaceAll("- 테스트: tests/login.test.ts", "- 테스트 면제: 예시")
    const text = await planned($, `${design.replace(COVER, "")}\n### docs/a.md\n- 테스트 면제: 문서\n${COVER}`)
    expect(text).toContain("D51: 2-plan.md does not pass yet, so the run stays in plan")
    expect(text).toContain(`E:/loose/a.ts, ${DIR}/agent/dev-diff.md, E:/proj/docs/a.md.`)
    expect(text).not.toContain("api/src/login.ts,")
  })

  test("the hook leaves 영향 범위 to the plan reviewer: a plan that skips a path of 1-spec.md passes its form", async ($, on) => {
    const files: Record<string, string> = {
      ...REPOS,
      [`${DIR}/1-spec.md`]: "# s\n\n## 완료 판정\n\n잠긴다\n\n## 영향 범위\n\n- `src/api.ts:12` — 로그인 응답에 기댐\n- 운영 DB의 SEQ_* 시퀀스 — 새 행 번호\n\n## 참조\n\n없음\n",
    }
    world(on, files, undefined, PLAN_RUN)
    expect(await planned($, `${PLAN}\n## 영향 범위\n\n- src/other.ts — 그냥 둠\n`)).toContain("now in the dev stage")
  })

  test("an item heading must be one path, backticked when it has spaces", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const bad = PLAN.replace("### src/login.css", "### src/login.css 스타일 수정")
    expect(await planned($, bad)).toContain("`### src/login.css 스타일 수정`")
    const good = PLAN.replace("### src/login.css", "### `src/my login.css` (새 파일)")
    expect(await planned($, good)).toContain("E:/proj/src/my login.css")
  })

  test("a fence closes only on its own marker, as long as the opener", async ($, on) => {
    world(on, { ...REPOS }, undefined, PLAN_RUN)
    const fenced = "## 접근 방법\n\n예시.\n\n## 상세 설계\n\n````\n```\n~~~\n### src/a.ts\n- 테스트: t.ts\n````\n"
    expect(await planned($, fenced)).toContain("has no `### <file path>` item")
  })

  // the main session writes what it likes; a 1-spec.md it changes after
  // the approval sends the run back to spec, where the user approves it again.
  test("a 1-spec.md written in plan is told; the run stays in plan", async ($, on) => {
    world(on, { ...REPOS }, undefined, { ...PLAN_RUN, frozen: { spec: SPEC_TEXT } })
    const r = await $.tool.call(write(`${DIR}/1-spec.md`))
    expect(r).toEqual(expect.objectContaining({ result: "ok" }))
    expect((r as { context?: string[] }).context?.[0]).toContain("1-spec.md changed after the user approved it")
    expect((store.get("runs:proj/login-fix") as { stage: string }).stage).toBe("plan")
  })

  test("the main session writes config.json and source in plan", async ($, on) => {
    world(on, { ...REPOS, "E:/proj/docs/readme.md": "" }, undefined, PLAN_RUN)
    const ok = expect.objectContaining({ result: "ok" })
    for (const p of [".rein/config.json", "E:/proj/docs/.rein/config.json", "E:/other/.rein/config.json", "E:/proj/src/login.ts"]) {
      expect([p, await $.tool.call(write(p))]).toEqual([p, ok])
    }
  })

  test("a failing file system check refuses the write (fail closed)", async ($, on) => {
    let broken = false
    const files = new Proxy<Record<string, string>>({ ...REPOS }, {
      ownKeys: target => {
        if (broken) throw new Error("disk gone")
        return Reflect.ownKeys(target)
      },
    })
    world(on, files, undefined, PLAN_RUN)
    broken = true
    const r = await $.tool.call(write("E:/proj/.rein/config.json"))
    expect(r).toEqual({ deny: expect.stringContaining("Rein: a hook rule failed") })
  })
})

describe("rules", () => {
  const RULE_FILES = {
    [`${RULES}/api.md`]: "---\npaths:\n  - \"src/api/**\"\n  - lib/**/*.ts\n---\n# API\n",
    [`${RULES}/web.md`]: "---\npaths: [\"web/**/*.{ts,tsx}\", 'css/**']\n---\n# Web\n",
    [`${RULES}/all.md`]: "# 모든 파일\n",
    [`${RULES}/notes.txt`]: "not a rule",
  }

  test("open_run freezes the rules and advance hands them to plan", async ($, on) => {
    const files: Record<string, string> = { ...RULE_FILES }
    world(on, files, () => "승인", null)
    expect(await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)).toEqual(
      expect.objectContaining({ result: expect.stringContaining("Run opened") }),
    )
    const load = files[`${DIR}/agent/trace.jsonl`] ?? ""
    expect(load).toContain(`"name":"all","hash":"`)
    expect(load).toContain(`"paths":null`)
    expect(load).toContain(`"name":"api","hash":"`)
    expect(load).not.toContain("notes")

    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    const r = await relay($, ADVANCE)
    const context = (r as { context?: string[] }).context?.join("\n") ?? ""
    expect(context).toContain("Invoke the rein:plan skill")
    expect(context).toContain(`- ${RULES}/api.md (paths: src/api/**, lib/**/*.ts)`)
    expect(context).toContain(`- ${RULES}/web.md (paths: web/**/*.{ts,tsx}, css/**)`)
    expect(context).toContain(`- ${RULES}/all.md (no paths: list, always applies)`)
  })

  test("the rule hash is the SHA-256 of the file's bytes", async ($, on) => {
    const files: Record<string, string> = { [`${RULES}/abc.md`]: "abc" }
    world(on, files, undefined, null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("no rules folder means no rules", async ($, on) => {
    world(on, {}, () => "승인", null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    const r = await relay($, ADVANCE)
    expect((r as { context?: string[] }).context?.[0]).toContain("No project rules were frozen for this run")
  })

  test("frozen rules are readable in plan, a later one and other stages ask", async ($, on) => {
    const files: Record<string, string> = { ...RULE_FILES }
    world(on, files, () => "승인", null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    const allow = expect.objectContaining({ decision: "allow" })
    const ask = { decision: "ask" }
    expect(await $.tool.check(read(`${RULES}/api.md`))).toEqual(ask)
    expect(await $.tool.check(read(`${DIR}/1-spec.md`))).toEqual(allow)
    expect(await $.tool.check({ tool: "Grep", input: { pattern: "x", path: DIR } } as never)).toEqual(allow)

    await $.tool.call(write(`${DIR}/1-spec.md`, SPEC_TEXT))
    await grade($)
    await relay($, ADVANCE)
    files[`${RULES}/late.md`] = "# late"
    expect(await $.tool.check(read(`${RULES.replace(/\//g, "\\")}\\api.md`))).toEqual(allow)
    expect(await $.tool.check(read(`${RULES}/late.md`))).toEqual(ask)
    expect(await $.tool.check(read(`${RULES}/../rules/api.md`))).toEqual(ask)
    expect(await $.tool.check({ tool: "Write", input: { file_path: `${DIR}/2-plan.md`, content: "x" } } as never)).toEqual(allow)
    expect(await $.tool.check({ tool: "Write", input: { file_path: "E:/proj/.rein/config.json", content: "x" } } as never)).toEqual(ask)
  })
})

describe("a config that differs from HEAD at plan (D120)", () => {
  // git show HEAD:.rein/config.json answers `committed` (undefined: exit 128, not in HEAD).
  const gitShow = (committed: string | undefined) => ({
    run: (argv: string[]) => {
      if (argv[0] === "git" && argv.includes("show")) return committed === undefined ? { exitCode: 128, stderr: "fatal: path not in HEAD" } : { exitCode: 0, stdout: committed }
      return { exitCode: 0 }
    },
  })
  const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
  const COMMITTED = JSON.stringify({ qa: ["npm test", "npm run lint"] })

  test("plan holds and advance shows the quoted difference before freezing", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    const questions: string[] = []
    let answer: string | undefined
    world(on, files, q => (questions.push(q), answer), PLAN_RUN, gitShow(COMMITTED))
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN))
    await reviewed($)
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining("or have .rein/config.json fixed") })
    expect(questions[0]).toContain(".rein/config.json이 커밋된 것과 다릅니다. 승인하면 지금 내용으로 고정합니다.")
    expect(questions[0]).toContain("커밋된(HEAD) 것과 다른 것 (HEAD → 지금):\n```text\n> E:/proj/.rein/config.json")
    expect(questions[0]).toContain('>   qa: ["npm test","npm run lint"] → ["npm test"]')
    answer = "승인"
    const moved = await relay($, ADVANCE)
    expect(moved).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
  })

  test("the same fields with other line endings show no difference", async ($, on) => {
    const files: Record<string, string> = { ...REPOS, "E:/proj/.rein/config.json": `{\r\n  "qa": ["npm test"]\r\n}\r\n`, [`${DIR}/2-plan.md`]: PLAN }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), PLAN_RUN, gitShow(QA))
    await reviewed($)
    expect(context(await relay($, ADVANCE))).toContain("now in the dev stage")
    expect(questions[0]).not.toContain("커밋된")
  })

  test("an untracked config shows no difference (setup had the person confirm it)", async ($, on) => {
    const questions: string[] = []
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, q => (questions.push(q), "승인"), PLAN_RUN, gitShow(undefined))
    await reviewed($)
    expect(context(await relay($, ADVANCE))).toContain("now in the dev stage")
    expect(questions[0]).not.toContain("커밋된")
  })

  test("after a D62 return the plan approval question carries the difference too", async ($, on) => {
    const questions: string[] = []
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, q => (questions.push(q), undefined), { ...PLAN_RUN, d62: true }, gitShow(COMMITTED))
    await reviewed($)
    await relay($, ADVANCE)
    expect(questions[0]).toContain("고친 2-plan.md가 승인을 기다립니다. /rein:dev를 입력하면 승인하고 dev 단계로 넘어갑니다.")
    expect(questions[0]).toContain('>   qa: ["npm test","npm run lint"] → ["npm test"]')
  })
})

describe("plan compares the config it froze (D120, P5)", () => {
  const COMMITTED = JSON.stringify({ qa: ["npm test", "npm run lint"] })
  const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""

  test("a file swapped to the HEAD content between the plan's read and git show still holds the plan", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    const swapping = {
      run: (argv: string[]) => {
        if (argv[0] === "git" && argv.includes("show")) {
          files["E:/proj/.rein/config.json"] = COMMITTED // HEAD-equal now; the plan read the other one
          return { exitCode: 0, stdout: COMMITTED }
        }
        return { exitCode: 0 }
      },
    }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), PLAN_RUN, swapping)
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN))
    await reviewed($)
    // The plan read the other config and compares and freezes that text:
    // the question shows the difference though the file is HEAD-equal now.
    const r = await relay($, ADVANCE)
    expect(questions[0]).toContain('>   qa: ["npm test","npm run lint"] → ["npm test"]')
    expect(context(r)).toContain("now in the dev stage")
  })
})

describe("the design review in plan", () => {
  // two frozen rules: api.md applies to src/, web.md to files the design does not touch.
  const RULED = {
    ...PLAN_RUN,
    rules: [
      { name: "api", path: `${RULES}/api.md`, hash: "h", paths: ["src/**"] },
      { name: "web", path: `${RULES}/web.md`, hash: "h", paths: ["web/**"] },
    ],
  }
  const REVIEWER = { tool_use_id: "r", prompt: "설계 리뷰", description: "review", subagentType: "rein:reviewer", background: false } as never
  const verdict = (agentId: string | undefined, rules: unknown[], spec: unknown = { verdict: "통과" }) =>
    ({ tool: "mcp__rein__plan_review", rules, impact: { verdict: "통과" }, spec, agentId }) as never
  const run = () => store.get("runs:proj/login-fix") as { stage: string; planVerdicts?: unknown[] }
  const status = async ($: { tool: { call: (e: never) => Promise<unknown> } }) => ((await $.tool.call({ tool: "mcp__rein__status" } as never)) as { result: string }).result

  test("advance asks for a passing review before the approval; the reviewer's task lists the rules the design's files bring in", async ($, on) => {
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), RULED)
    expect(await relay($, ADVANCE)).toEqual({ deny: expect.stringContaining("2-plan.md passes the form, but it has no passing design review as it stands now, so the run stays in plan. Spawn rein:reviewer") })
    expect(questions).toHaveLength(0)
    const { agentId } = (await $.agent.spawn(REVIEWER)) as { agentId?: string }
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain(`- api.md: ${RULES}/api.md`)
    expect(task).not.toContain("web.md")
    // the first visit to plan reviews the whole design.
    expect(task).toContain("Review the design of a Rein run before any code is written.")
    expect(task).not.toContain("approved version")
    expect(spawned.at(-1)!.background).toBe(false)
    // the rule list is the hook's.
    expect(await $.tool.call(verdict(agentId, []))).toEqual({ deny: "rules lacks api.md. The hook's rule list: api.md. Call mcp__rein__plan_review again." })
    expect(await $.tool.call(verdict(agentId, [{ file: "api.md", verdict: "실패" }]))).toEqual({ deny: expect.stringContaining("the rule api.md is 실패 without a why") })
    expect(await $.tool.call(verdict(agentId, [{ file: "api.md", verdict: "통과" }]))).toEqual({ result: expect.stringContaining("Recorded: 통과.") })
    expect(files[`${DIR}/agent/trace.jsonl`]).toContain(`"ev":"plan-review","stage":"plan","agentId":"${agentId}","round":1`)
    // one verdict per reviewer, and only from it.
    expect(await $.tool.call(verdict(agentId, [{ file: "api.md", verdict: "통과" }]))).toEqual({ deny: expect.stringContaining("only the rein:reviewer the hook spawned for the design review") })
    expect(await $.tool.call(verdict(undefined, [{ file: "api.md", verdict: "통과" }]))).toEqual({ deny: expect.stringContaining("only the rein:reviewer the hook spawned for the design review") })
    expect(await relay($, ADVANCE)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
    expect(questions[0]).not.toContain("설계 리뷰")
    expect(run().planVerdicts).toBeUndefined()
  })

  test("a rule whose text changed since the run opened is marked in the design reviewer's task", async ($, on) => {
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: PLAN, [`${RULES}/api.md`]: "# API, edited" }
    world(on, files, () => "승인", RULED)
    await $.agent.spawn(REVIEWER)
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain(`- api.md: ${RULES}/api.md (changed since the run opened)`)
    expect(task).toContain("A rule marked changed since the run opened: when a failure comes from its new text, say so in that rule's line")
  })

  test("a design that changed since the review began, or since it passed, is reviewed again", async ($, on) => {
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }
    world(on, files, () => "승인", PLAN_RUN)
    const { agentId } = (await $.agent.spawn(REVIEWER)) as { agentId?: string }
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("세션에", "저장소에")))
    expect(await $.tool.call(verdict(agentId, []))).toEqual({ deny: expect.stringContaining("2-plan.md changed since this review began") })
    expect(await reviewed($)).toEqual({ result: expect.stringContaining("Recorded: 통과.") })
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN))
    expect(await relay($, ADVANCE)).toEqual({ deny: expect.stringContaining("it has no passing design review as it stands now") })
  })

  test("a failed review keeps the run in plan; after two, advance asks the person with the last reasons", async ($, on) => {
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }
    const questions: string[] = []
    world(on, files, q => (questions.push(q), "승인"), PLAN_RUN)
    expect(await reviewed($, "로그인 잠금 요구를 다루는 항목이 없음")).toEqual({ result: expect.stringContaining("Recorded: 실패 (failed design reviews in this visit to plan: 1 of 2)") })
    expect(await relay($, ADVANCE)).toEqual({ deny: expect.stringContaining("its last design review failed and it has not changed since, so the run stays in plan. Continue the planner with the reviewer's reasons") })
    expect(await status($)).toContain("design review 1: 실패")
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("세션에", "저장소에")))
    expect(await reviewed($, "잠금 해제가 빠짐")).toEqual({ result: expect.stringContaining("2 of 2") })
    expect(questions).toHaveLength(0)
    const r = await relay($, ADVANCE)
    expect(questions[0]).toContain("설계 리뷰를 통과하지 못한 설계입니다 (실패 2회). 마지막 실패 사유:\n```text\n> spec 대조: 잠금 해제가 빠짐")
    expect(r).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
  })

  test("in an autopilot run a reviewed design is approved by the main session itself", async ($, on) => {
    const questions: string[] = []
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, q => (questions.push(q), "승인"), { ...PLAN_RUN, autopilot: true })
    await reviewed($)
    const r = (await relay($, ADVANCE)) as { result?: string }
    expect(r.result).toContain(`autopilot run: the user is not asked here; nothing changed yet. Tell them in one line what passed, giving the paths below, then call mcp__rein__advance again now with answer "승인" and said "autopilot".`)
    expect(r.result).toContain(`autopilot이 2-plan.md를 승인하고 dev 단계로 넘어갑니다. (${DIR}/2-plan.md)`)
    expect(questions).toHaveLength(0)
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "승인", said: "autopilot" } as never)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
  })

  test("in an autopilot run a design that failed two reviews waits for the person, as in any run", async ($, on) => {
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, undefined, { ...PLAN_RUN, autopilot: true })
    await reviewed($, "로그인 잠금 요구를 다루는 항목이 없음")
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("세션에", "저장소에")))
    await reviewed($, "잠금 해제가 빠짐")
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining("this waits for the user; nothing changed. Tell them what the hook knows below, giving the paths, then stop. They read it and type /rein:dev to approve it") })
  })

  test("back in plan in the session that sent it there, a reviewed revised design is approved by the main session itself", async ($, on) => {
    const questions: string[] = []
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, q => (questions.push(q), "승인"), { ...PLAN_RUN, d62: true, back: SESSION })
    await reviewed($)
    const r = (await relay($, ADVANCE)) as { result?: string }
    expect(r.result).toContain(`D62: back in plan in the session that sent it here: the user is not asked here; nothing changed yet. Tell them in one line what passed, giving the paths below, then call mcp__rein__advance again now with answer "승인" and said "same session".`)
    expect(r.result).toContain(`같은 세션에서 plan으로 되돌아온 run이라 고친 2-plan.md를 바로 승인하고 dev 단계로 넘어갑니다. (${DIR}/2-plan.md)`)
    expect(questions).toHaveLength(0)
    expect(await $.tool.call({ tool: "mcp__rein__advance", answer: "승인", said: "same session" } as never)).toEqual(expect.objectContaining({ result: "Approved. The run is now in the dev stage." }))
    expect(store.get("runs:proj/login-fix")).not.toHaveProperty("back")
  })

  test("back in plan but held by another session than the one that sent it, the revised design waits for /rein:dev", async ($, on) => {
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, undefined, { ...PLAN_RUN, d62: true, back: "s0" })
    await reviewed($)
    expect(await relay($, ADVANCE)).toEqual({ result: expect.stringContaining("this waits for the user; nothing changed. Tell them what the hook knows below, giving the paths, then stop. They read it and type /rein:dev to approve it") })
  })

  test("goto from a later stage back to plan marks the session that sent it there", async ($, on) => {
    world(on, { ...REPOS }, undefined, { stage: "dev", runId: "login-fix" })
    await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)
    expect(store.get("runs:proj/login-fix")).toMatchObject({ stage: "plan", back: SESSION })
  })

  test("back in plan after the design passed, the review judges only what changed since, in every round of the visit", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    world(on, files, () => "승인", { ...PLAN_RUN, frozen: { spec: SPEC_TEXT } })
    await planned($, PLAN)
    expect((store.get("runs:proj/login-fix") as { frozen?: { planSpec?: string } }).frozen?.planSpec).toBe(SPEC_TEXT)
    await $.tool.call({ tool: "mcp__rein__goto", stage: "plan" } as never)
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("- 경고 색을 바꾼다", "- 경고 색과 여백을 바꾼다")))
    expect(await reviewed($, "여백이 spec에 없음")).toEqual({ result: expect.stringContaining("Recorded: 실패") })
    const task = spawned.at(-1)!.prompt ?? ""
    expect(task).toContain("Review a change to the design of a Rein run before the code follows it.")
    expect(task).toContain("A part that did not change passed before: do not fail the design for it")
    expect(task).toContain("```diff\n- - 경고 색을 바꾼다\n+ - 경고 색과 여백을 바꾼다\n```")
    // the next round of the visit is scoped the same way, against the approved design.
    await $.tool.call(write(`${DIR}/2-plan.md`, PLAN.replace("- 경고 색을 바꾼다", "- 경고 색과 여백을 바꾼다").replace("세션에", "저장소에")))
    await reviewed($)
    const again = spawned.at(-1)!.prompt ?? ""
    expect(again).toContain("```diff\n- 재시도 횟수를 세션에 둔다.\n+ 재시도 횟수를 저장소에 둔다.\n- - 경고 색을 바꾼다\n+ - 경고 색과 여백을 바꾼다\n```")
    expect(again).not.toContain("세 번째 실패에서 잠기는지")
  })

  test("back in plan with nothing changed, the review is told so; after the spec changed, it reviews the whole design", async ($, on) => {
    const back = { ...PLAN_RUN, frozen: { spec: SPEC_TEXT, plan: PLAN, planSpec: SPEC_TEXT } }
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, undefined, back)
    await $.agent.spawn(REVIEWER)
    expect(spawned.at(-1)!.prompt).toContain("2-plan.md is the same as the approved version, so nothing changed: every part is 통과.")
    // the spec approved again since the design passed.
    store.set("runs:proj/login-fix", { ...(store.get("runs:proj/login-fix") as object), frozen: { ...back.frozen, spec: `${SPEC_TEXT}\n추가 요구\n` } })
    await $.agent.spawn(REVIEWER)
    expect(spawned.at(-1)!.prompt).toContain("Review the design of a Rein run before any code is written.")
    expect(spawned.at(-1)!.prompt).not.toContain("approved version")
  })

  test("back in plan after the design passed, the planner is told to change only what is needed and the test-planner gets what changed; not on a first visit or after the spec changed", async ($, on) => {
    const PLANNER = { tool_use_id: "p", prompt: "첫 호출", description: "plan", subagentType: "rein:planner", background: false } as never
    const TEST_PLANNER = { tool_use_id: "t", prompt: "검증을 정해 줘", description: "verify", subagentType: "rein:test-planner", background: false } as never
    const files: Record<string, string> = { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }
    world(on, files, undefined, { ...PLAN_RUN, frozen: { spec: SPEC_TEXT } })
    // the first visit: the prompts as the main session wrote them.
    await $.agent.spawn(PLANNER)
    expect(spawned.at(-1)!.prompt).toBe("첫 호출")
    await $.agent.spawn(TEST_PLANNER)
    expect(spawned.at(-1)!.prompt).toBe("검증을 정해 줘")
    // back in plan on the spec the design passed on.
    const back = { ...(store.get("runs:proj/login-fix") as object), frozen: { spec: SPEC_TEXT, plan: PLAN, planSpec: SPEC_TEXT } }
    store.set("runs:proj/login-fix", back)
    await $.agent.spawn(PLANNER)
    expect(spawned.at(-1)!.prompt).toBe("첫 호출\n\nThe hook: this run's design was approved before, on the spec as it is now, and the run came back to plan to change it. Follow `## Coming back after approval` of your instructions.")
    await $.agent.spawn(TEST_PLANNER)
    expect(spawned.at(-1)!.prompt).toContain("Follow `## Coming back after approval` of your instructions.\n\n2-plan.md is the same as the approved version, so nothing changed.")
    // the planner changed one line.
    files[`${DIR}/2-plan.md`] = PLAN.replace("- 경고 색을 바꾼다", "- 경고 색과 여백을 바꾼다")
    await $.agent.spawn(TEST_PLANNER)
    expect(spawned.at(-1)!.prompt).toContain("```diff\n- - 경고 색을 바꾼다\n+ - 경고 색과 여백을 바꾼다\n```")
    // the spec approved again since the design passed.
    store.set("runs:proj/login-fix", { ...back, frozen: { ...back.frozen, spec: `${SPEC_TEXT}\n추가 요구\n` } })
    await $.agent.spawn(PLANNER)
    expect(spawned.at(-1)!.prompt).toBe("첫 호출")
    await $.agent.spawn(TEST_PLANNER)
    expect(spawned.at(-1)!.prompt).toBe("검증을 정해 줘")
  })

  test("the plan reviewer writes no file", async ($, on) => {
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN }, undefined, PLAN_RUN)
    const { agentId } = (await $.agent.spawn(REVIEWER)) as { agentId?: string }
    expect(await $.tool.call({ tool: "Write", file_path: `${DIR}/agent/review.md`, content: "x", agentId } as never)).toEqual({ deny: expect.stringContaining("the plan reviewer writes no file") })
  })

  test("no review is spawned for a 2-plan.md that does not pass the form", async ($, on) => {
    world(on, { ...REPOS, [`${DIR}/2-plan.md`]: PLAN.replace("## 접근 방법", "## 방법") }, undefined, PLAN_RUN)
    expect(await $.agent.spawn(REVIEWER)).toEqual({ deny: expect.stringContaining("2-plan.md does not pass the hook's form yet") })
  })
})
