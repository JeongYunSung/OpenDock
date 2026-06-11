# dock.yml 작성 가이드

OpenDock의 모토는 **Simple AI setup for every workspace**입니다. `dock.yml`은 이 모토를 실제 프로젝트에 적용하는 진입점입니다. 검토된 AI 설정팩이 어떤 파일을 프로젝트에 넣을지, 기존 파일을 어떻게 보존할지, 설치와 업데이트 때 어떤 명령을 실행할지, doctor에서 어떤 상태를 점검할지를 선언합니다.

이 문서는 현재 OpenDock CLI 구현 기준입니다. 미래에 추가될 수 있는 dock catalog UI나 OpenDock Registry 운영 정책이 아니라, 지금 `src/dock.ts`, `src/installer.ts`, `src/runner.ts`가 실제로 해석하는 형식을 설명합니다.

실제 예제 dock은 `examples/` 아래에 역할별로 나뉘어 있습니다.

| 예제 | 용도 |
|---|---|
| `examples/git/dock.yml` | Git 설치와 프로젝트 초기화를 담당하는 기본 dock |
| `examples/codex/dock.yml` | Codex CLI만 설치하는 dock |
| `examples/oma/dock.yml` | 파일 payload 없이 Oh My Agent를 적용하는 dock |
| `examples/claude-code/dock.yml` | Claude Code를 설치하는 dock |
| `examples/oh-my-codex/dock.yml` | Oh My Codex를 설치하고 `omx setup`을 실행하는 dock |
| `examples/oh-my-openagent/dock.yml` | Oh My OpenAgent Codex Light를 설치하는 dock |
| `examples/agent-ready/dock.yml` | 여러 AI coding agent용 instruction 파일을 설치하는 dock |
| `examples/ai-context/dock.yml` | AI-friendly repository context export 설정을 설치하는 dock |
| `examples/mcp-local/dock.yml` | project-local MCP 설정 예시를 설치하는 dock |
| `examples/agent-safety/dock.yml` | AI-generated changes를 위한 PR/security safety rails를 설치하는 dock |
| `examples/agent-docs/dock.yml` | AI가 읽기 쉬운 운영 문서 하네스를 설치하는 dock |

## 기본 구조

dock은 보통 다음 구조를 가집니다.

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    README.md
    DESIGN.md
    AGENTS.md
    .gitignore
```

최소 `dock.yml`은 다음처럼 쓸 수 있습니다.

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

files:
  - from: files/AGENTS.md
    to: AGENTS.md
    update: managed_block
```

`from` 경로는 dock root 기준입니다. `files/`는 예시에서 쓰는 권장 폴더명일 뿐입니다. OpenDock은 `files` 목록에 명시된 항목만 프로젝트에 적용합니다.

`readme`와 `logo`는 설치 대상 프로젝트에 복사되는 파일이 아니고 `.tgz` 설치 archive에도 기본 포함되지 않습니다. `opendock deploy`가 Registry review submission을 만들 때 catalog 상세 페이지용 메타데이터로만 함께 제출합니다. GitHub의 repository `README.md`처럼 사람이 dock을 이해하기 위한 문서는 `DOCK.md`, catalog 목록에서 보일 대표 이미지는 `logo.png` 같은 별도 파일에 둡니다.

현재 형식은 `opendock: 1`입니다. 새 dock은 `opendock`, `files`, `lifecycle` 중심으로 작성하세요.

## 전체 예제

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

files:
  - from: files/AGENTS.md
    to: AGENTS.md
    update: managed_block

  - from: files/.cursor/rules/project.mdc
    to: .cursor/rules/project.mdc
    update: managed_file

  - from: files/.github/copilot-instructions.md
    to: .github/copilot-instructions.md
    update: managed_file

lifecycle:
  doctor:
    - id: agents-md
      check: test -f AGENTS.md

    - id: cursor-rules
      check: test -f .cursor/rules/project.mdc
