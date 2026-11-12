// Cœur du hook etat-job (ADR-0191) : résout la branche et l'issue d'une tâche
// native, tient l'instantané local d'une branche sous verrou, formate le
// commentaire d'état et l'ordre MCP, et lance le publieur détaché
// (lancerDetache : node seul, jamais un autre exécutable). Aucun accès réseau :
// seuls git local et le choix du script du publieur sont injectés par le point
// d'entrée.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as attendre } from "node:timers/promises";

// SF-37 : le dépôt GitHub de publication vient du projet consommateur, dans
// la variable d'environnement ETAT_JOB_DEPOT (« owner/repo ») — un
// consommateur publie l'état de SES tâches vers SON tracker. Absente ou
// vide : défaut Chewbee/Adonnante (la Phase B d'Adonnante). Mal formée :
// échec franc au chargement du hook, jamais de publication vers un dépôt
// deviné. Chaque hook est un processus frais : la lecture au chargement
// suffit, et DEPOT reste une constante pour tout le module.
export const DEPOT_DEFAUT = "Chewbee/Adonnante";

export function lireDepot(env = process.env) {
  const v = typeof env?.ETAT_JOB_DEPOT === "string" ? env.ETAT_JOB_DEPOT.trim() : "";
  if (v === "") return DEPOT_DEFAUT;
  if (!/^[\w.-]+\/[\w.-]+$/.test(v)) {
    throw new Error(`ETAT_JOB_DEPOT invalide : « ${v} » — attendu « owner/repo », par ex. Chewbee/Adonnante`);
  }
  return v;
}

export const DEPOT = lireDepot(process.env);
export const DELAI_VERROU_PERIME_MS = 5000;
const BUDGET_VERROU_MS = 6000;
// additionalContext est plafonné à 10 000 caractères (doc des hooks) ; le préfixe
// « etat-job : » et la marge de sécurité tiennent dans les 1 000 restants.
const LIMITE_ORDRE_MCP = 9000;
const PAS_VERROU_MS = 25;
const LONGUEUR_SESSION = 8;
const MOTIF_ISSUE_DANS_NOM = /^(feat|fix|chore|docs|recette)\/(\d+)-/;
const MOTIF_BRANCHE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const MOTIF_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MOTIF_SESSION = /^[A-Za-z0-9-]+$/;
const NIVEAUX = new Set(["mechanical", "standard", "frontier"]);
const STATUTS = new Set(["pending", "in_progress", "completed"]);
const BLOC_METADONNEES = /```json:metadata[ \t]*\r?\n([\s\S]*?)\r?\n```/;
const BLOC_ETAT = /```json\r?\n([\s\S]*?)\r?\n```/;

export class ErreurEtatJob extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ErreurEtatJob";
    this.code = code;
  }
}

function estObjet(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function marqueurEtat(branche) {
  return `<!-- etat-job branche=${branche} -->`;
}

export function nomFichierBranche(branche) {
  return branche.replaceAll("/", "-");
}

export function sessionCourte(sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new ErreurEtatJob("session-absente", "événement de hook sans session_id : état non publié");
  }
  // La session entre dans un nom de fichier (index-<session>.json).
  if (!MOTIF_SESSION.test(sessionId)) {
    throw new ErreurEtatJob("session-invalide", `session_id refusé : ${JSON.stringify(sessionId)}`);
  }
  return sessionId.slice(0, LONGUEUR_SESSION);
}

// Refuse aussi les noms dont le fichier entrerait en collision avec l'index,
// auth.json ou un fichier .publication.json (git refuse déjà le suffixe .lock).
// Ces noms réservés sont comparés sans casse : NTFS et APFS confondent AUTH et auth.
export function validerBranche(valeur) {
  const bas = typeof valeur === "string" ? valeur.toLowerCase() : "";
  const ok =
    typeof valeur === "string" &&
    MOTIF_BRANCHE.test(valeur) &&
    !valeur.includes("..") &&
    !valeur.endsWith("/") &&
    !bas.endsWith(".publication") &&
    !nomFichierBranche(bas).startsWith("index-") &&
    bas !== "auth";
  if (!ok) throw new ErreurEtatJob("branche-invalide", `nom de branche refusé : ${JSON.stringify(valeur)}`);
  return valeur;
}

