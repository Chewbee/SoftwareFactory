import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as minuter, clearTimeout as annuler } from "node:timers";
import { decider, borner, lireReponse, traiter, BANDES, EXCLUS, OUTIL_SESSION } from "./jev-model-core.mjs";

const PREFIXE = "softwarefactory";
const BRIEF = "Renomme la fonction foo en bar dans packages/shared/src/geo.ts";
const ENV = { TYPESAFE_API_KEY: "cle-de-test" };
const maintenant = () => new Date("2026-10-12T00:00:00Z");

function reponseJev(probabilites, confiance) {
  return {
    model: "jev-1.13.0",
    answers: {
      complexite: {
        type: "score",
        score: 0,
        confidence: confiance,
        probabilities: probabilites,
      },
    },
  };
}

function fetchQuiRend(corps, status = 200) {
  const appels = [];
  const fn = async (url, init) => {
    appels.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => corps };
  };
  return { fn, appels };
}

function entree(subagentType, extra = {}) {
  return {
    tool_name: "Agent",
    tool_input: { description: "d", prompt: BRIEF, subagent_type: subagentType, ...extra },
  };
}

test("borner : 9 cas rôle × niveau", () => {
  const attendu = {
    "softwarefactory:executant-basic": ["haiku", "sonnet", "sonnet"],
    "softwarefactory:implementeur": ["haiku", "sonnet", "opus"],
    "softwarefactory:analyste": ["sonnet", "sonnet", "opus"],
  };
  for (const [role, modeles] of Object.entries(attendu)) {
    modeles.forEach((m, niveau) => assert.equal(borner(niveau, role), m, `${role} niveau ${String(niveau)}`));
  }
});

// Modèle attendu par niveau (mécanique, standard, frontière), écrit à la main
// depuis la table de l'ADR-0194, point 1 : jamais recalculé par borner().
const ATTENDU = {
  "softwarefactory:executant-basic": ["haiku", "sonnet", "sonnet"],
  "softwarefactory:implementeur": ["haiku", "sonnet", "opus"],
  "general-purpose": ["haiku", "sonnet", "opus"],
  claude: ["haiku", "sonnet", "opus"],
  "softwarefactory:analyste": ["sonnet", "sonnet", "opus"],
  "softwarefactory:typesafe-explorateur": ["sonnet", "sonnet", "opus"],
  Plan: ["sonnet", "sonnet", "opus"],
  Explore: ["haiku", "sonnet", "sonnet"],
  "claude-code-guide": ["haiku", "sonnet", "sonnet"],
  "web-fetch": ["haiku", "sonnet", "sonnet"],
  "softwarefactory:session-cloud": ["sonnet", "sonnet", "opus"],
};
// null : l'agent hérite du modèle de la session (doc des sous-agents).
const DEFAUT_ATTENDU = {
  "softwarefactory:executant-basic": "haiku",
  "softwarefactory:implementeur": "sonnet",
  "general-purpose": null,
  claude: null,
  "softwarefactory:analyste": "opus",
  "softwarefactory:typesafe-explorateur": "opus",
  Plan: null,
  Explore: null,
  "claude-code-guide": "haiku",
  "web-fetch": null,
  "softwarefactory:session-cloud": null,
};
// Agents intégrés à Claude Code : aucun fichier dans .claude/agents.
const SANS_FICHIER = ["general-purpose", "claude", "Plan", "Explore", "claude-code-guide", "web-fetch", "softwarefactory:session-cloud"];
const DISTRIBUTIONS = [
  { 0: 0.9, 1: 0.1, 2: 0 },
  { 0: 0.1, 1: 0.8, 2: 0.1 },
  { 0: 0, 1: 0.1, 2: 0.9 },
];

test("BANDES couvre exactement la table de l'ADR-0194, défauts compris", () => {
  assert.deepEqual(Object.keys(BANDES).sort(), Object.keys(ATTENDU).sort());
  for (const [role, defaut] of Object.entries(DEFAUT_ATTENDU)) assert.equal(BANDES[role].defaut, defaut, role);
});

for (const [role, modeles] of Object.entries(ATTENDU)) {
  test(`bande de ${role} : sans model, l'avis de chaque niveau est le modèle de la table, rien n'est réécrit`, async () => {
    for (let niveau = 0; niveau < 3; niveau += 1) {
      const etiquette = `${role} niveau ${String(niveau)}`;
      const { fn, appels } = fetchQuiRend(reponseJev(DISTRIBUTIONS[niveau], 0.9));
      const { sortie, journal } = await decider({ entree: role === "softwarefactory:session-cloud" ? entreeSession() : entree(role), env: ENV, fetchFn: fn, maintenant });
      assert.equal(appels.length, 1, etiquette);
      assert.equal(journal.raison, "model-absent", etiquette);
      assert.equal(journal.retenu, null, etiquette);
      assert.equal(journal.avisJev.modele, modeles[niveau], etiquette);
      assert.equal(journal.avisJevRaison, null, etiquette);
      assert.equal(sortie.hookSpecificOutput, undefined, etiquette);
    }
  });
}