```

## Top-Level 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `opendock` | 필수 | 현재 지원 버전은 `1`입니다. |
| `id` | 필수 | dock 식별자입니다. 설치 요청의 `owner/name`과 정확히 같아야 합니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 현재 실행 로직에는 영향이 없습니다. |
| `summary` | 선택 | 설명 문자열입니다. 기본값은 빈 문자열입니다. |
| `readme` | 선택 | Registry 제출 시 catalog 상세 본문으로 함께 전송할 Markdown 파일 경로입니다. 예: `DOCK.md`. |
| `logo` | 선택 | Registry 제출 시 catalog 대표 이미지로 함께 전송할 PNG, JPEG, WebP 파일 경로입니다. 예: `logo.png`. |
| `files` | 선택 | 프로젝트에 적용할 파일 목록입니다. |
| `lifecycle` | 선택 | `install`, `update`, `doctor` 단계별 명령 목록입니다. |
| `needs` | 선택 | 현재는 파싱만 됩니다. 실제 설치 판단은 `lifecycle`의 `check`, `version`, `run`으로 표현하세요. |

### readme

`readme`는 dock package 내부의 Markdown 문서를 가리키는 안전한 상대 경로입니다.

```yaml
readme: DOCK.md
```

`opendock deploy`는 이 경로가 있으면 파일 내용을 `readme_markdown`으로 Registry submission에 포함합니다. Registry가 승인한 버전의 본문은 Registry 상세 API의 `readmeMarkdown`으로 내려가며, catalog 페이지에서는 dock 제목, 요약 설명, 설치 명령과 함께 표시할 수 있습니다.

주의할 점은 다음과 같습니다.

- `readme` 파일은 설치 대상 프로젝트에 자동 복사되지 않습니다. 프로젝트에 복사하려면 `files`에도 별도로 선언해야 합니다.
- 경로는 dock root 안에 있어야 하며 절대 경로나 `../`로 바깥을 가리키면 deploy가 실패합니다.
- 현재 CLI는 deploy 시 최대 65536 bytes까지 제출합니다.

### logo

`logo`는 dock package 내부의 이미지 파일을 가리키는 안전한 상대 경로입니다.

```yaml
logo: logo.png
```

`opendock deploy`는 이 경로가 있으면 파일을 읽어 Registry submission의 `logo` 객체로 포함합니다. 전송 형식은 `filename`, `content_type`, `data_base64`이며 Registry가 승인한 버전의 catalog 목록과 상세 화면에서 대표 이미지로 사용할 수 있습니다.

주의할 점은 다음과 같습니다.

- `logo` 파일은 설치 대상 프로젝트에 자동 복사되지 않습니다. 프로젝트에 복사하려면 `files`에도 별도로 선언해야 합니다.
- 경로는 dock root 안에 있어야 하며 절대 경로나 `../`로 바깥을 가리키면 deploy가 실패합니다.
- 허용 타입은 PNG, JPEG, WebP입니다. SVG는 실행 가능한 내용을 담을 수 있어 제출하지 않습니다.
- 현재 CLI는 deploy 시 최대 524288 bytes까지 제출합니다.
- CLI는 확장자와 실제 파일 바이트가 맞는지 확인합니다. 예를 들어 `logo.png`가 실제 PNG가 아니면 deploy가 실패합니다.

### id 규칙

`id`는 `owner/name` 형식이어야 합니다. 설치 명령에서는 뒤에 정확한 `@version` identifier를 붙여야 하지만, `dock.yml`의 `id`에는 version을 쓰지 않습니다.

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

### 버전 identifier

설치할 때는 `@` 뒤에 정확한 version identifier를 반드시 붙입니다. OpenDock은 version을 semantic version으로 정렬하지 않고, Registry가 돌려준 version과 요청한 identifier를 정확히 비교합니다.

```bash
opendock install opendock/codex@1.0.0
opendock install opendock/codex@1.5.2
opendock install opendock/codex@designer-build
```

install에서 version이 없거나 `@latest`를 쓰면 실패합니다. `1.5.2`나 `designer-build`는 exact version identifier 요청입니다. OpenDock은 `.opendock/dock.lock.yml`에 사용자가 요청한 version identifier와 Registry가 돌려준 exact version을 함께 기록합니다.

```yaml
docks:
  - id: opendock/codex
    requested: 1.5.2
    version: 1.5.2
