// The form of 5-checklist.md, the integration test the person runs by hand
// from 2-plan.md's `## e2e 확인` and `## 배치 대조`. Edit the markdown below to
// change what the file looks like.
//
// `{{name}}` is a value the hook fills; a line that is only `{{name}}` goes
// when its value is empty. `<!-- page -->` … `<!-- /page -->` repeats once
// per page the checks look at, `<!-- check -->` … `<!-- /check -->` once per
// check on that page. `<!-- layouts -->` … `<!-- /layouts -->` is there only
// when 2-plan.md names screens in `## 배치 대조`, `<!-- layout -->` …
// `<!-- /layout -->` once per screen. On a page whose checks all log in as
// one account, the account is the page's `{{pageAccount}}` line; otherwise
// each check's `{{account}}` line. `{{note}}` is the app's note from config.
//
// The hook reads the file back, so keep these as they are: each check
// starts its line as `- {{head}}` with no box (its title, its kind and its
// name in backticks at the end; `**<name>**` alone for a check from before
// titles), each line of its expectation as an indented `- [ ]` box with no
// blank line above it, each screen's box as `- [ ] **배치 {{anchor}}**`, and
// every `- [ ]` in the file is a box the person must check before
// `/rein:land`.
export const CHECKLIST_TEMPLATE = `# 통합 테스트 체크리스트 — {{title}}

항목마다 할 일을 화면에서 해 보고, 기대대로 보이는 줄의 칸을 \`[x]\`로 체크하세요.

- 직접 확인했으면: 모든 칸을 체크한 뒤 \`/rein:land\`
{{e2e}}
- 문제가 있으면: 메인 세션에 말하세요. dev로 되돌릴 수 있습니다

<!-- page -->
## {{page}}

- 접근: {{route}}
- 앱: {{app}} ({{url}})
{{pageAccount}}
{{note}}

<!-- check -->
- {{head}}
{{account}}
  - 할 일: {{todo}}
  - 기대:
{{expect}}
{{saves}}
{{reference}}
<!-- /check -->
<!-- /page -->
<!-- layouts -->
## 화면 배치 대조

[1-mockup.html](1-mockup.html)을 열어 두고, 화면마다 구현된 배치를 to-be와 비교하세요. 영역 순서, 컬럼 순서, 버튼 위치가 to-be와 같으면 칸을 체크합니다.

<!-- layout -->
- [ ] **배치 {{anchor}}** — {{page}} 화면을 [1-mockup.html#{{anchor}}](1-mockup.html#{{anchor}})의 to-be와 대조
  - 접근: {{route}}
  - 볼 곳: {{look}}
<!-- /layout -->
<!-- /layouts -->
`