test("EXCLUS : softwarefactory:relecteur, softwarefactory:relecteur-basic, fork, statusline-setup", () => {
  assert.deepEqual([...EXCLUS].sort(), ["fork", "softwarefactory:relecteur", "softwarefactory:relecteur-basic", "statusline-setup"]);
});

for (const type of ["softwarefactory:relecteur", "softwarefactory:relecteur-basic", "fork", "statusline-setup"]) {
  test(`exclu : ${type} n'est pas routé, Jev n'est pas appelé, rien n'est écrit`, async () => {
    for (const extra of [{}, { model: "opus" }]) {
      const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.9));
      const r = await decider({ entree: entree(type, extra), env: ENV, fetchFn: fn, maintenant });
      assert.deepEqual(r, { sortie: null, journal: null });
      assert.equal(appels.length, 0);
    }
  });
}

test("hors table : agent-hors-table dans la sortie et le journal, sans réécriture ni appel", async () => {
  for (const extra of [{}, { model: "opus" }]) {
    const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.9));
    const e = { ...entree("agent-inconnu", extra), session_id: "s1", tool_use_id: "t1" };
    const { sortie, journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
    assert.equal(appels.length, 0);
    assert.equal(sortie.hookSpecificOutput, undefined);
    assert.match(sortie.systemMessage, /agent-hors-table/);
    assert.match(sortie.systemMessage, /agent-inconnu/);
    assert.deepEqual(journal, {
      date: "2026-10-12T00:00:00.000Z",
      session_id: "s1",
      tool_use_id: "t1",
      agent: "agent-inconnu",
      raison: "agent-hors-table",
    });
  }
});

test("subagent_type non textuel : agent-hors-table, agent null", async () => {
  const { fn, appels } = fetchQuiRend({});
  const { sortie, journal } = await decider({ entree: entree(42), env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 0);
  assert.match(sortie.systemMessage, /agent-hors-table/);
  assert.equal(journal.agent, null);
  assert.equal(journal.raison, "agent-hors-table");
});

test("subagent_type absent : routé comme general-purpose (repli documenté de l'outil Agent)", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9));
  const e = { tool_name: "Agent", tool_input: { description: "d", prompt: BRIEF } };
  const { sortie, journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
  assert.equal(journal.agent, "general-purpose");
  assert.equal(journal.avisJev.modele, "opus");
  assert.equal(sortie.hookSpecificOutput, undefined);
});

test("avis en repli d'un agent sans défaut : rien réécrit, retenu null, message du frontmatter ou de la session", async () => {
  const { fn } = fetchQuiRend({});
  const { sortie, journal } = await decider({ entree: entree("Explore"), env: {}, fetchFn: fn, maintenant });
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(sortie.systemMessage, "Jev : Explore sans model, modèle du frontmatter ou de la session ; avis en repli (cle-absente)");
  assert.equal(journal.retenu, null);
  assert.equal(journal.defaut, null);
});

test("chaque agent du plugin est dans BANDES ou EXCLUS, avec le défaut de son frontmatter", () => {
  const dossier = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith(".md"));
  assert.ok(fichiers.length > 0, `${dossier} : aucun agent`);
  for (const fichier of fichiers) {
    const role = fichier.slice(0, -3);
    const qualifie = `${PREFIXE}:${role}`;
    const texte = fs.readFileSync(path.join(dossier, fichier), "utf8");
    const entete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texte);
    assert.notEqual(entete, null, `${role} : pas de frontmatter`);
    assert.equal(/^name:\s*(\S+)\s*$/m.exec(entete[1])?.[1], role, `${fichier} : name: différent du fichier`);
    if (EXCLUS.includes(qualifie)) continue;
    assert.ok(Object.hasOwn(BANDES, qualifie), `${role} : ni dans BANDES ni dans EXCLUS (le hook le signalerait agent-hors-table)`);
    const modele = /^model:\s*(\S+)\s*$/m.exec(entete[1]);
    assert.notEqual(modele, null, `${role} : pas de ligne model:`);
    assert.equal(modele[1], BANDES[qualifie].defaut, role);
  }
  for (const role of Object.keys(BANDES)) {
    assert.ok(SANS_FICHIER.includes(role) || fichiers.includes(`${role.slice(PREFIXE.length + 1)}.md`), `${role} : ni fichier d'agent ni agent intégré connu`);
  }
});

test("lireReponse : argmax, égalité vers le haut", () => {
  assert.equal(lireReponse(reponseJev({ 0: 0.1, 1: 0.7, 2: 0.2 }, 0.8))?.niveau, 1);
  assert.equal(lireReponse(reponseJev({ 0: 0.5, 1: 0, 2: 0.5 }, 0.6))?.niveau, 2);
});

