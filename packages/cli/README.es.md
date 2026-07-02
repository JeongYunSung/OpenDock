<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Elige los setups de IA que necesitas, combina docks por proyecto y mantenlos
fáciles de actualizar o eliminar.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock te ayuda a agregar setup de IA a un proyecto sin reconstruir los mismos
archivos y pasos de herramientas a mano.

En lugar de copiar prompts, crear archivos de configuración, instalar
herramientas y repetir el mismo setup en cada proyecto, instalas un **dock**.

Un dock es un paquete reutilizable de setup de IA. Puedes instalar uno o combinar
varios docks en el mismo proyecto.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## Qué Resuelve OpenDock

El setup de IA empieza simple: copias algunos prompts, agregas archivos e
instalas una herramienta.

Con el tiempo, cada proyecto termina con una configuración distinta. Se vuelve
difícil recordar qué archivos se agregaron, qué herramientas se instalaron y qué
hay que actualizar.

OpenDock convierte ese setup en docks que puedes gestionar.

- Elige el setup de IA que necesitas.
- Combina varios docks en un proyecto.
- Actualiza los docks instalados más tarde.
- Elimina los docks que ya no necesitas.
- Rastrea lo que OpenDock agregó.
- Evita sobrescribir tus cambios sin avisar.

OpenDock no reemplaza la terminal ni es un script runner genérico. Es una
herramienta pequeña para instalar y gestionar setup de IA repetible.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Metadatos y archivos de versiones revisadas. |
| **Project scope** | Proyecto actual | Lista de docks instalados, lock, logs y metadatos del proyecto. |
| **Dock scope** | Un dock instalado | Versión, checksum, registros de archivos gestionados y workdir privado. |
| **Root output scope** | OpenDock file engine | Archivos aplicados al project root tras la comprobación previa. |
| **Host bootstrap scope** | Your machine | Homebrew or WinGet are prepared explicitly with `opendock bootstrap`. |
| **Tool scope** | Installed dock | CLI packages declared in `tools` are installed under `.opendock/tools/` and exposed through `.opendock/bin/`. |

## Install

```bash
bun install -g opendock
opendock version
opendock version --check
```

Si un dock de macOS usa Homebrew y todavía no está disponible, ejecuta:

```bash
opendock bootstrap mac
```

Si un dock de Windows usa WinGet y todavía no está disponible, ejecuta:

```bash
opendock bootstrap windows
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Instala una versión revisada del dock en el directorio actual. |
| `opendock list` | Muestra los docks instalados en el proyecto actual. |
| `opendock list --json` | Imprime el inventario de docks instalados en JSON legible por máquina. |
| `opendock outdated` | Comprueba si los docks instalados tienen versiones revisadas más recientes. |
| `opendock update` | Aplica versiones revisadas más recientes cuando hay actualizaciones. |
| `opendock update --force` | Prioriza la versión del dock aunque haya cambios locales gestionados. |
| `opendock uninstall owner/name` | Elimina un dock y los archivos de proyecto que gestiona. |
| `opendock doctor` | Comprueba el estado del proyecto y los steps de revisión de cada dock. |
| `opendock log` | Muestra los logs recientes de comandos para el proyecto actual. |
| `opendock version` | Muestra información de CLI, schema y Registry. |
| `opendock version --check` | Comprueba el canal público de releases de OpenDock para detectar una nueva versión de CLI/app. |
| `opendock bootstrap mac` | Verifica o instala Homebrew en macOS. |
| `opendock bootstrap windows` | Verifica WinGet o abre Microsoft App Installer en Windows. |
| `opendock auth login` | Inicia sesión en Registry para deploy. |
| `opendock auth status` | Muestra el login actual de Registry. |
| `opendock auth logout` | Borra el login local de Registry. |
| `opendock deploy owner/name@1.0.0` | Envía una versión local del dock para revisión en Registry. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Envía un archivo de versión para macOS. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Envía un archivo de versión para Windows. |
| `opendock <command> --help` | Muestra opciones y uso para un comando concreto. |

Las referencias de dock requieren una versión exacta.

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

`readme`, `logo` y `tags` son metadata para Registry catalog. Sirven para
explicar y filtrar el dock en Hub. Los archivos que deban instalarse en el
proyecto también deben declararse en `files`.

Usa `workdir.files` cuando un task en el dock-private workdir necesita archivos
de entrada antes de ejecutarse. Usa `files` para archivos que deben escribirse
en el project root.

## Task Command Permission

Los tasks `run` y `check` de OpenDock usan una política pequeña por defecto: `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`. En macOS también se permite `brew`; en Windows, `powershell` y `winget`. Pero un command por defecto no permite cualquier subcommand: solo pasan formas seguras como `git status`, `git init -b main`, `test -f <path>`, checks de versión y el `Test-Path` limitado de Windows. Commands como `oma`, `codex`, `claude` u `omx` solo pueden abrirse con `permissions` si antes están declarados en `tools.commands`. `tools.commands` no puede reutilizar nombres por defecto de OpenDock como `git`, `node`, `npm` o `python`. Un command como `mkdir`, que no es por defecto ni está declarado en `tools.commands`, se rechaza. Los operadores `|`, `&&`, `||`, `;`, backticks, `$(`, `>` y `<` se rechazan en `permissions`, `run` y `check`. Los commands de install/update de paquetes como `npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install` y `winget install` se rechazan dentro de tasks. Usa `tools` para project tools, `requires.runtimes` para Bun/Node/npm/Python/pip runtime y bootstrap para host package managers.

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

Los docks de ejemplo están pensados para combinarse. La mayoría instala
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, un `README.md` local y archivos de
skills/rules por herramienta bajo `.agents/skills/`, `.codex/skills/`,
`.claude/skills/` y `.cursor/rules/`. Después de instalar un dock, Codex,
Claude Code, agentes tipo Gemini, Cursor y OMA-style skill discovery pueden leer
el mismo context del proyecto.

Los tool docks son `codex`, `claude-code` y `oma`. Los outcome docks como
`designer-ai`, `product-manager` y `frontend-ai` agregan workspaces por rol. Los
utility docks como `agent-ready`, `agent-safety` y `repo-context` agregan
harnesses reutilizables.

Todos los bundled examples tienen manifests separados para macOS y Windows. La suite de tests parsea cada manifest, revisa referencias de archivos, verifica Windows doctor checks y valida cada task command contra la política actual de OpenDock.

Consulta la referencia completa en [docs/guides/guide.es.md](./docs/guides/guide.es.md).

## Development

```bash
bun install
bun run check
bun run build
```
