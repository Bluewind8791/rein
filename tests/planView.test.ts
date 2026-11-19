import { describe, expect } from "claude-code/testing"
import { applyHunks, parsePlanView, planViewData, planViewHtml } from "../hooks/lib/planView.ts"
import { test } from "./world.ts"

// 2-plan.html: the design's hunks placed in the files as they are. A hunk is
// an excerpt, so it may skip lines, go on under a bare `@@` and note what it
// leaves out with `-…`.

const PLAN = `# 로그인 재시도

## 변경 요약

| 파일 | 종류 | 무엇이 어떻게 |
|---|---|---|
| \`src/login.ts\` | 수정 | 횟수를 세지 않던 것 → 세 번째 실패에서 잠근다 |
| \`src/lock.ts\` | 새 파일 | 잠금 |

## 결정 사항

| 결정 | 채택 | 근거 |
|---|---|---|
| 잠글 횟수 | 3 | 사용자: 「세 번」 |

## 접근 방법

재시도 횟수를 세션에 둔다.

## 상세 설계

### \`src/login.ts\`
- 재시도 횟수를 센다
  세션에 둔다
- 테스트: tests/login.test.ts

\`\`\`diff
@@ login @@ 세 번째 실패에서 잠근다
 function login() {
-  check()
+  if (++tries >= 3) return lock()
+  check()
@@
-  return ok
-  …(로그 두 줄 삭제)
+  return ok && !locked
 }
\`\`\`

### src/lock.ts — 새 파일
- 잠금을 둔다
- 테스트 면제: 상태만 둔다

\`\`\`ts
@@ not a hunk @@
\`\`\`

## 영향 범위

- \`src/login.ts\` — 변경
`

const FILE = ["let tries = 0", "function login() {", "  check()", "  log(1)", "  log(2)", "  return ok", "}", ""].join("\n")

describe("plan view", () => {
  test("it reads each item's notes, tests and hunks with the reason after the block name", async () => {
    const view = parsePlanView(PLAN)
    expect(view.title).toBe("로그인 재시도")
    expect(view.summary["src/login.ts"]).toEqual({ kind: "수정", what: "횟수를 세지 않던 것 → 세 번째 실패에서 잠근다" })
    expect(view.decisions).toEqual([{ title: "잠글 횟수", pick: "3", why: "사용자: 「세 번」" }])
    const [login, lock] = view.items
    expect(login!.notes).toEqual(["재시도 횟수를 센다\n세션에 둔다"])
    expect(login!.tests).toEqual(["테스트: tests/login.test.ts"])
    expect(login!.hunks.map(h => [h.label, h.why])).toEqual([["login", "세 번째 실패에서 잠근다"], ["", ""]])
    // the `-…` note is not a line of code
    expect(login!.hunks[1]!.lines).toEqual(["-  return ok", "+  return ok && !locked", " }"])
    expect(lock).toEqual({ path: "src/lock.ts", isNew: true, notes: ["잠금을 둔다"], tests: ["테스트 면제: 상태만 둔다"], hunks: [] })
  })

  test("hunks are placed in order, skipped lines kept, and each knows the lines it spans", async () => {
    const { tobe, placed } = applyHunks(FILE, parsePlanView(PLAN).items[0]!.hunks)
    expect(tobe).toBe(["let tries = 0", "function login() {", "  if (++tries >= 3) return lock()", "  check()", "  log(1)", "  log(2)", "  return ok && !locked", "}", ""].join("\n"))
    expect(placed.map(p => [p.ok, p.asis, p.tobe])).toEqual([[true, [2, 3], [2, 4]], [true, [6, 7], [7, 8]]])
  })

  test("a hunk whose lines the file lacks is shown as not applied, and the rest still are", async () => {
    const hunks = [
      { label: "gone", why: "", lines: [" nowhere()", "-x()", "+y()"] },
      { label: "login", why: "", lines: [" function login() {", "-  check()", "+  verify()"] },
    ]
    const { tobe, placed } = applyHunks(FILE, hunks)
    expect(placed.map(p => [p.ok, p.note])).toEqual([[false, "지금 파일에서 이 hunk의 줄을 찾지 못했습니다"], [true, undefined]])
    expect(tobe).toContain("  verify()")
  })

  test("the page holds the files as they are and as they become, and no `</script>` of the code ends its data", async () => {
    const files: Record<string, string> = { "src/login.ts": `${FILE}// </script>\n` }
    const data = await planViewData(parsePlanView(PLAN), async p => files[p])
    expect(data.files.map(f => [f.path, f.hunks.filter(h => h.ok).length])).toEqual([["src/login.ts", 2], ["src/lock.ts", 0]])
    const page = planViewHtml(data)
    expect(page).toContain("<title>로그인 재시도</title>")
    expect(page.match(/<\/script>/g)).toHaveLength(3)
    const json = page.slice(page.indexOf('type="application/json">') + 24, page.indexOf("</script>"))
    expect(JSON.parse(json).files[0].tobe).toContain("// </script>")
  })

  test("a design file that does not exist is said so, not thrown on", async () => {
    const data = await planViewData(parsePlanView(PLAN), async () => undefined)
    expect(data.files[0]!.error).toBe("이 파일을 읽지 못했습니다")
    expect(data.files[0]!.hunks.every(h => !h.ok)).toBe(true)
  })
})