test("lireReponse : réponses invalides", () => {
  assert.equal(lireReponse(null), null);
  assert.equal(lireReponse({ answers: {} }), null);
  assert.equal(lireReponse(reponseJev({ 0: 0.5, 1: 0.5 }, 0.9)), null);
  assert.equal(lireReponse(reponseJev({ 0: "x", 1: 0.5, 2: 0.5 }, 0.9)), null);
  assert.equal(lireReponse(reponseJev({ 0: 0.2, 1: 0.3, 2: 0.5 }, Number.NaN)), null);
});

test("implementeur mécanique sans model : avis haiku journalisé, entrée non réécrite", async () => {
  const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(appels[0].init.headers.Authorization, "Bearer cle-de-test");
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(sortie.systemMessage, "Jev : softwarefactory:implementeur sans model, modèle du frontmatter ou de la session (avis : haiku, mechanical, confiance 0.84)");
  assert.equal(journal.retenu, null);
  assert.equal(journal.raison, "model-absent");
  assert.deepEqual(journal.avisJev, { niveau: "mechanical", modele: "haiku", confiance: 0.84 });
  assert.equal(journal.avisJevRaison, null);
  assert.equal(journal.defaut, "sonnet");
  assert.equal(journal.longueurBrief, BRIEF.length);
  for (const cle of ["niveau", "confiance"]) assert.equal(cle in journal, false, cle);
});

const REPLIS_AVIS = [
  ["clé absente", () => ({ env: {}, ...fetchQuiRend({}) }), "cle-absente", 0],
  ["réseau", () => {
    const appels = [];
    return { env: ENV, appels, fn: async (url, init) => { appels.push({ url, init }); throw new Error("ECONNRESET"); } };
  }, "reseau", 1],
  ["HTTP 403", () => ({ env: ENV, ...fetchQuiRend({}, 403) }), "http-403", 1],
  ["réponse invalide", () => ({ env: ENV, ...fetchQuiRend({ answers: {} }) }), "reponse-invalide", 1],
  ["confiance basse", () => ({ env: ENV, ...fetchQuiRend(reponseJev({ 0: 0.4, 1: 0.3, 2: 0.3 }, 0.3)) }), "confiance-basse", 1],
  ["confiance 0,49", () => ({ env: ENV, ...fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.49)) }), "confiance-basse", 1],
];

for (const [nom, preparer, raison, appelsAttendus] of REPLIS_AVIS) {
  test(`model absent, avis en repli : ${nom}`, async () => {
    const { env, fn, appels } = preparer();
    const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur"), env, fetchFn: fn, maintenant });
    assert.equal(sortie.hookSpecificOutput, undefined);
    assert.equal(sortie.systemMessage, `Jev : softwarefactory:implementeur sans model, modèle du frontmatter ou de la session ; avis en repli (${raison})`);
    assert.equal(journal.raison, "model-absent");
    assert.equal(journal.retenu, null);
    assert.equal(journal.avisJev, null);
    assert.equal(journal.avisJevRaison, raison);
    assert.equal(appels.length, appelsAttendus);
  });
}

test("confiance exactement au seuil 0,5 : pas de repli", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.5));
  const { journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  assert.equal(journal.avisJev.modele, "haiku");
  assert.equal(journal.avisJevRaison, null);
});

test("model absent, brief absent : avis en repli brief-absent, aucun appel", async () => {
  const { fn, appels } = fetchQuiRend({});
  const e = { tool_name: "Agent", tool_input: { subagent_type: "softwarefactory:analyste" } };
  const { sortie, journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 0);
  assert.match(sortie.systemMessage, /avis en repli \(brief-absent\)/);
  assert.equal(journal.raison, "model-absent");
  assert.equal(journal.avisJevRaison, "brief-absent");
});

test("model \"\" est traité comme absent", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.9));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur", { model: "" }), env: ENV, fetchFn: fn, maintenant });
  assert.equal(journal.raison, "model-absent");
  assert.equal(journal.retenu, null);
  assert.equal(sortie.hookSpecificOutput, undefined);
});

test("prompt \"\" : avis en repli brief-absent, model absent comme model explicite, aucun appel", async () => {
  for (const extra of [{}, { model: "opus" }]) {
    const { fn, appels } = fetchQuiRend({});
    const { journal } = await decider({ entree: entree("softwarefactory:implementeur", { prompt: "", ...extra }), env: ENV, fetchFn: fn, maintenant });
    assert.equal(appels.length, 0);
    assert.equal(journal.avisJevRaison, "brief-absent");
    assert.equal(journal.raison, extra.model === undefined ? "model-absent" : "model-explicite");
  }
});

