<div align="center">

# OpenDock

**AI 작업공간을 위한 승인된 dock.**

신뢰할 수 있는 프로젝트 설정을 한 명령으로 설치하세요. 명령 표면은 작게,
설정은 반복 가능하게, 생성된 모든 파일은 검토 가능하게 유지합니다.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock은 현재 프로젝트 디렉터리에 승인된 dock을 설치하는 Bun-first
TypeScript CLI입니다.

첫 dock은 `opendock/codex`입니다. Node를 확인하고, Codex CLI를 설치하고,
검토 가능한 프로젝트 파일을 적용하며, 설정 상태를 OpenDock state로 추적합니다.

OpenDock은 터미널 대체재가 아닙니다. 프로젝트에 검증된 AI 설정이 필요할 때
실행하는 작은 바이너리입니다.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock auth status
opendock auth logout
opendock deploy opendock/codex@1.0.0
```

## OpenDock이 필요한 이유

AI 작업공간 설정은 보통 일회성 shell 명령, 복사된 prompt 파일, 버전 drift,
희미하게 기억나는 프로젝트 규칙의 묶음이 되기 쉽습니다. OpenDock은 이를
검토된 dock으로 바꿉니다.

- **프로젝트 단위**: 현재 디렉터리에 설치하고 로컬 `.opendock/` 상태를 씁니다.
- **승인 중심 설계**: 원격 dock은 OpenDock Registry가 승인한 metadata에서만
  와야 합니다.
- **기존 파일 보호**: 각 파일은 managed block, manual review, unique-line append
  같은 update 정책을 직접 선언합니다.
- **작은 명령 표면**: install, update, doctor, log 확인, auth, deploy만 둡니다.
- **자동화 준비**: lifecycle step은 shell pipeline 없이 `git`, `brew`,
  `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, `oma`, `omx` 같은 허용된
  명령을 실행할 수 있습니다.

## 빠른 시작

OpenDock은 아직 패키지 매니저로 배포되지 않았습니다. 소스에서 빌드하세요.

```bash
bun install
bun run build
bin/opendock.js version
```

승인된 `opendock/codex` dock을 임시 프로젝트에서 실행해 보세요.

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex@1.0.0
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

설치 후 프로젝트에는 다음 항목이 생깁니다.

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## 명령어

| 명령어 | 역할 |
|---|---|
| `opendock install opendock/codex@1.0.0` | 현재 디렉터리에 승인된 dock을 설치합니다. |
| `opendock install opendock/codex@designer-build` | 정확한 version identifier로 설치합니다. |
| `opendock install opendock/codex@1.0.0 --platform windows` | host 자동 감지 대신 명시한 target platform으로 설치합니다. |
| `opendock install opendock/codex@1.0.0 --force` | install 중 OpenDock 관리 파일 변경을 강제로 반영합니다. |
| `opendock update` | lock된 platform 기준으로 설치된 dock을 Registry의 최신 승인 release로 적용합니다. |
| `opendock update --force` | 수정된 managed file이 있어도 OpenDock 관리 변경을 강제로 반영합니다. |
| `opendock doctor` | 현재 디렉터리의 OpenDock 상태를 lock에 기록된 platform 기준으로 표시합니다. |
| `opendock log` | 현재 프로젝트의 최근 OpenDock 실행 기록을 출력합니다. |
| `opendock version` | CLI 버전, schema 버전, 기본 Registry를 출력합니다. |
| `opendock bootstrap mac` | macOS dock용 Homebrew를 확인하거나 설치합니다. |
| `opendock auth login` | OpenDock Registry에 로그인합니다. |
| `opendock auth status` | 현재 OpenDock Registry 로그인 상태를 표시합니다. |
| `opendock auth logout` | 이 머신에서 OpenDock Registry 로그인을 해제합니다. |
| `opendock deploy opendock/codex@1.0.0` | 로컬 dock release를 OpenDock Registry 검토용으로 제출합니다. |

`install`은 공개 명령입니다. `deploy`는 OpenDock Registry 로그인을 사용합니다.
로그인 상태 확인과 해제에는 `opendock auth status`, `opendock auth logout`을 사용하세요.
Homebrew가 없다면 먼저 `opendock bootstrap mac`을 실행하세요.

dock reference는 정확한 version identifier를 반드시 요구합니다. OpenDock은
version을 semantic version으로 정렬하지 않고, `@` 뒤 identifier를 정확히 비교합니다.

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

install과 deploy는 모두 정확한 release identifier가 필요합니다.