export function validerIssue(valeur) {
  const n = typeof valeur === "string" && /^\d+$/.test(valeur) ? Number(valeur) : valeur;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    throw new ErreurEtatJob("issue-invalide", `numéro d'issue refusé : ${JSON.stringify(valeur)}`);
  }
  return n;
}

export function issueDepuisNom(branche) {
  const m = MOTIF_ISSUE_DANS_NOM.exec(branche);
  return m === null ? null : Number(m[2]);
}

export function lireMetadonnees(parametre, description) {
  if (estObjet(parametre)) return parametre;
  if (typeof description !== "string") return {};
  const m = BLOC_METADONNEES.exec(description);
  if (m === null) return {};
  let lu;
  try {
    lu = JSON.parse(m[1]);
  } catch {
    throw new ErreurEtatJob("metadonnees-illisibles", "bloc json:metadata illisible dans la description de la tâche");
  }
  if (!estObjet(lu)) throw new ErreurEtatJob("metadonnees-illisibles", "bloc json:metadata qui n'est pas un objet");
  return lu;
}

// Hypothèse H-A, mesurée par la tâche 1 du plan : la réponse de TaskCreate
// porte l'identifiant en task.id.
export function extraireIdCreation(reponse) {
  if (!estObjet(reponse) || !estObjet(reponse.task)) return null;
  const id = reponse.task.id;
  if (typeof id === "number" && Number.isInteger(id)) return String(id);
  return typeof id === "string" && id !== "" ? id : null;
}

function idValide(valeur) {
  const id = typeof valeur === "number" && Number.isInteger(valeur) ? String(valeur) : valeur;
  if (typeof id !== "string" || !MOTIF_ID.test(id)) {
    throw new ErreurEtatJob("id-invalide", `identifiant de tâche refusé : ${JSON.stringify(valeur)}`);
  }
  return id;
}

function sujetValide(valeur) {
  if (typeof valeur !== "string" || valeur === "") {
    throw new ErreurEtatJob("sujet-absent", "tâche créée sans sujet : état non publié");
  }
  return valeur;
}

export function normaliserEvenement(entree) {
  if (!estObjet(entree)) throw new ErreurEtatJob("entree-illisible", "événement de hook illisible : état non publié");
  if (entree.hook_event_name !== "PostToolUse" && entree.hook_event_name !== "TaskCreated") {
    throw new ErreurEtatJob("evenement-inattendu", `événement non géré : ${String(entree.hook_event_name)}`);
  }
  const session = sessionCourte(entree.session_id);
  if (typeof entree.cwd !== "string" || entree.cwd === "") {
    throw new ErreurEtatJob("cwd-absent", "événement de hook sans cwd : état non publié");
  }
  const cwd = entree.cwd;
  if (entree.hook_event_name === "TaskCreated") {
    return {
      type: "creation",
      session,
      id: idValide(entree.task_id),
      sujet: sujetValide(entree.task_subject),
      metadonnees: validerMetadonnees(lireMetadonnees(undefined, entree.task_description)),
      cwd,
    };
  }
  const outil = entree.tool_input;
  if (!estObjet(outil)) throw new ErreurEtatJob("entree-illisible", "tool_input absent : état non publié");
  if (entree.tool_name === "TaskCreate") {
    const id = extraireIdCreation(entree.tool_response);
    if (id === null) {
      throw new ErreurEtatJob("id-absent", "réponse de TaskCreate sans identifiant de tâche : état non publié");
    }
    return {
      type: "creation",
      session,
      id: idValide(id),
      sujet: sujetValide(outil.subject),
      metadonnees: validerMetadonnees(lireMetadonnees(outil.metadata, outil.description)),
      cwd,
    };
  }
  if (entree.tool_name === "TaskUpdate") {
    const statut = outil.status === undefined ? null : outil.status;
    if (statut !== null && statut !== "deleted" && !STATUTS.has(statut)) {
      throw new ErreurEtatJob("statut-invalide", `statut de tâche refusé : ${JSON.stringify(statut)}`);
    }
    return {
      type: "maj",
      session,
      id: idValide(outil.taskId),
      statut,
      sujet: typeof outil.subject === "string" && outil.subject !== "" ? outil.subject : null,
      metadonnees: estObjet(outil.metadata) ? validerMetadonnees(outil.metadata) : null,
      cwd,
    };
  }
  throw new ErreurEtatJob(
    "evenement-inattendu",
    `événement non géré : ${String(entree.hook_event_name)} ${String(entree.tool_name)}`,
  );
}

