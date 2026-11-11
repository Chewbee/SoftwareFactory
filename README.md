# SoftwareFactory

Usine d'agents Claude Code de Chewbee : skills, agents, hooks et conventions,
empaquetés en **plugin + marketplace d'une seule racine**, consommés à la
demande par un projet et mis à jour à chaque session.

- **Spéc (fait foi)** : [`docs/superpowers/specs/2026-11-10-softwarefactory-extraction-design.md`](docs/superpowers/specs/2026-11-10-softwarefactory-extraction-design.md)
- **Plan Phase A** : [`docs/superpowers/plans/2026-11-10-softwarefactory-extraction.md`](docs/superpowers/plans/2026-11-10-softwarefactory-extraction.md)
- **Backlog** : Linear (team SF, issues `SF-N`), conventions dans [`docs/backlog-linear.md`](docs/backlog-linear.md) ; les bugs vivent en GitHub Issues de ce dépôt.

## Adoption par un projet (3 gestes)

Installation rapide en une commande (Claude Code ≥ 2.1.275) :

```
/plugin install softwarefactory --marketplace Chewbee/SoftwareFactory
```

Puis, pour l'adoption complète d'un projet (autoUpdate + mise à jour par
`plugin-a-jour` à chaque session) :

1. `.claude/settings.json` du projet :
   `"extraKnownMarketplaces": { "softwarefactory-marketplace": { "source": { "source": "github", "repo": "Chewbee/SoftwareFactory" }, "autoUpdate": true } }`
   et `"enabledPlugins": { "softwarefactory@softwarefactory-marketplace": true }`.
2. `.claude/plugins-a-jour.json` : le plugin `softwarefactory` ajouté à la liste du projet.
3. Premier démarrage : le hook `plugin-a-jour` installe le plugin en scope `local` ; ensuite, mise à jour automatique à chaque session.

## Structure

- `agents/` — sous-agents (`softwarefactory:analyste`, …) — *à migrer (EPIC A3)*
- `skills/` — skills de processus (`softwarefactory:technical-writing`, …) — *à migrer (EPIC A3)*
- `hooks/` — hooks d'événements + `hooks.json` avec `${CLAUDE_PLUGIN_ROOT}` — *à migrer (EPIC A3/A4)*
- `docs/` — conventions ([`backlog-linear.md`](docs/backlog-linear.md)), pilotage GitHub+Linear ([`pilotage-github-linear.md`](docs/pilotage-github-linear.md)), adoption, charte multi-harnais

Statut : **Phase A — construction** (extraction par copie, la source Adonnante
reste intacte jusqu'à la preuve ; spec, décisions D1-D12).
