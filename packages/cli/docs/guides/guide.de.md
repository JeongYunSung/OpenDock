# OpenDock Guide

`dock.yml` beschreibt, was ein Dock zu einem Projekt hinzufügt: Dateien,
runtime requirements, project-local tools, dependencies in kopierten Ordnern,
Tasks für install/update/doctor und Outputs externer Tools, die in den project
root exportiert werden sollen.

OpenDock ist eine kleine Packaging-Schicht für wiederholbares KI-Setup. Du kannst
mehrere Docks auswählen, in einem Projekt kombinieren und update sowie
uninstall pro Dock getrennt verfolgen.

Translations:

- [English](./guide.md)
- [한국어](./guide.ko.md)
- [日本語](./guide.ja.md)
- [中文](./guide.zh.md)
- [Español](./guide.es.md)
- [Français](./guide.fr.md)

## Package Layout

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
```

`files/` ist nur eine Konvention. Jeder sichere Path aus `files[].from` kann
verwendet werden.

## Minimal Example

```yaml
opendock: 1
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

## Main Fields

| Field | Meaning |
|---|---|
| `opendock` | Manifest version. Current value is `1`. |
| `name` | Lesbarer Name im catalog. |
| `summary` | Kurze Beschreibung für Registry catalog. |
| `readme` | Markdown für die catalog detail page. |
| `logo` | Logo image für den catalog. |
| `tags` | Lowercase catalog labels für Hub-Suche und Filter. |
| `permissions` | Erlaubt exakte Task-Formen für Standard-Commands oder deklarierte Tool-Commands. |
| `requires` | Runtime requirements. |
| `tools` | CLI packages installed and tracked under `.opendock/tools/`. |
| `dependencies` | Package dependencies installed inside folders copied by the dock. |
| `files` | Dateien oder Ordner für den project root. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Tools

`tools` installiert und verfolgt CLI packages projektlokal. Unterstützte Manager
sind `npm`, `bun`, `pnpm`, `uv`, `pip` und `pip3`. Wenn ein Package einen
Command bereitstellt, deklariere es in `tools` statt es direkt in einer Task zu
installieren.

```yaml
tools:
  ruff:
    manager: uv
    package: ruff
    version: latest
    commands:
      - ruff
```

Package install/update Commands wie `npm install ...`, `bun add ...`,
`pip install ...`, `pipx install ...` oder `uv tool install ...` werden in tasks
abgelehnt.

## Dependencies

Nutze `dependencies`, wenn ein Dock einen Ordner ins Projekt kopiert und dieser
Ordner eigene package dependencies braucht. `tools` installiert commands unter
`.opendock/tools/`; `dependencies` gehört dagegen zu einem kopierten payload
folder wie einem Codex skill, harness oder helper app.

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"

files:
  - from: image2html
    to: .codex/skills/image2html

dependencies:
  image2html:
    manager: npm
    path: .codex/skills/image2html
    mode: locked
```

OpenDock wendet zuerst `files` an und installiert danach `dependencies` im
angegebenen `path`. Bei update und uninstall entfernt OpenDock die erzeugten
dependency outputs wie `node_modules`, `.venv` oder `.opendock/python`.

| Manager | Modes |
|---|---|
| `npm` | `install`, `locked` |
| `pnpm` | `install`, `locked` |
| `bun` | `install`, `locked` |
| `uv` | `install`, `locked` |
| `pip`, `pip3` | `install` aus `requirements.txt` |

Nutze `tools`, wenn der dock einen Command installiert, den später ein Agent,
eine Task oder ein Nutzer ausführt. Nutze `dependencies`, wenn OpenDock einen
Ordner kopiert und dieser Ordner eigene Packages vorbereiten muss.

`install` ist eine normale dependency Installation. Nutze es für Template-Ordner,
Harnesses oder kleine Helper-Apps ohne lockfile. `locked` respektiert lockfile
oder frozen environment. Nutze es, wenn der dock `package-lock.json`,
`pnpm-lock.yaml`, `bun.lock` oder `uv.lock` enthält und dasselbe dependency set
reproduziert werden soll. Intern nutzt OpenDock `npm ci`,
`pnpm install --frozen-lockfile`, `bun install --frozen-lockfile` oder
`uv sync --frozen`.

## Version

Die release version steht nicht in `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