```

`opendock update`는 lock의 dock id를 기준으로 Registry의 최신 승인 release를 조회합니다. 최신 release가 `1.6.0`이면 내부적으로 `opendock/codex@1.6.0` 같은 exact release를 적용하고, 적용 후 `requested`와 `version`을 새 exact version으로 갱신합니다. 최신 승인 release가 아니라 특정 release로 이동하려면 `opendock install opendock/codex@new-version`처럼 새 exact version을 명시해 다시 적용합니다.

### release version과 deploy

release version은 `dock.yml`에 쓰지 않습니다. Registry에 제출할 때 명령의 dock reference에서 정합니다.

```bash
opendock deploy opendock/codex@1.0.0
opendock deploy opendock/codex@designer-build
```

`opendock deploy opendock/codex`처럼 version이 없거나 `opendock deploy opendock/codex@latest`처럼 `latest`를 쓰면 실패합니다.

deploy는 `dock.yml`, `files[].from`, lifecycle `copy.from`에 명시된 파일과 디렉터리를 `.tgz` archive로 묶어 Registry submission에 포함합니다. `readme`와 `logo`는 catalog metadata로 별도 제출되며 archive에는 기본 포함되지 않습니다. Registry 검토가 승인되면 archive가 해당 release의 다운로드 대상이 됩니다.

## files 작성법

`files`는 dock 안의 파일 또는 디렉터리를 프로젝트 루트로 적용하는 목록입니다.

```yaml
files:
  - from: files/.agents
    to: .agents
    update: managed_file

  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block
```

| 필드 | 필수 | 설명 |
|---|---:|---|
| `from` | 필수 | dock root 기준 소스 파일 또는 디렉터리 경로입니다. |
| `to` | 필수 | 설치 대상 프로젝트 기준 경로입니다. |
| `update` | 필수 | 기존 파일이 있을 때의 업데이트 정책입니다. |

`from`, `to`는 안전한 상대 경로여야 합니다. 빈 문자열, 절대 경로, `../` 같은 상위 이동은 거부됩니다.

`from`이 파일이면 `to`도 대상 파일 경로입니다. `from`이 디렉터리이면 OpenDock은 디렉터리 안의 regular file을 재귀적으로 펼쳐서 `to` 아래 같은 상대 경로로 적용합니다. 예를 들어 `from: files/.agents`, `to: .agents`는 `files/.agents/skills/design/SKILL.md`를 `.agents/skills/design/SKILL.md`로 적용합니다. 빈 디렉터리는 생성하지 않고, source나 target 경로 구성 요소에 symlink가 있으면 거부됩니다.

### update 정책

#### `managed_block`

기존 파일을 보존하면서 OpenDock이 관리하는 블록만 추가하거나 교체합니다.

```yaml
files:
  - from: files/AGENTS.md
    to: AGENTS.md
    update: managed_block
```

기존 `AGENTS.md`가 있으면 다음 형태의 블록이 추가됩니다.

```md
<!-- OPENDOCK:START opendock/agent-ready:AGENTS.md -->
...
<!-- OPENDOCK:END opendock/agent-ready:AGENTS.md -->
```

다시 설치하거나 업데이트하면 같은 marker 안의 내용만 교체됩니다. 사용자가 블록 바깥에 쓴 내용은 유지됩니다. `DESIGN.md`, `AGENTS.md`, 규칙 문서처럼 OpenDock이 지속적으로 업데이트해야 하는 파일에 적합합니다.

#### `managed_file`

파일 전체를 OpenDock이 관리하되, git처럼 conflict를 자동 병합하지는 않습니다.

```yaml
files:
  - from: files/.agents
    to: .agents
    update: managed_file
```

OpenDock은 마지막으로 적용한 파일 hash를 `.opendock/project.yml`에 기록합니다. install/update 때 현재 파일 hash가 마지막 적용 hash와 같으면 새 dock 내용으로 교체하거나, 새 dock에서 빠진 파일을 삭제합니다. 사용자가 파일을 수정해 hash가 달라졌으면 기본적으로 파일 적용과 lifecycle 실행 전에 중단하고 `review required`로 보고합니다.

`opendock install owner/name@1.0.0 --force` 또는 `opendock update --force`를 쓰면 수정된 `managed_file`도 dock 내용으로 강제 덮어쓰거나, 새 dock에서 빠진 managed file을 강제로 삭제합니다.

이 정책은 `.agents/`, 하네스, 생성된 설정 묶음처럼 OpenDock이 소유권을 갖는 파일 트리에 적합합니다. 사용자가 직접 편집할 가능성이 큰 README나 제품 문서는 `manual_review`가 더 안전합니다.

#### `manual_review`

기존 사용자 파일을 자동으로 바꾸지 않습니다.

```yaml
files:
  - from: files/README.md
    to: README.md
    update: manual_review
