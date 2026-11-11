// Cœur du publieur détaché d'etat-job (ADR-0191) : lit les commentaires
// marqués, amorce une fois, publie l'instantané le plus récent sur le plus
// ancien commentaire marqué, supprime les doublons et pose en-cours. fetch
// est injecté (creerClient) pour les tests.
import { setTimeout as attendre } from "node:timers/promises";
import {
  avecVerrou,
  cheminsBranche,
  cheminsCommuns,
  corpsCommentaire,
  DEPOT,
  ErreurEtatJob,
  ecrireJsonAtomique,
  lienSuivant,
  lireCorpsCommentaire,
  lireJson,
  marqueurEtat,
  validerBranche,
  validerInstantane,
} from "./etat-job-core.mjs";

const API = "https://api.github.com";
const DELAI_APPEL_MS = 3000;
const PAUSE_REESSAI_MS = 1000;
const TAILLE_MAX_CORPS = 65536;
const LABEL = "en-cours";
export const MAX_ECHECS_PAR_SEQ = 2;
// Forme que produit sessionCourte (etat-job-core.mjs) : 1 à 8 caractères.
const MOTIF_SESSION_COURTE = /^[A-Za-z0-9-]{1,8}$/;

// Arguments du point d'entrée : node etat-job-publier.mjs <branche> <session>,
// tels que le hook les passe (lancerPublieur(cible.branche, evenement.session)).
export function validerArguments([branche, session]) {
  const valide = validerBranche(branche);
  if (typeof session !== "string" || !MOTIF_SESSION_COURTE.test(session)) {
    throw new ErreurEtatJob("session-invalide", `session refusée : ${JSON.stringify(session) ?? "absente"}`);
  }
  return { branche: valide, session };
}

export class ErreurGithub extends Error {
  constructor(statut, message) {
    super(message);
    this.name = "ErreurGithub";
    this.statut = statut;
  }
}

