<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

필요한 dock을 고르고, 원하는 방식으로 조합해, 모든 프로젝트를 AI-ready workspace로
만드세요.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock은 프로젝트를 AI-ready workspace로 빠르게 세팅해주는 도구입니다.

프로젝트마다 prompt를 복사하고, 설정 파일을 만들고, 필요한 도구를 설치하는 일을
반복하는 대신 **dock**을 설치합니다.

dock은 바로 쓸 수 있는 AI 작업공간 패키지입니다. 하나만 설치할 수도 있고, 한
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
- [Scopes](#scopes)
- [설치](#설치)
- [명령어](#명령어)
- [Dock Format](#dock-format)
- [파일 소유권](#파일-소유권)
- [Lifecycle And Export](#lifecycle-and-export)
- [Example Docks](#example-docks)
- [Registry And Deploy](#registry-and-deploy)
- [Repository Layout](#repository-layout)
- [Development](#development)

## OpenDock이 해결하는 문제

AI 도구 세팅은 처음에는 간단합니다. prompt 몇 개를 복사하고, 설정 파일을 만들고,
필요한 도구를 설치하면 됩니다.

그런데 시간이 지나면 프로젝트마다 세팅이 달라집니다. 어떤 파일을 어디에 넣었는지,
어떤 도구를 설치했는지, 무엇을 업데이트해야 하는지 헷갈리기 시작합니다.

OpenDock은 이런 AI 작업 환경을 dock으로 묶어 관리합니다.

- 필요한 AI 작업 환경을 고를 수 있습니다.
- 여러 dock을 한 프로젝트에 함께 설치할 수 있습니다.
- 설치한 dock을 나중에 업데이트할 수 있습니다.
- 더 이상 필요 없는 dock은 제거할 수 있습니다.
- OpenDock이 추가한 내용을 추적합니다.
- 사용자가 직접 바꾼 파일을 조용히 덮어쓰지 않습니다.

OpenDock은 터미널 대체재가 아닙니다. 일반 script runner도 아닙니다. 프로젝트마다
필요한 AI 작업 환경을 쉽고 안전하게 설치하고 관리하기 위한 도구입니다.

## 동작 흐름

작업 중인 프로젝트에서 원하는 dock을 설치합니다.

```bash
opendock install opendock/designer-ai@1.0.0
```

그러면 OpenDock은 아래 순서로 동작합니다.

1. Registry에서 승인된 dock을 가져옵니다.
2. dock에 필요한 도구나 패키지를 확인합니다.
3. dock의 파일을 프로젝트에 추가합니다.
4. 파일을 쓰기 전에 충돌이 없는지 확인합니다.
5. 설치한 내용을 `.opendock/`에 기록합니다.

이 기록 덕분에 나중에 업데이트하거나 제거할 수 있습니다.

```bash
opendock update
opendock uninstall opendock/designer-ai
```

사용자가 직접 수정한 파일이 있으면 OpenDock은 바로 덮어쓰지 않습니다. 먼저 멈추고
충돌을 알려줍니다. dock 버전을 우선하고 싶을 때만 `--force`를 사용합니다.

## Scopes

OpenDock은 책임 범위를 명확히 나눕니다.

| Scope | 소유 주체 | 목적 |
|---|---|---|
| **Registry scope** | OpenDock Registry | 승인된 dock metadata와 release archive. |
| **Project scope** | 현재 workspace | 설치된 dock 목록, lock, log, project-level metadata. |
| **Dock scope** | 설치된 dock 하나 | version, checksum, managed file record, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 이후 project root에 적용되는 파일. |
| **System/tool scope** | host package manager | `requires` 또는 허용된 lifecycle command가 준비하는 Homebrew, npm, Bun, pip, winget 같은 host tool. |

핵심 규칙은 단순합니다. OpenDock은 프로젝트에 적용한 파일은 추적할 수 있지만,
전체 머신을 소유한다고 가정하지 않습니다. global tool installer는 host에 영향을
줄 수 있고, project files와 dock workdirs는 `.opendock/`에서 추적됩니다.

## 설치

OpenDock은 npm package로 배포되며 Bun 또는 npm으로 설치할 수 있습니다.

```bash
bun install -g opendock
opendock version
```

Homebrew를 사용하는 macOS dock을 실행하려면, Homebrew가 없을 때 host bootstrap을
먼저 실행합니다.

```bash
opendock bootstrap mac
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
| `opendock install owner/name@1.0.0` | 검토된 dock release를 현재 디렉터리에 설치합니다. |
| `opendock update` | 설치된 dock들을 최신 승인 Registry release로 이동합니다. |
| `opendock update --force` | OpenDock 관리 영역이 수정됐더라도 dock 버전으로 업데이트합니다. |
| `opendock uninstall owner/name` | dock 하나와 그 dock이 관리하던 프로젝트 파일을 제거합니다. |
| `opendock doctor` | 프로젝트 상태와 설치된 dock들의 doctor step을 점검합니다. |
| `opendock log` | 현재 프로젝트의 최근 OpenDock 실행 기록을 보여줍니다. |
| `opendock version` | CLI, schema, Registry 정보를 출력합니다. |
| `opendock bootstrap mac` | macOS에서 Homebrew를 확인하거나 설치합니다. |
| `opendock auth login` | deploy를 위해 OpenDock Registry에 로그인합니다. |
| `opendock auth status` | 현재 Registry 로그인 상태를 보여줍니다. |
| `opendock auth logout` | 로컬 Registry 로그인 정보를 지웁니다. |
| `opendock deploy owner/name@1.0.0` | local dock release를 Registry review로 제출합니다. |

dock reference에는 exact version identifier가 필요합니다.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

`opendock update`는 설치된 각 dock id를 Registry의 최신 승인 release로 resolve합니다.
특정 release로 이동하려면 `opendock install owner/name@new-version`을 실행합니다.

## Dock Format

dock은 manifest, optional catalog metadata, optional payload files로 구성됩니다.

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
id: owner/name
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png

files:
  - from: files/AGENTS.md
    to: AGENTS.md

requires:
  runtimes:
    git: ">=2.40.0"

lifecycle:
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

`readme`와 `logo`는 Registry catalog metadata입니다. 프로젝트에 설치하려면
`files`에도 별도로 선언해야 합니다.

release version은 `dock.yml`에 쓰지 않고 deploy command에서 정합니다.

```bash
opendock deploy owner/name@1.0.0
```

전체 manifest reference는 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md)를
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

## Lifecycle And Export

lifecycle step은 프로젝트 root 또는 dock-private workdir에서 실행할 수 있습니다.
runtime과 package 준비는 `requires`에 두고, lifecycle은 프로젝트 작업과 generated
output 적용에 사용합니다.

```yaml
lifecycle:
  install:
    - id: apply-oma
      run: oma -y install
      workdir: dock
      export:
        include:
          - AGENTS.md
          - CLAUDE.md
          - .agents/**
          - .codex/**
        exclude:
          - "**/*.log"
          - "**/cache/**"
```

- `workdir: root`는 프로젝트 root에서 실행합니다.
- `workdir: dock`은 `.opendock/workdirs/<dock>/`에서 실행합니다.
- `export.include/exclude`는 dock workdir에서 root로 적용할 파일을 고릅니다.
- export된 파일도 managed block/checksum engine을 거쳐 적용됩니다.

이 구조는 `oma`, `omx` 또는 다른 AI setup generator와 협력하면서도 프로젝트
root에 들어온 최종 파일을 OpenDock이 추적할 수 있게 해줍니다.

## Example Docks

예제 dock은 조합 가능성을 기준으로 정리합니다.

| 그룹 | 예제 | 역할 |
|---|---|---|
| Tool docks | `codex`, `claude-code`, `oma` | 특정 AI 도구를 설치하거나 실행합니다. |
| Outcome docks | `designer-ai`, `product-manager`, `frontend-ai`, `startup-founder`, `ai-automation`, `ui-case-study` | 직군/작업 결과별 AI-ready workspace 파일을 추가합니다. |
| Utility docks | `agent-ready`, `agent-safety`, `repo-context`, `mcp-safe`, `dev-env` | context, safety, MCP, validation harness를 추가합니다. |

조합 예시:

```bash
opendock install opendock/codex@1.0.0
opendock install opendock/agent-ready@1.0.0
opendock install opendock/frontend-ai@1.0.0
opendock install opendock/repo-context@1.0.0
```

## Registry And Deploy

OpenDock은 두 public surface를 사용합니다.

| Surface | 목적 |
|---|---|
| `https://hub.opendock.app` | 사람이 보는 dock catalog. |
| `https://registry.opendock.app` | CLI Registry API와 release download. |

install은 public이지만, remote install 가능한 dock은 OpenDock Registry 승인을
거쳐야 합니다. deploy는 login이 필요합니다.

```bash
opendock auth login
opendock deploy owner/name@1.0.0
```

deploy는 다음을 업로드합니다.

- `dock.yml`
- `dock.yml`과 `files[].from`으로 만든 archive
- optional `readme` markdown
- optional `logo` image

catalog metadata는 install archive와 별도로 제출됩니다.

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
    files/                  # Managed blocks, checksums, path safety, file plans
    runtime/                # Lifecycle command runner and allowlist
tests/
  cli-flow.test.ts          # Integration-style temp-dir tests
examples/
  */dock.yml                # Example docks
docs/
  guides/dock-yml.md        # Manifest authoring guide
```

## Development

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

commit 전에는 `bun run check`를 실행하세요.