test("confiance 0,49 : avis en repli confiance-basse, model explicite comme model absent", async () => {
  for (const extra of [{}, { model: "opus" }]) {
    const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.49));
    const { journal } = await decider({ entree: entree("softwarefactory:implementeur", extra), env: ENV, fetchFn: fn, maintenant });
    assert.equal(journal.avisJev, null);
    assert.equal(journal.avisJevRaison, "confiance-basse");
  }
});

test("aucune branche ne rend hookSpecificOutput", async () => {
  const bon = fetchQuiRend(reponseJev({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9));
  const cas = [
    ["explicite", entree("softwarefactory:implementeur", { model: "opus" }), ENV, bon.fn],
    ["absent", entree("softwarefactory:implementeur"), ENV, bon.fn],
    ["model vide", entree("softwarefactory:implementeur", { model: "" }), ENV, bon.fn],
    ["repli clé", entree("softwarefactory:implementeur"), {}, bon.fn],
    ["repli brief", entree("softwarefactory:implementeur", { prompt: "" }), ENV, bon.fn],
    ["repli confiance", entree("softwarefactory:implementeur"), ENV, fetchQuiRend(reponseJev({ 0: 0.4, 1: 0.3, 2: 0.3 }, 0.3)).fn],
    ["hors table", entree("agent-inconnu"), ENV, bon.fn],
    ["Agent session-cloud", entree("softwarefactory:session-cloud"), ENV, bon.fn],
    ["create_session", entreeSession(), ENV, bon.fn],
    ["create_session explicite", entreeSession({ model: "opus" }), ENV, bon.fn],
    ["exclu", entree("softwarefactory:relecteur"), ENV, bon.fn],
  ];
  for (const [nom, e, env, fn] of cas) {
    const { sortie } = await decider({ entree: e, env, fetchFn: fn, maintenant });
    if (nom === "exclu") assert.equal(sortie, null, nom);
    else assert.deepEqual(Object.keys(sortie), ["systemMessage"], nom);
  }
  for (const [nom, brut] of [["entrée illisible", "pas du json"], ["erreur interne", JSON.stringify(entree("softwarefactory:implementeur"))]]) {
    const env = nom === "erreur interne" ? new Proxy({}, { get() { throw new Error("boom"); } }) : ENV;
    const { sortie } = await traiter({ brut, env, fetchFn: bon.fn, maintenant });
    assert.deepEqual(Object.keys(sortie), ["systemMessage"], nom);
  }
});

test("model explicite : gardé, avis de Jev journalisé, un appel", async () => {
  const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur", { model: "opus" }), env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 1);
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.match(sortie.systemMessage, /model explicite opus conservé \(avis : haiku, mechanical, confiance 0\.84\)/);
  assert.equal(journal.retenu, "opus");
  assert.equal(journal.raison, "model-explicite");
  assert.deepEqual(journal.avisJev, { niveau: "mechanical", modele: "haiku", confiance: 0.84 });
  assert.equal(journal.avisJevRaison, null);
  assert.ok(!JSON.stringify(journal).includes("Renomme"));
  assert.ok(!sortie.systemMessage.includes("Renomme"));
});

test("model explicite : l'avis est borné dans la bande du type", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9));
  const { journal } = await decider({ entree: entree("softwarefactory:executant-basic", { model: "haiku" }), env: ENV, fetchFn: fn, maintenant });
  assert.deepEqual(journal.avisJev, { niveau: "frontier", modele: "sonnet", confiance: 0.9 });
});

for (const [nom, preparer, raison, appelsAttendus] of [
  ["clé absente", () => ({ env: {}, ...fetchQuiRend({}) }), "cle-absente", 0],
  ["HTTP 500", () => ({ env: ENV, ...fetchQuiRend({}, 500) }), "http-500", 1],
  ["réponse invalide", () => ({ env: ENV, ...fetchQuiRend({ answers: {} }) }), "reponse-invalide", 1],
  ["confiance basse", () => ({ env: ENV, ...fetchQuiRend(reponseJev({ 0: 0.4, 1: 0.3, 2: 0.3 }, 0.3)) }), "confiance-basse", 1],
]) {
  test(`model explicite, avis en repli : ${nom}`, async () => {
    const { env, fn, appels } = preparer();
    const { sortie, journal } = await decider({ entree: entree("Explore", { model: "sonnet" }), env, fetchFn: fn, maintenant });
    assert.equal(appels.length, appelsAttendus);
    assert.equal(sortie.hookSpecificOutput, undefined);
    assert.equal(sortie.systemMessage, `Jev : Explore, model explicite sonnet conservé ; avis en repli (${raison})`);
    assert.equal(journal.retenu, "sonnet");
    assert.equal(journal.raison, "model-explicite");
    assert.equal(journal.avisJev, null);
    assert.equal(journal.avisJevRaison, raison);
  });
}

