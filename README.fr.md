<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Choisissez les docks dont vous avez besoin, combinez-les à votre manière et
gardez chaque projet AI-ready.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock est une CLI TypeScript Bun-first pour choisir et combiner des packs de
configuration IA approuvés, appelés **docks**, dans le workspace courant.

Un dock peut ajouter des agent instructions, prompt libraries, project harnesses,
commandes lifecycle sûres et sorties générées par des outils externes. OpenDock
trace ce qu'il applique pour pouvoir mettre à jour, diagnostiquer ou désinstaller.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## Ce Que Résout OpenDock

Le setup IA finit souvent dispersé entre outils globaux, prompts copiés, config
cachées, snippets README, commandes shell et dossiers d'agents propres à chaque
fournisseur.

OpenDock transforme ce setup en unité versionnée que vous pouvez choisir,
combiner, mettre à jour et supprimer.

- **Outcome-first docks** : installe un workspace utile, pas seulement un outil.
- **Composable setup** : installe plusieurs docks dans un projet et trace chacun séparément.
- **Reviewed distribution** : les installations distantes passent par OpenDock Registry.
- **Project-local tracking** : chaque workspace garde son état dans `.opendock/`.
- **Independent updates** : chaque dock garde sa version, ses fichiers, checksums et workdir privé.
- **Safe root writes** : OpenDock vérifie les conflits avant d'écrire dans le project root.
- **Controlled commands** : les lifecycle commands utilisent une allowlist, pas un raw shell.

OpenDock ne remplace pas le terminal et n'est pas un script runner générique.
C'est une petite couche de packaging pour un setup IA composable et répétable.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Metadata et archives de releases approuvées. |
| **Project scope** | Workspace courant | Installed dock list, lock, logs et metadata projet. |
| **Dock scope** | Un dock installé | Version, checksum, managed file records et private workdir. |
| **Root output scope** | OpenDock file engine | Fichiers appliqués au project root après preflight. |
| **System/tool scope** | Host package managers | Outils préparés par `requires` ou par des lifecycle commands autorisées, comme Homebrew, npm, Bun, pip ou winget. |

## Install

```bash
bun install -g opendock
opendock version
```

Si un dock macOS utilise Homebrew et qu'il n'est pas disponible, lancez :

```bash
opendock bootstrap mac
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Installe un approved dock release dans le dossier courant. |
| `opendock update` | Déplace les installed docks vers les dernières approved Registry releases. |
| `opendock update --force` | Privilégie la version du dock malgré des modifications locales gérées. |
| `opendock uninstall owner/name` | Supprime un dock et ses managed project files. |
| `opendock doctor` | Vérifie project state et doctor steps de chaque dock. |
| `opendock log` | Affiche les runs OpenDock récents du projet courant. |
| `opendock version` | Affiche CLI, schema et Registry information. |
| `opendock auth login` | Connexion Registry pour deploy. |
| `opendock auth status` | Affiche le login Registry courant. |
| `opendock auth logout` | Efface le login Registry local. |
| `opendock deploy owner/name@1.0.0` | Soumet un local dock release à Registry review. |

Les références dock exigent un exact version identifier.

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

lifecycle:
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

`readme` et `logo` sont des metadata pour Registry catalog. Pour les installer
dans le projet, déclarez-les aussi dans `files`.

Voir la référence complète dans [docs/guides/dock-yml.md](./docs/guides/dock-yml.md).

## Development

```bash
bun install
bun run check
bun run build
```
