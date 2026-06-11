# Guide OpenDock

`dock.yml` décrit ce qu'un dock ajoute à un projet : fichiers, outils requis,
commands de install/update/doctor, et outputs générés par des outils externes à
exporter vers le project root.

OpenDock est une petite couche de packaging pour AI workspace setup. Vous pouvez
choisir plusieurs docks, les combiner dans un même workspace, puis gérer update
et uninstall séparément pour chaque dock.

Translations:

- [English](./guide.md)
- [한국어](./guide.ko.md)
- [日本語](./guide.ja.md)
- [中文](./guide.zh.md)
- [Español](./guide.es.md)
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

`files/` est une convention. Tout path sûr déclaré dans `files[].from` peut être utilisé.

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
| `id` | Dock id au format `owner/name`. |
| `name` | Nom lisible dans le catalog. |
| `summary` | Résumé court pour Registry catalog. |
| `readme` | Markdown pour la page de détail du catalog. |
| `logo` | Image logo du catalog. |
| `requires` | Runtime et package requirements. |
| `files` | Fichiers ou dossiers appliqués au project root. |
| `install` | Commands for first install and initial generation. |
| `update` | Commands for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

La release version ne se déclare pas dans `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`owner/name` et `owner/name@latest` sont rejetés. Utilisez une version exacte.

## Files And Ownership

Les fichiers texte comme `AGENTS.md` sont appliqués comme managed blocks. Les
configs et binary files sont protégés par checksum. Si quelqu'un modifie du
contenu géré par OpenDock, update s'arrête avant d'écrire dans le root. `--force`
choisit explicitement la version du dock.

## Commands

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

Les steps s'exécutent de haut en bas. `doctor` doit vérifier l'état sans modifier
le projet.

## Workdir And Export

Utilisez `workdir: dock` quand un outil externe génère des fichiers. Exportez
uniquement les fichiers qui doivent être gérés par OpenDock.

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
```

Deploy envoie `dock.yml`, une archive construite depuis `files[].from`, les
metadata de release platform, `readme_markdown` optionnel et `logo` optionnel.
