# Pilotage GitHub + Linear — composant de l'usine

Décision de session du 2026-11-11 : le setup de pilotage est un **composant de
SoftwareFactory** — opéré, documenté, reproductible pour tout projet
consommateur. Les conventions d'écriture vivent dans
[`docs/backlog-linear.md`](backlog-linear.md) ; ce document décrit le composant.

## Architecture du setup

| Brique | État |
|---|---|
| Linear workspace `chewbee`, team **SF** | opéré (plan Free : 2 équipes, 250 issues actives) |
| Hiérarchie : **Thème** = label coloré · **EPIC** = projet `EPIC XN — …` · **Feature** = issue `SF-N` | en place (4 thèmes, 13 EPICs) |
| App **Linear** installée sur le compte GitHub Chewbee, dépôts choisis | opérée (dépôt SoftwareFactory) |
| Linkage branches / PR / commits : identifiant `SF-N` dans le nom de branche ou mot magique (`Fixes SF-N`, `Refs SF-N`) | **prouvé** le 2026-11-11 |
| Synchro bidirectionnelle GitHub Issues | active — miroir automatique des deux côtés |
| Accès agent : API GraphQL, clé dans la variable d'environnement `LINEAR_APP_SF_KEY` | opéré ; MCP Linear à venir (SF-34) |

Bugs : GitHub Issues du dépôt (`#N`) ; features : Linear. La saisie reste
disciplinée, le miroir suit tout seul.

## Preuve du cycle (2026-11-11, sorties citées)

1. **Linkage** : branche `SF-9-test-liaison` + PR avec `Refs SF-9` → deux
   pièces jointes visibles sur l'issue SF-9 par l'API (`pull/1`, `pull/2`).
2. **Fermeture par merge** : commit `880e7dc` portant `Fixes SF-10` et
   `Fixes SF-11` fusionné sur `dev` (branche par défaut) → les issues suivent
   le merge ; miroirs GitHub **#3 et #4 fermés automatiquement** à la mise
   Done.
3. **Automatisation partielle constatée** : la team envoie le merge en
   *In Review* ; la transition merge → *Done* est à régler (SF-35).

## Reproduction pour un nouveau projet consommateur

1. Créer le dépôt du projet (GitHub, privé), branche par défaut `dev`.
2. Sur https://github.com/settings/installations, « Linear » → Configure →
   ajouter le dépôt aux *Only select repositories*.
3. Dans Linear : Settings → Integrations → GitHub, laisser la synchro
   bidirectionnelle par équipe↔dépôt si le miroir est voulu (le nôtre l'assume).
4. Reprendre les conventions : branches `feat/SF-N-sujet`, mots magiques en
   footer de commit/PR, `Corrige #N`/`Closes #N` pour les bugs — copier
   `docs/backlog-linear.md` et l'adapter (clé de team, dépôt).
5. Si le projet a sa propre team Linear : créer ses labels de thème et ses
   EPICs au même gabarit ; sinon réutiliser la team SF.
6. Régler la transition « merge vers la branche par défaut → Done » dans le
   workflow de la team (SF-35 — à faire aussi côté SF).

## Suivi

- SF-33 cette doc · SF-34 MCP Linear pour les agents · SF-35 transition
  merge→Done · SF-36 politique de volume (archivage, bruit du miroir).
