# 검증 — 하네스가 제대로 돌았는가

훅은 조용히 실패합니다. 환경변수가 빠졌거나 Mod가 로드되지 않으면 아무것도 막지 않고,
run은 잘 끝난 것처럼 보입니다. `D47`(run이 없으면 막지 않음) 때문에 "run이 없어서 안
막음"과 "훅이 죽어서 안 막음"이 겉으로 같습니다. 트랜스크립트에는 거부 사유만 남고,
통과시킨 호출·종료 판정의 조건별 결과·단계 전이는 어디에도 남지 않습니다.

이 문서는 **다른 세션에서 돈 run을 이 세션에서 읽고 정상인지 판정하는 방법**을
적습니다. 두 가지에 씁니다.

- **착수 전 실측** — 함수 훅 환경, `~/.rein` 쓰기, aside 출력처럼 한 번 확인하면 되는 것
- **하네스 동작 확인** — 훅을 고칠 때마다, 실사용 run마다 필요한 것

```mermaid
sequenceDiagram
    autonumber
    participant V as 검증 세션
    participant W as 실제 저장소의<br/>git worktree
    participant H as 다른 세션<br/>(headless 또는 사람)
    participant T as ~/.rein/&lt;project&gt;/&lt;runId&gt;/<br/>agent/trace.jsonl

    V->>W: worktree 생성 (버리는 브랜치)
    V->>H: claude -p --output-format stream-json
    H->>T: 훅이 결정마다 한 줄 (D104)
    H-->>V: stream-json
    V->>T: 읽고 설계와 대조 (D106)
    V->>W: worktree 제거
```

## 확정

| 항목 | 값 |
|---|---|
| 기록 | 훅이 모든 결정을 run 폴더의 `agent/trace.jsonl`에 한 줄씩 (`D104`). 폴더는 `~/.rein/<project>/<state>/<runId>/`이고 상태를 따라 옮겨 감 — 진행 중이면 `active/`, 끝나면 `complete/`, 멈추면 `defer/`·`drop/` (`D144`) |
| 생존 신호 | run 시작 때의 `load` 줄. `/rein:spec`을 돌렸는데 없으면 훅이 안 돈 것 (`D104`) |
| 구동 | headless가 기본 — 검증 세션이 `claude -p`로 띄움. 사람 게이트·UI만 사람이 돌림 (`D105`) |
| 판정 | 검증 세션이 trace를 읽고 설계와 대조. 차단은 일부러 어기는 입력으로 확인. 반복되는 확인만 나중에 스크립트로 (`D106`) |
| 착수 전 실측 도구 | 착수 1번을 **기록만 하는 Mod**로 시작. 그 trace가 탐침 (`D107`) |
| 시험 장소 | 실제 저장소의 `git worktree`. 끝나면 제거 (`D108`) |
| 기록 실패 | 경고만. run은 계속 (`D109`) |

## trace

훅이 `$.fs`로 씁니다. 에이전트의 `Write`가 아니므로 Claude Code의 권한 확인을 거치지
않습니다. 작업 디렉터리 밖인 `~/.rein/`에도 확인 없이 씁니다 (`U59` 실측).