test("model explicite, brief absent : avis en repli brief-absent, aucun appel", async () => {
  const { fn, appels } = fetchQuiRend({});
  const e = { tool_name: "Agent", tool_input: { subagent_type: "softwarefactory:analyste", model: "opus" } };
  const { sortie, journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 0);
  assert.equal(sortie.systemMessage, "Jev : softwarefactory:analyste, model explicite opus conservé ; avis en repli (brief-absent)");
  assert.equal(journal.avisJev, null);
  assert.equal(journal.avisJevRaison, "brief-absent");
});

test("le brief ne fuit ni dans le journal ni dans le message", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0, 1: 0, 2: 1 }, 0.95));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  assert.ok(!JSON.stringify(journal).includes("Renomme"));
  assert.ok(!sortie.systemMessage.includes("Renomme"));
});

test("brief tronqué à 32 000 caractères", async () => {
  const { fn, appels } = fetchQuiRend(reponseJev({ 0: 1, 1: 0, 2: 0 }, 0.9));
  await decider({ entree: entree("softwarefactory:implementeur", { prompt: "x".repeat(40_000) }), env: ENV, fetchFn: fn, maintenant });
  assert.equal(JSON.parse(appels[0].init.body).state.length, 32_000);
});

test("contrat de requête : POST JSON, jev-latest, question score à 3 critères", async () => {
  const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  const { init } = appels[0];
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
  const corps = JSON.parse(init.body);
  assert.equal(corps.model, "jev-latest");
  assert.equal(corps.state, BRIEF);
  assert.deepEqual(Object.keys(corps.questions), ["complexite"]);
  const question = corps.questions.complexite;
  assert.equal(question.type, "score");
  assert.equal(question.criteria.length, 3);
  assert.ok(typeof question.instructions === "string" && question.instructions !== "");
});

// AbortSignal.timeout ne retient pas la boucle d'événements : en production la
// socket de fetch le fait ; ici, sans handle, Node annulerait le test.
function attendreAbandon(signal, rejeter) {
  const garde = minuter(() => {
    rejeter(new Error("le signal d'abandon n'est jamais arrivé"));
  }, 10_000);
  signal.addEventListener("abort", () => {
    annuler(garde);
    rejeter(signal.reason);
  });
}

// Rend aussi les signaux reçus : un fetch qui rejette un TypeError faute de
// signal serait sinon classé reseau et passerait pour un délai respecté.
function fetchQuiNeRepondJamais() {
  const signaux = [];
  const fn = (_url, init) =>
    new Promise((_resolu, rejete) => {
      signaux.push(init.signal);
      attendreAbandon(init.signal, rejete);
    });
  return { fn, signaux };
}

test("délai dépassé à l'envoi : repli reseau en moins d'une seconde", async () => {
  const { fn, signaux } = fetchQuiNeRepondJamais();
  const debut = Date.now();
  const { sortie, journal } = await decider({
    entree: entree("softwarefactory:implementeur"),
    env: ENV,
    fetchFn: fn,
    maintenant,
    delaiMs: 50,
  });
  assert.ok(Date.now() - debut < 1000, `durée ${String(Date.now() - debut)} ms`);
  assert.ok(signaux[0] instanceof AbortSignal, "fetch doit recevoir un AbortSignal");
  assert.match(sortie.systemMessage, /reseau/);
  assert.equal(journal.avisJevRaison, "reseau");
});

test("model explicite, avis en repli : délai dépassé", async () => {
  const { fn } = fetchQuiNeRepondJamais();
  const debut = Date.now();
  const { sortie, journal } = await decider({
    entree: entree("Explore", { model: "sonnet" }),
    env: ENV,
    fetchFn: fn,
    maintenant,
    delaiMs: 50,
  });
  assert.ok(Date.now() - debut < 1000, `durée ${String(Date.now() - debut)} ms`);
  assert.equal(sortie.systemMessage, "Jev : Explore, model explicite sonnet conservé ; avis en repli (reseau)");
  assert.equal(journal.avisJevRaison, "reseau");
});

test("délai par défaut : 3 s", async () => {
  const { fn } = fetchQuiNeRepondJamais();
  const debut = Date.now();
  const { journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  const duree = Date.now() - debut;
  assert.equal(journal.avisJevRaison, "reseau");
  assert.ok(duree >= 2500 && duree < 5000, `durée ${String(duree)} ms`);
});

test("délai dépassé pendant la lecture du corps : repli reseau", async () => {
  const fn = async (_url, init) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolu, rejete) => {
        attendreAbandon(init.signal, rejete);
      }),
  });
  const { sortie, journal } = await decider({
    entree: entree("softwarefactory:implementeur"),
    env: ENV,
    fetchFn: fn,
    maintenant,
    delaiMs: 50,
  });
  assert.match(sortie.systemMessage, /reseau/);
  assert.equal(journal.avisJevRaison, "reseau");
});

test("corps non JSON sans délai dépassé : repli reponse-invalide", async () => {
  const fn = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  });
  const { journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  assert.equal(journal.avisJevRaison, "reponse-invalide");
});

