<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Elige los docks que necesitas, combínalos a tu manera y mantén cada proyecto
AI-ready.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock te ayuda a preparar workspaces listos para IA.

En lugar de copiar prompts, crear archivos de configuración, instalar
herramientas y repetir el mismo setup en cada proyecto, instalas un **dock**.

Un dock es un paquete de workspace de IA listo para usar. Puedes instalar uno o
combinar varios docks en el mismo proyecto.

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

- Elige el setup de workspace de IA que necesitas.
- Combina varios docks en un proyecto.
- Actualiza los docks instalados más tarde.
- Elimina los docks que ya no necesitas.
- Rastrea lo que OpenDock agregó.
- Evita sobrescribir tus cambios sin avisar.

OpenDock no reemplaza la terminal ni es un script runner genérico. Es una
herramienta pequeña para instalar y gestionar setup de workspaces de IA repetible.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Metadata y archives de releases aprobadas. |
| **Project scope** | Workspace actual | Installed dock list, lock, logs y metadata del proyecto. |
| **Dock scope** | Un dock instalado | Version, checksum, managed file records y private workdir. |
| **Root output scope** | OpenDock file engine | Archivos aplicados al project root tras preflight. |
| **System/tool scope** | Host package managers | Herramientas preparadas por `requires` o install, update, and doctor commands permitidos, como Homebrew, npm, Bun, pip o winget. |

## Install

```bash
bun install -g opendock
opendock version
```

Si un dock de macOS usa Homebrew y todavía no está disponible, ejecuta:

```bash
opendock bootstrap mac
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Instala un approved dock release en el directorio actual. |
| `opendock update` | Mueve los installed docks a las últimas approved Registry releases. |
| `opendock update --force` | Prioriza la versión del dock aunque haya cambios locales gestionados. |
| `opendock uninstall owner/name` | Elimina un dock y sus managed project files. |
| `opendock doctor` | Comprueba project state y doctor steps de cada dock. |
| `opendock log` | Muestra runs recientes de OpenDock para el proyecto actual. |
| `opendock version` | Muestra CLI, schema y Registry information. |
| `opendock auth login` | Inicia sesión en Registry para deploy. |
| `opendock auth status` | Muestra el login actual de Registry. |
| `opendock auth logout` | Borra el login local de Registry. |
| `opendock deploy owner/name@1.0.0` | Envía un local dock release a Registry review. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Envía un artifact de release específico de la plataforma. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Envía un artifact de release específico de la plataforma. |

Las referencias dock requieren un exact version identifier.

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

`readme` y `logo` son metadata para Registry catalog. Para instalarlos en el
proyecto, decláralos también en `files`.

Consulta la referencia completa en [docs/guides/guide.es.md](./docs/guides/guide.es.md).

## Development

```bash
bun install
bun run check
bun run build
```
