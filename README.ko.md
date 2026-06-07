<div align="center">

# OpenDock

**AI 작업공간을 위한 승인형 스타터팩 CLI.**

신뢰할 수 있는 프로젝트 세팅을 한 줄로 설치하고, 생성된 파일과 실행 기록을
프로젝트 단위로 추적합니다.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock은 현재 디렉터리에 승인된 스타터팩을 적용하는 Bun-first TypeScript
CLI입니다. 첫
스타터팩은 `opendock/oma-codex`이며, 디자이너가 Codex 프로젝트를 바로
시작할 수 있도록 Git과 `README.md`, `DESIGN.md`, `AGENTS.md`, `.gitignore`
같은 작업 하네스 파일을 준비합니다.

## 빠른 시작

아직 패키지 매니저 배포 전이므로 소스에서 빌드합니다.

```bash
bun install
bun run build
bin/opendock.js version
```

승인된 스타터팩을 임시 프로젝트에서 실행합니다.

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/oma-codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## 명령어

| 명령어 | 역할 |
|---|---|
| `opendock install opendock/oma-codex` | 현재 디렉터리에 스타터팩을 설치합니다. |
| `opendock update` | 설치된 스타터팩의 새 버전을 확인하고 안전하게 적용합니다. |
| `opendock doctor` | 프로젝트의 OpenDock 상태를 진단합니다. |
| `opendock log` | 현재 프로젝트의 최근 실행 로그를 보여줍니다. |
| `opendock version` | CLI, 스키마, 기본 레지스트리 정보를 출력합니다. |
| `opendock auth login` | DockHub 토큰을 저장합니다. |
| `opendock deploy oma-codex` | 로컬 `dock.yml` 스타터팩을 검토용으로 제출합니다. |

## dock.yml 작성 가이드

Codex CLI 설치 기준의 상세 starterpack 작성법은 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md)를 참고하세요. `examples/git`, `examples/codex`, `examples/claude-code`, `examples/oh-my-codex`, `examples/oh-my-openagent`에도 실제 예시가 들어 있습니다.

## 안전 모델

- pack reference는 `owner/name` 형식만 허용합니다.
- pack source와 registry host는 런타임 환경변수로 바꿀 수 없으며 `https://opencode.app`에 고정됩니다.
- 원격 pack은 DockHub 승인, 서명, 체크섬 검증을 통과해야 합니다.
- 기존 파일은 덮어쓰지 않고 OpenDock 관리 블록으로 append합니다.
- `.gitignore`는 중복 라인을 만들지 않습니다.
- setup 명령은 allowlist 기반이며 pipe, redirect, `&&`, `||` 같은 shell 연산자를 차단합니다.
- `install`과 `update`는 허용된 명령의 출력을 실시간으로 보여주고, 실행 후 check를 다시 돌려 요구 버전이나 상태가 실제로 충족됐는지 확인합니다.
- `interactive: user`는 실제 터미널 TTY에서 사용자가 직접 진행하고, `interactive: scripted`는 macOS `expect` PTY로 승인된 키 입력을 자동 전달합니다.
- `doctor` lifecycle check에는 기본 timeout이 있으며, step별로 `timeout_ms`를 지정할 수 있습니다.
- 프로젝트 상태는 `.opendock/`에, 상세 로그는 사용자 데이터 디렉터리에 저장합니다.

## 현재 범위

이 저장소는 CLI MVP입니다. 로컬 fixture, 원격 registry client 경계, 인증 토큰
저장, deploy 제출 plumbing, update, doctor, log, 테스트가 구현되어 있습니다.
호스팅 DockHub 서비스와 패키지 매니저 배포는 다음 단계입니다.
