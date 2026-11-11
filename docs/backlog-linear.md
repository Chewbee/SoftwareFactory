# Backlog : Linear (fonctionnalités) + GitHub (bugs)

Décision de session du 2026-11-10 : le backlog des **fonctionnalités** vit dans
Linear (workspace `chewbee`, team **SF**, issues `SF-N`) ; les **bugs** restent
des GitHub Issues du dépôt concerné. L'utilisateur décrit les fonctionnalités
dans Linear ; les agents les prennent par l'API GraphQL ou le MCP Linear.

## Qui va où

| Nature | Où | Identifiant |
|---|---|---|
| Fonctionnalité, étude, chantier | Linear, team SF | `SF-N` |
| Bug (comportement défectueux) | GitHub Issues du dépôt | `#N` |
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
- **Ne jamais activer la synchro GitHub Issues** dans les réglages Linear :
  les bugs restent dans GitHub, sans doublon.

## Accès agent

- Clé API : variable d'environnement utilisateur Windows
  `LINEAR_APP_SF_KEY` (préfixe `lin_api_`), jamais dans un dépôt.
- Point d'entrée : `https://api.linear.app/graphql` (auth : en-tête
  `Authorization: <clé>`). Le MCP Linear est disponible pour les harnais qui
  le chargent.
- Le plan gratuit tient 250 issues actives : archiver libère la place.

## Amorce du backlog (2026-11-10)

SF-5 bascule Adonnante (Phase B) · SF-6 adaptateur Hermes-Agent · SF-7 kanban
inter-agents · SF-8 noyau injecté par SessionStart (v2) · SF-9 skills
d'illustration. Les issues SF-1 à SF-4 sont la checklist d'onboarding de
Linear : à fermer quand elle ne sert plus.