| `ev` | 언제 | 담는 것 |
|---|---|---|
| `load` | run 시작 | 훅 버전, 세션 ID, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` 값, Claude Code 버전 |
| `tool` | `tool.call`마다 | 단계, 도구, 경로 또는 명령, `allow`·`deny`, 근거 규칙(`D46`·`D64`·`D94`·`D99` 등). `Write`·`Edit`·`NotebookEdit`의 파일 내용은 `{length, sha256}`만 |
| `exit` | 종료 판정마다 | 단계, 규칙(`D39`·`D49`·`D56`·`D79`·`D95` 등), **조건별 참·거짓**, 결과(`pass`·`stay`·`fail`). `fail`은 `review`·`qa`·`qa-integration` 실패로 `stage`를 되돌림 — 판정(`## 실패 원인`)이나 결정대로 `dev` 또는 `plan`으로 (`D116`, `D62`), 판정자가 없거나 구현 실패가 반복되면 멈춤(`failure-route`) |
| `stage` | 전이 | `from`, `to`. 되돌림(`D55`·`D116`)이면 사유 |
| `capture` | 훅이 값을 붙잡을 때 | 러너의 aside 호출에서 세션 ID와 `판정:` 줄, 쓴 시간, 상한을 넘겨 멈춘 세션, `D95`의 `HEAD`와 `land` 저장소 집합(`D129`) |
| `result` | 러너의 결과 파일이나 ego judge의 `judge.md`를 받을 때 | 항목, 판정, 항목 폴더의 스크린샷(`shots`, `D177`). ego judge가 `데이터 없음`으로 판정했으면 `noData: true` |
| `error` | 훅 자체의 예외 | 어느 훅, 메시지 |
| `write` | `dev` 중 소스 쓰기를 기록할 때 | 경로. 쓰기가 안 들어가 기록을 되돌리면 `dropped` (`D49` ③) |
| `spawn` | 판정 에이전트를 띄울 때 | 단계, 에이전트 종류, 기록한 `agentId` (`D116`, `D123`, `D130`, `D175`). 나눈 review의 reviewer는 `group` |
| `groups` | splitter의 `review-groups.md`가 들어올 때 | 묶음마다 제목과 파일 수 |
| `deviation` | 중재 판정이 들어올 때 | `합당`·`부당`, `agentId` (`D123`) |
| `grade` | 채점이 들어올 때 | 훅이 낸 모호도, 그때까지의 질문 수, 차원마다 점수·깎임·빈칸, `agentId` (`D175`) |
| `as-is` | `rein:as-is`의 `agent/asis.html`이 들어올 때 | `agentId`, 그 파일이 그린 화면 `id` 목록. 띄울 때의 `spawn` 줄에는 이번에 그릴 화면(`screens`) |
| `sketch` | sketcher의 `agent/tobe.html`을 as-is와 합쳐 `1-mockup.html`을 쓸 때 | `agentId`. 합치지 못하면 대신 `sketch-join`과 이유(`problem`: 표식 없는 `.compare`, as-is에 없는 `id`) |
| `ask` | `spec`에서 메인 세션의 질문이 답을 받을 때 | 지금까지의 질문 수 (`D175`). 거부된 질문은 `tool` `deny` 줄에 `rule: D175` |
| `rerun` | 훅이 `advance`에서 `qa` 명령을 돌린 뒤 — 첫 실행 포함 | 저장소·명령·exit code (`D56`, `D153`). 묻지 않고 돌렸으면 `rule: D153`, 실패 뒤 사람에게 물어 돌렸으면 `rule: D143`과 답. 명령이 config를 고쳤으면 `configRewritten` (`D120`) |
| `release` | 멈춘 run을 사람이 풀 때 | 단계, 멈춘 이유, 답 (`D132`, `D141`) |
| `halt` | e2e가 설정됐는데 aside를 못 써 멈출 때 | 단계(`qa` 또는 `qa-integration`), 멈춘 이유 (`D141`) |
| `park` | 사람이 `park` 질문에 `보류`·`폐기`로 답할 때 | 단계, 답, 에이전트가 전한 이유, 옮겨 간 `state`. `defer/`·`drop/`의 새 위치에 씀 (`D146`) |
| `resume` | 사람이 이어받기를 확인할 때 | 단계, 이전 상태(`defer`·`active`), 새 세션 ID, 훅 버전, 답 (`D147`). 보류된 동안 저장소가 바뀌었으면 뒤따르는 줄에 `rule: D150`, `added`(쓰기 기록에 더한 경로), `changed` — `review` 이후면 `stage`(`to: dev` 또는 `to: review`), `plan`·`dev`면 `write`. 폴더 없이 이어받았으면 `folder: missing` |
| `migrate` | 이전 배치의 run을 옮길 때 | 옛 키, 옮겨 간 `state`, 세션 ID (`D149`) |

`D120`의 추가 줄 — `plan`이 커밋본과 다른 config로 멈추면 `exit`에 `held: D120`. 통합 `qa`가 `land` 직전에 config 변경을 찾으면 `exit`에 `rule: D120`과 `configRewritten`. aside 결과를 붙잡을 때 찾으면 `capture` 줄의 `halt`가 `D120`.
| `freeze` | 사람의 답으로 config 해시를 새로 박을 때 | 단계, 저장소마다 해시 (`D120`, `D132`) |

착수 5번 구현의 `exit` 줄은 조건별 배열(`cond`) 대신 `pass`(참·거짓)와 `rule`·`reason`을
적습니다. 완료(`D148`)의 `stage` 줄(`to: null`)은 `state: complete`와 함께 `complete/`에 씁니다. 폴더를 못 옮기면 `error`에 `move`와 사유가 남습니다 (`D144`). 사람 질문(`D112`·`D122`·`D133`·`D146`)이 거부로 끝나면 `tool` `deny` 줄에 `answer`나
실패 사유가 붙습니다.

