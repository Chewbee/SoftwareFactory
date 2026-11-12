import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as attendre } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import {
  appliquerEvenement,
  avecVerrou,
  cheminsBranche,
  corpsCommentaire,
  DEPOT,
  ecrireJsonAtomique,
  lireCorpsCommentaire,
  ErreurEtatJob,
  normaliserEvenement,
  sessionCourte,
  traiter,
  validerInstantane,
} from "./etat-job-core.mjs";
import {
  creerClient,
  ecrireResultat,
  executerPublieur,
  MAX_ECHECS_PAR_SEQ,
  rapporterJetonAbsent,
  validerArguments,
} from "./etat-job-publier-core.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const BRANCHE = "feat/1998-tableau";
const D = "/repos/" + DEPOT;
const maintenant = () => new Date("2026-10-17T10:00:00Z");

async function avecDossier(corps) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "etat-job-publier-"));
  try {
    return await corps(d);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function fauxGithub({ commentaires = [], labels = [], panne = () => null } = {}) {
  const etat = { commentaires: commentaires.map((c) => ({ ...c })), labels: [...labels], prochainId: 1000 };
  const appels = [];
  const repondre = (status, corps) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => corps,
  });
  async function fetchFn(url, init) {
    const u = new URL(url);
    const methode = init.method;
    appels.push(`${methode} ${u.pathname}`);
    const forcee = await panne(methode, u.pathname, init);
    if (forcee !== null) return repondre(forcee, { message: "panne simulée" });
    const corps = init.body === undefined ? undefined : JSON.parse(init.body);
    if (methode === "GET" && u.pathname === `${D}/issues/1998/comments`) return repondre(200, etat.commentaires.map((c) => ({ ...c })));
    if (methode === "POST" && u.pathname === `${D}/issues/1998/comments`) {
      etat.prochainId += 1;
      etat.commentaires.push({ id: etat.prochainId, body: corps.body });
      return repondre(201, { id: etat.prochainId });
    }
    const m = /\/issues\/comments\/(\d+)$/.exec(u.pathname);
    if (m !== null && methode === "PATCH") {
      const c = etat.commentaires.find((x) => x.id === Number(m[1]));
      if (c === undefined) return repondre(404, {});
      c.body = corps.body;
      return repondre(200, {});
    }
    if (m !== null && methode === "DELETE") {
      const i = etat.commentaires.findIndex((x) => x.id === Number(m[1]));
      if (i === -1) return repondre(404, {});
      etat.commentaires.splice(i, 1);
      return repondre(204, null);
    }
    if (methode === "GET" && u.pathname === `${D}/issues/1998`) return repondre(200, { labels: etat.labels.map((name) => ({ name })) });
    if (methode === "POST" && u.pathname === `${D}/issues/1998/labels`) {
      etat.labels.push(...corps.labels);
      return repondre(200, []);
    }
    return repondre(599, { message: `route non simulée ${methode} ${u.pathname}` });
  }
  return { fetchFn, etat, appels };
}

function preparer(d, { session = "aaaaaaaa-1", ids = ["1"], amorce = false } = {}) {
  const cible = { branche: BRANCHE, issue: 1998 };
  const c = cheminsBranche(d, BRANCHE);
  let inst = null;
  for (const id of ids) {
    const evenement = normaliserEvenement({
      session_id: session,
      cwd: "/d",
      hook_event_name: "PostToolUse",
      tool_name: "TaskCreate",
      tool_input: { subject: `tâche ${id}`, description: "d", metadata: cible },
      tool_response: { task: { id } },
    });
    inst = appliquerEvenement({ instantane: inst, evenement, cible, environnement: "local:test", maintenant });
  }
  ecrireJsonAtomique(c.instantane, amorce ? { ...inst, amorce: true } : inst);
  return c;
}

function instantaneDistant(seq, session, taches) {
  return validerInstantane({ version: 1, seq, branche: BRANCHE, issue: 1998, session, maj: "2026-10-16T00:00:00Z", taches });
}

async function lancer(d, github, extra = {}) {
  const journal = [];
  const client = creerClient({ jeton: "jeton-de-test", fetchFn: github.fetchFn });
  const resultat = await executerPublieur({
    client,
    racine: d,
    branche: BRANCHE,
    session: "aaaaaaaa",
    maintenant,
    journaliser: (l) => {
      journal.push(l);
    },
    pauseMs: 10,
    ...extra,
  });
  return { resultat, journal };
}

const distant = (github) => {
  const c = github.etat.commentaires.find((x) => x.body.startsWith("<!-- etat-job"));
  assert.notEqual(c, undefined, "aucun commentaire d'état distant");
  return lireCorpsCommentaire(c.body, BRANCHE);
};
const publication = (d) => JSON.parse(fs.readFileSync(cheminsBranche(d, BRANCHE).publication, "utf8"));

