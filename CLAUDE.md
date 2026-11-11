# CLAUDE.md — SoftwareFactory

Ce fichier ne régit que le **développement de l'usine**. Un plugin ne charge
jamais son `CLAUDE.md` racine : les projets consommateurs n'en voient rien, seuls
les développeurs de ce dépôt le lisent.

## Ce dépôt

Plugin + marketplace Claude Code d'une seule racine (`.claude-plugin/`),
consommé par les projets de Chewbee. Backlog : features dans **Linear**
(team SF, issues `SF-N`), bugs dans **GitHub Issues** de ce dépôt —
conventions : `docs/backlog-linear.md`. Spéc et plans : `docs/superpowers/`.

## Règles de développement

- **Preuve avant affirmation** : tout diagnostic ou « c'est fait » cite la
  commande et sa sortie. Un auto-rapport ne vaut jamais preuve.
- **TDD** : toute logique nouvelle a son test rouge cité, puis vert
  (`node --test`). Les tests vivent avec leur code (`hooks/*.test.mjs`,
  `tests/*.test.mjs`).
- **Jamais de repli silencieux** : une ressource absente ou une entrée invalide
  échoue bruyamment (message + code non nul), jamais de comportement dégradé
  muet.
- **Contenu harnais-neutre** : la logique des hooks vit en modules purs
  (`*-core.mjs`, sans dépendance au format d'événement d'un harnais) ; le
  câblage par harnais est séparé (`hooks/hooks.json` pour Claude Code,
  `docs/harnais.md` pour la charte). Jamais de chemin de plugin en dur :
  `${CLAUDE_PLUGIN_ROOT}` dans les commandes, `${CLAUDE_PROJECT_DIR}` côté
  projet consommateur ; un outil appelé à la main par un agent passe par un
  shim à chemin stable écrit dans le projet, jamais par le cache de version.
- **Aucun secret dans le dépôt** : les clés vivent dans l'environnement
  (ex. `LINEAR_APP_SF_KEY`), jamais dans un fichier suivi.

## Git

- Branche par défaut : `dev`. Branches : `feat/SF-N-sujet`, `fix/N-sujet`,
  `docs/…`, `chore/…`.
- Commits (charte) : titre à l'impératif avec préfixe Conventional Commits
  (`feat(scope):`, `fix(scope):`, `docs(scope):`, `chore(scope):`), corps qui
  prouve plutôt qu'affirme, footer de traçabilité :
  - fonctionnalité Linear : `Refs SF-N` (liaison) ou `Fixes SF-N` (fermeture
    au merge sur `dev`, l'issue passant *Done* toute seule) ;
  - bug GitHub : `Corrige #N` puis `Closes #N` (la ligne que lit GitHub).
  - Aucune ligne `Co-Authored-By`, jamais `--no-verify`.
- Le nom de branche porte l'identifiant Linear en tête (`feat/SF-10-…`) :
  les PR se lient à l'issue sans rien faire de plus.