Nutze `opendock <command> --help`, um Optionen für einen Befehl zu sehen.

```bash
opendock install --help
opendock doctor --help
opendock auth login --help
```

`owner/name` und `owner/name@latest` werden abgelehnt. Nutze eine exakte Version.

Nach der Installation zeigt `opendock list`, welche docks im aktuellen Projekt
installiert sind.
Wenn ein Tool die Liste lesen muss, verwenden Sie `opendock list --json`.
`opendock log` zeigt den Befehlsverlauf des Projekts mit `Success`, `Failure` oder
`Skipped`.

## Files And Ownership

Textdateien wie `AGENTS.md` werden als managed blocks angewendet. Configs und
binary files werden per checksum geschützt. Wenn jemand OpenDock-managed content
ändert, stoppt update vor dem Schreiben in root files. `--force` wählt explizit
die Dock-Version.
Agent runtime files under `.codex/`, `.claude/`, `.agents/`, and
`.github/copilot-instructions.md`, `.github/instructions/` stay exact so frontmatter, hooks, and executable bits
remain valid.

## Tasks

```yaml
install:
  - id: git-init
    check: git status
    run: git init -b main

doctor:
  - id: git
    check: git --version
    version: ">=2.40.0"
```

Steps laufen von oben nach unten. `doctor` sollte nur prüfen und das Projekt
nicht verändern.

## Task Command Permission

OpenDock gibt `run` und `check` nicht direkt an eine Shell weiter. Die Standard-Policy erlaubt nur `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`. Auf Windows ist zusätzlich ein eingeschränktes `powershell` erlaubt. Ein Standard-Command erlaubt aber nicht beliebige subcommands: Nur sichere Formen wie `git status`, `git init -b main`, `test -f <path>`, version checks und das eingeschränkte Windows `Test-Path` sind erlaubt. Commands außerhalb der Standard-Policy müssen zuerst in `tools.commands` stehen; danach erlaubt `permissions` die exakte Task-Form. `tools.commands` darf OpenDock-Standardnamen wie `git`, `node`, `npm` oder `python` nicht wiederverwenden. Operatoren wie `|`, `&&`, `||`, `;`, backticks, `$(`, `>` und `<` werden in `permissions`, `run` und `check` abgelehnt. Package install/update Commands wie `npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install` und `winget install` werden in tasks abgelehnt. Nutze `tools` für project tools, `dependencies` für package dependencies in kopierten Projektordnern und `requires.runtimes` für runtimes.

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

## Workdir Files And Export

Nutze `workdir.files`, wenn ein Generator vor dem Start Eingabedateien braucht.
Nutze danach `workdir: dock` und exportiere nur die Dateien, die OpenDock im
Projekt verwalten soll.

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
```

## Example Docks

Die workspace examples unter `examples/` sind installierbare Payloads. Abgesehen
von tool docks installieren sie `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`README.md` und provider-specific files unter `.agents/skills/`,
`.codex/skills/`, `.claude/skills/` und `.cursor/rules/`, damit AI agents den
project context direkt lesen können.

Die bundled examples haben getrennte macOS- und Windows-Manifeste. Die Testsuite parsed jedes Manifest, prüft Datei-Referenzen, kontrolliert Windows doctor checks und validiert jeden task command gegen die aktuelle Policy.

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy sendet `dock.yml`, ein aus `files[].from` und `workdir.files[].from`
gebautes Archiv, release platform metadata, optionales `readme_markdown` und
optionales `logo` sowie optionale `tags` aus dem manifest.
