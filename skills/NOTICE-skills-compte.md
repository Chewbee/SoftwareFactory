# Notice : provenance des skills tiers de l'usine

Provenance et licences des skills copiées de sources tierces, hébergées par le
plugin `softwarefactory` (dossier `skills/`). Copies initiales faites le
2026-10-11 pour le dépôt Adonnante (depuis le dossier de skills du compte
utilisateur, cibles des liens symboliques de `~/.claude/skills`), migrées dans
ce plugin le 2026-11-11, contenus inchangés. Resynchronisation amont : à la
main, en citant le nouveau commit source ici.

## technical-writing, documenting-legacy-codebases

- Source : https://github.com/riekelt/technical-writer (`plugins/technical-writer/skills/<nom>/`), d'après
  `~/.agents/.skill-lock.json` (hash de dossier `technical-writing` : `bf6d4b1b54135c052483d1d259b35b2c06154e65`).
- Licence : MIT, constatée le 2026-10-11 dans `LICENSE` du dépôt source (`gh api repos/riekelt/technical-writer/license`).
  La copie locale ne portait pas de fichier de licence ; le texte est repris ci-dessous (seuls les retours à la ligne diffèrent).
- Dossiers copiés : `technical-writing/` (avec `references/`), `documenting-legacy-codebases/`.

```text
MIT License

Copyright (c) 2026 riekelt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## task-observer

- Source : https://github.com/rebelytics/one-skill-to-rule-them-all (Eoghan Henn, rebelytics.com).
- Licence : Creative Commons Attribution 4.0 International. Texte complet dans `task-observer/LICENSE.txt`.
  Modifications : aucune du contenu. Seuls `SKILL.md`, `README.md`, `LICENSE.txt`, `references/` et `scripts/` sont
  copiés ; les images, `.github/`, `.claude-plugin/`, `.tessl-plugin/` et les guides de contribution ne le sont pas
  (le lien vers `CONTRIBUTING.md` en `task-observer/README.md` est donc sans cible ici ; texte amont conservé).

## reviewing-technical-prose, writing-design-docs, recording-decisions

- Source : https://github.com/riekelt/technical-writer (`plugins/technical-writer/skills/<nom>/SKILL.md`), commit
  `85e53729dd959a2795d593d6769068e342cf3486` (HEAD au 2026-10-11), récupérés par `gh api` (contenu brut).
- Licence : MIT, © 2026 riekelt, la même que `technical-writing` ci-dessus (`gh api repos/riekelt/technical-writer/license`
  rend `MIT` le 2026-10-11) ; le texte est donné dans la première entrée.
- Fichiers copiés, sans modification : les trois `SKILL.md`. Ces skills n'ont pas de dossier `references/` dans la source.
- Chemins cités : `references/style.md` et `references/truth.md` (dans `reviewing-technical-prose`) sont ceux de
  `technical-writing`, présents ici. `writing-runbooks`, citée par l'une des trois, n'est pas copiée (voir ci-dessous).

## Skills citées par technical-writing et non copiées

Six restent, non téléchargées : `writing-issues`, `writing-changelogs`, `writing-runbooks`, `writing-postmortems`,
`documenting-contracts`, `diagramming-processes`. Introuvables dans `~/.claude/skills/`, `~/.agents/skills/` et les plugins
du poste ; le dépôt source ci-dessus les contient (licence MIT).
