# Backlog : Linear (fonctionnalités) + GitHub (bugs)

Décision de session du 2026-11-10 : le backlog des **fonctionnalités** vit dans
Linear (workspace `chewbee`, team **SF**, issues `SF-N`) ; les **bugs** restent
des GitHub Issues du dépôt concerné. L'utilisateur décrit les fonctionnalités
dans Linear ; les agents les prennent par l'API GraphQL ou le MCP Linear.

## Hiérarchie (construite le 2026-11-11 depuis spec + plan)

| Niveau | Entité Linear | Exemple |
|---|---|---|
| **Thème** | label d'issue coloré (« Thème A — … ») ; les Initiatives natives sont payantes, le label en tient lieu | `Thème A — Fondations du plugin` |
| **EPIC** | projet Linear, nommé `EPIC XN — …` | `EPIC A1 — Squelette & marketplace` |
| **Feature** | issue `SF-N`, label du thème + EPIC rattaché | `SF-10 Manifestes plugin.json…` |

Arbre en place : Thème A (fondations, EPIC A1-A5), Thème B (preuve & bascule,
B1-B2), Thème C (multi-harnais & pilotage, C1-C3), Thème D (contenu & noyau v2,
D1-D2). Les tâches détaillées restent dans `docs/superpowers/plans/*.md` +
`.tasks.json` ; Linear porte le backlog, le plan porte l'exécution.

## Qui va où

| Nature | Où | Identifiant |
|---|---|---|
| Fonctionnalité, étude, chantier | Linear, team SF (saisie ici) | `SF-N` |
| Bug (comportement défectueux) | GitHub Issues du dépôt (saisie ici) | `#N` |
| Tâche d'un plan d'implémentation | `docs/superpowers/plans/*.md` + `.tasks.json` (natif du harnais) | tâche N |

## Traçabilité git (l'intégration GitHub de Linear)

- **Nom de branche** : l'identifiant Linear en premier — `feat/SF-5-sujet`
  (dans Linear, l'action « Copy git branch name » le fabrique).
- **Commit / PR** : mot magique + identifiant dans le message ou la description —
  `Fixes SF-5` (fermante : l'issue passe *In Progress* au push, *Done* au merge
  sur la branche par défaut) ou `Refs SF-5` (non fermante, liaison seule).
- **Bugs GitHub** : charte `redaction-pr-issues` inchangée — footer
  `Corrige #N` + `Closes #N`.
- Un commit peut porter les deux : `Fixes SF-5` pour la fonctionnalité et
  `Closes #12` pour le bug GitHub qu'elle répare.
- **Synchro bidirectionnelle GitHub Issues ACTIVE** (décision 2026-11-11,
  réglage par défaut conservé) : toute issue Linear de la team SF se reflète
  en GitHub Issue du dépôt mappé, et réciproquement. La saisie reste
  disciplinée — features dans Linear, bugs dans GitHub — le miroir suit tout
  seul et la traçabilité s'en trouve doublée.

## Accès agent

- Clé API : variable d'environnement utilisateur Windows
  `LINEAR_APP_SF_KEY` (préfixe `lin_api_`), jamais dans un dépôt.
- Point d'entrée : `https://api.linear.app/graphql` (auth : en-tête
  `Authorization: <clé>`). Le MCP Linear est disponible pour les harnais qui
  le chargent.
- Le plan gratuit tient 250 issues actives : archiver libère la place.

## Amorce du backlog (2026-11-10) et structuration (2026-11-11)

Cinq features semées le 2026-11-10 (SF-5 bascule Adonnante, SF-6 adaptateur
Hermes-Agent, SF-7 kanban inter-agents, SF-8 noyau v2, SF-9 skills
d'illustration), puis l'arbre complet thèmes/EPICs/features construit depuis
la spec et le plan le 2026-11-11 : 28 issues actives, 12 EPICs, 4 thèmes.
Les issues d'onboarding Linear (SF-1 à SF-4) sont archivées — page blanche.
