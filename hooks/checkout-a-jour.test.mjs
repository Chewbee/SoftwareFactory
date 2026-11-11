import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const charger = () => import("./checkout-a-jour-core.mjs");
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const HEAD = "501dc8db809ba460a0a4461e7a775d3ad13b43f5";
const DEV = "6b7cbdb2770e4fd5763d15883311ccb59bc00751";

function fauxGit(reponses) {
  const lancees = [];
  const executer = (args) => {
    const cle = args.join(" ");
    lancees.push(cle);
    const r = reponses[cle];
    if (r === undefined) throw new Error(`commande git inattendue : ${cle}`);
    return { code: 0, stdout: "", stderr: "", erreur: undefined, ...r };
  };
  return { executer, lancees };
}

const GIT_DIRS = "rev-parse --path-format=absolute --git-dir --git-common-dir";
const BRANCHE = "symbolic-ref -q HEAD";
const FETCH = "fetch --quiet origin +refs/heads/dev:refs/remotes/origin/dev";
const REV_DEV = "rev-parse refs/remotes/origin/dev";
const COMPTES = "rev-list --left-right --count HEAD...refs/remotes/origin/dev";
const PRINCIPAL = { stdout: "/repo/.git\n/repo/.git\n" };
// avance : commits de HEAD absents d'origin/dev ; retard : l'inverse. `branche` null : HEAD détaché
// (symbolic-ref -q rend alors 1 sans rien écrire). Noms complets partout : un tag ou une branche
// locale nommés `origin/dev` ou `dev` ne masquent ni la référence distante ni la branche.
const base = (avance, retard, branche = "dev") => ({
  [GIT_DIRS]: PRINCIPAL,
  [BRANCHE]: branche === null ? { code: 1 } : { stdout: `refs/heads/${branche}\n` },
  [FETCH]: {},
  "rev-parse HEAD": { stdout: `${HEAD}\n` },
  [REV_DEV]: { stdout: `${DEV}\n` },
  [COMPTES]: { stdout: `${String(avance)}\t${String(retard)}\n` },
});

test("dev en retard : message bruyant, branche, retard, les deux SHA et la commande pour avancer", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit(base(0, 89));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sur dev en retard de 89 commits/);
  assert.match(message, /501dc8db/);
  assert.match(message, /6b7cbdb2/);
  assert.match(message, /git merge --ff-only origin\/dev/);
  assert.deepEqual(lancees, Object.keys(base(0, 89)));
});

test("un seul commit de retard : « 1 commit » au singulier", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit(base(0, 1));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /en retard de 1 commit(?!s)/);
});

test("dev à jour : succès nommé, jamais muet", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit(base(0, 0));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, true);
  assert.match(message, /sur dev à jour/);
  assert.match(message, /6b7cbdb2/);
});

test("dev en avance sur origin/dev : reste à jour, et le dit", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit(base(3, 0));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, true);
  assert.match(message, /à jour/);
  assert.match(message, /en avance de 3 commits/);
});

test("dev divergent : ni « à jour » ni --ff-only, la divergence est chiffrée", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit(base(2, 5));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sur dev diverge d'origin\/dev/);
  assert.match(message, /2 commits en avance, 5 en retard/);
  assert.doesNotMatch(message, /à jour/);
  assert.doesNotMatch(message, /ff-only/);
});

test("checkout principal sur master : nommé, jamais « à jour », jamais --ff-only, rien de plus lancé", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit(base(0, 89, "master"));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sur « master », pas sur dev/);
  assert.doesNotMatch(message, /à jour/);
  assert.doesNotMatch(message, /ff-only/);
  assert.deepEqual(lancees, [GIT_DIRS, BRANCHE]);
});

test("HEAD détaché : dit détaché, jamais « à jour », jamais --ff-only", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit(base(0, 0, null));
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /HEAD détaché/);
  assert.doesNotMatch(message, /à jour/);
  assert.doesNotMatch(message, /ff-only/);
  assert.deepEqual(lancees, [GIT_DIRS, BRANCHE]);
});

