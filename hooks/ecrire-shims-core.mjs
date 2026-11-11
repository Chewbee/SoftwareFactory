// Logique pure du hook ecrire-shims (SF-19) : le projet consommateur garde
// l'usage « node .claude/hooks/jev-cli.mjs niveau --role <agent> » à chemin
// STABLE, alors que l'usine vit dans le cache versionné des plugins
// (installPath change à chaque mise à jour). Le hook écrit un shim qui
// délègue au jev-cli.mjs de l'installation résolue, et le réécrit à chaque
// SessionStart : la résolution suit les mises à jour.
// `ecrireShims` est pure : la lecture du registre (JSON en chaîne, déjà lue)
// et l'écriture du fichier lui sont injectées (`registreJson`, `ecrire`).
// Forme du registre (observée en vrai, version 2) :
//   { "version": 2, "plugins": { "nom@marche": [ { scope, projectPath?,
//     installPath, version, lastUpdated, gitCommitSha, … } ] } }
// — plusieurs installations par plugin : une locale par projet (projectPath),
// une user. Ordre de préférence : locale de CE projet, puis user, puis la
// plus récente. La casse de projectPath varie en vrai (C: vs c:) : le
// rapprochement l'ignore sous Windows.
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN = "softwarefactory";
const MARCHE = "softwarefactory-marketplace";
export const ID_PLUGIN = `${PLUGIN}@${MARCHE}`;

function normaliser(p) {
  const absolu = path.resolve(p);
  return process.platform === "win32" ? absolu.toLowerCase() : absolu;
}

function laPlusRecente(installations) {
  return [...installations].sort((a, b) => String(b.lastUpdated ?? "").localeCompare(String(a.lastUpdated ?? "")))[0];
}

// Rend l'installPath du plugin, ou null quand il n'est pas installé.
// Registre illisible → échec franc (jamais de null silencieux : un retour
// null signifie « pas installé », pas « je n'ai pas su lire »).
export function resoudre(registreJson, id = ID_PLUGIN, projet = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) {
  let registre;
  try {
    registre = JSON.parse(registreJson);
  } catch (e) {
    throw new Error(`le registre des plugins installés n'est pas du JSON valide : ${e.message}`);
  }
  if (typeof registre !== "object" || registre === null || typeof registre.plugins !== "object" || registre.plugins === null) {
    throw new Error("le registre des plugins installés est inattendu : clé « plugins » absente ou vide");
  }
  const installations = registre.plugins[id];
  if (!Array.isArray(installations) || installations.length === 0) return null;
  const locale = installations.filter(
    (i) => typeof i === "object" && i !== null && i.scope === "local" && typeof i.projectPath === "string" && normaliser(i.projectPath) === normaliser(projet),
  );
  if (locale.length > 0) return laPlusRecente(locale).installPath;
  const user = installations.filter((i) => typeof i === "object" && i !== null && i.scope === "user");
  if (user.length > 0) return laPlusRecente(user).installPath;
  return laPlusRecente(installations).installPath;
}

// Écrit <CLAUDE_PROJECT_DIR>/.claude/hooks/jev-cli.mjs, shim d'une ligne et
// demie : en-tête « généré, ne pas éditer », délégation au main exporté du
// jev-cli.mjs résolu. Plugin introuvable → erreur typée au message clair,
// RIEN n'est écrit : jamais de repli silencieux (on n'écrase pas un shim
// valide par un shim cassé, et l'absence reste visible).
export function ecrireShims({ env = process.env, registreJson, ecrire }) {
  const racine = env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const chemin = path.join(racine, ".claude", "hooks", "jev-cli.mjs");
  const dossier = resoudre(registreJson, ID_PLUGIN, racine);
  if (dossier === null) {
    throw new Error(`le plugin ${ID_PLUGIN} est introuvable dans le registre des plugins installés : lance d'abord son installation (hook plugin-a-jour) — aucun shim n'est écrit`);
  }
  const cible = pathToFileURL(path.join(dossier, "hooks", "jev-cli.mjs")).href;
  const contenu = `// Fichier généré par l'usine (hook ecrire-shims de softwarefactory) : réécrit à chaque SessionStart, ne pas éditer.\nimport { main } from ${JSON.stringify(cible)};\nprocess.exitCode = await main();\n`;
  ecrire(chemin, contenu);
  return { chemin, cible };
}
