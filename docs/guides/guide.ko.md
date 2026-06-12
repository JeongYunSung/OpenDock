# OpenDock 가이드

`dock.yml`은 하나의 dock이 프로젝트에 무엇을 더하는지 설명하는 manifest입니다.
어떤 파일을 넣을지, 어떤 도구를 준비할지, 설치/업데이트/점검 task에서 무엇을
실행할지, 외부 도구가 만든 결과물 중 무엇을 프로젝트 root로 가져올지 선언합니다.

OpenDock은 필요한 AI setup을 고르고, 한 workspace에 섞어 쓰고, 나중에 update와
uninstall까지 추적할 수 있게 만드는 작은 packaging layer입니다. 단순한 설치
스크립트가 아니라, 프로젝트마다 반복 가능한 AI workspace 구성을 만드는 데 초점을
둡니다.

다른 언어:

- [English](./guide.md)
- [日本語](./guide.ja.md)
- [中文](./guide.zh.md)
- [Español](./guide.es.md)
- [Français](./guide.fr.md)
- [Deutsch](./guide.de.md)

이 문서는 현재 TypeScript CLI 구현 기준입니다. 핵심 구현은 `src/core/` 아래에
있습니다.

| 영역 | 구현 |
|---|---|
| manifest parsing | `src/core/domain/manifest.ts` |
| install/update/uninstall orchestration | `src/core/app/dock-installer.ts` |
| managed block/checksum file engine | `src/core/files/` |
| install, update, doctor task runner | `src/core/runtime/` |
| registry resolve/deploy boundary | `src/resolver.ts`, `src/cli.ts` |

## 목차

