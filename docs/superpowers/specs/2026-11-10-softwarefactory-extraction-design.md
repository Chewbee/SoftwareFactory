# Extraction de l'usine Claude Code — dépôt SoftwareFactory (design)

Statut : design validé en session le 2026-11-10, avant plan d'implémentation.
Séquence du processus (CLAUDE.md « Les deux chaînes ») : cadrage → ce spec →
plan → exécution → relecture → PR vers `dev`.

## Résumé

La « software factory » — tout ce qui pilote les agents Claude Code du projet
(`.claude/` hors produit, hooks, agents, skills de processus, conventions
d'issues, hooks Jev) — est extraite **par copie** dans un nouveau dépôt GitHub
`SoftwareFactory`, structuré en **plugin + marketplace Claude Code d'une seule
racine**. Adonnante continue de fonctionner avec ses copies locale jusqu'à ce
que l'usine soit **prouvée sur un consommateur réel** ; alors une deuxième PR
remplace les copies par l'adoption. Objectif final : une usine **multi-projets
et multi-harnais** (Claude Code d'abord, Hermes-Agent ensuite).

## Pourquoi

L'usine vit vite et est dupliquée par projet. L'extraire la fait évoluer hors du
produit, la réutilise sur d'autres projets, et ouvre le portage vers d'autres
harnais. Jev est le cœur de cette usine : coupler la puissance des LLM à un
décision model pour optimiser les coûts et accélérer (routage de modèles,
verdicts de relecture, décisions de l'agent principal).

## Décisions arrêtées

| # | Décision | Source (session 2026-11-10) |
|---|---|---|
| D1 | Multi-projets : seule la mécanique générique migre ; règles et skills propres à Adonnante restent. | Q1 : « la mécanique générique seule » |
| D2 | L'usine vit dans son propre dépôt et s'injecte dans un projet quand on veut l'utiliser Mécanisme : plugin Claude Code + marketplace GitHub, patron prouvé (`superpowers-extended-cc`). | Q2 : « la factory est dans son propre repo et on peut l'injecter dans un repo quand on veut l'utiliser » |
| D3 | MAJ auto à chaque session, comme les deux plugins actuels (autoUpdate + hook SessionStart). | Q3 : « Auto-update à chaque session » |
| D4 | Noyau : v1 intact dans Adonnante ; v2, ses sections d'usine migrent dans un skill du plugin injecté par hook SessionStart (patron `using-superpowers`). | Q4 : « Progressif » |
| D5 | Nom du dépôt : `SoftwareFactory`. Plugin namespacé `softwarefactory:`. | Retouches : « le nom SoftwareFactory », « très bien de prefixer et de namespacer » |
| D6 | Le marketplace SF **absorbe** les autres plugins (superpowers-extended-cc, cesiumjs-skills) : v1 **référencés, pas forkés** (entrée `source` GitHub) ; un fork est possible plus tard si on doit diverger. | Retouches : « Oui on absorbe (inclus d'autres plugin) » |
| D7 | Portabilité harnais : contenu harnais-neutre, câblage Claude Code = premier adaptateur, adaptateur Hermes-Agent ensuite. | Retouches : « rapidement il faudra que cela fonctionne avec d'autres model dans un autre harnais (hermes-agent ?) » |
| D8 | Le tableau de bord est un composant de l'usine (kanban inter-agents), conçu séparément ; l'incarnation Adonnante reste jusqu'à ce jour. | Retouches : « le dashboard c'est celui de l'usine … il faudra le designer separement » |
| D9 | Extraction par copie, zéro destruction ; bascule Adonnante seulement quand SF est prouvée. | Retouches : « on extrait en copiant pas en detruisant Adonnante, quand la software factory sera prouvé ALORS on enlevera » |
| D10 | Jev fait partie de l'usine. | Retouches : « JEV fait partie de la factory » |
| D11 | CI de l'usine calquée sur celle d'Adonnante : runners hébergés dans le cloud, Hetzner pour commencer (même flotte que Adonnante), changeable plus tard. | Retouches : « la CI est comme dans adonnante avec des runners hostés dans le cloud (prenons hetzner comme adonnante on pourra changer plus tard) » |
| D12 | Périmètre skills : toute skill qui aide à coder, debugger, tester, spécifier, illustrer, écrire correctement part à la SF ; ce qui est langage ou framework reste projet. | Retouches : « toutes les skills qui aide a coder , debugger , tester , specifier , iluuster , ecrire correctemtn vont dans la software factory … ce qui est langage , framework , non c est du projet » |
| D13 | Le pilotage GitHub + Linear (features Linear team SF, bugs GitHub, synchro bidirectionnelle, traçabilité branches/PR/commits) est un **composant de l'usine** — opéré, documenté (`docs/pilotage-github-linear.md`), suivi dans l'EPIC C4 (SF-33..36), reproductible par projet consommateur. Cycle prouvé le 2026-11-11 : liaison `Refs SF-9` lue par l'API, `Fixes SF-10/11` au merge → miroirs fermés. | Session du 2026-11-11 : « ce setup Github + linear est maintenant un composant de la softwareFactory » |

## Ce qui migre, ce qui reste

### Agents `.claude/agents/`

| Migrate vers SF (6) | Reste à Adonnante (1) |
|---|---|
| `analyste`, `implementeur`, `relecteur`, `relecteur-basic`, `executant-basic`, `typesafe-explorateur` — deviennent `softwarefactory:<nom>` | `dashboard-builder` — jusqu'à ce que le kanban usine existe (D8) |

### Skills `.claude/skills/`

| Migrent vers SF (9) | Restent à Adonnante (4) |
|---|---|
| `technical-writing`, `writing-design-docs`, `reviewing-technical-prose`, `recording-decisions`, `documenting-legacy-codebases`, `task-observer`, `redaction-pr-issues` (paraphrasé « ce dépôt » → « le dépôt courant »), `routine-bug-fix`, `routine-feature` (D12) — ces deux dernières réécrites sans mention Adonnante : label de tri, branche cible et recette deviennent des liaisons du projet consommateur, citées par le noyau, pas par la skill | `rust-best-practices`, `rust-skills`, `rust-tauri-security`, `tauri-v2` — langage et framework, côté projet |

Aucune skill d'illustration n'existe encore dans le dépôt ; la SF en
intègre quand la preuve de Phase A est passée (candidats : skills du compte
utilisateur, listés au plan). « Spécifier » et « écrire correctement » sont
déjà couverts par les skills migrées ci-dessus.

`NOTICE-skills-compte.md` cite exactement les skills migrées (provenance
riekelt/technical-writer, sources vérifiées) : il migre **en entier** avec les
skills couvertes, chemins mis à jour. Les skills restantes portent leur
provenance en inline ; le plan vérifie s'il en faut une notice Adonnante.

### Hooks `.claude/hooks/` (chaque groupe avec son `*-core.mjs` et ses `*.test.mjs`)

| Migrate vers SF | Reste à Adonnante |
|---|---|
| `plugin-a-jour`, `checkout-a-jour`, `git-stash-guard`, `jev-cli` (+ `jev-cli-choix.test.mjs`), `jev-model`, `jev-verdict`, `etat-job`, `etat-job-publier` | `lint-format.mjs` (cible pnpm/src-tauri du projet), `ts-verifie` (`packages/web`, `packages/shared`, vitest, `.cargo-target-shared`), et les trois gardes portant sur des actifs projet : `rules-frontmatter.test.mjs`, `taches-natives.test.mjs`, `agents-skills-preload.test.mjs` (voir § Gardes scindées) |

Le câblage des hooks migrés quitte `settings.json` pour `hooks/hooks.json` du
plugin, avec `${CLAUDE_PLUGIN_ROOT}` ; les entrées SessionStart, PreToolUse
(`Agent`, `mcp__claude-code-remote__create_session`, `Bash|PowerShell`),
PostToolUse (`TaskCreate|TaskUpdate`), SubagentStop/SubagentHandback de
jev/etat-job/git-stash-guard/plugin-a-jour/checkout-a-jour se reportent telles
quelles. Windows : même patron de wrapper que superpowers-extended-cc
(`hooks/run-hook.cmd`) si ses wrappers s'avèrent nécessaires — le plan le
constate sur recette réelle.

### Docs de convention `docs/06-agents/`

Migrent : `issue-tracker.md`, `triage-labels.md` — avec un stub d'une ligne à
leur ancienne place et la mention du plugin consommateur. Restent :
`domain.md`, `backlog.md`, `carte-claude-md.md`, `journal*`, `boucles-de-fond.md`,
les briefs datés, `ci-runners.md` (liés au produit ou au noyau v1).

### Scripts et CI

Rien ne migre en Phase A. `scripts/git-worktree-safe.mjs`, `ci-que-des-md.mjs`,
`escalade.mjs`, `index-adr.mjs`, `tableau-de-bord.mjs` restent dans Adonnante :
le noyau qui les cite reste lui-même dans Adonnante (D4). Les workflows
`.github/workflows/` restent : ce sont ceux du produit. L'usine a sa CI
minimale propre (§ Critères d'acceptation). Les scripts génériques candidats à
l'usine (`git-worktree-safe`) sont notés pour v2, quand le noyau les suit.

## Structure du dépôt SoftwareFactory

Patron calqué sur `pcvelz/superpowers`, vérifié dans son cache installé :
plugin et marketplace d'une même racine, composants auto-découverts.

```
SoftwareFactory/
├── .claude-plugin/
│   ├── plugin.json        # name: softwarefactory, version, author
│   └── marketplace.json   # name, owner, plugins: [ softwarefactory "./",
│                          #   superpowers-extended-cc → pcvelz/superpowers,
│                          #   cesiumjs-skills → CesiumGS/cesiumjs-skills ]
├── agents/                # analyste.md, implementeur.md, relecteur.md,
│                          # relecteur-basic.md, executant-basic.md,
│                          # typesafe-explorateur.md
├── skills/                # les 7 skills migrées, NOTICE mise à jour
├── hooks/
│   ├── hooks.json         # le câblage migré, ${CLAUDE_PLUGIN_ROOT}
│   ├── run-hook.cmd       # wrapper Windows, patron superpowers-extended-cc
│   └── *.mjs              # hooks + cores + tests migrés
├── docs/
│   ├── issue-tracker.md   # conventions migrées
│   ├── triage-labels.md
│   ├── harnais.md         # charte de portabilité (D7) : contenu neutre,
│   │                      # adaptateurs par harnais, Claude Code v1
│   ├── adoption.md        # comment un projet adopte l'usine
│   ├── backlog-linear.md  # conventions Linear/GitHub (D13)
│   └── pilotage-github-linear.md  # composant pilotage : setup, preuve,
                                  # recette de reproduction (D13, EPIC C4)
├── tests/                 # si besoin de tests transverses (le reste vit avec
│                          # les hooks), exécutés par `node --test`
├── CLAUDE.md              # développement de l'usine SEULEMENT (dogfooding)
├── AGENTS.md              # équivalent pour les harnais qui lisent AGENTS.md
├── package.json           # scripts de test ; zéro dépendance runtime
└── .github/workflows/     # CI calquée sur celle d'Adonnante (D11) : jobs
                           # node --test des hooks migrés à chaque PR ;
                           # runners hébergés Hetzner (labels hote-*), à
                           # changer plus tard si besoin
```

Un point de nommage : le nom de plugin `softwarefactory` impose le préfixe sur
TOUT l'outillage — skills/agents préfixés automatiquement, matchers écrits
`softwarefactory:relecteur|softwarefactory:relecteur-basic`, et le champ
`skills:` du frontmatter des agents mis à jour en conséquence.

## Adoption d'un projet et mise à jour

Trois gestes, une fois par projet (« injection » de D2) :

1. `.claude/settings.json` :
   ```json
   "extraKnownMarketplaces": {
     "softwarefactory-marketplace": {
       "source": { "source": "github", "repo": "Chewbee/SoftwareFactory" },
       "autoUpdate": true
     }
   },
   "enabledPlugins": {
     "softwarefactory@softwarefactory-marketplace": true
   }
   ```
   (l'owner GitHub `Chewbee` est celui du cron existant
   `repos/Chewbee/Adonnante` ; à confirmer au plan si un autre compte est
   visé).
2. `.claude/plugins-a-jour.json` : plugin `softwarefactory` ajouté à la liste
   projet (§ suivant).
3. Premier démarrage : `plugin-a-jour` install le plugin en scope `local`, comme
   les deux actuels ; ensuite MAJ auto à chaque session (D3).

Pendant la phase de copie (D9), Adonnante n'exécute AUCUN des trois gestes :
le plugin reste désactivé, donc AUCUN hook n'est exécuté deux fois (les hooks
de plugin n'ont pas de préfixe : doublon settings + plugin = exécution double,
documenté ; les skills/agents, eux, sont préfixés et ne collisionnent pas).

## plugin-a-jour paramétrable

Aujourd'hui `PLUGINS` est une constante des deux entrées projet. Migré dans
l'usine, il devient paramétrable : lecture optionnelle de
`$CLAUDE_PROJECT_DIR/.claude/plugins-a-jour.json` (tableau des descripteurs au
même format que la constante actuelle : `nom`, `marche`, `source`).

- fichier présent : la liste du projet fait foi (elle mentionne elle-même
  superpowers, cesiumjs-skills et softwarefactory) ;
- absent : les deux entrées superpowers + cesiumjs-skills d'aujourd'hui,
  pour rester utile hors projet configuré et pour l'usine elle-même.

Gardes maintenues : idempotence des quatre commandes, arrêt à la première
échec par plugin, message de succès inchangé, délais sous le `timeout` du hook
(test existant adapté), écriture bruyante de tout échec (règle « Jamais de
repli silencieux »).

## Le shim jev-cli et les outils appelés à la main

Problème : `jev-cli` est lancé à la main par les agents
(`node "$CLAUDE_PROJECT_DIR/.claude/hooks/jev-cli.mjs" niveau --role <agent>`)
et par le noyau ; la permission allow le cite ; or le chemin d'un plugin
installé change à chaque version (cache par version).

Solution : un hook SessionStart de l'usine (le même qui installe tout) écrit —
et réécrit à chaque session (self-healing, discipline `plugin-a-jour`) — un
shim :

- `$CLAUDE_PROJECT_DIR/.claude/hooks/jev-cli.mjs` = un ré-export d'une ligne
  vers la version installée du plugin (résolution par
  `~/.claude/plugins/installed_plugins.json`, échec franc et signalé si le
  plugin est introuvable — jamais de repli silencieux).

Conséquences : la ligne noyau, la permission
`Bash(node .claude/hooks/jev-cli.mjs:*)`, et tous les briefs continuent de
marcher mot pour mot. Le même mécanisme servira tout futur outil d'usine
appelable à la main. Le shim est du code d'usine réécrit chaque session : une
édition manuelle du projet est écrasée, c'est voulu — le fichier est généré,
pas source. À recette : le dossier `.claude/hooks/` projet reste le sien pour
lint-format/ts-verifie qui l'occupent déjà — le plan traite la cohabitation
des chemins (le shim ne supprime rien).

## Noms préfixés et matchers

- Agents invocables : `softwarefactory:analyste`, `softwarefactory:implementeur`,
  `softwarefactory:relecteur`, `softwarefactory:relecteur-basic`,
  `softwarefactory:executant-basic`, `softwarefactory:typesafe-explorateur`.
- `jev-model` (PreToolUse `Agent` + `create_session`) lit `subagent_type` :
  sa table des bandes de modèles (ADR-0194, point 1) passe aux noms préfixés ;
  le comportement de repli est signalé par le hook, inchangé.
- `jev-verdict` : matcher SubagentStop/SubagentHandback devient
  `softwarefactory:relecteur|softwarefactory:relecteur-basic`.
- Noyau Adonnante (v1, texte seul) : la table « Le processus superpowers »
  renomme `analyste` → `softwarefactory:analyste` etc., et la section
  « Skills de domaine » dit que les skills de processus viennent du plugin
  `softwarefactory`.

## Le noyau CLAUDE.md (D4)

- v1 : le noyau reste intact, trois retouches textuelles (§ précédent).
- v2 (chantier séparé, PAS chiffré ni daté ici) : les sections du noyau qui ne
  sont pas des décisions proprement Adonnante (processus multi-agents, fusion
  auto, journal) migrent dans un skill `softwarefactory:core-rules` injecté en
  tête de session par un hook SessionStart — le patron exact de
  `using-superpowers`, déjà chargé dans chaque session. Le noyau Adonnante
  ne garde alors que les décisions projet (branches `dev`/`master`, recette,
  glossaire métier, ADRs).

## Tableau de bord inter-agents (D8)

Composant de l'usine, design séparé : probablement un kanban où les agents se
passent le travail, commun à tous les projets consommateurs. Sa spec viendra
plus tard. D'ici là : l'incarnation Adonnante (agent `dashboard-builder`,
page Artifact « Suivi Adonnante », ADR-0191) reste en l'état — elle est
explicitement hors du périmètre de migration.

## Portabilité harnais (D7)

Charte écrite dans `docs/harnais.md` : le contenu de l'usine — SKILL.md,
agents .md, logique des hooks en modules Node purs (`*-core.mjs`, sans
dépendance au format d'événement Claude Code), les CLI appelables à la main —
ne citent jamais Claude Code spécifique. La couche par harnais n'est que :
câblage d'événements (`hooks/hooks.json` pour Claude Code) et mécanisme
d'injection de contexte (hook SessionStart chez Claude Code ; skill injectée
ou `SOUL/AGENTS.md` chez Hermes-Agent).

- v1 : adaptateur Claude Code complet (ce spec).
- v1+1 (juste après, prévu, non chiffré) : adaptateur Hermes-Agent — les
  skills sont chargées via le loader de skills Hermes, les agents via la
  table `role` → fichiers, `jev-cli` devient appelable directement par
  l'agent Hermes, le shim n'a pas d'équivalent nécessaire (Hermes résout ses
  propres chemins). Critère de sortie : une session Hermes-Agent à Adonnante
  voit les skills `softwarefactory:*` via `skills_list`.

## CI de SoftwareFactory (D11)

Architecture calquée sur celle d'Adonnante (`docs/06-agents/ci-runners.md` et
les workflows du produit font foi, à l'exception des jobs proprement produit).

- Runners **hébergés** : la même flotte Hetzner qu'Adonnante, labels `hote-*` ;
  inventaire lu par l'API runners de GitHub (patron ADR-0156), nettoyage et
  assainissement après usage. Changer d'hébergeur reste possible plus tard (D11).
- Jobs SF : `node --test` des hooks et cores migrés à chaque
  PR et push (même exécuteur qu'au jour de la copie), validation du manifeste
  (`claude plugin validate`), rien d'autre en Phase A.
- Aucun équivalent des jobs produit d'Adonnante : `rust-coverage`, `mutation`,
  `web-tests`, `escalade`, `release` — la SF est un dépôt de contenu et de
  hooks Node purs, sans runtime produit à valider.

## Plan de livraison (D9)

1. **Phase A — copie et preuve** (aucune modification d'Adonnante hors ce spec
   :
   créer `SoftwareFactory` avec les copies migrées, CI verte, puis preuve sur
   un consommateur réel : un projet d'essai qui adopte le marketplace SF,
   session Claude Code dedans — skills `softwarefactory:*` visibles, dispatch
   routé par Jev, hooks actifs, shim opérationnel, verdicts et tâches
   journalisés. Le projet d'essai peut être un dépôt jetable ; le plan le
   crée.
2. **Phase B — bascule Adonnante** (SF prouvée seulement) : une PR remplace
   les copies : suppression des fichiers migrés (agents, skills, hooks +
   NOTICE + docs déplacés, entrées settings concernées), adoption (2 gestes
   settings + `plugins-a-jour.json`), scission des gardes (§ ci-dessous),
   retouches noyau. Les stubs remplacent les docs.
3. **Phase C — v2 noyau et suite** : sections noyau injectées par skill,
   adaptateur Hermes-Agent, scripts génériques et dashboard kanban (spéc
   séparée).

## Gardes scindées lors de la bascule

Les trois tests-gardes d'Adonnante portent sur des actifs qui bifurquent :

- `agents-skills-preload.test.mjs` vérifie que chaque `skills:` cité dans
  `.claude/agents/*.md` existe. Après bifurcation, une version SF vérifie les
  agents du plugin contre `skills/` (avec préfixe), une version Adonnante
  vérifie `dashboard-builder` contre les skills restantes.
- `rules-frontmatter.test.mjs` porte sur `.claude/rules/` + carte : reste,
  inchangé.
- `taches-natives.test.mjs` porte sur `settings.json` : reste, inchangé.

## Critères d'acceptation

- **Phase A** :
  - le dépôt `SoftwareFactory` existe, sa CI verte **sur un runner Hetzner**
    (run cité en sortie : jobs `node --test` des hooks migrés, tous passant —
    même exécuteur que le jour de la copie) ;
  - le marketplace se liste (`claude plugin marketplace add` + install en
    scope local sur le projet d'essai) sans erreur ;
  - une session Claude Code réelle dans le projet d'essai voit
    `skills_list` les 7 skills préfixées et `agents` les 6 préfixés ;
  - une tâche dispatchée via le noyau d'essai rend un rapport STAR et son
    `Agent` a été passé par `jev-cli niveau` (journal du hook cité) ;
  - le shim `.claude/hooks/jev-cli.mjs` existe dans le projet d'essai et
    répond aux mêmes commandes que l'original ;
  - `git-stash-guard` refuse un `git stash` dans le projet d'essai (test réel
    en session) ;
  - l'état des tâches natives se publie sur GitHub (hook etat-job, ADR-0191).
- **Phase B** : Adonnante fonctionne à l'identique du jour de la bascule :
  session réelle avec skills/agents/hooking d'usine, recette par zone d'écran
  inchangée (aucun code produit touché), gardes scindées vertes des deux
  côtés, stubs docs en place, et zéro hook en double (grep `hooks.json` vs
  `settings.json`).
- **Preuve générale** : chaque critère ci-dessus est cité commande + sortie.

## Hors périmètre

- Le cutover Adonnante avant la preuve (D9) — pas de suppression en Phase A.
- Le design du kanban inter-agents (D8) — spec séparée à venir.
- L'adaptateur Hermes-Agent — prévu et non chiffré (D7).
- La v2 du noyau (D4) — injection par skill, chantier séparé.
- Forker superpowers-extended-cc ou cesiumjs-skills (D6 : référencés).
- Tout code produit (`packages/`, `src-tauri/`) — l'extraction ne touche que
  l'outillage d'agents et la documentation agent.
- Scripts génériques (`git-worktree-safe`…) — notés v2 avec le noyau.

## Risques et limites connues

- **Nom de plugin long** : `softwarefactory:` rallonge les invocations
  explicites (`/softwarefactory:technical-writing`). Accepté (D5) ; les
  déclenchements par description restent normaux, sans préfixe.
- **Shim réécrit** : une édition manuelle du shim projet est écrasée chaque
  session — voulue (fichier généré) ; signalée comme telle dans son en-tête.
- **Cache plugin** : chaque version a son dossier cache ; tout outil appelable
  à la main passe forcément par le shim ou `${CLAUDE_PLUGIN_ROOT}` — jamais
  par un chemin en dur.
- **superpowers-extended-cc reste externe** : ses versions ne nous appartiennent
  pas ; tant qu'il est référencé (D6), une évolution en amont peut casser une
  attente de l'usine — à suivre lors des recettes.
- **Double plugin activé pendant la phase de copie** : interdit dans
  Adonnante jusqu'à la bascule (D9) ; le critère Phase B revient dessus par
  grep.
- **Windows** : les hooks d'événement lancés par le runtime peuvent exiger le
  wrapper `.cmd` (ce que superpowers-extended-cc fait) ; constaté à l'exécution
  en Phase A sur l'hôte Windows, pas présumé.
- **Runners partagés** : la flotte Hetzner sert aussi Adonnante ; la CI SF et
  la CI produit se disputent le même budget de machines — la nuit est
  réservée aux tests Adonnante (ADR-0193), la SF attend son créneau ; la
  répartition fine est au plan.
