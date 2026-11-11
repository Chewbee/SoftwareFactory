// Logique pure du hook jev-model (ADR-0194) : Jev (TypeSafe, primitif
// Score) note la complexité du brief d'un sous-agent ; son avis, borné dans la
// bande du rôle, est journalisé à côté du model de l'appel. Le hook ne réécrit
// plus aucun appel : il ne rend ni updatedInput ni permissionDecision, car un
// allow sauterait le contrôle du mode auto. L'agent principal passe le model
// rendu par jev-cli. fetch et horloge sont injectés pour les tests.

export const MODELES = ["haiku", "sonnet", "opus"];
export const NIVEAUX = ["mechanical", "standard", "frontier"];

// Table de l'ADR-0194, point 1. defaut : modèle du frontmatter de l'agent, ou
// null quand l'agent hérite du modèle de la session (doc des sous-agents).
// Pour claude-code-guide, haiku vient de la doc de Claude Code, pas d'un frontmatter.
export const BANDES = {
  "softwarefactory:executant-basic": { defaut: "haiku", min: 0, max: 1 },
  "softwarefactory:implementeur": { defaut: "sonnet", min: 0, max: 2 },
  "general-purpose": { defaut: null, min: 0, max: 2 },
  claude: { defaut: null, min: 0, max: 2 },
  "softwarefactory:analyste": { defaut: "opus", min: 1, max: 2 },
  "softwarefactory:typesafe-explorateur": { defaut: "opus", min: 1, max: 2 },
  Plan: { defaut: null, min: 1, max: 2 },
  Explore: { defaut: null, min: 0, max: 1 },
  "claude-code-guide": { defaut: "haiku", min: 0, max: 1 },
  "web-fetch": { defaut: null, min: 0, max: 1 },
  "softwarefactory:session-cloud": { defaut: null, min: 1, max: 2 },
};

// ADR-0194, point 4 : ni routés, ni soumis à Jev, ni journalisés.
// Les agents de bandes propre à un projet consommateur (ex. le
// dashboard-builder d'Adonnante) ne sont pas dans la table : le hook les
// signale agent-hors-table et les route par défaut — c'est le noyau du
// projet qui les gère.
export const EXCLUS = ["softwarefactory:relecteur", "softwarefactory:relecteur-basic", "fork", "statusline-setup"];

// Outil Agent sans subagent_type : Claude Code prend general-purpose
// (https://code.claude.com/docs/en/sub-agents).
const TYPE_PAR_DEFAUT = "general-purpose";

// ADR-0194, point 7, et sonde de #2551 : le hook journalise aussi l'avis de Jev
// sur le prompt d'un create_session (bande sonnet, opus) et signale un model
// absent, sans rien réécrire ; noms relevés sur le schéma de l'outil.
export const OUTIL_SESSION = "mcp__claude-code-remote__create_session";
const CHAMP_BRIEF_SESSION = "prompt";

function typeAgent(entree, entreeOutil) {
  if (entree.tool_name === OUTIL_SESSION) return "softwarefactory:session-cloud";
  return entreeOutil.subagent_type === undefined ? TYPE_PAR_DEFAUT : entreeOutil.subagent_type;
}

export const SEUIL_CONFIANCE = 0.5;
const TOLERANCE_SOMME = 0.01;
const DELAI_MS = 3000;
// Longueur maximale de l'état envoyé à Jev, en unités UTF-16 (String.length, comme slice).
export const ETAT_MAX = 32_000;
const URL_DEFAUT = "https://api.typesafe.ai";

export const QUESTION = {
  type: "score",
  instructions:
    "Quel niveau de raisonnement cette tâche confiée à un agent de code exige-t-elle ?",
  criteria: [
    "Mécanique : tâche cadrée d'avance, sans arbitrage (renommage, coquille, bump de version, diff déjà décidé, recherche de fichiers).",
    "Standard : code à écrire et à tester selon un plan ou un diagnostic écrit, sans décision d'architecture ouverte.",
    "Frontière : arbitrage exigé (cause inconnue à prouver, choix d'architecture, invariants géographiques ou numériques, plusieurs modules couplés, plan à produire).",
  ],
};