- [작성 전 결정할 것](#작성-전-결정할-것)
- [dock package 구조](#dock-package-구조)
- [최소 예제](#최소-예제)
- [전체 예제](#전체-예제)
- [Top-Level 필드](#top-level-필드)
- [id와 version](#id와-version)
- [readme, logo, tags](#readme-logo-tags)
- [requires](#requires)
- [files](#files)
- [파일 소유권](#파일-소유권)
- [tasks](#tasks)
- [workdir.files와 export](#workdirfiles와-export)
- [platform artifact](#platform-artifact)
- [version 범위](#version-범위)
- [허용 프로그램](#허용-프로그램)
- [install, list, update, uninstall 의미](#install-list-update-uninstall-의미)
- [충돌 처리](#충돌-처리)
- [deploy와 archive](#deploy와-archive)
- [예제 dock 목록](#예제-dock-목록)
- [작성 체크리스트](#작성-체크리스트)

## 작성 전 결정할 것

dock을 작성하기 전에 네 가지를 먼저 정하세요.

1. **대상 결과**: 단순 도구 설치인지, 특정 직군/워크플로우용 AI-ready workspace인지 정합니다.
2. **root에 남길 파일**: `AGENTS.md`, `.agents/`, `.codex/`, `DESIGN.md`처럼 프로젝트가 실제로 읽을 파일을 정합니다.
3. **task 실행 위치**: 프로젝트 root에서 실행할지, dock 전용 workdir에서 실행한 뒤 export할지 정합니다.
4. **필요한 runtime**: Node, Bun, npm, Python처럼 host에서 확인해야 하는 runtime을 정합니다.
5. **유지보수 방식**: update 때 다시 실행할 설치 step, doctor로 확인할 상태를 정합니다.

OpenDock은 outcome-first package를 권장합니다. `opendock/codex`처럼 도구 하나만
설치하는 dock도 가능하지만, 더 좋은 dock은 다른 dock과 조합돼도 잘 동작하면서
사용자가 바로 일할 수 있는 구조, 프롬프트, agent instruction, 검증 명령까지 같이
제공합니다.

## dock package 구조

권장 구조는 다음과 같습니다.

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
    .agents/
      skills/
        review/
          SKILL.md
```

`files/`는 관례일 뿐 필수 폴더명이 아닙니다. `dock.yml`의 `files[].from`에
명시한 경로라면 어떤 폴더 이름도 사용할 수 있습니다.

```yaml
files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

`readme`, `logo`, `tags`는 catalog metadata입니다. `readme`와 `logo` 파일은 설치
대상 프로젝트에 자동으로 복사되지 않습니다. 프로젝트에도 설치하려면 `files`에 별도로
선언해야 합니다.

## 최소 예제

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png
tags:
  - ai-agent
  - starter

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

이 manifest는 `files/AGENTS.md`를 프로젝트의 `AGENTS.md`에 적용합니다. 대상이
root Markdown 파일이므로 OpenDock은 파일 전체를 덮어쓰지 않고 managed
block을 추가하거나 갱신합니다.

## 전체 예제

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png
tags:
  - ai-agent
  - starter

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md

  - from: files/.github/copilot-instructions.md
    to: .github/copilot-instructions.md

install:
  - id: git-init
    check: git status
    run: git init -b main

update: []

doctor:
  - id: agents-md
    check: test -f AGENTS.md

  - id: git
    check: git --version
    version: ">=2.40.0"
```

실행 순서는 위에서 아래입니다.

## Top-Level 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `opendock` | 필수 | 현재 지원 manifest version은 `1`입니다. |
| `id` | 필수 | dock id입니다. `owner/name` 형식입니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 실행 로직에는 영향이 없습니다. |
| `summary` | 선택 | Registry catalog에 표시할 짧은 설명입니다. |
| `readme` | 선택 | Registry catalog 상세 본문으로 제출할 Markdown 경로입니다. |
| `logo` | 선택 | Registry catalog 대표 이미지로 제출할 이미지 경로입니다. |
| `tags` | 선택 | Hub 검색과 필터에 사용할 lowercase catalog label입니다. |
| `requires` | 선택 | dock 실행 전에 준비할 runtime requirement입니다. |
| `files` | 선택 | 프로젝트 root로 적용할 파일 또는 디렉터리 mapping입니다. |
| `install` | 선택 | 최초 install과 초기 생성 작업 task입니다. |
| `update` | 선택 | refresh와 유지보수 작업 task입니다. |
| `doctor` | 선택 | 프로젝트를 수정하지 않는 상태 점검 task입니다. |

## id와 version

`dock.yml`의 `id`에는 version을 쓰지 않습니다.

```yaml
id: opendock/codex
```

설치와 배포 명령에서만 exact version identifier를 붙입니다.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

허용되는 id 형태:

```text
opendock/codex
acme/designer-ai
team.frontend/react-agent
```

거부되는 형태:

```text
codex
../codex
opendock/codex/designer
opendock/codex@1.0.0
```

설치 reference는 exact version이 필수입니다.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

OpenDock은 version string을 semver로 정렬하지 않습니다. install/deploy reference에
쓴 identifier와 Registry가 돌려준 release version을 정확히 비교합니다.

## readme, logo, tags

`readme`, `logo`, `tags`는 사람이 보는 Registry catalog용 metadata입니다.

```yaml
readme: DOCK.md
logo: logo.png
tags:
  - design
  - ux
  - figma
```

주의할 점:

- 둘 다 dock root 안의 안전한 상대 경로여야 합니다.
- 절대 경로와 `../` path traversal은 거부됩니다.
- 설치 대상 프로젝트에 자동 복사되지 않습니다.
- 설치 archive에는 기본 포함되지 않고 deploy submission metadata로 별도 제출됩니다.
- `readme`는 Markdown 파일이며 최대 65536 bytes까지 제출됩니다.
- `logo`는 PNG, JPEG, WebP만 허용하며 최대 524288 bytes까지 제출됩니다.
- CLI는 logo 확장자와 실제 file signature가 맞는지 검사합니다.
- `tags`는 `design`, `ai-agent` 같은 lowercase slug이며 dock 하나당 최대 12개까지
  선언할 수 있습니다.
- `tags`는 catalog label일 뿐입니다. install, update, uninstall, doctor 동작은
  바꾸지 않습니다.

## requires

`requires`는 dock을 실행하기 전에 OpenDock이 확인하고 준비해야 하는 host runtime을
선언합니다. 프로젝트에 복사되는 파일이 아니라 system/tool scope에 대한 요구사항입니다.
CLI package 설치는 `install` 또는 `update` step에 명시합니다.

```yaml
requires:
  runtimes:
    bun: ">=1.3.0"

install:
  - id: install-oma
    run: bun install --global oh-my-agent@latest
```

동작:

1. install/update/doctor 전에 `requires`를 먼저 평가합니다.
2. `runtimes`는 `node --version`, `bun --version` 같은 runtime check를 수행합니다.
3. install/update에서 runtime이 없거나 version을 만족하지 않으면 OpenDock이 아는
   host OS별 installer를 실행합니다.
4. `bun install --global ...`, `npm install --global ...` 같은 CLI package 설치는
   일반 `install`/`update` step으로 실행합니다.
5. doctor에서는 설치나 수정 없이 상태만 확인합니다.

현재 지원 runtime key:

```text
bun
git
node
npm
pip
pip3
python
python3
```

예시:

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"

install:
  - id: install-codex
    run: npm install --global @openai/codex@latest

update:
  - id: update-codex
    run: npm install --global @openai/codex@latest
```

주의할 점:

- `requires`는 OpenDock이 host runtime을 준비하는 영역입니다.
- root에 적용할 파일은 `files` 또는 step의 `export`로 선언해야 합니다.
- raw shell, pipe, redirect는 `requires`에서도 허용되지 않습니다.
- 설치된 CLI를 실행해야 한다면 `requires`가 아니라 `install`, `update`, `doctor` task에 `run`을 작성합니다.

## files

`files`는 dock 내부 파일 또는 디렉터리를 프로젝트 root로 적용하는 선언입니다.

```yaml
files:
  - from: files/.agents
    to: .agents

  - from: files/DESIGN.md
    to: DESIGN.md
```

| 필드 | 필수 | 설명 |
|---|---:|---|
| `from` | 필수 | dock root 기준 source file 또는 directory입니다. |
| `to` | 필수 | 프로젝트 root 기준 target path입니다. |

규칙:

- `from`과 `to`는 안전한 상대 경로여야 합니다.
- 빈 문자열, 절대 경로, `../`, NUL 문자는 거부됩니다.
- source가 symlink이면 거부됩니다.
- source가 파일이면 `to`는 대상 파일 경로입니다.
- source가 디렉터리이면 regular file을 재귀적으로 펼쳐 `to` 아래로 적용합니다.
- 빈 디렉터리는 생성하지 않습니다.

예를 들어:

```yaml
files:
  - from: files/.agents
    to: .agents
```

위 선언은 `files/.agents/skills/review/SKILL.md`를
`.agents/skills/review/SKILL.md`로 적용합니다.

## 파일 소유권

OpenDock은 파일별 update 정책을 별도 선언하지 않습니다. 파일 종류에 따라
자동으로 두 가지 방식 중 하나를 선택합니다.

### text managed block

Markdown, text, common root instruction 파일은 managed block으로 적용됩니다.

대상:

- `.md`
- `.mdc`
- `.txt`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

`.codex/`, `.claude/`, `.agents/`, `.github/copilot-instructions.md`,
`.github/instructions/` 아래의 agent runtime 파일은 block으로 감싸지 않습니다.
skill frontmatter, hook script, 실행권한이 깨지지 않도록 checksum 기반 managed
file로 그대로 관리합니다.

예시:

```md
<!-- OPENDOCK:START id=files:AGENTS.md dock=opendock/agent-ready path=AGENTS.md -->
...
<!-- OPENDOCK:END id=files:AGENTS.md dock=opendock/agent-ready path=AGENTS.md -->
```

동작:

- 대상 파일이 없으면 새 파일을 만들고 block을 넣습니다.
- 대상 파일이 있으면 기존 내용 끝에 block을 추가합니다.
- 다시 install/update하면 같은 marker 안의 내용만 교체합니다.
- block 바깥의 사용자 내용은 유지합니다.
- 사용자가 block 안을 수정하면 기본 update/uninstall은 중단됩니다.
- `--force`를 쓰면 dock 내용이 우선됩니다.

### checksum managed file

block을 넣기 어려운 설정 파일, 이미지, binary, vendor config는 파일 전체를
checksum으로 관리합니다.

동작:

- 적용 후 checksum을 `.opendock/dock.lock.yml`에 기록합니다.
- update 때 현재 checksum이 lock과 같으면 새 파일로 교체합니다.
- 새 release에서 빠진 파일은 현재 checksum이 lock과 같을 때 삭제합니다.
- 사용자가 수정해 checksum이 달라졌으면 기본 update/uninstall은 중단됩니다.
- `--force`를 쓰면 dock 내용이 우선됩니다.

OpenDock은 git merge 도구가 아닙니다. 자동 병합 대신 “소유한 영역만 안전하게
갱신하고, 사용자가 바꾼 영역은 멈춘다”를 기본 원칙으로 둡니다.

## tasks

`dock.yml`에는 세 task가 있습니다.

```yaml
install: []
update: []
doctor: []
```

| task | 실행되는 OpenDock 명령 | 목적 |
|---|---|---|
| `install` | `opendock install owner/name@version` | 최초 적용과 초기 생성 작업 |
| `update` | `opendock update` | 최신 approved release로 이동하며 유지보수 작업 실행 |
| `doctor` | `opendock doctor` | 현재 프로젝트와 도구 상태 점검 |

### step 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `id` | 필수 | step identifier입니다. 로그와 doctor 출력에 사용됩니다. |
| `name` | 선택 | 사람이 읽는 step 이름입니다. 없으면 `id`를 사용합니다. |
| `check` | 선택 | 현재 상태를 확인하는 명령입니다. |
| `run` | 선택 | install/update에서 실행할 명령입니다. |
| `version` | 선택 | `check` 출력에서 추출한 semver가 만족해야 하는 범위입니다. |
| `timeout_ms` | 선택 | step timeout입니다. doctor 기본값은 30000ms입니다. |
| `workdir` | 선택 | `root` 또는 `dock`입니다. 기본값은 `root`입니다. |
| `export` | 선택 | `workdir: dock` 결과물 중 root로 적용할 glob입니다. |

### install/update 실행 규칙

1. `check`가 있으면 먼저 실행합니다.
2. `check`가 성공하고 `version`도 만족하면 `run`을 건너뜁니다.
3. `check`가 실패하면 `run`을 실행합니다.
4. `run` 이후 `check`가 있으면 다시 실행합니다.
5. post-check가 실패하면 install/update는 실패합니다.
6. 성공한 step의 export가 있으면 export 후보를 수집합니다.

runtime 준비는 `requires`에 선언하세요. CLI package 설치나 외부 generator 실행은
`install`, `update`, `doctor` step에 명시합니다.

재실행 가능한 step에는 `check`, `version`, `run`을 같이 쓸 수 있습니다.

```yaml
install:
  - id: git-init
    check: git status
    run: git init -b main
```

`check` 없이 `run`만 쓰면 해당 step마다 항상 실행됩니다.

### doctor 실행 규칙

doctor는 상태 점검용입니다.

- `run`이 있으면 `run`을 실행합니다.
- `run`이 없으면 `check`를 실행합니다.
- 실패한 step은 `!`로 표시하지만 다른 doctor step은 계속 실행합니다.
- 자동 수정이 필요하면 doctor가 아니라 `install` 또는 `update`에 `run`을 쓰세요.

```yaml
doctor:
  - id: node
    check: node --version
    version: ">=22.0.0"
```

## workdir.files와 export

OpenDock의 task 실행 위치는 두 가지입니다.

| workdir | 위치 | 용도 |
|---|---|---|
| `root` | 프로젝트 root | `git init`, root 상태 확인, project-level 작업 |
| `dock` | `.opendock/workdirs/<dock>/` | 외부 generator를 격리 실행한 뒤 결과물 export |

`workdir: dock`은 외부 도구가 여러 파일을 만들어내는 경우에 유용합니다.
외부 도구가 실행 전에 설정 파일을 필요로 한다면 `workdir.files`로 dock 전용
workdir에 먼저 넣을 수 있습니다.

```yaml
workdir:
  files:
    - from: workdir/oma-config.yaml
      to: .agents/oma-config.yaml

install:
  - id: apply-oma
    run: oma -y install
    workdir: dock
  - id: link-oma-vendors
    run: oma link claude codex
    workdir: dock
    export:
      include:
        - AGENTS.md
        - CLAUDE.md
        - .agents/**
        - .codex/**
        - .claude/**
      exclude:
        - "**/*.log"
        - "**/cache/**"
```

동작:

1. `workdir.files`가 있으면 archive의 파일을 dock 전용 workdir에 먼저 복사합니다.
2. step은 dock 전용 workdir에서 실행됩니다.
3. OpenDock은 `export.include`에 맞는 파일만 후보로 수집합니다.
4. `export.exclude`에 맞는 파일은 제외합니다.
5. 후보 파일은 root로 즉시 복사되지 않습니다.
6. 모든 `files`와 `export` 후보를 합쳐 preflight를 통과한 뒤 root에 적용합니다.

| 필드 | 대상 | 시점 |
|---|---|---|
| `files` | 프로젝트 root | task export까지 preflight를 통과한 뒤 적용 |
| `workdir.files` | `.opendock/workdirs/<dock>/` | install/update task 실행 전 복사 |
| `export` | 프로젝트 root | `workdir: dock` task 실행 후 수집 |

이 구조 덕분에 `oma`, `omx`, `npx ... install` 같은 외부 generator와 협력하면서도
프로젝트 root에 들어온 최종 파일은 OpenDock이 추적할 수 있습니다.

## platform artifact

OS별 동작이 다르면 한 `dock.yml` 안에서 분기하지 말고, 같은 `id/version` 아래
platform별 artifact를 따로 배포하는 방식을 권장합니다.

```bash
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
opendock deploy owner/name@1.0.0 --platform linux --file dock.linux.yml
```

platform과 무관한 dock은 `--platform`을 생략하면 `any` artifact로 제출됩니다.

이 repository의 example dock은 배포용 파일명을 명확히 하기 위해
`dock.macos.yml`과 `dock.windows.yml`을 함께 둡니다.

설치는 그대로 단순합니다.

```bash
opendock install owner/name@1.0.0
opendock install owner/name@1.0.0 --platform windows
```

`--platform`을 생략하면 OpenDock이 host OS를 감지해서 Registry에 해당 platform
artifact를 요청합니다. `--platform`을 주면 그 platform artifact를 명시적으로
요청합니다.

install 후 lock에는 선택된 platform이 기록됩니다. update와 doctor는 기본적으로
lock의 platform을 재사용하고, 필요하면 CLI의 `--platform` 옵션으로 override할 수
있습니다.

## version 범위

`version`은 `check` 출력에서 첫 번째 `x.y.z` 형태를 읽어 비교합니다.

```yaml
version: ">=22.0.0 <25.0.0"
```

지원 연산자:

- `>=`
- `>`
- `<=`
- `<`
- `=`

예시 출력:

```text
node --version    -> v22.18.0
bun --version     -> 1.3.11
codex --version   -> codex 0.128.0
```

patch가 없는 `1.3` 같은 출력은 추출에 실패할 수 있습니다. 가능하면 세 자리
semver를 출력하는 명령을 `check`로 사용하세요.

## 허용 프로그램

OpenDock은 `requires`와 task에 shell script를 그대로 넘기지
않습니다. `run`/`check` 문자열을 분리한 뒤 allowlist와 shape 검사를 통과한
프로그램만 실행합니다.

현재 공통 허용 프로그램:

```text
bun
bunx
claude
codex
git
mkdir
node
npm
npx
oma
omx
pip
pip3
pipx
pnpm
python
python3
test
uv
```

host OS별 추가 허용 프로그램:

| platform | 추가 프로그램 |
|---|---|
| `macos` | `brew` |
| `windows` | `powershell`, `winget` |
| `linux` | 없음 |

`powershell`은 Windows doctor에서 파일 존재 여부를 확인하는 제한된
`Test-Path -LiteralPath <relative-path>` 형태만 허용합니다. 임의 PowerShell
script 실행용으로는 사용할 수 없습니다.

차단되는 shell operator:

```text
|
&&
||
;
`
$(
>
<
```

한 step에 여러 명령을 묶지 말고 step을 나누세요.

```yaml
# 나쁨
- id: init-and-check
  run: git init -b main && git status

# 좋음
- id: git-init
  run: git init -b main

- id: git-status
  run: git status
```

전체 allowlist와 shape 검사는 `src/core/runtime/command-runner.ts`가 기준입니다.

### Homebrew bootstrap

macOS에서 Homebrew가 없으면 dock 실행 전에 first-party bootstrap을 먼저 실행합니다.

```bash
opendock bootstrap mac
```

`dock.yml` 안에서 Homebrew 설치용 `curl | sh`를 직접 실행하는 방식은 허용하지
않습니다.

### WinGet bootstrap

Windows에서 WinGet이 없으면 dock 실행 전에 first-party bootstrap을 먼저 실행합니다.

```bash
opendock bootstrap windows
```

OpenDock은 `winget`이 이미 있으면 ready로 처리합니다. 없으면 Microsoft App
Installer 설치/업데이트 안내를 보여주고, 사용자가 동의하면 App Installer 페이지를
엽니다. `dock.yml` 안에서 WinGet 또는 App Installer 설치용 PowerShell script를
직접 실행하는 방식은 권장하지 않습니다.

## install, list, update, uninstall 의미

### install

`install`은 특정 exact release를 현재 프로젝트에 적용합니다.

```bash
opendock install owner/name@1.0.0
```

이미 같은 dock이 설치되어 있다면 이전 lock의 checksum을 기준으로 기존 관리
파일을 먼저 검증한 뒤 새 release를 적용합니다. 특정 release로 이동하고 싶을 때도
`install owner/name@new-version`을 사용할 수 있습니다.

### list

`list`는 현재 프로젝트에 설치된 dock을 보여줍니다.

```bash
opendock list
```

Registry에 요청하지 않고 `.opendock/dock.lock.yml`만 읽습니다. 출력에는 dock id,
version, platform, 관리 파일 수가 포함됩니다.

### update

`update`는 현재 프로젝트에 설치된 모든 dock을 Registry의 최신 approved release로
이동합니다.

```bash
opendock update
opendock update --force
```

각 dock은 개별적으로 resolve되고, 개별 version과 파일 기록이 갱신됩니다.

### uninstall

`uninstall`은 특정 dock 하나만 제거합니다.

```bash
opendock uninstall owner/name
opendock uninstall owner/name --force
```

동작:

- 해당 dock의 managed block은 대상 파일에서 제거됩니다.
- 해당 dock의 checksum managed file은 삭제됩니다.
- 다른 dock의 block이나 file record는 유지됩니다.
- dock 전용 workdir은 삭제됩니다.
- lock에서 해당 dock record만 제거됩니다.

## 충돌 처리

OpenDock은 root 파일을 쓰기 전에 preflight를 수행합니다.

중단되는 경우:

- 이전에 적용한 managed block이 사라졌거나 수정됨.
- checksum managed file이 사용자가 수정한 상태임.
- 새로 적용하려는 checksum managed file 경로에 OpenDock 소유가 아닌 파일이 이미 있음.
- 같은 install/update 안에서 동일한 target에 중복 output이 생김.
- source 또는 target path가 안전하지 않음.

`--force`를 쓰면 OpenDock 소유였던 파일/블록의 변경은 dock 내용으로 되돌립니다.
하지만 `--force`는 임의 shell 명령을 허용하거나 path safety를 우회하지 않습니다.

## deploy와 archive

release version은 `dock.yml`에 쓰지 않습니다. deploy 명령에서 정합니다.

```bash
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

deploy가 제출하는 것:

1. `dock.yml` 원문.
2. `dock.yml`, `files[].from`, `workdir.files[].from`으로 만든 `.tgz` archive.
3. release platform metadata: `any`, `macos`, `windows`, `linux`.
4. 선택 사항인 `readme_markdown`.
5. 선택 사항인 `logo`.
6. manifest의 선택 사항인 `tags`.

archive에는 기본적으로 다음이 들어갑니다.

- `dock.yml`
- `files[].from`과 `workdir.files[].from`에 명시된 파일과 디렉터리의 regular files

`readme`, `logo`, `tags`는 catalog metadata입니다. `readme`와 `logo` 파일은
archive에는 기본 포함되지 않습니다. 설치 프로젝트에 들어가야 하는 파일이라면
`files`에 명시하세요.

`--file dock.macos.yml`처럼 platform별 manifest를 지정해도 archive 안에는 항상
`dock.yml` 이름으로 들어갑니다. install은 다운로드한 artifact에서 일반적인
`dock.yml`을 읽습니다.

deploy는 Registry login이 필요합니다.

```bash
opendock auth login
opendock auth status
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

## 예제 dock 목록

예제는 `examples/` 아래에 있으며, “고르고 조합한다”는 제품 방향에 맞춰 세 그룹으로
관리합니다.

workspace 예제는 테스트 fixture가 아니라 실제 배포 가능한 dock으로 관리합니다.
tool dock을 제외한 workspace dock은 공통 root context와 provider별 runtime 파일을
함께 설치합니다.

- 공통 root context: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`
- OMA-style skill: `.agents/skills/opendock-*/SKILL.md`
- Codex skill: `.codex/skills/opendock-*/SKILL.md`
- Claude Code skill: `.claude/skills/opendock-*/SKILL.md`
- Cursor rule: `.cursor/rules/opendock-*.mdc`

`opendock/codex`, `opendock/claude-code`, `opendock/oma`는 도구만 준비하는
tool dock입니다. outcome/utility dock은 설치 직후 agent가 읽을 수 있는 workspace
context까지 제공합니다.

pro addon dock은 `<dock>-pro` 이름을 사용합니다. 기본 dock은 간소형으로 유지하고,
pro addon은 curated specialist skill, workflow playbook, Claude Code subagent,
Claude Code command adapter, Codex custom agent, Cursor rule을 추가합니다. hub URL은 dock 이름 그대로 연결합니다:
[opendock/designer-ai-pro](https://hub.opendock.app/docks/opendock/designer-ai-pro).

### Tool docks

Tool dock은 특정 CLI나 외부 setup engine을 준비합니다. project payload를 최소화하고
다른 outcome/utility dock과 조합하는 것을 전제로 합니다.

| 예제 | 용도 |
|---|---|
| `examples/codex/dock.{macos,windows}.yml` | Codex CLI 설치 |
| `examples/claude-code/dock.{macos,windows}.yml` | Claude Code 설치 |
| `examples/oma/dock.{macos,windows}.yml` | Oh My Agent 실행 결과를 OpenDock export로 적용 |

### Outcome docks

Outcome dock은 특정 직군이나 작업 결과를 위한 AI-ready workspace 파일을 설치합니다.
도구 설치는 하지 않으며, `opendock/codex`, `opendock/claude-code`, `opendock/oma`
같은 tool dock과 함께 조합합니다.

| 예제 | 용도 |
|---|---|
| `examples/designer-ai/dock.{macos,windows}.yml` | UI/UX/product design workspace |
| `examples/product-manager/dock.{macos,windows}.yml` | PRD, user story, roadmap, release workspace |
| `examples/frontend-ai/dock.{macos,windows}.yml` | React/Next.js frontend engineering workspace |
| `examples/backend-ai/dock.{macos,windows}.yml` | backend API, database, security workspace |
| `examples/mobile-ai/dock.{macos,windows}.yml` | mobile app architecture and release workspace |
| `examples/qa-engineer/dock.{macos,windows}.yml` | QA, regression, accessibility, bug report workspace |
| `examples/docs-ai/dock.{macos,windows}.yml` | README, API docs, changelog workspace |
| `examples/data-analyst/dock.{macos,windows}.yml` | metrics, SQL, dashboard, experiment workspace |
| `examples/startup-founder/dock.{macos,windows}.yml` | founder strategy workspace |
| `examples/marketer-ai/dock.{macos,windows}.yml` | campaign, content, SEO workspace |
| `examples/customer-support/dock.{macos,windows}.yml` | support FAQ, triage, escalation workspace |
| `examples/recruiter-ai/dock.{macos,windows}.yml` | recruiting, interview, scorecard workspace |
| `examples/ai-automation/dock.{macos,windows}.yml` | internal automation and workflow design workspace |
| `examples/ui-case-study/dock.{macos,windows}.yml` | UI/UX portfolio case study workspace |

### Utility docks

Utility dock은 여러 outcome dock과 같이 섞어 쓰는 보조 harness입니다.

| 예제 | 용도 |
|---|---|
| `examples/agent-ready/dock.{macos,windows}.yml` | 여러 AI coding agent용 공통 instruction |
| `examples/agent-safety/dock.{macos,windows}.yml` | AI-generated change review와 security safety rails |
| `examples/repo-context/dock.{macos,windows}.yml` | repository context packaging과 analysis prompts |
| `examples/mcp-safe/dock.{macos,windows}.yml` | security-first MCP reference |
| `examples/dev-env/dock.{macos,windows}.yml` | project-local tool versions와 validation task reference |
| `examples/devops-ai/dock.{macos,windows}.yml` | CI/CD, deployment, incident runbook workspace |
| `examples/monorepo-ai/dock.{macos,windows}.yml` | package boundary and change impact workspace |

### Pro addon docks

각 workspace/utility dock에는 같은 이름의 pro addon이 있습니다. 예를 들어
`opendock/designer-ai-pro`는 `opendock/designer-ai`의 전문가 팀 확장판입니다.
pro addon은 기본 dock과 함께 설치하는 것을 전제로 하며, 여러 specialist skill,
workflow playbook, Claude command adapter, Claude/Codex subagent를 추가합니다.

조합 예시는 다음과 같습니다.

```bash
opendock install opendock/codex@1.0.0
opendock install opendock/agent-ready@1.0.0
opendock install opendock/frontend-ai@1.0.0
opendock install opendock/repo-context@1.0.0
```

```bash
opendock install opendock/claude-code@1.0.0
opendock install opendock/product-manager@1.0.0
opendock install opendock/agent-safety@1.0.0
```

## 작성 체크리스트

manifest:

1. `opendock: 1`을 선언했는가?
2. `id`가 `owner/name` 형식인가?
3. release version을 `dock.yml`이 아니라 deploy 명령에서 정했는가?
4. `readme`와 `logo`가 dock root 안의 실제 파일인가?

requires:

1. 필요한 runtime을 `requires.runtimes`에 선언했는가?
2. runtime version 범위가 실제 installer 결과와 충돌하지 않는가?
3. CLI package 설치는 `install`/`update` step으로 명시했는가?

files:

1. 모든 `files[].from`과 `workdir.files[].from`이 존재하는가?
2. `files[].to`가 프로젝트 root 기준 안전한 상대 경로인가?
3. root Markdown instruction은 managed block으로, agent runtime 파일은 exact file로 적용되는지 확인했는가?
4. 설정 파일이나 binary는 checksum managed file로 충돌 감지되는지 확인했는가?

tasks:

1. 재실행 가능한 step에는 `check`를 붙였는가?
2. 버전이 중요한 도구에는 `version` 범위를 넣었는가?
3. 오래 걸리는 step에는 `timeout_ms`를 넣었는가?
4. shell operator나 redirect 없이 단일 실행 명령으로 썼는가?
5. 외부 generator는 `workdir: dock`과 `export`로 root 출력물을 추적하게 했는가?

release:

1. 로컬 테스트 프로젝트에서 install을 실행해봤는가?
2. 같은 dock을 다시 install해도 block이 중복되지 않는가?
3. 사용자가 managed block/file을 수정했을 때 update가 중단되는가?
4. `--force`가 의도대로 복구하는가?
5. `opendock doctor`가 필요한 상태를 보여주는가?
6. `opendock deploy owner/name@version`으로 제출할 exact version을 정했는가?
7. OS별 동작이 다르면 platform artifact를 각각 deploy/test했는가?