export function creerClient({ jeton, fetchFn, delaiMs = DELAI_APPEL_MS }) {
  async function requete(methode, chemin, corps) {
    // Le lien next vient d'une réponse : hors de l'API, le jeton ne part pas.
    const url = chemin.startsWith("/") ? `${API}${chemin}` : chemin;
    if (!url.startsWith(`${API}/`)) {
      throw new ErreurGithub(0, `${methode} ${chemin} : URL hors de l'API GitHub, jeton non envoyé`);
    }
    const entetes = {
      Authorization: `Bearer ${jeton}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "adonnante-etat-job",
    };
    if (corps !== undefined) entetes["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetchFn(url, {
        method: methode,
        headers: entetes,
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(delaiMs),
      });
    } catch (err) {
      throw new ErreurGithub(0, `${methode} ${chemin} : réseau (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new ErreurGithub(res.status, `${methode} ${chemin} : HTTP ${String(res.status)}`);
    let donnees = null;
    if (res.status !== 204) {
      try {
        donnees = await res.json();
      } catch {
        throw new ErreurGithub(res.status, `${methode} ${chemin} : réponse non JSON`);
      }
    }
    return { donnees, lien: res.headers.get("link") };
  }
  return { requete };
}

export async function listerCommentairesMarques(client, issue, branche) {
  const marqueur = marqueurEtat(branche);
  const tous = [];
  let chemin = `/repos/${DEPOT}/issues/${String(issue)}/comments?per_page=100`;
  while (chemin !== null) {
    const { donnees, lien } = await client.requete("GET", chemin);
    if (!Array.isArray(donnees) || !donnees.every((c) => Number.isInteger(c?.id) && typeof c.body === "string")) {
      throw new ErreurGithub(0, "liste de commentaires illisible");
    }
    tous.push(...donnees);
    chemin = lienSuivant(lien);
  }
  return tous.filter((c) => c.body.startsWith(marqueur)).sort((a, b) => a.id - b.id);
}

export function fusionnerAmorce(local, distant, maintenant) {
  const cle = (t) => `${t.session}\u0000${t.id}`;
  const presentes = new Set(local.taches.map(cle));
  const ajoutees = distant === null ? [] : distant.taches.filter((t) => !presentes.has(cle(t)));
  return { ...local, seq: local.seq + 1, maj: maintenant().toISOString(), amorce: true, taches: [...ajoutees, ...local.taches] };
}

// Deux branches peuvent partager un fichier (feat/a-b et feat-a/b) : un
// instantané d'une autre branche est refusé, jamais publié sous ce marqueur.
function lireInstantaneLocal(chemin, branche) {
  const lu = lireJson(chemin);
  if (lu === null) throw new ErreurEtatJob("instantane-absent", `instantané absent : ${chemin}`);
  const instantane = validerInstantane(lu);
  if (instantane.branche !== branche) {
    throw new ErreurEtatJob("cible-incoherente", `rien publié : l'instantané lu appartient à ${instantane.branche}, pas à ${branche}`);
  }
  return instantane;
}

// Le hook remplace l'instantané par rename sous le verrou de la branche. Sous
// Windows, ce rename peut échouer (EPERM) si un autre processus a le fichier
// ouvert : le publieur ne le lit donc que sous ce même verrou.
function lireInstantaneVerrouille(c, branche, options) {
  return avecVerrou(c.verrou, () => lireInstantaneLocal(c.instantane, branche), options);
}

// L'échec nomme le commentaire distant illisible : il se corrige à la main.
function lireCommentaireEtat(commentaire, branche) {
  try {
    return lireCorpsCommentaire(commentaire.body, branche);
  } catch (err) {
    if (!(err instanceof ErreurEtatJob)) throw err;
    throw new ErreurEtatJob("distant-illisible", `commentaire d'état distant ${String(commentaire.id)} illisible : ${err.message}`);
  }
}

async function poserLabelSiAbsent(client, issue) {
  const { donnees } = await client.requete("GET", `/repos/${DEPOT}/issues/${String(issue)}`);
  if (!Array.isArray(donnees?.labels) || !donnees.labels.every((l) => typeof l?.name === "string")) {
    throw new ErreurGithub(0, "issue illisible (labels)");
  }
  if (!donnees.labels.some((l) => l.name === LABEL)) {
    await client.requete("POST", `/repos/${DEPOT}/issues/${String(issue)}/labels`, { labels: [LABEL] });
  }
}

// Lit les commentaires marqués, puis amorce au premier passage ; rend
// l'instantané à envoyer, dont le seq est celui de la tentative. Lève si une
// étape échoue : rien n'est publié sans avoir lu l'état distant.
async function preparerEnvoi({ client, c, lu, branche, options }) {
  const marques = await listerCommentairesMarques(client, lu.issue, branche);
  if (lu.amorce === true) return { instantane: lu, marques };
  const distant = marques.length === 0 ? null : lireCommentaireEtat(marques[0], branche);
  const instantane = await avecVerrou(
    c.verrou,
    () => {
      // amorce est relu sous le verrou : un autre publieur a pu amorcer
      // pendant la lecture réseau, et une seconde fusion ressusciterait une
      // tâche supprimée entre-temps.
      const relu = lireInstantaneLocal(c.instantane, branche);
      if (relu.amorce === true) return relu;
      const fusionne = fusionnerAmorce(relu, distant, options.maintenant);
      ecrireJsonAtomique(c.instantane, fusionne);
      return fusionne;
    },
    options,
  );
  return { instantane, marques };
}

// PATCH du plus ancien commentaire marqué, ou POST ; doublons supprimés (404 =
// succès) ; en-cours posé s'il manque.
async function envoyer(client, instantane, marques) {
  const corps = corpsCommentaire(instantane);
  if (corps.length > TAILLE_MAX_CORPS) {
    throw new ErreurEtatJob("corps-trop-long", `commentaire d'état de ${String(corps.length)} caractères (> ${String(TAILLE_MAX_CORPS)})`);
  }
  if (marques.length === 0) {
    await client.requete("POST", `/repos/${DEPOT}/issues/${String(instantane.issue)}/comments`, { body: corps });
  } else {
    await client.requete("PATCH", `/repos/${DEPOT}/issues/comments/${String(marques[0].id)}`, { body: corps });
  }
  for (const doublon of marques.slice(1)) {
    try {
      await client.requete("DELETE", `/repos/${DEPOT}/issues/comments/${String(doublon.id)}`);
    } catch (err) {
      if (!(err instanceof ErreurGithub && err.statut === 404)) throw err;
    }
  }
  await poserLabelSiAbsent(client, instantane.issue);
}

// Écrit le résultat pour le hook suivant ; n'écrase jamais un résultat d'un
// seq plus récent.
export async function ecrireResultat({ racine, branche, resultat, maintenant, journaliser }) {
  const c = cheminsBranche(racine, branche);
  await avecVerrou(
    c.verrou,
    () => {
      const lu = lireJson(c.publication);
      if (lu !== null && typeof lu === "object" && Number.isInteger(lu.seq) && lu.seq > resultat.seq) return;
      ecrireJsonAtomique(c.publication, { ...resultat, date: maintenant().toISOString() });
    },
    { maintenant, journaliser },
  );
}

async function marquer401({ racine, session, branche, maintenant, journaliser }) {
  const c = cheminsCommuns(racine);
  await avecVerrou(
    c.verrouAuth,
    () => {
      const lu = lireJson(c.auth);
      if (lu !== null && (typeof lu !== "object" || Array.isArray(lu))) {
        throw new ErreurEtatJob("auth-illisible", `fichier illisible : ${c.auth}`);
      }
      ecrireJsonAtomique(c.auth, { ...(lu ?? {}), [session]: { statut: 401, date: maintenant().toISOString(), branche } });
    },
    { maintenant, journaliser },
  );
  journaliser({ date: maintenant().toISOString(), evenement: "publication-401", session, branche });
}

// Boucle : un publieur ne s'arrête sur un succès que si le seq envoyé est
// encore le seq local ; après deux échecs pour un même seq, il s'arrête. Le seq
// tenté est celui qui part : l'amorce l'augmente avant l'envoi. Une erreur hors
// envoi (fichier local, verrou) est écrite dans publication.json au dernier seq
// connu (-1 avant toute lecture), pour que le hook suivant la rapporte.
export async function executerPublieur({ client, racine, branche, session, maintenant, journaliser, pauseMs = PAUSE_REESSAI_MS }) {
  const c = cheminsBranche(racine, branche);
  const options = { maintenant, journaliser };
  let tente = -1;
  let seqCompte = null;
  let echecs = 0;
  try {
    for (;;) {
      const lu = await lireInstantaneVerrouille(c, branche, options);
      tente = lu.seq;
      let raison = null;
      try {
        const { instantane, marques } = await preparerEnvoi({ client, c, lu, branche, options });
        tente = instantane.seq;
        await envoyer(client, instantane, marques);
      } catch (err) {
        if (err instanceof ErreurGithub && err.statut === 401) {
          await marquer401({ racine, session, branche, maintenant, journaliser });
          await ecrireResultat({
            racine,
            branche,
            resultat: { seq: tente, ok: false, raison: "HTTP 401 : publication confiée à l'agent par l'outil MCP" },
            maintenant,
            journaliser,
          });
          return "401";
        }
        raison = err instanceof Error ? err.message : String(err);
      }
      if (tente !== seqCompte) {
        seqCompte = tente;
        echecs = 0;
      }
      if (raison !== null) {
        echecs += 1;
        journaliser({ date: maintenant().toISOString(), evenement: "publication-echec", branche, seq: tente, echecs, raison });
      }
      const apres = (await lireInstantaneVerrouille(c, branche, options)).seq;
      if (apres !== tente) continue;
      if (raison === null) {
        await ecrireResultat({ racine, branche, resultat: { seq: tente, ok: true, raison: null }, maintenant, journaliser });
        return "ok";
      }
      if (echecs >= MAX_ECHECS_PAR_SEQ) {
        await ecrireResultat({ racine, branche, resultat: { seq: tente, ok: false, raison }, maintenant, journaliser });
        journaliser({ date: maintenant().toISOString(), evenement: "publication-abandon", branche, seq: tente, raison });
        return "echec";
      }
      await attendre(pauseMs);
    }
  } catch (err) {
    const raison = `panne du publieur : ${err instanceof Error ? err.message : String(err)}`;
    journaliser({ date: maintenant().toISOString(), evenement: "publication-panne", branche, seq: tente, raison });
    await ecrireResultat({ racine, branche, resultat: { seq: tente, ok: false, raison }, maintenant, journaliser });
    return "echec";
  }
}

// Jeton absent : l'échec est écrit au seq de l'instantané courant, pour qu'il
// remplace un succès antérieur (ecrireResultat garde le seq le plus récent).
// seq -1 seulement si l'instantané ne se lit pas, et la raison le dit.
export async function rapporterJetonAbsent({ racine, branche, cause, maintenant, journaliser }) {
  let seq = -1;
  let raison = `jeton GitHub absent (${cause})`;
  try {
    seq = (await lireInstantaneVerrouille(cheminsBranche(racine, branche), branche, { maintenant, journaliser })).seq;
  } catch (err) {
    if (!(err instanceof ErreurEtatJob)) throw err;
    raison = `${raison} ; seq -1 : ${err.message}`;
  }
  journaliser({ date: maintenant().toISOString(), evenement: "publication-echec", branche, seq, raison });
  await ecrireResultat({ racine, branche, resultat: { seq, ok: false, raison }, maintenant, journaliser });
}