// Ordre de la spec : index (seul pour un TaskUpdate), métadonnées, branche du
// cwd et numéro dans son nom, git config branch.<b>.issue.
export function resoudreCible({ evenement, index, git }) {
  if (evenement.type === "maj") {
    if (!Object.hasOwn(index, evenement.id)) {
      throw new ErreurEtatJob(
        "tache-inconnue",
        `état non publié : tâche ${evenement.id} inconnue de l'index de la session ${evenement.session} (créée avant le hook, ou création non rattachée à une issue)`,
      );
    }
    const connue = index[evenement.id];
    if (!estObjet(connue)) throw new ErreurEtatJob("index-illisible", `entrée d'index illisible pour la tâche ${evenement.id}`);
    return { branche: validerBranche(connue.branche), issue: validerIssue(connue.issue) };
  }
  const m = evenement.metadonnees;
  let branche;
  if (m.branche === undefined) {
    const courante = git.brancheCourante(evenement.cwd);
    if (courante === null) {
      throw new ErreurEtatJob("branche-absente", `état non publié : aucune branche pour ${evenement.cwd} (HEAD détachée ou hors dépôt)`);
    }
    branche = validerBranche(courante);
  } else {
    branche = validerBranche(m.branche);
  }
  if (m.issue !== undefined) return { branche, issue: validerIssue(m.issue) };
  const duNom = issueDepuisNom(branche);
  if (duNom !== null) return { branche, issue: validerIssue(duNom) };
  const configuree = git.issueConfiguree(evenement.cwd, branche);
  if (configuree !== null) return { branche, issue: validerIssue(configuree) };
  throw new ErreurEtatJob("aucune-issue", `état non publié : aucune issue liée à ${branche}`);
}

// Une clé absente ou nulle (effacement de la clé) est permise ; une clé
// présente et invalide est refusée, jamais ramenée à null en silence.
function validerMetadonnees(m) {
  const presente = (cle) => m[cle] !== undefined && m[cle] !== null;
  const refus = (cle) =>
    new ErreurEtatJob("metadonnees-invalides", `métadonnée ${cle} refusée : ${JSON.stringify(m[cle])}`);
  if (presente("modelTier") && !NIVEAUX.has(m.modelTier)) throw refus("modelTier");
  if (presente("model") && (typeof m.model !== "string" || m.model === "")) throw refus("model");
  if (presente("userGate") && typeof m.userGate !== "boolean") throw refus("userGate");
  return m;
}

function champsMetadonnees(m) {
  return {
    niveau: m.modelTier ?? null,
    modele: m.model ?? null,
    porte: m.userGate === true || (Array.isArray(m.tags) && m.tags.includes("user-gate")),
  };
}

function fusionnerMetadonnees(tache, m) {
  const lus = champsMetadonnees(m);
  return {
    niveau: Object.hasOwn(m, "modelTier") ? lus.niveau : tache.niveau,
    modele: Object.hasOwn(m, "model") ? lus.modele : tache.modele,
    porte: Object.hasOwn(m, "userGate") || Object.hasOwn(m, "tags") ? lus.porte : tache.porte,
  };
}

