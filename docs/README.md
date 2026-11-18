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
