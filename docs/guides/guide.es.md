# Guía De OpenDock

`dock.yml` describe qué agrega un dock a un proyecto: archivos, herramientas
requeridas, tasks de install/update/doctor y outputs generados por herramientas
externas que deben exportarse al project root.

OpenDock es una pequeña capa de packaging para AI workspace setup. Puedes elegir
varios docks, combinarlos en un mismo workspace y mantener update y uninstall
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
| `requires` | Requisitos de runtime. |
| `files` | Archivos o directorios aplicados al project root. |
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

## Files And Ownership

Archivos de texto como `AGENTS.md` se aplican como managed blocks. Configs y
binary files se protegen con checksum. Si una persona modifica contenido
gestionado por OpenDock, update se detiene antes de escribir en root. `--force`
elige explícitamente la versión del dock.

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

## Workdir And Export

Usa `workdir: dock` cuando una herramienta externa genera archivos. Exporta solo
los archivos que OpenDock debe gestionar.

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

Deploy envía `dock.yml`, un archive construido desde `files[].from`, metadata de
release platform, `readme_markdown` opcional y `logo` opcional.
