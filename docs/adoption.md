# Adopter l'usine dans un projet

L'usine vit dans le dépôt `Chewbee/SoftwareFactory`, empaquetée en plugin
Claude Code + marketplace d'une seule racine. Un projet consommateur
l'adopte en **trois gestes**, puis tout est automatique.

## 1. Déclarer le marketplace et le plugin (settings.json du projet)

Dans `<projet>/.claude/settings.json` :

```json
{
  "extraKnownMarketplaces": {
    "softwarefactory-marketplace": {
      "source": { "source": "github", "repo": "Chewbee/SoftwareFactory" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "softwarefactory@softwarefactory-marketplace": true }
}
```

## 2. Déclarer les plugins à maintenir (plugins-a-jour.json)

À la racine du projet, `.claude/plugins-a-jour.json` — la liste fait foi,
le hook `plugin-a-jour` l'applique à chaque session :

```json
[
  { "nom": "softwarefactory", "marche": "softwarefactory-marketplace", "source": "Chewbee/SoftwareFactory" },
  { "nom": "superpowers-extended-cc", "marche": "superpowers-extended-cc-marketplace", "source": "pcvelz/superpowers" }
]
```

- Fichier **absent** → défaut : `superpowers-extended-cc` + `cesiumjs-skills`.
- Champ en plus : toléré, ignoré. Doublons : tolérés (commandes idempotentes).
- JSON invalide, liste vide ou entrée fautive (non-objet, champ manquant,
  vide ou non-chaîne) → échec franc, aucune commande lancée — jamais de
  repli silencieux.

## 3. Amorcer le premier install

```text
/plugin install softwarefactory --marketplace Chewbee/SoftwareFactory
```

**Le hook embarqué ne peut pas réaliser ce premier install lui-même** : il
n'existe dans le consommateur qu'une fois le plugin installé. La ligne une
commande (ou un install manuel) amorce ; ensuite, `plugin-a-jour` prend le
relais à chaque démarrage ou reprise de session.

## Ce que l'usine apporte au premier démarrage suivant

- Skills `softwarefactory:*` et agents `softwarefactory:analyste`,
  `softwarefactory:implementeur`, `softwarefactory:relecteur`, etc.
- Hooks génériques (mise à jour des plugins, garde `git stash`,
  publication des tâches natives) — voir `hooks/hooks.json`.
- Choix du modèle : chaque agent garde le modèle de son frontmatter ; un appel
  au `softwarefactory:relecteur` passe `model: opus`. Jev (TypeSafe) a été
  retiré le 2026-11-15 : un projet qui avait le shim
  `<projet>/.claude/hooks/jev-cli.mjs` ou sa permission
  `Bash(node .claude/hooks/jev-cli.mjs:*)` les supprime.

## Points d'attention

- **Hooks en double** : les hooks ne portent pas de préfixe. Si le projet a
  DÉJÀ ses propres hooks équivalents dans son settings.json, ils
  s'exécuteront deux fois. Pendant une migration : un seul côté actif.
- **Budget de démarrage** : le timeout du hook `plugin-a-jour` (600 s) couvre
  la liste par défaut (2 plugins, 8 commandes × 70 s). Au-delà de 2 plugins,
  vérifier le budget : n × 4 commandes × 70 s < 600 s.
- **Publication des tâches natives** (`etat-job-publier`) : le dépôt cible est
  paramétrable par le projet consommateur via la variable d'environnement
  `ETAT_JOB_DEPOT` (forme `owner/repo`, échec franc si mal formée), posée dans
  l'environnement du terminal (ou du service) qui lance la session Claude Code
  du projet — la clé est lue au chargement du hook, un process frais par
  événement ; sans elle, défaut `Chewbee/Adonnante`.
- **Ce que l'usine n'apporte pas** : les skills de domaine, les règles de
  zone et le noyau (invariants, commandes, branches) restent au projet
  consommateur. Le plugin ne connaît pas ton domaine.
