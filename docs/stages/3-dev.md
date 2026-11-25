# 3. dev — 개발

`2-plan.md`의 상세 설계를 코드로 옮깁니다. 코드는 `rein:worker`가 쓰고, 메인 세션은 진행만 합니다.

에이전트 지시: [skills/dev/SKILL.md](../../skills/dev/SKILL.md) · [agents/worker.md](../../agents/worker.md) · [agents/arbiter.md](../../agents/arbiter.md)

## 흐름

1. 사용자가 **`/rein:dev`** 입력 → `2-plan.md` 승인 → run이 dev로.
2. `rein:worker` 실행. 프롬프트는 훅이 run 상태로 통째로 씁니다 — 설계 파일, 넘길 파일, 재시도면 읽을 실패 파일(`precheck.md`·`review.md`·`qa.md`·`e2e.md` 등). `## 배치 대조`가 있으면 화면마다 `1-mockup.html#<id>`와 헤드리스 Chrome으로 렌더링한 to-be PNG도 넘겨, 그 모양대로 짓게 합니다.
3. worker가 코드와 테스트를 쓰고, 마지막에 `dev-items.md`를 씁니다.
4. 훅이 바로 판정합니다. 통과하면 run은 `review`로, 아니면 worker를 다시 띄웁니다.

## worker가 묶이는 것

| | 허용 |
|---|---|
| 쓰기 | 설계 파일, `dev-items.md`, `## 넘길 것`의 `handoff/` 파일. `.git` 안, `.rein/config.json`, `1-spec.md`, `2-plan.md`는 거부 |
| Bash | 설계 파일의 `rm`, 읽기 전용 git, 읽기만 하는 명령(`cat`·`head`·`tail`·`wc`·`ls`·`grep`·`rg`·`find`·`cut`·`sed -n '<줄>p'`, 서로 파이프로 이을 수 있음)만. 빌드·테스트는 훅이 돌립니다 — config의 `precheck`(컴파일·타입 검사)는 review 전에, qa 명령은 review 뒤에 |

worker의 모든 쓰기는 기록됩니다. 되돌려도 기록은 지워지지 않습니다.

## dev-items.md 판정

설계 파일마다 `- [x] <path>` 한 줄씩. 훅은 다음을 확인합니다.

- 목록 = `2-plan.md`의 파일 목록 (빠진 것도, 더한 것도 없음)
- 모든 항목 체크됨
- 기록된 쓰기가 전부 목록 안에 있음
- 넘길 파일이 모두 써졌고 비어 있지 않음

통과할 때마다 훅이 `dev-diff.md`를 그 회차의 diff로 바꿔 씁니다. 재시도 회차는 읽은 실패를 `fails.md`에 덧붙여, review·qa·plan이 모든 시도의 실패를 볼 수 있습니다. e2e.md에서는 실패한 확인만 옮기고, 통과한 확인과 `## 이전 진입`은 뺍니다. `fails.md`가 생기기 전에 시작한 run은 다음 통과 때 `dev-diff.md`의 읽은 실패를 `fails.md`로 옮깁니다.

## 설계대로 할 수 없을 때

worker는 멈추고 이유를 보고합니다. 판단은 메인 세션이 아니라 `rein:arbiter`가 합니다.

- `deviation.md`에 `판정: 합당` → run은 plan으로 (설계를 고침)
- `판정: 부당` → 설계 유지, worker를 다시 띄움

설계 밖 파일을 이미 썼다면 그 자체로 `합당` 근거입니다. 중재는 plan 한 번에 한 번뿐입니다.

## 메인 세션이 고칠 수 있는 것

환경(로컬 설정, 보조 스크립트, 설계 밖 fixture)은 고쳐도 됩니다. 리뷰·커밋 대상이 아닙니다.
설계 파일을 메인 세션이 고치면 run의 변경으로 기록되어 리뷰에 들어갑니다.
