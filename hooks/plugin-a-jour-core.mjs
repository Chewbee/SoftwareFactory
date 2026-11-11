// Logique du hook plugin-a-jour (#2268, ADR-0157, #2315). Le hook installe ou met à jour les
// DEUX plugins du projet, superpowers-extended-cc et cesiumjs-skills, SUR DISQUE, en portée
// `local` du projet de la session, à chaque démarrage ou reprise de session. Les quatre
// commandes d'un plugin s'arrêtent à la première en échec, mais le plugin suivant est
// quand même traité : l'échec de l'un n'en prive pas l'autre.
// Il ne le charge pas dans la session qui l'a lancé : les plugins se chargent au
// démarrage, un changement sur disque n'agit qu'après `/reload-plugins` ou au démarrage
// suivant (doc « Plugin loading reference », couche « Loaded »). Le message de succès le
// dit chaque fois, sans chercher à savoir si quelque chose a changé : les quatre
// commandes de chaque plugin sont idempotentes (code 0 au second passage). En cloud, la session charge la
// copie de la configuration utilisateur ; le hook la met à jour sur disque, avec effet au
// prochain démarrage du worker ou après `/reload-plugins`.
// `mettreAJour` est pure : l'exécution de la CLI lui est injectée, executer(args) rend
// { code, stdout, stderr, erreur }, code valant null quand la commande n'a pas rendu de
// code (introuvable, délai, signal). `creerExecuteur` fabrique l'exécuteur réel, seule
// partie qui lance un processus, exportée pour que le test prouve la liaison du délai.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LONGUEUR_DETAIL = 300;
const SUITE = "Un plugin installé ou mis à jour ici ne se charge qu'au démarrage suivant ou après `/reload-plugins`.";

// Les plugins par défaut, dans cet ordre : `source` est le dépôt GitHub du
// marketplace, `marche` son nom. Un projet consommateur peut imposer sa
// propre liste via .claude/plugins-a-jour.json (lirePlugins, SF-18).
const PLUGINS_DEFAUT = [
  { nom: "superpowers-extended-cc", marche: "superpowers-extended-cc-marketplace", source: "pcvelz/superpowers" },
  { nom: "cesiumjs-skills", marche: "cesiumjs-skills", source: "CesiumGS/cesiumjs-skills" },
];

// Pour chaque plugin, toujours ces quatre commandes, dans cet ordre, sans rien lire avant. install et
// update visent la portée `local` du projet de la session : sans --scope, install crée une copie `user`
// et update vise la portée la plus spécifique du projet (local, project, user, managed), donc pas la même.
function etapes({ nom, marche, source }) {
  const plugin = `${nom}@${marche}`;
  return [
    ["plugin", "marketplace", "add", source],
    ["plugin", "marketplace", "update", marche],
    ["plugin", "install", plugin, "--scope", "local"],
    ["plugin", "update", plugin, "--scope", "local"],
  ];
}

// Délai par commande de la CLI et nombre de commandes : leur produit doit rester sous le
// `timeout` du hook dans hooks/hooks.json (test dans plugin-a-jour.test.mjs).
// COMMANDES_MAX borne la liste PAR DÉFAUT : un consommateur qui déclare plus
// de plugins que les deux défauts doit vérifier son budget lui-même (recette
// d'adoption, docs/adoption.md).
export const DELAI_COMMANDE_MS = 70_000;
export const COMMANDES_MAX = PLUGINS_DEFAUT.reduce((total, plugin) => total + etapes(plugin).length, 0);

// SF-18 : la liste des plugins à maintenir vient du projet consommateur,
// dans .claude/plugins-a-jour.json à la racine du projet de la session.
// Rend { plugins } quand la liste est exploitable (fichier absent → défaut),
// { erreur } sinon : JSON invalide, liste vide ou entrée fautive donnent un
// échec franc, jamais un repli silencieux vers les défauts.
const FICHIER_LISTE = path.join(".claude", "plugins-a-jour.json");