// Tests de concurrence et de processus : un délai explicite, et toute attente
// bornée par une échéance qui échoue en clair au lieu de pendre (le job CI n'a
// pas de timeout-minutes).
const DELAI_TEST = { timeout: 20000 };
async function attendreQue(condition, message, delaiMs = 5000) {
  const echeance = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > echeance) assert.fail(`${message} (après ${String(delaiMs)} ms)`);
    await attendre(5);
  }
}

test("première publication : POST du corps marqué, en-cours posé une fois", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const gh = fauxGithub();
    const { resultat } = await lancer(d, gh);
    assert.equal(resultat, "ok");
    assert.equal(gh.etat.commentaires.length, 1);
    assert.ok(gh.etat.commentaires[0].body.startsWith(`<!-- etat-job branche=${BRANCHE} -->`));
    assert.deepEqual(gh.etat.labels, ["en-cours"]);
    assert.equal(gh.appels.filter((a) => a === `POST ${D}/issues/1998/labels`).length, 1);
    assert.equal(publication(d).ok, true);
  });
});

test("label déjà présent : aucune pose", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const gh = fauxGithub({ labels: ["en-cours"] });
    await lancer(d, gh);
    assert.equal(gh.appels.filter((a) => a.endsWith("/labels")).length, 0);
  });
});

test("deux commentaires marqués : PATCH du plus ancien, suppression de l'autre ; 404 = succès", async () => {
  await avecDossier(async (d) => {
    preparer(d, { amorce: true });
    const corps = corpsCommentaire(instantaneDistant(1, "cloud:x", []));
    const gh = fauxGithub({ commentaires: [{ id: 20, body: corps }, { id: 10, body: corps }], labels: ["en-cours"] });
    assert.equal((await lancer(d, gh)).resultat, "ok");
    assert.deepEqual(gh.etat.commentaires.map((c) => c.id), [10]);
    assert.ok(gh.appels.includes(`PATCH ${D}/issues/comments/10`));
    const gh404 = fauxGithub({
      commentaires: [{ id: 20, body: corps }, { id: 10, body: corps }],
      labels: ["en-cours"],
      panne: (m, p) => (m === "DELETE" && p.endsWith("/20") ? 404 : null),
    });
    assert.equal((await lancer(d, gh404)).resultat, "ok");
  });
});

test("un commentaire qui cite le marqueur sans commencer par lui n'est ni lu ni supprimé", async () => {
  await avecDossier(async (d) => {
    preparer(d, { amorce: true });
    const rapport = { id: 5, body: `<!-- relecture branche=${BRANCHE} -->\nJe cite <!-- etat-job branche=${BRANCHE} --> ici.\nVERDICT : PRÊT` };
    const gh = fauxGithub({ commentaires: [rapport], labels: ["en-cours"] });
    await lancer(d, gh);
    assert.deepEqual(gh.etat.commentaires.find((c) => c.id === 5), rapport);
    assert.equal(gh.appels.filter((a) => a.endsWith("/comments/5")).length, 0);
    assert.equal(gh.etat.commentaires.length, 2);
  });
});

test("lecture distante en échec : rien publié, deux tentatives, échec écrit ; passage suivant : état fusionné publié", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    let enPanne = true;
    const autre = corpsCommentaire(
      instantaneDistant(4, "cloud:y", [
        { session: "bbbbbbbb", id: "1", sujet: "autre", statut: "completed", niveau: null, modele: null, porte: false },
      ]),
    );
    const gh = fauxGithub({
      commentaires: [{ id: 7, body: autre }],
      labels: ["en-cours"],
      panne: (m, p) => (enPanne && m === "GET" && p.endsWith("/comments") ? 502 : null),
    });
    const r1 = await lancer(d, gh);
    assert.equal(r1.resultat, "echec");
    assert.equal(gh.appels.filter((a) => a.startsWith("PATCH") || a.startsWith("POST")).length, 0);
    assert.equal(gh.appels.filter((a) => a.startsWith("GET") && a.endsWith("/comments")).length, MAX_ECHECS_PAR_SEQ);
    assert.match(publication(d).raison, /502/);
    assert.ok(r1.journal.some((l) => l.evenement === "publication-abandon"));
    enPanne = false;
    assert.equal((await lancer(d, gh)).resultat, "ok");
    assert.deepEqual(distant(gh).taches.map((t) => `${t.session}:${t.id}`).sort(), ["aaaaaaaa:1", "bbbbbbbb:1"]);
  });
});

test("seq qui augmente pendant l'envoi : nouvel envoi du dernier état", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const c = preparer(d, { amorce: true });
    let fait = false;
    const gh = fauxGithub({
      labels: ["en-cours"],
      panne: (m) => {
        if (m === "POST" && !fait) {
          fait = true;
          const inst = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
          ecrireJsonAtomique(c.instantane, { ...inst, seq: inst.seq + 1, taches: inst.taches.map((t) => ({ ...t, statut: "completed" })) });
        }
        return null;
      },
    });
    assert.equal((await lancer(d, gh)).resultat, "ok");
    assert.equal(distant(gh).seq, 2);
    assert.equal(distant(gh).taches[0].statut, "completed");
    assert.equal(gh.appels.filter((a) => a.startsWith("PATCH")).length, 1);
  });
});

