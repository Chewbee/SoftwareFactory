import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { choisir, cleEnDouble } from "./jev-cli.mjs";

const CLI = fileURLToPath(new URL("./jev-cli.mjs", import.meta.url));
const ENV = { TYPESAFE_API_KEY: "k" };
const OPTIONS = { garder: "Garder le cache tel quel", purger: "Purger le cache au démarrage" };
function repondant(decision, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.corps = JSON.parse(init.body);
    // Passage par JSON : comme sur le réseau, une valeur undefined disparaît avec sa clé.
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ answers: { decision } })) };
  };
}

test("choix valide : question Choice, option retenue = argmax, confiance", async () => {
  const capture = {};
  const r = await choisir({ etat: "raisonnement", options: OPTIONS, env: ENV,
    fetchFn: repondant({ type: "choice", choice: "purger", probabilities: { garder: 0.2, purger: 0.8 }, confidence: 0.7 }, capture) });
  assert.deepEqual(r, { choix: "purger", confiance: 0.7, probabilites: { garder: 0.2, purger: 0.8 }, aTrancher: false, raison: null, tronque: false });
  assert.match(capture.url, /\/v1\/systemone$/);
  assert.equal(capture.corps.state, "raisonnement");
  assert.equal(capture.corps.questions.decision.type, "choice");
  assert.deepEqual(capture.corps.questions.decision.criteria, OPTIONS);
});

test("confiance 0,4 : à trancher, l'agent garde son choix", async () => {
  const r = await choisir({ etat: "x", options: OPTIONS, env: ENV,
    fetchFn: repondant({ type: "choice", choice: "garder", probabilities: { garder: 0.55, purger: 0.45 }, confidence: 0.4 }) });
  assert.equal(r.aTrancher, true);
  assert.equal(r.raison, "confiance-basse");
  assert.equal(r.choix, "garder");
  assert.equal(r.tronque, false);
});

test("clé absente : repli signalé, aucun appel réseau", async () => {
  let appels = 0;
  const r = await choisir({ etat: "x", options: OPTIONS, env: {}, fetchFn: async () => { appels += 1; } });
  assert.equal(appels, 0);
  assert.deepEqual(r, { choix: null, confiance: null, probabilites: null, aTrancher: true, raison: "cle-absente", tronque: false });
});

test("réponse hors format : option inconnue ou somme ≠ 1 → reponse-invalide", async () => {
  for (const probabilities of [{ garder: 0.5, autre: 0.5 }, { garder: 0.5, purger: 0.2 }, { garder: 1 }, { garder: 0.3, purger: 0.7, autre: 0 }]) {
    const r = await choisir({ etat: "x", options: OPTIONS, env: ENV, fetchFn: repondant({ type: "choice", probabilities, confidence: 0.9 }) });
    assert.equal(r.raison, "reponse-invalide");
    assert.equal(r.choix, null);
    assert.equal(r.aTrancher, true);
    assert.equal(r.tronque, false);
  }
});

test("réponse dont le type n'est pas choice : reponse-invalide, à trancher", async () => {
  for (const type of ["score", undefined]) {
    const r = await choisir({ etat: "x", options: OPTIONS, env: ENV,
      fetchFn: repondant({ type, choice: "purger", probabilities: { garder: 0.2, purger: 0.8 }, confidence: 0.9 }) });
    assert.equal(r.raison, "reponse-invalide", String(type));
    assert.equal(r.aTrancher, true, String(type));
    assert.equal(r.choix, null, String(type));
  }
});

test("égalité 0,5 / 0,5 avec choice quelconque ou absent : lisible, confiance-basse, pas reponse-invalide", async () => {
  for (const choice of ["purger", undefined]) {
    const r = await choisir({ etat: "x", options: OPTIONS, env: ENV,
      fetchFn: repondant({ type: "choice", choice, probabilities: { garder: 0.5, purger: 0.5 }, confidence: 0 }) });
    assert.equal(r.raison, "confiance-basse");
    assert.equal(r.aTrancher, true);
  }
});

