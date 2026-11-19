import { describe, expect } from "claude-code/testing"
import { applicableRules } from "../hooks/lib/rules.ts"
import type { Rule } from "../hooks/lib/state.ts"
import { COVER, DIR, planned, SPEC_TEXT, store, world, test } from "./world.ts"

// a repository outside the session root (E:/proj) is a repository of
// the run like any other. The first 2-plan.md that names it brings its
// project's rules (~/.rein/<its folder name>/rules, globs relative to it)
// and knowledge; Rein answers the engine's prompts for its files.

const API = "E:/work/api"
const JAVA = `${API}/src/Login.java`
const OTHER = "C:/Users/u/.rein/api"
const QA = JSON.stringify({ qa: ["npm test"] })
const REPOS = {
  "E:/proj/.git/HEAD": "",
  "E:/proj/.rein/config.json": QA,
  [`${API}/.git/HEAD`]: "",
  [`${API}/.rein/config.json`]: QA,
  [`${DIR}/1-spec.md`]: SPEC_TEXT,
}
const RULE = `${OTHER}/rules/java/naming.md`
const PLAN = `# 로그인

## 접근 방법

웹과 API를 함께 고친다.

## 상세 설계

### src/login.ts
- 응답을 읽는다
- 테스트 면제: 예시

### ${JAVA}
- 응답을 바꾼다
- 테스트 면제: 예시
${COVER}`

const read = (file_path: string) => ({ tool: "Read", input: { file_path } }) as never
const context = (r: unknown) => (r as { context?: string[] }).context?.join("\n") ?? ""
const record = () => store.get("runs:proj/login-fix") as Record<string, unknown> & { rules: Rule[] }
const allow = expect.objectContaining({ decision: "allow" })
const ask = { decision: "ask" }

describe("a repository outside the session root (D214)", () => {
  test("plan passes with it, and the run records it", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    world(on, files, undefined, { stage: "plan", runId: "login-fix" })
    const r = await planned($, PLAN)
    expect(r).toContain("now in the dev stage")
    expect(record()).toEqual(expect.objectContaining({ repos: ["E:/proj", API], outside: [API], planFiles: ["E:/proj/src/login.ts", JAVA] }))
  })

  test("its config is needed like any repository's", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    delete files[`${API}/.rein/config.json`]
    world(on, files, undefined, { stage: "plan", runId: "login-fix" })
    expect(await planned($, PLAN)).toContain(`D50: 2-plan.md does not pass yet, so the run stays in plan: these repositories have no usable .rein/config.json: ${API}/.rein/config.json`)
  })

  test("the first 2-plan.md naming it stays in plan once, with its project's rules frozen and knowledge listed", async ($, on) => {
    const files: Record<string, string> = {
      ...REPOS,
      [RULE]: '---\npaths: ["src/**/*.java"]\n---\n# 이름\n',
      [`${OTHER}/knowledge/java/guide.md`]: "---\ndescription: 자바 안내\n---\n",
    }
    world(on, files, undefined, { stage: "plan", runId: "login-fix" })
    const first = await planned($, PLAN)
    expect(first).toContain(`D214: 2-plan.md does not pass yet, so the run stays in plan: 2-plan.md names repositories outside the session root: ${API}.`)
    expect(first).toContain(`- ${RULE} (repository ${API}; paths: src/**/*.java)`)
    expect(first).toContain(`- ${OTHER}/knowledge/java/guide.md: 자바 안내`)
    expect(record().stage).toBe("plan")
    expect(record().rules).toEqual([expect.objectContaining({ name: "api:java/naming", path: RULE, paths: ["src/**/*.java"], repo: API })])
    expect(record().outside).toEqual([API])
    // The rule and the knowledge are the run's to read now.
    expect(await $.tool.check(read(RULE))).toEqual(allow)
    expect(await $.tool.check(read(`${OTHER}/knowledge/java/guide.md`))).toEqual(allow)
    const again = await planned($, PLAN)
    expect(again).toContain("now in the dev stage")
    expect(record().rules).toHaveLength(1)
  })

  test("its rules apply to its files only, globs relative to it", () => {
    const rule = (name: string, paths: string[] | null, repo?: string): Rule => ({ name, path: `${name}.md`, hash: "h", paths, ...(repo ? { repo } : {}) })
    const rules = [rule("web", ["src/**/*.java"]), rule("api:java", ["src/**/*.java"], API), rule("api:all", null, API), rule("all", null)]
    const names = (files: string[]) => applicableRules(rules, files, "E:/proj").map(r => r.name)
    expect(names([JAVA])).toEqual(["api:java", "api:all", "all"])
    expect(names(["E:/proj/src/A.java"])).toEqual(["web", "all"])
    expect(names([`${API}/README.md`])).toEqual(["api:all", "all"])
  })

  test("a shared rule applies to every repository of the run, globs relative to the one a file is in", () => {
    const shared = (name: string, paths: string[] | null): Rule => ({ name, path: `${name}.md`, hash: "h", paths, shared: true })
    const rules = [shared("rules:java", ["src/**/*.java"]), shared("rules:all", null)]
    const names = (files: string[], repos?: string[]) => applicableRules(rules, files, "E:/proj", repos).map(r => r.name)
    expect(names([JAVA], [API])).toEqual(["rules:java", "rules:all"])
    expect(names(["E:/proj/src/A.java"], [API])).toEqual(["rules:java", "rules:all"])
    expect(names([`${API}/README.md`], [API])).toEqual(["rules:all"])
    // a repository the run does not name brings none of its files in
    expect(names([JAVA])).toEqual(["rules:all"])
  })

  test("Rein answers the engine for its files: reads in it, writes of planned files, the stage's commands", async ($, on) => {
    const files: Record<string, string> = { ...REPOS }
    const run = { stage: "dev", runId: "login-fix", planFiles: ["E:/proj/src/login.ts", JAVA], repos: ["E:/proj", API], outside: [API] }
    world(on, files, undefined, run)
    expect(["read", await $.tool.check(read(`${API}/src/Other.java`))]).toEqual(["read", allow])
    expect(["read web", await $.tool.check(read("E:/work/web/a.ts"))]).toEqual(["read web", ask])
    expect(["write", await $.tool.check({ tool: "Write", input: { file_path: JAVA, content: "x" } } as never)]).toEqual(["write", allow])
    expect(["write other", await $.tool.check({ tool: "Write", input: { file_path: `${API}/src/Other.java`, content: "x" } } as never)]).toEqual(["write other", ask])
    const check = async (command: string) => [command, await $.tool.check({ tool: "Bash", input: { command } } as never)]
    expect(await check(`git -C ${API} diff`)).toEqual([`git -C ${API} diff`, allow])
    expect(await check(`rm -f ${JAVA}`)).toEqual([`rm -f ${JAVA}`, allow])
    expect(await check(`git -C ${API} push`)).toEqual([`git -C ${API} push`, ask])
    expect(await check(`rm -f ${API}/src/Other.java`)).toEqual([`rm -f ${API}/src/Other.java`, ask])
  })

  test("a Rein agent's read-only git there runs hardened", async ($, on) => {
    const said: string[] = []
    const run = { stage: "review", runId: "login-fix", planFiles: [JAVA], repos: ["E:/proj", API], outside: [API], writes: [JAVA], reviewer: "agent-r" }
    world(on, { ...REPOS }, undefined, run, { bash: (command: string) => void said.push(command) })
    await $.tool.call({ tool: "Bash", command: `git -C ${API} diff`, agentId: "agent-r" } as never)
    expect(said[0]).toMatch(/^git -c core\.fsmonitor=false .* -C E:\/work\/api diff/)
  })
})