test("deux publieurs, envoi périmé arrivé en dernier : convergence vers le dernier seq", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const c = preparer(d, { amorce: true });
    let libererA = null;
    const retenueA = new Promise((r) => {
      libererA = r;
    });
    let premierA = true;
    const gh = fauxGithub({
      commentaires: [{ id: 1, body: corpsCommentaire(instantaneDistant(0, "local:test", [])) }],
      labels: ["en-cours"],
      panne: async (m, _p, init) => {
        if (m === "PATCH" && init.headers.Authorization === "Bearer jeton-A" && premierA) {
          premierA = false;
          await retenueA;
        }
        return null;
      },
    });
    const commun = { racine: d, branche: BRANCHE, session: "aaaaaaaa", maintenant, journaliser: () => undefined, pauseMs: 10 };
    const pA = executerPublieur({ client: creerClient({ jeton: "jeton-A", fetchFn: gh.fetchFn }), ...commun });
    await attendreQue(() => !premierA, "le publieur A n'a jamais atteint son premier PATCH");
    const inst = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
    ecrireJsonAtomique(c.instantane, { ...inst, seq: 2 });
    assert.equal(await executerPublieur({ client: creerClient({ jeton: "jeton-B", fetchFn: gh.fetchFn }), ...commun }), "ok");
    assert.equal(distant(gh).seq, 2);
    libererA();
    assert.equal(await pA, "ok");
    assert.equal(distant(gh).seq, 2);
    assert.equal(gh.appels.filter((a) => a.startsWith("PATCH")).length, 3);
  });
});

test("401 : auth.json marqué pour la session, arrêt après un appel", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const gh = fauxGithub({ panne: () => 401 });
    assert.equal((await lancer(d, gh)).resultat, "401");
    const auth = JSON.parse(fs.readFileSync(path.join(d, ".claude", "logs", "etat-job", "auth.json"), "utf8"));
    assert.equal(auth.aaaaaaaa.statut, 401);
    assert.equal(gh.appels.length, 1);
  });
});

test("commentaire existant au JSON invalide pendant l'amorce : rien publié, échec rapporté", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const gh = fauxGithub({
      commentaires: [{ id: 3, body: `<!-- etat-job branche=${BRANCHE} -->\n\`\`\`json\n{oups\n\`\`\`\n` }],
      labels: ["en-cours"],
    });
    assert.equal((await lancer(d, gh)).resultat, "echec");
    assert.equal(gh.appels.filter((a) => !a.startsWith("GET")).length, 0);
    assert.match(publication(d).raison, /illisible/);
  });
});

// Préchargé dans le point d'entrée : fetch ne sort jamais, chaque appel est
// noté dans TEMOIN_FETCH. Même un main() cassé ne joint pas GitHub. Comme le
// vrai fetch (undici), il refuse un en-tête invalide en citant sa valeur.
const SANS_RESEAU = `data:text/javascript,${encodeURIComponent(`import fs from "node:fs";
globalThis.fetch = async (url, init) => {
  fs.appendFileSync(process.env.TEMOIN_FETCH, JSON.stringify({ url: String(url), methode: init.method, auth: init.headers.Authorization }) + "\\n");
  new Headers(init.headers);
  throw new Error("réseau interdit au test");
};`)}`;

// Le vrai point d'entrée, dans un bac à sable : PATH réduit à un dossier sans
// gh (jamais celui du poste, où gh est connecté), configuration gh vide, fetch
// préchargé ci-dessus. stdin ignoré : aucun tube, donc aucun EPIPE sous charge.
// gh : texte d'un faux gh (script shell) posé seul dans ce PATH.
function lancerEntree(d, args, { gh = null } = {}) {
  const bin = path.join(d, "bin");
  fs.mkdirSync(bin, { recursive: true });
  if (gh !== null) fs.writeFileSync(path.join(bin, "gh"), gh, { mode: 0o755 });
  return spawnSync(process.execPath, ["--import", SANS_RESEAU, path.join(ICI, "etat-job-publier.mjs"), ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { PATH: bin, GH_CONFIG_DIR: path.join(d, "gh-vide"), CLAUDE_PROJECT_DIR: d, TEMOIN_FETCH: path.join(d, "fetch.jsonl") },
    timeout: 10000,
  });
}

