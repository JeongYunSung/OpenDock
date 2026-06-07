<div align="center">

# OpenDock

**Geprüfte Docks für KI-Arbeitsbereiche.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock ist eine Bun-first TypeScript-CLI, die geprüfte Docks in das
aktuelle Projektverzeichnis installiert. Das erste Dock ist `opendock/oma-codex`
und richtet Git sowie Arbeitsdateien wie `README.md`, `DESIGN.md`,
`AGENTS.md` und `.gitignore` für Codex-Projekte ein.

## Schnellstart

```bash
bun install
bun run build
bin/opendock.js version
```

```bash
repo=$PWD
project=$(mktemp -d)

cd "$project"
export OPENDOCK_DATA_DIR="$project/.opendock-data"

"$repo/bin/opendock.js" install opendock/oma-codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## Befehle

| Command | Purpose |
|---|---|
| `opendock install opendock/oma-codex` | Installiert ein geprüftes Dock im aktuellen Verzeichnis. |
| `opendock install opendock/oma-codex --platform windows` | Installiert mit einer expliziten platform statt automatischer Systemerkennung. |
| `opendock update` | Aktualisiert installierte Docks sicher mit der im Lock gespeicherten platform. |
| `opendock doctor` | Prüft den OpenDock-Zustand mit der im Lock gespeicherten platform. |
| `opendock log` | Zeigt aktuelle Projektlogs. |
| `opendock version` | Zeigt CLI-, Schema- und Registry-Informationen. |
| `opendock bootstrap mac` | Prüft oder installiert Homebrew für macOS-Docks. |
| `opendock auth login` | Speichert ein OpenDock Registry-Token. |
| `opendock deploy oma-codex` | Reicht ein lokales `dock.yml` zur Prüfung in OpenDock Registry ein. |

Platform-spezifische lifecycle-Befehle werden pro step in `platforms` definiert. Die gewählte platform wird in `.opendock/dock.lock.yml` gespeichert und von `update` sowie `doctor` wiederverwendet.

## Sicherheit

OpenDock erhält bestehende Dateien durch verwaltete Blöcke, erlaubt nur
`owner/name`-Referenzen, löst Docks nur über die feste Registry
`https://registry.opendock.app` auf, prüft Approval, Signatur und Checksumme für Remote
Docks und führt Setup-Befehle nur über eine Allowlist aus. Dock source und
Registry host können nicht per Runtime-Umgebungsvariable geändert werden.
Shell-Pipelines und Redirects werden blockiert.