test("lireReponse : la distribution somme à 1 ± 0,01 et reste dans [0, 1]", () => {
  assert.equal(lireReponse(reponseJev({ 0: 0, 1: 0, 2: 0 }, 0.9)), null);
  assert.equal(lireReponse(reponseJev({ 0: 0.3, 1: 0.3, 2: 0.3 }, 0.9)), null);
  assert.equal(lireReponse(reponseJev({ 0: 1.5, 1: 0, 2: 0 }, 0.9)), null);
  assert.equal(lireReponse(reponseJev({ 0: 0.5, 1: 0.3, 2: 0.205 }, 0.9))?.niveau, 0);
});

test("distribution nulle : repli reponse-invalide, pas une décision sur le niveau 2", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0, 1: 0, 2: 0 }, 0.95));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:implementeur"), env: ENV, fetchFn: fn, maintenant });
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(journal.avisJevRaison, "reponse-invalide");
});

test("journal : session_id et tool_use_id de l'événement, quand ce sont des chaînes", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  const e = { ...entree("softwarefactory:implementeur"), session_id: "session-1", tool_use_id: "toolu_1" };
  const { journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
  assert.equal(journal.session_id, "session-1");
  assert.equal(journal.tool_use_id, "toolu_1");
  const repli = await decider({ entree: e, env: {}, fetchFn: fn, maintenant });
  assert.equal(repli.journal.session_id, "session-1");
  assert.equal(repli.journal.tool_use_id, "toolu_1");
});

test("journal : identifiants absents ou non textuels, pas de clé", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  const e = { ...entree("softwarefactory:implementeur"), session_id: 42 };
  const { journal } = await decider({ entree: e, env: ENV, fetchFn: fn, maintenant });
  assert.equal("session_id" in journal, false);
  assert.equal("tool_use_id" in journal, false);
});

test("traiter : entrée illisible ou vide → repli entree-illisible, journalisé", async () => {
  for (const brut of ["pas du json", "", "{\"tool_input\":"]) {
    const { fn, appels } = fetchQuiRend({});
    const r = await traiter({ brut, env: ENV, fetchFn: fn, maintenant });
    assert.equal(r.sortie.systemMessage, "Jev : repli (entree-illisible), appel inchangé");
    assert.equal(r.sortie.hookSpecificOutput, undefined);
    assert.deepEqual(r.journal, { date: "2026-10-12T00:00:00.000Z", raison: "entree-illisible" });
    assert.match(r.diagnostic, /entrée illisible/);
    assert.equal(appels.length, 0);
  }
});

test("traiter : erreur inattendue dans la décision → repli erreur-interne, sans le brief", async () => {
  const envQuiLeve = new Proxy({}, {
    get() {
      throw new Error("boom");
    },
  });
  const { fn } = fetchQuiRend({});
  const r = await traiter({ brut: JSON.stringify(entree("softwarefactory:implementeur")), env: envQuiLeve, fetchFn: fn, maintenant });
  assert.equal(r.sortie.systemMessage, "Jev : repli (erreur-interne), appel inchangé");
  assert.equal(r.sortie.hookSpecificOutput, undefined);
  assert.deepEqual(r.journal, { date: "2026-10-12T00:00:00.000Z", raison: "erreur-interne" });
  assert.match(r.diagnostic, /erreur interne : boom/);
});

test("traiter : événement valide → décision de decider, sans diagnostic", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84));
  const r = await traiter({ brut: JSON.stringify(entree("softwarefactory:implementeur")), env: ENV, fetchFn: fn, maintenant });
  assert.equal(r.sortie.hookSpecificOutput, undefined);
  assert.equal(r.journal.avisJev.modele, "haiku");
  assert.equal(r.diagnostic, null);
  const nonRoute = await traiter({ brut: JSON.stringify(entree("softwarefactory:relecteur")), env: ENV, fetchFn: fn, maintenant });
  assert.deepEqual(nonRoute, { sortie: null, journal: null, diagnostic: null });
});

// Point d'entrée : lancé en sous-processus, comme Claude Code le lance, avec un
// dossier de projet temporaire et un faux serveur Jev local (TYPESAFE_BASE_URL).
const POINT_ENTREE = path.join(path.dirname(fileURLToPath(import.meta.url)), "jev-model.mjs");