```bash
opendock install owner/name@1.0.0
opendock deploy owner/name@1.0.0
```

`opendock install owner/name`, `opendock install owner/name@latest`,
`opendock deploy owner/name`, `opendock deploy owner/name@latest`는 거부됩니다.

OpenDock은 요청한 version identifier와 resolve된 exact version을 모두
`.opendock/dock.lock.yml`에 저장합니다. `opendock update`는 설치된 각 dock의
최신 승인 release를 OpenDock Registry에 묻고, 그 exact release를 적용한 뒤 lock을
갱신합니다. 최신 승인 release가 아니라 특정 release로 이동하려면
`opendock install owner/name@new-version`을 실행합니다.

## Dock 형식

dock은 `dock.yml` 파일과 `files[].from`에서 참조하는 source 파일 또는 디렉터리로
구성된 디렉터리입니다. 선택 사항인 `readme`와 `logo` 경로는 OpenDock Registry
catalog 메타데이터로 제출되며, `files`에도 선언하지 않으면 설치되지는 않습니다.
release version은 `dock.yml`에 선언하지 않습니다. 버전은
`opendock deploy owner/name@version`의 deploy reference에서 옵니다. deploy는
`dock.yml`과 `files[].from`, lifecycle `copy.from`의 설치 payload만 `.tgz`
submission archive로 묶어 검토용으로 제출합니다. `readme`와 `logo`는 `files`나
`copy.from`에도 명시하지 않는 한 catalog metadata로만 제출됩니다.
자세한 작성법은 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) 한국어 가이드를 참고하세요.

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup with managed workspace files.
readme: DOCK.md
logo: logo.png

files:
  - from: files/.agents
    to: .agents
    update: managed_file

  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: files/README.md
    to: README.md
    update: manual_review

  - from: files/.gitignore
    to: .gitignore
    update: append_unique

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0 <25.0.0"
      platforms:
        macos:
          run: brew install node
        windows:
          run: winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements

    - id: install-codex-cli
      check: codex --version
      version: ">=0.0.0"
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  doctor:
    - id: node
      version: ">=22.0.0 <25.0.0"
      check: node --version

    - id: npm
      version: ">=10.0.0"
      check: npm --version

    - id: codex
      version: ">=0.0.0"
      check: codex --version
      timeout_ms: 60000
```

`from` 경로는 dock root 기준입니다. `files/`는 권장 예시 폴더명일 뿐이며,
OpenDock은 특별한 payload 디렉터리를 요구하지 않습니다.

디렉터리 source는 재귀적으로 펼쳐집니다. `managed_file`은 현재 파일 hash가 마지막으로
OpenDock이 적용한 hash와 같을 때만 교체하거나 삭제합니다. 사용자가 수정한 managed file이
있으면 기본적으로 파일 변경과 lifecycle 실행 전에 중단됩니다. `--force`를 쓰면 해당 managed
file을 강제로 덮어쓰거나 삭제합니다.

Platform별 lifecycle 명령은 일반적인 top-to-bottom `install`, `update`,
`doctor` 순서 안에 머뭅니다. `platforms`가 있는 step은 하나의 논리적 `id`를
유지하고, OpenDock이 현재 platform에 맞는 override를 병합합니다.

```yaml
lifecycle:
  install:
    - id: install-bun
      check: bun --version
      version: ">=1.3.0"
      platforms:
        macos:
          run: brew install bun
        windows:
          run: npm install --global bun
```

`platforms`가 없는 step은 모든 platform에서 실행됩니다. 선택된 platform은
`.opendock/dock.lock.yml`에 저장되고 `opendock update`, `opendock doctor`에서
재사용됩니다.

대화형 lifecycle step은 사용자가 직접 조작하게 하거나, macOS `expect` PTY를 통해
승인된 작은 key sequence를 보낼 수 있습니다.

```yaml
lifecycle:
  install:
    - id: user-driven-tui
      run: codex
      interactive: user

    - id: scripted-tui
      run: codex
      interactive:
        mode: scripted
        inputs:
          - key: tab
          - key: enter
```

## 저장소 구조

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Registry dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Registry API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## 개발

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

Integration test는 임시 디렉터리와 생성된 로컬 dock fixture를 사용합니다.
`examples/`의 dock은 실제 작성 예시입니다.


## 생태계

OpenDock은 [Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode),
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) 같은 agent-native
도구와 자연스럽게 함께 쓰이도록 설계되었습니다. OpenDock은 로컬 프로젝트
workflow를 더 portable하고, inspectable하며, repeatable하게 만듭니다.