export function appliquerEvenement({ instantane, evenement, cible, environnement, maintenant }) {
  const base = instantane ?? {
    version: 1,
    seq: 0,
    branche: cible.branche,
    issue: cible.issue,
    session: environnement,
    maj: "",
    taches: [],
  };
  // Deux branches peuvent partager un fichier (feat/a-b et feat-a/b), et une
  // tâche peut porter une autre issue que celle de sa branche : refus, jamais
  // de bascule silencieuse de l'instantané.
  if (base.branche !== cible.branche || base.issue !== cible.issue) {
    throw new ErreurEtatJob(
      "cible-incoherente",
      `état non publié : l'instantané lu appartient à ${base.branche} (#${String(base.issue)}), pas à ${cible.branche} (#${String(cible.issue)})`,
    );
  }
  const meme = (t) => t.session === evenement.session && t.id === evenement.id;
  let taches;
  if (evenement.type === "creation") {
    const tache = {
      session: evenement.session,
      id: evenement.id,
      sujet: evenement.sujet,
      statut: "pending",
      ...champsMetadonnees(evenement.metadonnees),
    };
    taches = [...base.taches.filter((t) => !meme(t)), tache];
  } else {
    if (!base.taches.some(meme)) {
      throw new ErreurEtatJob("tache-absente", `tâche ${evenement.id} absente de l'instantané de ${cible.branche}`);
    }
    taches =
      evenement.statut === "deleted"
        ? base.taches.filter((t) => !meme(t))
        : base.taches.map((t) => {
            if (!meme(t)) return t;
            return {
              ...t,
              statut: evenement.statut ?? t.statut,
              sujet: evenement.sujet ?? t.sujet,
              ...(evenement.metadonnees === null ? {} : fusionnerMetadonnees(t, evenement.metadonnees)),
            };
          });
  }
  return {
    ...base,
    seq: base.seq + 1,
    session: environnement,
    maj: maintenant().toISOString(),
    taches,
  };
}

function estTache(t) {
  return (
    estObjet(t) &&
    typeof t.session === "string" &&
    typeof t.id === "string" &&
    typeof t.sujet === "string" &&
    STATUTS.has(t.statut) &&
    (t.niveau === null || NIVEAUX.has(t.niveau)) &&
    (t.modele === null || typeof t.modele === "string") &&
    typeof t.porte === "boolean"
  );
}

export function validerInstantane(v) {
  const ok =
    estObjet(v) &&
    v.version === 1 &&
    Number.isInteger(v.seq) &&
    v.seq >= 0 &&
    typeof v.branche === "string" &&
    Number.isInteger(v.issue) &&
    v.issue > 0 &&
    typeof v.session === "string" &&
    typeof v.maj === "string" &&
    (v.amorce === undefined || v.amorce === true) &&
    Array.isArray(v.taches) &&
    v.taches.every(estTache);
  if (!ok) throw new ErreurEtatJob("instantane-illisible", "instantané d'état illisible (version, champs ou tâches)");
  return v;
}

// amorce est un état local du publieur : il ne part jamais sur GitHub.
function versPublication(i) {
  return { version: i.version, seq: i.seq, branche: i.branche, issue: i.issue, session: i.session, maj: i.maj, taches: i.taches };
}

export function corpsCommentaire(instantane) {
  return `${marqueurEtat(instantane.branche)}\n\`\`\`json\n${JSON.stringify(versPublication(instantane))}\n\`\`\`\n`;
}

export function lireCorpsCommentaire(corps, branche) {
  if (typeof corps !== "string" || !corps.startsWith(marqueurEtat(branche))) {
    throw new ErreurEtatJob("marqueur-absent", `le corps ne commence pas par ${marqueurEtat(branche)}`);
  }
  const m = BLOC_ETAT.exec(corps);
  if (m === null) throw new ErreurEtatJob("instantane-illisible", "commentaire d'état sans bloc json");
  let lu;
  try {
    lu = JSON.parse(m[1]);
  } catch {
    throw new ErreurEtatJob("instantane-illisible", "commentaire d'état au JSON invalide");
  }
  const inst = validerInstantane(lu);
  if (inst.branche !== branche) throw new ErreurEtatJob("instantane-illisible", "branche du JSON différente du marqueur");
  return inst;
}

export function lienSuivant(lien) {
  if (lien === null) return null;
  for (const partie of lien.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(partie);
    if (m !== null) return m[1];
  }
  return null;
}

export function environnement(env) {
  return `${env.CLAUDE_CODE_REMOTE === "true" ? "cloud" : "local"}:${os.hostname()}`;
}

// En cloud, le fetch de Node du publieur ne suit HTTPS_PROXY qu'avec
// NODE_USE_ENV_PROXY=1 ; sans ce chemin, GitHub rend 401 (ADR-0191). Le drapeau
// tait le seul avertissement « EnvHttpProxyAgent is experimental », écrit sinon
// dans etat-job-publieur.log à chaque lancement. Sans HTTPS_PROXY, ou hors cloud,
// l'environnement reste tel quel : le 401 puis l'ordre MCP jouent comme avant.
const DRAPEAU_EHPA = "--disable-warning=UNDICI-EHPA";