export function estObjet(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function estProba(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

export function borner(niveau, role) {
  const bande = BANDES[role];
  return MODELES[Math.min(Math.max(niveau, bande.min), bande.max)];
}

// Rend { niveau, confiance } ou null si la réponse ne suit pas le format documenté.
export function lireReponse(corps) {
  if (!estObjet(corps) || !estObjet(corps.answers)) return null;
  const reponse = corps.answers.complexite;
  if (!estObjet(reponse) || !estObjet(reponse.probabilities)) return null;
  if (!estProba(reponse.confidence)) return null;
  let niveau = -1;
  let meilleure = -1;
  let somme = 0;
  for (let i = 0; i < NIVEAUX.length; i += 1) {
    const p = reponse.probabilities[String(i)];
    if (!estProba(p)) return null;
    somme += p;
    if (p >= meilleure) {
      meilleure = p;
      niveau = i;
    }
  }
  if (Math.abs(somme - 1) > TOLERANCE_SOMME) return null;
  return { niveau, confiance: reponse.confidence };
}

// session_id et tool_use_id relient une ligne du journal à l'appel qui l'a produite.
function identifiants(entree) {
  const ids = {};
  for (const cle of ["session_id", "tool_use_id"]) {
    if (typeof entree[cle] === "string") ids[cle] = entree[cle];
  }
  return ids;
}

function horsTable(type, entree, maintenant) {
  const agent = typeof type === "string" ? type : null;
  return {
    sortie: { systemMessage: `Jev : agent hors table (${String(agent)}), modèle inchangé (agent-hors-table)` },
    journal: { date: maintenant().toISOString(), ...identifiants(entree), agent, raison: "agent-hors-table" },
  };
}

// Pose `questions` à Jev. Rend { corps } (JSON de la réponse) ou { raison } si
// l'appel échoue : cle-absente, reseau, http-NNN, reponse-invalide.
export async function appelerJev(etat, questions, env, fetchFn, delaiMs) {
  const cle = env.TYPESAFE_API_KEY;
  if (typeof cle !== "string" || cle === "") return { raison: "cle-absente" };
  const racine =
    typeof env.TYPESAFE_BASE_URL === "string" && env.TYPESAFE_BASE_URL !== ""
      ? env.TYPESAFE_BASE_URL
      : URL_DEFAUT;
  const signal = AbortSignal.timeout(delaiMs);
  let res;
  try {
    res = await fetchFn(`${racine}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: etat.slice(0, ETAT_MAX), questions }),
      signal,
    });
  } catch {
    return { raison: "reseau" };
  }
  if (!res.ok) return { raison: `http-${String(res.status)}` };
  try {
    return { corps: await res.json() };
  } catch {
    // Délai écoulé pendant la lecture du corps : c'est le réseau, pas la réponse.
    return { raison: signal.aborted ? "reseau" : "reponse-invalide" };
  }
}

export async function demanderJev(brief, env, fetchFn, delaiMs) {
  const { raison, corps } = await appelerJev(brief, { complexite: QUESTION }, env, fetchFn, delaiMs);
  if (corps === undefined) return { raison };
  const lu = lireReponse(corps);
  if (lu === null) return { raison: "reponse-invalide" };
  return { lu };
}

// ADR-0194 : l'appel n'est jamais modifié. Jev donne son avis sur le brief, que
// le model soit explicite (conservé) ou absent (frontmatter ou session).
async function avisSurAppel({ role, base, brief, explicite, env, fetchFn, delaiMs }) {
  const absent = explicite === null;
  const journal = absent
    ? { ...base, retenu: null, raison: "model-absent" }
    : { ...base, retenu: explicite, raison: "model-explicite" };
  const debut = absent
    ? `Jev : ${role} sans model, modèle du frontmatter ou de la session`
    : `Jev : ${role}, model explicite ${explicite} conservé`;
  const enRepli = (raison) => ({
    sortie: { systemMessage: `${debut} ; avis en repli (${raison})` },
    journal: { ...journal, avisJev: null, avisJevRaison: raison },
  });
  if (typeof brief !== "string" || brief === "") return enRepli("brief-absent");
  const { raison, lu } = await demanderJev(brief, env, fetchFn, delaiMs);
  if (lu === undefined) return enRepli(raison);
  if (lu.confiance < SEUIL_CONFIANCE) return enRepli("confiance-basse");
  const avisJev = { niveau: NIVEAUX[lu.niveau], modele: borner(lu.niveau, role), confiance: lu.confiance };
  return {
    sortie: {
      systemMessage: `${debut} (avis : ${avisJev.modele}, ${avisJev.niveau}, confiance ${lu.confiance.toFixed(2)})`,
    },
    journal: { ...journal, avisJev, avisJevRaison: null },
  };
}

// entree : JSON de l'événement PreToolUse. Rend { sortie, journal } ; null = rien à écrire.
export async function decider({ entree, env, fetchFn, maintenant, delaiMs = DELAI_MS }) {
  const entreeOutil = estObjet(entree) ? entree.tool_input : undefined;
  if (!estObjet(entreeOutil)) return { sortie: null, journal: null };
  const type = typeAgent(entree, entreeOutil);
  if (typeof type === "string" && EXCLUS.includes(type)) return { sortie: null, journal: null };
  if (typeof type !== "string" || !Object.hasOwn(BANDES, type)) return horsTable(type, entree, maintenant);
  // Le type session-cloud n'existe que pour l'outil de session : venu d'Agent, il est hors table.
  if (type === "softwarefactory:session-cloud" && entree.tool_name !== OUTIL_SESSION) return horsTable(type, entree, maintenant);
  const role = type;
  const bande = BANDES[role];
  const brief = role === "softwarefactory:session-cloud" ? entreeOutil[CHAMP_BRIEF_SESSION] : entreeOutil.prompt;
  const base = {
    date: maintenant().toISOString(),
    ...identifiants(entree),
    agent: role,
    defaut: bande.defaut,
    longueurBrief: typeof brief === "string" ? brief.length : 0,
  };

  const explicite = typeof entreeOutil.model === "string" && entreeOutil.model !== "" ? entreeOutil.model : null;
  return avisSurAppel({ role, base, brief, explicite, env, fetchFn, delaiMs });
}

// Repli qui ne dépend d'aucun rôle (entrée illisible, erreur interne) : même
// traitement que les autres replis, ligne visible et journal (CLAUDE.md §3.4).
function repliSansRole(raison, maintenant) {
  return {
    sortie: { systemMessage: `Jev : repli (${raison}), appel inchangé` },
    journal: { date: maintenant().toISOString(), raison },
  };
}

// brut : texte reçu sur stdin. Rend { sortie, journal, diagnostic } ; ne lève
// que si l'horloge elle-même lève. diagnostic (texte pour stderr) vaut null
// quand tout va bien.
export async function traiter({ brut, env, fetchFn, maintenant, delaiMs }) {
  let entree;
  try {
    entree = JSON.parse(brut);
  } catch {
    return { ...repliSansRole("entree-illisible", maintenant), diagnostic: "entrée illisible" };
  }
  try {
    return { ...(await decider({ entree, env, fetchFn, maintenant, delaiMs })), diagnostic: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ...repliSansRole("erreur-interne", maintenant), diagnostic: `erreur interne : ${detail}` };
  }
}