```
{"t":"..","ev":"load","ver":"0.1.0","session":"abc","hooksEnv":"1","cc":"2.x"}
{"t":"..","ev":"tool","stage":"spec","tool":"Write","path":"src/a.ts","decision":"deny","rule":"D46"}
{"t":"..","ev":"exit","stage":"dev","rule":"D49","cond":[true,true,false],"result":"stay"}
{"t":"..","ev":"stage","from":"dev","to":"review"}
```

`allow`도 적습니다. "막았어야 하는데 통과시킨" 고장은 `allow` 줄이 있어야 보입니다.

대화 전문은 trace에 적지 않습니다. `load` 줄의 세션 ID로 `~/.claude/projects/*/<세션ID>.jsonl`에서 찾습니다.

run 밖의 호출은 적지 않습니다. `D47`대로 하네스가 관여하지 않는 구간입니다.

**크기.** `$.fs`는 읽기·쓰기 4 MiB 제한이고 덧붙이기(append)가 없습니다 (`U59` 실측).
훅이 줄마다 파일 전체를 읽고 다시 쓰고, 동시에 오는 훅은 모듈 안의 큐로 줄 세웁니다.
그래서 한 줄을 더하면 3 MiB를 넘을 때 그 줄부터 `trace-2.jsonl`에 쓰고, 그다음은 `trace-3.jsonl`… 순서입니다.
파일 내용을 담는 도구 입력은 길이와 해시만 남깁니다. 0.39.1까지는 `Write` 내용을 통째로 적어 큰 run의 trace가
4 MiB에 닿고 그 뒤 기록이 모두 빠졌습니다 (2026-11-03, 바뀐 파일이 많은 run).

**쓰기가 실패하면** (`D109`) run을 멈추지 않습니다. `$.ui.toast`로 경고를 띄우고(`D198`)
`$.store`에 "trace 끊김"을 표시합니다. 검증 세션은 그 run을 불완전한 기록으로
취급합니다. 기록 문제로 사람의 작업을 멈추지 않기 위해서입니다. 표시는 run 기록의
`traceBroken`(처음 실패한 때와 사유)이고 `mcp__rein__status`가 보여 줍니다. toast는 세션마다
run당 한 번입니다 — 4 MiB에 닿으면 그 뒤의 쓰기가 전부 실패하기 때문입니다.

## 누가 돌리는가

| | headless | 사람 세션 |
|---|---|---|
| 누가 띄우나 | 검증 세션이 `claude -p --output-format stream-json --verbose --permission-mode <모드> --plugin-dir <개발 클론>` | 사람이 평소처럼 |
| 확인하는 것 | 차단, 전이, 종료 판정, 권한 | `D39` 승인, 프레임 페이지의 진행 상황 |
| 검증 세션이 읽는 것 | trace + stream-json | trace + 트랜스크립트(`~/.claude/projects/.../<세션 ID>.jsonl`) |

**진행 상황은 프레임 페이지에서 봅니다.** run이 열려 있는 동안(열 때와 이어갈 때부터 active를
떠날 때까지) 훅이 모든 세션에서 run 폴더의 `agent/frame.json`에 run의 단계, 상태(`run`·`ask`·`halt`),
보여 줄 것을 씁니다. 로컬 프레임 서버(`frame/server.js`)가 그것을 읽어 페이지에 그립니다. 훅은
run을 열 때, 이어갈 때, 단계가 바뀔 때 `node frame/server.js ensure`로 서버가 떠 있게 합니다.
run을 열거나 이어갈 때는 서버가 이미 떠 있어도 메인 세션에 URL을 알리고, 단계가 바뀔 때는 새로
띄웠을 때만 알립니다. 무엇을 보여 줄지(`hooks/lib/pane.ts`의 `frameStatus`)와
언제 쓰고 서버를 부르는지는 `claude plugin test`가 단언합니다. 실제 모습은 사람이 브라우저에서 봅니다.

페이지 맨 위에는 진행 중인 run과 지금 보는 run이 탭으로 놓입니다. 왼쪽에는 아이콘 막대(run·화면·전체 run)와 탐색기가 있고, 탐색기는 상태 카드, 단계별 산출물 트리, 저장소를 보여 줍니다. 단계는 처음에 모두 펼쳐져 있고, 탐색기는 목업을 볼 때도 열려 있습니다(«로 접음). 가운데는 편집기 탭으로 연 산출물입니다. 맨 아래 상태 줄은 단계, 경과 시간, 시작 시각, 허브 연결을 보여 줍니다. 오른쪽 위 버튼으로 다크·라이트를 바꿉니다. 테마와 run마다 열어 둔 탭은 브라우저가 기억합니다.

