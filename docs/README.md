# Rein — Claude Code 워크플로우 하네스

요구사항부터 커밋까지의 작업을 정해진 단계로 진행시키는 Claude Code 플러그인입니다.
`/rein:spec <요청>`으로 시작합니다. 작은 작업은 `/rein:autopilot <요청>`으로 시작하면 spec 질문 말고는 멈추지 않고 land까지 갑니다.

남은 일은 GitHub Issues에서 관리합니다.

## 설치

Claude Code **2.1.287 이상**이 필요합니다.

```
/plugin marketplace add Bluewind8791/rein
/plugin install rein@rein
```

설치 후 작업할 저장소마다 `/rein:setup`을 돌립니다. 설정·업데이트·제거는 [distribution.md](./distribution.md)에 있습니다.

## 명령

**run 시작**

| 명령 | 하는 일 |
|---|---|
| `/rein:spec <요청>` | 요구사항이나 버그 보고로 run을 열고 spec 단계를 진행합니다. |
| `/rein:autopilot <요청>` | 작은 작업용. spec 질문 말고는 멈추지 않고 land까지 갑니다. |

**승인·이어가기** — run이 사용자를 기다릴 때 입력합니다. 뒤에 `<slug>`를 붙이면 새 세션에서 그 run을 이어 갑니다.

| 명령 | 언제 | 하는 일 |
|---|---|---|
| `/rein:plan [slug]` | spec이 끝났을 때 | `1-spec.md`를 승인하고 plan으로 넘어갑니다. |
| `/rein:dev [slug]` | plan이 끝났을 때 | `2-plan.md`를 승인하고 dev로 넘어갑니다. |
| `/rein:e2e [slug]` | 작업 qa 통과 뒤 통합 qa가 기다릴 때 | 통합 테스트를 aside나 ego 브라우저에 맡깁니다. |
| `/rein:land [slug]` | 체크리스트를 직접 테스트했을 때 | 모든 칸이 체크됐는지 확인하고 land로 넘어갑니다. |

**관리**

| 명령 | 하는 일 |
|---|---|
| `/rein:setup` | 저장소의 검증 명령(`.rein/config.json`), 도메인 룰·지식, 허브 서버 주소를 정합니다. |
| `/rein:update` | 플러그인을 최신 릴리스로 올립니다. |
| `/rein:uninstall` | 플러그인을 지우기 전에 Rein이 이 PC에 남긴 것을 정리합니다. |

review, qa, retro 단계는 훅이 알아서 진행하므로 입력할 명령이 없습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [overview.md](./overview.md) | 단계 흐름, run의 워크트리, 파일 위치 — **여기서 시작** |
| [agents.md](./agents.md) | 메인 세션·서브에이전트의 역할, `advance`·`goto` |
| [distribution.md](./distribution.md) | 설치·설정·업데이트·개발·릴리스 |
| [verification.md](./verification.md) | `trace.jsonl`로 하네스가 제대로 돌았는지 확인하는 법, 실측 기록 |
| [mods.md](./mods.md) | Claude Code Mod(함수 훅) API 조사 기록 |

## 단계

| 단계 | 문서 | 에이전트 지시 |
|---|---|---|
| 1 기획 (`spec`) | [1-spec.md](./stages/1-spec.md) | [skills/spec](../skills/spec/SKILL.md) |
| 2 설계 (`plan`) | [2-plan.md](./stages/2-plan.md) | [skills/plan](../skills/plan/SKILL.md) |
| 3 개발 (`dev`) | [3-dev.md](./stages/3-dev.md) | [skills/dev](../skills/dev/SKILL.md) |
| 4 리뷰 (`review`) | [4-review.md](./stages/4-review.md) | [skills/review](../skills/review/SKILL.md) |
| 5 QA (`qa`, `qa-integration`) | [5-qa.md](./stages/5-qa.md) | [skills/qa](../skills/qa/SKILL.md), [skills/e2e](../skills/e2e/SKILL.md) |
| 6 후처리 (`land`) | [6-land.md](./stages/6-land.md) | [skills/land](../skills/land/SKILL.md), [skills/retro](../skills/retro/SKILL.md) |