const journalFichier = (d) =>
  fs
    .readFileSync(path.join(d, ".claude", "logs", "etat-job.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("point d'entrée : branche ou session refusée → code 1, journal publieur-erreur, rien publié", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    for (const [args, code, motif] of [
      [["../x", "aaaaaaaa"], "branche-invalide", /nom de branche refusé/],
      [[BRANCHE, "a b"], "session-invalide", /session refusée/],
      [[BRANCHE, "a_b"], "session-invalide", /session refusée/],
      [[BRANCHE, "aaaaaaaaa"], "session-invalide", /session refusée/],
      [[BRANCHE], "session-invalide", /session refusée/],
    ]) {
      const r = lancerEntree(d, args);
      assert.equal(r.status, 1, r.stderr);
      const derniere = journalFichier(d).at(-1);
      assert.deepEqual([derniere.evenement, derniere.code], ["publieur-erreur", code], JSON.stringify(args));
      assert.match(derniere.raison, motif);
    }
    assert.equal(fs.existsSync(cheminsBranche(d, BRANCHE).publication), false);
  });
});

const jetonAbsent = (d, journal = []) =>
  rapporterJetonAbsent({
    racine: d,
    branche: BRANCHE,
    cause: "gh auth token en échec",
    maintenant,
    journaliser: (l) => {
      journal.push(l);
    },
  });

test("jeton absent après un succès au même seq : publication.json passe à ok: false", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    assert.equal((await lancer(d, fauxGithub({ labels: ["en-cours"] }))).resultat, "ok");
    const succes = publication(d);
    assert.equal(succes.ok, true);
    const journal = [];
    await jetonAbsent(d, journal);
    const echec = publication(d);
    assert.equal(echec.ok, false);
    assert.equal(echec.seq, succes.seq);
    assert.match(echec.raison, /jeton GitHub absent \(gh auth token en échec\)/);
    assert.deepEqual(
      journal.map((l) => [l.evenement, l.seq]),
      [["publication-echec", succes.seq]],
    );
  });
});

test("jeton absent sans instantané lisible : seq -1, et la raison le dit", async () => {
  await avecDossier(async (d) => {
    await jetonAbsent(d);
    const absent = publication(d);
    assert.equal(absent.ok, false);
    assert.equal(absent.seq, -1);
    assert.match(absent.raison, /jeton GitHub absent .*instantané absent/);
    fs.writeFileSync(cheminsBranche(d, BRANCHE).instantane, "{oups");
    fs.rmSync(cheminsBranche(d, BRANCHE).publication);
    await jetonAbsent(d);
    assert.equal(publication(d).seq, -1);
    assert.match(publication(d).raison, /jeton GitHub absent .*fichier JSON illisible/);
  });
});

// Le hook remplace l'instantané par rename sous le verrou de la branche ; sous
// Windows, ce rename peut échouer si un autre processus a le fichier ouvert.
// Le test tient le verrou comme le hook, et y écrit un seq plus récent.
async function tenirVerrouPuisAvancer(c, pendant) {
  return avecVerrou(
    c.verrou,
    async () => {
      const temoin = pendant();
      await attendre(300);
      const inst = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
      ecrireJsonAtomique(c.instantane, { ...inst, seq: inst.seq + 1 });
      return temoin;
    },
    { maintenant, journaliser: () => undefined },
  );
}

test("le publieur ne lit l'instantané que sous le verrou de la branche", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const c = preparer(d, { amorce: true });
    const gh = fauxGithub({ labels: ["en-cours"] });
    let publieur = null;
    await tenirVerrouPuisAvancer(c, () => {
      publieur = lancer(d, gh);
    });
    const appelsPendantVerrou = gh.appels.length;
    assert.equal((await publieur).resultat, "ok");
    assert.equal(appelsPendantVerrou, 0);
    assert.equal(distant(gh).seq, 2);
    assert.equal(gh.appels.filter((a) => a.startsWith("POST")).length, 1);
  });
});

test("jeton absent : seq lu sous le verrou de la branche", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const c = preparer(d);
    let rapport = null;
    await tenirVerrouPuisAvancer(c, () => {
      rapport = jetonAbsent(d);
    });
    await rapport;
    assert.equal(publication(d).seq, 2);
  });
});

// Pages servies par URL complète ; l'en-tête link désigne la page suivante.
function fauxGithubPagine(pages) {
  const urls = [];
  async function fetchFn(url, init) {
    urls.push(`${init.method} ${url}`);
    const page = pages[url.replace(/^https:\/\/api\.github\.com/, "")];
    if (init.method !== "GET") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    if (page === undefined) return { ok: false, status: 599, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: (n) => (n === "link" ? page.lien : null) }, json: async () => page.corps };
  }
  return { fetchFn, urls };
}

