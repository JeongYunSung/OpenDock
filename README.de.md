<div align="center">

# OpenDock

**Geprüfte Starterpacks für KI-Arbeitsbereiche.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock ist eine Bun-first TypeScript-CLI, die geprüfte Starterpacks in das
aktuelle Projektverzeichnis installiert. Das erste Paket ist `opendock/oma-codex`
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
| `opendock install opendock/oma-codex` | Installiert ein Starterpack im aktuellen Verzeichnis. |
| `opendock install opendock/oma-codex --platform windows` | Installiert mit einer expliziten platform statt automatischer Systemerkennung. |
| `opendock update` | Aktualisiert installierte Packs sicher mit der im Lock gespeicherten platform. |
| `opendock doctor` | Prüft den OpenDock-Zustand mit der im Lock gespeicherten platform. |
| `opendock log` | Zeigt aktuelle Projektlogs. |
| `opendock version` | Zeigt CLI-, Schema- und Registry-Informationen. |
| `opendock bootstrap mac` | Prüft oder installiert Homebrew für macOS-Starterpacks. |
| `opendock auth login` | Speichert ein DockHub-Token. |
| `opendock deploy oma-codex` | Reicht ein lokales `dock.yml` zur Prüfung ein. |

Platform-spezifische lifecycle-Befehle werden pro step in `platforms` definiert. Die gewählte platform wird in `.opendock/dock.lock.yml` gespeichert und von `update` sowie `doctor` wiederverwendet.

## Sicherheit

OpenDock erhält bestehende Dateien durch verwaltete Blöcke, erlaubt nur
`owner/name`-Referenzen, löst Packs nur über die feste Registry
`https://opencode.app` auf, prüft Approval, Signatur und Checksumme für Remote
Packs und führt Setup-Befehle nur über eine Allowlist aus. Pack source und
Registry host können nicht per Runtime-Umgebungsvariable geändert werden.
Shell-Pipelines und Redirects werden blockiert.
