// CLI de Jev pour l'agent principal (ADR-0194) : note la complexité d'une tâche
// d'un plan avant le dispatch. Même question, même bande et même seuil que le
// hook jev-model.
//   printf '<description>' | node .claude/hooks/jev-cli.mjs niveau --role softwarefactory:implementeur
// Sortie : une ligne JSON { niveau, modele, confiance, aTrancher, raison }.
// `choix` : Jev départage les options d'une décision propre à l'agent principal.
//   printf '{"etat":"<raisonnement>","options":{"a":"…","b":"…"}}' | node .claude/hooks/jev-cli.mjs choix
// Sortie : une ligne JSON { choix, confiance, probabilites, aTrancher, raison, tronque } ;
// tronque vaut true quand l'état dépasse ETAT_MAX caractères : Jev n'en lit que le début.
// Entrée invalide (JSON illisible, clé en double, moins de 2 ou plus de 10 options, nom, description ou état vides) : code 2.
// `bilan` : taux de PAS PRÊT par agent d'implémentation, modèle et source, lu dans
// .claude/logs/jev-model.jsonl.
//   node .claude/hooks/jev-cli.mjs bilan

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  BANDES,
  ETAT_MAX,
  MODELES,
  NIVEAUX,
  SEUIL_CONFIANCE,
  appelerJev,
  borner,
  demanderJev,
} from "./jev-model-core.mjs";

const ROLES = Object.keys(BANDES);
const DELAI_MS = 3000;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 10;
const TOLERANCE_SOMME = 0.01;

function parDefaut(role, confiance, raison) {
  const defaut = BANDES[role].defaut;
  return {
    niveau: defaut === null ? null : NIVEAUX[MODELES.indexOf(defaut)],
    modele: defaut,
    confiance,
    aTrancher: true,
    raison,
  };
}