test("pagination : le lien next de l'API est suivi, le commentaire marqué de la page 2 est modifié", async () => {
  await avecDossier(async (d) => {
    preparer(d, { amorce: true });
    const marque = corpsCommentaire(instantaneDistant(0, "cloud:x", []));
    const gh = fauxGithubPagine({
      [`${D}/issues/1998/comments?per_page=100`]: {
        lien: '<https://api.github.com/repositories/42/issues/1998/comments?per_page=100&page=2>; rel="next"',
        corps: [{ id: 1, body: "sans marqueur" }],
      },
      "/repositories/42/issues/1998/comments?per_page=100&page=2": { lien: null, corps: [{ id: 2, body: marque }] },
      [`${D}/issues/1998`]: { lien: null, corps: { labels: [{ name: "en-cours" }] } },
    });
    const r = await executerPublieur({
      client: creerClient({ jeton: "j", fetchFn: gh.fetchFn }),
      racine: d,
      branche: BRANCHE,
      session: "aaaaaaaa",
      maintenant,
      journaliser: () => undefined,
      pauseMs: 10,
    });
    assert.equal(r, "ok");
    assert.ok(gh.urls.includes(`PATCH https://api.github.com${D}/issues/comments/2`));
  });
});

test("lien next hors de l'API GitHub : refusé avant l'envoi, le jeton ne part pas ailleurs", async () => {
  await avecDossier(async (d) => {
    preparer(d, { amorce: true });
    const gh = fauxGithubPagine({
      [`${D}/issues/1998/comments?per_page=100`]: {
        lien: '<https://api.github.com.exemple.invalid/vol?page=2>; rel="next"',
        corps: [],
      },
    });
    const r = await executerPublieur({
      client: creerClient({ jeton: "j", fetchFn: gh.fetchFn }),
      racine: d,
      branche: BRANCHE,
      session: "aaaaaaaa",
      maintenant,
      journaliser: () => undefined,
      pauseMs: 10,
    });
    assert.equal(r, "echec");
    assert.deepEqual(
      gh.urls.filter((u) => !u.startsWith("GET https://api.github.com/")),
      [],
    );
    assert.match(publication(d).raison, /hors de l'API GitHub/);
  });
});

// Concordance avec le hook : le publieur reçoit les arguments que traiter passe
// à lancerPublieur, et le hook suivant relit publication.json et auth.json.
const SESSION_HOOK = "aaaaaaaa-1111";
const creationHook = {
  session_id: SESSION_HOOK,
  cwd: "/d",
  hook_event_name: "PostToolUse",
  tool_name: "TaskCreate",
  tool_input: { subject: "s", description: "d", metadata: { branche: BRANCHE, issue: 1998 } },
  tool_response: { task: { id: "1" } },
};
const majHook = (status) => ({
  session_id: SESSION_HOOK,
  cwd: "/d",
  hook_event_name: "PostToolUse",
  tool_name: "TaskUpdate",
  tool_input: { taskId: "1", status },
});

function hook(d) {
  const lances = [];
  const appeler = async (entree) => {
    const { sortie } = await traiter({
      brut: JSON.stringify(entree),
      racine: d,
      env: { CLAUDE_CODE_REMOTE: "false" },
      git: { brancheCourante: () => null, issueConfiguree: () => null },
      lancerPublieur: (branche, session) => {
        lances.push({ branche, session });
      },
      maintenant,
      journaliser: () => undefined,
    });
    return sortie === null ? null : sortie.hookSpecificOutput.additionalContext;
  };
  return { lances, appeler };
}

const publierCommeLance = (d, lance, github) =>
  executerPublieur({
    client: creerClient({ jeton: "j", fetchFn: github.fetchFn }),
    racine: d,
    branche: lance.branche,
    session: lance.session,
    maintenant,
    journaliser: () => undefined,
    pauseMs: 10,
  });

test("concordance : un 401 du publieur fait rendre l'ordre MCP au hook suivant, sans relancer de publieur", async () => {
  await avecDossier(async (d) => {
    const h = hook(d);
    assert.equal(await h.appeler(creationHook), null);
    assert.deepEqual(h.lances, [{ branche: BRANCHE, session: "aaaaaaaa" }]);
    assert.equal(await publierCommeLance(d, h.lances[0], fauxGithub({ panne: () => 401 })), "401");
    assert.match(await h.appeler(majHook("in_progress")), /a rendu 401 dans cette session .*outil MCP GitHub/);
    assert.equal(h.lances.length, 1);
  });
});

test("concordance : l'abandon du publieur est rapporté tel quel par le hook suivant", async () => {
  await avecDossier(async (d) => {
    const h = hook(d);
    await h.appeler(creationHook);
    const panne = fauxGithub({ panne: (m, p) => (m === "GET" && p.endsWith("/comments") ? 502 : null) });
    assert.equal(await publierCommeLance(d, h.lances[0], panne), "echec");
    const { seq, raison } = publication(d);
    assert.equal(
      await h.appeler(majHook("in_progress")),
      `etat-job : dernière publication de ${BRANCHE} en échec (seq ${String(seq)}) : ${raison}`,
    );
    assert.match(raison, /HTTP 502/);
  });
});

test("concordance : après un succès, le hook se tait ; un jeton absent ensuite lui est rapporté", async () => {
  await avecDossier(async (d) => {
    const h = hook(d);
    await h.appeler(creationHook);
    assert.equal(await publierCommeLance(d, h.lances[0], fauxGithub({ labels: ["en-cours"] })), "ok");
    assert.equal(await h.appeler(majHook("in_progress")), null);
    await rapporterJetonAbsent({ racine: d, branche: h.lances[1].branche, cause: "gh introuvable", maintenant, journaliser: () => undefined });
    assert.match(await h.appeler(majHook("completed")), /en échec \(seq 3\) : jeton GitHub absent \(gh introuvable\)/);
  });
});

test("corps de plus de 65 536 caractères : rien envoyé, échec rapporté avec la taille", async () => {
  await avecDossier(async (d) => {
    const c = preparer(d, { amorce: true });
    const inst = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
    ecrireJsonAtomique(c.instantane, { ...inst, taches: inst.taches.map((t) => ({ ...t, sujet: "x".repeat(70000) })) });
    const gh = fauxGithub({ labels: ["en-cours"] });
    assert.equal((await lancer(d, gh)).resultat, "echec");
    assert.equal(gh.appels.filter((a) => !a.startsWith("GET")).length, 0);
    assert.match(publication(d).raison, /commentaire d'état de \d+ caractères \(> 65536\)/);
  });
});

// Promesse bornée : une régression qui empêche l'étape attendue échoue en clair.
function bornee(promesse, message, delaiMs = 5000) {
  const echec = attendre(delaiMs, undefined, { ref: false }).then(() => assert.fail(`${message} (après ${String(delaiMs)} ms)`));
  return Promise.race([promesse, echec]);
}

test("amorce unique : un second publieur n'amorce pas un instantané déjà amorcé, la tâche supprimée ne revient pas", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    // Deux TaskCreate rapprochés : deux publieurs lisent tous deux amorce absent.
    const c = preparer(d, { ids: ["1", "2"] });
    const autre = corpsCommentaire(
      instantaneDistant(4, "cloud:y", [
        { session: "bbbbbbbb", id: "1", sujet: "autre", statut: "completed", niveau: null, modele: null, porte: false },
      ]),
    );
    const gh = fauxGithub({ commentaires: [{ id: 7, body: autre }], labels: ["en-cours"] });
    let signalerP2 = null;
    let signalerPatchP1 = null;
    const p2Lit = new Promise((r) => {
      signalerP2 = r;
    });
    const patchP1 = new Promise((r) => {
      signalerPatchP1 = r;
    });
    let supprimee = false;
    // P1 lit les commentaires une fois P2 entré dans sa lecture ; P2 ne la reçoit
    // qu'après le PATCH de P1 et la suppression de la tâche 2 par le hook.
    const fetchDe = (nom) => async (url, init) => {
      const p = new URL(url).pathname;
      if (init.method === "GET" && p.endsWith("/comments")) {
        if (nom === "P1") await bornee(p2Lit, "P2 n'a jamais lu les commentaires");
        if (nom === "P2" && !supprimee) {
          signalerP2();
          await bornee(patchP1, "P1 n'a jamais publié");
        }
      }
      const reponse = await gh.fetchFn(url, init);
      if (nom === "P1" && init.method === "PATCH" && !supprimee) {
        supprimee = true;
        await avecVerrou(
          c.verrou,
          () => {
            const lu = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
            const evenement = normaliserEvenement({
              session_id: "aaaaaaaa-1",
              cwd: "/d",
              hook_event_name: "PostToolUse",
              tool_name: "TaskUpdate",
              tool_input: { taskId: "2", status: "deleted" },
            });
            const cible = { branche: BRANCHE, issue: 1998 };
            ecrireJsonAtomique(c.instantane, appliquerEvenement({ instantane: lu, evenement, cible, environnement: "local:test", maintenant }));
          },
          { maintenant, journaliser: () => undefined },
        );
        signalerPatchP1();
      }
      return reponse;
    };
    const commun = { racine: d, branche: BRANCHE, session: "aaaaaaaa", maintenant, journaliser: () => undefined, pauseMs: 10 };
    const resultats = await Promise.all(
      ["P1", "P2"].map((nom) => executerPublieur({ client: creerClient({ jeton: nom, fetchFn: fetchDe(nom) }), ...commun })),
    );
    assert.deepEqual(resultats, ["ok", "ok"]);
    const local = validerInstantane(JSON.parse(fs.readFileSync(c.instantane, "utf8")));
    const cles = (inst) => inst.taches.map((t) => `${t.session}:${t.id}`).sort();
    assert.deepEqual(cles(local), ["aaaaaaaa:1", "bbbbbbbb:1"]);
    assert.deepEqual(cles(distant(gh)), ["aaaaaaaa:1", "bbbbbbbb:1"]);
    assert.equal(distant(gh).seq, local.seq);
  });
});

