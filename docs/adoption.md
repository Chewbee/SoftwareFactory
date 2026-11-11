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
relais à chaque démarrage ou reprise de session, et `ecrire-shims` réécrit le
shim vers la version à jour.

## Ce que l'usine apporte au premier démarrage suivant

- Skills `softwarefactory:*` et agents `softwarefactory:analyste`,
  `softwarefactory:implementeur`, `softwarefactory:relecteur`, etc.
- Hooks génériques (mise à jour des plugins, garde `git stash`,
  dispatch Jev, verdicts de relecture, publication des tâches natives) —
  voir `hooks/hooks.json`.
- Le shim `<projet>/.claude/hooks/jev-cli.mjs` (généré, ne pas éditer) :
  `node .claude/hooks/jev-cli.mjs niveau --role …` garde un chemin stable.
  Ajouter au settings.json du projet la permission
  `Bash(node .claude/hooks/jev-cli.mjs:*)` pour l'appeler sans invite.

## Points d'attention

- **Hooks en double** : les hooks ne portent pas de préfixe. Si le projet a
  DÉJÀ ses propres hooks équivalents dans son settings.json, ils
  s'exécuteront deux fois. Pendant une migration : un seul côté actif.
- **Budget de démarrage** : le timeout du hook `plugin-a-jour` (600 s) couvre
  la liste par défaut (2 plugins, 8 commandes × 70 s). Au-delà de 2 plugins,
  vérifier le budget : n × 4 commandes × 70 s < 600 s.
- **Publication des tâches natives** (`etat-job-publier`) : le dépôt cible
  est encore en dur (`Chewbee/Adonnante`) — suivi SF-37 ; à paramétrer par
  projet.
- **Ce que l'usine n'apporte pas** : les skills de domaine, les règles de
  zone et le noyau (invariants, commandes, branches) restent au projet
  consommateur. Le plugin ne connaît pas ton domaine.
