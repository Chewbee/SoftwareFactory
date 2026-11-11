# SoftwareFactory — extraction Phase A, plan d'implémentation (#2601)

> **Pour les agents d'exécution :** sous-skill requise : `superpowers-extended-cc:subagent-driven-development` (recommandée) ou `superpowers-extended-cc:executing-plans`, tâche par tâche. Les étapes se cochent (`- [ ]`).

**Goal :** créer le dépôt `Chewbee/SoftwareFactory`, plugin + marketplace Claude Code d'une seule racine, avec les copies migrées (9 skills, 6 agents, 10 hooks + cores + tests, 2 conventions docs), sa CI verte sur runners Hetzner, et la preuve sur un consommateur réel (projet d'essai + session). Zéro suppression dans Adonnante (D9).

**Architecture :** patron `superpowers-extended-cc` vérifié sur disque : `.claude-plugin/marketplace.json` + `plugin.json` sur la même racine, composants auto-découverts (`agents/`, `skills/`, `hooks/hooks.json`). Le câblage des hooks migrés cite `${CLAUDE_PLUGIN_ROOT}` ; les noms d'agents deviennent `softwarefactory:<nom>`. `plugin-a-jour` lit son liste de plugins depuis le projet (`plugins-a-jour.json`) ; un hook SessionStart écrit le shim `jev-cli` à chemin stable.

**Tech Stack :** Node 22, ESM, `node:test` ; plugin/marketplace Claude Code ; GitHub Actions sur runners self-hosted Hetzner (`hote-*`) ; `gh` CLI.

**Spec (fait foi, à lire avant la tâche 1) :** `docs/superpowers/specs/2026-11-10-softwarefactory-extraction-design.md`. ADR : [ADR-0195](docs/03-adr/0195-extraction-de-l-usine-claude-code-dans-le-depot-softwarefactory.md).

Base d'analyse : `origin/dev` 3d1812c3. Échantillons de formats recopiés : `~/.claude/plugins/marketplaces/superpowers-extended-cc-marketplace/` (marketplace.json, plugin.json, hooks.json) et `.claude/settings.json` du dépôt.

## Critère de vérification (Phase A complète)

- `gh repo view Chewbee/SoftwareFactory --json visibility` → `PRIVATE`.
- `node --test tests/*.test.mjs` dans le clone SF → `# fail 0` (tous les tests migrés + nouveaux).
- `claude plugin validate` sur la racine SF → code 0. `claude plugin marketplace add Chewbee/SoftwareFactory` puis `claude plugin install softwarefactory@softwarefactory-marketplace --scope local` dans le projet d'essai → code 0.
- Une session réelle dans `Chewbee/sf-recette` : `skills_list` voit les 9 skills `softwarefactory:*` ; un dispatch `Agent` passe par `jev-cli niveau` (journal cité) ; le shim `.claude/hooks/jev-cli.mjs` existe et répond à `niveau --help` ; `git stash` est refusé par le hook.
- La CI SF est verte sur un runner Hetzner (run cité en sortie, jobs `node --test` + `claude plugin validate`).
- `git -C C:/Users/gh/dev/Adonnante status --porcelain` ne montre AUCUNE suppression de fichier (critère D9).
- #2601 porte les preuves (commentaires par tâche, ADR-0135 pour la relecture finale).

## Global Constraints