function lancerHook(stdin, env) {
  return new Promise((resolu, rejete) => {
    const enfant = spawn(process.execPath, [POINT_ENTREE], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    enfant.stdout.setEncoding("utf8");
    enfant.stderr.setEncoding("utf8");
    enfant.stdout.on("data", (morceau) => {
      stdout += morceau;
    });
    enfant.stderr.on("data", (morceau) => {
      stderr += morceau;
    });
    enfant.on("error", rejete);
    enfant.on("close", (code) => {
      resolu({ code, stdout, stderr });
    });
    enfant.stdin.end(stdin);
  });
}

async function avecProjetTemporaire(corps) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "jev-model-"));
  try {
    return await corps(dossier);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

function lireJournal(dossier) {
  const chemin = path.join(dossier, ".claude", "logs", "jev-model.jsonl");
  if (!fs.existsSync(chemin)) return [];
  return fs
    .readFileSync(chemin, "utf8")
    .split("\n")
    .filter((ligne) => ligne !== "")
    .map((ligne) => JSON.parse(ligne));
}

async function avecFauxJev(corpsReponse, corps) {
  const requetes = [];
  const serveur = http.createServer((req, res) => {
    let recu = "";
    req.setEncoding("utf8");
    req.on("data", (morceau) => {
      recu += morceau;
    });
    req.on("end", () => {
      requetes.push({ url: req.url, authorization: req.headers.authorization, corps: JSON.parse(recu) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(corpsReponse));
    });
  });
  await new Promise((resolu) => {
    serveur.listen(0, "127.0.0.1", resolu);
  });
  try {
    return await corps(`http://127.0.0.1:${String(serveur.address().port)}`, requetes);
  } finally {
    serveur.closeAllConnections();
    await new Promise((resolu) => {
      serveur.close(resolu);
    });
  }
}

function envEnfant(dossier, extra = {}) {
  return { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: dossier, ...extra };
}

const EVENEMENT = {
  ...entree("softwarefactory:implementeur"),
  session_id: "session-1",
  tool_use_id: "toolu_1",
};

test("point d'entrée : réponse mécanique → stdout sans hookSpecificOutput, avis haiku au journal", async () => {
  await avecProjetTemporaire((dossier) =>
    avecFauxJev(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84), async (url, requetes) => {
      const env = envEnfant(dossier, { TYPESAFE_API_KEY: "cle-de-test", TYPESAFE_BASE_URL: url });
      const { code, stdout } = await lancerHook(JSON.stringify(EVENEMENT), env);
      assert.equal(code, 0);
      const sortie = JSON.parse(stdout);
      assert.equal(sortie.hookSpecificOutput, undefined);
      assert.match(sortie.systemMessage, /softwarefactory:implementeur sans model.*avis : haiku/);
      assert.equal(requetes.length, 1);
      assert.equal(requetes[0].url, "/v1/systemone");
      assert.equal(requetes[0].authorization, "Bearer cle-de-test");
      const journal = lireJournal(dossier);
      assert.equal(journal.length, 1);
      assert.equal(journal[0].raison, "model-absent");
      assert.equal(journal[0].retenu, null);
      assert.equal(journal[0].avisJev.modele, "haiku");
      assert.equal(journal[0].session_id, "session-1");
      assert.equal(journal[0].tool_use_id, "toolu_1");
      assert.ok(!JSON.stringify(journal[0]).includes("Renomme"));
    }),
  );
});

test("point d'entrée : sans clé → cle-absente sur stdout et dans le journal", async () => {
  await avecProjetTemporaire(async (dossier) => {
    const { code, stdout } = await lancerHook(JSON.stringify(EVENEMENT), envEnfant(dossier));
    assert.equal(code, 0);
    const sortie = JSON.parse(stdout);
    assert.match(sortie.systemMessage, /cle-absente/);
    assert.equal(sortie.hookSpecificOutput, undefined);
    const journal = lireJournal(dossier);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].avisJevRaison, "cle-absente");
  });
});

for (const type of ["softwarefactory:relecteur", "softwarefactory:relecteur-basic", "fork", "statusline-setup"]) {
  test(`point d'entrée : ${type} exclu → stdout vide, aucune ligne de journal`, async () => {
    await avecProjetTemporaire(async (dossier) => {
      const { code, stdout } = await lancerHook(JSON.stringify(entree(type, { model: "opus" })), envEnfant(dossier, { TYPESAFE_API_KEY: "k" }));
      assert.equal(code, 0);
      assert.equal(stdout, "");
      assert.deepEqual(lireJournal(dossier), []);
    });
  });
}

test("point d'entrée : journal non écrivable → avis conservé et ligne journal-non-ecrit à l'écran, signalé sur stderr", async () => {
  await avecProjetTemporaire((dossier) =>
    avecFauxJev(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.84), async (url) => {
      fs.writeFileSync(path.join(dossier, ".claude"), "un fichier, pas un dossier");
      const env = envEnfant(dossier, { TYPESAFE_API_KEY: "cle-de-test", TYPESAFE_BASE_URL: url });
      const { code, stdout, stderr } = await lancerHook(JSON.stringify(EVENEMENT), env);
      assert.equal(code, 0);
      assert.deepEqual(JSON.parse(stdout), {
        systemMessage:
          "Jev : softwarefactory:implementeur sans model, modèle du frontmatter ou de la session (avis : haiku, mechanical, confiance 0.84)\nJev : dispatch non journalisé (journal-non-ecrit)",
      });
      assert.match(stderr, /journal non écrit/);
    }),
  );
});

