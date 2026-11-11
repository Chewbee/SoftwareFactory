---
name: routine-feature
description: Use to work the feature backlog in a loop - picks open issues labeled enhancement or feature in the consuming repo, one at a time, and takes each through brainstorming, spec, plan, execution, review and the pull request, then moves to the next
---

# Routine feature

Lire le `CLAUDE.md` (noyau) du dépôt consommateur avant d'agir (les deux
chaînes, Preuve, Rendu, Branches, Conventions, Toujours, Jamais). Il l'emporte
sur cette skill.

## Liaisons du projet consommateur

Cette skill est harnais-neutre et projet-neutre ; le noyau du projet consommateur tranche ses liaisons :

| Liaison | Défaut | Où la trancher |
|---|---|---|
| Dépôt GitHub | `origin` du checkout courant (`git remote get-url origin`) | — |
| Branche d'intégration | `dev` | noyau du projet |
| Suite de contrôles | celle du projet (ex. Adonnante : `pnpm test`, `pnpm type-check`, `pnpm lint`, `cargo test --workspace`) | noyau, section Commandes |
| UAT visuelle | recette du projet (ex. Adonnante : `pnpm recette`, ou recette navigateur sans desktop) | noyau, section Rendu |
| Backlog miroir | features Linear si le projet adopte le pilotage Linear (`docs/pilotage-github-linear.md` de SoftwareFactory) ; sinon GitHub Issues | noyau du projet |
| Journal | ex. Adonnante : `docs/06-agents/journal/AAAA-MM-JJ/<branche>.md` | convention du projet |

> **Routine interactive.** Le cadrage pose des questions : l'utilisateur est
> présent. Les skills de processus citées viennent des plugins et s'appellent
> sous leur nom préfixé (`superpowers-extended-cc:…`, `softwarefactory:…`).
> Si un outil manque (Skill, sous-agents, tâches natives, `gh`), appliquer la
> discipline à la main. Si un plugin ne se charge pas (`Unknown skill`),
> lire la `SKILL.md` du cache du plugin avec Read. Dans les deux cas, dire ce
> qui manque. Ne pas s'arrêter en silence.

## 0. Choisir l'issue

Fonction de balayage, REST paginé (GraphQL peut être bloqué en session
cloud), échec bruyant : toute page en erreur arrête la routine, jamais une
liste vide ou tronquée.

```bash
REPO=$(git remote get-url origin | sed -E 's|.*github\.com[:/]||; s|\.git$||')
scan() {  # $1 = filtre de requête (ex. "labels=bug"), $2 = filtre jq
  local p=1 page
  while :; do
    page=$(gh api "repos/$REPO/issues?state=open&$1&sort=created&direction=asc&per_page=100&page=$p") \
      || { echo "échec $1 page $p" >&2; return 1; }
    [ "$(jq length <<<"$page")" -eq 0 ] && return 0
    jq -r ".[] | select(.pull_request == null) | $2 | \"\\(.number)\t\\(.created_at)\t\\([.labels[].name] | join(\",\"))\t\\(.title)\"" <<<"$page" \
      || return 1
    p=$((p+1))
  done
}
```

1. **Issues nues** (triage du projet) : `scan "" 'select((.labels | length) == 0)' || exit 1`.
   Chacune reçoit son label de type, `bug` ou `enhancement`, selon son contenu.
2. **Bugs d'abord** : `bugs=$(scan "labels=bug" '.') || exit 1`. S'il en
   existe, le dire et demander : passer à `softwarefactory:routine-bug-fix`,
   ou continuer les features.
3. **Candidates** : les labels de feature du projet (Adonnante :
   `enhancement` ou `feature`). Un appel par label, car `labels=a,b` vaut ET.
   Stocker avant de trier, pour garder le code d'échec :

   ```bash
   a=$(scan "labels=enhancement" '.') || exit 1
   b=$(scan "labels=feature" '.') || exit 1
   printf '%s\n%s\n' "$a" "$b" | sed '/^$/d' | sort -u -k1,1n | sort -t$'\t' -k2,2
   ```

   Sans `gh` : outils MCP GitHub (`list_issues`, `state: OPEN`), un appel par
   label, toutes les pages, même filtre. Avec le pilotage Linear : lire les
   features ouvertes de la team du projet par l'API/MCP Linear, même tri.
4. **Écarter** : `needs-info`, `wontfix`, `ready-for-human` ; epic (une epic
   se traite par ses sous-issues) ; issue déjà couverte par une PR ouverte ou
   une branche `feat/*` vivante (chercher son numéro dans les PR ouvertes) ;
   issue déjà livrée dans la branche d'intégration distante (la commenter,
   ne pas coder).
5. **Annoncer** l'issue retenue (numéro, titre, labels) et la liste restante.
   Plus aucune candidate : le dire, fin de la boucle.

