# dock.yml 작성 가이드

`dock.yml`은 OpenDock dock의 진입점입니다. 어떤 파일을 프로젝트에 넣을지, 기존 파일을 어떻게 보존할지, 설치와 업데이트 때 어떤 명령을 실행할지, doctor에서 어떤 상태를 점검할지를 선언합니다.

이 문서는 현재 OpenDock CLI 구현 기준입니다. 미래에 추가될 수 있는 dock catalog UI나 OpenDock Registry 운영 정책이 아니라, 지금 `src/dock.ts`, `src/installer.ts`, `src/runner.ts`가 실제로 해석하는 형식을 설명합니다.

실제 예제 dock은 `examples/` 아래에 역할별로 나뉘어 있습니다.

| 예제 | 용도 |
|---|---|
| `examples/git/dock.yml` | Git 설치와 프로젝트 초기화를 담당하는 기본 dock |
| `examples/codex/dock.yml` | Codex CLI만 설치하는 기본 dock |
| `examples/claude-code/dock.yml` | Claude Code를 설치하는 dock |
| `examples/oh-my-codex/dock.yml` | Codex CLI와 Oh My Codex를 설치하는 dock |
| `examples/oh-my-openagent/dock.yml` | Codex CLI와 Oh My OpenAgent Codex Light를 설치하는 dock |

## 기본 구조

dock은 보통 다음 구조를 가집니다.

```text
my-dock/
  dock.yml
  templates/
    README.md
    DESIGN.md
    AGENTS.md
    .gitignore
```

최소 `dock.yml`은 다음처럼 쓸 수 있습니다.

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
  - from: templates/README.md
    to: README.md
    update: managed_block
```

권장 형식은 `opendock: 1`입니다. 과거 호환용으로 `schema: opendock/v1`, `kind: starterpack`, `setup`도 파싱되지만 새 dock은 `opendock`, `files`, `lifecycle` 중심으로 작성하는 편이 좋습니다.

## 전체 예제

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
  - from: templates/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: templates/AGENTS.md
    to: AGENTS.md
    update: managed_block

  - from: templates/README.md
    to: README.md
    update: manual_review

  - from: templates/.gitignore
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
    - id: git
      version: ">=2.40.0"
      check: git --version

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

## Top-Level 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `opendock` | 권장 필수 | 현재 지원 버전은 `1`입니다. |
| `schema` | 선택 | 과거 형식 호환용입니다. 값은 `opendock/v1`만 지원합니다. |
| `kind` | 선택 | 과거 형식 호환용입니다. 쓰는 경우 `starterpack`만 지원합니다. |
| `id` | 필수 | dock 식별자입니다. 설치 요청의 `owner/name`과 정확히 같아야 합니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 현재 실행 로직에는 영향이 없습니다. |
| `summary` | 선택 | 설명 문자열입니다. 기본값은 빈 문자열입니다. |
| `version` | 권장 필수 | dock 버전입니다. 없으면 `0.1.0`으로 해석됩니다. |
| `files` | 선택 | 프로젝트에 적용할 템플릿 파일 목록입니다. |
| `lifecycle` | 선택 | `install`, `update`, `doctor` 단계별 명령 목록입니다. |
| `setup` | 선택 | 과거 형식 호환용입니다. `lifecycle.install` 또는 `lifecycle.update`가 비어 있을 때 fallback으로 사용됩니다. |
| `needs` | 선택 | 현재는 파싱만 됩니다. 실제 설치 판단은 `lifecycle`의 `check`, `version`, `run`으로 표현하세요. |

### id 규칙

`id`는 `owner/name` 형식이어야 합니다.

```yaml
id: opendock/codex
```

허용되는 문자는 ASCII 알파벳, 숫자, `.`, `_`, `-`입니다. `.` 단독, `..`, path traversal, 세그먼트 3개 이상은 허용하지 않습니다.

```yaml
# 좋음
id: opendock/codex
id: acme/design-system

# 나쁨
id: codex
id: ../codex
id: opendock/codex/designer
```

## files 작성법

`files`는 dock 안의 파일을 프로젝트 루트로 적용하는 목록입니다.

```yaml
files:
  - from: templates/DESIGN.md
    to: DESIGN.md
    update: managed_block