```

파일이 없으면 생성됩니다. 파일이 이미 있고 사용자가 작성한 것으로 보이면 그대로 둡니다. 프로젝트 README처럼 사람의 문맥이 중요하고 자동 병합이 위험한 파일에 적합합니다.

#### `append_unique`

중복되지 않는 라인만 추가합니다.

```yaml
files:
  - from: files/.gitignore
    to: .gitignore
    update: append_unique
```

`.gitignore`처럼 줄 단위 규칙을 누적해야 하는 파일에 적합합니다. 빈 줄은 무시되고, 같은 라인은 반복 추가되지 않습니다.

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
| `install` | `opendock install owner/name@1.0.0` | 최초 설치, 도구 설치, 프로젝트 적용 |
| `update` | `opendock update` | Registry의 최신 승인 release로 파일과 lifecycle 최신화 |
| `doctor` | `opendock doctor` | 현재 프로젝트 상태 점검 |

OpenDock은 먼저 review-required 파일을 검사합니다. 수정된 `managed_file`처럼 자동 반영이 위험한 항목이 있으면 기본적으로 파일 적용과 `install`/`update` lifecycle 실행 전에 중단합니다. `--force`를 쓰거나 review-required가 없으면 파일 적용이 lifecycle 실행보다 먼저 일어납니다. lifecycle이 실패하면 실패 로그가 남고, `.opendock` 상태 기록은 완료되지 않습니다.

### lifecycle step 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `id` | 필수 | 단계 식별자입니다. 로그와 doctor 출력에 사용됩니다. |
| `name` | 선택 | 사람이 읽는 이름입니다. 없으면 `id`를 사용합니다. |
| `check` | 선택 | 현재 상태를 확인하는 명령입니다. |
| `run` | 선택 | `install` 또는 `update`에서 실행할 명령입니다. |
| `version` | 선택 | `check` 출력에서 읽은 semver가 만족해야 하는 범위입니다. |
| `timeout_ms` | 선택 | 명령 timeout입니다. doctor 기본값은 30000ms입니다. |
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
      version: ">=22.0.0"

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
      version: ">=22.0.0"
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

1. `opendock install owner/name@1.0.0 --platform windows`처럼 CLI 옵션을 주면 그 값을 사용합니다.
2. 옵션이 없으면 현재 host OS를 자동 감지합니다. `darwin`은 `macos`, `win32`는 `windows`, `linux`는 `linux`로 매핑됩니다.
3. 설치 후 `.opendock/dock.lock.yml`에 platform을 기록합니다.
4. `opendock update`와 `opendock doctor`는 lock에 기록된 platform을 기본값으로 재사용합니다.

지원 platform은 `macos`, `windows`, `linux`입니다. 현재 MVP의 예시는 macOS와 Windows를 중심으로 작성되어 있습니다.

## version 범위

`version`은 공백으로 구분된 조건을 모두 만족해야 합니다.

```yaml
version: ">=22.0.0"
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

## install과 update를 다르게 설계하기

`install`은 최초 적용입니다. 없는 도구를 설치하고 프로젝트에 dock을 적용하는 데 집중하세요.