`--plugin-dir`은 [distribution.md](./distribution.md)의 개발 루프 그대로입니다. 설치본을
거치지 않으므로 `version`을 올릴 필요가 없습니다.

headless에는 권한 확인 창이 없습니다. 확인이 필요한 호출은 거부되어 stream-json에
찍힙니다. `U56`처럼 "확인 창이 뜨는가"를 묻는 항목은 이 거부로 드러납니다.

**권한 모드를 명시합니다.** 사용자 설정의 기본 모드가 `bypassPermissions`면 headless run도
그 모드로 돌아 권한 문제가 안 보입니다. 첫 탐침에서 실제로 그랬습니다.

- 권한 확인이 뜨는지 볼 때(`U56`) — `--permission-mode default`
- 차단을 볼 때(`D46`) — `--permission-mode acceptEdits`. `default`면 작업 디렉터리 안의
  쓰기도 권한 계층이 먼저 거부해, 거부가 Rein의 것인지 구분이 안 됨

`AskUserQuestion`이 끼는 구간은 headless로 못 넘습니다. 시험용 자동 승인 같은 우회는
두지 않습니다 — 게이트를 우회하는 코드가 제품에 들어가게 됩니다.

승인 질문(`D112`)은 메인 세션의 `AskUserQuestion`이라(`D200`) headless에서는 물을 수
없습니다. 스킬은 그때 `advance`를 부르지 않고 멈추므로, run이 `spec`에 머문 것이
headless에서 볼 수 있는 몫입니다. 답에 따른 갈래는 `claude plugin test`로 봅니다 —
`tests/`의 시험이 `advance`·`park`·`resume`에 `answer`를 넣어 부릅니다. trace의 답은 그
인자를 적은 것이라, 사람이 실제로 답했는지는 trace로 판정하지 못합니다 (`D200`의 대가).

## 어디서 돌리는가

실제 저장소입니다 (`D108`). 실사용과 같은 코드·설정·`.rein/config.json`에서 봅니다.

다만 headless run은 **그 저장소의 `git worktree`**에서 돌립니다. 버리는 브랜치로 따로
만든 디렉터리이고, 끝나면 지웁니다. 일부러 어기는 입력을 넣는데 훅이 고장나 있으면
코드가 실제로 바뀌기 때문입니다. 메인 작업 트리는 건드리지 않습니다.

worktree 세션의 `<project>`는 원래 저장소의 폴더명입니다(`D162`). 그래서 실사용과 같은
룰로 돌고, run 기록도 실사용 기록과 같은 곳에 쌓입니다. 시험 run의 이름은 겹치지 않지만(`D58`)
보류 목록과 `resume` 후보에 함께 보이므로, 끝나면 `park`의 `폐기`로 닫습니다.

어느 저장소로 할지는 착수 때 정합니다.

## 어떻게 판정하는가

처음에는 **검증 세션이 trace를 읽고 설계 문서와 대조합니다** (`D106`). 규칙을 미리
코드로 만들지 않습니다. 첫 run들에서는 무엇이 고장나는지부터 모르기 때문입니다.
읽으면서 매번 같은 확인을 하게 되면, 그 확인만 검사 스크립트로 굳힙니다.

읽기만으로는 **차단이 되는지** 모릅니다. 에이전트가 어기려고 시도하지 않으면 `deny`도
`allow`도 안 찍힙니다. 그래서 headless run에는 일부러 어기는 입력을 넣습니다.

| 입력 | 기대 |
|---|---|
| `spec` 중 소스 파일 `Write` | `tool` `deny` `D46` |
| run 없이 소스 파일 `Write` | 통과, trace 파일 없음 (`D47`) |
| `qa` 중 `sed -i` | `tool` `deny` `D117` (`D64`, `D153`) |
| `qa` 중 config의 `qa` 명령(`npm test`) | `tool` `deny` `D117` (`D153`) |
| `qa` 중 `npm test && rm x` | `tool` `deny` `D94` |
| `qa` 중 훅의 실행이 실패하기 전에 `qa.md`를 씀 | `tool` `deny` `D153` |
| `dev`가 설계 목록 밖 파일을 씀 | `exit` `D49` ③ 거짓, `stay` |
| `review` 중 메인 세션이 `review.md`를 씀 | `tool` `deny` `D116` |
| `review` 중 `git diff --output=x` | `tool` `deny` `D119` |
| `review` 중 `PowerShell` | `tool` `deny` `D117` (`D127`) |
| `review` 중 `git diff` | `tool` `allow`, `ran`에 훅이 고친 명령 (`D128`) |
| `dev` 중 메인 세션이 `deviation.md`를 씀 | `tool` `deny` `D22` (`D123`) |

