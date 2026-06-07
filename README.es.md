<div align="center">

# OpenDock

**Starterpacks aprobados para espacios de trabajo con IA.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock es una CLI Bun-first escrita en TypeScript que instala starterpacks
aprobados en el directorio actual del proyecto. El primer paquete es
`opendock/codex-designer`, pensado para preparar Git y archivos de trabajo como
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
export OPENDOCK_PACKS_DIR="$repo/examples"
export OPENDOCK_DATA_DIR="$project/.opendock-data"

"$repo/bin/opendock.js" install opendock/codex-designer
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## Comandos

| Command | Purpose |
|---|---|
| `opendock install opendock/codex-designer` | Instala un starterpack en el directorio actual. |
| `opendock update` | Actualiza de forma segura los paquetes instalados. |
| `opendock doctor` | Diagnostica el estado OpenDock del proyecto. |
| `opendock log` | Muestra los logs recientes del proyecto. |
| `opendock version` | Muestra la versión de CLI, schema y registry. |
| `opendock auth login` | Guarda un token de DockHub. |
| `opendock deploy codex-designer` | Envía un `dock.yml` local para revisión. |

## Seguridad

OpenDock conserva los archivos existentes con bloques administrados, exige
referencias `owner/name`, valida aprobación, firma y checksum en packs remotos,
y solo ejecuta comandos de setup permitidos. Los pipelines y operadores de shell
no están permitidos.
