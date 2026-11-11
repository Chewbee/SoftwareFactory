import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import { noterTache, faireBilan, formaterBilan } from "./jev-cli.mjs";
import { BANDES, QUESTION } from "./jev-model-core.mjs";

const CLI = fileURLToPath(new URL("./jev-cli.mjs", import.meta.url));
const ENV = { TYPESAFE_API_KEY: "k" };
function repondant(probabilities, confidence, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.corps = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ answers: { complexite: { probabilities, confidence } } }) };
  };
}

test("réponse valide : niveau, modèle borné, même question que le hook", async () => {
  const capture = {};
  const r = await noterTache({ description: "Écrire le cœur", role: "softwarefactory:implementeur", env: ENV, fetchFn: repondant({ 0: 0.1, 1: 0.8, 2: 0.1 }, 0.82, capture) });
  assert.deepEqual(r, { niveau: "standard", modele: "sonnet", confiance: 0.82, aTrancher: false, raison: null });
  assert.deepEqual(capture.corps.questions.complexite, QUESTION);
  assert.match(capture.url, /\/v1\/systemone$/);
});

test("frontier borné à sonnet pour executant-basic", async () => {
  const r = await noterTache({ description: "x", role: "softwarefactory:executant-basic", env: ENV, fetchFn: repondant({ 0: 0, 1: 0.1, 2: 0.9 }, 0.9) });
  assert.equal(r.niveau, "frontier");
  assert.equal(r.modele, "sonnet");
  assert.equal(r.aTrancher, false);
});

test("confiance 0,4 : défaut du rôle, à trancher", async () => {
  const r = await noterTache({ description: "x", role: "softwarefactory:implementeur", env: ENV, fetchFn: repondant({ 0: 0, 1: 0, 2: 1 }, 0.4) });
  assert.deepEqual(r, { niveau: "standard", modele: "sonnet", confiance: 0.4, aTrancher: true, raison: "confiance-basse" });
});

test("clé absente : repli signalé, aucun appel réseau", async () => {
  let appels = 0;
  const r = await noterTache({ description: "x", role: "softwarefactory:executant-basic", env: {}, fetchFn: async () => { appels += 1; } });
  assert.equal(appels, 0);
  assert.deepEqual(r, { niveau: "mechanical", modele: "haiku", confiance: null, aTrancher: true, raison: "cle-absente" });
});

test("HTTP 403 : repli http-403", async () => {
  const r = await noterTache({ description: "x", role: "softwarefactory:implementeur", env: ENV, fetchFn: async () => ({ ok: false, status: 403 }) });
  assert.equal(r.raison, "http-403");
  assert.equal(r.aTrancher, true);
});

test("rôle hors bande ou description vide : erreur", async () => {
  for (const role of ["softwarefactory:relecteur", "fork", "", undefined]) {
    await assert.rejects(noterTache({ description: "x", role, env: ENV, fetchFn: repondant({ 0: 1, 1: 0, 2: 0 }, 1) }), /rôle/);
  }
  await assert.rejects(noterTache({ description: "  ", role: "softwarefactory:implementeur", env: ENV, fetchFn: async () => ({ ok: false, status: 500 }) }), /description/);
});

test("CLI : rôle refusé → code 2 ; sans clé → JSON de repli et message sur stderr", () => {
  // Sans --role, la sortie est le message d'usage, qui nomme l'option.
  for (const [args, message] of [
    [["--role", "softwarefactory:relecteur"], /rôle/],
    [["--role", "fork"], /rôle/],
    [["--role", ""], /rôle/],
    [[], /--role/],
  ]) {
    const ko = spawnSync(process.execPath, [CLI, "niveau", ...args], { input: "x", encoding: "utf8", env: {} });
    assert.equal(ko.status, 2, JSON.stringify(args));
    assert.match(ko.stderr, message, JSON.stringify(args));
  }
  const repli = spawnSync(process.execPath, [CLI, "niveau", "--role", "softwarefactory:implementeur"], { input: "Écrire X", encoding: "utf8", env: {} });
  assert.equal(repli.status, 0);
  assert.deepEqual(JSON.parse(repli.stdout), { niveau: "standard", modele: "sonnet", confiance: null, aTrancher: true, raison: "cle-absente" });
  assert.match(repli.stderr, /repli \(cle-absente\)/);
  const usage = spawnSync(process.execPath, [CLI, "autre"], { input: "", encoding: "utf8", env: {} });
  assert.equal(usage.status, 2);
});