늘 확인하는 것:

- `load` 줄이 있다
- `error` 줄이 없다
- 앞으로 가는 `stage` 바로 앞에는 그 단계의 `exit` `pass`가, 뒤로 가는 `stage` 바로 앞에는
  `exit` `fail`이 있다. 예외는 둘 — run을 여는 첫 `stage`(`from: null`, `D111`)와 사람
  승인으로 넘어가는 `stage`(`answer`가 붙음, `D112`)
- 착수 5번에서 예외가 늘었습니다 — `qa`의 `stage`는 `exit` 대신 `rerun` 줄 뒤에 오고
  (`qa.md` 쓰기로 `dev`에 가는 `stage`는 `rule: D153`을 달고 그 방문의 실패한 `rerun` 뒤에),
  중재로 가는 `plan`은 `deviation` 줄 뒤에, 사람 답(`D122`·`D133`)은 `answer`가 붙은
  `stage`로, 멈춤 해제는 `release` 줄로 옵니다
- `review.md` 형태가 틀린 쓰기는 `exit`이 아니라 `tool` `deny` `D116`으로 찍힌다
- `allow`된 쓰기 경로가 그 단계의 `D46` 목록 안에 있다

## 착수 전 실측

착수 1번을 **차단 없이 기록만 하는 Mod**로 시작합니다 (`D107`). `load` 줄과 모든
`tool.call`을 trace에 적습니다. 이 탐침이 곧 제품의 trace 코드라서 버릴 것이 없습니다.

run 개념이 붙기 전이므로 `<runId>` 자리에 `probe-<세션 ID>`를 씁니다.

| 실측 항목 | 확인 방법 |
|---|---|
| 함수 훅 활성화 조건 (`U39`) | 환경변수를 넣고·빼고 두 번 돌려 `load` 줄이 찍히는지 |
| `hooks/hooks.json` 등록 형태 | 같음 — 틀리면 `load` 줄이 없음 |
| `-p`에서 함수 훅이 도는가 (`U60`) | headless run에서 `load` 줄이 찍히는지. 안 찍히면 `D105`를 다시 봄 |
| `$.fs`의 쓰기 범위·덧붙이기 (`U59`) | trace가 `~/.rein/`에 생기는지. 덧붙이기 API가 타입 선언에 있는지 |
| `$.store` 4 MiB | 넘겨 보지 않고 한계로 둠. store에는 run 기록만 있고 `complete`·`drop`이면 지워짐(`D145`·`D148`). 기록 하나에 승인된 `1-spec.md`·`2-plan.md` 전문(`D160`)이 들어 수십 KB라, `U44`의 닫힌 세션 기록이 100개 안팎 쌓이면 닿음. 3 MiB부터의 경고는 `claude plugin test`가 단언 |
| 에이전트 `Write`의 `~/.rein` 권한 (`U56`) | headless run에서 `~/.rein/.../x.md` `Write`를 시켜 stream-json에 권한 거부가 찍히는지 |
| `tool.call`이 `Bash` stdout을 받는가 (`U58`) | `tool` 줄에 `next()` 뒤의 출력을 적어 봄 |
| `aside exec`의 동작 (`U58`) | 훅 없이 터미널에서 `aside exec`를 직접 — 끝날 때까지 기다리는지, stdout 형식, 강제로 끊은 뒤 `aside session list`·`stop` |

### 결과 (2026-09-23, 2.1.280)

| 항목 | 결과 |
|---|---|
| `U39` | 활성화 변수가 **여전히 필요**. 없으면 trace가 안 생김 |
| 등록 형태 | 문서대로. `claude plugin validate` 통과, `load` 줄 찍힘 |
| `U60` | `-p`에서 로드됨 (`"interactive":false`) |
| `U59` | `~/.rein/`에 확인 없이 씀. 덧붙이기 없음 |
| `U58` 중 `Bash` stdout | 받음 — `next()` 결과의 `text` |
| `U56` | 기본 권한 모드에서 거부됨. `tool.check`가 `allow`로 답하면 통과 (`D110`) |
| `$.store` 4 MiB | 타입 선언으로만 확인. 넘겨 보지는 않음 — 한계로 둠(아래 실측 마무리) |
| aside CLI | 미확인. 뒤에 터미널에서 실측 — 아래 착수 5번 결과 (`U58` 해소, `D131`) |
| 훅이 묻는 질문 (`D112`, `D82`가 미룬 항목) | 대화형에서 `tool.call` 안의 `$.ui.ask`가 질문 창을 띄우고 고른 라벨을 받음. `-p`에서는 `AskUserQuestion`이 없어 실패 |