## 1. La chaîne, pour une issue

1. **Isoler d'abord.** Skill `superpowers-extended-cc:using-git-worktrees` :
   worktree selon la convention du projet, branche `feat/*` depuis la
   branche d'intégration. Annoncer le commit de départ. Spec, plan et code
   sont commités sur cette branche ; le checkout principal reste propre.
2. **Lire avant d'analyser.** `docs/` du projet (index, ADR liés,
   `CONTEXT.md`), puis ses sources primaires. L'agent
   `softwarefactory:analyste` (lecture seule) peut faire cette analyse et
   rendre un rapport.
3. **Cadrer.** Skill `superpowers-extended-cc:brainstorming`, menée par
   **l'agent principal** : seul lui peut poser les questions à l'utilisateur
   et écrire des fichiers. Questions **une par une**, approches comparées,
   design validé par l'utilisateur. La spec contient une section « Hors
   périmètre » et une section « Critères d'acceptation » (chaque critère
   vérifiable : test, sortie ou capture) ; le `softwarefactory:relecteur`
   les contrôle un par un. Sortie, dans le worktree :
   `docs/superpowers/specs/AAAA-MM-JJ-<sujet>-design.md`. Pas de code avant
   ce feu vert. Si le cadrage conclut « ne pas faire » ou « attendre une
   info » : commenter, fermer le worktree sans `--force`, passer à la
   suivante.
4. **Décision structurante ?** ADR (skill
   `softwarefactory:recording-decisions`), relue par un autre agent, selon la
   convention du projet.
5. **Planifier.** Skill `superpowers-extended-cc:writing-plans`, écrite par
   l'agent principal : `docs/superpowers/plans/AAAA-MM-JJ-<sujet>.md` +
   tâches natives. Code applicatif touché : la recette utilisateur y figure
   comme tâche `user-gate`. Niveau et modèle de chaque tâche : `jev-cli
   niveau` si le projet l'exige (liaison noyau).
6. **Exécuter.** Skill `superpowers-extended-cc:subagent-driven-development`
   (agent `softwarefactory:implementeur`), chaque tâche en
   `superpowers-extended-cc:test-driven-development` : rouge cité, puis
   vert. Domaine technique du projet : skills de domaine **et** doc
   officielle en ligne, source citée, avant de coder. Puis la suite de
   contrôles du projet au premier plan.
7. **Relire.** Skill `superpowers-extended-cc:requesting-code-review` : agent
   `softwarefactory:relecteur`, distinct de l'auteur, mandat adversarial.
   Sans agent distinct possible : pas de PR, signaler « relecture
   indépendante manquante ». Findings : skill
   `superpowers-extended-cc:receiving-code-review`. Attendre
   `VERDICT : PRÊT`. Tout code modifié ensuite exige un nouveau verdict.
   Deux `PAS PRÊT` de suite sur la même zone : simplifier avant de corriger
   encore.
8. **Prouver.** Skill `superpowers-extended-cc:verification-before-completion` :
   commande et sortie verte citées.
9. **UAT visuelle** si l'affichage est touché : captures de la vraie app (la
   recette du projet, à annoncer), postées dans la conversation et la PR.
   Recette `user-gate` : fermée par l'utilisateur seulement. Sans desktop ni
   navigateur : pousser, rendre le texte de PR, signaler « UAT visuelle
   manquante », ne PAS ouvrir la PR.
10. **Livrer.** Skill `superpowers-extended-cc:finishing-a-development-branch` :
    pousser, PR vers la branche d'intégration ouverte par l'agent principal
    après `VERDICT : PRÊT`, corps selon `softwarefactory:redaction-pr-issues`
    (`Closes #NNN` si la PR clôt l'issue). Armer l'auto-merge selon la règle
    du noyau du projet. Sans relecture indépendante : pas de PR, signaler
    « relecture indépendante manquante ».
11. **Journal.** Une ligne horodatée dans le journal du projet (liaison
    ci-dessus, `/` de la branche remplacé par `-`).

## 2. Boucler

Revenir au §0 : rescanner les issues (la liste a pu changer), retenir la
suivante. Chaque issue repart de la branche d'intégration à jour, dans son
propre worktree, sans attendre la fusion de la précédente. Arrêt : plus de
candidate, ou l'utilisateur le demande.

## Rappels

- Une issue, une branche, une PR : jamais deux features dans le même diff.
- Commits : charte `softwarefactory:redaction-pr-issues`, aucune ligne
  `Co-Authored-By`, jamais `--no-verify`.
- Jamais de merge local non prévu, jamais `--force`.
- `checkout --`, `restore`, `reset`, `clean` : passer par le wrapper de
  sécurité du projet s'il existe (liaison ci-dessus).
- Ne jamais lire `.cache/`, `node_modules/`, `dist/`, `.turbo/` ou leurs
  équivalents.
