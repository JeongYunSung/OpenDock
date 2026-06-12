<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Wähle die docks, die du brauchst, kombiniere sie auf deine Weise und halte jedes
Projekt AI-ready.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock hilft dir, AI-ready workspaces schnell vorzubereiten.

Statt Prompts zu kopieren, Config-Dateien anzulegen, Tools zu installieren und
das gleiche Setup in jedem Projekt zu wiederholen, installierst du einen
**dock**.

Ein dock ist ein sofort nutzbares AI-workspace package. Du kannst einen dock
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

- Wähle das AI-workspace setup, das du brauchst.
- Kombiniere mehrere docks in einem Projekt.
- Aktualisiere installierte docks später.
- Entferne docks, die du nicht mehr brauchst.
- Behalte im Blick, was OpenDock hinzugefügt hat.
- Verhindere stilles Überschreiben deiner eigenen Änderungen.

OpenDock ist kein Terminal-Ersatz und kein generischer script runner. Es ist ein
kleines Tool, um wiederholbares KI-workspace setup zu installieren und zu verwalten.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Genehmigte dock metadata und release archives. |
| **Project scope** | Aktueller workspace | Installed dock list, lock, logs und project metadata. |
| **Dock scope** | Ein installierter dock | Version, checksum, managed file records und private workdir. |
| **Root output scope** | OpenDock file engine | Dateien, die nach preflight in den project root geschrieben werden. |
| **System/tool scope** | Host tools | Runtimes, die über `requires` vorbereitet werden, und Tools, die erlaubte install/update/doctor tasks installieren, z. B. Homebrew, npm, Bun, pip oder winget. |

## Install

```bash
bun install -g opendock
opendock version
```

Wenn ein macOS dock Homebrew verwendet und Homebrew fehlt, führe zuerst aus:

```bash
opendock bootstrap mac
```

Wenn ein Windows dock WinGet verwendet und WinGet fehlt, führe zuerst aus:

```bash
opendock bootstrap windows
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Installiert einen approved dock release im aktuellen Verzeichnis. |
| `opendock list` | Zeigt die im aktuellen Projekt installierten docks. |
| `opendock update` | Bringt installed docks auf die neuesten approved Registry releases. |
| `opendock update --force` | Bevorzugt die dock-Version trotz lokaler Änderungen an managed content. |
| `opendock uninstall owner/name` | Entfernt einen dock und seine managed project files. |
| `opendock doctor` | Prüft project state und doctor steps jedes docks. |
| `opendock log` | Zeigt aktuelle OpenDock runs für das Projekt. |
| `opendock version` | Zeigt CLI, schema und Registry information. |
| `opendock bootstrap mac` | Prüft oder installiert Homebrew auf macOS. |
| `opendock bootstrap windows` | Prüft WinGet oder öffnet Microsoft App Installer auf Windows. |
| `opendock auth login` | Login bei Registry für deploy. |
| `opendock auth status` | Zeigt den aktuellen Registry login. |
| `opendock auth logout` | Entfernt den lokalen Registry login. |
| `opendock deploy owner/name@1.0.0` | Reicht einen local dock release für Registry review ein. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Reicht ein plattformspezifisches release artifact ein. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Reicht ein plattformspezifisches release artifact ein. |

dock references benötigen einen exact version identifier.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

## Dock Format

```yaml
opendock: 1
id: owner/name
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png

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

`readme` und `logo` sind Registry catalog metadata. Wenn sie ins Projekt
installiert werden sollen, müssen sie auch in `files` stehen.

Nutze `workdir.files`, wenn ein task im dock-private workdir vor der Ausführung
Input-Dateien braucht. Nutze `files` für Dateien, die in den project root
geschrieben werden sollen.

## Example Docks

Workspace examples sind keine leeren Beispiele, sondern direkt nutzbare
Payloads. Sie installieren `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, ein lokales
`README.md` sowie provider-specific skill/rule files unter `.agents/skills/`,
`.codex/skills/`, `.claude/skills/` und `.cursor/rules/`. Nach der Installation
können Codex, Claude Code, Gemini-ähnliche Agents, Cursor und OMA-style skill
discovery denselben project context lesen.

Tool docks sind `codex`, `claude-code` und `oma`. Outcome docks wie
`designer-ai`, `product-manager` und `frontend-ai` fügen rollenbezogene
Workspaces hinzu. Utility docks wie `agent-ready`, `agent-safety` und
`repo-context` ergänzen wiederverwendbare Harnesses.

Die vollständige Manifest-Referenz steht in [docs/guides/guide.de.md](./docs/guides/guide.de.md).

## Development

```bash
bun install
bun run check
bun run build
```
