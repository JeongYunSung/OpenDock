<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Wähle die KI-Setups, die du brauchst, kombiniere mehrere docks pro Projekt und
halte sie leicht aktualisierbar oder entfernbar.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

[Datenschutzerklärung](https://opendock.app/privacy/) · [Richtlinie zur Codesignierung](https://opendock.app/code-signing/)

OpenDock hilft dir, KI-Setup in Projekte zu bringen, ohne die gleichen Dateien
und Tool-Schritte immer wieder von Hand zu bauen.

Statt Prompts zu kopieren, Config-Dateien anzulegen, Tools zu installieren und
das gleiche Setup in jedem Projekt zu wiederholen, installierst du einen
**dock**.

Ein dock ist ein wiederverwendbares KI-Setup-Paket. Du kannst einen dock
installieren oder mehrere docks im selben Projekt kombinieren.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## Was OpenDock Löst

KI-Setup beginnt einfach: ein paar Prompts kopieren, Dateien hinzufügen und ein
Tool installieren.

Mit der Zeit sieht jedes Projekt anders aus. Es wird schwer zu erkennen, welche
Dateien hinzugefügt wurden, welche Tools installiert sind und was aktualisiert
werden muss.

OpenDock macht daraus docks, die du verwalten kannst.

- Wähle das KI-Setup, das du brauchst.
- Kombiniere mehrere docks in einem Projekt.
- Aktualisiere installierte docks später.
- Entferne docks, die du nicht mehr brauchst.
- Behalte im Blick, was OpenDock hinzugefügt hat.
- Verhindere stilles Überschreiben deiner eigenen Änderungen.

OpenDock ist kein Terminal-Ersatz und kein generischer script runner. Es ist ein
kleines Tool, um wiederholbares KI-Setup zu installieren und zu verwalten.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Metadaten und Archive geprüfter Versionen. |
| **Project scope** | Aktuelles Projekt | Installierte docks, lock, logs und Projektmetadaten. |
| **Dock scope** | Ein installierter dock | Version, checksum, verwaltete Dateien und privates workdir. |
| **Root output scope** | OpenDock file engine | Dateien, die nach der Vorprüfung in den project root geschrieben werden. |
| **Tool scope** | Installed dock | CLI packages declared in `tools` are installed under `.opendock/tools/` and exposed through `.opendock/bin/`. |
| **Dependency scope** | Installed dock payload | Package dependencies declared in `dependencies` are installed inside copied project folders and cleaned on update/uninstall. |

## Install

```bash
bun install -g opendock
opendock version
opendock version --check
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Installiert eine geprüfte dock-Version im aktuellen Verzeichnis. |
| `opendock list` | Zeigt die im aktuellen Projekt installierten docks. |
| `opendock list --json` | Gibt die installierten docks als maschinenlesbares JSON aus. |
| `opendock outdated` | Prüft, ob installierte docks neuere geprüfte Versionen haben. |
| `opendock update` | Wendet neuere geprüfte Versionen an, wenn Updates vorhanden sind. |
| `opendock update --force` | Bevorzugt die dock-Version trotz lokaler Änderungen an managed content. |
| `opendock uninstall owner/name` | Entfernt einen dock und die von ihm verwalteten Projektdateien. |
| `opendock doctor` | Prüft den Projektzustand und die Diagnose-steps jedes docks. |
| `opendock log` | Zeigt aktuelle Befehlslogs für das Projekt. |
| `opendock version` | Zeigt Informationen zu CLI, schema und Registry. |
| `opendock version --check` | Prüft den öffentlichen OpenDock release channel auf eine neue CLI/app-Version. |
| `opendock auth login` | Login bei Registry für deploy. |
| `opendock auth status` | Zeigt den aktuellen Registry login. |
| `opendock auth logout` | Entfernt den lokalen Registry login. |
| `opendock deploy owner/name@1.0.0` | Reicht eine lokale dock-Version zur Registry-Prüfung ein. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Reicht eine Versionsdatei für macOS ein. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Reicht eine Versionsdatei für Windows ein. |
| `opendock <command> --help` | Zeigt Optionen und Nutzung für einen bestimmten Befehl. |

dock references benötigen eine exakte Version.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

## Dock Format

```yaml
opendock: 1
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png
tags:
  - starter
  - ai-agent

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md

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

`readme`, `logo` und `tags` sind Registry catalog metadata. Sie helfen, den Dock
im Hub zu erklären und zu filtern. Dateien, die ins Projekt installiert werden
sollen, müssen zusätzlich in `files` stehen.

## Dependencies

Nutze `dependencies`, wenn ein Dock einen Ordner ins Projekt kopiert und dieser
Ordner eigene package dependencies braucht. Das ist für skill folders, harnesses
oder kleine helper apps gedacht, die im installierten Projektbaum bleiben.

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

Heute unterstützt OpenDock `npm`, `pnpm`, `bun`, `uv`, `pip` und `pip3`.

Wähle das Feld nach Ownership.

| Need | Use |
|---|---|
| Ein Command, der über `.opendock/bin` verfügbar sein soll, etwa `codex`, `ruff` oder `oma` | `tools` |
| Packages in einem vom dock kopierten Ordner, etwa einem Skill, Harness oder einer Template-App | `dependencies` |

Dependency modes sind `install` und `locked`.

| Mode | Wann verwenden | Interne Form |
|---|---|---|
| `install` | Der kopierte Ordner hat kein lockfile oder darf compatible updates akzeptieren | normale Manager-Installation |
| `locked` | Der Ordner enthält ein lockfile und soll dasselbe dependency set reproduzieren | `npm ci`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`, `uv sync --frozen` |

`pip` und `pip3` unterstützen nur `install` aus `requirements.txt`.

Nutze `workdir.files`, wenn ein task im dock-private workdir vor der Ausführung
Input-Dateien braucht. Nutze `files` für Dateien, die in den project root
geschrieben werden sollen.

## Task Command Permission

OpenDock tasks `run` und `check` nutzen eine kleine Standard-Policy: `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`. Auf Windows ist zusätzlich ein eingeschränktes `powershell` erlaubt. Ein Standard-Command erlaubt aber nicht beliebige subcommands: Nur sichere Formen wie `git status`, `git init -b main`, `test -f <path>`, version checks und das eingeschränkte Windows `Test-Path` sind erlaubt. Commands wie `oma`, `codex`, `claude` oder `omx` können nur über `permissions` geöffnet werden, wenn sie vorher in `tools.commands` deklariert sind. `tools.commands` darf OpenDock-Standardnamen wie `git`, `node`, `npm` oder `python` nicht wiederverwenden. Ein Command wie `mkdir`, der weder Standard noch in `tools.commands` deklariert ist, wird abgelehnt. Operatoren wie `|`, `&&`, `||`, `;`, backticks, `$(`, `>` und `<` werden in `permissions`, `run` und `check` abgelehnt. Package install/update Commands wie `npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install` und `winget install` werden in tasks abgelehnt. Nutze `tools` für project tools, `dependencies` für dependencies in kopierten Projektordnern, `requires.runtimes` für Bun/Node/npm/Python/pip runtimes.

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

Docks in den Beispielen sind zum Kombinieren gedacht. Die meisten installieren
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, ein lokales `README.md` sowie
tool-spezifische skill/rule files unter `.agents/skills/`, `.codex/skills/`,
`.claude/skills/` und `.cursor/rules/`. Nach der Installation können Codex,
Claude Code, Gemini-ähnliche Agents, Cursor und OMA-style skill discovery
denselben project context lesen.

Tool docks sind `codex`, `claude-code` und `oma`. Outcome docks wie
`designer-ai`, `product-manager` und `frontend-ai` fügen rollenbezogene
Workspaces hinzu. Utility docks wie `agent-ready`, `agent-safety` und
`repo-context` ergänzen wiederverwendbare Harnesses.

Alle bundled examples haben getrennte macOS- und Windows-Manifeste. Die Testsuite parsed jedes Manifest, prüft Datei-Referenzen, kontrolliert Windows doctor checks und validiert jeden task command gegen die aktuelle OpenDock command policy.

Die vollständige Manifest-Referenz steht in [docs/guides/guide.de.md](./docs/guides/guide.de.md).

## Development

```bash
bun install
bun run check
bun run build
```
