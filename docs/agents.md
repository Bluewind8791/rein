# 실행 주체

단계를 **누가** 실행하는지 다룹니다. 단계별 흐름은 [stages/](./stages/)에 있습니다.

## 메인 세션

사용자와 대화하는 세션입니다. run을 진행하고, 결정하고, 서브에이전트를 띄웁니다.

- 쓰기·Bash·다른 도구를 Rein이 막지 않습니다. 환경(로컬 설정, 보조 스크립트)을 고칠 수 있어야 run이 막히지 않기 때문입니다.
- 대신 **자기 채점은 못 합니다.** 메인 세션이 판정 파일(`review.md` 등)을 써도 판정으로 치지 않습니다.
- 메인 세션이 띄운 일반 에이전트(`Explore` 등)도 메인 세션으로 봅니다.
- 판정 뒤에 `1-spec.md`·`2-plan.md`·설계 파일이 바뀌면 훅이 한 번 알립니다. run은 그대로 두고, 다시 판정받으려면 `goto`로 옮깁니다.

## Rein 서브에이전트

`rein:slug`와 `rein:collator`를 뺀 나머지는 훅이 프롬프트를 run 상태로 통째로 씁니다. 메인 세션이 쓴 프롬프트는 버리거나 "주장"으로만 인용합니다.

| 에이전트 | 단계 | 하는 일 | 모델 |
|---|---|---|---|
| `rein:slug` | spec | 요청을 보고 runId 슬러그 생성 | haiku |
| `rein:grader` | spec | `1-spec.md`만 읽고 모호도 채점 → `grade.md` | sonnet |
| `rein:as-is` | spec | `## 화면` 표, 도메인 지식, 코드만 보고 화면마다 현행(as-is) 전체와 서비스 스타일 → `agent/asis.html`. 첫 그림 때 한 번, 더한 화면과 사용자가 다르다고 한 화면만 다시 | sonnet |
| `rein:sketcher` | spec | `1-spec.md`, 기획서 그림, as-is만 보고(코드 안 봄) to-be(늘 화면 전체) → `agent/tobe.html`, 훅이 as-is와 합쳐 `1-mockup.html`. to-be 요소마다 `data-id`와 질문·미해결·규칙 핀. spec에 없는 것은 지어내지 않고 답에 적음. 답과 사용자 코멘트마다 다시 그리고, 기획서 화면 그림을 보고 배치를 맞춤 | sonnet |
| `rein:layout-verifier` | spec, qa-integration | spec: 렌더링한 to-be와 기획서 그림을 화면마다 비교 → `layout-verify.md`(맞음/다름). 통합 qa: 배치 체크(`배치-<id>`)의 judge로 구현 화면 스크린샷과 to-be를 비교 → `judge.md` | sonnet |
| `rein:collator` | spec | 기획서 원본과 `## 기획서 대조`를 맞춰 빠지거나 다른 요구사항을 답함. 파일을 쓰지 않음 | 상속 |
| `rein:planner` | plan | 설계 → `2-plan.md` | 상속 |
| `rein:test-planner` | plan | 테스트·e2e 확인·완료 판정 덮기 → `test-plan.md` | 상속 |
| `rein:worker` | dev | 설계 파일 코드 작성 → `dev-items.md` | sonnet |
| `rein:arbiter` | dev | 설계 이탈 판정 → `deviation.md` | 상속 |
| `rein:review-splitter` | review | 바뀐 파일이 10개 이상일 때 함께 봐야 할 파일끼리 묶음 → `review-groups.md` | sonnet |
| `rein:reviewer` | plan, review, qa-integration | 설계 리뷰, `review.md`(나눈 review는 묶음마다 `review-<n>.md`), 완료 판정 대조 | opus |
| `rein:triage` | qa | qa 명령 실패가 코드 탓인지 환경 탓인지 | sonnet |
| `rein:impact` | qa | 이전에 통과한 e2e 항목이 그 뒤 바뀐 코드의 영향을 받는지 diff로 판정 → `impact.md` | sonnet |
| `rein:e2e-runner` | qa-integration | aside로 e2e 항목 하나 실행 | haiku |
| `rein:ego-driver` | qa-integration | ego 브라우저로 e2e 항목 하나 실행, 증거 기록 | sonnet |
| `rein:ego-judge` | qa-integration | 증거만 보고 e2e 항목 판정 | sonnet |
| `rein:retro` | run 종료 후 | 회고 후보 → `retro.md` | sonnet |

