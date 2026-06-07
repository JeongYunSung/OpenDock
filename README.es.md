<div align="center">

# OpenDock

**Docks aprobados para espacios de trabajo con IA.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock es una CLI Bun-first escrita en TypeScript que instala docks
aprobados en el directorio actual del proyecto. El primer dock es
`opendock/oma-codex`, pensado para preparar Git y archivos de trabajo como
`README.md`, `DESIGN.md`, `AGENTS.md` y `.gitignore` para proyectos Codex.

## Inicio rápido

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

## Comandos

| Command | Purpose |
|---|---|
| `opendock install opendock/oma-codex` | Instala un dock aprobado en el directorio actual. |
| `opendock install opendock/oma-codex@1.5` | Instala usando un selector de versión. |
| `opendock install opendock/oma-codex --platform windows` | Instala usando una platform explícita en lugar de detectar el sistema actual. |
| `opendock update` | Actualiza de forma segura los paquetes instalados usando la platform guardada en el lock. |
| `opendock doctor` | Diagnostica el estado OpenDock del proyecto usando la platform guardada en el lock. |
| `opendock log` | Muestra los logs recientes del proyecto. |
| `opendock version` | Muestra la versión de CLI, schema y registry. |
| `opendock bootstrap mac` | Verifica o instala Homebrew para docks de macOS. |
| `opendock auth login` | Guarda un token de OpenDock Registry. |
| `opendock deploy oma-codex` | Envía un `dock.yml` local para revisión en OpenDock Registry. |

Los comandos lifecycle específicos por platform se definen dentro de `platforms` en cada step. La platform elegida se guarda en `.opendock/dock.lock.yml` y se reutiliza en `update` y `doctor`.

## Seguridad

OpenDock conserva los archivos existentes con bloques administrados, exige
referencias `owner/name`, resuelve docks solo desde el registry fijo
`https://registry.opendock.app`, valida aprobación, firma y checksum en docks remotos, y
solo ejecuta comandos de setup permitidos. El dock source y el registry host no
pueden cambiarse con variables de entorno en runtime. Los pipelines y
operadores de shell no están permitidos.