test("lecture de la branche en échec (code 128) : échec nommé avec la commande et son stderr", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit({ ...base(0, 0), [BRANCHE]: { code: 128, stderr: "fatal: pas un dépôt" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /git symbolic-ref -q HEAD/);
  assert.match(message, /128/);
  assert.match(message, /pas un dépôt/);
});

test("fetch en échec : jamais « à jour », la commande et son stderr sont nommés", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit({
    ...base(0, 0),
    [FETCH]: { code: 128, stderr: "fatal: unable to access 'https://github.com/…': Could not resolve host" },
  });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.doesNotMatch(message, /à jour/);
  assert.match(message, /git fetch --quiet origin \+refs\/heads\/dev:refs\/remotes\/origin\/dev/);
  assert.match(message, /128/);
  assert.match(message, /Could not resolve host/);
  assert.equal(lancees.includes(COMPTES), false);
});

test("git introuvable ou sans code de sortie : échec nommé, pas d'exception", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit({ [GIT_DIRS]: { code: null, erreur: "ENOENT" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /ENOENT/);
  assert.match(message, /git rev-parse --path-format=absolute --git-dir --git-common-dir/);
});

test("sortie git inattendue (SHA invalide) : rejet bruyant, pas de valeur par défaut", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit({ ...base(0, 0), "rev-parse HEAD": { stdout: "pas-un-sha\n" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sortie inattendue/);
  assert.match(message, /pas-un-sha/);
});

test("compteurs non numériques : rejet bruyant", async () => {
  const { bilanCheckout } = await charger();
  const { executer } = fauxGit({ ...base(0, 0), [COMPTES]: { stdout: "beaucoup\n" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sortie inattendue/);
});

test("session lancée dans un worktree : le contrôle le dit et ne lance rien d'autre", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit({ [GIT_DIRS]: { stdout: "/repo/.git/worktrees/x\n/repo/.git\n" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, true);
  assert.match(message, /worktree/);
  assert.deepEqual(lancees, [GIT_DIRS]);
});

test("rev-parse des dossiers git à trois lignes : échec nommé, pas pris pour un worktree", async () => {
  const { bilanCheckout } = await charger();
  const { executer, lancees } = fauxGit({ [GIT_DIRS]: { stdout: "/repo/.git/worktrees/x\n/repo/.git\n/en/trop\n" } });
  const { ok, message } = bilanCheckout({ executer });
  assert.equal(ok, false);
  assert.match(message, /sortie inattendue/);
  assert.doesNotMatch(message, /session lancée dans un worktree/);
  assert.deepEqual(lancees, [GIT_DIRS]);
});

test("l'exécuteur réel borne chaque commande par le délai donné", async () => {
  const { creerExecuteur } = await import("./plugin-a-jour-core.mjs");
  const r = creerExecuteur(process.execPath, 200)(["-e", "setTimeout(() => {}, 5000)"]);
  assert.equal(r.code, null);
  assert.equal(r.erreur, "ETIMEDOUT");
});

const SANS_GIT = spawnSync("git", ["--version"]).status !== 0;
const AVEC_GIT = { skip: SANS_GIT };

// Vrai dépôt : origine nue sur dev, clone à un commit, puis l'origine avance d'un commit. Environnement
// git isolé : ni config globale ni config système de la machine qui lance le test, et aucune variable
// que le hook doit poser lui-même (GIT_TERMINAL_PROMPT, délai).
function depotEnRetardUnCommit() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "checkout-a-jour-"));
  const retirees = ["GIT_TERMINAL_PROMPT", "CHECKOUT_A_JOUR_DELAI_MS"];
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !retirees.includes(k))),
    HOME: tmp,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (cwd, ...a) => {
    const r = spawnSync("git", a, { cwd, env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")} : ${r.stderr}`);
    return r.stdout.trim();
  };
  const origine = path.join(tmp, "origine.git");
  const amont = path.join(tmp, "amont");
  const clone = path.join(tmp, "clone");
  git(tmp, "init", "--bare", "-b", "dev", origine);
  git(tmp, "clone", origine, amont);
  const ident = ["-c", "user.name=t", "-c", "user.email=t@t"];
  git(amont, ...ident, "commit", "--allow-empty", "-m", "un");
  git(amont, "push", "origin", "HEAD:dev");
  git(tmp, "clone", "-b", "dev", origine, clone);
  git(amont, ...ident, "commit", "--allow-empty", "-m", "deux");
  git(amont, "push", "origin", "HEAD:dev");
  const lancerHook = (extra = {}) => {
    const r = spawnSync(process.execPath, [path.join(ICI, "checkout-a-jour.mjs")], {
      cwd: clone,
      encoding: "utf8",
      env: { ...env, CLAUDE_PROJECT_DIR: clone, ...extra },
    });
    assert.equal(r.status, 0, r.stderr);
    return { ...r, sortie: JSON.parse(r.stdout) };
  };
  const shaDistant = git(amont, "rev-parse", "HEAD");
  return { tmp, clone, env, git, shaDistant, lancerHook, nettoyer: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test("point d'entrée sur un vrai dépôt en retard d'un commit : code 0, systemMessage et additionalContext le disent", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    const { sortie, stderr } = d.lancerHook();
    assert.match(sortie.systemMessage, /^checkout-a-jour : .*sur dev en retard de 1 commit(?!s)/);
    assert.equal(sortie.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(sortie.hookSpecificOutput.additionalContext, sortie.systemMessage);
    assert.match(stderr, /\[checkout-a-jour\]/);
  } finally {
    d.nettoyer();
  }
});

test("remote.origin.fetch qui ne couvre pas dev : le retard est vu quand même, origin/dev local périmé", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    d.git(d.clone, "config", "remote.origin.fetch", "+refs/heads/master:refs/remotes/origin/master");
    const { sortie } = d.lancerHook();
    assert.match(sortie.systemMessage, /sur dev en retard de 1 commit(?!s)/);
    assert.doesNotMatch(sortie.systemMessage, /à jour/);
  } finally {
    d.nettoyer();
  }
});

test("point d'entrée sur master, même commit qu'origin/dev : jamais « à jour », jamais --ff-only", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    d.git(d.clone, "pull", "--quiet", "--ff-only", "origin", "dev");
    d.git(d.clone, "switch", "--quiet", "-c", "master");
    const { sortie } = d.lancerHook();
    assert.match(sortie.systemMessage, /sur « master », pas sur dev/);
    assert.doesNotMatch(sortie.systemMessage, /à jour|ff-only/);
  } finally {
    d.nettoyer();
  }
});

