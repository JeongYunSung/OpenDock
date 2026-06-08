<div align="center">

# OpenDock

**Des docks approuvés pour les espaces de travail IA.**

Installez la configuration de projet que vous approuvez avec une seule commande.
Gardez une surface de commande réduite, une configuration répétable et chaque
fichier généré auditable.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock est une CLI TypeScript Bun-first pour installer des docks approuvés
dans le répertoire courant du projet.

Le premier dock est `opendock/codex` : un dock général de setup Codex qui vérifie
Node, installe la CLI Codex, applique des fichiers de projet révisables et garde
la configuration suivie dans l'état OpenDock.

OpenDock n'est volontairement pas un remplacement du terminal. C'est le petit
binaire à exécuter lorsqu'un projet a besoin d'une configuration IA fiable.

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

## Pourquoi OpenDock

La configuration d'un espace de travail IA devient souvent un empilement de
commandes shell ponctuelles, de fichiers prompt copiés, de dérive de versions et
de conventions de projet à moitié mémorisées. OpenDock transforme cela en dock
révisé :

- **Portée projet** : installe dans le répertoire courant et écrit l'état local
  `.opendock/`.
- **Approuvé par conception** : les docks distants doivent provenir de metadata
  approuvées par OpenDock Hub.
- **Sûr avec les fichiers existants** : chaque fichier déclare sa propre
  politique d'update, comme managed blocks, manual review ou unique-line append.
- **Surface de commande réduite** : install, update, diagnostiquer, inspecter
  les logs, auth et deploy.
- **Prêt pour l'automatisation** : les lifecycle steps peuvent exécuter des
  commandes autorisées comme `git`, `brew`, `winget`, `npm`, `bun`, `pip`,
  `uv`, `codex`, `claude` et `oma` sans autoriser les pipelines shell.

## Démarrage Rapide

OpenDock n'est pas encore publié via un package manager. Construisez-le depuis
les sources :

```bash
bun install
bun run build
bin/opendock.js version
```

Essayez le dock approuvé `opendock/codex` dans un projet temporaire :

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

Après l'installation, le projet contient :

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## Commandes

| Commande | Objectif |
|---|---|
| `opendock install opendock/codex` | Installe un dock approuvé dans le répertoire courant. |
| `opendock install opendock/codex@1.5` | Installe avec un version selector. |
| `opendock install opendock/codex --platform windows` | Installe avec une target platform explicite au lieu de détecter le host. |
| `opendock update` | Re-résout les docks installés et applique les nouvelles versions en sécurité avec la platform verrouillée. |
| `opendock doctor` | Affiche l'état OpenDock du répertoire courant avec la platform verrouillée. |
| `opendock log` | Imprime les exécutions OpenDock récentes du projet courant. |
| `opendock version` | Imprime la version CLI, la version du schema et le Hub par défaut. |
| `opendock bootstrap mac` | Vérifie ou installe Homebrew pour les docks macOS. |
| `opendock auth login` | Enregistre un token OpenDock Hub. |
| `opendock deploy codex` | Soumet un dock local `dock.yml` pour revue dans OpenDock Hub. |

`install` est public. `deploy` nécessite `opendock auth login`.
Exécutez d'abord `opendock bootstrap mac` si Homebrew est absent.

Les références dock prennent en charge les version selectors de style npm :

```text
owner/name          -> latest
owner/name@latest   -> latest
owner/name@1        -> latest approved 1.x
owner/name@1.5      -> latest approved 1.5.x
owner/name@1.5.2    -> exact approved version
owner/name@v1       -> latest approved 1.x
```

OpenDock stocke à la fois le selector demandé et la version exacte résolue dans
`.opendock/dock.lock.yml`. `opendock update` réutilise le selector demandé :
une installation fixée à `@1.5.2` reste fixée, tandis que `@1.5` peut évoluer
dans `1.5.x`.

## Format Du Dock

Un dock est un répertoire contenant un fichier `dock.yml` et les fichiers source
référencés par `files[].from`.
Consultez [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) pour le guide
détaillé de rédaction en coréen.

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

Les chemins `from` sont relatifs à la racine du dock. `files/` est seulement le
nom de dossier recommandé dans l'exemple ; OpenDock n'exige pas de répertoire
payload spécial.

Les commandes lifecycle spécifiques à une platform restent dans l'ordre normal
top-to-bottom de `install`, `update` et `doctor`. Un step avec `platforms`
conserve un `id` logique, puis OpenDock fusionne l'override correspondant :

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

Les steps sans `platforms` s'exécutent sur toutes les platforms. La platform
sélectionnée est stockée dans `.opendock/dock.lock.yml`, puis réutilisée par
`opendock update` et `opendock doctor`.

Les lifecycle steps interactifs peuvent soit donner le contrôle à l'utilisateur,
soit envoyer une petite séquence de touches approuvée via un PTY macOS `expect` :

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

## Structure Du Dépôt

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Hub dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Hub API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
docs/plans/work/      # implementation plan and verification notes
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## Développement

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

Les tests d'intégration utilisent des répertoires temporaires et des fixtures de
dock local générées. Les docks dans `examples/` sont de vrais exemples de rédaction.

## Portée Actuelle

OpenDock est une CLI MVP. Les éléments suivants ne sont pas encore fournis :

- service hosted de revue OpenDock Hub
- distribution via package manager
- UX complète du dock catalog sur `https://hub.opendock.app`
- automatisation des binary releases

La CLI inclut déjà local fixture flow, remote Hub API client boundary, project
state, logging, auth token storage, deploy submission plumbing et regression
tests.

Lorsque le service hosted sera disponible, `https://opendock.app` sera le
product site, `https://hub.opendock.app` le dock catalog pour les humains,
et `https://hub.opendock.app/v1/docks` la racine de l'API Hub de la CLI.

## Écosystème

OpenDock est conçu pour s'intégrer naturellement aux projets comme
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode) et
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) : des outils
agent-native qui rendent les workflows de projet locaux plus portables,
inspectables et répétables.