test("échec d'envoi après l'amorce : exactement deux envois, échecs journalisés au seq envoyé", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const gh = fauxGithub({ panne: (m) => (m === "POST" ? 502 : null) });
    const { resultat, journal } = await lancer(d, gh);
    assert.equal(resultat, "echec");
    assert.equal(gh.appels.filter((a) => a.startsWith("POST")).length, MAX_ECHECS_PAR_SEQ);
    assert.deepEqual(
      journal.filter((l) => l.evenement.startsWith("publication-")).map((l) => [l.evenement, l.seq, l.echecs]),
      [
        ["publication-echec", 2, 1],
        ["publication-echec", 2, 2],
        ["publication-abandon", 2, undefined],
      ],
    );
    assert.equal(publication(d).seq, 2);
  });
});

// Une erreur qui sort de la boucle (fichier local, verrou) s'écrit aussi dans
// publication.json : le hook suivant la rapporte à l'agent.
test("panne hors envoi : 401 avec auth.json illisible → échec écrit dans publication.json", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    fs.writeFileSync(path.join(d, ".claude", "logs", "etat-job", "auth.json"), "[]");
    const { resultat, journal } = await lancer(d, fauxGithub({ panne: () => 401 }));
    assert.equal(resultat, "echec");
    assert.equal(publication(d).ok, false);
    assert.equal(publication(d).seq, 1);
    assert.match(publication(d).raison, /^panne du publieur : fichier illisible : .*auth\.json$/);
    assert.ok(journal.some((l) => l.evenement === "publication-panne"));
  });
});