```yaml
lifecycle:
  install:
    - id: install-node
      check: node --version
      version: ">=22.0.0"
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

파일 업데이트는 `files[].update` 정책에 따라 `update`에서도 다시 적용됩니다. 예를 들어 `managed_block` 파일은 OpenDock block이 새 dock 내용으로 교체되고, `managed_file`은 이전 적용 hash와 일치하는 파일만 교체/삭제하며, `append_unique`는 새 라인만 추가됩니다.

OpenDock은 git conflict resolver가 아닙니다. 예를 들어 `0.1.0`에서 `project/test.md`를 만들고, `0.2.0`에서 삭제하고, `0.3.0`에서 `project/machine.md`를 추가했을 때 사용자가 `0.1.0`에서 바로 `0.3.0`으로 업데이트해도 단계별 git merge를 수행하지 않습니다. 대신 `.opendock/project.yml`의 hash를 기준으로 `test.md`가 그대로면 삭제하고, 사용자가 수정했으면 파일 적용과 lifecycle 전에 중단합니다. 사용자가 의도적으로 OpenDock 쪽을 우선하려면 `opendock update --force`로 강제 반영합니다.

## 기존 프로젝트 파일을 보호하는 기준

dock은 사용자가 이미 작성한 파일을 함부로 덮어쓰면 안 됩니다.

권장 기준은 다음과 같습니다.

| 파일 종류 | 권장 update 정책 | 이유 |
|---|---|---|
| `DESIGN.md` | `managed_block` | 디자인 시스템 기본값은 업데이트되어야 하지만 사용자 메모도 남아야 합니다. |
| `AGENTS.md` | `managed_block` | OpenDock/Codex 작업 규칙 영역을 명확히 분리할 수 있습니다. |
| `.agents/`, 하네스 파일 | `managed_file` | OpenDock이 소유하는 파일 묶음은 hash가 같을 때 자동 교체/삭제할 수 있습니다. |
| `README.md` | `manual_review` | 프로젝트 설명은 사용자 문맥이 강합니다. |
| `.gitignore` | `append_unique` | 라인 단위 누적이 자연스럽고 중복을 피할 수 있습니다. |
| 설정 파일 일부 | `managed_block` | 파일 전체보다 관리 영역만 교체하는 편이 안전합니다. |

`managed_block` 안의 내용은 OpenDock이 업데이트하는 영역으로 보는 것이 맞습니다. 사용자가 직접 고칠 수는 있지만, 다음 update에서 dock 내용으로 바뀔 수 있습니다. 사용자 고유 내용은 block 바깥에 쓰는 방식이 안전합니다.

## 보안과 배포 기준

OpenDock은 프로젝트 설정을 실행하는 도구이므로 dock source를 런타임 환경변수로 바꿀 수 없게 고정합니다. 현재 Registry는 `https://registry.opendock.app`입니다.

사람이 탐색하는 dock catalog는 `https://hub.opendock.app`, CLI가 사용하는 Registry API root는 `https://registry.opendock.app/v1/docks`입니다.

배포 흐름은 다음 원칙을 따릅니다.

1. dock author가 `dock.yml`, `readme`, `logo`, `files[].from`에 명시한 source 파일을 작성합니다.
2. 필요한 경우 `opendock auth login`으로 OpenDock Registry에 로그인합니다.
3. `opendock deploy <owner/name@version>`으로 제출합니다.
4. OpenDock Registry 검토를 통과한 dock만 Registry에서 설치될 수 있습니다.

로컬 로그인 상태는 `opendock auth status`로 확인하고, 이 머신에서 해제하려면 `opendock auth logout`을 사용합니다.

`install`은 공개 명령이지만, 설치 대상 dock은 승인된 Registry metadata, signature, checksum 검증을 통과해야 합니다.

## 작성 체크리스트

`dock.yml`을 만들 때는 다음 순서로 확인하세요.

1. `id`가 설치 명령의 `owner/name`과 같은가?
2. `opendock: 1`을 선언했는가?
3. release version은 `opendock deploy owner/name@version`에서 정했는가?
4. `readme`와 `logo` 경로가 있다면 dock root 안의 실제 파일인가?
5. 모든 `files[].from` 파일이 실제로 존재하는가?
6. `files[].to`가 프로젝트 루트 기준 안전한 상대 경로인가?
7. 기존 사용자 파일에 맞는 update 정책을 골랐는가?
8. `install` step은 `check`로 idempotent하게 설계했는가?
9. 버전이 중요한 도구에는 lifecycle step의 `version` 범위를 넣었는가?
10. `update`는 최초 설치가 아니라 유지보수 관점으로 작성했는가?
11. `doctor`는 상태 점검만 하도록 구성했는가?
12. shell operator, pipe, redirect, command substitution을 쓰지 않았는가?
13. 한 step에 여러 명령을 묶지 않고 단계별로 나눴는가?
14. 오래 걸리는 명령에는 `timeout_ms`를 넣었는가?
15. macOS/Windows 명령이 다르면 같은 `id` 아래 `platforms`로 묶었는가?
16. 공통 step에 `brew`, `winget`처럼 특정 OS 전용 package manager를 넣지 않았는가?
17. `repair`, `messages`, `copy`, `needs`에 자동 동작을 기대하지 않았는가?