### 결과 — 착수 5번 (2026-09-24, 2.1.281)

| 항목 | 결과 |
|---|---|
| `claude plugin test` | **통과.** 161개. 단계마다 허용 목록·종료 판정·되돌림·사람 질문의 갈래 |
| 판정 에이전트의 프롬프트 교체·foreground (`D125`) | 실제 엔진에서 적용됨 |
| 읽기 전용 git 강화 (`D128`) | 엔진이 훅이 고친 명령을 그대로 돌림 |
| `land`의 git 무력화 (`D134`) | Git for Windows에서 훅·서명이 꺼진 채 커밋됨 |
| 훅의 셸 (`D129`) | `$SHELL`(Git Bash)로 돎. PATH의 `bash`가 WSL이면 실패 |
| aside 출력 (`U58`) | 터미널 실측(2026-09-23, aside 1.26.916) — 세션 ID는 stderr 첫 줄, 판정은 마지막 줄, exit code는 판정 아님 (`D131`) |

### 결과 — 실측 마무리 (2026-09-24, aside 1.26.916)

| 항목 | 결과 |
|---|---|
| 끊긴 CLI의 세션 | `timeout 25s aside exec "..."`가 exit 124로 끝남. 세션 ID는 끊기기 전에 stderr 첫 줄에 찍힘. 세션은 `aside session list`에 `running`으로 남고 갱신 시각이 계속 바뀜 — 브라우저 조작이 이어짐 |
| `aside session stop <ID>` | `interrupted`, exit 0. list에서 `interrupted`가 되고 15초 뒤에도 갱신 없음. 그래서 훅이 직접 멈춤 (`D156`) |
| `$.store` 4 MiB | 넘겨 보지 않고 한계로 둠. store에는 run 기록(run마다 KB 단위)만 있고 `complete`·`drop`이면 지워짐(`D145`·`D148`). 쌓이는 것은 `U44`의 닫힌 세션 기록뿐이라 4 MiB까지 수천 개가 필요함 |
| 직선 한 바퀴 | **대화형 미실행.** headless는 `$.ui.ask`를 못 넘어 `spec` 승인에서 멈춤 — 사람이 돌려야 함 |

### 결과 — e2e 항목 대기 실측 (2026-10-02, aside 1.26.916.1741)

`D172`의 전제. example.com에서 20초 sleep을 6~9번 하는 세션을 `timeout 30s`~`1m`으로 끊고
훅 없이 터미널에서 봄.

| 항목 | 결과 |
|---|---|
| 끊긴 CLI의 세션 | `running`으로 남아 끝까지 돎. 끝나면 `idle`(멈춘 것은 `interrupted`). `completed` 같은 값은 없음 |
| 도는 세션에 `aside session resume <ID> '<문구>'` | 진행 중인 턴을 처음부터 다시 출력하고 끝날 때까지 기다린 뒤 exit 0. 마지막 줄은 원래 턴의 `판정: 통과`. 덧붙인 문구는 버려짐 — `messages.jsonl`의 user 메시지가 1개 그대로 |
| `resume`도 끊은 뒤 | 세션은 `running` 그대로. 다음 `resume`이 다시 붙어 끝까지 기다림 |
| `resume` 출력 첫 줄 | `continuing existing session: <ID>` |
| 끝난(`idle`) 세션에 `resume` | 새 턴이 시작되고 2초 만에 문구대로 `판정: 통과`를 다시 씀 |
| `messages.jsonl` 쓰기 시점 | 도구 호출이 끝날 때만 줄이 늘어남. 20초 sleep 동안은 그대로 (`U75`) |
| `aside session list`의 넷째 칸 | 판정이 아님 — `running`일 때도 "판정: 통과"로 보임(제목) |

### 결과 — aside 권한 실측 (2026-10-03, aside CLI 1.26.916.1741)

`D177`의 전제. 웹사이트를 열지 않고 aside의 `bash`로 Claude Code scratchpad(세션 폴더 밖)에
파일 하나를 쓰게 함. sandbox의 1회 관리자 설정을 마친 PC에서 잼.