test("point d'entrée en HEAD détaché : dit détaché, jamais « à jour »", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    d.git(d.clone, "switch", "--quiet", "--detach");
    const { sortie } = d.lancerHook();
    assert.match(sortie.systemMessage, /HEAD détaché/);
    assert.doesNotMatch(sortie.systemMessage, /à jour|ff-only/);
  } finally {
    d.nettoyer();
  }
});

for (const [cas, masque] of [
  ["un tag local origin/dev", ["tag", "origin/dev", "HEAD"]],
  ["une branche locale origin/dev", ["branch", "origin/dev", "HEAD"]],
]) {
  test(`${cas} au niveau de HEAD ne masque pas refs/remotes/origin/dev : le retard est vu`, AVEC_GIT, () => {
    const d = depotEnRetardUnCommit();
    try {
      d.git(d.clone, ...masque);
      const { sortie } = d.lancerHook();
      assert.match(sortie.systemMessage, /sur dev en retard de 1 commit(?!s)/);
      assert.ok(sortie.systemMessage.includes(`origin/dev ${d.shaDistant.slice(0, 8)}`), sortie.systemMessage);
      assert.doesNotMatch(sortie.systemMessage, /à jour/);
    } finally {
      d.nettoyer();
    }
  });
}

test("un tag local dev ne fait pas prendre la branche dev pour une autre branche", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    d.git(d.clone, "tag", "dev", "HEAD");
    const { sortie } = d.lancerHook();
    assert.match(sortie.systemMessage, /sur dev en retard de 1 commit(?!s)/);
    assert.doesNotMatch(sortie.systemMessage, /pas sur dev/);
  } finally {
    d.nettoyer();
  }
});