// Attendus écrits en dur : modèle borné pour mechanical, standard, frontier.
const MODELES_PAR_ROLE = {
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

test("chaque rôle de BANDES : modèle borné attendu aux trois niveaux", async () => {
  assert.deepEqual(Object.keys(MODELES_PAR_ROLE).sort(), Object.keys(BANDES).sort());
  for (const [role, attendus] of Object.entries(MODELES_PAR_ROLE)) {
    for (const niveau of [0, 1, 2]) {
      const distribution = { 0: 0, 1: 0, 2: 0, [niveau]: 1 };
      const r = await noterTache({ description: "x", role, env: ENV, fetchFn: repondant(distribution, 0.9) });
      assert.equal(r.modele, attendus[niveau], `${role} niveau ${String(niveau)}`);
      assert.equal(r.aTrancher, false, role);
    }
  }
});

test("softwarefactory:session-cloud est accepté en CLI", () => {
  const r = spawnSync(process.execPath, [CLI, "niveau", "--role", "softwarefactory:session-cloud"], { input: "x", encoding: "utf8", env: {} });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).modele, null);
});

test("repli d'un rôle sans défaut : niveau et modèle null, à trancher", async () => {
  const r = await noterTache({ description: "x", role: "Explore", env: {}, fetchFn: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(r, { niveau: null, modele: null, confiance: null, aTrancher: true, raison: "cle-absente" });
});

test("CLI : Explore sans clé → JSON modele null, stderr garde le modèle de la session", () => {
  const r = spawnSync(process.execPath, [CLI, "niveau", "--role", "Explore"], { input: "x", encoding: "utf8", env: {} });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).modele, null);
  assert.match(r.stderr, /Explore garde le modèle de la session/);
});

const L = (o) => JSON.stringify(o);
const D = (implementeur, modele, raison, date, session) => L({ date, session_id: session, agent: implementeur, defaut: "sonnet", retenu: modele, raison });
const V = (agentId, verdict, date, session, source = "handback") => L({ date, session_id: session, agent_id: agentId, agent: "softwarefactory:relecteur", source, verdict });

const JOURNAL = [
  D("softwarefactory:implementeur", "haiku", null, "2026-11-08T10:00:00.000Z", "s1"),
  V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
  V("r1", "absent", "2026-11-08T10:10:05.000Z", "s1", "stop"),
  V("r2", "PAS PRÊT", "2026-11-08T10:20:00.000Z", "s1"),
  V("r2", "PRÊT", "2026-11-08T10:25:00.000Z", "s1"),
  D("softwarefactory:implementeur", "opus", "model-explicite", "2026-11-08T11:00:00.000Z", "s1"),
  V("r3", "PRÊT", "2026-11-08T11:30:00.000Z", "s1"),
  D("softwarefactory:executant-basic", "haiku", "cle-absente", "2026-11-08T12:00:00.000Z", "s1"),
  V("r4", "PAS PRÊT", "2026-11-08T12:10:00.000Z", "s1"),
  D("softwarefactory:implementeur", null, "model-absent", "2026-11-08T12:30:00.000Z", "s1"),
  L({ date: "2026-11-08T12:35:00.000Z", session_id: "s1", agent: "softwarefactory:analyste", defaut: "opus", retenu: "sonnet", raison: null }),
  V("r9", "PRÊT", "2026-11-08T12:40:00.000Z", "s1"),
  V("r5", "PRÊT", "2026-11-08T12:20:00.000Z", "s2"),
  V("r6", "PRÊT", "2026-11-08T12:59:00.000Z", "s3"),
  D("softwarefactory:implementeur", "sonnet", null, "2026-11-08T13:00:00.000Z", "s3"),
  V("r7", "absent", "2026-11-08T13:10:00.000Z", "s3", "stop"),
  V("r7", "absent", "2026-11-08T13:10:01.000Z", "s3", "stop"),
  L({ date: "2026-11-08T13:20:00.000Z", raison: "entree-illisible" }),
  "pas du json",
  L({ date: "pas une date", agent_id: "r8", verdict: "PRÊT" }),
  "",
].join("\n");