export function envPublieur(env) {
  const proxy = [env.HTTPS_PROXY, env.https_proxy].some((v) => typeof v === "string" && v !== "");
  if (env.CLAUDE_CODE_REMOTE !== "true" || !proxy) return env;
  const options = typeof env.NODE_OPTIONS === "string" ? env.NODE_OPTIONS.trim() : "";
  const avecDrapeau = options.split(/\s+/).includes(DRAPEAU_EHPA)
    ? options
    : [options, DRAPEAU_EHPA].filter((o) => o !== "").join(" ");
  return { ...env, NODE_USE_ENV_PROXY: "1", NODE_OPTIONS: avecDrapeau };
}

export function cheminsCommuns(racine) {
  const dossier = path.join(racine, ".claude", "logs", "etat-job");
  return { dossier, auth: path.join(dossier, "auth.json"), verrouAuth: path.join(dossier, "auth.lock") };
}

export function cheminsSession(racine, session) {
  const { dossier } = cheminsCommuns(racine);
  return { index: path.join(dossier, `index-${session}.json`), verrouIndex: path.join(dossier, `index-${session}.lock`) };
}

export function cheminsBranche(racine, branche) {
  const { dossier } = cheminsCommuns(racine);
  const nom = nomFichierBranche(branche);
  return {
    instantane: path.join(dossier, `${nom}.json`),
    verrou: path.join(dossier, `${nom}.lock`),
    publication: path.join(dossier, `${nom}.publication.json`),
    ordre: path.join(dossier, `${nom}.ordre.md`),
  };
}

export function lireJson(chemin) {
  let texte;
  try {
    texte = fs.readFileSync(chemin, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurEtatJob("json-illisible", `fichier JSON illisible : ${chemin}`);
  }
}

export function ecrireTexteAtomique(chemin, texte) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const provisoire = `${chemin}.${String(process.pid)}.tmp`;
  fs.writeFileSync(provisoire, texte);
  fs.renameSync(provisoire, chemin);
}

export function ecrireJsonAtomique(chemin, valeur) {
  ecrireTexteAtomique(chemin, `${JSON.stringify(valeur, null, 2)}\n`);
}

function aLeCode(err, code) {
  return err instanceof Error && "code" in err && err.code === code;
}

