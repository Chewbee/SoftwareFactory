# Issue tracker : GitHub

Les issues du dépôt courant vivent sur GitHub. Toutes les opérations
passent par la CLI `gh`, lancée depuis un clone du projet — le dépôt est
déduit de `git remote -v`.

## Conventions

- **Créer une issue** : `gh issue create --title "..." --body "..."`. Heredoc pour un corps multi-lignes.
- **Lire une issue** : `gh issue view <numéro> --comments`, filtrer les commentaires par `jq` et charger aussi les labels.
- **Lister** : `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` avec les filtres `--label` / `--state` voulus.
- **Issues sans label** : un balayage par label ne les voit pas — voir « Dépilement du backlog » dans [[triage-labels]].
- **Commenter** : `gh issue comment <numéro> --body "..."`
- **Labels** : `gh issue edit <numéro> --add-label "..."` / `--remove-label "..."`
- **Fermer** : `gh issue close <numéro> --comment "..."`

## Quand une skill dit « publie sur le tracker »

Créer une issue GitHub du dépôt courant.

## Quand une skill dit « va chercher le ticket pertinent »

Lancer `gh issue view <numéro> --comments`.

## Pilotage Linear (si le projet l'a adopté)

Les features du projet peuvent vivre dans Linear (team du projet) avec
bugs sur GitHub et synchro bidirectionnelle des issues — conventions et
recette de reproduction : `docs/pilotage-github-linear.md` de
SoftwareFactory. Traçabilité git : identifiant `<TEAM>-N` en tête de
branche, mots magiques `Fixes <TEAM>-N` (fermante) / `Refs <TEAM>-N`
(liaison).

## PRs

Les PRs externes ne sont pas traitées par le dépilement — seules les
issues le sont.
