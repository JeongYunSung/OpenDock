<div align="center">

# OpenDock

**Geprüfte Starterpacks für KI-Arbeitsbereiche.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock ist eine Bun-first TypeScript-CLI, die geprüfte Starterpacks in das
aktuelle Projektverzeichnis installiert. Das erste Paket ist `opendock/codex-designer`
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
export OPENDOCK_PACKS_DIR="$repo/examples"
export OPENDOCK_DATA_DIR="$project/.opendock-data"

"$repo/bin/opendock.js" install opendock/codex-designer
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## Befehle

| Command | Purpose |
|---|---|
| `opendock install opendock/codex-designer` | Installiert ein Starterpack im aktuellen Verzeichnis. |
| `opendock update` | Aktualisiert installierte Packs sicher. |
| `opendock doctor` | Prüft den OpenDock-Zustand des Projekts. |
| `opendock log` | Zeigt aktuelle Projektlogs. |
| `opendock version` | Zeigt CLI-, Schema- und Registry-Informationen. |
| `opendock auth login` | Speichert ein DockHub-Token. |
| `opendock deploy codex-designer` | Reicht ein lokales `dock.yml` zur Prüfung ein. |

## Sicherheit

OpenDock erhält bestehende Dateien durch verwaltete Blöcke, erlaubt nur
`owner/name`-Referenzen, prüft Approval, Signatur und Checksumme für Remote
Packs und führt Setup-Befehle nur über eine Allowlist aus. Shell-Pipelines und
Redirects werden blockiert.
