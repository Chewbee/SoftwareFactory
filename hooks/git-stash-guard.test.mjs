import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "git-stash-guard.mjs");

function lancer(entree, options = {}) {
  const r = spawnSync(process.execPath, [HOOK], { input: entree, encoding: "utf8", ...options });
  return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}

const bash = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

const REFUSEES = [
  "git stash",
  "git stash push -m x",
  "git stash pop",
  "git stash apply stash@{1}",
  "git stash drop",
  "git stash clear",
  "git -C /p stash",
  "git -c a=b stash save",
  "cd x && git stash",
  "echo ok; git stash",
  'git -C "/a b" stash pop',
  "git -C '/a b' stash pop",
];

for (const commande of REFUSEES) {
  test(`refuse : ${commande}`, () => {
    const r = lancer(bash(commande));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /git diff > .*patch.*git apply/s);
    assert.match(r.stderr, /commit WIP/);
  });
}

const ACCEPTEES = [
  "git stash list",
  "git stash show -p stash@{0}",
  "git stash\tlist",
  "git log --grep=stash",
  "git status",
];

for (const commande of ACCEPTEES) {
  test(`accepte : ${commande}`, () => {
    const r = lancer(bash(commande));
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  });
}

// Bash lit « git stash\nlist » comme deux commandes : `git stash` (= push), puis `list`.
test("refuse : git stash suivi d'un retour à la ligne", () => {
  const r = lancer(bash("git stash\nlist"));
  assert.equal(r.code, 2);
});

const powershell = (command) => JSON.stringify({ tool_name: "PowerShell", tool_input: { command } });

const REFUSEES_POWERSHELL = [
  "git stash pop",
  "git.exe stash pop",
  "git.exe -C x stash",
  '& "git" stash pop',
  "& 'git' stash pop",
  '& "git.exe" stash pop',
  '& "C:\\Program Files\\Git\\cmd\\git.exe" stash pop',
];

for (const commande of REFUSEES_POWERSHELL) {
  test(`refuse : PowerShell ${commande}`, () => {
    const r = lancer(powershell(commande));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /commit WIP/);
  });
}

test(`accepte : PowerShell & "git.exe" stash list`, () => {
  const r = lancer(powershell('& "git.exe" stash list'));
  assert.equal(r.code, 0);
});

// Processus fils borné : une expression qui régresse en temps exponentiel fait
// échouer le test au lieu de bloquer la suite.
test("évalue en moins de 2 s une commande à 40 options sans valeur", () => {
  const commande = "git" + " --work-tree --x".repeat(40) + " X";
  const r = lancer(bash(commande), { timeout: 2000 });
  assert.equal(r.signal, null, "hook tué par le délai : expression en temps exponentiel");
  assert.equal(r.code, 0);
});

test("hooks.json branche le hook sur Bash et PowerShell", () => {
  const settings = JSON.parse(readFileSync(path.join(path.dirname(HOOK), "hooks.json"), "utf8"));
  const entree = settings.hooks.PreToolUse.find((e) =>
    e.hooks.some((h) => h.command.includes("git-stash-guard.mjs")),
  );
  assert.ok(entree, "entrée PreToolUse absente");
  const outils = entree.matcher.split("|");
  assert.ok(outils.includes("Bash") && outils.includes("PowerShell"));
});

test("accepte un outil autre que Bash", () => {
  const r = lancer(JSON.stringify({ tool_name: "Write", tool_input: { command: "git stash" } }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("refuse bruyamment un JSON invalide", () => {
  const r = lancer("pas du json");
  assert.equal(r.code, 2);
  assert.notEqual(r.stderr, "");
});

test("refuse une entrée Bash sans commande textuelle", () => {
  const r = lancer(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  assert.equal(r.code, 2);
  assert.notEqual(r.stderr, "");
});