// Hook reference-transaction du clone : lancé par le fetch du hook (il met à jour origin/dev), il
// hérite de l'environnement du git enfant. Il consigne GIT_TERMINAL_PROMPT dans .git/invite, ou
// dort 3 s si `dormir` (git le lance par son sh, aussi sous Windows).
function sondeFetch(d, { dormir = false } = {}) {
  const corps = dormir
    ? "sleep 3 </dev/null >/dev/null 2>&1"
    : 'printf %s "${GIT_TERMINAL_PROMPT-absent}" > .git/invite';
  const crochet = path.join(d.clone, ".git", "hooks", "reference-transaction");
  fs.writeFileSync(crochet, `#!/bin/sh\n${corps}\n`, { mode: 0o755 });
  return () => fs.readFileSync(path.join(d.clone, ".git", "invite"), "utf8");
}

test("point d'entrée : le git enfant reçoit GIT_TERMINAL_PROMPT=0", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    const lireInvite = sondeFetch(d);
    d.lancerHook();
    assert.equal(lireInvite(), "0");
  } finally {
    d.nettoyer();
  }
});

test("point d'entrée : un fetch qui ne répond pas est coupé au délai de test, nommé ETIMEDOUT avec la variable", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    sondeFetch(d, { dormir: true });
    const { sortie } = d.lancerHook({ CHECKOUT_A_JOUR_DELAI_MS: "400" });
    assert.match(sortie.systemMessage, /git fetch/);
    assert.match(sortie.systemMessage, /ETIMEDOUT/);
    assert.match(sortie.systemMessage, /CHECKOUT_A_JOUR_DELAI_MS=400/);
    assert.doesNotMatch(sortie.systemMessage, /à jour/);
  } finally {
    d.nettoyer();
  }
});

test("point d'entrée : un délai de test invalide est refusé bruyamment, git n'est pas lancé", AVEC_GIT, () => {
  const d = depotEnRetardUnCommit();
  try {
    const { sortie } = d.lancerHook({ CHECKOUT_A_JOUR_DELAI_MS: "vite" });
    assert.match(sortie.systemMessage, /CHECKOUT_A_JOUR_DELAI_MS/);
    assert.match(sortie.systemMessage, /vite/);
    assert.doesNotMatch(sortie.systemMessage, /à jour/);
  } finally {
    d.nettoyer();
  }
});

const REGLAGES = JSON.parse(fs.readFileSync(path.join(ICI, "hooks.json"), "utf8"));
const entreesCheckout = REGLAGES.hooks?.SessionStart?.filter((e) => e.hooks.some((h) => h.command.includes("checkout-a-jour.mjs"))) ?? [];

test("hooks.json lance checkout-a-jour.mjs en SessionStart au démarrage, à la reprise et après compaction", () => {
  assert.equal(entreesCheckout.length, 1, "il faut exactement une entrée SessionStart pour checkout-a-jour.mjs");
  const sources = entreesCheckout[0].matcher.split("|");
  for (const s of ["startup", "resume", "compact"]) assert.ok(sources.includes(s), `matcher sans ${s}`);
});

// Le chemin nominal (dev à jour ou en retard) lance le plus de commandes : celles du test 1.
test("hooks.json : les commandes du chemin le plus long × DELAI_COMMANDE_MS restent strictement sous le timeout du hook", async () => {
  const { bilanCheckout, DELAI_COMMANDE_MS } = await charger();
  const { executer, lancees } = fauxGit(base(0, 89));
  bilanCheckout({ executer });
  const [entree] = entreesCheckout;
  assert.equal(entree.hooks.length, 1);
  const timeoutMs = entree.hooks[0].timeout * 1000;
  const budget = lancees.length * DELAI_COMMANDE_MS;
  assert.ok(budget < timeoutMs, `${String(lancees.length)} × ${String(DELAI_COMMANDE_MS)} ms = ${String(budget)} ms, pas sous le timeout du hook ${String(timeoutMs)} ms`);
});