- **Issue.** Toute tâche référence #2601. `branche` ci-dessous par tâche.
- **Adonnante intouché côté code (D9), et `docs/backlog.md` JAMAIS touché (décision 2026-11-10 : SoftwareFactory est un nouveau projet ; la traçabilité vit sur l'issue `Chewbee/Adonnante#2601` et dans ce dépôt).** Cette Phase A ne modifie Adonnante QUE par `docs/03-adr/0195-*` et `docs/_index.md` (tâche 10). Préuve : à la fin, `git -C Adonnante diff --stat origin/dev` ne liste que ces deux fichiers.
- **Git.** `git stash` interdit partout (ADR-0140). Dans Adonnante, `reset/restore/clean/checkout --` passent par `node scripts/git-worktree-safe.mjs <worktree-absolu> …` (ADR-0066) ; `git worktree list` avant toute édition. Dans le nouveau dépôt SF (clone neuf `C:/Users/gh/dev/SoftwareFactory`) les règles git Adonnante ne s'appliquent pas à son arbre, la ban stash si.
- **Branches.** SF : PR vers sa branche par défaut `dev` (dépôt neuf : initialisée sur `dev`). Projet d'essai : dépôt privé neuf `Chewbee/sf-recette`, branch `dev`. Adonnante : `docs/2601-usine-softwarefactory` depuis `origin/dev`.
- **TDD.** Toute logique nouvelle : test rouge cité, puis vert. Tests et builds au premier plan, délai 600 000 ms, sur un `CARGO_TARGET_DIR` déjà chaud (sans objet ici : zéro Rust).
- **Code (`.claude/rules/js-ts.md`).** ESM, aucun `default export`, aucun `as`, aucun `eslint-disable` ; `String(n)` en gabarit pour un nombre/booléen ; zéro avertissement eslint nouveau.
- **Repli.** Jamais de repli silencieux : tout échec d'usine (plugin introuvable, clé absente) est journalisé et signalé.
- **Commits.** Charte `redaction-pr-issues` : titre à l'impératif avec préfixe Conventional Commits, corps qui prouve, référence #2601, aucune ligne `Co-Authored-By`, jamais `--no-verify`.
- **Relecture.** Chaque PR SF est relue par `softwarefactory:relecteur` (model `opus`) distinct de l'implémenteur, diff depuis la merge-base. `VERDICT : PRÊT` avant ouverture (règle d'ouverture ; auto-merge Adonnante seulement après UAT).
- **Windows.** Les hooks d'événement sont vérifiés à l'exécution réelle (wrapper `.cmd` du patron superpowers-extended-cc si nécessaire, constaté en tâche 3, pas présumé).
- **Manifestes.** Avant tout commit de manifeste, vérifier la forme des sources externes sur la doc marketplace (`code.claude.com/docs/en/plugins/marketplace-reference`) et passer `claude plugin validate` (échantillon réel : `~/.claude/plugins/marketplaces/superpowers-extended-cc-marketplace/.claude-plugin/marketplace.json`). Si l'absorption d'un plugin externe dans `marketplace.json` n'est pas supportée, repli assumé : adoption à 3 entrées `extraKnownMarketplaces` (retour tranché sur recette, signalé sur #2601).

| Tâche | Rôle | Niveau | Modèle | Confiance |
|---|---|---|---|---|
| T1 dépôt SF + squelette | `executant-basic` | mechanical | haiku | 0,84 |
| T2 agents + skills + NOTICE | `executant-basic` | mechanical | haiku | 0,62 |
| T3 hooks + câblage `softwarefactory:*` | `implementeur` | standard | sonnet | 0,60 |
| T4 `plugin-a-jour` paramétrable | `implementeur` | standard | sonnet | 0,82 |
| T5 shim `jev-cli` auto-généré | `implementeur` | standard | sonnet | 0,74 |
| T6 pré-test packaging réel | `executant-basic` | mechanical | haiku | 0,62 |
| T7 docs SF | `executant-basic` | mechanical | haiku | 0,92 |
| T8 CI + runners Hetzner | `implementeur` | standard | sonnet | 0,26 **à trancher** |
| T9 projet d'essai + preuve (`user-gate`) | `implementeur` + utilisateur | frontier | opus | 0,67 |
| T10 relecture + ADR-0195 + PR docs | `relecteur` + agent principal | review | opus (rôle, jamais routé) | hors table Jev |

---

### Task 1 : Dépôt SoftwareFactory et squelette

**Exécutant :** `executant-basic` (haiku). **Branche :** `dev` SF (initiale). **Dépend de :** aucune.