test("panne hors envoi : instantané illisible à la relecture → échec écrit au seq envoyé", async () => {
  await avecDossier(async (d) => {
    const c = preparer(d, { amorce: true });
    const gh = fauxGithub({
      labels: ["en-cours"],
      panne: (m) => {
        if (m === "POST") fs.writeFileSync(c.instantane, "{oups");
        return null;
      },
    });
    assert.equal((await lancer(d, gh)).resultat, "echec");
    assert.equal(publication(d).ok, false);
    assert.equal(publication(d).seq, 1);
    assert.match(publication(d).raison, /^panne du publieur : fichier JSON illisible/);
  });
});

test("instantané d'une autre branche au même nom de fichier : refus bruyant, rien publié", async () => {
  await avecDossier(async (d) => {
    // feat/1998-tableau et feat-1998/tableau partagent feat-1998-tableau.json.
    preparer(d);
    const gh = fauxGithub({ labels: ["en-cours"] });
    assert.equal((await lancer(d, gh, { branche: "feat-1998/tableau" })).resultat, "echec");
    assert.deepEqual(gh.appels, []);
    assert.match(publication(d).raison, /l'instantané lu appartient à feat\/1998-tableau, pas à feat-1998\/tableau/);
  });
});

test("point d'entrée sans gh : jeton absent écrit dans publication.json au seq courant, journalisé, aucun fetch", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const r = lancerEntree(d, [BRANCHE, "aaaaaaaa"]);
    assert.equal(r.status, 0, r.stderr);
    const resultat = publication(d);
    assert.equal(resultat.ok, false);
    assert.equal(resultat.seq, 1);
    assert.match(resultat.raison, /^jeton GitHub absent \(gh auth token en échec : .*ENOENT/);
    assert.ok(journalFichier(d).some((l) => l.evenement === "publication-echec" && l.seq === 1));
    assert.equal(fs.existsSync(path.join(d, "fetch.jsonl")), false);
  });
});

const SANS_SH = process.platform === "win32" ? "faux gh en script shell : POSIX seulement" : false;

test("point d'entrée, gh en échec : son message, tronqué, part dans la raison", { ...DELAI_TEST, skip: SANS_SH }, async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const message = `gh : aucun compte connecté ${"x".repeat(400)}`;
    const r = lancerEntree(d, [BRANCHE, "aaaaaaaa"], { gh: `#!/bin/sh\necho "${message}" >&2\nexit 1\n` });
    assert.equal(r.status, 0, r.stderr);
    const { raison } = publication(d);
    assert.match(raison, /^jeton GitHub absent \(gh auth token en échec : gh : aucun compte connecté x+…\)$/);
    assert.ok(raison.length < message.length, `raison de ${String(raison.length)} caractères`);
  });
});

test("point d'entrée, gh connecté : le jeton lu part dans l'en-tête Authorization", { ...DELAI_TEST, skip: SANS_SH }, async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const r = lancerEntree(d, [BRANCHE, "aaaaaaaa"], { gh: "#!/bin/sh\necho jeton-factice\n" });
    assert.equal(r.status, 0, r.stderr);
    const appels = fs.readFileSync(path.join(d, "fetch.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(appels[0], { url: `https://api.github.com${D}/issues/1998/comments?per_page=100`, methode: "GET", auth: "Bearer jeton-factice" });
    assert.match(publication(d).raison, /réseau interdit au test/);
  });
});

