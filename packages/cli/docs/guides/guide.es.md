# Guía De OpenDock

`dock.yml` describe qué agrega un dock a un proyecto: archivos, herramientas
requeridas, tasks de install/update/doctor y outputs generados por herramientas
externas que deben exportarse al project root.

OpenDock es una pequeña capa de packaging para setup de IA repetible. Puedes elegir
varios docks, combinarlos en un mismo proyecto y mantener update y uninstall
separados por dock.

Translations:

- [English](./guide.md)
- [한국어](./guide.ko.md)
- [日本語](./guide.ja.md)
- [中文](./guide.zh.md)
- [Français](./guide.fr.md)
- [Deutsch](./guide.de.md)

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

`files/` es solo una convención. Puede usarse cualquier path seguro declarado en
`files[].from`.

## Minimal Example

```yaml
opendock: 1
id: opendock/agent-ready
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
| `id` | Dock id en formato `owner/name`. |
| `name` | Nombre visible en catalog. |
| `summary` | Resumen corto para Registry catalog. |
| `readme` | Markdown para la página de detalle del catalog. |
| `logo` | Imagen de logo del catalog. |
| `tags` | Labels lowercase para búsqueda y filtros en Hub. |
| `requires` | Requisitos de runtime. |
| `files` | Archivos o directorios aplicados al project root. |
| `commands` | Named helpers or checks for `opendock run`. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

La release version no se escribe en `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`owner/name` y `owner/name@latest` se rechazan. Usa una versión exacta.

Después de instalar, `opendock list` muestra qué docks están instalados en el
proyecto actual.
Cuando otra herramienta necesite leer la lista, usa `opendock list --json`.
`opendock log` muestra el historial de comandos del proyecto con estado `Success`,
`Failure` o `Skipped`.

## Files And Ownership

Archivos de texto como `AGENTS.md` se aplican como managed blocks. Configs y
binary files se protegen con checksum. Si una persona modifica contenido
gestionado por OpenDock, update se detiene antes de escribir en root. `--force`
elige explícitamente la versión del dock.
Agent runtime files under `.codex/`, `.claude/`, `.agents/`, and
`.github/copilot-instructions.md`, `.github/instructions/` stay exact so frontmatter, hooks, and executable bits
remain valid.

## Host Bootstrap

```bash
opendock bootstrap mac
opendock bootstrap windows
```

En macOS puedes preparar Homebrew; en Windows puedes preparar WinGet antes de
ejecutar un dock.

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

Los steps corren de arriba hacia abajo. `doctor` debe revisar estado y evitar
modificar el proyecto.

## Commands

Tasks are run by OpenDock during `install`, `update`, and `doctor`.
`commands` are named helpers or checks that installed docs, skills, workflows, or harnesses can call later with `opendock run`.

```yaml
files:
  - from: files/.opendock/harness/owner__name/check.mjs
    to: .opendock/harness/owner__name/check.mjs

commands:
  check:
    description: Run the dock quality gate.
    file: .opendock/harness/owner__name/check.mjs
    runner: node
```

Installed instructions should call:

```bash
opendock run check --dock owner/name
```

Prefer `opendock run` in installed agent docs so the helper stays tied to the dock that installed it.

Supported runners: `bun`, `node`, `powershell`, `python`, `python3`, `sh`.

## Workdir Files And Export

Usa `workdir.files` cuando un generador necesita archivos de entrada antes de
ejecutarse. Luego usa `workdir: dock` y exporta solo los archivos que OpenDock
debe gestionar en el proyecto.

```yaml
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

Los workspace examples de `examples/` son payloads instalables. Salvo los tool
docks, instalan `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md` y archivos
provider-specific bajo `.agents/skills/`, `.codex/skills/`, `.claude/skills/` y
`.cursor/rules/`, para que los agentes de IA puedan leer el context del proyecto
de inmediato.

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy envía `dock.yml`, un archive construido desde `files[].from` y
`workdir.files[].from`, metadata de release platform, `readme_markdown` opcional
y `logo` opcional, y `tags` opcionales del manifest.