| 항목 | 결과 |
|---|---|
| `aside exec --permission full-access` | 질문 없이 쓰기 성공, exit 0 |
| 기본 권한(guard) | `bash`가 sandbox 안에서 돌아 `Access to the path ... is denied.`로 실패. 질문은 뜨지 않음 |
| 실사용 run의 멈춘 세션 (guard) | `bash`(`echo check`) 호출에서 `suspended`, `suspension.kind: ask-user-question` — "Aside needs one-time administrator permission to let sandboxed agent commands access localhost. Set it up now?" (`Allow`·`Cancel`). Aside 앱 화면에만 뜸 |
| CLI의 질문 처리 | `aside exec`는 메시지를 보내고 턴이 끝나기를 기다릴 뿐. CLI 번들에 suspension·`ask-user-question`을 다루는 코드가 없음 — 질문이 출력되지도, 답할 명령도 없음 |
| 설정 전 PC의 full-access | 미확인 (`U77`) |

### 결과 — aside 세션 동시 실행 (2026-10-16, Aside CLI 1.26.1015.732)

e2e 항목을 동시에 돌릴 수 있는지의 전제. `aside exec` 둘을 같은 시각에 띄움 — 각자 다른 호스트의
페이지를 열고 20초 기다린 뒤 두 번째 페이지를 열고 관측·판정 두 줄로 끝냄. 훅 없이 터미널에서,
기본 권한(guard), 로그인 없이.

| 항목 | 결과 |
|---|---|
| 동시 실행 | 9~26초 동안 `aside session list`에 둘 다 `running`. 20초씩 기다린 두 세션이 30초·39초에 끝남 — 차례로였다면 70초 남짓 |
| 탭 | 세션마다 자기 탭을 `tabs[0]`·`tabs[1]`로 부르고, 서로의 페이지를 보지 않음 |
| 출력 | 둘 다 첫 줄 `created new session: <ID>`, 마지막 두 줄 `관측:`·`판정:`, exit 0 |
| 실측하지 않은 것 | 같은 앱에 다른 계정으로 동시 로그인(쿠키를 나눠 씀), full-access로 폴더에 스크린샷 저장, 무거운 화면 여러 개의 자원 경합 |

### 결과 — 긴 `Bash` 출력과 함수 훅 (2026-10-02, Claude Code 2.1.287)

`U74`. `tool.call`에서 `next()`의 결과를 적기만 하는 탐침 플러그인을 `claude -p --plugin-dir`로
띄우고, aside처럼 stderr 첫 줄에 `created new session: <ID>`, 마지막 줄에 `판정: 통과`를 찍는
스크립트(76 KB)를 exit 0과 exit 124로 돌림.

| 항목 | exit 0 | exit 124 |
|---|---|---|
| `isError` | 없음 | `true` |
| `text` | `<persisted-output>` 2KB 미리보기 (2244자) | `Exit code 124`로 시작, 10040자 |
| `result` | 객체. `stdout`은 앞 30000자, `stderr`는 비어 있음(합쳐짐) | 문자열 — `Error: Exit code 124` + 앞 30000자 중 처음 5000자 · `... [20014 characters truncated] ...` · 끝 5000자 |
| 전문 | `result.persistedOutputPath`(`~/.claude/projects/.../tool-results/*.txt`), `persistedOutputSize` 76065 바이트. 훅의 `$.fs.read`로 읽힘 — 마지막 줄 `판정: 통과`까지 | 없음 |
| 세션 ID 줄 | 전문 첫 줄 | 남음 (둘째 줄, `Exit code` 다음) |
| 판정 줄 | 전문 마지막 줄 | 사라짐 |

30000자 이하면 `text`와 `result.stdout`이 같은 전문입니다.

타입 선언은 `/plugin-types`로 저장소의 `.claude/types/`에 뽑습니다. 이 명령도 활성화
변수가 있어야 뜹니다. 생성물이라 커밋하지 않습니다.

Claude Code에는 `claude plugin test <dir>`도 있습니다. 파일 시스템 없이 store·clock을
모의로 둔 환경에서 훅을 시험합니다. `D106`의 검사 스크립트 후보입니다. 시험의 `on`이
플러그인 아래에 깔려 `fs`·`session`·`tool.call`에도 답할 수 있습니다. 엔진은 경로를
플랫폼 형태(Windows면 역슬래시)로 넘깁니다.

## eval — 실제 모델로 run을 끝까지

`claude plugin test`는 모델 없이 훅을 시험합니다. 실제 모델이 run 하나를 spec부터
land까지 끝내는지, 결과 코드가 요청을 채우는지는 `eval/`이 봅니다. 모델 출력은
매번 다르므로 한 번의 성패가 아니라 여러 번 돌린 통과율로 봅니다. 설계와 결정은
이슈 #6에 있습니다.

