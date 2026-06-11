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

OpenDock ist eine Bun-first TypeScript-CLI, um geprüfte KI-Setup-Packs, genannt
**docks**, im aktuellen workspace auszuwählen und zu kombinieren.

Ein dock kann agent instructions, prompt libraries, project harnesses, sichere
lifecycle commands und von externen Tools erzeugte Ausgaben hinzufügen. OpenDock
verfolgt, was angewendet wurde, damit du später aktualisieren, diagnostizieren
oder deinstallieren kannst.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## Was OpenDock Löst

KI-Setup verteilt sich schnell über globale Tools, kopierte Prompts, versteckte
Config, README-Snippets, shell commands und vendor-spezifische agent folders.

OpenDock macht daraus eine versionierte Einheit, die du auswählen, kombinieren,
aktualisieren und entfernen kannst.

- **Outcome-first docks**: richtet einen nützlichen workspace ein, nicht nur ein Tool.
- **Composable setup**: installiere mehrere docks in einem Projekt und verfolge sie separat.
- **Reviewed distribution**: remote installs werden über OpenDock Registry aufgelöst.
- **Project-local tracking**: jeder workspace hält seinen Zustand in `.opendock/`.
- **Independent updates**: jeder dock behält version, files, checksums und private workdir.
- **Safe root writes**: OpenDock prüft Konflikte, bevor es in den project root schreibt.
- **Controlled commands**: lifecycle commands nutzen eine allowlist statt raw shell.

OpenDock ist kein Terminal-Ersatz und kein generischer script runner. Es ist eine
kleine Packaging-Schicht für kombinierbares, wiederholbares KI-workspace setup.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Genehmigte dock metadata und release archives. |
| **Project scope** | Aktueller workspace | Installed dock list, lock, logs und project metadata. |
| **Dock scope** | Ein installierter dock | Version, checksum, managed file records und private workdir. |
| **Root output scope** | OpenDock file engine | Dateien, die nach preflight in den project root geschrieben werden. |
| **System/tool scope** | Host package managers | Homebrew, npm, Bun, pip, winget und andere host tools. |

## Install

```bash
bun install -g opendock
opendock version
```

Wenn ein macOS dock Homebrew verwendet und Homebrew fehlt, führe zuerst aus:

```bash
opendock bootstrap mac
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Installiert einen approved dock release im aktuellen Verzeichnis. |
| `opendock update` | Bringt installed docks auf die neuesten approved Registry releases. |
| `opendock update --force` | Bevorzugt die dock-Version trotz lokaler Änderungen an managed content. |
| `opendock uninstall owner/name` | Entfernt einen dock und seine managed project files. |
| `opendock doctor` | Prüft project state und doctor steps jedes docks. |
| `opendock log` | Zeigt aktuelle OpenDock runs für das Projekt. |
| `opendock version` | Zeigt CLI, schema und Registry information. |
| `opendock auth login` | Login bei Registry für deploy. |
| `opendock auth status` | Zeigt den aktuellen Registry login. |
| `opendock auth logout` | Entfernt den lokalen Registry login. |
| `opendock deploy owner/name@1.0.0` | Reicht einen local dock release für Registry review ein. |

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

`readme` und `logo` sind Registry catalog metadata. Wenn sie ins Projekt
installiert werden sollen, müssen sie auch in `files` stehen.

Die vollständige Manifest-Referenz steht in [docs/guides/dock-yml.md](./docs/guides/dock-yml.md).

## Development

```bash
bun install
bun run check
bun run build
```