```

| 필드 | 필수 | 설명 |
|---|---:|---|
| `from` | 필수 | dock root 기준 소스 파일 경로입니다. |
| `to` | 필수 | 설치 대상 프로젝트 기준 경로입니다. |
| `update` | 필수 | 기존 파일이 있을 때의 업데이트 정책입니다. |

`from`, `to`는 안전한 상대 경로여야 합니다. 빈 문자열, 절대 경로, `../` 같은 상위 이동은 거부됩니다. 현재 구현은 파일 단위만 지원합니다. 디렉터리 전체를 관리하는 `managed_tree`는 아직 지원되지 않으므로 필요한 파일을 각각 나열하세요.

### update 정책

#### `managed_block`

기존 파일을 보존하면서 OpenDock이 관리하는 블록만 추가하거나 교체합니다.

```yaml
files:
  - from: templates/AGENTS.md
    to: AGENTS.md
    update: managed_block
```

기존 `AGENTS.md`가 있으면 다음 형태의 블록이 추가됩니다.

```md
<!-- OPENDOCK:START opendock/codex:AGENTS.md -->
...
<!-- OPENDOCK:END opendock/codex:AGENTS.md -->
```

다시 설치하거나 업데이트하면 같은 marker 안의 내용만 교체됩니다. 사용자가 블록 바깥에 쓴 내용은 유지됩니다. `DESIGN.md`, `AGENTS.md`, 규칙 문서처럼 OpenDock이 지속적으로 업데이트해야 하는 파일에 적합합니다.

#### `manual_review`

기존 사용자 파일을 자동으로 바꾸지 않습니다.

```yaml
files:
  - from: templates/README.md
    to: README.md
    update: manual_review
```

파일이 없으면 생성됩니다. 파일이 이미 있고 사용자가 작성한 것으로 보이면 그대로 둡니다. 프로젝트 README처럼 사람의 문맥이 중요하고 자동 병합이 위험한 파일에 적합합니다.

#### `append_unique`

중복되지 않는 라인만 추가합니다.

```yaml
files:
  - from: templates/.gitignore
    to: .gitignore
    update: append_unique
```

`.gitignore`처럼 줄 단위 규칙을 누적해야 하는 파일에 적합합니다. 빈 줄은 무시되고, 같은 라인은 반복 추가되지 않습니다.

### legacy templates 동작

`files`를 비워두고 `templates/`만 둔 과거 형식도 동작합니다. 이 경우 `.gitignore`는 `append_unique`, 나머지 파일은 기존 파일이 있으면 managed block 방식에 가깝게 처리됩니다. 하지만 새 dock은 파일별 의도가 분명한 `files`를 쓰는 것이 좋습니다.

## lifecycle 작성법

`lifecycle`은 세 단계로 나뉩니다.

```yaml
lifecycle:
  install: []
  update: []
  doctor: []
```

| phase | 실행 시점 | 목적 |
|---|---|---|
| `install` | `opendock install owner/name` | 최초 설치, 도구 설치, 프로젝트 적용 |
| `update` | `opendock update` | 이미 설치된 dock을 최신 버전 또는 최신 상태로 갱신 |
| `doctor` | `opendock doctor` | 현재 프로젝트 상태 점검 |

파일 적용은 `install` 또는 `update` lifecycle 실행보다 먼저 일어납니다. lifecycle이 실패하면 실패 로그가 남고, `.opendock` 상태 기록은 완료되지 않습니다.

### lifecycle step 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `id` | 필수 | 단계 식별자입니다. 로그와 doctor 출력에 사용됩니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 없으면 `id`를 사용합니다. |
| `check` | 선택 | 현재 상태를 확인하는 명령입니다. |
| `run` | 선택 | `install` 또는 `update`에서 실행할 명령입니다. |
| `version` | 선택 | `check` 출력에서 읽은 semver가 만족해야 하는 범위입니다. |
| `timeout_ms` | 선택 | 명령 timeout입니다. doctor 기본값은 30000ms입니다. |
| `interactive` | 선택 | TUI나 질문형 명령을 처리하는 방식입니다. |
| `platforms` | 선택 | 같은 step `id`를 유지하면서 `macos`, `windows`, `linux`별 필드를 override합니다. |
| `repair` | 선택 | 현재는 파싱만 됩니다. doctor가 자동 실행하지 않습니다. |
| `copy` | 선택 | 현재는 step을 Ready로만 표시합니다. 파일 복사는 `files`를 사용하세요. |
| `messages` | 선택 | 현재는 파싱만 됩니다. 출력 문구 커스터마이즈에는 아직 연결되어 있지 않습니다. |

### install/update 실행 규칙

`install`과 `update` step은 다음 순서로 처리됩니다.

1. 현재 platform에 맞는 `platforms.<platform>` override가 있으면 공통 step 필드와 병합합니다.
2. `platforms`가 있는데 현재 platform 항목이 없으면 그 step은 건너뜁니다.
3. `check`가 있으면 먼저 실행합니다.
4. `check`가 성공하고 `version`도 만족하면 step은 `Ready`로 표시되고 `run`은 건너뜁니다.
5. `check`가 실패하면 `run`을 실행합니다.
6. `run` 이후 `check`가 있으면 다시 실행해서 실제로 상태가 충족됐는지 확인합니다.
7. `version`이 있으면 `check` 출력에서 첫 번째 `x.y.z` 형태 버전을 읽고 범위를 검사합니다.

따라서 설치 step은 가능하면 `check`, `version`, `run`을 함께 쓰는 것이 좋습니다.

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

위 예시는 `bun --version`이 이미 `>=1.3.0`이면 아무것도 하지 않습니다. 없거나 버전이 낮으면 macOS에서는 `brew install bun`, Windows에서는 `npm install --global bun`을 실행하고, 실행 후 다시 `bun --version`으로 검증합니다.

`check` 없이 `run`만 쓰면 매번 실행됩니다.

```yaml
lifecycle:
  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest
```

도구 업데이트처럼 항상 최신화를 시도해야 하는 작업에는 이 패턴이 맞습니다.

### doctor 실행 규칙

`doctor`는 상태 점검용입니다. `run`이 있으면 `run`을, 없으면 `check`를 실행합니다.

```yaml
lifecycle:
  doctor:
    - id: node
      check: node --version
      version: ">=22.0.0 <25.0.0"

    - id: codex
      check: codex --version
      version: ">=0.0.0"
```

doctor는 실패해도 전체 명령을 즉시 중단하지 않고, 실패한 step을 `!`로 표시합니다. 현재 `repair`는 자동 실행되지 않으므로 doctor에서 발견한 문제를 자동으로 고치고 싶다면 `install` 또는 `update` phase에 해당 `run`을 명시하세요.

### platform별 step override

OpenDock은 top-level `supports.platforms`를 쓰지 않습니다. 지원 플랫폼은 lifecycle step 안의 `platforms` 키에서 자동 추론합니다. `platforms`가 없는 step은 모든 플랫폼에서 실행되는 공통 step입니다.

```yaml
lifecycle:
  install:
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
```

이 예시의 실행 순서는 항상 `install-node` 다음 `install-codex-cli`입니다. `install-node` step 안에서만 현재 platform에 맞는 명령이 선택됩니다. 같은 논리적 작업은 `install-node-macos`, `install-node-windows`처럼 id를 나누지 말고 하나의 `id`와 `platforms`로 묶으세요.

선택 platform은 다음 순서로 결정됩니다.

1. `opendock install owner/name --platform windows`처럼 CLI 옵션을 주면 그 값을 사용합니다.
2. 옵션이 없으면 현재 host OS를 자동 감지합니다. `darwin`은 `macos`, `win32`는 `windows`, `linux`는 `linux`로 매핑됩니다.
3. 설치 후 `.opendock/dock.lock.yml`에 platform을 기록합니다.
4. `opendock update`와 `opendock doctor`는 lock에 기록된 platform을 기본값으로 재사용합니다.

지원 platform은 `macos`, `windows`, `linux`입니다. 현재 MVP의 예시는 macOS와 Windows를 중심으로 작성되어 있습니다.

## version 범위

`version`은 공백으로 구분된 조건을 모두 만족해야 합니다.

```yaml
version: ">=22.0.0 <25.0.0"
```

지원 연산자는 `>=`, `>`, `<=`, `<`, `=`입니다. `check` 출력에서 첫 번째 `x.y.z` 형태의 버전을 읽습니다.

```text
node --version -> v22.18.0
bun --version  -> 1.3.11
codex --version -> codex 0.128.0
```

주의할 점은 출력에 세 자리 버전이 있어야 한다는 것입니다. `1.3`처럼 patch가 없는 출력은 현재 버전 추출에 실패할 수 있습니다.

## 명령어 작성 규칙

OpenDock lifecycle 명령은 shell을 그대로 실행하지 않습니다. 명령 문자열을 안전하게 나눈 뒤 allowlist에 있는 프로그램만 실행합니다.

Homebrew가 없는 macOS에서는 dock을 실행하기 전에 first-party bootstrap을 먼저 실행하세요.

```bash
opendock bootstrap mac
```

이 명령은 `brew`가 이미 PATH에 있으면 그대로 통과하고, `/opt/homebrew/bin/brew` 또는 `/usr/local/bin/brew`에 설치돼 있지만 PATH에 없으면 shellenv 안내를 출력합니다. Homebrew가 아예 없을 때만 공식 Homebrew installer 명령을 보여주고 사용자 확인 후 실행합니다. `dock.yml` 안에서 Homebrew 설치용 `curl | sh`를 직접 실행하는 방식은 허용하지 않습니다.

Codex 설치 dock 예시에서 주로 쓰는 허용 명령은 다음과 같습니다. 전체 runner allowlist는 `src/runner.ts`를 기준으로 확인하세요.

```text
brew
bun
bunx
claude
codex
git
mkdir
node
npm
npx
omo
omx
pip
pip3
pipx
pnpm
python
python3
test
uv
winget
```

`brew`는 macOS target step에서만 허용되고, `winget`은 Windows target step에서만 허용됩니다. 공통 step에 `brew install ...`을 쓰면 Windows target 실행 때 거부됩니다.

다음 shell 연산자는 사용할 수 없습니다.

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

따라서 한 step에 여러 명령을 묶지 말고 step을 나누세요.

```yaml
# 나쁨
- id: install-and-check
  run: npm install --global @openai/codex@latest && codex --version

