<div align="center">

# OpenDock

**Des starterpacks approuvés pour les espaces de travail IA.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock est une CLI TypeScript Bun-first qui installe des starterpacks
approuvés dans le répertoire courant du projet. Le premier pack, `opendock/oma-codex`,
prépare Git et des fichiers de travail comme `README.md`, `DESIGN.md`,
`AGENTS.md` et `.gitignore` pour démarrer un projet Codex.

## Démarrage rapide

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

## Commandes

| Command | Purpose |
|---|---|
| `opendock install opendock/oma-codex` | Installe un starterpack dans le répertoire courant. |
| `opendock update` | Met à jour les packs installés en sécurité. |
| `opendock doctor` | Diagnostique l'état OpenDock du projet. |
| `opendock log` | Affiche les logs récents du projet. |
| `opendock version` | Affiche la version CLI, le schema et le registry. |
| `opendock auth login` | Enregistre un token DockHub. |
| `opendock deploy oma-codex` | Soumet un `dock.yml` local pour revue. |

## Sécurité

OpenDock préserve les fichiers existants avec des blocs gérés, exige des
références `owner/name`, résout les packs uniquement depuis le registry fixe
`https://opencode.app`, vérifie l'approbation, la signature et le checksum des
packs distants, et limite les commandes de setup à une allowlist. Le pack source
et le registry host ne peuvent pas être changés par variable d'environnement au
runtime. Les pipelines et redirections shell sont refusés.
