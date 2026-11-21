// Garde du retrait de Jev (TypeSafe) : l'usine ne câble ni ne livre plus rien
// qui l'appelle. Décision du propriétaire, 2026-11-15 : « JEV ne marchant pas,
// retirons-le partout » (jev-cli répondait http-401 à chaque appel, repli
// systématique sur le défaut du rôle).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), "utf8");

function commandesDeHooksJson() {
  const reglages = JSON.parse(lire("hooks", "hooks.json"));
  return Object.values(reglages.hooks).flatMap((entrees) => entrees.flatMap((e) => e.hooks.map((h) => h.command)));
}

test("hooks.json : aucune commande ne lance un hook Jev ni le hook ecrire-shims (qui n'écrivait que le shim jev-cli)", () => {
  const fautifs = commandesDeHooksJson().filter((c) => /jev|typesafe|ecrire-shims/i.test(c));
  assert.deepEqual(fautifs, []);
});

test("hooks.json : chaque commande pointe un fichier de hooks/ qui existe", () => {
  const manquants = [];
  for (const commande of commandesDeHooksJson()) {
    const m = commande.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[\w.-]+\.mjs)/);
    if (m === null) manquants.push(`commande non reconnue : ${commande}`);
    else if (!fs.existsSync(path.join(RACINE, m[1]))) manquants.push(m[1]);
  }
  assert.deepEqual(manquants, []);
});

test("hooks/ et agents/ ne livrent plus de fichier Jev, TypeSafe ou ecrire-shims", () => {
  const restants = ["hooks", "agents"].flatMap((d) =>
    fs.readdirSync(path.join(RACINE, d)).filter((f) => /^(jev|typesafe|ecrire-shims)/i.test(f)).map((f) => `${d}/${f}`),
  );
  assert.deepEqual(restants, []);
});