for (const [nom, stdin] of [
  ["JSON invalide", "pas du json"],
  ["stdin vide", ""],
]) {
  test(`point d'entrée : ${nom} → entree-illisible sur stdout et dans le journal, code 0`, async () => {
    await avecProjetTemporaire(async (dossier) => {
      const { code, stdout, stderr } = await lancerHook(stdin, envEnfant(dossier));
      assert.equal(code, 0);
      assert.match(stderr, /entrée illisible.*appel inchangé/);
      assert.notEqual(stdout, "", "stdout vide : l'utilisateur ne voit aucun repli");
      assert.equal(JSON.parse(stdout).systemMessage, "Jev : repli (entree-illisible), appel inchangé");
      const journal = lireJournal(dossier);
      assert.equal(journal.length, 1);
      assert.equal(journal[0].raison, "entree-illisible");
    });
  });
}

function entreeSession(extra = {}) {
  return { tool_name: OUTIL_SESSION, tool_input: { prompt: BRIEF, ...extra } };
}

test("OUTIL_SESSION : nom de l'outil relevé par la sonde de #2551", () => {
  assert.equal(OUTIL_SESSION, "mcp__claude-code-remote__create_session");
});

test("create_session : avis borné dans la bande sonnet, opus ; rien réécrit", async () => {
  for (const [distribution, attendu] of [
    [{ 0: 0.9, 1: 0.1, 2: 0 }, "sonnet"],
    [{ 0: 0.1, 1: 0.8, 2: 0.1 }, "sonnet"],
    [{ 0: 0, 1: 0.1, 2: 0.9 }, "opus"],
  ]) {
    const { fn, appels } = fetchQuiRend(reponseJev(distribution, 0.9));
    const { sortie, journal } = await decider({ entree: entreeSession(), env: ENV, fetchFn: fn, maintenant });
    assert.equal(appels.length, 1);
    assert.equal(JSON.parse(appels[0].init.body).state, BRIEF);
    assert.equal(journal.agent, "softwarefactory:session-cloud");
    assert.equal(journal.retenu, null);
    assert.equal(journal.avisJev.modele, attendu);
    assert.equal(sortie.hookSpecificOutput, undefined);
  }
});

test("create_session : permission_mode et extra_allowed_tools ne produisent pas de hookSpecificOutput", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9));
  const extra = { permission_mode: "auto", extra_allowed_tools: ["Bash"] };
  const { sortie } = await decider({ entree: entreeSession(extra), env: ENV, fetchFn: fn, maintenant });
  assert.equal(sortie.hookSpecificOutput, undefined);
});

test("Agent avec subagent_type session-cloud : agent-hors-table, pas routé comme une session cloud", async () => {
  const { fn, appels } = fetchQuiRend(reponseJev({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9));
  const { sortie, journal } = await decider({ entree: entree("softwarefactory:session-cloud"), env: ENV, fetchFn: fn, maintenant });
  assert.equal(appels.length, 0);
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(journal.raison, "agent-hors-table");
  assert.equal(journal.agent, "softwarefactory:session-cloud");
});

test("create_session avec model explicite : gardé, avis journalisé", async () => {
  const { fn } = fetchQuiRend(reponseJev({ 0: 0.9, 1: 0.1, 2: 0 }, 0.9));
  const { sortie, journal } = await decider({ entree: entreeSession({ model: "opus" }), env: ENV, fetchFn: fn, maintenant });
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(journal.retenu, "opus");
  assert.deepEqual(journal.avisJev, { niveau: "mechanical", modele: "sonnet", confiance: 0.9 });
});

test("create_session sans clé : avis en repli signalé, rien réécrit", async () => {
  const { fn } = fetchQuiRend({});
  const { sortie, journal } = await decider({ entree: entreeSession(), env: {}, fetchFn: fn, maintenant });
  assert.equal(sortie.hookSpecificOutput, undefined);
  assert.equal(sortie.systemMessage, "Jev : softwarefactory:session-cloud sans model, modèle du frontmatter ou de la session ; avis en repli (cle-absente)");
  assert.equal(journal.avisJevRaison, "cle-absente");
});

function commandesDuHook(evenement, matcher) {
  const chemin = path.join(path.dirname(fileURLToPath(import.meta.url)), "hooks.json");
  const reglages = JSON.parse(fs.readFileSync(chemin, "utf8"));
  const entrees = reglages.hooks[evenement] ?? [];
  return entrees.filter((e) => e.matcher === matcher).flatMap((e) => e.hooks.map((h) => h.command));
}

test("hooks.json : PreToolUse create_session lance jev-model.mjs", () => {
  assert.ok(commandesDuHook("PreToolUse", OUTIL_SESSION).some((c) => c.includes("hooks/jev-model.mjs")));
});