test("entrées invalides : erreur bruyante", async () => {
  const f = async () => { throw new Error("pas d'appel attendu"); };
  await assert.rejects(choisir({ etat: "x", options: { seule: "A" }, env: ENV, fetchFn: f }), /options/);
  const onze = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`o${i}`, "d"]));
  await assert.rejects(choisir({ etat: "x", options: onze, env: ENV, fetchFn: f }), /options/);
  await assert.rejects(choisir({ etat: "x", options: { a: "A", b: "" }, env: ENV, fetchFn: f }), /options/);
  await assert.rejects(choisir({ etat: "  ", options: OPTIONS, env: ENV, fetchFn: f }), /état/);
});

test("CLI choix : JSON invalide → code 2 ; sans clé → repli JSON et stderr", () => {
  const ko = spawnSync(process.execPath, [CLI, "choix"], { input: "pas du json", encoding: "utf8", env: {} });
  assert.equal(ko.status, 2);
  const repli = spawnSync(process.execPath, [CLI, "choix"], { input: JSON.stringify({ etat: "x", options: OPTIONS }), encoding: "utf8", env: {} });
  assert.equal(repli.status, 0);
  assert.deepEqual(JSON.parse(repli.stdout), { choix: null, confiance: null, probabilites: null, aTrancher: true, raison: "cle-absente", tronque: false });
  assert.match(repli.stderr, /repli \(cle-absente\)/);
  assert.doesNotMatch(repli.stderr, /tronqué/);
});

test("état de 32 000 caractères : tronque faux ; 32 001 : tronque vrai ; Jev en reçoit 32 000", async () => {
  for (const [longueur, tronque] of [[32_000, false], [32_001, true]]) {
    const capture = {};
    const r = await choisir({ etat: "x".repeat(longueur), options: OPTIONS, env: ENV,
      fetchFn: repondant({ type: "choice", probabilities: { garder: 0.2, purger: 0.8 }, confidence: 0.9 }, capture) });
    assert.equal(r.tronque, tronque, String(longueur));
    assert.equal(r.choix, "purger", String(longueur));
    assert.equal(capture.corps.state.length, 32_000, String(longueur));
  }
});

test("état de 32 001 caractères en repli : tronque vrai aussi", async () => {
  const r = await choisir({ etat: "x".repeat(32_001), options: OPTIONS, env: {}, fetchFn: async () => { throw new Error("pas d'appel attendu"); } });
  assert.deepEqual(r, { choix: null, confiance: null, probabilites: null, aTrancher: true, raison: "cle-absente", tronque: true });
});

test("état de 32 001 caractères avec réponse valide : aTrancher vrai, raison etat-tronque", async () => {
  const r = await choisir({ etat: "x".repeat(32_001), options: OPTIONS, env: ENV,
    fetchFn: repondant({ type: "choice", probabilities: { garder: 0.2, purger: 0.8 }, confidence: 0.9 }) });
  assert.deepEqual(r, { choix: "purger", confiance: 0.9, probabilites: { garder: 0.2, purger: 0.8 }, aTrancher: true, raison: "etat-tronque", tronque: true });
});

test("CLI choix : état de 32 001 caractères → tronque vrai, code 0, message sur stderr", () => {
  const r = spawnSync(process.execPath, [CLI, "choix"], { input: JSON.stringify({ etat: "x".repeat(32_001), options: OPTIONS }), encoding: "utf8", env: {} });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).tronque, true);
  assert.match(r.stderr, /Jev : état tronqué à 32000 caractères sur 32001, Jev n'a pas lu la suite/);
  assert.match(r.stderr, /repli \(cle-absente\)/);
});

test("état de 32 001 caractères en confiance basse ou réponse invalide : tronque vrai", async () => {
  const cas = [
    ["confiance-basse", { type: "choice", probabilities: { garder: 0.2, purger: 0.8 }, confidence: 0.4 }],
    ["reponse-invalide", { type: "choice", probabilities: { garder: 0.5, autre: 0.5 }, confidence: 0.9 }],
  ];
  for (const [raison, reponse] of cas) {
    const r = await choisir({ etat: "x".repeat(32_001), options: OPTIONS, env: ENV, fetchFn: repondant(reponse) });
    assert.equal(r.raison, raison, raison);
    assert.equal(r.aTrancher, true, raison);
    assert.equal(r.tronque, true, raison);
  }
});