export async function noterTache({ description, role, env, fetchFn, delaiMs = DELAI_MS }) {
  if (!ROLES.includes(role)) {
    throw new Error(`rôle hors table : ${String(role)} (attendu : ${ROLES.join(", ")})`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error("description vide");
  }
  const { raison, lu } = await demanderJev(description, env, fetchFn, delaiMs);
  if (lu === undefined) return parDefaut(role, null, raison);
  if (lu.confiance < SEUIL_CONFIANCE) return parDefaut(role, lu.confiance, "confiance-basse");
  return {
    niveau: NIVEAUX[lu.niveau],
    modele: borner(lu.niveau, role),
    confiance: lu.confiance,
    aTrancher: false,
    raison: null,
  };
}

function estObjet(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function estProba(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

// Rend { choix, confiance, probabilites } (choix = argmax des probabilités ; le champ
// `choice` de l'API n'est pas lu) ou null si la réponse ne suit pas le format documenté du primitif Choice.
function lireChoix(corps, noms) {
  if (!estObjet(corps) || !estObjet(corps.answers)) return null;
  const reponse = corps.answers.decision;
  if (!estObjet(reponse) || reponse.type !== "choice" || !estObjet(reponse.probabilities)) return null;
  if (!estProba(reponse.confidence)) return null;
  const recues = Object.keys(reponse.probabilities);
  if (recues.length !== noms.length || !noms.every((n) => Object.hasOwn(reponse.probabilities, n))) {
    return null;
  }
  let choix = null;
  let meilleure = -1;
  let somme = 0;
  for (const nom of noms) {
    const p = reponse.probabilities[nom];
    if (!estProba(p)) return null;
    somme += p;
    if (p > meilleure) {
      meilleure = p;
      choix = nom;
    }
  }
  if (Math.abs(somme - 1) > TOLERANCE_SOMME) return null;
  return { choix, confiance: reponse.confidence, probabilites: { ...reponse.probabilities } };
}

const BLANCS_JSON = new Set([" ", "\t", "\n", "\r"]);

// Rend la première clé répétée dans un même objet du texte JSON, ou null.
// JSON.parse garde la dernière valeur d'une clé répétée sans le dire, et un
// reviver ne voit plus la première : seul le texte brut la montre. Le texte
// doit déjà avoir été lu sans erreur par JSON.parse.
export function cleEnDouble(texte) {
  const objets = [];
  let i = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === "{") {
      objets.push(new Set());
    } else if (c === "}") {
      objets.pop();
    } else if (c === '"') {
      let fin = i + 1;
      while (fin < texte.length && texte[fin] !== '"') fin += texte[fin] === "\\" ? 2 : 1;
      let suite = fin + 1;
      while (BLANCS_JSON.has(texte[suite])) suite += 1;
      const cles = objets.at(-1);
      // Dans un JSON valide, une chaîne suivie de deux-points est une clé de l'objet ouvert.
      if (texte[suite] === ":" && cles !== undefined) {
        const cle = JSON.parse(texte.slice(i, fin + 1));
        if (cles.has(cle)) return cle;
        cles.add(cle);
      }
      i = fin;
    }
    i += 1;
  }
  return null;
}

export async function choisir({ etat, options, env, fetchFn, delaiMs = DELAI_MS }) {
  if (typeof etat !== "string" || etat.trim() === "") throw new Error("état vide");
  const entrees = estObjet(options) ? Object.entries(options) : [];
  if (
    entrees.length < OPTIONS_MIN ||
    entrees.length > OPTIONS_MAX ||
    entrees.some(([nom, desc]) => nom.trim() === "" || typeof desc !== "string" || desc.trim() === "")
  ) {
    throw new Error(
      `options : ${String(OPTIONS_MIN)} à ${String(OPTIONS_MAX)} entrées { nom: description } non vides attendues`,
    );
  }
  // ADR-0194, point 8 : appelerJev ne transmet que les ETAT_MAX premiers caractères ; la sortie le dit.
  const tronque = etat.length > ETAT_MAX;
  const question = {
    type: "choice",
    instructions: "Quelle option l'agent doit-il retenir au vu de son raisonnement ?",
    criteria: options,
  };
  const { raison, corps } = await appelerJev(etat, { decision: question }, env, fetchFn, delaiMs);
  const repli = (r) => ({ choix: null, confiance: null, probabilites: null, aTrancher: true, raison: r, tronque });
  if (corps === undefined) return repli(raison);
  const lu = lireChoix(corps, entrees.map(([nom]) => nom));
  if (lu === null) return repli("reponse-invalide");
  if (lu.confiance < SEUIL_CONFIANCE) return { ...lu, aTrancher: true, raison: "confiance-basse", tronque };
  return { ...lu, aTrancher: false, raison: null, tronque };
}

const VERDICTS = ["PRÊT", "PAS PRÊT", "absent"];
const AGENTS_IMPLEMENTATION = ["softwarefactory:implementeur", "softwarefactory:executant-basic"];
const MODELE_ABSENT = "—";

// `jev` et `repli` viennent des lignes de l'ancien hook (ADR-0192, supprimé).
function sourceDispatch(raison) {
  if (raison === "model-explicite") return "explicite";
  if (raison === "model-absent") return "sans-model";
  if (raison === null) return "jev";
  return "repli";
}

// Pour une même relecture, un PRÊT ou un PAS PRÊT l'emporte sur absent ;
// entre deux verdicts, le dernier du journal gagne (ADR-0194, point 9).
function retenir(precedente, nouvelle) {
  if (precedente === undefined) return nouvelle;
  if (nouvelle.verdict === "absent" && precedente.verdict !== "absent") return precedente;
  return nouvelle;
}

function comparer(a, b) {
  for (const cle of ["agent", "modele", "source"]) {
    if (a[cle] < b[cle]) return -1;
    if (a[cle] > b[cle]) return 1;
  }
  return 0;
}

// texte : contenu de .claude/logs/jev-model.jsonl. Une ligne qui n'est ni un
// dispatch ni un verdict, mais valide, est ignorée ; une ligne illisible est comptée.
export function faireBilan(texte) {
  const dispatchs = [];
  const relectures = new Map();
  let illisibles = 0;
  texte.split("\n").forEach((brute, index) => {
    if (brute.trim() === "") return;
    let ligne;
    try {
      ligne = JSON.parse(brute);
    } catch {
      illisibles += 1;
      return;
    }
    const instant = estObjet(ligne) && typeof ligne.date === "string" ? Date.parse(ligne.date) : Number.NaN;
    if (Number.isNaN(instant)) {
      illisibles += 1;
      return;
    }
    const session = typeof ligne.session_id === "string" ? ligne.session_id : null;
    if ("verdict" in ligne) {
      if (!VERDICTS.includes(ligne.verdict)) {
        illisibles += 1;
        return;
      }
      const cle = typeof ligne.agent_id === "string" ? ligne.agent_id : `ligne-${String(index)}`;
      relectures.set(cle, retenir(relectures.get(cle), { instant, session, verdict: ligne.verdict }));
      return;
    }
    if (
      AGENTS_IMPLEMENTATION.includes(ligne.agent) &&
      (typeof ligne.retenu === "string" || ligne.raison === "model-absent")
    ) {
      dispatchs.push({
        instant,
        session,
        agent: ligne.agent,
        modele: typeof ligne.retenu === "string" ? ligne.retenu : MODELE_ABSENT,
        source: sourceDispatch(ligne.raison),
      });
    }
  });

  const comptes = new Map();
  let nonAttribues = 0;
  let absents = 0;
  for (const r of relectures.values()) {
    if (r.verdict === "absent") {
      absents += 1;
      continue;
    }
    let dispatch = null;
    for (const d of dispatchs) {
      if (r.session === null || d.session !== r.session || d.instant >= r.instant) continue;
      if (dispatch === null || d.instant >= dispatch.instant) dispatch = d;
    }
    if (dispatch === null) {
      nonAttribues += 1;
      continue;
    }
    const cle = [dispatch.agent, dispatch.modele, dispatch.source].join("\t");
    const compte = comptes.get(cle) ?? {
      agent: dispatch.agent,
      modele: dispatch.modele,
      source: dispatch.source,
      pret: 0,
      pasPret: 0,
    };
    if (r.verdict === "PRÊT") compte.pret += 1;
    else compte.pasPret += 1;
    comptes.set(cle, compte);
  }
  return { lignes: [...comptes.values()].sort(comparer), nonAttribues, absents, illisibles };
}

export function formaterBilan({ lignes, nonAttribues, absents, illisibles }) {
  const corps = lignes.map(({ agent, modele, source, pret, pasPret }) => {
    const taux = Math.round((100 * pasPret) / (pret + pasPret));
    return `| ${agent} | ${modele} | ${source} | ${String(pret)} | ${String(pasPret)} | ${String(taux)} % |`;
  });
  return [
    "| Agent | Modèle | Source | PRÊT | PAS PRÊT | Taux |",
    "|---|---|---|---|---|---|",
    ...corps,
    "",
    `verdicts non attribués : ${String(nonAttribues)}`,
    `verdicts absents : ${String(absents)}`,
    `lignes illisibles : ${String(illisibles)}`,
    "",
  ].join("\n");
}

function bilan(env) {
  const racine =
    typeof env.CLAUDE_PROJECT_DIR === "string" && env.CLAUDE_PROJECT_DIR !== ""
      ? env.CLAUDE_PROJECT_DIR
      : process.cwd();
  const chemin = path.join(racine, ".claude", "logs", "jev-model.jsonl");
  let texte;
  try {
    texte = fs.readFileSync(chemin, "utf8");
  } catch (e) {
    process.stderr.write(
      `Jev : journal absent ou illisible : ${chemin} (${e instanceof Error ? e.message : String(e)})\n`,
    );
    return 2;
  }
  const b = faireBilan(texte);
  if (b.illisibles > 0) {
    process.stderr.write(`Jev : ${String(b.illisibles)} ligne(s) illisible(s) dans ${chemin}\n`);
  }
  process.stdout.write(formaterBilan(b));
  return 0;
}

async function lireEntree() {
  const morceaux = [];
  for await (const morceau of process.stdin) morceaux.push(morceau);
  return Buffer.concat(morceaux).toString("utf8");
}

const USAGE =
  "usage : jev-cli.mjs niveau --role <agent de BANDES> < description\n" +
  "        jev-cli.mjs choix < '{\"etat\":\"…\",\"options\":{\"a\":\"…\",\"b\":\"…\"}}'\n" +
  "        jev-cli.mjs bilan\n";

async function main() {
  const [commande, option, role] = process.argv.slice(2);
  if (commande === "bilan" && option === undefined) return bilan(process.env);
  try {
    if (commande === "choix") {
      const texte = await lireEntree();
      let entree;
      try {
        entree = JSON.parse(texte);
      } catch {
        throw new Error("entrée illisible : JSON { etat, options } attendu sur stdin");
      }
      if (!estObjet(entree)) throw new Error("entrée illisible : JSON { etat, options } attendu sur stdin");
      const doublon = cleEnDouble(texte);
      if (doublon !== null) throw new Error(`entrée illisible : clé en double (${doublon})`);
      const r = await choisir({
        etat: entree.etat,
        options: entree.options,
        env: process.env,
        fetchFn: fetch,
      });
      if (r.tronque) {
        process.stderr.write(
          `Jev : état tronqué à ${String(ETAT_MAX)} caractères sur ${String(entree.etat.length)}, Jev n'a pas lu la suite\n`,
        );
      }
      if (r.aTrancher) {
        process.stderr.write(`Jev : repli (${r.raison}), l'agent garde son choix\n`);
      }
      process.stdout.write(`${JSON.stringify(r)}\n`);
      return 0;
    }
    if (commande !== "niveau" || option !== "--role") {
      process.stderr.write(USAGE);
      return 2;
    }
    const r = await noterTache({
      description: await lireEntree(),
      role,
      env: process.env,
      fetchFn: fetch,
    });
    if (r.aTrancher) {
      process.stderr.write(`Jev : repli (${r.raison}), ${role} garde ${BANDES[role].defaut ?? "le modèle de la session"}\n`);
    }
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`Jev : ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
