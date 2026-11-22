---
name: routine-bug-fix
description: Use for any task that fixes a bug, regression, failing test or unexpected behavior in the consuming project, including cloud routines - gives the project's bug chain from "is it still alive" to the pull request to the integration branch
---

# Routine bug fix

Lire le `CLAUDE.md` (noyau) du dépôt consommateur avant d'agir (les deux
chaînes, Preuve, Conventions, Toujours, Jamais). Il l'emporte sur cette skill.

## Liaisons du projet consommateur

Cette skill est harnais-neutre et projet-neutre ; le noyau du projet consommateur tranche ses liaisons :

| Liaison | Défaut | Où la trancher |
|---|---|---|
| Branche d'intégration | `dev` | noyau du projet (section Branches) |
| Suite de contrôles | celle du projet (ex. Adonnante : `pnpm test`, `pnpm type-check`, `pnpm lint`, `cargo test --workspace`) | noyau, section Commandes |
| UAT visuelle | recette du projet (ex. Adonnante : `pnpm recette`, ou recette navigateur sans desktop) | noyau, section Rendu |
| Journal | ex. Adonnante : `docs/06-agents/journal/AAAA-MM-JJ/<branche>.md` | convention du projet |
| Wrapper git de sécurité | ex. Adonnante : `scripts/git-worktree-safe.mjs` | ex. s'il existe |

> **Routine cloud.** Les skills de processus citées viennent des plugins et
> s'appellent sous leur nom préfixé (`superpowers-extended-cc:…`,
> `softwarefactory:…`). Si un outil manque (Skill, sous-agents, tâches
> natives, `gh`), appliquer la discipline à la main. Si un plugin ne se
> charge pas (`Unknown skill`), lire la `SKILL.md` du cache du plugin avec
> Read (`$HOME/.claude/plugins/cache/<marketplace>/<plugin>/<version la plus
> récente>/skills/<nom>/SKILL.md`). Dans les deux cas, dire ce qui manque.
> Ne pas s'arrêter en silence.

## La chaîne

1. **Vivant ?** Vérifier que le bug existe encore sur la branche d'intégration
   distante : commit ancêtre du correctif, issue déjà fermée, doublon. Déjà
   corrigé : commenter, ne pas coder.
2. **Isoler.** Skill `superpowers-extended-cc:using-git-worktrees` : worktree
   selon la convention du projet (ex. `.claude/worktrees/`), branche `fix/*`
   depuis la branche d'intégration. Annoncer le commit de départ.
3. **Reproduire.** Agent `softwarefactory:analyste` (lecture seule ; modèle :
   le noyau du projet le fixe) : il reproduit le bug par une commande et
   **cite sa sortie** textuellement, sans modifier aucun fichier.
4. **Analyser.** Le même `softwarefactory:analyste`, skill
   `superpowers-extended-cc:systematic-debugging` : cause racine prouvée
   avant tout correctif. Son rapport donne le diagnostic et le **code du test
   rouge**.
5. **Corriger.** Agent `softwarefactory:implementeur` : il écrit ce test et
   **cite sa sortie rouge** (test vert d'emblée : retour à l'analyste), puis
   corrige. Si le bug touche un domaine technique du projet, charger les
   skills de domaine du projet et la doc officielle en ligne, citer la
   source, avant de coder.
   Skill `superpowers-extended-cc:test-driven-development` : le minimum de
   code qui fait passer le test, chirurgical (aucune amélioration du code
   voisin), puis la suite de contrôles complète du projet au premier plan.
6. **Relire.** Skill `superpowers-extended-cc:requesting-code-review` : un
   agent distinct de l'auteur (`softwarefactory:relecteur`, modèle fixé par le
   noyau du projet, jamais `general-purpose`), mandat adversarial. Sans agent
   distinct possible : pas de PR, signaler « relecture indépendante manquante ».
   Findings : skill `superpowers-extended-cc:receiving-code-review`.
   Attendre `VERDICT : PRÊT`. Tout code modifié ensuite exige un nouveau
   verdict. Un `PAS PRÊT` dont le seul motif
   est « Relecture incomplète » ne part pas à l'implémenteur et ne compte pas
   comme refus : relance la relecture avec plus de temps.
7. **Prouver.** Skill `superpowers-extended-cc:verification-before-completion` :
   commande et sortie verte citées.
8. **UAT visuelle** si le bug touche l'affichage : un test mocké ne prouve
   JAMAIS le rendu. Captures de la vraie app (la recette du projet, à
   annoncer), postées dans la PR. Sans desktop ni navigateur, la routine ne
   peut pas conclure : pousser la branche, rendre le texte de PR, signaler
   « UAT visuelle manquante », ne PAS ouvrir la PR.
9. **Livrer.** Skill `superpowers-extended-cc:finishing-a-development-branch` :
   pousser, relecture, `VERDICT : PRÊT`, puis l'agent principal (la routine
   elle-même) ouvre la PR vers la branche d'intégration, corps selon
   `softwarefactory:redaction-pr-issues`. L'`softwarefactory:implementeur` ne
   l'ouvre jamais. Sans relecture indépendante : pas de PR, signaler
   « relecture indépendante manquante ».
10. **Journal.** Une ligne horodatée dans le journal du projet (liaison
    ci-dessus, `/` de la branche remplacé par `-`).

## Rappels

- Commit `fix` : référence l'issue du bug, un seul sujet, aucune ligne
  `Co-Authored-By`, jamais `--no-verify`.
- Sans humain : un point qui demande de « demander », de s'arrêter ou de
  consulter l'utilisateur est **bloquant** : `VERDICT : PAS PRÊT` consigné
  dans le texte de PR ou le journal, puis arrêt. Les arbitrages techniques
  restent permis tant que le diagnostic de l'analyste et le noyau du projet
  les tranchent ; le rapport final les reprend sous « Rulings I made ».
- Pas de repli silencieux ; message affiché = message journalisé.
- Jamais la branche protégée par fusion directe sans PR, jamais de merge
  local non prévu, jamais `--force`.
- `checkout --`, `restore`, `reset`, `clean` : passer par le wrapper de
  sécurité du projet s'il existe (liaison ci-dessus).
- Ne jamais lire `.cache/`, `node_modules/`, `dist/`, `.turbo/` ou leurs
  équivalents.
