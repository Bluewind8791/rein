# Claude Code Mod

Rein은 **Mod**로 만듭니다 (`D33`). 셸 스크립트를 부르는 고전 훅 대신 엔진 이벤트에
함수로 끼어듭니다.

이 문서는 조사 기록입니다. 2026-09-22 기준이고, Mod는 early access라 바뀔 수 있습니다.

## Mod란 무엇인가

2026-09-18, Claude Code v2.1.277에 들어갔습니다. 발표는 이슈
[#91870](https://github.com/anthropics/claude-code/issues/91870)의 **본문**에
있습니다 — 코멘트가 아니라 본문 맨 위의 "Community Update: Sep 9, 2026" 절이고,
본문을 갱신하는 방식으로 쓰입니다.

> from a product perspective, we are going to be calling this functionality
> "Claude Mods". The engineering term of art 'function hook' will still exist as
> the documented implementation primitive Mods are built on. A mod is just a
> plugin that uses function hooks, nothing is changing there.

API 설명은 이렇습니다.

> A mod is a Claude Code plugin whose behaviour lives in a hooks module: one
> `register(on, options)` entry that hooks the engine's events as functions
> `($, e, next)`.

플러그인의 한 종류입니다. 배포 경로(`D5`~`D8`)는 그대로 쓸 수 있습니다.

## 고전 훅과의 차이

| | 고전 훅 | 함수 훅 (Mod) |
|---|---|---|
| 실행 | 별도 프로세스. 셸 명령 | 엔진 안. 샌드박스된 모듈 |
| 언어 | 무엇이든 | TypeScript |
| 대화 컨텍스트 | 못 봄 | **`$.session.messages()`로 읽음** |
| 상태 보관 | 직접 만들어야 함 | **`$.store`** |
| 이벤트 | 정해진 몇 개 | 아래 목록 |
| 합성 | 없음 | `next`로 체인. 감싸고, 막고, 결과를 고침 |

## 파일 구조

```
rein/
├── .claude-plugin/
│   └── plugin.json          name, version, description, userConfig
└── hooks/
    ├── hooks.json           { "description": "...", "modules": ["./register.ts"] }
    └── register.ts          export function register(on, options): void
```

`register.ts`가 진입점입니다.

```typescript
import type { On, PluginOptions } from 'claude-code'

export function register(on: On, options: PluginOptions): void {
  on("tool.check", { tool: "Read" }, () => ({ decision: "allow" }))
}
```

`plugin.json`의 `userConfig`로 사용자가 고를 수 있는 설정을 선언합니다. 타입, 기본값,
선택지를 적을 수 있습니다.

## 이벤트

타입 선언(`mods/types/claude-code.d.ts`)에서 확인한 목록입니다.

```
engine.create
session.start   session.attach   session.end
session.compact session.receive  session.measure
turn.start      turn.complete
tool.call       tool.check       tool.describe
agent.offer     agent.spawn
prompt.context  prompt.edit      prompt.section
prompt.suggest  prompt.fill      prompt.attachment
command.register command.run     command.describe
skill.prompt    config.set       config.describe
plugin.register attribution.text
ui.render  ui.open  ui.close  ui.input  ui.press  ui.select  ui.focus  ui.scroll
```

`ui.close`는 `main`의 선언 파일에 없어 설치된 CLI 바이너리에서 복원했습니다
(2026-10-07, `U39`).

### 같은 이벤트를 두 번 걸려면 matcher가 있어야 한다

`on("tool.call", hook)`을 두 번 등록하면 모듈이 아예 안 올라갑니다.

```
on("tool.call") is registered twice without a matcher; the first is at <path>:<line>
```

`on(pattern, matcher, hook)` 3인자 형태가 있고, matcher는 훅 인자 위의 객체입니다 —
`{ tool: /./ }`는 모든 도구 호출을 받습니다. 값으로 RegExp가 들어갑니다.

등록 순서가 바깥 순서입니다. 먼저 등록한 훅이 나중 것을 감싸고, 그 훅의 `next(e)`가
나중 훅입니다. Rein은 이것으로 판정하는 `tool.call`을 칩 집계 훅으로 감쌉니다 — 그래야
훅 자신이 거부한 호출도 `next(e)`의 결과로 보입니다 (`D202`).

### Rein에 쓸 것들

**`tool.call`** — 엔진이 도구를 실행하기 직전.

> Return `{ deny: reason }` to refuse or `{ result }` to answer yourself; a hook
> that returns while its `next` is pending aborts what runs beneath.

**`tool.check`** — 같은 체인을 돌리되 아무것도 실행하지 않음. `{ decision }` 반환.

**`agent.spawn`** — Agent 도구가 서브에이전트를 시작하기 직전.

> everything decided and its model not yet resolved. `next(e)` resolves to
> `{ model }`. Return it, `next({ ...e, model })`, `{ model }` of your own,
> or `{ deny: reason }`.

**`agent.offer`** — `{ isOffered: false }`를 반환하면 그 에이전트 타입을 목록에서
빼고 호출도 거부합니다. 모델에게 숨기고 하네스만 띄울 수 있습니다.

**`prompt.context`** — 대화의 첫 사용자 메시지가 지고 가는 컨텍스트 블록. 추가·삭제·
재배열·재작성이 됩니다.

**`command.register`** — 커맨드 등록 (`U7`).

**`ui.render`** — 엔진이 컴포넌트를 그리기 직전. 한 번의 입력값(props, 뷰포트 폭)마다
한 번, 그리고 `$.ui.invalidate("ui.render")`마다 발화합니다. 한 플러그인의 invalidate는
100 ms에 한 번으로 접힙니다.

훅 인자는 `surface`(`terminal`·`desktop`·`mobile`·`vscode`)와 `component`를 지고,
뷰포트 `columns`·`rows`가 같이 옵니다. 그릴 수 있는 자리(render site)는 열다섯입니다 —
`AskUserQuestion` · `UserMessage` · `AssistantMessage` · `ToolUse` · `ToolResult` ·
`ToolGroup` · `ToolProgress` · `CommandOutput` · `Spinner` · `TurnDuration` ·
`InfoNotice` · `SessionMode` · `PromptHint` · `AbovePrompt` · `Pane`.

진행 상황 표시에 쓸 컴포넌트는 `Pane`입니다 (`D193`).

### 훅이 받는 것

실측한 인자입니다 (2026-10-07, 터미널 70줄 × 91칸).

```
{ surface: "terminal",
  component: "Pane",
  viewport: { columns: 91, rows: 70, isFullscreen: true },
  requestId: "uiprobe",
  props: { title: "ui probe", isFocused: true, bodyColumns: 48,
           placement: "dock", scroll: { offset: 0, bodyRows: 60 }, view: {} } }
```

인스턴스를 가리키는 칸은 `requestId`입니다 — 와이어 스키마의 이름(`instance_id`)과
다릅니다. `AbovePrompt`의 `props`는 `{ hasSurvey, isWorking, maxRows, bodyColumns,
scroll, view }`이고 `maxRows`는 터미널 높이를 따라갑니다 (70줄에서 26, 42줄에서 12).

`$.ui.resolve(e)`가 그 surface의 엘리먼트 생성자 표를 줍니다. 실제로는 surface와
무관하게 열둘이 다 옵니다 — 터미널이 안 받는 `Svg`까지 들어 있으므로 쓸 것만 골라
써야 합니다.

`next(e)`가 주는 엔진의 기본 트리는 `{ type: "engine", ref: <번호> }`라는 불투명
핸들입니다. 그대로 돌려주면 엔진이 평소대로 그립니다. 훅이 자기 트리를 돌려주면 그것이
그려집니다.

headless(`claude -p`)에서는 `ui.render`가 발화하지 않습니다. 그릴 surface가 없기
때문이고, `D105`가 이 자리만 사람에게 맡긴 이유입니다. `$.ui.open`은 headless에서도
불리고 `{ isPlaced: true }`를 돌려줍니다.

### 엘리먼트

터미널 surface가 받는 엘리먼트는 열하나입니다 — `Box` · `Text` · `Button` · `Input` ·
`Select` · `Link` · `Code` · `Markdown` · `Client` · `Raster` · `Image`. desktop·vscode는
`Raster`·`Image` 대신 `Svg`를 받고, mobile은 `Input`·`Select`·`Client`가 없습니다.

`Box`는 레이아웃 props를 받습니다. `key`는 hover 범위를 만들고, `position`이
`"absolute"`면 정수 셀 오프셋 `top`·`left`·`right`·`bottom`으로 주변 위에 겹쳐 놓입니다
— 흐름 밖입니다. 셀 좌표로 직접 찍을 수 있다는 뜻이라 카드와 간선을 그릴 수 있습니다
(`D194`).

`Button`은 `key`(주소, `ui.press`가 `element`로 지고 옴), `label`, `hotkey`(숫자 하나나
소문자 하나), `action`(엔진 키바인딩 이름), `plain`, `dimColor`, `variant`, `role`,
`autoFocus`를 받습니다. `Input`·`Select`는 `ui.input`·`ui.select` 훅으로 돌아옵니다.

`Client`는 샌드박스 안에서 도는 **서피스 모듈**입니다. `$`도 훅도 못 보고, 자기
`state`·`setState`, `columns`·`rows`, `every(ms, fn)` 타이머, `onPointer`, `onKey`,
`post`를 가집니다. 자기 엘리먼트 표는 `Box`·`Text`·`Button`·`Input`·`Select`·`Link`·
`Code`·`Markdown` 여덟이고 `Client`·`Raster`·`Image`는 안 중첩됩니다. 훅을 왕복하지
않고 애니메이션과 키 입력을 처리하는 자리입니다 (`D196`).

props는 `key`(인스턴스 주소 — 이 키가 트리에 남아 있는 동안 엔진이 인스턴스를 상태와
타이머째로 유지합니다), `module`, `props`(JSON 10만 자까지), `width`·`height`·`flexGrow`
입니다. `module`은 **그 리터럴이 적힌 파일 기준 상대 경로이고 소스에서 그대로 읽히는
문자열이라야 합니다** — 변수면 로드 때 거부되고, 플러그인 밖이나 없는 파일도 거부됩니다.
그리는 것은 default export이거나 PascalCase export 하나입니다. 모듈이 자기 쪽에서
플러그인의 다른 파일을 `import`하는 것은 됩니다 (Rein의 `clock.ts`가 `pane.ts`의
`fmtDur`를 가져다 씁니다). 함수는 `(props, surface)`를 받고, 새 props·`setState`·리사이즈
마다 다시 불립니다. `every(ms, fn)`는 `state`가 아직 `undefined`일 때 한 번만 걸라고
선언에 적혀 있습니다. 샌드박스는 `$`를 못 보므로 시각은 `Date.now()`로 직접 읽습니다 —
훅의 `$.clock`과는 다른 시계입니다 (`D204`).

### `Raster`·`Image`·`$.ui.blit`

터미널에 글자 말고도 넣을 수 있습니다.

`Raster`는 셀 격자입니다. `key`·`columns`(1~512)·`rows`(1~256)와 `cells`를 받고,
`cells`는 `columns * rows`개의 little-endian u32 삼중항 `[코드포인트, 전경, 배경]`을
표준 패딩 base64로 적은 것입니다. 색은 `0x00RRGGBB`(트루컬러)이거나 `0x01000000`(24비트만
켬)이면 터미널 기본색입니다. **코드포인트는 폭 1짜리 출력 가능한 BMP 글자 하나여야 합니다** —
블록·박스 문자·브라유는 되고, 한글처럼 두 칸짜리는 트리가 거부되며 거부 메시지가 그 셀의
번호를 말합니다. 셀마다 전경과 배경이 따로라 `Text`로는 못 하는 위계(채운 몸통 + 흐린
테두리 + 밝은 제목)가 나옵니다 (`D205`).

`Image`는 진짜 그림입니다. `source`는 `{ png }`나 `{ rgba, width, height }` 바이트(디코드
2 MiB까지), 또는 이 기계의 파일이나 POSIX 공유 메모리 이름입니다. `columns`·`rows`(각
1~255)에 맞춰 늘어나고, 터미널이 못 그리면 `alt`가 흐리게 대신 뜹니다.

`$.ui.blit({ requestId, key, cells })`는 트리를 다시 안 보내고 그 `Raster` 한 장만 다시
칠합니다(키 붙은 `Image`면 그림을 바꿉니다). 선언 파일의 예제가
`$.clock.every(33, () => $.ui.blit({ requestId, key, cells: frame() }))`이므로 초당 30장이
상정된 길입니다 — `Client` 없이 훅에서 애니메이션을 돌리는 두 번째 길이지만, 훅이 매 프레임
깨는 값은 `D196`이 따진 그대로입니다.

### 사람의 테마 읽기

`$.config.list()`가 `/config` 메뉴의 행들을 주고, 그중 `theme` 행의 값이 사람이 고른
테마입니다. `Text`의 색은 테마 키(`text`·`subtle`·`success`…)를 받아 알아서 따라가지만
`Raster`는 RGB를 직접 적어야 하므로, 밝은 테마와 어두운 테마를 가르려면 이 행을 읽어야
합니다 (`D205`).

### `AbovePrompt`

> The band directly above the prompt input, where the surveys draw; the engine
> draws nothing of its own here.

밴드는 여는 동작이 없습니다. 훅만 달면 상주합니다. 터미널 surface에서만 뜨고,
사람이 `ctrl+x ctrl+a`로 접을 수 있습니다. 다시 그리기는 초당 30회까지입니다.

### `Pane`

`$.ui.open({ id, title, rows, columns, focus, close_on_escape, hold_toasts })`으로 엽니다.
훅만 열 수 있고 사람은 닫기만 합니다.

| | |
|---|---|
| `id` | 글자·숫자·`_`·`-` 1~64자. `Pane`의 `ui.render`가 `requestId`로 지고 옴 |
| `title` | 탭 이름. 없으면 `id` |
| `rows` | inline일 때 본문 줄 수 **요청** — 사람의 크기 조절이 이김 |
| `columns` | dock일 때 본문 칸 수 **요청** — 마찬가지 |
| `focus` | 서 있는 요청. 컴포저가 비어 있고 한가하고 대화상자가 없을 때만 받아들여짐 |
| `close_on_escape` | Escape가 사람의 닫기와 같게 동작 |
| `hold_toasts` | 이 Pane이 보이는 동안 toast를 모아 뒀다가 닫힐 때 보여 줌 |

여럿 열리면 탭이 되고, 보이는 것은 마지막으로 열거나 포커스된 것입니다 — 사람이 쥔
것은 엔진이 안 밀어냅니다. `$.ui.scroll`(`to: "end"` 또는 `to: { key }`), `$.ui.focus`,
`$.ui.close`가 있습니다.

위치는 못 고릅니다 — props의 `placement`가 읽기 전용이고, 값은 `dock`(풀스크린일 때
트랜스크립트 옆)과 `inline`(그 밖, 프롬프트 위) 둘뿐입니다. 화면 상단에 앉히는 값은
없습니다.

엔진이 `placement`를 고르는 식은 `<fill> ? "dock" : "inline"`이고, `<fill>`은 그 Pane이
오른쪽 dock 안에 그려졌는지입니다. **터미널에서 그것을 가르는 것은 창의 폭뿐입니다.**
바이너리의 `dockColumns`가 그 자리입니다.

```js
var vX = 110
function dockColumns(columns, { chosen, requested }) {
  let narrow = columns < vX
  let clamp = (n) => Math.min(columns - 24, Math.max(24, n))
  return narrow ? 0 : chosen !== undefined ? clamp(chosen) : requested !== undefined ? clamp(requested) : natural(columns)
}
var natural = (columns) => Math.min(Math.floor(columns * 0.45), 90, columns - 70)
```

**110칸 미만이면 dock 폭이 0이라 dock 자체가 없고**, Pane은 프롬프트 위 inline으로
갑니다. 110칸 이상이면 오른쪽에 붙고 폭은 `min(45%, 90, 폭 - 70)`이며 최소 24칸,
최대 `폭 - 24`입니다. 사람이 그립을 끌거나 `pane:grow`·`pane:shrink`로 바꿀 수 있지만
24칸 밑으로는 못 줄이므로 dock을 없앨 수는 없습니다. 플러그인은 어느 쪽인지 고를 수
없고 알 수만 있습니다 — dock이면 `$.ui.open`의 `columns`가, inline이면 `rows`가 들어
주는 요청입니다. inline 높이는 `inlineRows`가 `min(요청, max(행/3, 행 - 11))`로 잡고
최소 5줄입니다.

놓이는지 자체는 누가 열었는지에 달려 있습니다 (2.1.311 실측). 사람이 입력한 명령·프롬프트나
누른 버튼 뒤의 `$.ui.open`은 폭과 상관없이 놓입니다. 플러그인이 스스로 연 것(모델이 부른
도구, 타이머, `session.start`, 대기열에 들어간 프롬프트)은 **144칸 이상**에서만 놓이고, 사람이
그 id를 한 번 연 뒤로는(`~/.claude.json`의 `pluginPanes.asked`, 손으로 닫으면 지워짐) 110칸
이상에서 놓입니다. 그보다 좁으면 열린 채 그려지지 않고 기다리며(`isPlaced: false`)
`ui.render`도 오지 않습니다. Rein은 `open_run`·`resume` 도구 안에서 열기 때문에 스스로 연
것이 되고, 그래서 놓이지 않은 Pane은 사람의 다음 프롬프트(`prompt.submit`)에서 다시 엽니다.

inline과 dock은 본문 높이를 다르게 잡습니다. 엔진은 `io = fill ? To : Math.min(To, ct)`로
정하는데, `ct`가 본문 내용의 측정된 높이입니다. dock은 준 높이를 그대로 쓰지만 **inline은
내용만큼만 높습니다** — 그래서 트리의 최상위가 `position: "absolute"`뿐이면(절대 배치는
레이아웃 높이에 안 잡힙니다) 본문이 0줄로 접히고 테두리만 남습니다. 흐름 배치 자식이
하나는 있어야 합니다 (`D205`).

`e.viewport.isFullscreen`은 다른 값입니다. 설명은 "Whether this surface docks a pane
beside the transcript, so a pane a plugin opens unasked is a sidebar and not a takeover"
이고, desktop·mobile·vscode가 `ui_attach`로 알려 주는 것입니다. 터미널의 dock 여부와는
상관이 없습니다 — 앞선 실측에서 이 둘을 같은 것으로 적었던 것을 고칩니다.

사람이 Pane을 닫으면 `ui.close` 훅이 발화합니다. 인자는 `{ id, origin }`이고
`origin.kind`는 `person`·`plugin`·`unload` 셋입니다. 훅이 열어 둔 채로 버틸 수 있습니다 —
그러면 엔진이 `ui.close <id> (<kind>): kept open by a hook`을 찍고 와이어의 `ui_close`가
`closed: false`를 돌려줍니다. Rein은 버티지 않고, 사람이 닫은 것만 run 기록에 적습니다
(`D197`).

### 트리를 거치지 않는 셋

`$.ui.status(text)`는 프롬프트 아래에 플러그인마다 한 줄을 고정합니다 — 다음 호출이
갈아 끼우고 `null`이 지웁니다. `$.ui.toast(text)`는 알림 바에 몇 초 띄웁니다
(`timeoutMs`, 기본 4000). `$.ui.log(text)`는 트랜스크립트에 흐린 알림 한 줄을 붙이며
모델에게는 안 갑니다. 셋 다 본문 1만 자까지입니다.

> 엘리먼트와 `Pane`의 옵션은 `/plugin-types`가 안 떠서(`U39`) 설치된 CLI
> 바이너리에서 복원했고, 훅이 받는 인자와 크기는 탐침으로 실측했습니다
> (2026-10-07). `U80` 참고.

## 엔진 인터페이스 `$`

### `$.session`

| | |
|---|---|
| `messages()` | 트랜스크립트. `{ role, text, toolUses }`. 긴 대화는 최신 4096개 |
| `id()` | 세션 id (트랜스크립트 파일 이름) |
| `cwd()` | 세션 작업 디렉토리 (절대경로) |
| `root()` | 프로젝트 루트. `/cd`나 워크트리 이동을 반영 |
| `model()` | 메인 루프 모델 |
| `turns()` | 사용자가 보낸 프롬프트 수 |
| `repo()` | git 저장소 정보. 아니면 `null` |

### `$.store`

플러그인 전용 JSON 파일. 사용자의 Claude Code 설정 디렉토리 아래.

| | |
|---|---|
| `get(key)` | 값 또는 `undefined` |
| `set(key, value)` | JSON 데이터만. `JSON.parse(JSON.stringify(value))`로 읽힘 |
| `delete(key)` | 제거 |
| 한계 | JSON 텍스트 전체 4 MiB |

### `$.agent`

| | |
|---|---|
| `spawn({ subagentType, prompt, description })` | `{ agentId, deny }` 반환 |
| `register(spec)` | 에이전트를 동적으로 등록 |

### 그 밖

`$.fs`(엔진 프로세스가 보는 파일 시스템, 읽기·쓰기 4 MiB 제한), `$.env`, `$.telemetry`,
`$.ui`, `$.command`, `$.clock`.

## Rein의 미결에 주는 것

| Rein 항목 | Mod가 주는 것 |
|---|---|
| `C1` 훅이 대화 컨텍스트를 못 봄 | **뒤집힘.** `$.session.messages()` — `C1` 참고 |
| `U3` 단계 정보를 훅에 어떻게 전달 | `$.store` |
| `C6` 상태가 작업 단위여야 함 | `$.store` 키를 (세션, 작업)으로 |
| `U4` 훅이 무엇을 차단 | `tool.call`의 `{ deny }`, `tool.check`의 `{ decision }` |
| `D20`·`D23` 모델 등급 | `agent.spawn`에서 코드로 결정 가능 — 호출 지점마다 다른 등급을 주려면 이쪽. 같은 값이면 frontmatter `model:`로 충분 (`D189`, `D190`) |
| `D31` master | `$.agent.spawn()`으로 하네스가 직접 띄움 |
| `D16` 작업 병렬 | `agent.offer`로 작업 에이전트를 모델에게 숨김 |
| `U7` 커맨드 | `command.register` |
| `U41` 진행 상황 표시 | `Pane` + `ui.render`. `Box`의 절대 위치로 카드와 간선, `Client`로 애니메이션 (`D193`~`D197`). 위치를 엔진이 정해(위 「위치는 못 고릅니다」) 지금은 쓰지 않음 — Herdr App 레이아웃의 `rein` mod 블록으로 옮겼다가, 지금은 프레임 페이지가 보여 줌 (`frame/`, `hooks/lib/pane.ts`) |
| `U9` 프로젝트별 차이 | `plugin.json`의 `userConfig` |
| 세션 구분 (워크트리 이름) | `$.session.id()` |

`agent.offer` + `$.agent.spawn` 조합이 `D3`(훅으로 차단)의 성격을 바꿉니다. "모델이
잘못된 도구를 쓰면 막는다"가 아니라 **모델에게 선택지를 주지 않고 하네스가 직접
띄우는** 방식이 가능합니다.

## 대가

**Early access.** README 원문입니다.

> hooks modules load only where function hooks are enabled, and the API these
> mods are written against may change between releases without notice.

활성화는 환경변수입니다. Anthropic이 이슈 본문에서 직접 밝힌 것입니다.

> I may now publicly acknowledge that any folks who want to test and give
> feedback may use `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`.

**단, 이 문장은 2026-09-09 것이고 출시는 09-18입니다.** 출시 후에도 이 변수가 필요한지는
확인되지 않았습니다. 시험 참가자용 안내였기 때문입니다. 올린 뒤 직접 확인해야 합니다.

**API가 예고 없이 바뀝니다.** `D8`에서 `version`을 명시하기로 한 것이 여기서 더
중요해집니다. 타입 선언도 업그레이드마다 다시 받아야 합니다.

**TypeScript 고정.** 지금까지 설계는 언어 무관이었습니다.

**샌드박스.** Node.js도 DOM도 없습니다. 엔진 인터페이스로만 움직입니다.

**`C5`가 깊어집니다.** 하네스가 깨지면 하네스 수정도 막히는 문제인데, in-process라
더 깊이 박힙니다.

**실패 모드를 직접 시험해야 합니다.** 참고한 분석의 경고입니다 — *"never infer
fail-closed behavior from a normal successful run."*

## 내장 Mod 네 개

Anthropic이 공개한 것들입니다. 작성 방식의 참고 자료가 됩니다.

| | 하는 일 |
|---|---|
| `sec-default` | 조직의 고전 훅·프롬프트·관리 설정·도구 정책을 설치된 플러그인에서 격리. 가장 바깥에 앉음 |
| `diff` | `/diff` 커맨드. 세션의 커밋되지 않은 변경을 트랜스크립트 옆 창에 표시 |
| `telemetry` | `$.telemetry` 제공. 설치된 플러그인은 거부 |
| `agents-md` | `AGENTS.md`를 프로젝트 지시로 로드. `userConfig`로 네 가지 모드 |

## 확인 방법

### Mod는 stable 채널에 없다

2026-09-22 확인 결과입니다.

```
$ npm view @anthropic-ai/claude-code dist-tags
{ stable: '2.1.267', latest: '2.1.278', next: '2.1.278' }
```

2.1.277·278이 배포돼 있는데도 `stable` 태그는 267을 가리킵니다. 그래서
`claude update`는 "up to date (2.1.267)"라고 답합니다 — stable만 따라가기 때문입니다.

채널을 옮겨야 합니다.

```
claude install latest
```

**이건 개발 기간 중의 조건으로만 봅니다** (`D34`). 개발이 끝날 즈음이면 stable에
올라와 있을 것으로 전제합니다. 배포 요구사항으로 문서화하지 않습니다.

전제가 틀리면 — stable에 끝내 안 올라오거나 API가 크게 바뀌면 — `D33`을 다시 판단해야
합니다 (`C8`).

### 버전 확인

```
claude --version
```

2.1.277 이상이어야 합니다. **2.1.267**은 Mod를 지원하지 않았습니다.
2026-09-23에 **2.1.280**에서도 활성화 변수가 여전히 필요했습니다 (`U39`).
2026-10-14 기준 `stable` 2.1.287과 `latest` 2.1.299는 변수 없이 켜집니다.

변수 없이는 `/plugin-types`도 안 뜹니다. 셸 인자로는 안 되고 `claude -p "/plugin-types"`를
변수와 함께 돌리면 작업 디렉터리의 `.claude/types/`에 씁니다. Git Bash에서는 `/`로 시작하는
인자가 경로로 바뀌므로 PowerShell에서 돌립니다.

`claude plugin validate <dir>`은 엔진이 읽는 방식대로 매니페스트와 훅 모듈을 읽고, 무엇을
훅하고 무엇을 부르는지, 어떤 환경변수를 읽는지 보고합니다. `claude plugin test <dir>`은
`*.test.ts`를 파일 시스템 없는 환경에서 돌립니다.

**시험 키트는 render site를 올려 그려진 트리를 받아 볼 수 있습니다.** `mock`은
`clock`·`store`·`env`를 주고, 시험 쪽 `$.ui`는 `render`·`scroll`·`focus`·`press`·`input`·
`select`·`mount`를 가집니다.

```ts
const pane = await $.ui.mount({ plugin, surface, component, props, requestId, viewport })
const tree = await pane.drawn()
```

`mount`가 주는 것은 `surface`·`drawn`·`find`·`findAll`·`press`·`input`·`select`·`key`·
`pointer`·`post`·`advance`·`resize`·`redraw`·`unmount`이고, `drawn()`은 트리를 그대로 데이터로
돌려줍니다. 시험 세계가 `ui.render`의 바닥을 깔아 둬야 합니다 —
`on("ui.render", () => ({ type: "engine", ref: 1 }))`가 없으면
`no implementation for ui.render`로 끝납니다. `$.ui.open`과 `$.ui.invalidate`도 마찬가지로
바닥이 필요합니다.

**시험 키트는 `Client`도 돌립니다.** `mount`는 트리 안의 모든 `Client`가 한 번 그릴
때까지 기다렸다가 돌아오고, 모듈이 실패하거나 아무것도 안 그리면 거절합니다.
`drawn({ in: <Client의 key> })`가 그 모듈이 그린 트리를, `find`·`findAll`의 `in`이 그 안의
엘리먼트를 줍니다. `advance(ms)`가 `every(ms, fn)` 타이머를 그만큼 돌리고,
`key`·`pointer`·`post`·`resize`도 `Client`에 닿습니다. 다만 `advance`가 옮기는 것은
**그리기의 프레임 시계뿐이고 `Date.now()`는 안 옮깁니다** — 모듈이 그린 시간의 값은
시험이 못 고정하고 모양만 봅니다 (`D204`).

못 모는 것은 `ui.close`입니다. 시험 쪽 `$.ui`에 `close`가 없고 `unmount()`는 그 이벤트를
올리지 않습니다. headless에서 `ui.render`가 발화하지 않는다는 것과 별개로, 시험 키트
안에서는 트리도 `Client` 안도 그대로 재볼 수 있다는 뜻입니다 (`D199` ②가 깨진 이유,
`D204`).

**`$.fs`에는 덧붙이기가 없습니다** — `read`·`write`(전체 교체)·`list`·`exists`·`stat`·
`ancestors`. 절대 경로는 작업 디렉터리 밖도 됩니다 (`U59`).

**타입 선언은 웹이 아니라 로컬에서 뽑습니다.**

```
/plugin-types
```

설치된 버전 기준으로 `claude-code.d.ts`를 생성합니다. API가 릴리스마다 바뀌므로 GitHub
`main`의 선언 파일보다 이쪽이 정확합니다. 이 문서의 이벤트 목록은 `main`에서 받은
것이라 설치 버전과 다를 수 있습니다.

## 남은 일

GitHub Issues에서 관리합니다.

## 출처

공식 문서는 아직 없습니다. 순서대로 봅니다.

| | 무엇 |
|---|---|
| 1 | [이슈 #91870](https://github.com/anthropics/claude-code/issues/91870) — 사실상 공식 발표문. **본문 맨 위** "Community Update: Sep 9, 2026". 명칭 확정, 빌트인 mod 위치, v267/v268 affordance 치트시트, 활성화 환경변수 |
| 2 | [mods/README.md](https://github.com/anthropics/claude-code/blob/main/mods/README.md) — 현재 유일한 공식 API 설명서. `register(on, options)`, `($, e, next)`, `$` noun 규칙, early access 경고 |
| 3 | [빌트인 mod 소스](https://github.com/anthropics/claude-code/tree/main/mods) — 문서가 얇아 실질 레퍼런스. `agents-md`, `diff`, `telemetry`, `sec-default` |
| 4 | `/plugin-types` — 설치된 버전 기준 `claude-code.d.ts` 생성. 웹보다 정확 |
| 5 | [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — `plugin.json`, `hooks.json`의 `modules`, 배포 구조 |

설계 배경은 이슈 본문의 [아키텍처 문서](https://github.com/user-attachments/files/31802150/EXTERNAL.Function.Hooks.Core.Architecture.pdf)에
있습니다. 등록 순서 기반 `next` 연속 모델(Express·Koa 계열), `$`를 통한 부작용 추적,
React 컴포넌트 후킹, 관리자가 `$`에서 affordance를 제거하면 아래 계층이 그걸 호출할 수
없게 되는 권한 모델이 핵심입니다.

이 문서의 이벤트 목록과 `$` API는 `main` 브랜치의 `claude-code.d.ts`에서 직접 추출했습니다.
3자 자료는 아래 둘이며, 위 내용과 겹치는 부분의 교차 확인에만 썼습니다.

- [Claude Mods: Setup, Function Hooks and Security — Wavect](https://wavect.io/blog/claude-mods-function-hooks/)
- [Claude Code Mods and agents.md — MindStudio](https://www.mindstudio.ai/blog/claude-code-mods-agents-md)
