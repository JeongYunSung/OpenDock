# Guide OpenDock

`dock.yml` décrit ce qu'un dock ajoute à un projet : fichiers, runtime
requirements, project-local tools, dependencies dans des dossiers copiés, tasks
de install/update/doctor, et outputs générés par des outils externes à exporter
vers le project root.

OpenDock est une petite couche de packaging pour un setup IA répétable. Vous pouvez
choisir plusieurs docks, les combiner dans un même projet, puis gérer update
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
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png
tags:
  - ai-agent
  - starter

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
| `name` | Nom lisible dans le catalog. |
| `summary` | Résumé court pour Registry catalog. |
| `readme` | Markdown pour la page de détail du catalog. |
| `logo` | Image logo du catalog. |
| `tags` | Labels lowercase pour la recherche et les filtres Hub. |
| `permissions` | Autorise des formes exactes de task pour les commandes par défaut ou déclarées dans tools. |
| `requires` | Runtime requirements. |
| `tools` | CLI packages installed and tracked under `.opendock/tools/`. |
| `dependencies` | Package dependencies installed inside folders copied by the dock. |
| `files` | Fichiers ou dossiers appliqués au project root. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Dependencies

Utilisez `dependencies` quand le dock copie un dossier dans le projet et que ce
dossier a besoin de ses propres package dependencies. `tools` installe des
commands sous `.opendock/tools/`; `dependencies` appartient à un payload copié,
comme un Codex skill, un harness ou une helper app.

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"

files:
  - from: image2html
    to: .codex/skills/image2html

dependencies:
  image2html:
    manager: npm
    path: .codex/skills/image2html
    mode: locked
```

OpenDock applique d'abord `files`, puis installe `dependencies` dans le `path`
déclaré. Pendant update et uninstall, OpenDock supprime les outputs générés
comme `node_modules`, `.venv` ou `.opendock/python`.

| Manager | Modes |
|---|---|
| `npm` | `install`, `locked` |
| `pnpm` | `install`, `locked` |
| `bun` | `install`, `locked` |
| `uv` | `install`, `locked` |
| `pip`, `pip3` | `install` depuis `requirements.txt` |

`locked` désigne l'installation lockfile/frozen propre à chaque manager. En
interne, OpenDock utilise `npm ci`, `pnpm install --frozen-lockfile`,
`bun install --frozen-lockfile` ou `uv sync --frozen`.

## Version

La release version ne se déclare pas dans `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

Utilisez `opendock <command> --help` pour voir les options d'une commande.

```bash
opendock install --help
opendock doctor --help
opendock auth login --help
```

`owner/name` et `owner/name@latest` sont rejetés. Utilisez une version exacte.

Après l'installation, `opendock list` affiche les docks installés dans le projet
actuel.
Si un autre outil doit lire cette liste, utilisez `opendock list --json`.
`opendock log` affiche l'historique des commandes du projet avec un statut `Success`,
`Failure` ou `Skipped`.

## Files And Ownership

Les fichiers texte comme `AGENTS.md` sont appliqués comme managed blocks. Les
configs et binary files sont protégés par checksum. Si quelqu'un modifie du
contenu géré par OpenDock, update s'arrête avant d'écrire dans le root. `--force`
choisit explicitement la version du dock.
Agent runtime files under `.codex/`, `.claude/`, `.agents/`, and
`.github/copilot-instructions.md`, `.github/instructions/` stay exact so frontmatter, hooks, and executable bits
remain valid.

## Tasks

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

## Task Command Permission

OpenDock ne transmet pas `run` ni `check` directement à un shell. La politique par défaut autorise seulement `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`. Sur Windows, un `powershell` limité est aussi autorisé. Mais une commande par défaut n'autorise pas n'importe quel subcommand : seules les formes sûres comme `git status`, `git init -b main`, `test -f <path>`, les checks de version et le `Test-Path` limité de Windows passent. Les commandes hors politique par défaut doivent d’abord être déclarées dans `tools.commands`; ensuite `permissions` autorise la forme exacte du task. `tools.commands` ne peut pas réutiliser des noms par défaut d'OpenDock comme `git`, `node`, `npm` ou `python`. Les opérateurs `|`, `&&`, `||`, `;`, backticks, `$(`, `>` et `<` sont rejetés dans `permissions`, `run` et `check`. Les commandes d'installation/update de packages comme `npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install` et `winget install` sont rejetées dans les tasks. Utilisez `tools` pour les project tools, `dependencies` pour les package dependencies dans les dossiers copiés du projet et `requires.runtimes` pour les runtimes.

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

## Workdir Files And Export

Utilisez `workdir.files` quand un générateur a besoin de fichiers d'entrée avant
son exécution. Utilisez ensuite `workdir: dock` et exportez uniquement les
fichiers qu'OpenDock doit gérer dans le projet.

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

workdir:
  files:
    - from: workdir/oma-config.yaml
      to: .agents/oma-config.yaml

install:
  - id: apply-oma
    run: oma -y install
    workdir: dock
  - id: link-oma-vendors
    run: oma link claude codex
    workdir: dock
    export:
      include:
        - AGENTS.md
        - CLAUDE.md
        - .agents/**
        - .codex/**
        - .claude/**
      exclude:
       - "**/*.log"
```

## Example Docks

Les workspace examples de `examples/` sont des payloads installables. Sauf pour
les tool docks, ils installent `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`README.md` et des fichiers provider-specific dans `.agents/skills/`,
`.codex/skills/`, `.claude/skills/` et `.cursor/rules/`, afin que les agents IA
puissent lire immédiatement le context projet.

Les bundled examples ont des manifests séparés pour macOS et Windows. La suite de tests parse chaque manifest, vérifie les références de fichiers, contrôle les Windows doctor checks et valide chaque task command avec la politique actuelle.

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy envoie `dock.yml`, une archive construite depuis `files[].from` et
`workdir.files[].from`, les metadata de release platform, `readme_markdown`
optionnel, `logo` optionnel et les `tags` optionnels du manifest.