## 추천 작성 순서

처음부터 큰 dock을 만들기보다 아래 순서로 작성하면 실수가 줄어듭니다.

1. `id`, 최소 `files` 한 개만 둔 `dock.yml`을 만든다.
2. `README.md`, `DESIGN.md`, `AGENTS.md`, `.gitignore` 순서로 파일 정책을 정한다.
3. `doctor`에 필요한 도구 버전 점검을 먼저 쓴다.
4. `install`에 doctor 실패를 고칠 수 있는 설치 step을 추가한다.
5. `update`에 유지보수 step을 추가한다.
6. 오래 걸리는 setup/update step에는 timeout을 넉넉히 둔다.
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
      version: ">=22.0.0"
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

### Oh My Codex 설치 예시

Oh My Codex는 npm global package가 `omx` CLI를 제공합니다. 현재 문서 기준 흐름은 global install, `omx setup`, `omx doctor`입니다. 업데이트는 `omx update`로 npm 확인과 setup refresh를 함께 처리합니다.

```yaml
lifecycle:
  install:
    - id: install-oh-my-codex
      check: omx --version
      version: ">=0.18.0"
      run: npm install --global oh-my-codex@latest

    - id: setup-oh-my-codex
      run: omx setup
      timeout_ms: 600000

    - id: verify-oh-my-codex
      run: omx doctor
      timeout_ms: 60000

  update:
    - id: update-oh-my-codex
      run: omx update
      timeout_ms: 600000

    - id: verify-oh-my-codex
      run: omx doctor
      timeout_ms: 60000

  doctor:
    - id: oh-my-codex-version
      check: omx --version
      version: ">=0.18.0"

    - id: oh-my-codex
      check: omx doctor
      timeout_ms: 60000
```

### Oh My OpenAgent Codex Light 설치 예시

Oh My OpenAgent의 Codex용 Light edition은 현재 `lazycodex-ai` installer를 사용합니다. OpenCode Ultimate를 설치하는 `bunx oh-my-openagent install`과 다르게 Codex Light는 Node/npm 기반 `npx lazycodex-ai install`이 공식 경로입니다.

```yaml
lifecycle:
  install:
    - id: install-oh-my-openagent-light
      run: npx lazycodex-ai install --no-tui --codex-autonomous
      timeout_ms: 600000

  update:
    - id: update-oh-my-openagent-light
      run: npx lazycodex-ai install --no-tui --codex-autonomous
      timeout_ms: 600000

  doctor:
    - id: codex
      check: codex --version
      version: ">=0.0.0"
```

`--codex-autonomous`는 Codex Light를 agent-style full-permissions mode로 구성합니다. 사용자가 보수적인 권한 설정을 원하면 dock 정책상 `--no-codex-autonomous`로 바꾸세요.

## 현재 MVP에서 피해야 할 것

- 의존성 선언만으로 자동 설치를 기대하지 마세요. 현재는 lifecycle로 표현해야 합니다.
- 디렉터리 매핑은 regular file만 재귀 적용합니다. 빈 디렉터리 생성이나 symlink 복사는 기대하지 마세요.
- `repair`가 doctor 실패를 자동 수정한다고 기대하지 마세요.
- shell script처럼 `&&`, pipe, redirect를 쓰지 마세요.
- 검증 없이 `run`만 늘어놓지 마세요. 가능한 step에는 `check`를 붙여 재실행해도 안전하게 만드세요.
- 사용자 README처럼 문맥이 중요한 파일에 `managed_block`을 무조건 쓰지 마세요. `manual_review`가 더 나을 수 있습니다.

## 빠른 시작 YAML

새 dock을 만들 때 아래 예시에서 시작하세요.

```yaml
opendock: 1
id: owner/name

files:
  - from: files/.agents
    to: .agents
    update: managed_file

  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: files/AGENTS.md
    to: AGENTS.md
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

  update: []

  doctor:
    - id: git
      check: git --version
      version: ">=2.40.0"
```
