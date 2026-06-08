<div align="center">

# OpenDock

**Docks aprobados para espacios de trabajo con IA.**

Instala la configuración de proyecto en la que confías con un solo comando.
Mantén una superficie de comandos pequeña, una configuración repetible y cada
archivo generado auditable.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock es una CLI Bun-first en TypeScript para instalar docks aprobados en el
directorio actual del proyecto.

El primer dock es `opendock/codex`: un starter general para Codex que verifica
Node, instala la CLI de Codex, aplica archivos de proyecto revisables y mantiene
la configuración registrada en el estado de OpenDock.

OpenDock no pretende reemplazar la terminal. Es el binario pequeño que ejecutas
cuando un proyecto necesita una configuración de IA confiable.

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

## Por Qué OpenDock

La configuración de un espacio de trabajo con IA suele convertirse en una pila
de comandos shell puntuales, archivos prompt copiados, drift de versiones y
convenciones de proyecto medio recordadas. OpenDock lo convierte en un dock
revisado:

- **Con alcance de proyecto**: instala en el directorio actual y escribe estado
  local en `.opendock/`.
- **Aprobado por diseño**: los docks remotos deben venir de metadata aprobada
  por OpenDock Registry.
- **Seguro con archivos existentes**: cada archivo declara su propia política de
  actualización, como managed blocks, manual review o unique-line append.
- **Superficie de comandos pequeña**: install, update, diagnosticar,
  inspeccionar logs, auth y deploy.
- **Listo para automatización**: los lifecycle steps pueden ejecutar comandos
  permitidos como `git`, `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`,
  `claude` y `omx` sin permitir pipelines de shell.

## Inicio Rápido

OpenDock aún no está publicado mediante un package manager. Compílalo desde el
código fuente:

```bash
bun install
bun run build
bin/opendock.js version
```

Prueba el dock aprobado `opendock/codex` en un proyecto temporal:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

Después de la instalación, el proyecto contiene:

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## Comandos

| Comando | Propósito |
|---|---|
| `opendock install opendock/codex` | Instala un dock aprobado en el directorio actual. |
| `opendock install opendock/codex@1.5` | Instala usando un version selector. |
| `opendock install opendock/codex --platform windows` | Instala con una target platform explícita en lugar de detectar el host. |
| `opendock update` | Vuelve a resolver los docks instalados y aplica versiones nuevas de forma segura usando la platform bloqueada. |
| `opendock doctor` | Muestra el estado OpenDock del directorio actual usando la platform bloqueada. |
| `opendock log` | Imprime las ejecuciones recientes de OpenDock para el proyecto actual. |
| `opendock version` | Imprime la versión de la CLI, la versión del schema y el registry por defecto. |
| `opendock bootstrap mac` | Verifica o instala Homebrew para docks de macOS. |
| `opendock auth login` | Guarda un token de OpenDock Registry. |
| `opendock deploy codex` | Envía un dock local `dock.yml` para revisión en OpenDock Registry. |

`install` es público. `deploy` requiere `opendock auth login`.
Ejecuta `opendock bootstrap mac` primero si falta Homebrew.

Las referencias dock soportan version selectors estilo npm:

```text
owner/name          -> latest
owner/name@latest   -> latest
owner/name@1        -> latest approved 1.x
owner/name@1.5      -> latest approved 1.5.x
owner/name@1.5.2    -> exact approved version
owner/name@v1       -> latest approved 1.x
```

OpenDock guarda tanto el selector solicitado como la versión exacta resuelta en
`.opendock/dock.lock.yml`. `opendock update` reutiliza el selector solicitado,
así que una instalación fijada en `@1.5.2` queda fija, mientras `@1.5` puede
moverse dentro de `1.5.x`.

## Formato Del Dock

Un dock es un directorio con un archivo `dock.yml` y cualquier archivo fuente
referenciado por `files[].from`.
Consulta [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) para la guía
detallada de autoría en coreano.

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: files/README.md
    to: README.md
    update: manual_review

  - from: files/.gitignore
    to: .gitignore
    update: append_unique

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0 <25.0.0"
      platforms:
        macos:
          run: brew install node
        windows:
          run: winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements

    - id: install-codex-cli
      check: codex --version
      version: ">=0.0.0"
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  doctor:
    - id: node
      version: ">=22.0.0 <25.0.0"
      check: node --version

    - id: npm
      version: ">=10.0.0"
      check: npm --version

    - id: codex
      version: ">=0.0.0"
      check: codex --version
      timeout_ms: 60000
```

Las rutas `from` son relativas a la raíz del dock. `files/` es solo el nombre de
carpeta recomendado en el ejemplo; OpenDock no requiere un directorio especial
de payload.

Los comandos lifecycle específicos por platform permanecen dentro del orden
normal top-to-bottom de `install`, `update` y `doctor`. Un step con `platforms`
mantiene un `id` lógico y OpenDock fusiona el override correspondiente:

```yaml
lifecycle:
  install:
    - id: install-bun
      check: bun --version
      version: ">=1.3.0"
      platforms:
        macos:
          run: brew install bun
        windows:
          run: npm install --global bun
```

Los steps sin `platforms` se ejecutan en todas las plataformas. La plataforma
seleccionada se guarda en `.opendock/dock.lock.yml` y se reutiliza con
`opendock update` y `opendock doctor`.

Los lifecycle steps interactivos pueden entregar el control al usuario o enviar
una pequeña secuencia de teclas aprobada mediante un PTY `expect` de macOS:

```yaml
lifecycle:
  install:
    - id: user-driven-tui
      run: codex
      interactive: user

    - id: scripted-tui
      run: codex
      interactive:
        mode: scripted
        inputs:
          - key: tab
          - key: enter
```

## Variables De Entorno

| Variable | Uso |
|---|---|
| `OPENDOCK_DATA_DIR` | Sobrescribe el directorio de user data/cache/log. |
| `OPENDOCK_AUTH_TOKEN` | Proporciona un login token de forma no interactiva. |

## Estructura Del Repositorio

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Registry dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Registry API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Codex CLI + Oh My Codex example
  oh-my-openagent/    # Codex CLI + Oh My OpenAgent example
docs/plans/work/      # implementation plan and verification notes
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## Desarrollo

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

Las pruebas de integración usan directorios temporales y fixtures de dock local
generados. Los docks de `examples/` son ejemplos reales de autoría.

## Alcance Actual

OpenDock es una CLI MVP. Lo siguiente todavía no está incluido:

- servicio hosted de revisión de OpenDock Registry
- distribución mediante package manager
- UX completa del dock catalog en `https://registry.opendock.app`
- automatización de binary releases

La CLI ya incluye local fixture flow, remote registry client boundary, project
state, logging, auth token storage, deploy submission plumbing y regression
tests.

Cuando el servicio hosted esté disponible, `https://opendock.app` será el
product site, `https://registry.opendock.app` será el dock catalog para personas
y `https://registry.opendock.app/v1/docks` será la raíz de la API del registry
para la CLI.

## Ecosistema

OpenDock está diseñado para encajar de forma natural junto a proyectos como
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode) y
[oh-my-agent](https://github.com/first-fluke/oh-my-agent): herramientas
agent-native que hacen que los workflows locales de proyecto sean más
portátiles, inspeccionables y repetibles.
