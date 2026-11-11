# Labels de triage

Les skills parlent en cinq rôles canoniques. Ce fichier les met en
correspondance avec les libellés réels du tracker du projet consommateur —
**édite la colonne de droite** pour l'ajuster au vocabulaire du projet.

| Rôle canonique             | Libellé du tracker    | Sens                                      |
| -------------------------- | --------------------- | ----------------------------------------- |
| `needs-triage`             | `needs-triage`        | Un mainteneur doit évaluer cette issue    |
| `needs-info`               | `needs-info`          | Attente d'informations du rapporteur      |
| `ready-for-agent`          | `ready-for-agent`     | Spécifiée, prête pour un agent AFK        |
| `ready-for-human`          | `ready-for-human`     | Implémentation humaine requise           |
| `wontfix`                  | `wontfix`             | Ne sera pas traitée                       |

Quand une skill mentionne un rôle (« pose le label ready-for-agent »),
utiliser le libellé correspondant de cette table.

## Dépilement du backlog : passer aussi par les issues sans label

Une issue sans label n'apparaît dans aucun balayage par label. Tout
dépilement inclut donc un passage sur les issues nues, une par une (pas un
lot), et chacune reçoit son label de type : `bug` si elle décrit un
comportement défectueux, `enhancement` sinon. Le préfixe du titre
(`bug(...)`, `fix(...)`, `feat(...)`, `chore(...)`, `étude(...)`) n'est
qu'un indice ; une issue sans préfixe se juge sur son contenu. Le dépôt se
déduit de `git remote
get-url origin` :

```bash
REPO=$(git remote get-url origin | sed -E 's|.*github\.com[:/]||; s|\.git$||')
p=1; while :; do
  page=$(gh api "repos/$REPO/issues?state=open&per_page=100&page=$p") \
    || { echo "échec page $p" >&2; exit 1; }
  [ "$(jq length <<<"$page")" -eq 0 ] && break
  jq -r '.[] | select(.pull_request == null and (.labels | length) == 0)
    | "\(.number)\t\(.title)"' <<<"$page"
  p=$((p+1))
done
```

La commande passe par l'API REST (GraphQL peut être bloqué selon le
harnais), parcourt toutes les pages sans plafond, écarte les PR que
`/issues` renvoie aussi, et échoue bruyamment si une page échoue.

Une feature ou une étude passe ensuite par le triage de la table
ci-dessus ; un bug part en correction sans triage.

## Règle anti-rattrapage

Pas de rattrapage en masse des issues existantes, pas de label posé
automatiquement à l'ouverture : chaque label est posé pendant un
dépilement, au vu du contenu de l'issue. Un projet consommateur qui a
tranché autrement le dit dans son noyau — il prime.