test("CLI choix : 1 option, 11 options, nom vide ou blanc, clé en double → code 2, message, stdout vide", () => {
  const onze = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`o${String(i)}`, "d"]));
  for (const [entree, message] of [
    [JSON.stringify({ etat: "x", options: { seule: "A" } }), /options/],
    [JSON.stringify({ etat: "x", options: onze }), /options/],
    [JSON.stringify({ etat: "x", options: { "": "A", b: "B" } }), /options/],
    [JSON.stringify({ etat: "x", options: { " ": "A", b: "B" } }), /options/],
    ['{"etat":"x","options":{"a":"A","a":"B","b":"C"}}', /Jev : entrée illisible : clé en double \(a\)/],
    ['{"etat":"premier","etat":"second","options":{"a":"A","b":"B"}}', /clé en double \(etat\)/],
  ]) {
    const r = spawnSync(process.execPath, [CLI, "choix"], { input: entree, encoding: "utf8", env: {} });
    assert.equal(r.status, 2, entree);
    assert.match(r.stderr, message, entree);
    assert.equal(r.stdout, "", entree);
  }
});

test("cleEnDouble : clé répétée dans un même objet, à toute profondeur, échappement compris", () => {
  assert.equal(cleEnDouble('{"etat":"x","options":{"a":"A","a":"B","b":"C"}}'), "a");
  assert.equal(cleEnDouble('{"etat":"premier","etat":"second","options":{"a":"A","b":"B"}}'), "etat");
  assert.equal(cleEnDouble('{"etat":"x","options":{"a":"A","\\u0061":"B"}}'), "a");
  assert.equal(cleEnDouble('{ "o" : { "a" : 1 ,\n\t"a" : 2 } }'), "a");
  assert.equal(cleEnDouble('{"l":[{"a":1,"a":2}]}'), "a");
});

test("cleEnDouble : même nom dans deux objets, ou cité dans une chaîne : aucun doublon", () => {
  assert.equal(cleEnDouble('{"etat":"x","options":{"a":"A","b":"B"}}'), null);
  assert.equal(cleEnDouble('{"a":{"a":1},"b":{"a":2}}'), null);
  assert.equal(cleEnDouble('{"etat":"\\"a\\":1, \\"a\\":2","options":{"a":"a:","b":"\\\\"}}'), null);
  assert.equal(cleEnDouble('{"etat":"{\\"a\\":1,\\"a\\":2}","options":{"a":"A","b":"B"}}'), null);
});

test("cleEnDouble : pile, échappements, accolades dans une chaîne, tableau, blancs", () => {
  assert.equal(cleEnDouble('{"etat":"x","options":{"a":"A","b":"B"},"etat":"y"}'), "etat");
  assert.equal(cleEnDouble('{"o":{"a":1},"a":2}'), null);
  assert.equal(cleEnDouble('{"etat":"3\\" de marge","options":{"a":"A","a":"B"}}'), "a");
  assert.equal(cleEnDouble('{"etat":"}","etat":"y"}'), "etat");
  assert.equal(cleEnDouble('{"l":[1],"a":1,"a":2}'), "a");
  assert.equal(cleEnDouble('{"a"\n:1,"a"\r\n:2}'), "a");
  assert.equal(cleEnDouble('{"etat":"C:\\\\","options":{"a":"A","a":"B","b":"C"}}'), "a");
  assert.equal(cleEnDouble('{"a"\t:1,"a"\t:2}'), "a");
});

test("CLI choix : JSON invalide avec clé répétée → erreur de JSON.parse, pas clé en double", () => {
  const r = spawnSync(process.execPath, [CLI, "choix"], { input: '{"a":1,"a":2', encoding: "utf8", env: {} });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /JSON \{ etat, options \} attendu/);
  assert.doesNotMatch(r.stderr, /clé en double/);
});
