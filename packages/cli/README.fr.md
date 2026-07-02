<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Choisissez les setups IA dont vous avez besoin, combinez plusieurs docks par
projet, puis gardez-les faciles à mettre à jour ou supprimer.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock vous aide à ajouter un setup IA à un projet sans reconstruire les mêmes
fichiers et étapes d'outils à la main.

Au lieu de copier des prompts, créer des fichiers de configuration, installer des
outils et répéter le même setup dans chaque projet, vous installez un **dock**.

Un dock est un package réutilisable de setup IA. Vous pouvez en installer un
seul ou combiner plusieurs docks dans le même projet.

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## Ce Que Résout OpenDock

Le setup IA commence simplement : quelques prompts, quelques fichiers, un outil
à installer.

Avec le temps, chaque projet finit avec une configuration différente. Il devient
difficile de savoir quels fichiers ont été ajoutés, quels outils sont installés
et quoi mettre à jour.

OpenDock transforme ce setup en docks que vous pouvez gérer.

- Choisissez le setup IA dont vous avez besoin.
- Combinez plusieurs docks dans un même projet.
- Mettez à jour les docks installés plus tard.
- Supprimez les docks devenus inutiles.
- Gardez la trace de ce qu'OpenDock a ajouté.
- Évitez d'écraser vos propres changements sans avertissement.

OpenDock ne remplace pas le terminal et n'est pas un script runner générique.
C'est un petit outil pour installer et gérer un setup IA répétable.

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Métadonnées et archives des versions revues. |
| **Project scope** | Projet courant | Liste des docks installés, lock, logs et métadonnées projet. |
| **Dock scope** | Un dock installé | Version, checksum, fichiers gérés et workdir privé. |
| **Root output scope** | OpenDock file engine | Fichiers appliqués au project root après vérification préalable. |
| **Host bootstrap scope** | Your machine | Homebrew or WinGet are prepared explicitly with `opendock bootstrap`. |
| **Tool scope** | Installed dock | CLI packages declared in `tools` are installed under `.opendock/tools/` and exposed through `.opendock/bin/`. |

## Install

```bash
bun install -g opendock
opendock version
opendock version --check
```

Si un dock macOS utilise Homebrew et qu'il n'est pas disponible, lancez :

```bash
opendock bootstrap mac
```

Si un dock Windows utilise WinGet et qu'il n'est pas disponible, lancez :

```bash
opendock bootstrap windows
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Installe une version revue du dock dans le dossier courant. |
| `opendock list` | Affiche les docks installés dans le projet courant. |
| `opendock list --json` | Affiche l'inventaire des docks installés en JSON lisible par machine. |
| `opendock outdated` | Vérifie si les docks installés ont des versions revues plus récentes. |
| `opendock update` | Applique les versions revues plus récentes quand des mises à jour existent. |
| `opendock update --force` | Privilégie la version du dock malgré des modifications locales gérées. |
| `opendock uninstall owner/name` | Supprime un dock et les fichiers projet qu'il gère. |
| `opendock doctor` | Vérifie l'état du projet et les steps de diagnostic de chaque dock. |
| `opendock log` | Affiche les logs de commandes récents du projet courant. |
| `opendock version` | Affiche les informations CLI, schema et Registry. |
| `opendock version --check` | Vérifie le canal public des releases OpenDock pour une nouvelle version CLI/app. |
| `opendock bootstrap mac` | Vérifie ou installe Homebrew sur macOS. |
| `opendock bootstrap windows` | Vérifie WinGet ou ouvre Microsoft App Installer sur Windows. |
| `opendock auth login` | Connexion Registry pour deploy. |
| `opendock auth status` | Affiche le login Registry courant. |
| `opendock auth logout` | Efface le login Registry local. |
| `opendock deploy owner/name@1.0.0` | Soumet une version locale du dock à la revue Registry. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Soumet un fichier de version pour macOS. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Soumet un fichier de version pour Windows. |
| `opendock <command> --help` | Affiche les options et l'utilisation d'une commande précise. |

Les références de dock exigent une version exacte.

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

`readme`, `logo` et `tags` sont des metadata pour Registry catalog. Ils servent à
présenter et filtrer le dock dans Hub. Les fichiers à installer dans le projet
doivent aussi être déclarés dans `files`.

Utilisez `workdir.files` quand une task dans le dock-private workdir a besoin de
fichiers d'entrée avant son exécution. Utilisez `files` pour les fichiers à
écrire dans le project root.

## Task Command Permission

Les tasks `run` et `check` d'OpenDock utilisent une petite politique par défaut : `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`. Sur macOS, `brew` est aussi autorisé; sur Windows, `powershell` et `winget`. Les commandes hors politique par défaut doivent d’abord être déclarées dans `tools.commands`; ensuite `permissions` autorise la forme exacte du task. Les opérateurs `|`, `&&`, `||`, `;`, backticks, `$(`, `>` et `<` sont rejetés dans `permissions`, `run` et `check`.

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

Les docks d'exemple sont faits pour être combinés. La plupart installent
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, un `README.md` local, ainsi que des
fichiers de skills/rules propres à chaque outil dans `.agents/skills/`,
`.codex/skills/`, `.claude/skills/` et `.cursor/rules/`. Après installation,
Codex, Claude Code, les agents de type Gemini, Cursor et la discovery OMA-style
peuvent lire le même context projet.

Les tool docks sont `codex`, `claude-code` et `oma`. Les outcome docks comme
`designer-ai`, `product-manager` et `frontend-ai` ajoutent des workspaces par
rôle. Les utility docks comme `agent-ready`, `agent-safety` et `repo-context`
ajoutent des harnesses réutilisables.

Voir la référence complète dans [docs/guides/guide.fr.md](./docs/guides/guide.fr.md).

## Development

```bash
bun install
bun run check
bun run build
```
