---
name: update
description: 설치된 Rein 플러그인을 최신 릴리스로 업데이트한다(마켓플레이스 갱신 뒤 설치 scope로 plugin update). 사용자가 /rein:update를 입력했을 때만 사용.
disable-model-invocation: true
---

# update

The session-start notice points here. The script below already ran when this skill loaded:

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/plugin-update.js"`

Report its result to the user in one or two lines. If it updated the plugin, tell them to run `/reload-plugins`: the running session keeps the old version until then. If it failed, show the failing line and stop; do not retry or run other commands.

