<div align="center">

# OpenDock

**Geprüfte Docks für KI-Arbeitsbereiche.**

Installiere die Projektkonfiguration, der du vertraust, mit einem einzigen
Befehl. Halte die Befehlsoberfläche klein, die Einrichtung wiederholbar und jede
generierte Datei auditierbar.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock ist eine Bun-first TypeScript-CLI zum Installieren geprüfter Docks in
das aktuelle Projektverzeichnis.

Das erste Dock ist `opendock/codex`: ein allgemeiner Codex-Starter, der Node
prüft, die Codex CLI installiert, überprüfbare Projektdateien anwendet und die
Einrichtung über OpenDock state nachverfolgbar macht.

OpenDock ist bewusst kein Terminal-Ersatz. Es ist das kleine Binary, das du
ausführst, wenn ein Projekt eine verlässliche KI-Konfiguration braucht.

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

## Warum OpenDock

KI-Workspace-Setup besteht oft aus einmaligen shell commands, kopierten Prompt-
Dateien, version drift und halb erinnerten Projektkonventionen. OpenDock macht
daraus ein geprüftes Dock:

- **Projektbezogen**: installiert in das aktuelle Verzeichnis und schreibt
  lokalen `.opendock/` state.
- **Approval by design**: Remote-Docks müssen aus von OpenDock Hub
  genehmigter metadata stammen.
- **Sicher mit bestehenden Dateien**: Jede Datei deklariert ihre eigene
  update policy, etwa managed blocks, manual review oder unique-line append.
- **Kleine Befehlsoberfläche**: install, update, diagnose, Logs prüfen, auth und
  deploy.
- **Automatisierungsbereit**: lifecycle steps können erlaubte Befehle wie
  `git`, `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, `oma`
  und `omx` ausführen, ohne shell pipelines zu erlauben.

## Schnellstart

OpenDock ist noch nicht über einen package manager veröffentlicht. Baue es aus
dem Quellcode:

```bash
bun install
bun run build
bin/opendock.js version
```

Teste das geprüfte `opendock/codex` Dock in einem temporären Projekt:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

Nach der Installation enthält das Projekt:

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## Befehle

| Befehl | Zweck |
|---|---|
| `opendock install opendock/codex` | Installiert ein geprüftes Dock im aktuellen Verzeichnis. |
| `opendock install opendock/codex@1.5` | Installiert mit einem version selector. |
| `opendock install opendock/codex --platform windows` | Installiert mit einer expliziten target platform statt host auto-detection. |
| `opendock install opendock/codex --force` | Erzwingt OpenDock-managed file changes während install. |
| `opendock update` | Löst installierte Docks erneut auf und wendet neue Versionen sicher mit der gelockten platform an. |
| `opendock update --force` | Erzwingt OpenDock-managed file changes, auch wenn bearbeitete managed files erkannt werden. |
| `opendock doctor` | Zeigt den OpenDock state des aktuellen Verzeichnisses mit der gelockten platform. |
| `opendock log` | Gibt die letzten OpenDock runs für das aktuelle Projekt aus. |
| `opendock version` | Gibt CLI version, schema version und default hub aus. |
| `opendock bootstrap mac` | Prüft oder installiert Homebrew für macOS-Docks. |
| `opendock auth login` | Speichert ein OpenDock Hub token. |
| `opendock deploy codex` | Reicht ein lokales `dock.yml` Dock zur OpenDock Hub review ein. |

`install` ist öffentlich. `deploy` erfordert `opendock auth login`.
Führe zuerst `opendock bootstrap mac` aus, wenn Homebrew fehlt.

Dock-Referenzen unterstützen npm-artige version selectors:

```text
owner/name          -> latest
owner/name@latest   -> latest
owner/name@1        -> latest approved 1.x
owner/name@1.5      -> latest approved 1.5.x
owner/name@1.5.2    -> exact approved version
owner/name@v1       -> latest approved 1.x
```

OpenDock speichert sowohl den angeforderten selector als auch die aufgelöste
exact version in `.opendock/dock.lock.yml`. `opendock update` verwendet den
angeforderten selector erneut, sodass eine Installation mit `@1.5.2` fixiert
bleibt, während `@1.5` sich innerhalb von `1.5.x` bewegen kann.

## Dock-Format

Ein Dock ist ein Verzeichnis mit einer `dock.yml` Datei und allen Quelldateien
oder Verzeichnissen, die von `files[].from` referenziert werden.
Siehe [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) für den detaillierten
koreanischen Authoring Guide.

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

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

`from` paths sind relativ zum Dock-Root. `files/` ist nur der empfohlene
Beispielordnername; OpenDock benötigt kein spezielles payload directory.

Directory sources werden rekursiv entfaltet. `managed_file` ersetzt oder löscht
eine Datei nur, wenn ihr aktueller Hash dem zuletzt von OpenDock angewendeten
Hash entspricht. Bearbeitete managed files stoppen install/update vor file
changes oder lifecycle commands. `--force` überschreibt oder löscht diese
managed files.

Platform-spezifische lifecycle commands bleiben innerhalb der normalen
top-to-bottom Reihenfolge von `install`, `update` und `doctor`. Ein step mit
`platforms` behält eine logische `id`, und OpenDock merged den passenden
platform override:

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

Steps ohne `platforms` laufen auf jeder platform. Die gewählte platform wird in
`.opendock/dock.lock.yml` gespeichert und von `opendock update` sowie
`opendock doctor` wiederverwendet.

Interaktive lifecycle steps können entweder die Kontrolle an den Benutzer
übergeben oder eine kleine genehmigte Tastenfolge über ein macOS `expect` PTY senden:

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

## Repository-Struktur

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Hub dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Hub API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
docs/plans/work/      # implementation plan and verification notes
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## Entwicklung

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

Die integration tests verwenden temporäre Verzeichnisse und generierte lokale
Dock-Fixtures. Die Docks in `examples/` sind echte Authoring-Beispiele.

## Aktueller Umfang

OpenDock ist eine MVP CLI. Folgendes wird noch nicht ausgeliefert:

- gehosteter OpenDock Hub Review-Service
- Distribution über package manager
- vollständige dock catalog UX auf `https://hub.opendock.app`
- Automatisierung von Binary-Releases

Die CLI enthält bereits local fixture flow, remote Hub API client boundary,
project state, logging, auth token storage, deploy submission plumbing und
regression tests.

Wenn der hosted service verfügbar ist, ist `https://opendock.app` die product
site, `https://hub.opendock.app` der für Menschen lesbare dock catalog und
`https://hub.opendock.app/v1/docks` die CLI Hub API root.

## Ökosystem

OpenDock ist so entworfen, dass es natürlich neben Projekten wie
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode) und
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) funktioniert:
agent-native Werkzeuge, die lokale Projekt-workflows portabler, inspizierbarer
und wiederholbarer machen.