# 좋음
- id: install-codex-cli
  run: npm install --global @openai/codex@latest

- id: verify-codex-cli
  run: codex --version
```

명령은 shell expansion을 기대하지 않는 방식으로 써야 합니다. `~`, `$HOME`, glob, redirect, pipe가 필요한 복잡한 작업은 현재 MVP에서 직접 지원하지 않습니다. 그런 작업이 필요하면 dock 자체의 파일 적용이나 allowlist에 있는 도구의 단일 명령으로 표현할 수 있는지 먼저 확인하세요.

## interactive 작성법

대화형 명령은 두 가지 방식으로 지원합니다.

### 사용자가 직접 조작하는 방식

```yaml
lifecycle:
  install:
    - id: open-codex-login
      interactive: user
      run: codex
      timeout_ms: 600000
```

`interactive: user`는 실제 터미널 TTY가 필요합니다. CI나 비대화형 프로세스에서 실행하면 실패합니다. `codex`처럼 사용자가 화면을 보고 직접 로그인하거나 선택해야 하는 TUI에 적합합니다.

### 승인된 키 입력을 자동 전달하는 방식

```yaml
lifecycle:
  install:
    - id: scripted-codex-open
      run: codex
      interactive:
        mode: scripted
        cols: 100
        rows: 30
        inputs:
          - key: tab
          - key: enter
      timeout_ms: 600000
```

`interactive: scripted`는 macOS의 `expect`를 사용해 pseudo-terminal에서 키 입력을 보냅니다. 승인된 OpenDock Registry dock에서만 신중하게 쓰는 것이 좋습니다.

지원하는 key 값은 다음과 같습니다.

```text
backspace
down
enter
escape
left
right
space
tab
up
```

반복 입력은 `repeat`으로 표현합니다.

```yaml
inputs:
  - key: tab
    repeat: 3
  - key: enter
```

텍스트 입력도 가능합니다.

```yaml
inputs:
  - text: my-project-name
  - key: enter
```

문자열을 바로 넣으면 그대로 입력됩니다.

```yaml
inputs:
  - "hello"
  - key: enter
```

## install과 update를 다르게 설계하기

`install`은 최초 적용입니다. 없는 도구를 설치하고 프로젝트에 dock을 적용하는 데 집중하세요.

```yaml
lifecycle:
  install:
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
```

`update`는 유지보수입니다. 이미 설치된 프로젝트를 최신 상태로 다시 맞추는 데 집중하세요.

```yaml
lifecycle:
  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000
