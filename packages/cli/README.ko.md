<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

필요한 AI 셋업을 고르고, 프로젝트에 맞게 dock을 조합하고, 나중에 쉽게 업데이트하거나
제거하세요.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock은 프로젝트에 필요한 AI 셋업을 반복해서 손으로 만들지 않도록 도와주는
도구입니다.

프로젝트마다 prompt를 복사하고, 설정 파일을 만들고, 필요한 도구를 설치하는 일을
반복하는 대신 **dock**을 설치합니다.

Dock은 다시 쓸 수 있는 AI 셋업 패키지입니다. 하나만 설치할 수도 있고, 한
프로젝트에 여러 dock을 함께 설치할 수도 있습니다.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## 목차

- [OpenDock이 해결하는 문제](#opendock이-해결하는-문제)
- [동작 흐름](#동작-흐름)
- [관리 범위](#관리-범위)
- [설치](#설치)
- [명령어](#명령어)
- [Dock Format](#dock-format)
- [파일 소유권](#파일-소유권)
- [Workdir Files And Export](#workdir-files-and-export)
- [Example Docks](#example-docks)
- [Registry And Deploy](#registry-and-deploy)
- [Repository Layout](#repository-layout)
- [Development](#development)

## OpenDock이 해결하는 문제

AI 도구 세팅은 처음에는 간단합니다. prompt 몇 개를 복사하고, 설정 파일을 만들고,
필요한 도구를 설치하면 됩니다.

그런데 시간이 지나면 프로젝트마다 세팅이 달라집니다. 어떤 파일을 어디에 넣었는지,
어떤 도구를 설치했는지, 무엇을 업데이트해야 하는지 헷갈리기 시작합니다.

OpenDock은 이런 AI 셋업을 dock으로 묶어 관리합니다.

- 필요한 AI 셋업을 고를 수 있습니다.
- 여러 dock을 한 프로젝트에 함께 설치할 수 있습니다.
- 설치한 dock을 나중에 업데이트할 수 있습니다.
- 더 이상 필요 없는 dock은 제거할 수 있습니다.
- OpenDock이 추가한 내용을 추적합니다.
- 사용자가 직접 바꾼 파일을 조용히 덮어쓰지 않습니다.

OpenDock은 터미널 대체재가 아닙니다. 일반 script runner도 아닙니다. 프로젝트마다
필요한 AI 셋업을 쉽고 안전하게 설치하고 관리하기 위한 도구입니다.

## 동작 흐름

작업 중인 프로젝트에서 원하는 dock을 설치합니다.

```bash
opendock install opendock/designer-ai@1.0.0
```

그러면 OpenDock은 아래 순서로 동작합니다.

1. Registry에서 검토된 dock을 가져옵니다.
2. dock에 필요한 runtime을 확인합니다.
3. dock이 선언한 CLI 도구를 프로젝트 안에 준비합니다.
4. dock의 파일을 프로젝트에 추가합니다.
5. 파일을 쓰기 전에 충돌이 없는지 확인합니다.
6. 설치한 내용을 `.opendock/`에 기록합니다.

이 기록 덕분에 나중에 업데이트하거나 제거할 수 있습니다.

```bash
opendock update
opendock uninstall opendock/designer-ai
```

사용자가 직접 수정한 파일이 있으면 OpenDock은 바로 덮어쓰지 않습니다. 먼저 멈추고
충돌을 알려줍니다. dock 버전을 우선하고 싶을 때만 `--force`를 사용합니다.

## 관리 범위

OpenDock은 책임 범위를 명확히 나눕니다.

| 범위 | 소유 주체 | 목적 |
|---|---|---|
| **Registry** | OpenDock Registry | 검토된 dock 정보와 버전 archive. |
| **Project** | 현재 프로젝트 | 설치된 dock 목록, lock, log, 프로젝트 metadata. |
| **Dock** | 설치된 dock 하나 | 버전, checksum, 관리 파일 기록, 전용 workdir. |
| **Root output** | OpenDock file engine | 사전 확인 후 프로젝트 root에 적용되는 파일. |
| **Host bootstrap** | 사용자 머신 | Homebrew, WinGet 같은 1차 package manager를 `opendock bootstrap`으로 명시적으로 준비합니다. |
| **Runtime** | 사용자 계정 | Node, Bun, Python, npm, pip 같은 host runtime을 `~/.opendock/runtimes/` 아래 version별로 등록하고, 각 project에서는 `.opendock/bin/` shim으로 사용합니다. |
| **Tool** | 설치된 dock | `tools`에 선언한 CLI package를 `.opendock/tools/`에 설치하고 `.opendock/bin/`으로 연결합니다. |

핵심 규칙은 단순합니다. OpenDock은 프로젝트에 적용한 파일은 추적할 수 있지만,
전체 머신을 소유한다고 가정하지 않습니다. Host package manager는 bootstrap으로
분리합니다. Runtime wrapper는 home의 `.opendock`에서 공유하고, dock tool,
프로젝트 파일, dock workdir은 프로젝트의 `.opendock/`에서 추적합니다.

## 설치

OpenDock은 npm package로 배포되며 Bun 또는 npm으로 설치할 수 있습니다.

```bash
bun install -g opendock
opendock version
opendock version --check
```

Homebrew를 사용하는 macOS dock을 실행하려면, Homebrew가 없을 때 host bootstrap을
먼저 실행합니다.

```bash
opendock bootstrap mac
```

WinGet을 사용하는 Windows dock을 실행하려면, WinGet이 없을 때 host bootstrap을
먼저 실행합니다. OpenDock은 `winget`을 확인하고, 없으면 Microsoft App Installer를
열 수 있게 안내합니다.

```bash
opendock bootstrap windows
```

로컬 개발:

```bash
bun install
bun run build
bin/opendock version
```

## 명령어

| 명령 | 목적 |
|---|---|
| `opendock install owner/name@1.0.0` | 검토된 dock 버전을 현재 디렉터리에 설치합니다. |
| `opendock list` | 현재 프로젝트에 설치된 dock 목록을 보여줍니다. |
| `opendock list --json` | 설치된 dock 목록을 기계가 읽기 쉬운 JSON으로 출력합니다. |
| `opendock outdated` | 설치된 dock에 더 새로운 검토 완료 버전이 있는지 확인합니다. |
| `opendock update` | 업데이트 가능한 dock이 있을 때 더 새로운 검토 완료 버전을 적용합니다. |
| `opendock update --force` | 직접 수정한 OpenDock 관리 파일도 dock 버전으로 업데이트합니다. |
| `opendock uninstall owner/name` | dock 하나와 그 dock이 관리하던 프로젝트 파일을 제거합니다. |
| `opendock doctor` | 프로젝트 상태와 설치된 dock의 점검 step을 실행합니다. |
| `opendock log` | 현재 프로젝트의 최근 명령 실행 기록을 보여줍니다. |
| `opendock version` | CLI, schema, Registry 정보를 출력합니다. |
| `opendock version --check` | OpenDock public release channel 기준으로 새 CLI/app 버전이 있는지 확인합니다. |
| `opendock bootstrap mac` | macOS에서 Homebrew를 확인하거나 설치합니다. |
| `opendock bootstrap windows` | Windows에서 WinGet을 확인하거나 Microsoft App Installer를 엽니다. |
| `opendock auth login` | deploy를 위해 OpenDock Registry에 로그인합니다. |
| `opendock auth status` | 현재 Registry 로그인 상태를 보여줍니다. |
| `opendock auth logout` | 로컬 Registry 로그인 정보를 지웁니다. |
| `opendock deploy owner/name@1.0.0` | 로컬 dock 버전을 Registry 검토로 제출합니다. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | macOS용 버전 파일을 제출합니다. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Windows용 버전 파일을 제출합니다. |
| `opendock <command> --help` | 특정 명령의 옵션과 사용법을 보여줍니다. |

dock reference에는 정확한 version이 필요합니다.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

`opendock update`는 현재 프로젝트에 설치된 dock을 확인하고, 더 새로운 검토 완료
버전이 있는 dock만 업데이트합니다. 특정 버전으로 이동하려면 `opendock install
owner/name@new-version`을 실행합니다.

## Dock Format

dock은 manifest, 선택 catalog metadata, 선택 payload file로 구성됩니다.

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
```

최소 `dock.yml`:

```yaml
opendock: 1
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png
tags:
  - starter
  - ai-agent

files:
  - from: files/AGENTS.md
    to: AGENTS.md

requires:
  runtimes:
    git: ">=2.40.0"

install:
  - id: git-init
    check: git status
    run: git init -b main

update: []

doctor:
  - id: git
    check: git --version
    version: ">=2.40.0"
```

`readme`, `logo`, `tags`는 Registry catalog metadata입니다. Hub에서 dock을
이해하고 필터링하는 데 쓰이며, 실제 파일은 `files`에도 별도로 선언해야 프로젝트에
설치됩니다.

Dock 이름과 release version은 `dock.yml`에 쓰지 않고 install/deploy reference에서 정합니다.

```bash
opendock deploy owner/name@1.0.0
```

전체 manifest reference는 [docs/guides/guide.ko.md](./docs/guides/guide.ko.md)를
참고하세요.

## 파일 소유권

OpenDock은 dock author에게 per-file update policy를 고르게 하지 않습니다. file
engine이 target file type을 보고 ownership mode를 정합니다.

### Text Managed Blocks

Markdown, text, common agent instruction 파일은 marker block으로 적용됩니다.

```md
<!-- OPENDOCK:START id=files:AGENTS.md dock=owner/name path=AGENTS.md -->
...
<!-- OPENDOCK:END id=files:AGENTS.md dock=owner/name path=AGENTS.md -->
```

기존 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, `DESIGN.md`의 사용자
내용은 OpenDock block 바깥에 유지될 수 있습니다.

### Checksum Managed Files

marker comment를 넣기 어려운 파일은 파일 전체를 checksum으로 관리합니다. 사용자가
managed file을 수정하면 update와 uninstall은 기본적으로 중단됩니다. dock 버전을
우선하려면 `--force`를 사용합니다.

## Workdir Files And Export

Task는 프로젝트 root 또는 dock-private workdir에서 실행할 수 있습니다.
runtime 준비는 `requires`에 두고, package 설치와 generated output 적용은
top-level `install`, `update`, `doctor`에 둡니다.
외부 generator가 실행 전에 설정 파일을 필요로 하면 `workdir.files`로 dock 전용
workdir에 먼저 넣을 수 있습니다.

```yaml
tools:
  oma:
    manager: bun
    package: oh-my-agent
    version: "8.52.9"
    commands:
      - oma

permissions:
  - oma -y install

workdir:
  files:
    - from: workdir/oma-config.yaml
      to: .agents/oma-config.yaml

install:
  - id: apply-oma
    run: oma -y install
    workdir: dock
    export:
      include:
        - AGENTS.md
        - .agents/**
        - .codex/**
      exclude:
        - "**/*.log"
        - "**/cache/**"
```

- `workdir: root`는 프로젝트 root에서 실행합니다.
- `workdir: dock`은 `.opendock/workdirs/<dock>/`에서 실행합니다.
- `workdir.files`는 task 실행 전에 archive 파일을 dock 전용 workdir로 복사합니다.
- `export.include/exclude`는 dock workdir에서 root로 적용할 파일을 고릅니다.
- export된 파일도 managed block/checksum engine을 거쳐 적용됩니다.

이 구조는 `oma`, `omx` 또는 다른 AI setup generator와 협력하면서도 프로젝트
root에 들어온 최종 파일을 OpenDock이 추적할 수 있게 해줍니다. `oma -y install`처럼
기본 정책 밖의 command는 먼저 `tools.commands`에 선언하고, 실행할 정확한 형태를
top-level `permissions`에 적어야 합니다.

## Task Command Permission

OpenDock task의 `run`과 `check`는 작은 기본 정책 안에서 실행됩니다. 기본 command는 `bun`, `bunx`, `git`, `node`, `npm`, `npx`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`이며, macOS는 `brew`, Windows는 `powershell`, `winget`도 허용합니다. `oma`, `codex`, `claude`, `omx` 같은 command는 `tools.commands`에 선언된 경우에만 `permissions`로 실행 형태를 열 수 있습니다. `mkdir`처럼 OpenDock 기본 command도 아니고 `tools.commands`도 아닌 command는 거부됩니다. `|`, `&&`, `||`, `;`, backticks, `$(`, `>`, `<`는 `permissions`, `run`, `check`에서 거부됩니다. `npm install`, `bun add`, `pip install`, `brew install` 같은 package 설치/update 명령은 task에서 거부되며 `tools`나 bootstrap으로 처리해야 합니다.

```yaml
tools:
  oma:
    manager: bun
    package: oh-my-agent
    version: "8.52.9"
    commands:
      - oma

permissions:
  - oma -y install
  - oma link claude codex
```

## Example Docks

예제 dock은 서로 조합해서 쓰기 좋게 정리되어 있습니다.
대부분의 dock은 공통 project context인 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
local `README.md`와 함께 `.agents/skills/`, `.codex/skills/`, `.claude/skills/`,
`.cursor/rules/` 아래의 tool별 skill/rule 파일을 설치합니다. 그래서 dock 설치
직후 Codex, Claude Code, Gemini 계열 agent, Cursor, OMA식 skill discovery가 같은
프로젝트 context를 읽을 수 있습니다.

| 그룹 | 예제 | 역할 |
|---|---|---|
| Tool docks | `codex`, `claude-code`, `oma` | 특정 AI 도구를 설치하거나 실행합니다. |
| Outcome docks | `designer-ai`, `product-manager`, `frontend-ai`, `backend-ai`, `mobile-ai`, `qa-engineer`, `docs-ai`, `data-analyst`, `startup-founder`, `marketer-ai`, `customer-support`, `recruiter-ai`, `ai-automation`, `ui-case-study` | 직군/작업 결과별 셋업 파일, 프롬프트, agent instruction을 추가합니다. |
| Utility docks | `agent-ready`, `agent-safety`, `repo-context`, `mcp-safe`, `dev-env`, `devops-ai`, `monorepo-ai` | context, safety, MCP, validation, 운영, monorepo harness를 추가합니다. |

조합 예시:

```bash
opendock install opendock/codex@1.0.0
opendock install opendock/agent-ready@1.0.0
opendock install opendock/frontend-ai@1.0.0
opendock install opendock/repo-context@1.0.0
```

## Registry And Deploy

OpenDock은 두 공개 주소를 사용합니다.

| 주소 | 목적 |
|---|---|
| `https://hub.opendock.app` | 사람이 보는 dock catalog. |
| `https://registry.opendock.app` | CLI Registry API와 버전 다운로드. |

install은 공개되어 있지만, remote install 가능한 dock은 OpenDock Registry 검토를
거쳐야 합니다. deploy는 login이 필요합니다.

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

deploy는 다음을 업로드합니다.

- `dock.yml`
- `dock.yml`, `files[].from`, `workdir.files[].from`으로 만든 archive
- platform metadata: `macos`, `windows`, `linux`
- 선택 사항인 catalog용 `readme` markdown
- 선택 사항인 catalog용 `logo` image
- manifest의 선택 사항인 `tags`

catalog metadata는 install archive와 별도로 제출됩니다.
`--file dock.macos.yml`처럼 지정해도 archive 안에는 `dock.yml` 이름으로 들어가므로
install은 항상 일반 manifest 이름을 읽습니다.

## Repository Layout

```text
src/
  cli.ts                    # Commander CLI boundary
  auth.ts                   # Local Registry token storage
  registry.ts               # OpenDock Registry API client
  resolver.ts               # Registry archive download and validation
  bootstrap.ts              # First-party host bootstrap helpers
  core/
    app/                    # Install, update, uninstall orchestration
    domain/                 # Manifest and project state models
    files/                  # Managed blocks, checksums, path handling, file plans
    runtime/                # Task runner, command policy, allowlist
tests/
  cli-flow.test.ts          # Integration-style temp-dir tests
examples/
  */dock.macos.yml          # macOS example release manifests
  */dock.windows.yml        # Windows example release manifests
docs/
  guides/guide*.md          # Manifest authoring guides
```

## Development

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

commit 전에는 `bun run check`를 실행하세요.
