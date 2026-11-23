---
slug: <runId>
유형: <feature | bugfix | improvement>
목표: <one line: what the user gets when this is done>
작성일: <YYYY-MM-DD>
참조: "<issue or ticket number, or 없음>"
---

# <one-line title>

## 문제

<what is wrong and why>

## 전제 확인

- <a claim of the request> — <what was checked> → <what the code says, path:line>

## 화면

| id | 이름 | URL | 진입 파일 | 종류 |
|---|---|---|---|---|
| <screen code> | <screen name> | <URL, or -> | <entry file, or -> | <변경, 새 화면, or 새 화면, 따를 화면 <id>> |

## 현행 동작

<how it works now, relevant files as path:line; the edge cases found, handled or not, as path:line>

## 완료 판정

<one line>

## 영향 범위

- `<path>` — <what relies on the code to change, and how>

## 범위

| 구성 요소 | 상태 | 근거 |
|---|---|---|
| 화면·UI | <대상, or 제외 (<why>)> | <path:line or what was checked> |
| API·엔드포인트 | | |
| 데이터 스키마·마이그레이션 | | |
| 배치·예약 작업 | | |
| 권한·설정 | | |
| 내보내기·보고서 | | |
| 외부 연동 | | |

## 기획서 대조

원본: `brief/<file name of the copy>` (p.<first printed page>~p.<last> = <first file page>~<last>쪽)
- p.<n> <one requirement of the document> — 포함
- p.<n> <one requirement> — 변경: <what instead> (사용자, <YYYY-MM-DD>)
- p.<n> <one requirement> — 제외 (사용자, <YYYY-MM-DD>: <why>)
- p.<n> <one requirement> — [?] <what is undecided>

원본: `brief/paste-<n>.png`
- <one requirement of the pasted image> — 포함

## 결정 트리

- Q1 <a decision the user makes> — 선행: 없음 — 위치: <section> — 결정: <the answer> (사용자, <YYYY-MM-DD>)
- Q2 <a decision resting on Q1> — 선행: Q1 — 위치: <section> — 열림
- Q3 <a decision an answer made unneeded> — 선행: Q1 — 위치: <section> — 정리됨: <why>
- Q4 <a decision the user left open> — 선행: 없음 — 위치: <section> — 미룸 (사용자, <YYYY-MM-DD>)

## 미해결 질문

- <a question the user left open>