// Jeton et date de modification lus sur un même descripteur, donc sur un même
// fichier ; null si le verrou a disparu.
function lireVerrou(chemin) {
  let fd;
  try {
    fd = fs.openSync(chemin, "r");
  } catch (err) {
    if (aLeCode(err, "ENOENT")) return null;
    throw err;
  }
  try {
    return { jeton: fs.readFileSync(fd, "utf8"), mtimeMs: fs.fstatSync(fd).mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}

function prendreVerrou(chemin, jeton) {
  try {
    fs.writeFileSync(chemin, jeton, { flag: "wx" });
    return true;
  } catch (err) {
    if (aLeCode(err, "EEXIST")) return false;
    throw err;
  }
}

// Réclamation d'un verrou périmé (modèle : scripts/verrou-binaire.mjs,
// acquerirVerrou et restaurer). Le rename vers un nom unique désigne un seul
// gagnant, qui relit le fichier pris : si ce n'est plus celui jugé périmé (un
// tiers l'a remplacé entre-temps), il le remet en place au lieu de l'effacer.
function reclamerPerime(chemin, vu, { maintenant, journaliser }) {
  const reclame = `${chemin}.perime-${randomUUID()}`;
  try {
    fs.renameSync(chemin, reclame);
  } catch (err) {
    if (aLeCode(err, "ENOENT")) return;
    throw err;
  }
  const pris = lireVerrou(reclame);
  fs.rmSync(reclame, { force: true });
  const date = maintenant().toISOString();
  const verrou = path.basename(chemin);
  if (pris !== null && (pris.jeton !== vu.jeton || pris.mtimeMs !== vu.mtimeMs)) {
    try {
      fs.writeFileSync(chemin, pris.jeton, { flag: "wx" });
    } catch (err) {
      // EPERM : même cause que dans prendreVerrou (delete pending sous Windows).
      if (!aLeCode(err, "EEXIST") && !aLeCode(err, "EPERM")) throw err;
      journaliser({ date, evenement: "verrou-perdu", verrou, detenteur: pris.jeton.trim() });
    }
    return;
  }
  journaliser({ date, evenement: "verrou-perime-casse", verrou, ageMs: maintenant().getTime() - vu.mtimeMs });
}

// Ne libère que le verrou qui porte notre jeton. Sinon (il a été réclamé comme
// périmé), le journal le dit et le verrou du successeur reste en place.
function libererVerrou(chemin, jeton, { maintenant, journaliser }) {
  const lu = lireVerrou(chemin);
  if (lu !== null && lu.jeton === jeton) {
    fs.rmSync(chemin, { force: true });
    return;
  }
  journaliser({
    date: maintenant().toISOString(),
    evenement: "verrou-non-libere",
    verrou: path.basename(chemin),
    detenteur: lu === null ? null : lu.jeton.trim(),
  });
}

// Verrou par création exclusive, chaque prise portant un jeton unique (pid,
// date, aléa). Un verrou plus vieux que 5 s est réclamé et journalisé.
// Limites assumées : un détenteur qui garde la main plus de 5 s (veille,
// antivirus) perd l'exclusivité, sans effacer le verrou de son successeur ; la
// libération relit puis efface, et un verrou de plus de 5 s réclamé puis repris
// entre ces deux appels serait effacé à tort.
export async function avecVerrou(chemin, action, { maintenant, journaliser, budgetMs = BUDGET_VERROU_MS }) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const jeton = `${String(process.pid)} ${maintenant().toISOString()} ${randomUUID()}\n`;
  // Le budget suit l'horloge du processus, jamais l'horloge injectée (figée en test).
  const debut = performance.now();
  // Sous Windows, un verrou « delete pending » refuse création et lecture en EPERM, un dossier
  // refusé en écriture aussi : l'erreur est gardée, jamais avalée, pour la dire à l'échéance.
  let refus = null;
  let verrouLu = false;
  for (;;) {
    let epermIci = false;
    const sansEperm = (essai, defaut) => {
      try {
        return essai();
      } catch (err) {
        if (!aLeCode(err, "EPERM")) throw err;
        epermIci = true;
        refus = err;
        return defaut;
      }
    };
    if (sansEperm(() => prendreVerrou(chemin, jeton), false)) {
      try {
        return await action();
      } finally {
        libererVerrou(chemin, jeton, { maintenant, journaliser });
      }
    }
    const vu = sansEperm(() => lireVerrou(chemin), null);
    if (vu !== null) {
      verrouLu = true;
      if (maintenant().getTime() - vu.mtimeMs > DELAI_VERROU_PERIME_MS) {
        sansEperm(() => reclamerPerime(chemin, vu, { maintenant, journaliser }), undefined);
        if (!epermIci) continue;
      }
    }
    if (performance.now() - debut > budgetMs) {
      if (refus !== null && !verrouLu) {
        throw new ErreurEtatJob("verrou-refuse", `verrou ${path.basename(chemin)} inaccessible : ${refus.message}`);
      }
      // Verrou lu, donc tenu : s'il y a eu un EPERM pendant l'attente (rename d'un verrou
      // périmé refusé, création refusée), le dernier est cité, même ancien.
      const cause = refus === null ? "" : ` (dernier refus : ${refus.message})`;
      throw new ErreurEtatJob(
        "verrou-occupe",
        `verrou ${path.basename(chemin)} occupé depuis plus de ${String(budgetMs)} ms${cause}`,
      );
    }
    // Relance immédiate seulement si le verrou vient de disparaître (ENOENT) ; sur EPERM, on attend.
    if (vu === null && !epermIci) continue;
    await attendre(PAS_VERROU_MS);
  }
}

// Au-delà de LIMITE_ORDRE_MCP, le corps ne tient plus dans additionalContext :
// il est écrit dans un fichier que l'agent lit avec l'outil Read.
export function ordreMcp(instantane, racine) {
  const corps = corpsCommentaire(instantane);
  const ordre = (publication) =>
    [
      `la publication par l'API GitHub a rendu 401 dans cette session ; publie l'état de ${instantane.branche} toi-même par l'outil MCP GitHub, dépôt ${DEPOT}, issue #${String(instantane.issue)} :`,
      // issue_write remplace toute la liste : `en-cours` écrit seul effacerait les autres labels.
      "1. lis d'abord les labels actuels de l'issue par l'outil MCP de lecture d'issue ; si `en-cours` manque, écris avec `issue_write` la liste complète : labels existants plus `en-cours`, jamais `en-cours` seul ;",
      // Aucun outil MCP ne supprime un commentaire : le publieur local supprime les doublons.
      `2. liste les commentaires de l'issue dont le corps commence par \`${marqueurEtat(instantane.branche)}\` ; mets à jour le plus ancien avec le corps à publier ci-dessous (\`update_issue_comment\`), ou crée-en un s'il n'y en a aucun ; n'en crée jamais un second ; les doublons éventuels seront supprimés par le publieur local au passage suivant.`,
      ...publication,
    ].join("\n");
  const enLigne = ordre(["Corps à publier, tel quel :", corps]);
  if (enLigne.length <= LIMITE_ORDRE_MCP) return enLigne;
  const fichierOrdre = cheminsBranche(racine, instantane.branche).ordre;
  ecrireTexteAtomique(fichierOrdre, corps);
  return ordre([`Corps à publier : lis le fichier ${fichierOrdre} avec l'outil Read, puis publie son contenu tel quel.`]);
}

function lireIndex(chemin) {
  const lu = lireJson(chemin);
  if (lu === null) return {};
  if (!estObjet(lu)) throw new ErreurEtatJob("index-illisible", `index de session illisible : ${chemin}`);
  return lu;
}

function sessionMarquee401(chemin, session) {
  const lu = lireJson(chemin);
  if (lu === null) return false;
  if (!estObjet(lu)) throw new ErreurEtatJob("auth-illisible", `fichier illisible : ${chemin}`);
  return Object.hasOwn(lu, session);
}

function dernierEchec(chemin, branche) {
  const lu = lireJson(chemin);
  if (lu === null) return null;
  if (!estObjet(lu) || typeof lu.ok !== "boolean" || !Number.isInteger(lu.seq)) {
    throw new ErreurEtatJob("publication-illisible", `résultat de publication illisible : ${chemin}`);
  }
  if (lu.ok) return null;
  if (typeof lu.raison !== "string" || lu.raison === "") {
    throw new ErreurEtatJob("publication-illisible", `résultat de publication illisible (raison absente) : ${chemin}`);
  }
  return `dernière publication de ${branche} en échec (seq ${String(lu.seq)}) : ${lu.raison}`;
}

export async function traiterEvenement({ entree, racine, env, git, lancerPublieur, maintenant, journaliser }) {
  const evenement = normaliserEvenement(entree);
  const options = { maintenant, journaliser };
  const s = cheminsSession(racine, evenement.session);
  // Les appels git (2 s de délai chacun) se font avant le verrou d'index : sous
  // verrou, deux appels approcheraient sa péremption (5 s). Seule une création
  // interroge git ; une mise à jour suit l'index et n'appelle pas git.
  let cible;
  if (evenement.type === "creation") {
    cible = resoudreCible({ evenement, index: {}, git });
    await avecVerrou(
      s.verrouIndex,
      () => {
        ecrireJsonAtomique(s.index, { ...lireIndex(s.index), [evenement.id]: cible });
      },
      options,
    );
  } else {
    cible = await avecVerrou(s.verrouIndex, () => resoudreCible({ evenement, index: lireIndex(s.index), git }), options);
  }
  const b = cheminsBranche(racine, cible.branche);
  const commun = cheminsCommuns(racine);
  // auth.json et publication.json se lisent sous le verrou sous lequel le
  // publieur les remplace par rename (sous Windows, un rename sur un fichier
  // ouvert ailleurs peut échouer). auth.json se lit avant le verrou de la
  // branche, jamais sous lui : aucun processus ne tient deux verrous, et
  // l'attente d'un auth.lock orphelin (5 s) ne fait pas vieillir le verrou de la
  // branche jusqu'à sa péremption. Une erreur de lecture n'est levée qu'après
  // l'écriture de l'instantané : l'événement n'est pas perdu.
  let marque;
  try {
    marque = { marquee: await avecVerrou(commun.verrouAuth, () => sessionMarquee401(commun.auth, evenement.session), options), erreur: null };
  } catch (err) {
    marque = { marquee: false, erreur: err };
  }
  // L'ordre MCP se calcule sous le même verrou : son fichier suit l'ordre des instantanés.
  const ordre = await avecVerrou(
    b.verrou,
    () => {
      const lu = lireJson(b.instantane);
      const suivant = appliquerEvenement({
        instantane: lu === null ? null : validerInstantane(lu),
        evenement,
        cible,
        environnement: environnement(env),
        maintenant,
      });
      ecrireJsonAtomique(b.instantane, suivant);
      if (marque.erreur !== null) throw marque.erreur;
      return marque.marquee ? ordreMcp(suivant, racine) : null;
    },
    options,
  );
  if (ordre !== null) return { message: ordre };
  lancerPublieur(cible.branche, evenement.session);
  return { message: await avecVerrou(b.verrou, () => dernierEchec(b.publication, cible.branche), options) };
}

function contexte(hookEventName, message) {
  return { hookSpecificOutput: { hookEventName, additionalContext: `etat-job : ${message}` } };
}

// brut : texte reçu sur stdin. Rend { sortie, diagnostic }. Ne lève pas :
// toute erreur devient un message à l'agent, journalisé (CLAUDE.md §8).
export async function traiter({ brut, racine, env, git, lancerPublieur, maintenant, journaliser }) {
  let entree;
  try {
    entree = JSON.parse(brut);
  } catch {
    const message = "entrée de hook illisible, état non publié";
    journaliser({ date: maintenant().toISOString(), message });
    return { sortie: contexte("PostToolUse", message), diagnostic: message };
  }
  const evenementHook = estObjet(entree) && typeof entree.hook_event_name === "string" ? entree.hook_event_name : "PostToolUse";
  const sessionId = estObjet(entree) && typeof entree.session_id === "string" ? entree.session_id : null;
  try {
    const { message } = await traiterEvenement({ entree, racine, env, git, lancerPublieur, maintenant, journaliser });
    if (message === null) return { sortie: null, diagnostic: null };
    journaliser({ date: maintenant().toISOString(), session_id: sessionId, message });
    return { sortie: contexte(evenementHook, message), diagnostic: null };
  } catch (err) {
    const typee = err instanceof ErreurEtatJob;
    const message = typee ? err.message : `erreur interne : ${err instanceof Error ? err.message : String(err)}`;
    journaliser({ date: maintenant().toISOString(), session_id: sessionId, code: typee ? err.code : "erreur-interne", message });
    return { sortie: contexte(evenementHook, message), diagnostic: typee ? null : message };
  }
}

// Lance `node script ...args` détaché : la main est rendue sans l'attendre. Son
// stderr va dans fichierErreurs (ouvert en ajout) : avec stdio « ignore », un
// publieur qui plante au chargement ne laisserait aucune trace. Si spawn échoue
// (cwd absent, exécutable introuvable), pid reste undefined et la cause n'arrive
// qu'au tick suivant : l'erreur est levée tout de suite pour qu'un message atteigne
// l'agent, et le handler error journalise la cause.
export function lancerDetache({ script, args, cwd, env, fichierErreurs, journaliser, maintenant }) {
  fs.mkdirSync(path.dirname(fichierErreurs), { recursive: true });
  const erreurs = fs.openSync(fichierErreurs, "a");
  let enfant;
  try {
    enfant = spawn(process.execPath, [script, ...args], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", erreurs],
      windowsHide: true,
      env,
    });
  } finally {
    // Le processus enfant a sa propre copie du descripteur.
    fs.closeSync(erreurs);
  }
  enfant.on("error", (err) => {
    journaliser({ date: maintenant().toISOString(), evenement: "publieur-non-lance", args, raison: err.message });
  });
  if (enfant.pid === undefined) {
    throw new ErreurEtatJob("publieur-non-lance", `état non publié : le publieur n'a pas démarré (${script})`);
  }
  enfant.unref();
}