// undici recopie la valeur d'un en-tête invalide dans son erreur : sans garde, le
// jeton partirait dans publication.json, le journal, puis l'additionalContext.
test("point d'entrée, gh rend un jeton à saut de ligne : refusé avant tout fetch, jamais cité (I4)", { ...DELAI_TEST, skip: SANS_SH }, async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const r = lancerEntree(d, [BRANCHE, "aaaaaaaa"], { gh: "#!/bin/sh\nprintf 'ghp_SECRET\\nX\\n'\n" });
    assert.equal(r.status, 0, r.stderr);
    const { raison } = publication(d);
    const journal = fs.readFileSync(path.join(d, ".claude", "logs", "etat-job.jsonl"), "utf8");
    // Le hook suivant relaie la raison à l'agent, en additionalContext.
    const contexte = await hook(d).appeler(creationHook);
    for (const [ou, texte] of [["publication.json", raison], ["journal", journal], ["stderr", r.stderr], ["additionalContext", contexte]]) {
      assert.ok(!texte.includes("SECRET"), `jeton cité dans ${ou} : ${texte}`);
    }
    assert.match(raison, /^jeton GitHub absent \(gh auth token a rendu un jeton invalide/);
    assert.match(contexte, /en échec \(seq \d+\) : jeton GitHub absent \(gh auth token a rendu un jeton invalide/);
    assert.equal(fs.existsSync(path.join(d, "fetch.jsonl")), false, "le jeton est parti dans un en-tête");
  });
});

test("arguments du publieur : toute session produite par sessionCourte est acceptée, le reste refusé par une erreur typée", () => {
  for (const id of ["aaaaaaaa-1111", "0d4c2b1e-9f3a-4c7d-8e21-5a6b7c8d9e0f", "abc", "A-1"]) {
    assert.deepEqual(validerArguments([BRANCHE, sessionCourte(id)]), { branche: BRANCHE, session: sessionCourte(id) });
  }
  for (const [args, code] of [
    [["../x", "aaaaaaaa"], "branche-invalide"],
    [[BRANCHE, "a_b"], "session-invalide"],
    [[BRANCHE, "aaaaaaaaa"], "session-invalide"],
    [[BRANCHE, ""], "session-invalide"],
    [[BRANCHE], "session-invalide"],
  ]) {
    assert.throws(() => validerArguments(args), (err) => err instanceof ErreurEtatJob && err.code === code, JSON.stringify(args));
  }
});

const tacheDe = (session) => ({ session, id: "1", sujet: session, statut: "pending", niveau: null, modele: null, porte: false });

test("amorce : les tâches des autres sessions viennent du plus ancien commentaire marqué", async () => {
  await avecDossier(async (d) => {
    preparer(d);
    const ancien = corpsCommentaire(instantaneDistant(3, "cloud:x", [tacheDe("bbbbbbbb")]));
    const recent = corpsCommentaire(instantaneDistant(5, "cloud:y", [tacheDe("cccccccc")]));
    const gh = fauxGithub({ commentaires: [{ id: 20, body: recent }, { id: 10, body: ancien }], labels: ["en-cours"] });
    assert.equal((await lancer(d, gh)).resultat, "ok");
    assert.deepEqual(distant(gh).taches.map((t) => t.session).sort(), ["aaaaaaaa", "bbbbbbbb"]);
  });
});

test("ecrireResultat : un résultat d'un seq plus ancien n'écrase pas un plus récent ; au même seq, il le remplace", async () => {
  await avecDossier(async (d) => {
    const ecrire = (resultat) => ecrireResultat({ racine: d, branche: BRANCHE, resultat, maintenant, journaliser: () => undefined });
    await ecrire({ seq: 5, ok: true, raison: null });
    await ecrire({ seq: 3, ok: false, raison: "envoi périmé" });
    assert.deepEqual([publication(d).seq, publication(d).ok], [5, true]);
    await ecrire({ seq: 5, ok: false, raison: "jeton GitHub absent" });
    assert.deepEqual([publication(d).seq, publication(d).ok], [5, false]);
  });
});

test("suppression d'un doublon : seul un 404 vaut succès, un 500 fait échouer l'envoi", async () => {
  await avecDossier(async (d) => {
    preparer(d, { amorce: true });
    const corps = corpsCommentaire(instantaneDistant(1, "cloud:x", []));
    const gh = fauxGithub({
      commentaires: [{ id: 10, body: corps }, { id: 20, body: corps }],
      labels: ["en-cours"],
      panne: (m) => (m === "DELETE" ? 500 : null),
    });
    assert.equal((await lancer(d, gh)).resultat, "echec");
    assert.match(publication(d).raison, new RegExp(`^DELETE /repos/` + DEPOT + `/issues/comments/20 : HTTP 500$`));
  });
});
