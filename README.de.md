<div align="center">

# OpenDock

**Einfaches KI-Setup für jeden Arbeitsbereich.**

Installiere geprüfte KI-Setup-Packs mit einem einzigen Befehl. Halte das Setup
einfach, wiederholbar und sicher für Entwickler und Nicht-Entwickler.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock ist eine Bun-first TypeScript-CLI zum Installieren geprüfter
KI-Setup-Packs in das aktuelle Projektverzeichnis.

Das erste Dock ist `opendock/codex`: ein minimaler Codex-Starter, der Node
prüft, die Codex CLI installiert und die Einrichtung über OpenDock state
nachverfolgbar macht.

OpenDock ist bewusst kein Terminal-Ersatz. Es ist das kleine Binary, das du
ausführst, wenn ein Projekt ein einfaches und verlässliches KI-Setup braucht.

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

## Warum OpenDock

KI-Setup in einem Projekt besteht oft aus einmaligen shell commands, kopierten
Prompt-Dateien, version drift und halb erinnerten Projektkonventionen. OpenDock
macht daraus ein geprüftes Setup-Pack:

- **Projektbezogen**: installiert in das aktuelle Verzeichnis und schreibt
  lokalen `.opendock/` state.
- **Approval by design**: Remote-Docks müssen aus von OpenDock Registry
  genehmigter metadata stammen.
- **Sicher mit bestehenden Dateien**: Jede Datei deklariert ihre eigene
  update policy, etwa managed blocks, manual review oder unique-line append.
- **Kleine Befehlsoberfläche**: install, update, doctor, Logs prüfen, auth und
  deploy.
- **Automatisierungsbereit**: lifecycle steps können erlaubte Befehle wie
  `git`, `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, `oma`
  und `omx` ausführen, ohne shell pipelines zu erlauben.

## Schnellstart

Für lokale Entwicklung baust du OpenDock aus dem Quellcode:

```bash
bun install
bun run build
bin/opendock version
```

Teste das geprüfte `opendock/codex` Dock in einem temporären Projekt:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock" install opendock/codex@1.0.0
"$repo/bin/opendock" doctor
"$repo/bin/opendock" log
```

Nach der Installation enthält das Projekt:

```text
.opendock/
  dock.lock.yml
  project.yml
```

## Befehle

| Befehl | Zweck |
|---|---|
| `opendock install opendock/codex@1.0.0` | Installiert ein geprüftes Dock im aktuellen Verzeichnis. |
| `opendock install opendock/codex@designer-build` | Installiert mit einem exakten version identifier. |
| `opendock install opendock/codex@1.0.0 --platform windows` | Installiert mit einer expliziten target platform statt host auto-detection. |
| `opendock install opendock/codex@1.0.0 --force` | Erzwingt OpenDock-managed file changes während install. |
| `opendock update` | Löst installierte Docks auf die neueste approved Registry release mit der gelockten platform auf. |
| `opendock update --force` | Erzwingt OpenDock-managed file changes, auch wenn bearbeitete managed files erkannt werden. |
| `opendock doctor` | Zeigt den OpenDock state des aktuellen Verzeichnisses mit der gelockten platform. |
| `opendock log` | Gibt die letzten OpenDock runs für das aktuelle Projekt aus. |
| `opendock version` | Gibt CLI version, schema version und default registry aus. |
| `opendock bootstrap mac` | Prüft oder installiert Homebrew für macOS-Docks. |
| `opendock auth login` | Meldet dich bei OpenDock Registry an. |
| `opendock auth status` | Zeigt die aktuelle OpenDock Registry Anmeldung. |
| `opendock auth logout` | Meldet diese Maschine von OpenDock Registry ab. |
| `opendock deploy opendock/codex@1.0.0` | Reicht ein lokales `dock.yml` Dock zur OpenDock Registry review ein. |

`install` ist öffentlich. `deploy` verwendet die OpenDock Registry Anmeldung.
Nutze `opendock auth status` oder `opendock auth logout`, um sie zu prüfen oder zu entfernen.
Führe zuerst `opendock bootstrap mac` aus, wenn Homebrew fehlt.

Dock-Referenzen erfordern einen exakten version identifier:

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

Install und deploy erfordern beide einen exakten release identifier, z. B.
`opendock install owner/name@1.0.0` und `opendock deploy owner/name@1.0.0`.

`opendock install owner/name`, `opendock install owner/name@latest`,
`opendock deploy owner/name` und `opendock deploy owner/name@latest` werden
abgelehnt.

OpenDock speichert sowohl den angeforderten version identifier als auch die
aufgelöste exact version in `.opendock/dock.lock.yml`. `opendock update` fragt
OpenDock Registry nach der neuesten approved release jedes installierten Docks,
wendet diese exact release an und aktualisiert die lock file. Um statt der
neuesten approved release auf eine bestimmte release zu wechseln, führe
`opendock install owner/name@new-version` aus.

## Dock-Format

Ein Dock ist ein Verzeichnis mit einer `dock.yml` Datei und allen Quelldateien
oder Verzeichnissen, die von `files[].from` referenziert werden. Optionale
`readme` und `logo` Pfade werden als Catalog-Metadata an OpenDock Registry
übermittelt; sie werden nur installiert, wenn sie auch in `files` gelistet sind.
Release versions werden nicht in `dock.yml` deklariert; die Version kommt aus
der deploy reference `opendock deploy owner/name@version`. Deploy packt
`dock.yml` und install payloads aus `files[].from` und lifecycle `copy.from` in
ein `.tgz` submission archive zur review. `readme` und `logo` werden nur als
catalog metadata übermittelt, sofern sie nicht auch als install payloads
gelistet sind.
Siehe [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) für den detaillierten
koreanischen Authoring Guide.

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup without project file payloads.
readme: DOCK.md
logo: logo.png

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

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
      version: ">=22.0.0"
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

## Repository-Struktur

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
  codex/              # Codex CLI-only example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
  designer-ai/        # AI workspace for product designers
  product-manager/    # AI workspace for PM artifacts
  frontend-ai/        # AI workspace for frontend engineering
  startup-founder/    # AI workspace for founder strategy
  ai-automation/      # AI workspace for automation planning
  ui-case-study/      # AI workspace for UI portfolio case studies
  agent-ready/        # shared AI agent instruction files
  ai-context/         # repository context packaging setup
  mcp-local/          # project-local MCP config examples
  agent-safety/       # PR/security safety rails
  agent-docs/         # AI-readable docs harness
  agent-rules/        # path-scoped AI agent rules
  repo-context/       # repository context prompts and packaging
  mcp-safe/           # security-first MCP references
  dev-env/            # tool versions and validation tasks
  codex-skills/       # repository-local Codex skills
  devcontainer-ai/    # AI-friendly Dev Container setup
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

## Ökosystem

OpenDock ist so entworfen, dass es natürlich neben Projekten wie
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode) und
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) funktioniert:
agent-native Werkzeuge, die lokale Projekt-workflows portabler, inspizierbarer
und wiederholbarer machen.
