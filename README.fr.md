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
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock auth status
opendock auth logout
opendock deploy opendock/codex@1.0.0
```

## Pourquoi OpenDock

La configuration d'un espace de travail IA devient souvent un empilement de
commandes shell ponctuelles, de fichiers prompt copiés, de dérive de versions et
de conventions de projet à moitié mémorisées. OpenDock transforme cela en dock
révisé :

- **Portée projet** : installe dans le répertoire courant et écrit l'état local
  `.opendock/`.
- **Approuvé par conception** : les docks distants doivent provenir de metadata
  approuvées par OpenDock Registry.
- **Sûr avec les fichiers existants** : chaque fichier déclare sa propre
  politique d'update, comme managed blocks, manual review ou unique-line append.
- **Surface de commande réduite** : install, update, doctor, inspecter
  les logs, auth et deploy.
- **Prêt pour l'automatisation** : les lifecycle steps peuvent exécuter des
  commandes autorisées comme `git`, `brew`, `winget`, `npm`, `bun`, `pip`,
  `uv`, `codex`, `claude`, `oma` et `omx` sans autoriser les pipelines shell.

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

"$repo/bin/opendock.js" install opendock/codex@1.0.0
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
| `opendock install opendock/codex@1.0.0` | Installe un dock approuvé dans le répertoire courant. |
| `opendock install opendock/codex@designer-build` | Installe avec un identifiant de version exact. |
| `opendock install opendock/codex@1.0.0 --platform windows` | Installe avec une target platform explicite au lieu de détecter le host. |
| `opendock install opendock/codex@1.0.0 --force` | Force les changements managed par OpenDock pendant install. |
| `opendock update` | Résout les docks installés vers la dernière release approuvée du Registry avec la platform verrouillée. |
| `opendock update --force` | Force les changements managed par OpenDock même si des managed files modifiés sont détectés. |
| `opendock doctor` | Affiche l'état OpenDock du répertoire courant avec la platform verrouillée. |
| `opendock log` | Imprime les exécutions OpenDock récentes du projet courant. |
| `opendock version` | Imprime la version CLI, la version du schema et le Registry par défaut. |
| `opendock bootstrap mac` | Vérifie ou installe Homebrew pour les docks macOS. |
| `opendock auth login` | Connecte à OpenDock Registry. |
| `opendock auth status` | Affiche la connexion OpenDock Registry actuelle. |
| `opendock auth logout` | Déconnecte OpenDock Registry sur cette machine. |
| `opendock deploy opendock/codex@1.0.0` | Soumet un dock local `dock.yml` pour revue dans OpenDock Registry. |

`install` est public. `deploy` utilise la connexion OpenDock Registry.
Utilisez `opendock auth status` ou `opendock auth logout` pour l'inspecter ou la supprimer.
Exécutez d'abord `opendock bootstrap mac` si Homebrew est absent.

Les références dock exigent un identifiant de version exact :

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

Install et deploy requièrent tous deux un identifiant de release exact, par exemple
`opendock install owner/name@1.0.0` et `opendock deploy owner/name@1.0.0`.

`opendock install owner/name`, `opendock install owner/name@latest`,
`opendock deploy owner/name` et `opendock deploy owner/name@latest` sont
rejetés.

OpenDock stocke à la fois le version identifier demandé et la version exacte
résolue dans `.opendock/dock.lock.yml`. `opendock update` demande à OpenDock
Registry la dernière release approuvée de chaque dock installé, applique cette
exact release et met à jour le lock file. Pour passer à une release précise au
lieu de la dernière approuvée, exécutez `opendock install owner/name@new-version`.

## Format Du Dock

Un dock est un répertoire contenant un fichier `dock.yml` et les fichiers ou
répertoires source référencés par `files[].from`. Les chemins optionnels
`readme` et `logo` sont soumis à OpenDock Registry comme metadata de catalogue ;
ils ne sont pas installés sauf s'ils sont aussi listés dans `files`.
Les release versions ne sont pas déclarées dans `dock.yml` ; la version vient de
la deploy reference `opendock deploy owner/name@version`. Deploy empaquette
`dock.yml` et les install payloads de `files[].from` et lifecycle `copy.from`
dans une `.tgz` submission archive pour review. `readme` et `logo` sont soumis
uniquement comme catalog metadata, sauf s'ils sont aussi listés comme install
payloads.
Consultez [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) pour le guide
détaillé de rédaction en coréen.

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup with managed workspace files.
readme: DOCK.md
logo: logo.png

files:
  - from: files/.agents
    to: .agents
    update: managed_file

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

Les répertoires source sont développés récursivement. `managed_file` remplace ou
supprime un fichier seulement lorsque son hash actuel correspond au dernier hash
appliqué par OpenDock. Les managed files modifiés arrêtent install/update avant
les changements de fichiers ou les commandes lifecycle. `--force` remplace ou
supprime ces managed files.

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

## Structure Du Dépôt

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Registry dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Registry API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
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


## Écosystème

OpenDock est conçu pour s'intégrer naturellement aux projets comme
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode) et
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) : des outils
agent-native qui rendent les workflows de projet locaux plus portables,
inspectables et répétables.