```sh
cd eval && npm install      # 처음 한 번: Agent SDK
node eval/run.ts                                   # case 전부, 각 3회, 3개씩 동시에
node eval/run.ts order-total --runs 1 --parallel 1 # case 하나, 한 번
```

인증은 `claude setup-token`으로 만든 토큰입니다. `CLAUDE_CODE_OAUTH_TOKEN` 환경변수에
두거나, 저장소 밖 파일 `~/.rein-eval-token`에 저장합니다.

| | |
|---|---|
| fixture | `eval/fixture/` — 의존성 없는 Node 앱. 주문·회원 목록 화면, `node --test`, config에는 `qa`만 (e2e 없음) |
| case | `eval/cases/<이름>/` — `request.md`(요청), `intent.md`(요청자의 진짜 의도), `accept.test.js`(숨긴 인수 테스트) |
| 실행 | run마다 fixture를 임시 폴더에 복사하고 커밋한 뒤 `/rein:autopilot <요청>`으로 세션을 띄움. 플러그인은 `eval/`을 뺀 사본으로 불러 모델이 인수 테스트를 못 봄 |
| 격리 | 세션의 `USERPROFILE`·`HOME`을 run마다 임시 폴더로 둠. 실제 `~/.rein`·허브에 닿지 않음. 사용자 설정·MCP는 `settingSources: []`, `strictMcpConfig: true`로 막음 |
| spec 질문 | 사용자 시뮬레이터(Haiku)가 `intent.md`만 근거로 답함. 문서가 정하지 않은 것은 「나중에 정하자」 |
| 화면 배치 | run이 `layout-unchecked`로 사람을 기다리면 러너가 사람 대신 `5-checklist.md`의 배치 칸을 체크하고 같은 세션에 `/rein:land`를 보냄. 배치가 실제로 맞는지는 판정하지 않음 |
| 통과 | run 폴더가 `complete/`이고 trace에 `land → 닫힘`, `halt`(러너가 대답한 `layout-unchecked` 빼고)·`error` 없음, 커밋 하나 이상, land가 남긴 코드에서 `accept.test.js` 통과 |
| 결과 | `eval/results/<시각>/summary.md`(표)와 run마다 트랜스크립트·시뮬레이터 기록·run 폴더 사본·`diff.patch`·인수 테스트 출력. 커밋하지 않음 |

case를 더할 때 인수 테스트는 `createServer()`로 서버를 띄워 HTTP 응답만 봅니다.
모델이 새로 만들 함수 이름에 기대면 맞게 고친 run도 실패합니다.

### 회고 eval

eval run은 작아서 회고가 긴 run의 중간을 놓치는지(이슈 #8)는 볼 수 없습니다.
`eval/retro.ts`는 긴 run을 지어내 회고만 돌립니다.

```sh
node eval/retro.ts                  # 한 번
node eval/retro.ts --runs 3 --parallel 3
node eval/retro.ts --build <폴더>   # run만 만들어 봄 (<폴더>를 홈으로)
```

| | |
|---|---|
| run | 닫힌 run 하나를 매번 똑같이 만듦: trace 10개(각 3MB, 대부분 통과 줄), `e2e.md` 약 1.1MB, `fails.md` 약 370KB, 대화 기록 약 13MB(사용자 메시지 100여 개) |
| 심은 일 | 원인 6개를 앞·중간·끝에 흩어 둠: 같은 거부 반복(첫날과 넷째 날 두 곳, 같은 원인), qa 재실행에 「왜」, review 실패와 사용자가 말한 룰, e2e 라운드 반복 실패와 사용자가 설명한 데이터, 배치 확인 불평, 포트 충돌과 사용자가 알려 준 포트 |
| 실행 | 훅이 run을 닫을 때 하는 말 그대로 `/rein:retro`를 부름. 사용자 선택 질문은 닫음(후보는 `후보`로 남음) |
| 판정 | Sonnet이 `retro.md`와 reader 메모를 읽고 원인마다 나왔는지 판정. 원인 6개가 모두 `retro.md`에 있고, 두 곳의 같은 거부가 한 항목으로 합쳐지면 통과. 메모에 없는 원인은 「메모 없음」으로 따로 표시해 reader와 회고 가운데 어디서 빠졌는지 가름 |
| 결과 | `eval/results/retro-<시각>/summary.md`와 run마다 트랜스크립트, `retro.md`, `notes.md`(reader 메모), `verdicts.json` |

## 남은 일

GitHub Issues에서 관리합니다.