```

파일 업데이트는 `files[].update` 정책에 따라 `update`에서도 다시 적용됩니다. 예를 들어 `managed_block` 파일은 OpenDock block이 새 dock 내용으로 교체되고, `append_unique`는 새 라인만 추가됩니다.

## 기존 프로젝트 파일을 보호하는 기준

dock은 사용자가 이미 작성한 파일을 함부로 덮어쓰면 안 됩니다.

권장 기준은 다음과 같습니다.

| 파일 종류 | 권장 update 정책 | 이유 |
|---|---|---|
| `DESIGN.md` | `managed_block` | 디자인 시스템 기본값은 업데이트되어야 하지만 사용자 메모도 남아야 합니다. |
| `AGENTS.md` | `managed_block` | OpenDock/Codex 작업 규칙 영역을 명확히 분리할 수 있습니다. |
| `README.md` | `manual_review` | 프로젝트 설명은 사용자 문맥이 강합니다. |
| `.gitignore` | `append_unique` | 라인 단위 누적이 자연스럽고 중복을 피할 수 있습니다. |
| 설정 파일 일부 | `managed_block` | 파일 전체보다 관리 영역만 교체하는 편이 안전합니다. |

`managed_block` 안의 내용은 OpenDock이 업데이트하는 영역으로 보는 것이 맞습니다. 사용자가 직접 고칠 수는 있지만, 다음 update에서 dock 내용으로 바뀔 수 있습니다. 사용자 고유 내용은 block 바깥에 쓰는 방식이 안전합니다.

## 보안과 배포 기준

OpenDock은 프로젝트 설정을 실행하는 도구이므로 dock source를 런타임 환경변수로 바꿀 수 없게 고정합니다. 현재 registry는 `https://registry.opendock.app`입니다.

사람이 탐색하는 dock catalog는 `https://registry.opendock.app`, CLI가 사용하는 registry API root는 `https://registry.opendock.app/v1/docks`입니다.

배포 흐름은 다음 원칙을 따릅니다.

1. dock author가 `dock.yml`과 `templates/`를 작성합니다.
2. `opendock auth login`으로 로그인합니다.
3. `opendock deploy <dock-name>`으로 제출합니다.
4. OpenDock Registry 검토를 통과한 dock만 registry에서 설치될 수 있습니다.

`install`은 공개 명령이지만, 설치 대상 dock은 승인된 registry metadata, signature, checksum 검증을 통과해야 합니다.

## 작성 체크리스트

`dock.yml`을 만들 때는 다음 순서로 확인하세요.

1. `id`가 설치 명령의 `owner/name`과 같은가?
2. `opendock: 1`을 선언했는가?
3. `version`을 명시했는가?
4. 모든 `files[].from` 파일이 실제로 존재하는가?
5. `files[].to`가 프로젝트 루트 기준 안전한 상대 경로인가?
6. 기존 사용자 파일에 맞는 update 정책을 골랐는가?
7. `install` step은 `check`로 idempotent하게 설계했는가?
8. 버전이 중요한 도구에는 `version` 범위를 넣었는가?
9. `update`는 최초 설치가 아니라 유지보수 관점으로 작성했는가?
10. `doctor`는 상태 점검만 하도록 구성했는가?
11. 대화형 명령은 `interactive: user` 또는 승인된 `interactive: scripted`로 명시했는가?
12. shell operator, pipe, redirect, command substitution을 쓰지 않았는가?
13. 한 step에 여러 명령을 묶지 않고 단계별로 나눴는가?
14. 오래 걸리는 명령에는 `timeout_ms`를 넣었는가?
15. macOS/Windows 명령이 다르면 같은 `id` 아래 `platforms`로 묶었는가?
16. 공통 step에 `brew`, `winget`처럼 특정 OS 전용 package manager를 넣지 않았는가?
17. `repair`, `messages`, `copy`, `needs`에 자동 동작을 기대하지 않았는가?

## 추천 작성 순서

처음부터 큰 dock을 만들기보다 아래 순서로 작성하면 실수가 줄어듭니다.

1. `id`, `version`, 최소 `files` 한 개만 둔 `dock.yml`을 만든다.
2. `README.md`, `DESIGN.md`, `AGENTS.md`, `.gitignore` 순서로 파일 정책을 정한다.
3. `doctor`에 필요한 도구 버전 점검을 먼저 쓴다.
4. `install`에 doctor 실패를 고칠 수 있는 설치 step을 추가한다.
5. `update`에 유지보수 step을 추가한다.
6. 대화형 step은 마지막에 추가하고 timeout을 넉넉히 둔다.
7. dock 제출 전에 사용자 파일이 보존되는지, 재실행해도 중복 block이 생기지 않는지 확인한다.

## 자주 쓰는 패턴

### Git이 없으면 초기화

```yaml
lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main
```

이미 Git 저장소이면 `git status`가 성공하므로 `git init`을 건너뜁니다.

### Node/npm 설치 확인

```yaml
lifecycle:
  install:
    - id: install-node
      check: node --version
      version: ">=22.0.0 <25.0.0"
      platforms:
        macos:
          run: brew install node
        windows:
          run: winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
```

