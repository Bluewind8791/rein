// The form of e2e.md, as a person reads it. Edit the markdown
// below to change what the file looks like.
//
// `{{name}}` is a value the hook fills; a line that is only `{{name}}` goes
// when its value is empty. `<!-- check -->` … `<!-- /check -->` repeats once
// per aside or ego check, `<!-- command -->` … `<!-- /command -->` once per
// qa-integration command; a block the path does not use goes. `<...>` is
// what the completion reviewer fills.
//
// The hook reads its own lines back, so keep these as they are: the
// headings `## e2e` and `## 완료 판정 대조`, one `판정:` line at the start
// of a line in each, and the `> {{completion}}` quote. A check's own
// result is `결과:`, never `판정:`.
export const QA_INTEGRATION_TEMPLATE = `## e2e

방법: {{method}}

<!-- check -->
### {{name}}

- 할 일: {{todo}}
- 기대: {{expect}}
- 계정: {{account}}
- 본 것: {{observed}}
- 결과: {{result}}
- {{sessionLabel}}: {{session}}
- 스크린샷: {{shots}}
{{cited}}

{{images}}
<!-- /check -->

<!-- command -->
- \`{{cmd}}\` ({{root}}) — exit {{exit}}
<!-- /command -->

{{output}}

판정: {{verdict}}

## 완료 판정 대조

> {{completion}}

- "<part>" — 통과 — <what showed it>
- "<part>" — 실패 — <why it is not shown>

판정: <통과 or 실패>
`
