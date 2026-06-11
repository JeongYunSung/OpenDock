# dock.yml 작성 가이드

OpenDock의 핵심 문구는 다음과 같습니다.

> **Simple AI setup for every workspace.**
>
> Choose the docks you need, combine them your way, and keep every project AI-ready.

`dock.yml`은 이 문구를 실제 프로젝트에 적용하는 manifest입니다. 어떤 dock을
선택하고 조합할 수 있게 만들지, 어떤 파일을 프로젝트에 넣을지, 어떤 명령을
설치와 업데이트 때 실행할지, 외부 도구가 만든 결과물 중 무엇을 root로 export할지,
doctor가 어떤 상태를 점검할지를 선언합니다.

이 문서는 현재 TypeScript CLI 구현 기준입니다. 핵심 구현은 `src/core/` 아래에
있습니다.

| 영역 | 구현 |
|---|---|
| manifest parsing | `src/core/domain/manifest.ts` |
| install/update/uninstall orchestration | `src/core/app/dock-installer.ts` |
| managed block/checksum file engine | `src/core/files/` |
| lifecycle command runner | `src/core/runtime/` |
| registry resolve/deploy boundary | `src/resolver.ts`, `src/cli.ts` |

## 목차

- [작성 전 결정할 것](#작성-전-결정할-것)
- [dock package 구조](#dock-package-구조)
- [최소 예제](#최소-예제)
- [전체 예제](#전체-예제)
- [Top-Level 필드](#top-level-필드)
- [id와 version](#id와-version)
- [readme와 logo](#readme와-logo)
- [requires](#requires)
- [files](#files)
- [파일 소유권](#파일-소유권)
- [lifecycle](#lifecycle)
- [workdir와 export](#workdir와-export)
- [platforms](#platforms)
- [version 범위](#version-범위)
- [허용 명령](#허용-명령)
- [install, update, uninstall 의미](#install-update-uninstall-의미)
- [충돌 처리](#충돌-처리)
- [deploy와 archive](#deploy와-archive)
- [예제 dock 목록](#예제-dock-목록)
- [작성 체크리스트](#작성-체크리스트)

## 작성 전 결정할 것

dock을 작성하기 전에 네 가지를 먼저 정하세요.

1. **대상 결과**: 단순 도구 설치인지, 특정 직군/워크플로우용 AI-ready workspace인지 정합니다.
2. **root에 남길 파일**: `AGENTS.md`, `.agents/`, `.codex/`, `DESIGN.md`처럼 프로젝트가 실제로 읽을 파일을 정합니다.
3. **명령 실행 위치**: 프로젝트 root에서 실행할지, dock 전용 workdir에서 실행한 뒤 export할지 정합니다.
4. **필요한 도구**: Node, Bun, npm, OMA 같은 runtime/package requirement를 정합니다.
5. **유지보수 방식**: update 때 최신 package를 다시 설치할지, doctor로 상태만 확인할지 정합니다.

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

`readme`와 `logo`는 catalog metadata입니다. 설치 대상 프로젝트에 자동으로
복사되지 않습니다. 프로젝트에도 설치하려면 `files`에 별도로 선언해야 합니다.

## 최소 예제

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

이 manifest는 `files/AGENTS.md`를 프로젝트의 `AGENTS.md`에 적용합니다. 대상이
Markdown 파일이므로 OpenDock은 파일 전체를 덮어쓰지 않고 managed block을
추가하거나 갱신합니다.

## 전체 예제

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md

  - from: files/.github/copilot-instructions.md
    to: .github/copilot-instructions.md

lifecycle:
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

실행 순서는 위에서 아래입니다. `platforms` override를 쓰더라도 step의 위치는
바뀌지 않습니다.

## Top-Level 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `opendock` | 필수 | 현재 지원 manifest version은 `1`입니다. |
| `id` | 필수 | dock id입니다. `owner/name` 형식입니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 실행 로직에는 영향이 없습니다. |
| `summary` | 선택 | Registry catalog에 표시할 짧은 설명입니다. |
| `readme` | 선택 | Registry catalog 상세 본문으로 제출할 Markdown 경로입니다. |
| `logo` | 선택 | Registry catalog 대표 이미지로 제출할 이미지 경로입니다. |
| `requires` | 선택 | dock 실행 전에 준비할 runtime과 package requirement입니다. |
| `files` | 선택 | 프로젝트 root로 적용할 파일 또는 디렉터리 mapping입니다. |
| `lifecycle` | 선택 | `install`, `update`, `doctor` 단계별 command 목록입니다. |

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

## readme와 logo

`readme`와 `logo`는 사람이 보는 Registry catalog용 metadata입니다.

```yaml
readme: DOCK.md
logo: logo.png
```

주의할 점:

- 둘 다 dock root 안의 안전한 상대 경로여야 합니다.
- 절대 경로와 `../` path traversal은 거부됩니다.
- 설치 대상 프로젝트에 자동 복사되지 않습니다.
- 설치 archive에는 기본 포함되지 않고 deploy submission metadata로 별도 제출됩니다.
- `readme`는 Markdown 파일이며 최대 65536 bytes까지 제출됩니다.
- `logo`는 PNG, JPEG, WebP만 허용하며 최대 524288 bytes까지 제출됩니다.
- CLI는 logo 확장자와 실제 file signature가 맞는지 검사합니다.

## requires

`requires`는 dock을 실행하기 전에 OpenDock이 준비해야 하는 host runtime과 CLI
package를 선언합니다. 프로젝트에 복사되는 파일이 아니라 system/tool scope에 대한
요구사항입니다.

```yaml
requires:
  runtimes:
    bun: ">=1.3.0"

  packages:
    oma:
      manager: bun
      name: oh-my-agent
      version: ">=8.43.0"
```

동작:

1. install/update/doctor 전에 `requires`를 먼저 평가합니다.
2. `runtimes`는 `node --version`, `bun --version` 같은 runtime check를 수행합니다.
3. install/update에서 runtime이 없거나 version을 만족하지 않으면 OpenDock이 아는
   platform별 installer를 실행합니다.
4. `packages`는 package manager의 설치 metadata로 package version을 확인합니다.
5. install에서 package가 이미 version을 만족하면 건너뜁니다.
6. update에서는 package installer를 다시 실행해 최신 package를 반영한 뒤 version을
   재확인합니다.
7. doctor에서는 설치나 수정 없이 상태만 확인합니다.

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

현재 지원 package manager:

```text
bun
npm
pnpm
pip
pip3
pipx
uv
```

예시:

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"
  packages:
    codex:
      manager: npm
      name: "@openai/codex"
      version: ">=0.0.0"
```

주의할 점:

- `requires`는 OpenDock이 host tool을 준비하는 영역입니다.
- root에 적용할 파일은 `files` 또는 `lifecycle[].export`로 선언해야 합니다.
- raw shell, pipe, redirect는 `requires`에서도 허용되지 않습니다.
- package key는 OpenDock report/lock에서 쓰는 이름입니다.
- `name`은 package manager가 설치하고 version을 확인할 실제 package 이름입니다.
- 설치된 CLI를 실행해야 한다면 `requires`가 아니라 `lifecycle`에 command를 작성합니다.

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

Markdown, text, common agent instruction 파일은 managed block으로 적용됩니다.

대상:

- `.md`
- `.mdc`
- `.txt`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

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

## lifecycle

`lifecycle`은 세 phase를 가집니다.

```yaml
lifecycle:
  install: []
  update: []
  doctor: []
```

| phase | 실행 명령 | 목적 |
|---|---|---|
| `install` | `opendock install owner/name@version` | 최초 적용과 초기 생성 작업 |
| `update` | `opendock update` | 최신 approved release로 이동하며 유지보수 작업 실행 |
| `doctor` | `opendock doctor` | 현재 프로젝트와 도구 상태 점검 |

### lifecycle step 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `id` | 필수 | step identifier입니다. 로그와 doctor 출력에 사용됩니다. |
| `name` | 선택 | 사람이 읽는 step 이름입니다. 없으면 `id`를 사용합니다. |
| `check` | 선택 | 현재 상태를 확인하는 command입니다. |
| `run` | 선택 | install/update에서 실행할 command입니다. |
| `version` | 선택 | `check` 출력에서 추출한 semver가 만족해야 하는 범위입니다. |
| `timeout_ms` | 선택 | command timeout입니다. doctor 기본값은 30000ms입니다. |
| `workdir` | 선택 | `root` 또는 `dock`입니다. 기본값은 `root`입니다. |
| `export` | 선택 | `workdir: dock` 결과물 중 root로 적용할 glob입니다. |
| `platforms` | 선택 | 같은 `id` 아래 platform별 field override입니다. |

### install/update 실행 규칙

1. 현재 platform에 맞는 `platforms.<platform>` override를 병합합니다.
2. `platforms`가 있는데 현재 platform 항목이 없으면 step을 건너뜁니다.
3. `check`가 있으면 먼저 실행합니다.
4. `check`가 성공하고 `version`도 만족하면 `run`을 건너뜁니다.
5. `check`가 실패하면 `run`을 실행합니다.
6. `run` 이후 `check`가 있으면 다시 실행합니다.
7. post-check가 실패하면 install/update는 실패합니다.
8. 성공한 step의 export가 있으면 export 후보를 수집합니다.

도구와 CLI package 준비는 가능하면 `requires`에 선언하세요. `lifecycle`은 프로젝트
root에서 실행해야 하는 작업이나 dock workdir에서 generator를 돌린 뒤 export하는
작업에 집중하는 것이 좋습니다.

재실행 가능한 lifecycle step에는 `check`, `version`, `run`을 같이 쓸 수 있습니다.

```yaml
lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main
```

`check` 없이 `run`만 쓰면 해당 phase마다 항상 실행됩니다.

### doctor 실행 규칙

doctor는 상태 점검용입니다.

- `run`이 있으면 `run`을 실행합니다.
- `run`이 없으면 `check`를 실행합니다.
- 실패한 step은 `!`로 표시하지만 다른 doctor step은 계속 실행합니다.
- 자동 수정이 필요하면 doctor가 아니라 `install` 또는 `update`에 `run`을 쓰세요.

```yaml
lifecycle:
  doctor:
    - id: node
      check: node --version
      version: ">=22.0.0"
```

## workdir와 export

OpenDock의 command 실행 위치는 두 가지입니다.

| workdir | 위치 | 용도 |
|---|---|---|
| `root` | 프로젝트 root | `git init`, root 상태 확인, project-level command |
| `dock` | `.opendock/workdirs/<dock>/` | 외부 generator를 격리 실행한 뒤 결과물 export |

`workdir: dock`은 외부 도구가 여러 파일을 만들어내는 경우에 유용합니다.

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

동작:

1. command는 dock 전용 workdir에서 실행됩니다.
2. OpenDock은 `export.include`에 맞는 파일만 후보로 수집합니다.
3. `export.exclude`에 맞는 파일은 제외합니다.
4. 후보 파일은 root로 즉시 복사되지 않습니다.
5. 모든 `files`와 `export` 후보를 합쳐 preflight를 통과한 뒤 root에 적용합니다.

이 구조 덕분에 `oma`, `omx`, `npx ... install` 같은 외부 generator와 협력하면서도
프로젝트 root에 들어온 최종 파일은 OpenDock이 추적할 수 있습니다.

## platforms

OpenDock은 top-level `supports.platforms`를 쓰지 않습니다. 지원 platform은
lifecycle step 안의 `platforms`에서 자동 추론합니다.

지원 값:

- `macos`
- `windows`
- `linux`

예시:

```yaml
lifecycle:
  doctor:
    - id: host-package-manager
      platforms:
        macos:
          run: brew --version
        windows:
          run: winget --version
```

platform별 차이는 해당 step 안에서만 선택됩니다. 같은 작업을
`host-package-manager-macos`, `host-package-manager-windows`처럼 여러 id로 나누지
않는 것이 좋습니다.

platform 결정 순서:

1. CLI의 `--platform` 옵션.
2. host OS 자동 감지.
3. install 후 lock에 기록된 platform.
4. update/doctor는 lock의 platform을 기본으로 재사용.

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
semver를 출력하는 command를 `check`로 사용하세요.

## 허용 명령

OpenDock은 `requires`와 `lifecycle` command에 shell script를 그대로 넘기지
않습니다. command string을 분리한 뒤 allowlist와 command shape 검사를 통과한
프로그램만 실행합니다.

현재 공통 허용 command:

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

platform별 추가 command:

| platform | 추가 command |
|---|---|
| `macos` | `brew` |
| `windows` | `winget` |
| `linux` | 없음 |

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

전체 allowlist와 command shape는 `src/core/runtime/command-runner.ts`가 기준입니다.

### Homebrew bootstrap

macOS에서 Homebrew가 없으면 dock 실행 전에 first-party bootstrap을 먼저 실행합니다.

```bash
opendock bootstrap mac
```

`dock.yml` 안에서 Homebrew 설치용 `curl | sh`를 직접 실행하는 방식은 허용하지
않습니다.

## install, update, uninstall 의미

### install

`install`은 특정 exact release를 현재 프로젝트에 적용합니다.

```bash
opendock install owner/name@1.0.0
```

이미 같은 dock이 설치되어 있다면 이전 lock의 checksum을 기준으로 기존 관리
파일을 먼저 검증한 뒤 새 release를 적용합니다. 특정 release로 이동하고 싶을 때도
`install owner/name@new-version`을 사용할 수 있습니다.

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
하지만 `--force`는 임의 shell command를 허용하거나 path safety를 우회하지 않습니다.

## deploy와 archive

release version은 `dock.yml`에 쓰지 않습니다. deploy command에서 정합니다.

```bash
opendock deploy owner/name@1.0.0
```

deploy가 제출하는 것:

1. `dock.yml` 원문.
2. `dock.yml`과 `files[].from`으로 만든 `.tgz` archive.
3. optional `readme_markdown`.
4. optional `logo`.

archive에는 기본적으로 다음이 들어갑니다.

- `dock.yml`
- `files[].from`에 명시된 파일과 디렉터리의 regular files

`readme`와 `logo`는 catalog metadata로 별도 제출되므로 archive에는 기본 포함되지
않습니다. 설치 프로젝트에 들어가야 하는 파일이라면 `files`에 명시하세요.

deploy는 Registry login이 필요합니다.

```bash
opendock auth login
opendock auth status
opendock deploy owner/name@1.0.0
```

## 예제 dock 목록

예제는 `examples/` 아래에 있으며, “고르고 조합한다”는 제품 방향에 맞춰 세 그룹으로
관리합니다.

### Tool docks

Tool dock은 특정 CLI나 외부 setup engine을 준비합니다. project payload를 최소화하고
다른 outcome/utility dock과 조합하는 것을 전제로 합니다.

| 예제 | 용도 |
|---|---|
| `examples/codex/dock.yml` | Codex CLI 설치 |
| `examples/claude-code/dock.yml` | Claude Code 설치 |
| `examples/oma/dock.yml` | Oh My Agent 실행 결과를 OpenDock export로 적용 |

### Outcome docks

Outcome dock은 특정 직군이나 작업 결과를 위한 AI-ready workspace 파일을 설치합니다.
도구 설치는 하지 않으며, `opendock/codex`, `opendock/claude-code`, `opendock/oma`
같은 tool dock과 함께 조합합니다.

| 예제 | 용도 |
|---|---|
| `examples/designer-ai/dock.yml` | UI/UX/product design workspace |
| `examples/product-manager/dock.yml` | PRD, user story, roadmap, release workspace |
| `examples/frontend-ai/dock.yml` | React/Next.js frontend engineering workspace |
| `examples/startup-founder/dock.yml` | founder strategy workspace |
| `examples/ai-automation/dock.yml` | internal automation and workflow design workspace |
| `examples/ui-case-study/dock.yml` | UI/UX portfolio case study workspace |

### Utility docks

Utility dock은 여러 outcome dock과 같이 섞어 쓰는 보조 harness입니다.

| 예제 | 용도 |
|---|---|
| `examples/agent-ready/dock.yml` | 여러 AI coding agent용 공통 instruction |
| `examples/agent-safety/dock.yml` | AI-generated change review와 security safety rails |
| `examples/repo-context/dock.yml` | repository context packaging과 analysis prompts |
| `examples/mcp-safe/dock.yml` | security-first MCP reference |
| `examples/dev-env/dock.yml` | project-local tool versions와 validation task reference |

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
3. release version을 `dock.yml`이 아니라 deploy command에서 정했는가?
4. `readme`와 `logo`가 dock root 안의 실제 파일인가?

requires:

1. 필요한 runtime을 `requires.runtimes`에 선언했는가?
2. 필요한 CLI package를 `requires.packages`에 선언했는가?
3. package key와 실제 package name의 역할을 혼동하지 않았는가?
4. runtime/package version 범위가 실제 installer 결과와 충돌하지 않는가?

files:

1. 모든 `files[].from`이 존재하는가?
2. `files[].to`가 프로젝트 root 기준 안전한 상대 경로인가?
3. Markdown/agent instruction은 managed block으로 적용되는지 확인했는가?
4. 설정 파일이나 binary는 checksum managed file로 충돌 감지되는지 확인했는가?

lifecycle:

1. 재실행 가능한 step에는 `check`를 붙였는가?
2. 버전이 중요한 도구에는 `version` 범위를 넣었는가?
3. 오래 걸리는 command에는 `timeout_ms`를 넣었는가?
4. platform 차이는 같은 step `id`의 `platforms`로 묶었는가?
5. shell operator나 redirect 없이 단일 command로 썼는가?
6. 외부 generator는 `workdir: dock`과 `export`로 root 출력물을 추적하게 했는가?

release:

1. 로컬 테스트 프로젝트에서 install을 실행해봤는가?
2. 같은 dock을 다시 install해도 block이 중복되지 않는가?
3. 사용자가 managed block/file을 수정했을 때 update가 중단되는가?
4. `--force`가 의도대로 복구하는가?
5. `opendock doctor`가 필요한 상태를 보여주는가?
6. `opendock deploy owner/name@version`으로 제출할 exact version을 정했는가?
