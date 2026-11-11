# Charte de portabilité multi-harnais (D7)

L'usine doit tourner sous plusieurs harnais d'agents. Claude Code est le
premier ; Hermes-Agent (et d'autres) suivront. La règle : **le contenu est
neutre, l'adaptation vit dans un adaptateur par harnais**.

## Ce qui est neutre (vit tel quel)

- Les skills (`skills/*/SKILL.md`) : elles parlent du « projet
  consommateur, jamais d'un projet nommé, et portent une table
  `Liaison | Défaut | Où la trancher` quand une valeur dépend du
  consommateur (branche, recette, journal, labels de triage).
- Les agents (`agents/*.md`) : rôles génériques (analyse, implémentation,
  relecture), renvois aux invariants « du noyau du projet », exemples
  explicites « ex. … » tolérés.
- Les cœurs de hooks (`hooks/*-core.mjs`) : logique pure, injection des
  effets (executer, ecrire, env), zéro chemin de projet en dur.

## Ce qui est propre à un harnais (vit dans l'adaptateur)

- Le câblage des hooks (`hooks/hooks.json` pour Claude Code : events,
  matchers, commandes `${CLAUDE_PLUGIN_ROOT}`) ; un autre harnais a sa
  propre forme de câblage et ses propres points d'entrée.
- La façon de précharger / namespacer les skills et agents
  (`<plugin>:<nom>` sous Claude Code).
- L'invocation des agents et le dispatch de modèles : le couple
  `jev-model`/`jev-cli` est l'adaptateur Jev sous Claude Code ; un autre
  harnais garde la même table BANDES mais son propre shim.

## Règles dures

1. Aucun chemin de plugin en dur : chaque version s'installe dans un
   dossier cache neuf ; référencer `${CLAUDE_PLUGIN_ROOT}` (plugin) et
   `${CLAUDE_PROJECT_DIR}` (projet consommateur).
2. Un CLI appelé à la main en Bash ne résout pas le chemin du plugin :
   passer par un shim auto-généré à chemin stable (`ecrire-shims`).
3. Le `CLAUDE.md` racine du plugin n'est JAMAIS chargé comme contexte par
   Claude Code : une règle toujours valable se porte par hook ou skill,
   pas par un CLAUDE.md racine (il ne sert qu'au développement du plugin).
4. Les hooks ne portent pas de préfixe de plugin : à la bascule d'un
   projet qui avait ses propres hooks, vérifier par lecture croisée
   qu'aucun hook ne survit en double.
5. Toute évolution du modèle d'un autre harnais part d'un adaptateur
   dédié ; on ne pollue jamais les cœurs neutres avec du vocabulaire
   d'un harnais particulier.

## Harnais suivant : Hermes-Agent

Critère de sortie de la spec : une session Hermes voit les skills
`softwarefactory:*` dans son catalogue de skills (`skills_list`), les
agents du plugin y sont dispatchables, et le shim `jev-cli` reste
opérable depuis son terminal. L'adaptateur Hermes vit dans le plugin
sans toucher aux cœurs neutres — chantier séparé (Phase C, SF-6).