"상속"은 frontmatter에 `model:`이 없어 메인 세션 모델을 씁니다.

판정 파일은 그 단계에 기록된 에이전트가 쓴 것만 유효합니다. 몫이 끝난 에이전트는 아무것도 쓰지 못합니다.

목업을 그리는 두 에이전트는 훅이 도구도 제한합니다. `rein:as-is`는 Read·Grep·Glob으로 코드를 읽고 Write·Edit으로 `agent/asis.html`만 씁니다. `rein:sketcher`는 Read로 읽고 Write로 `agent/tobe.html`만 쓰며, 코드를 찾아볼 수 없습니다. `1-mockup.html`은 훅이 두 파일을 합쳐 씁니다.

reviewer·review-splitter·worker와 몫이 끝난 에이전트의 Bash는 읽기만 하는 명령(`cat`·`head`·`tail`·`wc`·`ls`·`grep`·`rg`·`find`·`cut`·`sed -n '<줄>p'`, 서로 파이프로 이을 수 있음)과 읽기 전용 git(`diff`·`status`·`log`·`show`·`grep`·`ls-tree`, 뒤에 읽기 명령을 파이프로 이을 수 있음)만 돕니다. qa-integration의 완료 판정 reviewer도 같습니다. worker는 설계 파일의 `rm`도 됩니다. 체이닝(`;`·`&&`), 리다이렉트, 치환은 셸로 쓰거나 확인 못 한 것을 돌릴 수 있어 거절하고, 거절 메시지가 Read·Grep·Glob을 안내합니다.

## 결정 — `advance`

훅은 사람에게 묻지 않습니다. 메인 세션이 사용자에게 묻거나 스스로 정해서 `advance({ answer, said })`로 라벨을 넘깁니다.

- `answer` 없이 부르면 아무것도 바꾸지 않고, 받는 라벨과 훅만 아는 사실(실패, 바뀐 config 등)을 알려 줍니다.
- 라벨이 아닌 답은 무시합니다. 사용자 원문은 `said`에 담겨 trace에 남습니다.
- **반드시 사용자의 답이어야 하는 자리**: spec 승인, plan 승인, 커밋 승인, 메인 세션의 `git commit`.

## 이동 — `goto`

메인 세션은 `goto({ stage, said })`로 run을 아무 단계로 옮길 수 있습니다. 판정은 기본 경로일 뿐입니다.
예: 완료 판정 대조가 실패했지만 증거가 충분하면 `land`로, e2e 확인 문구만 고쳤으면 `qa-integration`으로.

훅은 그 단계에 들어갈 때처럼 상태를 맞춥니다.

- plan 뒤로 갈 때 `2-plan.md`가 바뀌었으면 다시 판정합니다. 통과 못 하면 거부합니다.
- 뒤 단계의 결과는 지웁니다.
- `land`로 가도 커밋은 사용자 승인이 필요합니다.

서브에이전트는 `advance`·`goto`·`park`·`resume`을 부르지 못합니다.

## Rein 밖의 에이전트

통합 qa의 Aside(`aside exec`)와 ego 브라우저는 Claude Code 서브에이전트가 아닌 별도 프로그램입니다.
사용자의 실제 브라우저 프로필과 로그인을 쓰므로, config의 운영 호스트(`e2e.production`, `e2e.backends`)에는 돌리지 않습니다.