function lirePlugins(env = process.env) {
  const racine = env?.CLAUDE_PROJECT_DIR ?? process.cwd();
  const fichier = path.join(racine, FICHIER_LISTE);
  let brut;
  try {
    brut = fs.readFileSync(fichier, "utf8");
  } catch (e) {
    if (e && typeof e.code === "string" && e.code === "ENOENT") return { plugins: PLUGINS_DEFAUT };
    return { erreur: `la liste des plugins à jour est illisible (${fichier} : ${e.code ?? "erreur de lecture"})` };
  }
  let liste;
  try {
    liste = JSON.parse(brut);
  } catch (e) {
    return { erreur: `la liste des plugins à jour (${fichier}) n'est pas du JSON valide : ${e.message}` };
  }
  if (!Array.isArray(liste)) {
    return { erreur: `la liste des plugins à jour (${fichier}) n'est pas une liste de plugins : déclare un tableau [{ nom, marche, source }, …]` };
  }
  if (liste.length === 0) {
    return { erreur: `la liste des plugins à jour (${fichier}) est vide : déclare au moins un plugin ou supprime le fichier` };
  }
  for (const [index, entree] of liste.entries()) {
    const fautive =
      typeof entree !== "object" || entree === null || Array.isArray(entree)
        ? "l'entrée n'est pas un objet"
        : typeof entree.nom !== "string" || entree.nom === ""
          ? "nom manquant ou vide"
          : typeof entree.marche !== "string" || entree.marche === ""
            ? "marche manquant ou vide"
            : typeof entree.source !== "string" || entree.source === ""
              ? "source manquante ou vide"
              : null;
    if (fautive !== null) {
      return { erreur: `la liste des plugins à jour (${fichier}) contient une entrée fautive (n° ${String(index + 1)} : ${fautive}) : ${JSON.stringify(entree)}` };
    }
  }
  return { plugins: liste };
}

// Garde la fin : la cause d'un échec (nom du verrou git…) est en fin de ligne.
function condenser(texte) {
  const court = texte.replace(/\s+/g, " ").trim();
  return court.length > LONGUEUR_DETAIL ? `…${court.slice(-LONGUEUR_DETAIL)}` : court;
}

function decrireEchec(nom, binaire, commande, { code, stdout, stderr, erreur }) {
  const echec = `la mise à jour du plugin ${nom} a échoué`;
  if (erreur === "ENOENT") {
    return `${echec} : la commande « ${binaire} » est introuvable (ENOENT), le plugin n'est pas mis à jour`;
  }
  const detail = condenser(stderr.trim() !== "" ? stderr : stdout);
  const suite = detail === "" ? "" : ` : ${detail}`;
  if (code === null) {
    return `${echec} : « ${commande} » est restée sans code de sortie (${erreur ?? "cause inconnue"})${suite}`;
  }
  return `${echec} : « ${commande} » a rendu le code ${String(code)}${suite}`;
}

// Dernière ligne non vide d'un stdout, sans point final (le message en ajoute un) ; à défaut, la commande est nommée.
function derniereLigne(stdout, commande) {
  const ligne = stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1);
  return ligne === undefined ? `« ${commande} » a réussi sans rien écrire sur stdout` : ligne.replace(/\.$/, "");
}

// L'exécuteur réel : lance `binaire args…` avec `delaiMs` pour seul délai ; rend { code, stdout, stderr, erreur }.
// Les commandes tournent à la racine du projet de la session (`env.CLAUDE_PROJECT_DIR`, doc des hooks : « the
// project root where the session started »), sinon là où le hook est lancé : un hook hérite du répertoire
// courant de la session, qui n'est pas toujours la racine, et la CLI y situe la portée `local`.
export function creerExecuteur(binaire, delaiMs, env = process.env) {
  const projet = env.CLAUDE_PROJECT_DIR;
  const cwd = projet !== undefined && projet !== "" ? projet : undefined;
  return (args) => {
    const r = spawnSync(binaire, args, {
      cwd,
      encoding: "utf8",
      timeout: delaiMs,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", erreur: r.error?.code ?? r.signal };
  };
}

// Rend { ok, commandes, message } et ne lève pas : un échec est un message, jamais une exception.
// Un échec arrête les commandes restantes de SON plugin, pas celles du suivant ; `ok` vaut vrai si
// tous les plugins ont réussi. Le message nomme chaque plugin, avec son succès ou son échec.
// `binaire` : la commande que `executer` lance réellement, nommée dans les messages.
export function mettreAJour({ executer, binaire = "claude", env = process.env }) {
  const lu = lirePlugins(env);
  if (lu.erreur !== undefined) return { ok: false, commandes: [], message: lu.erreur };
  const commandes = [];
  const bilans = lu.plugins.map((plugin) => {
    const resultats = [];
    for (const args of etapes(plugin)) {
      const commande = `${binaire} ${args.join(" ")}`;
      commandes.push(commande);
      const reponse = executer(args);
      if (reponse.code !== 0) return { ok: false, texte: `${plugin.nom} : ${decrireEchec(plugin.nom, binaire, commande, reponse)}` };
      resultats.push({ commande, stdout: reponse.stdout });
    }
    const [installation, miseAJour] = resultats.slice(-2).map(({ commande, stdout }) => derniereLigne(stdout, commande));
    return { ok: true, texte: `${plugin.nom} : ${installation} ; ${miseAJour}` };
  });
  return { ok: bilans.every(({ ok }) => ok), commandes, message: `${bilans.map(({ texte }) => texte).join(" | ")}. ${SUITE}` };
}