test("bilan : comptes, taux, non attribués, absents, illisibles", () => {
  const b = faireBilan(JOURNAL);
  assert.deepEqual(b, {
    lignes: [
      { agent: "softwarefactory:executant-basic", modele: "haiku", source: "repli", pret: 0, pasPret: 1 },
      { agent: "softwarefactory:implementeur", modele: "haiku", source: "jev", pret: 1, pasPret: 1 },
      { agent: "softwarefactory:implementeur", modele: "opus", source: "explicite", pret: 1, pasPret: 0 },
      { agent: "softwarefactory:implementeur", modele: "—", source: "sans-model", pret: 1, pasPret: 0 },
    ],
    nonAttribues: 2,
    absents: 1,
    illisibles: 2,
  });
  assert.equal(
    formaterBilan(b),
    [
      "| Agent | Modèle | Source | PRÊT | PAS PRÊT | Taux |",
      "|---|---|---|---|---|---|",
      "| softwarefactory:executant-basic | haiku | repli | 0 | 1 | 100 % |",
      "| softwarefactory:implementeur | haiku | jev | 1 | 1 | 50 % |",
      "| softwarefactory:implementeur | opus | explicite | 1 | 0 | 0 % |",
      "| softwarefactory:implementeur | — | sans-model | 1 | 0 | 0 % |",
      "",
      "verdicts non attribués : 2",
      "verdicts absents : 1",
      "lignes illisibles : 2",
      "",
    ].join("\n"),
  );
});

test("bilan : dispatch model-absent sans modèle, compté sous « — »", () => {
  const b = faireBilan([
    D("softwarefactory:executant-basic", null, "model-absent", "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [{ agent: "softwarefactory:executant-basic", modele: "—", source: "sans-model", pret: 0, pasPret: 1 }]);
});

test("bilan : remise PAS PRÊT puis arrêt absent → 1 PAS PRÊT, 0 absent", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "sonnet", null, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
    V("r1", "absent", "2026-11-08T10:10:05.000Z", "s1", "stop"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [{ agent: "softwarefactory:implementeur", modele: "sonnet", source: "jev", pret: 0, pasPret: 1 }]);
  assert.equal(b.absents, 0);
});

test("bilan : PAS PRÊT puis PRÊT pour le même agent_id → 1 PRÊT", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "sonnet", null, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
    V("r1", "PRÊT", "2026-11-08T10:20:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [{ agent: "softwarefactory:implementeur", modele: "sonnet", source: "jev", pret: 1, pasPret: 0 }]);
});

test("CLI bilan : journal lu sous CLAUDE_PROJECT_DIR, illisibles sur stderr ; journal absent → code 2", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "jev-bilan-"));
  try {
    const absent = spawnSync(process.execPath, [CLI, "bilan"], { encoding: "utf8", env: { CLAUDE_PROJECT_DIR: dossier } });
    assert.equal(absent.status, 2);
    assert.match(absent.stderr, /journal absent/);
    assert.ok(absent.stderr.includes(path.join(dossier, ".claude", "logs", "jev-model.jsonl")));
    fs.mkdirSync(path.join(dossier, ".claude", "logs"), { recursive: true });
    fs.writeFileSync(path.join(dossier, ".claude", "logs", "jev-model.jsonl"), JOURNAL);
    const ok = spawnSync(process.execPath, [CLI, "bilan"], { encoding: "utf8", env: { CLAUDE_PROJECT_DIR: dossier } });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, formaterBilan(faireBilan(JOURNAL)));
    assert.match(ok.stderr, /2 ligne\(s\) illisible\(s\)/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("bilan : une raison manquante donne la source repli", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "haiku", undefined, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [{ agent: "softwarefactory:implementeur", modele: "haiku", source: "repli", pret: 0, pasPret: 1 }]);
});

