<div align="center">

# OpenDock

**Des docks approuvés pour les espaces de travail IA.**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock est une CLI TypeScript Bun-first qui installe des docks
approuvés dans le répertoire courant du projet. Le premier dock, `opendock/oma-codex`,
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
| `opendock install opendock/oma-codex` | Installe un dock approuvé dans le répertoire courant. |
| `opendock install opendock/oma-codex --platform windows` | Installe avec une platform explicite au lieu de détecter le système courant. |
| `opendock update` | Met à jour les docks installés en sécurité avec la platform enregistrée dans le lock. |
| `opendock doctor` | Diagnostique l'état OpenDock du projet avec la platform enregistrée dans le lock. |
| `opendock log` | Affiche les logs récents du projet. |
| `opendock version` | Affiche la version CLI, le schema et le registry. |
| `opendock bootstrap mac` | Vérifie ou installe Homebrew pour les docks macOS. |
| `opendock auth login` | Enregistre un token OpenDock Registry. |
| `opendock deploy oma-codex` | Soumet un `dock.yml` local pour revue dans OpenDock Registry. |

Les commandes lifecycle spécifiques à une platform se définissent dans `platforms` sur chaque step. La platform choisie est stockée dans `.opendock/dock.lock.yml`, puis réutilisée par `update` et `doctor`.

## Sécurité

OpenDock préserve les fichiers existants avec des blocs gérés, exige des
références `owner/name`, résout les docks uniquement depuis le registry fixe
`https://opendock.app`, vérifie l'approbation, la signature et le checksum des
docks distants, et limite les commandes de setup à une allowlist. Le dock source
et le registry host ne peuvent pas être changés par variable d'environnement au
runtime. Les pipelines et redirections shell sont refusés.
