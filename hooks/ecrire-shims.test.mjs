// Tests du hook ecrire-shims (SF-19) : écrit dans le projet consommateur un
// shim .claude/hooks/jev-cli.mjs qui délègue au jev-cli.mjs du plugin
// installé, pour que « node .claude/hooks/jev-cli.mjs niveau --role … » garde
// un chemin stable quand la version du plugin change.
// Forme du registre observée en vrai : { version: 2, plugins: { "nom@marche":
// [ { scope, projectPath?, installPath, version, lastUpdated, … } ] } }.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ecrireShims, resoudre } from "./ecrire-shims-core.mjs";
import { main } from "./jev-cli.mjs";

const PROJET = "C:\\Users\\gh\\dev\\un-projet";
const CHEMIN_CACHE = "C:\\Users\\gh\\.claude\\plugins\\cache\\softwarefactory\\softwarefactory-marketplace\\0.1.0";
const CHEMIN_CACHE_V2 = "C:\\Users\\gh\\.claude\\plugins\\cache\\softwarefactory\\softwarefactory-marketplace\\0.2.0";

function registre({ locaux = [], user = null, autres = [] } = {}) {
  return JSON.stringify({
    version: 2,
    plugins: {
      "cesiumjs-skills@cesiumjs-skills": autres,
      "softwarefactory@softwarefactory-marketplace": [...locaux, ...(user === null ? [] : [user])],
    },
  });
}

function local(scope, projectPath, installPath, lastUpdated) {
  return { scope, projectPath, installPath, version: "0.1.0", lastUpdated };
}

test("resoudre : rend le dossier de version de l'installation locale du projet", () => {
  const r = resoudre(registre({ locaux: [local("local", PROJET, CHEMIN_CACHE, "2026-11-01T00:00:00Z")] }), "softwarefactory@softwarefactory-marketplace", PROJET);
  assert.equal(r, CHEMIN_CACHE);
});

test("resoudre : la casse du projectPath ne casse pas le rapprochement (Windows)", () => {
  const r = resoudre(registre({ locaux: [local("local", PROJET.toLowerCase(), CHEMIN_CACHE, "2026-11-01T00:00:00Z")] }), "softwarefactory@softwarefactory-marketplace", PROJET);
  assert.equal(r, CHEMIN_CACHE);
});

test("resoudre : sans installation locale pour CE projet, l'installation user fait foi", () => {
  const r = resoudre(registre({ locaux: [local("local", "C:\\autre\\projet", "C:\\autre", "2026-11-01T00:00:00Z")], user: local("user", undefined, CHEMIN_CACHE, "2026-10-01T00:00:00Z") }), "softwarefactory@softwarefactory-marketplace", PROJET);
  assert.equal(r, CHEMIN_CACHE);
});

test("resoudre : à défaut, l'installation la plus récente fait foi", () => {
  const r = resoudre(registre({ locaux: [local("local", "C:\\autre\\projet", CHEMIN_CACHE, "2026-10-01T00:00:00Z"), local("local", "C:\\encore\\autre", CHEMIN_CACHE_V2, "2026-11-02T00:00:00Z")] }), "softwarefactory@softwarefactory-marketplace", PROJET);
  assert.equal(r, CHEMIN_CACHE_V2);
});

test("resoudre : plugin absent du registre → null", () => {
  const r = resoudre(registre({ autres: [local("user", undefined, CHEMIN_CACHE, "2026-11-01T00:00:00Z")] }), "softwarefactory@softwarefactory-marketplace", PROJET);
  assert.equal(r, null);
});

test("resoudre : registre illisible → échec franc, pas de null silencieux", () => {
  assert.throws(() => resoudre("pas du json", "softwarefactory@softwarefactory-marketplace", PROJET), /JSON/);
});

test("jev-cli.mjs exporte son main : le shim peut y déléguer", () => {
  assert.equal(typeof main, "function");
});

test("ecrireShims : écrit le shim à chemin stable dans le projet consommateur, avec en-tête « généré »", () => {
  const ecrits = [];
  const r = ecrireShims({
    env: { CLAUDE_PROJECT_DIR: PROJET },
    registreJson: registre({ locaux: [local("local", PROJET, CHEMIN_CACHE, "2026-11-01T00:00:00Z")] }),
    ecrire: (chemin, contenu) => ecrits.push({ chemin, contenu }),
  });
  assert.deepEqual(ecrits.map(({ chemin }) => chemin), [path.join(PROJET, ".claude", "hooks", "jev-cli.mjs")]);
  const { contenu } = ecrits[0];
  assert.match(contenu, /g[ée]n[ée]r[ée] par l'usine.*ne pas [ée]diter/i);
  assert.ok(contenu.includes(pathToFileURL(path.join(CHEMIN_CACHE, "hooks", "jev-cli.mjs")).href), contenu);
  assert.equal(r.chemin, path.join(PROJET, ".claude", "hooks", "jev-cli.mjs"));
});

test("ecrireShims : plugin introuvable → erreur typée au message clair, rien d'écrit", () => {
  const ecrits = [];
  assert.throws(
    () => ecrireShims({
      env: { CLAUDE_PROJECT_DIR: PROJET },
      registreJson: registre({ autres: [local("user", undefined, CHEMIN_CACHE, "2026-11-01T00:00:00Z")] }),
      ecrire: (chemin, contenu) => ecrits.push({ chemin, contenu }),
    }),
    /softwarefactory@softwarefactory-marketplace.*introuvable/,
  );
  assert.deepEqual(ecrits, []);
});

test("hooks.json : SessionStart lance ecrire-shims.mjs avec timeout 60 s, avant les autres gestes d'installation", () => {
  const reglages = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./hooks.json", import.meta.url)), "utf8"));
  const entrees = reglages.hooks.SessionStart.filter((e) => e.hooks.some((h) => h.command.includes("ecrire-shims.mjs")));
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].matcher, "startup|resume");
  assert.ok(entrees[0].hooks.every((h) => h.timeout === 60));
});