Codex CLI를 npm으로 설치하려면 Node와 npm이 필요합니다. macOS에서는 Homebrew, Windows에서는 winget으로 Node LTS를 준비하는 패턴이 가장 단순합니다.

Homebrew가 아직 없다면 `opendock install` 전에 다음을 먼저 실행합니다.

```bash
opendock bootstrap mac
```

### Codex CLI 설치

```yaml
lifecycle:
  install:
    - id: install-codex-cli
      check: codex --version
      version: ">=0.0.0"
      run: npm install --global @openai/codex@latest

  doctor:
    - id: codex
      check: codex --version
      version: ">=0.0.0"
```

OpenAI 공식 문서는 macOS/Linux standalone installer를 우선 안내하지만, OpenDock lifecycle은 pipe와 `curl | sh`를 차단합니다. 따라서 `dock.yml`에서는 Codex GitHub README에 함께 안내된 npm 또는 Homebrew 설치 경로를 사용하세요. 이 가이드는 npm 경로를 기본 예시로 사용합니다.

### Codex CLI 업데이트

```yaml
lifecycle:
  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000
```

### Claude Code 설치 예시

```yaml
lifecycle:
  install:
    - id: install-claude-code
      check: claude --version
      version: ">=0.0.0"
      run: npm install --global @anthropic-ai/claude-code@latest

  update:
    - id: update-claude-code
      run: npm install --global @anthropic-ai/claude-code@latest

  doctor:
    - id: claude-code
      check: claude --version
      version: ">=0.0.0"
```

Anthropic 공식 문서는 npm 글로벌 설치를 지원하며, 업그레이드도 `npm install -g @anthropic-ai/claude-code@latest`를 권장합니다. `sudo npm install -g`는 피하세요.

### Oh My OpenAgent 설치 예시

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

    - id: install-oh-my-openagent-codex
      check: bunx oh-my-openagent doctor
      run: bunx oh-my-openagent install --no-tui --platform=codex --codex-autonomous
      timeout_ms: 600000

  update:
    - id: update-oh-my-openagent-codex
      run: bunx oh-my-openagent install --no-tui --platform=codex --codex-autonomous
      timeout_ms: 600000

  doctor:
    - id: bun
      check: bun --version
      version: ">=1.3.0"

    - id: oh-my-openagent
      check: bunx oh-my-openagent doctor
      timeout_ms: 60000
```

Oh My OpenAgent는 OpenCode용 Ultimate와 Codex용 Light 구성이 나뉩니다. Codex 설치 dock에서는 `--platform=codex`를 명시하세요. 공식 문서의 Codex-only 예시는 `npx lazycodex-ai install --no-tui --codex-autonomous`도 안내합니다. OpenDock에서는 둘 중 하나를 dock 정책으로 정해 일관되게 쓰면 됩니다.

### Oh My Codex 설치 예시

```yaml
lifecycle:
  install:
    - id: install-oh-my-codex
      check: omx doctor
      run: npm install --global oh-my-codex@latest

  update:
    - id: update-oh-my-codex
      run: npm install --global oh-my-codex@latest

  doctor:
    - id: oh-my-codex
      check: omx doctor
      timeout_ms: 60000
```

## 현재 MVP에서 피해야 할 것

- `requires.tools` 같은 별도 의존성 블록에 자동 설치를 기대하지 마세요. 현재는 lifecycle로 표현해야 합니다.
- `managed_tree`로 디렉터리 전체를 관리하려고 하지 마세요. 현재는 파일 단위 `files`만 지원합니다.
- `repair`가 doctor 실패를 자동 수정한다고 기대하지 마세요.
- shell script처럼 `&&`, pipe, redirect를 쓰지 마세요.
- 검증 없이 `run`만 늘어놓지 마세요. 가능한 step에는 `check`를 붙여 재실행해도 안전하게 만드세요.
- 사용자 README처럼 문맥이 중요한 파일에 `managed_block`을 무조건 쓰지 마세요. `manual_review`가 더 나을 수 있습니다.

## 빠른 템플릿

새 dock을 만들 때 아래 템플릿에서 시작하세요.

```yaml
opendock: 1
id: owner/name
version: 0.1.0

files:
  - from: templates/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: templates/AGENTS.md
    to: AGENTS.md
    update: managed_block

  - from: templates/README.md
    to: README.md
    update: manual_review

  - from: templates/.gitignore
    to: .gitignore
    update: append_unique

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