test("bilan : un verdict hors PRÊT, PAS PRÊT, absent n'entre dans aucune ligne et compte pour une ligne illisible", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "haiku", null, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PRET", "2026-11-08T10:10:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b, { lignes: [], nonAttribues: 0, absents: 0, illisibles: 1 });
});

test("bilan : un verdict sans session_id n'est pas attribué à un dispatch sans session_id", () => {
  const b = faireBilan([
    L({ date: "2026-11-08T10:00:00.000Z", agent: "softwarefactory:implementeur", defaut: "sonnet", retenu: "haiku", raison: null }),
    L({ date: "2026-11-08T10:10:00.000Z", agent_id: "r1", agent: "softwarefactory:relecteur", source: "handback", verdict: "PRÊT" }),
  ].join("\n"));
  assert.deepEqual(b, { lignes: [], nonAttribues: 1, absents: 0, illisibles: 0 });
});

test("bilan : un dispatch sans modèle ni model-absent n'est pas retenu", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "haiku", null, "2026-11-08T10:00:00.000Z", "s1"),
    D("softwarefactory:implementeur", null, "agent-hors-table", "2026-11-08T10:05:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [{ agent: "softwarefactory:implementeur", modele: "haiku", source: "jev", pret: 0, pasPret: 1 }]);
});

test("bilan : 1 PRÊT et 2 PAS PRÊT donnent 67 %", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "haiku", null, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
    V("r2", "PAS PRÊT", "2026-11-08T10:20:00.000Z", "s1"),
    V("r3", "PAS PRÊT", "2026-11-08T10:30:00.000Z", "s1"),
  ].join("\n"));
  assert.match(formaterBilan(b), /\| softwarefactory:implementeur \| haiku \| jev \| 1 \| 2 \| 67 % \|/);
});

test("bilan : 1 PAS PRÊT pour 3 verdicts donne 33 %", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "haiku", null, "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
    V("r2", "PRÊT", "2026-11-08T10:20:00.000Z", "s1"),
    V("r3", "PAS PRÊT", "2026-11-08T10:30:00.000Z", "s1"),
  ].join("\n"));
  assert.match(formaterBilan(b), /\| softwarefactory:implementeur \| haiku \| jev \| 2 \| 1 \| 33 % \|/);
});

test("bilan : dispatch model-explicite sonnet puis PAS PRÊT, dispatch model-absent puis PRÊT", () => {
  const b = faireBilan([
    D("softwarefactory:implementeur", "sonnet", "model-explicite", "2026-11-08T10:00:00.000Z", "s1"),
    V("r1", "PAS PRÊT", "2026-11-08T10:10:00.000Z", "s1"),
    D("softwarefactory:implementeur", null, "model-absent", "2026-11-08T10:20:00.000Z", "s1"),
    V("r2", "PRÊT", "2026-11-08T10:30:00.000Z", "s1"),
  ].join("\n"));
  assert.deepEqual(b.lignes, [
    { agent: "softwarefactory:implementeur", modele: "sonnet", source: "explicite", pret: 0, pasPret: 1 },
    { agent: "softwarefactory:implementeur", modele: "—", source: "sans-model", pret: 1, pasPret: 0 },
  ]);
});
