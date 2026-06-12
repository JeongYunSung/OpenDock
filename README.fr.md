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

OpenDock aide à préparer des workspaces prêts pour l'IA.

Au lieu de copier des prompts, créer des fichiers de configuration, installer des
outils et répéter le même setup dans chaque projet, vous installez un **dock**.

Un dock est un package de workspace IA prêt à l'emploi. Vous pouvez en installer
un seul ou combiner plusieurs docks dans le même projet.

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

- Choisissez le setup de workspace IA dont vous avez besoin.
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
| **Registry scope** | OpenDock Registry | Metadata et archives de releases approuvées. |
| **Project scope** | Workspace courant | Installed dock list, lock, logs et metadata projet. |
| **Dock scope** | Un dock installé | Version, checksum, managed file records et private workdir. |
| **Root output scope** | OpenDock file engine | Fichiers appliqués au project root après preflight. |
| **System/tool scope** | Host tools | Runtimes préparés par `requires` et outils installés par des install/update/doctor tasks autorisées, comme Homebrew, npm, Bun, pip ou winget. |

## Install

```bash
bun install -g opendock
opendock version
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
| `opendock install owner/name@1.0.0` | Installe un approved dock release dans le dossier courant. |
| `opendock list` | Affiche les docks installés dans le projet courant. |
| `opendock update` | Déplace les installed docks vers les dernières approved Registry releases. |
| `opendock update --force` | Privilégie la version du dock malgré des modifications locales gérées. |
| `opendock uninstall owner/name` | Supprime un dock et ses managed project files. |
| `opendock doctor` | Vérifie project state et doctor steps de chaque dock. |
| `opendock log` | Affiche les runs OpenDock récents du projet courant. |
| `opendock version` | Affiche CLI, schema et Registry information. |
| `opendock bootstrap mac` | Vérifie ou installe Homebrew sur macOS. |
| `opendock bootstrap windows` | Vérifie WinGet ou ouvre Microsoft App Installer sur Windows. |
| `opendock auth login` | Connexion Registry pour deploy. |
| `opendock auth status` | Affiche le login Registry courant. |
| `opendock auth logout` | Efface le login Registry local. |
| `opendock deploy owner/name@1.0.0` | Soumet un local dock release à Registry review. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Soumet un artifact de release propre à la plateforme. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Soumet un artifact de release propre à la plateforme. |

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

## Example Docks

Les workspace examples ne sont pas des exemples vides : ce sont des payloads
prêts à l'emploi. Ils installent `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, un
`README.md` local, ainsi que des fichiers provider-specific de skills/rules dans
`.agents/skills/`, `.codex/skills/`, `.claude/skills/` et `.cursor/rules/`.
Après installation, Codex, Claude Code, les agents de type Gemini, Cursor et la
discovery OMA-style peuvent lire le même context projet.

Les tool docks sont `codex`, `claude-code` et `oma`. Les outcome docks comme
`designer-ai`, `product-manager` et `frontend-ai` ajoutent des workspaces par
rôle. Les utility docks comme `agent-ready`, `agent-safety` et `repo-context`
ajoutent des harnesses réutilisables.

Les pro addon docks suivent le modèle `<dock>-pro`. Le dock simple reste léger ;
le pro addon ajoute specialist skills, workflow playbooks, Claude Code subagents,
Claude Code command adapters, Codex custom agents et Cursor rules. Exemple :
[opendock/designer-ai-pro](https://hub.opendock.app/docks/opendock/designer-ai-pro).

Voir la référence complète dans [docs/guides/guide.fr.md](./docs/guides/guide.fr.md).

## Development

```bash
bun install
bun run check
bun run build
```
