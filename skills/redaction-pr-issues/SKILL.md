---
name: redaction-pr-issues
description: Charte de rédaction pour les messages de commit, descriptions de PR et issues GitHub du dépôt courant — à charger avant d'écrire l'un de ces trois. Impose une 1re ligne factuelle à l'impératif, un corps qui prouve plutôt qu'affirme, et un footer qui ferme les issues en français sans perdre l'auto-fermeture GitHub.
---

# Rédaction PR / issues / commits — dépôt courant

Synthèse de deux standards publics (Google `eng-practices`, Conventional
Commits), adaptée à la règle du projet consommateur **« preuve avant
affirmation »** (son noyau) et à sa contrainte réelle : GitHub ne ferme une issue au merge
que sur un mot-clé **anglais** (`closes`, `fixes`, `resolves`), jamais sur
un mot-clé français. Solution : le français reste la langue de lecture,
l'anglais ne sert que de mot-clé technique invisible en footer.

## 1re ligne (commit, titre de PR, titre d'issue)

- Phrase complète, **à l'impératif**, qui dit ce qui change, pas ce qui a
  été fait ni ce qui est cassé.
  - Correct : `corrige le repli silencieux du cache vent sur grille vide`
  - Incorrect : `fix bug`, `correction du bug de vent`, `ça corrige un
    problème`, `patch`, `divers correctifs`
- Pas d'adjectif de gravité seul (`critique`, `important`, `grave`) sans
  le fait qui le justifie à côté. Le fait remplace l'adjectif :
  `le pool de connexions sature à 20` plutôt que `souci de perf`.
- Garder le préfixe Conventional Commits déjà en usage dans ce dépôt
  (`fix(scope):`, `feat(scope):`, `chore(scope):`, `docs(scope):`) — ce
  préfixe est structurel, on ne le traduit pas. Le texte qui suit est en
  français.

## Corps (commit et PR — une idée par paragraphe, 4 lignes max chacun)

Dans cet ordre, sans en sauter un sans le justifier :

1. **Le problème constaté**, avec le fait concret (message d'erreur, test
   qui échoue, comportement observé) — pas une catégorie
   (« souci de perf » → « le pool de connexions sature à 20 »).
2. **La preuve que ça casse sans le correctif** : commande + sortie rouge
   citée, ou lien vers le run CI qui l'a montré. Jamais d'auto-rapport cru
   sur parole — la preuve est citée, pas résumée.
3. **L'approche choisie et pourquoi** (pas juste le quoi — le code déjà
   lisible dit le quoi). Si une autre approche a été écartée, dire
   pourquoi en une phrase.
4. **Les limites assumées** : ce que le correctif ne couvre pas, une dette
   sciemment laissée, un cas non testé. Dire explicitement ce qui est su
   vs déduit.
5. **La preuve que ça marche avec le correctif** : commande + sortie verte
   citée (nombre de tests, pas juste « les tests passent »).

Pas de paragraphe de synthèse à la fin qui répète ce qui précède.

## Issues de bug

- Titre : le symptôme observable, pas le mécanisme supposé
  (`le menu Select ne s'ouvre plus après un clic` plutôt que
  `régression jsdom`) — le mécanisme va dans le corps, une fois vérifié.
- Corps : les termes de recherche utilisés pour vérifier l'absence de
  doublon (exigé par `CLAUDE.md`), puis preuve (log, capture, commande).
- Distinguer explicitement une régression confirmée d'une hypothèse : si
  la cause profonde n'est pas certaine, le dire (« cause exacte non
  confirmée entre X et Y ») plutôt que présenter une piste comme acquise.

## Footer — fermeture d'issue

Ne s'applique que si le commit/PR se rattache à une issue GitHub
existante. N'ajouter `Closes #NNN` que si le correctif de CETTE PR clôt
vraiment l'issue — si le correctif est partiel, garder seulement
`Corrige #NNN` sans `Closes`, et laisser la fermeture à un choix humain
après recette.

Quand le correctif clôt vraiment l'issue, deux lignes, pas une seule :

```
Corrige #NNN
Closes #NNN
```

- `Corrige #NNN` : la ligne que lit un humain, en français, cohérente
  avec le reste du dépôt.
- `Closes #NNN` : la ligne que lit GitHub, invisible en pratique (même
  numéro, mot-clé anglais), qui déclenche la fermeture automatique
  une fois que le commit/PR atteint la **branche par défaut** du dépôt
  (souvent `dev` — cf. le noyau du projet) — un merge vers une autre branche
  ne ferme rien. Sans elle, l'issue reste ouverte indéfiniment après un
  merge silencieux — un défaut déjà payé une fois : sept issues rouvertes à
  la main faute de cette ligne.

## Ce qui n'est jamais acceptable

- Un titre qui ne dit rien : `fix`, `update`, `wip`, `divers`, `misc`.
- Une affirmation de résultat sans la commande qui la prouve.
- Un adjectif de sévérité sans le fait qui le justifie à côté.
- Un mécanisme causal présenté comme certain quand il ne l'est que
  probablement (dire « probablement » ou « non confirmé »).
