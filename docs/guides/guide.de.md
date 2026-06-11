# OpenDock Guide

`dock.yml` beschreibt, was ein Dock zu einem Projekt hinzufügt: Dateien,
benötigte Tools, Tasks für install/update/doctor und Outputs externer Tools,
die in den project root exportiert werden sollen.

OpenDock ist eine kleine Packaging-Schicht für AI workspace setup. Du kannst
mehrere Docks auswählen, in einem Workspace kombinieren und update sowie
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

## Main Fields

| Field | Meaning |
|---|---|
| `opendock` | Manifest version. Current value is `1`. |
| `id` | Dock id im Format `owner/name`. |
| `name` | Lesbarer Name im catalog. |
| `summary` | Kurze Beschreibung für Registry catalog. |
| `readme` | Markdown für die catalog detail page. |
| `logo` | Logo image für den catalog. |
| `requires` | Runtime requirements. |
| `files` | Dateien oder Ordner für den project root. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

Die release version steht nicht in `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`owner/name` und `owner/name@latest` werden abgelehnt. Nutze eine exakte Version.

## Files And Ownership

Textdateien wie `AGENTS.md` werden als managed blocks angewendet. Configs und
binary files werden per checksum geschützt. Wenn jemand OpenDock-managed content
ändert, stoppt update vor dem Schreiben in root files. `--force` wählt explizit
die Dock-Version.

## Host Bootstrap

```bash
opendock bootstrap mac
opendock bootstrap windows
```

Auf macOS kannst du Homebrew vorbereiten; auf Windows kannst du WinGet
vorbereiten, bevor ein Dock läuft.

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

## Workdir And Export

Nutze `workdir: dock`, wenn ein externes Tool Dateien erzeugt. Exportiere nur die
Dateien, die OpenDock verwalten soll.

```yaml
export:
  include:
    - AGENTS.md
    - .codex/**
  exclude:
    - "**/*.log"
```

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy sendet `dock.yml`, ein aus `files[].from` gebautes Archiv, release
platform metadata, optionales `readme_markdown` und optionales `logo`.
