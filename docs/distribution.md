# 배포 · 설치 · 개발

Rein은 Claude Code 플러그인입니다. 이 저장소 하나가 마켓플레이스이자 플러그인입니다.

## 저장소 구성

```
.claude-plugin/   marketplace.json, plugin.json (name = "rein", version)
hooks/            hooks.json, register.ts(함수 훅 모듈), stages/, lib/, 업데이트 알림 스크립트
skills/           /rein:<이름> 스킬 — 단계별 지시
agents/           Rein 서브에이전트
tests/            훅 시험
.claude/skills/   이 저장소 전용 스킬 (release, learn) — 배포되지 않음
.claude/agents/   이 저장소 전용 에이전트 (learn-reviewer) — 배포되지 않음
```

## 설치

```
/plugin marketplace add Bluewind8791/rein
/plugin install rein@rein
```

- Claude Code **2.1.287 이상**이 필요합니다. 함수 훅이 기본으로 켜지는 버전입니다.
- 훅이 로드되지 않으면 `/rein:setup`이 원인(대개 버전)을 알려 줍니다.

설치 후 저장소마다 `/rein:setup`을 돌립니다.

- `<repository>/.rein/config.json` — 검증 명령. 사용자 확인 후 씀
  - `qa`(필수): 작업 qa 명령
  - `e2e`: 앱 URL·로그인, 운영 호스트(`production`, `backends`), 시간 제한, ego 프로필
- `~/.rein/<project>/rules/`, `knowledge/` — 허브 서버의 카탈로그에서 고른 도메인의 룰과 지식
- `~/.rein/<project>/requirements/<도메인>/` — 화면 문서. land가 쓰고, 카탈로그의 같은 도메인 `requirements/`와 주고받음
- `~/.rein/rules/` — 모든 프로젝트에 적용할 공용 룰 (선택). 허브 서버와 주고받음
- `~/.rein/sync.json` — 허브 서버 주소 `{ "server": "http://<MagicDNS 이름>:7380" }` (선택). PC마다 따로 둠

## 허브 서버

모든 PC의 run과 도메인 카탈로그를 한곳에 두는 서버입니다. 늘 켜 두는 PC 한 대에서 돌립니다.

```
node frame/hub.js serve --root <폴더> [--port 7380] [--bind <ip>]
```

- `<폴더>`는 그 PC의 `~/.rein`과 다른 폴더입니다 (예: `D:\rein-hub`). 구조는 `~/.rein`과 같습니다.
- 그 PC의 Tailscale 주소에서만 듣고, tailnet 안의 요청만 받습니다.
- `node frame/hub.js print-task --root <폴더>`가 로그온 때 서버를 띄우는 작업 스케줄러 명령을 보여 줍니다.
- 브라우저로 `http://<MagicDNS 이름>:7380`을 열면 모든 PC의 run을 읽기 전용으로 봅니다. 왼쪽 아이콘 막대의 「화면」은 카탈로그의 화면 문서를 화면별로 보여 줍니다([6-land.md](./stages/6-land.md#프레임의-화면-페이지)).
- 카탈로그는 `<폴더>/.hub/domains/<도메인>/`, 공용 룰은 `<폴더>/rules/`입니다. 각 PC의 `/rein:setup`이 카탈로그에서 도메인을 골라 받습니다.

`sync.json`에 `server`가 있는 PC는 로컬 frame 서버가 run 파일을 바뀔 때마다 올립니다. 세션을 시작할 때 카탈로그와 공용 룰의 바뀐 파일을 받고, 이 PC에서 고친 파일을 보냅니다. 서버에 닿지 않으면 쌓아 두었다가 다음에 닿을 때 보냅니다.

화면 문서(`<도메인>/requirements/`)도 카탈로그와 같은 길로 주고받습니다. 프로젝트가 받은 도메인(`rules/`나 `knowledge/`에 있는 도메인)마다 비교하므로, 아직 없는 PC에도 내려옵니다. land에서 run이 닫힐 때도 보냅니다. `/rein:setup`의 도메인 받기는 화면 문서를 건드리지 않습니다. 보내지 않은 문서를 지우지 않기 위해서입니다.

### git 원격에서 옮기기

예전 git 동기화(`sync.json`의 `remote`)로 올린 run은, 어느 PC에도 `server`를 넣기 **전에** 서버 PC에서 가져옵니다.

```
node scripts/import-rein-runs.js --remote <원격 URL> --root <폴더> [--dry-run]
```

순서가 바뀌면 옛 PC에 남은 오래된 사본이 서버에 먼저 올라가, run을 실제로 가진 PC에서 그 run이 잃은 것으로 보입니다. 그래서 `/rein:setup`은 서버가 아직 가져오지 않았으면 `remote`가 있는 PC에 `server`를 쓰지 않습니다.

## 업데이트

- 세션 시작 시 `hooks/check-update.js`가 설치본 version과 원격의 `rein--v<버전>` 태그를 비교해 알립니다.
- `/rein:update`로 적용하고 `/reload-plugins`를 실행합니다.
- 세션 밖 터미널에서는 알림이 함께 보여 주는 두 명령을 차례로 실행합니다. `/rein:update`가 안에서 실행하는 명령과 같습니다.
  ```
  claude plugin marketplace update <마켓플레이스>
  claude plugin update rein@<마켓플레이스>
  ```
  설치 scope는 `claude plugin update`가 스스로 찾습니다. 이미 열린 세션은 `/reload-plugins` 전까지 옛 버전을 씁니다.
- private 저장소의 백그라운드 업데이트는 credential helper가 필요합니다 (`gh auth setup-git` 등).

## 제거

`/rein:uninstall`을 **먼저** 돌립니다. 스킬이 플러그인과 함께 사라지기 때문입니다.

```
claude plugin uninstall rein@rein
claude plugin marketplace remove rein
```

run 기록과 상태는 지우고, 룰·지식·`.rein/config.json`은 물어보고 지웁니다.

## 개발 루프

설치본은 `~/.claude/plugins/cache`로 **복사**됩니다. 고친 내용을 바로 보려면 개발 클론을 직접 띄웁니다.

```
claude --plugin-dir <개발 클론>
```

설치본 그대로 시험하려면 개발 클론을 마켓플레이스로 등록합니다.

```
claude plugin marketplace add <개발 클론>
claude plugin install rein@rein
```

시험은 `claude plugin test`, 타입 검사는 `tsc --noEmit -p .`입니다.

## 릴리스

push는 프로젝트 스킬 `release`가 맡습니다.

1. 시험·검증을 돌림
2. 지난 태그 뒤 커밋을 보고 버전 결정 — `0.x` 동안 `feat`나 깨는 변경은 minor, 나머지는 patch. `docs/`·`tests/`·`.claude/`만 바뀌면 릴리스 없이 push
3. `chore: release <버전>` 커밋 → push → `rein--v<버전>` 태그

version을 올리지 않은 push는 설치본에 전파되지 않습니다.