**Files:** Create (dans le clone SF) : `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `package.json`, `LICENSE`, `.gitignore`.

- [ ] **Step 1 : créer le dépôt.**

```bash
gh repo create Chewbee/SoftwareFactory --private --confirm --description "Usine d'agents Claude Code de Chewbee : skills, agents, hooks, conventions (#2601)"
git clone https://github.com/Chewbee/SoftwareFactory.git C:/Users/gh/dev/SoftwareFactory
cd C:/Users/gh/dev/SoftwareFactory
git checkout -b dev && git push -u origin dev
gh repo edit Chewbee/SoftwareFactory --default-branch dev
```

- [ ] **Step 2 : manifestes.** `.claude-plugin/plugin.json` :

```json
{
  "name": "softwarefactory",
  "description": "Usine d'agents (skills, agents, hooks, conventions) de Chewbee, consommée par ses projets",
  "version": "0.1.0",
  "author": { "name": "Chewbee" }
}
```

`.claude-plugin/marketplace.json` (forme des sources externes vérifiée contre la doc marketplace du jour, `claude plugin validate` en gate ; repli documenté dans les Global Constraints) :

```json
{
  "name": "softwarefactory-marketplace",
  "owner": { "name": "Chewbee" },
  "plugins": [
    { "name": "softwarefactory", "description": "Usine d'agents Chewbee", "version": "0.1.0", "source": "./", "author": { "name": "Chewbee" } },
    { "name": "superpowers-extended-cc", "description": "Skills d'étape (upstream pcvelz)", "source": { "source": "github", "repo": "pcvelz/superpowers" } },
    { "name": "cesiumjs-skills", "description": "Skills CesiumJS (upstream CesiumGS)", "source": { "source": "github", "repo": "CesiumGS/cesiumjs-skills" } }
  ]
}
```

- [ ] **Step 3 : racine.** `package.json` :

```json
{
  "name": "softwarefactory",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test tests/*.test.mjs hooks/*.test.mjs" }
}
```

`README.md` : 10 lignes (quoi, adoption, pointeur vers `docs/adoption.md` à venir). `CLAUDE.md` : développement de l'usine SEULEMENT (charte `redaction-pr-issues` reprise, TDD, jamais de code produit). `AGENTS.md` : un pointer vers `CLAUDE.md`. `LICENSE` : MIT. `.gitignore` : `node_modules/`.

- [ ] **Step 4 : commit.** `git add -A && git commit -m "feat(infra): cree le squelette plugin+marketplace de SoftwareFactory (#2601)" && git push`.

---

### Task 2 : Agents, skills, NOTICE migrés

**Exécutant :** `executant-basic` (haiku). **Branche :** `feat/2601-contenus` (SF) → PR `dev`. **Dépend de :** T1.

**Files:** Create (SF) : `agents/analyste.md`, `agents/implementeur.md`, `agents/relecteur.md`, `agents/relecteur-basic.md`, `agents/executant-basic.md`, `agents/typesafe-explorateur.md`, `skills/<9>` + `skills/NOTICE-skills-compte.md` (adaptée), `skills/redaction-pr-issues/SKILL.md` (rewritée).

- [ ] **Step 1 : copier.**

```bash
cd C:/Users/gh/dev/SoftwareFactory
AD=C:/Users/gh/dev/Adonnante/.claude
mkdir -p agents skills tests
for a in analyste implementeur relecteur relecteur-basic executant-basic typesafe-explorateur; do cp "$AD/agents/$a.md" agents/; done
for s in technical-writing writing-design-docs reviewing-technical-prose recording-decisions documenting-legacy-codebases task-observer redaction-pr-issues routine-bug-fix routine-feature; do cp -r "$AD/skills/$s" skills/; done
```

- [ ] **Step 2 : adapter les frontmatter des agents.** Le champ `skills:` de chaque `agents/*.md` cite ses skills : préfixer chaque référence au plugin par `softwarefactory:` (ex. `technical-writing` → `softwarefactory:technical-writing`) et laisser les skills du plugin officiel `typesafe:typesafe-ai` tels quels. `model` conservé (analyste/relecteur `opus`, etc.).
- [ ] **Step 3 : réécrire `redaction-pr-issues`.** Remplacer « de ce dépôt » par « du dépôt courant » (titre et description) ; le reste inchangé.
- [ ] **Step 4 : réécrire `routine-bug-fix` et `routine-feature` (liaisons projet).** Zéro mention d'Adonnante / `dev` / labels en dur : les chaînes citent « le projet consommateur » et renvoient au noyau du projet pour les liaisons (label de tri, branche d'intégration, recette), avec une table `Liaison | Défaut | Où la trancher` en tête de chaque SKILL.md.
- [ ] **Step 5 : NOTICE.** `cp "$AD/skills/NOTICE-skills-compte.md" skills/` puis mettre à jour : les chemins sources restent, les mentions « sessions cloud ne chargent que .claude/skills/ » sont réécrites pour le plugin.
- [ ] **Step 6 : test-garde SF.** Adapter `agents-skills-preload.test.mjs` au layout plugin : tests qui parcourent `agents/*.md`, extraient `skills:`, exigent chaque préfixe `softwarefactory:` résolu dans `skills/` (sauf préfixes tiers déclarés `plugin:`). Test : `tests/agents-skills-preload.test.mjs`. Rouge d'abord : lancer et constater l'échec sur les références non préfixées, le citer. Puis corriger les frontmatter jusqu'au vert.
- [ ] **Step 7 : commit + push.** `git commit -m "feat(contenus): migre les agents et skills de processus de l'usine (#2601)"`.

---

### Task 3 : Hooks, câblage, gardes

**Exécutant :** `implementeur` (sonnet). **Branche :** même PR que T2 ou `feat/2601-hooks` (SF) → PR `dev`. **Dépend de :** T2.

**Files:** Create (SF) : `hooks/*.mjs` (hooks + cores + tests migrés), `hooks/hooks.json`, `hooks/run-hook.cmd` (si constaté nécessaire). Modify : `.claude-plugin/plugin.json` (rien, composants auto-découverts), `package.json` (script `test` déjà bon).

- [ ] **Step 1 : copier les hooks.**

```bash
cd C:/Users/gh/dev/SoftwareFactory && AD=C:/Users/gh/dev/Adonnante/.claude/hooks
for f in plugin-a-jour checkout-a-jour git-stash-guard jev-cli jev-model jev-verdict etat-job etat-job-publier; do cp "$AD/$f.mjs" hooks/ 2>/dev/null; cp "$AD/$f-core.mjs" hooks/ 2>/dev/null; done
cp "$AD/jev-cli.mjs" hooks/
for t in $(ls "$AD" | grep -E 'test\.mjs$'); do cp "$AD/$t" hooks/; done
# retirer les gardes qui restent projet : rules-frontmatter, taches-natives, agents-skills-preload (reposé en T2), ts-verifie, lint-format
rm -f hooks/rules-frontmatter.test.mjs hooks/taches-natives.test.mjs hooks/ts-verifie.mjs hooks/ts-verifie.test.mjs hooks/lint-format.mjs hooks/lint-format.test.mjs
```

- [ ] **Step 2 : `hooks/hooks.json`.** Événements copiés de `.claude/settings.json` d'Adonnante, commandes réécrites `node "${CLAUDE_PLUGIN_ROOT}/hooks/<f>.mjs"` (et le wrapper `.cmd` si Windows l'exige au premier test réel — constater en tâche 6, adapter ici si oui) : SessionStart `startup|resume` → `plugin-a-jour` (timeout 600) et `checkout-a-jour` (timeout 120) ; PreToolUse `Agent` et `mcp__claude-code-remote__create_session` → `jev-model` (timeout 10) ; PreToolUse `Bash|PowerShell` → `git-stash-guard` (timeout 10) ; PostToolUse `TaskCreate|TaskUpdate` → `etat-job` (timeout 10) ; PostToolUse `SubagentHandback` → `jev-verdict` (timeout 10) ; SubagentStop matcher **`softwarefactory:relecteur|softwarefactory:relecteur-basic`** → `jev-verdict` : le hook de shim (T5) s'ajoute lors de sa tâche. Les hooks projet (`lint-format`, `ts-verifie`) NE vont PAS ici : ils restent dans les settings d'Adonnante.
- [ ] **Step 3 : préfixer les tables internes.** Dans `jev-model-core.mjs` (BANDES) et `jev-verdict-core.mjs` (détection rôles) : clés `analyste` → `softwarefactory:analyste`, etc. ; `relecteur-basic` et `session-cloud` suivent. Les tests existants sont mis à jour avec les noms préfixés (rouge d'abord, cité).
- [ ] **Step 4 : vert local.** `node --test hooks/*.test.mjs` → `# fail 0`, sorties citées. Tout hook référençant un chemin Adonnante en dur est corrigé en résolution par `${CLAUDE_PROJECT_DIR}` (variable reçue par les hooks) ou `import.meta.url`.
- [ ] **Step 5 : commit.** `git commit -m "feat(hooks): migre les hooks generiques et leur cablage sous \${CLAUDE_PLUGIN_ROOT} (#2601)"`.

**Interfaces:** Produces : `hooks/hooks.json` (les tâches 5 et 6 l'étendent), `jev-model-core.mjs` BANDES préfixées (T4/T9 s'appuient dessus).

---

### Task 4 : `plugin-a-jour` paramétrable

**Exécutant :** `implementeur` (sonnet). **Branche :** `feat/2601-plugins-a-jour` (SF) → PR `dev`. **Dépend de :** T3.

**Files:** Modify : `hooks/plugin-a-jour-core.mjs` (lecture projet), `hooks/plugin-a-jour.test.mjs` (+ 3 tests). Test : `hooks/plugin-a-jour.test.mjs`.

- [ ] **Step 1 : test rouge.** Trois cases : (a) fichier `.claude/plugins-a-jour.json` présent dans `CLAUDE_PROJECT_DIR` → la liste du projet fait foi, dans l'ordre du fichier ; (b) fichier absent → défaut courant (les deux entrées superpowers + cesiumjs, constantes actuelles) ; (c) fichier présent mais JSON invalide → échec franc nommé (`message` mentionne le fichier, code de sortie inchangé, jamais de repli silencieux). Fixture : tempdir avec un faux `CLAUDE_PROJECT_DIR` (les tests existants en ont le patron).
- [ ] **Step 2 : vérifier le rouge.** `node --test hooks/plugin-a-jour.test.mjs` → `# fail` sur les 3, sortie citée.
- [ ] **Step 3 : implémenter.** Dans `mettreAJour({ executer, binaire, env })` : lire `path.join(env.CLAUDE_PROJECT_DIR ?? process.cwd(), ".claude", "plugins-a-jour.json")` ; si présent et JSON valide : `PLUGINS = JSON.parse(...)` avec validation par entrée (`nom`, `marche`, `source` non vides, sinon échec franc listant l'entrée fautive) ; sinon défaut. Message de succès inchangé par entrée.
- [ ] **Step 4 : vert.** `node --test hooks/*.test.mjs` → `# fail 0` (les tests historiques d'idempotence et délais restent verts).
- [ ] **Step 5 : commit.** `git commit -m "feat(plugin-a-jour): lit la liste des plugins dans le projet consommateur (#2601)"`.

**Interfaces:** Produces : contrat `plugins-a-jour.json` = tableau de `{ nom, marche, source }` (T9 écrit le projet d'essai avec).

---

### Task 5 : Hook `ecrire-shims` et shim `jev-cli`

**Exécutant :** `implementeur` (sonnet). **Branche :** même PR que T4. **Dépend de :** T3, T4.

**Files:** Create : `hooks/ecrire-shims.mjs`, `hooks/ecrire-shims-core.mjs`, `hooks/ecrire-shims.test.mjs`. Modify : `hooks/hooks.json` (SessionStart +).

- [ ] **Step 1 : sonder le registre réel.** `node -e "console.log(require('fs').readFileSync(process.env.USERPROFILE + '/.claude/plugins/installed_plugins.json','utf8'))" | head -40` : relever la forme exacte (clé du plugin, chemin de version). Le code cible CETTE forme, pas une devinée.
- [ ] **Step 2 : test rouge.** `resoudre(registreJson, nom = "softwarefactory@<marche>")` rend le dossier de version ; absent → `null` (échec franc à l'écriture). `ecrireShims({ env, registre, ecrire })` : écrit `<CLAUDE_PROJECT_DIR>/.claude/hooks/jev-cli.mjs` = shim d'une ligne (ré-export du `jev-cli.mjs` du chemin résolu, avec en-tête « fichier généré par l'usine, réécrit à chaque session — ne pas éditer ») ; plugin introuvable → erreur typée avec message clair (jamais de repli).
- [ ] **Step 3 : vérifier le rouge.** Sortie citée : fonction absente (`resoudre is not defined`).
- [ ] **Step 4 : implémenter + brancher.** `hooks.json` SessionStart ajoute `ecrire-shims` (timeout 60, après `plugin-a-jour`). Le shim garde l'usage actuel : `node .claude/hooks/jev-cli.mjs niveau --role <agent>` fonctionne mot pour mot, et la permission Adonnante `Bash(node .claude/hooks/jev-cli.mjs:*)` ne change pas.
- [ ] **Step 5 : vert + commit.** `node --test hooks/*.test.mjs` → `# fail 0` ; `git commit -m "feat(shims): ecrit le shim jev-cli a chemin stable depuis le plugin installe (#2601)"`.

---

### Task 6 : Pré-test du packaging réel

**Exécutant :** `executant-basic` (haiku). **Branche :** sur la PR courante, juste des preuves sur #2601. **Dépend de :** T5.

- [ ] **Step 1 :** `claude plugin validate` à la racine SF → code 0. Sortie citée sur #2601.
- [ ] **Step 2 :** `claude --plugin-dir C:/Users/gh/dev/SoftwareFactory` dans une session jetable : vérifier `/softwarefactory:technical-writing` adressable, `agents` voit `softwarefactory:analyste`, un hook se déclenche (écrire un fichier → `lint-format` N'EST PAS appelé côté plugin ; à la place vérifier `git-stash-guard` : tenter `git stash` en Bash → refusé).
- [ ] **Step 3 :** adapter `run-hook.cmd` si les hooks d'événement échouent sous Windows (constater par le journal de debug, pattern superpowers-extended-cc). Toute adaptation est commitée et relancée jusqu'au succès.
- [ ] **Step 4 :** poster les preuves (commande + sortie) en commentaire sur #2601.

---

### Task 7 : Docs de l'usine

**Exécutant :** `executant-basic` (haiku). **Branche :** `docs/2601-usine-docs` (SF) → PR `dev`. **Dépend de :** T2 (redaction-pr-issues chargée pour la rédaction).

**Files:** Create (SF) : `docs/adoption.md`, `docs/harnais.md`, `docs/issue-tracker.md`, `docs/triage-labels.md`.

- [ ] **Step 1 :** copier `docs/06-agents/issue-tracker.md` et `docs/06-agents/triage-labels.md` depuis Adonnante, rewording dépôt-courant (les commandes `repos/Chewbee/Adonnante` deviennent des variables `<owner>/<repo>`).
- [ ] **Step 2 :** `docs/adoption.md` : les 3 gestes (settings.json avec l'extrait de la spec, `plugins-a-jour.json` avec le format de T4, premier démarrage), + la prévention des hooks doubles + le shim.
- [ ] **Step 3 :** `docs/harnais.md` : charte D7 (contenu neutre, `${CLAUDE_PLUGIN_ROOT}` / câblage par harnais, Claude Code v1, adaptateur Hermes-Agent ensuite avec critère de sortie de la spec).
- [ ] **Step 4 :** commit + preuve : aucun TODO, liens internes vérifiés, `docs` passée à `softwarefactory:relecteur` dans T10.

---

### Task 8 : CI de SoftwareFactory sur les runners Hetzner

**Exécutant :** `implementeur` (sonnet, **confiance Jev 0,26 — à trancher** : si un doute d'approche apparaît, arrêter sur #2601 et passer `jev-cli choix` avec les options ; décision utilisateur sur AskUserQuestion sous 0,5). **Branche :** `chore/2601-ci` (SF) → PR `dev`. **Dépend de :** T3 (tests verts), T6.

**Files:** Create (SF) : `.github/workflows/ci.yml`. Ops (hors dépôt) : inscription des runners.

- [ ] **Step 1 : workflow.** `name: ci`, `on: [pull_request, push (dev)]`, jobs :
  - `tests` : `runs-on:` copié de `.github/workflows/lint.yml` d'Adonnante (`grep -n "runs-on" C:/Users/gh/dev/Adonnante/.github/workflows/lint.yml`, même label/labels), steps : `checkout@v4`, `actions/setup-node@v4` (Node 22, cache npm), `npm ci --no-audit` (package.json sans deps → étape `npm install --no-save vite` NON nécessaire : garder `node --test tests/*.test.mjs hooks/*.test.mjs` direct, sans install), puis `node --test` avec sorties citées.
  - `manifeste` : même runs-on, step `claude plugin validate` (CLI Claude Code installée sur les runners ou `npm install -g @anthropic-ai/claude-code` ; la CI Adonnante fait foi pour la façon d'obtenir la CLI — vérifier `grep -rn "claude" C:/Users/gh/dev/Adonnante/.github/workflows/` ; si aucun précédent, `npx @anthropic-ai/claude-code@latest plugin validate .`).
- [ ] **Step 2 : runners.** Les runners Hetzner d'Adonnante sont inscrits au niveau repo Adonnante : le dépôt SF n'y a PAS accès automatiquement. Suivre `docs/06-agents/ci-runners.md` et la skill `adonnante-runners-ci` (Hermes) : obtenir `gh api repos/Chewbee/SoftwareFactory/actions/runners/registration-token --jq .token`, se connecter à un hôte (cx33, patron du doc), inscrire un service runner supplémentaire avec les labels `hote-*` identiques, sans toucher au service Adonnante existant. Opération sensible : si une connexion manque, `kanban_block(kind=capability)` et signaler sur #2601 — jamais de contournement.
- [ ] **Step 3 : preuve.** Ouvrir la PR `chore/2601-ci` sur SF : run vert cité (n° de run, jobs `tests` + `manifeste`, durée). `gh run list --repo Chewbee/SoftwareFactory --limit 3`.
- [ ] **Step 4 :** commentaire de preuve sur #2601, puis fusion par relecture (T10).

---

### Task 9 : Projet d'essai et preuve réelle (`user-gate`)

**Exécutant :** `implementeur` (opus). **Branche :** dépôt neuf `Chewbee/sf-recette`, branch `dev`. **Dépend de :** T1 à T8, T6. **Recette utilisateur : tâche `user-gate` — fermée par l'utilisateur, jamais par un agent.**

- [ ] **Step 1 : créer le projet d'essai.**

```bash
gh repo create Chewbee/sf-recette --private --description "Recette de consommation de SoftwareFactory (#2601)"
git clone https://github.com/Chewbee/sf-recette.git C:/Users/gh/dev/sf-recette && cd C:/Users/gh/dev/sf-recette
git checkout -b dev && git push -u origin dev && gh repo edit Chewbee/sf-recette --default-branch dev
```

- [ ] **Step 2 : adoption (les 3 gestes de la spec).** `.claude/settings.json` : `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `extraKnownMarketplaces.softwarefactory-marketplace` (`repo: Chewbee/SoftwareFactory`, `autoUpdate: true`), `enabledPlugins.softwarefactory@softwarefactory-marketplace = true`. `.claude/plugins-a-jour.json` : `[{ "nom": "superpowers-extended-cc", "marche": "superpowers-extended-cc-marketplace", "source": "pcvelz/superpowers" }, { "nom": "softwarefactory", "marche": "softwarefactory-marketplace", "source": "Chewbee/SoftwareFactory" }]` (format de T4 ; pas de cesiumjs dans ce projet d'essai : prouve la paramétrisation). `CLAUDE.md` : 5 lignes (STAR, preuve, renvoi au plugin).
- [ ] **Step 3 : session agent-side (headless).** `claude --cwd C:/Users/gh/dev/sf-recette -p "liste tes skills"` (ou équivalent) : sortie citée montrant les skills `softwarefactory:*` ; `printf '{"etat":"x","options":{"a":"A"}}' | node .claude/hooks/jev-cli.mjs choix` après la première session : code 0-2 (pas d'ENOENT), shim opérationnel ; `git stash` refusé. Preuves sur #2601.
- [ ] **Step 4 : UAT utilisateur (`user-gate`).** L'utilisateur ouvre une session Claude Code dans `sf-recette`, exécute la checklist du « Critère de vérification » (skills visibles, dispatch Jev journalisé, shim, stash-guard), et dit explicitement « PRÊT » sur #2601 (ou liste les écarts). Sans son feu vert, T10 ne fait pas la revue finale et Phase B n'est PAS lancée (D9).

**Interfaces:** Consumes : T4 (format `plugins-a-jour.json`), T5 (shim), T8 (marketplace installable). Produces : le verdict `PRÊT` ou les écarts (`D9`).

---

### Task 10 : ADR-0195, relecture finale, PR docs vers `dev` (Adonnante)

**Exécutant :** agent principal + `relecteur` (`softwarefactory:relecteur`, model `opus`, jamais routé). **Branche :** Adonnante `docs/2601-usine-softwarefactory` depuis `origin/dev`. **Dépend de :** T1-T9 et au minimum le verdict utilisateur de T9.

- [ ] **Step 1 : ADR.** Rédiger `docs/03-adr/0195-extraction-de-l-usine-claude-code-dans-le-depot-softwarefactory.md` (décision, conséquences, lien spec, D1-D12 condensés, entrée dans `docs/_index.md`). Ne remplace aucun ADR (ADR-0157 reste : le plugin superpowers d'étape reste externalisé ; l'usine d'agents Chewbee est un plugin de plus).
- [ ] **Step 2 : PR docs.** Contenu : l'ADR-0195 et son entrée dans `docs/_index.md` — RIEN d'autre : la spec et ce plan vivent désormais dans SoftwareFactory (`docs/superpowers/`), et `docs/backlog.md` d'Adonnante n'est pas touché (le tracker de l'usine est l'issue `Chewbee/Adonnante#2601` côté Adonnante, plus tard ses propres issues SF). PR vers `dev`, corps selon `redaction-pr-issues` (`Corrige #2601` sans `Closes` : la bascule reste ouverte).
- [ ] **Step 3 : relecture adversariale.** `softwarefactory:relecteur` (`model: "opus"`), diff depuis `git merge-base HEAD origin/dev`, rapport posté sur #2601 sous `<!-- relecture branche=docs/2601-usine-softwarefactory tache=finale -->` (ADR-0135), dernière ligne `VERDICT : PRÊT` ou `PAS PRÊT`.
- [ ] **Step 4 : ouverture et fusion.** PR ouverte seulement après `PRÊT` + UAT de T9. L'auto-merge (règle générale) s'arme après UAT utilisateur explicite. Vérifier `gh api repos/Chewbee/Adonnante/pulls/<n> --jq .merged_at` non nul.

---

## Après ce plan (hors périmètre ici)

- **Phase B** : bascule Adonnante (suppression des copies, adoption, gardes scindées côté Adonnante, retouches noyau `softwarefactory:*`, stubs docs). Son plan s'écrit après le verdict `PRÊT` de T9, jamais avant (D9).
- **Phase C** : sections noyau injectées par skill SessionStart (D4) ; adaptateur Hermes-Agent (D7) ; dashboard kanban inter-agents (D8, spec séparée) ; scripts génériques (`git-worktree-safe`) notés v2.
