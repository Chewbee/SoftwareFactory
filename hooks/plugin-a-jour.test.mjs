import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { COMMANDES_MAX, creerExecuteur, DELAI_COMMANDE_MS, mettreAJour } from "./plugin-a-jour-core.mjs";

const MARCHE = "superpowers-extended-cc-marketplace";
const PLUGIN = `superpowers-extended-cc@${MARCHE}`;

const AJOUT_MARCHE = "claude plugin marketplace add pcvelz/superpowers";
const MAJ_MARCHE = `claude plugin marketplace update ${MARCHE}`;
const INSTALLATION = `claude plugin install ${PLUGIN} --scope local`;
const MAJ_PLUGIN = `claude plugin update ${PLUGIN} --scope local`;

const MARCHE_CESIUM = "cesiumjs-skills";
const PLUGIN_CESIUM = `cesiumjs-skills@${MARCHE_CESIUM}`;
const AJOUT_MARCHE_CESIUM = "claude plugin marketplace add CesiumGS/cesiumjs-skills";
const MAJ_MARCHE_CESIUM = `claude plugin marketplace update ${MARCHE_CESIUM}`;
const INSTALLATION_CESIUM = `claude plugin install ${PLUGIN_CESIUM} --scope local`;
const MAJ_PLUGIN_CESIUM = `claude plugin update ${PLUGIN_CESIUM} --scope local`;
const COMMANDES_SUPERPOWERS = [AJOUT_MARCHE, MAJ_MARCHE, INSTALLATION, MAJ_PLUGIN];
const COMMANDES_CESIUM = [AJOUT_MARCHE_CESIUM, MAJ_MARCHE_CESIUM, INSTALLATION_CESIUM, MAJ_PLUGIN_CESIUM];
// Deux plugins, dans cet ordre ; l'échec d'une commande n'arrête que les commandes restantes de SON plugin.
const COMMANDES = [...COMMANDES_SUPERPOWERS, ...COMMANDES_CESIUM];

// Sorties réelles de la CLI (stdout, jamais stderr), sur un tube : « Installing… » et le résultat tiennent sur une ligne.
const SORTIE_INSTALLATION = `Installing plugin "${PLUGIN}"...√ Plugin "${PLUGIN}" is already installed (scope: user)\n`;
const SORTIE_MAJ = "Checking for updates for plugin…\n√ superpowers-extended-cc is already at the latest version (6.6.1-dev).\n";
const SORTIE_INSTALLATION_CESIUM = `Installing plugin "${PLUGIN_CESIUM}"...√ Successfully installed plugin: ${PLUGIN_CESIUM} (scope: local)\n`;
const SORTIE_MAJ_CESIUM = "Checking for updates for plugin…\n√ cesiumjs-skills is already at the latest version (1.2.0).\n";
const SUITE = "Un plugin installé ou mis à jour ici ne se charge qu'au démarrage suivant ou après `/reload-plugins`.";

// Fausse exécution de la CLI : chaque commande attendue a sa réponse, toute autre
// commande fait échouer le test. executer reçoit les arguments sans « claude ».
function fausseCli(reponses) {
  const lancees = [];
  const executer = (args) => {
    const commande = `claude ${args.join(" ")}`;
    lancees.push(commande);
    if (!Object.hasOwn(reponses, commande)) assert.fail(`commande inattendue : ${commande}`);
    return { code: 0, stdout: "", stderr: "", erreur: null, ...reponses[commande] };
  };
  return { executer, lancees };
}

// Les huit commandes réussissent ; la n-ième (rang dans COMMANDES) rend `reponse`. Une commande
// non lancée parce que son plugin s'est arrêté plus tôt n'est simplement pas appelée.
function echecALaCommande(rang, reponse) {
  const reussies = COMMANDES.map((commande) => [commande, { stdout: "√ ok\n" }]);
  return fausseCli({ ...Object.fromEntries(reussies), [COMMANDES[rang]]: reponse });
}

// Les commandes lancées quand la n-ième échoue : celles du plugin jusqu'à elle, puis tout le plugin suivant.
function lanceesQuandEchec(rang) {
  return [...COMMANDES.slice(0, rang + 1), ...(rang < COMMANDES_SUPERPOWERS.length ? COMMANDES_CESIUM : [])];
}

const reussites = (surcharges = {}) => ({ ...Object.fromEntries(COMMANDES.map((commande) => [commande, {}])), ...surcharges });
const occurrences = (texte, motif) => texte.split(motif).length - 1;

test("les huit commandes, deux plugins dans cet ordre, sans rien lire avant : succès", () => {
  const { executer, lancees } = fausseCli(
    reussites({
      [AJOUT_MARCHE]: { stdout: "Adding marketplace…√ Marketplace 'x' already on disk — declared in user settings\n" },
      [MAJ_MARCHE]: { stdout: "√ Successfully updated marketplace: x\n" },
      [INSTALLATION]: { stdout: SORTIE_INSTALLATION },
      [MAJ_PLUGIN]: { stdout: SORTIE_MAJ },
      [INSTALLATION_CESIUM]: { stdout: SORTIE_INSTALLATION_CESIUM },
      [MAJ_PLUGIN_CESIUM]: { stdout: SORTIE_MAJ_CESIUM },
    }),
  );
  const r = mettreAJour({ executer, env: {} });
  assert.equal(COMMANDES_MAX, 8);
  assert.deepEqual(lancees, COMMANDES);
  assert.deepEqual(r.commandes, lancees);
  assert.equal(r.commandes.length, COMMANDES_MAX);
  assert.equal(r.ok, true);
  assert.equal(
    r.message,
    `superpowers-extended-cc : Installing plugin "${PLUGIN}"...√ Plugin "${PLUGIN}" is already installed (scope: user) ; √ superpowers-extended-cc is already at the latest version (6.6.1-dev)` +
      ` | cesiumjs-skills : Installing plugin "${PLUGIN_CESIUM}"...√ Successfully installed plugin: ${PLUGIN_CESIUM} (scope: local) ; √ cesiumjs-skills is already at the latest version (1.2.0). ${SUITE}`,
  );
  assert.equal(occurrences(r.message, SUITE), 1, "la phrase sur le rechargement n'apparaît qu'une fois");
});

test("succès : seule la dernière ligne non vide de install et de update est reprise, sans point final doublé", () => {
  const { executer } = fausseCli(
    reussites({
      [INSTALLATION]: { stdout: `Installing plugin…\n√ Successfully installed plugin: ${PLUGIN} (scope: user)\n\n` },
      [MAJ_PLUGIN]: {
        stdout: 'Checking…\n√ Plugin "superpowers-extended-cc" updated from 6.5.3-dev to 6.6.1-dev for scope user. Restart to apply changes.\n \n\n',
      },
      [INSTALLATION_CESIUM]: { stdout: "√ cesium installé\n" },
      [MAJ_PLUGIN_CESIUM]: { stdout: "√ cesium à jour.\n" },
    }),
  );
  const r = mettreAJour({ executer, env: {} });
  assert.equal(
    r.message,
    `superpowers-extended-cc : √ Successfully installed plugin: ${PLUGIN} (scope: user) ; √ Plugin "superpowers-extended-cc" updated from 6.5.3-dev to 6.6.1-dev for scope user. Restart to apply changes` +
      ` | cesiumjs-skills : √ cesium installé ; √ cesium à jour. ${SUITE}`,
  );
});

test("succès sans rien sur stdout : le message le dit et nomme la commande, jamais de succès muet", () => {
  const { executer } = fausseCli(reussites({ [MAJ_PLUGIN]: { stdout: SORTIE_MAJ } }));
  const r = mettreAJour({ executer, env: {} });
  assert.equal(r.ok, true);
  assert.ok(r.message.includes(`« ${INSTALLATION} » a réussi sans rien écrire sur stdout`), r.message);
});

for (const [rang, commande] of COMMANDES.entries()) {
  test(`commande en échec (${commande}) : arrêt des seules commandes restantes de son plugin, message qui nomme la commande, son code et son stderr, aucune exception`, () => {
    const { executer, lancees } = echecALaCommande(rang, { code: 1, stderr: "× Failed: réseau coupé\n" });
    const r = mettreAJour({ executer, env: {} });
    assert.deepEqual(lancees, lanceesQuandEchec(rang));
    assert.equal(r.ok, false);
    assert.ok(r.message.includes(`« ${commande} »`), r.message);
    assert.match(r.message, /code 1\b/);
    assert.match(r.message, /réseau coupé/);
  });
}

test("échec d'une commande du 1er plugin : le 2e plugin est quand même traité, le message nomme les deux", () => {
  const { executer, lancees } = echecALaCommande(2, { code: 1, stderr: "× Failed: plugin introuvable\n" });
  const r = mettreAJour({ executer, env: {} });
  assert.deepEqual(lancees, [AJOUT_MARCHE, MAJ_MARCHE, INSTALLATION, ...COMMANDES_CESIUM]);
  assert.equal(r.ok, false);
  assert.match(r.message, /superpowers-extended-cc : la mise à jour du plugin superpowers-extended-cc a échoué : « claude plugin install [^»]+ » a rendu le code 1 : × Failed: plugin introuvable/);
  assert.match(r.message, /cesiumjs-skills : √ ok ; √ ok/);
  assert.equal(occurrences(r.message, SUITE), 1);
});

test("échec d'une commande du 2e plugin : ok est false, le 1er plugin garde son succès dans le message", () => {
  const { executer, lancees } = echecALaCommande(5, { code: 2, stderr: "× marché cesium injoignable\n" });
  const r = mettreAJour({ executer, env: {} });
  assert.deepEqual(lancees, [...COMMANDES_SUPERPOWERS, AJOUT_MARCHE_CESIUM, MAJ_MARCHE_CESIUM]);
  assert.equal(r.ok, false);
  assert.match(r.message, /superpowers-extended-cc : √ ok ; √ ok/);
  assert.ok(r.message.includes(`« ${MAJ_MARCHE_CESIUM} » a rendu le code 2 : × marché cesium injoignable`), r.message);
  assert.match(r.message, /cesiumjs-skills : la mise à jour du plugin cesiumjs-skills a échoué/);
  assert.equal(occurrences(r.message, SUITE), 1);
});

test("CLI claude absente : message bruyant, une tentative par plugin, chacun nommé", () => {
  const { executer, lancees } = fausseCli({
    [AJOUT_MARCHE]: { code: null, erreur: "ENOENT" },
    [AJOUT_MARCHE_CESIUM]: { code: null, erreur: "ENOENT" },
  });
  const r = mettreAJour({ executer, env: {} });
  assert.deepEqual(lancees, [AJOUT_MARCHE, AJOUT_MARCHE_CESIUM]);
  assert.equal(r.ok, false);
  assert.equal(occurrences(r.message, "« claude » est introuvable"), 2);
  assert.match(r.message, /superpowers-extended-cc : .*pas mis à jour.* \| cesiumjs-skills : .*pas mis à jour/);
});

test("binaire explicite introuvable : le message et la liste des commandes nomment le binaire tenté", () => {
  const binaire = "/opt/claude-code/bin/claude";
  const executer = () => ({ code: null, stdout: "", stderr: "", erreur: "ENOENT" });
  const r = mettreAJour({ executer, binaire });
  assert.equal(r.ok, false);
  assert.deepEqual(r.commandes, [
    `${binaire} plugin marketplace add pcvelz/superpowers`,
    `${binaire} plugin marketplace add CesiumGS/cesiumjs-skills`,
  ]);
  assert.match(r.message, /« \/opt\/claude-code\/bin\/claude » est introuvable \(ENOENT\)/);
  assert.ok(!r.message.includes("« claude »"), r.message);
});

test("commande sans code de sortie (délai dépassé) : la commande et la cause sont nommées", () => {
  const { executer } = echecALaCommande(1, { code: null, erreur: "ETIMEDOUT" });
  const r = mettreAJour({ executer, env: {} });
  assert.equal(r.ok, false);
  assert.ok(r.message.includes(`« ${MAJ_MARCHE} »`), r.message);
  assert.match(r.message, /sans code de sortie \(ETIMEDOUT\)/);
});

// La cause d'un échec git (nom du verrou) est en fin de ligne : la troncature garde la fin.
const CAUSE_LONGUE = "fatal: Unable to create '/root/.claude/plugins/marketplaces/x/.git/index.lock': File exists.";

test("stderr trop long : la troncature garde la fin, où se trouve la cause, précédée de …", () => {
  const stderr = `${"x".repeat(400)} ${CAUSE_LONGUE}\n`;
  const { executer } = echecALaCommande(1, { code: 1, stderr });
  const r = mettreAJour({ executer, env: {} });
  assert.ok(r.message.includes(`: …${stderr.trim().slice(-300)} | `), r.message);
  assert.ok(r.message.includes("index.lock"), r.message);
  assert.ok(!r.message.includes("x".repeat(250)), "le début du stderr n'est pas gardé : 400 x au départ, il n'en reste que la fin");
});

test("stderr de 300 caractères : rien n'est tronqué", () => {
  const stderr = "e".repeat(300);
  const { executer } = echecALaCommande(1, { code: 1, stderr });
  const r = mettreAJour({ executer, env: {} });
  assert.ok(r.message.includes(`: ${stderr} | `), r.message);
  assert.ok(!r.message.includes("…"), r.message);
});

test("stderr vide : la fin du stdout sert de détail à l'échec", () => {
  const stdout = `${"y".repeat(400)} Plugin not found in marketplace\n`;
  const { executer } = echecALaCommande(3, { code: 1, stdout, stderr: "  \n" });
  const r = mettreAJour({ executer, env: {} });
  assert.ok(r.message.includes(`: …${stdout.trim().slice(-300)} | `), r.message);
  assert.ok(r.message.includes("Plugin not found in marketplace"), r.message);
});

test("stderr présent : le stdout n'est pas repris dans l'échec", () => {
  const { executer } = echecALaCommande(2, { code: 1, stdout: "bruit de stdout", stderr: "cause réelle\n" });
  const r = mettreAJour({ executer, env: {} });
  assert.match(r.message, /cause réelle/);
  assert.ok(!r.message.includes("bruit de stdout"), r.message);
});

// Point d'entrée : le vrai script, lancé avec un faux `claude`. Par défaut le faux claude est en
// tête de PATH et CLAUDE_CODE_EXECPATH est retirée de l'environnement : cette variable est posée
// dans les sessions Claude Code, dont celle qui lance ces tests. Réglages :
//   emplacement(d) : où écrire le faux claude (défaut : <d>/bin/claude)
//   execpath(d)    : valeur de CLAUDE_CODE_EXECPATH (défaut : variable absente)
//   projet(d)      : valeur de CLAUDE_PROJECT_DIR (défaut : variable absente, retirée de l'environnement)
//   cwd(d)         : répertoire courant du hook (défaut : celui du test)
// `repertoires` rend les répertoires courants vus par le faux claude, relatifs à <d>.
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "plugin-a-jour.mjs");
const SANS_SH = process.platform === "win32" ? "faux claude en script shell : POSIX seulement" : false;

// script(journal) rend le texte du faux claude, ou null pour un PATH sans claude.
function lancerEntree(script, { emplacement, execpath, projet, cwd } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-a-jour-"));
  try {
    const bin = path.join(d, "bin");
    const journal = path.join(d, "appels.txt");
    fs.mkdirSync(bin);
    const texte = script(journal);
    if (texte !== null) {
      const fichier = emplacement === undefined ? path.join(bin, "claude") : emplacement(d);
      fs.mkdirSync(path.dirname(fichier), { recursive: true });
      fs.writeFileSync(fichier, texte, { mode: 0o755 });
    }
    const env = { ...process.env, PATH: bin };
    delete env.CLAUDE_CODE_EXECPATH;
    const valeur = execpath?.(d);
    if (valeur !== undefined) env.CLAUDE_CODE_EXECPATH = valeur;
    delete env.CLAUDE_PROJECT_DIR;
    const racine = projet?.(d);
    if (racine !== undefined) env.CLAUDE_PROJECT_DIR = racine;
    const dossier = cwd?.(d);
    if (dossier !== undefined) fs.mkdirSync(dossier, { recursive: true });
    const r = spawnSync(process.execPath, [HOOK], { input: "", encoding: "utf8", env, cwd: dossier });
    const appels = fs.existsSync(journal) ? fs.readFileSync(journal, "utf8").trim().split("\n") : [];
    const lieux = `${journal}.cwd`;
    const vus = fs.existsSync(lieux) ? fs.readFileSync(lieux, "utf8").trim().split("\n") : [];
    const repertoires = [...new Set(vus)].map((lieu) => path.relative(fs.realpathSync(d), lieu));
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, appels, execpath: valeur, repertoires };
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

// Le faux claude répond à install et update comme la vraie CLI au second passage (sorties sur stdout).
const fauxClaude = (journal, panne = "") => `#!/bin/sh
echo "$*" >> "${journal}"
pwd -P >> "${journal}.cwd"
case "$*" in
${panne}  "plugin install "*) echo 'Installing plugin...√ Plugin is already installed (scope: user)' ;;
  *) echo "√ superpowers-extended-cc is already at the latest version (6.6.1-dev)." ;;
esac
`;

const APPELS = COMMANDES.map((commande) => commande.replace(/^claude /, ""));

// Le JSON de stdout doit porter le message à la fois pour l'humain (systemMessage) et pour Claude (additionalContext).
function assertMessageVisible(stdout, attendu) {
  const sortie = JSON.parse(stdout);
  assert.equal(sortie.hookSpecificOutput?.hookEventName, "SessionStart");
  const contexte = sortie.hookSpecificOutput?.additionalContext;
  assert.equal(typeof sortie.systemMessage, "string");
  assert.equal(contexte, sortie.systemMessage, "additionalContext reprend le texte de systemMessage");
  assert.ok(contexte.includes(attendu), contexte);
  return contexte;
}

test("point d'entrée, tout réussit : code 0, jamais de succès muet : systemMessage et additionalContext, bilan sur stderr", { skip: SANS_SH }, () => {
  const r = lancerEntree((journal) => fauxClaude(journal));
  assert.equal(r.code, 0, r.stderr);
  const texte = assertMessageVisible(r.stdout, "√ superpowers-extended-cc is already at the latest version (6.6.1-dev)");
  assert.ok(texte.startsWith("plugin-a-jour : "), texte);
  assert.ok(texte.includes("is already installed (scope: user)"), texte);
  assert.ok(texte.endsWith(SUITE), texte);
  assert.match(r.stderr, /already at the latest version \(6\.6\.1-dev\)/);
  assert.ok(texte.includes("superpowers-extended-cc : ") && texte.includes("cesiumjs-skills : "), texte);
  assert.deepEqual(r.appels, APPELS);
});

test("point d'entrée, commande en échec : code 0, stderr, systemMessage et additionalContext nomment la commande et son code", { skip: SANS_SH }, () => {
  const panne = `  "plugin marketplace update ${MARCHE}") echo "réseau coupé" >&2; exit 3 ;;\n`;
  const r = lancerEntree((journal) => fauxClaude(journal, panne));
  assert.equal(r.code, 0, r.stderr);
  const { systemMessage } = JSON.parse(r.stdout);
  const contexte = assertMessageVisible(r.stdout, `« ${MAJ_MARCHE} »`);
  for (const [ou, texte] of [["systemMessage", systemMessage], ["additionalContext", contexte], ["stderr", r.stderr]]) {
    assert.ok(texte.includes(`« ${MAJ_MARCHE} »`), `${ou} : ${texte}`);
    assert.match(texte, /code 3\b/, ou);
    assert.match(texte, /réseau coupé/, ou);
  }
  // Le 1er plugin s'arrête à sa 2e commande ; le 2e plugin est traité en entier.
  assert.deepEqual(r.appels, [APPELS[0], APPELS[1], ...APPELS.slice(4)]);
  assert.match(contexte, /cesiumjs-skills : .*already installed|cesiumjs-skills : .*latest version/);
});

test("point d'entrée, claude absent du PATH : code 0, message bruyant sur stderr et dans systemMessage", { skip: SANS_SH }, () => {
  const r = lancerEntree(() => null);
  assert.equal(r.code, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).systemMessage, /« claude » est introuvable/);
  assertMessageVisible(r.stdout, "« claude » est introuvable");
  assert.match(r.stderr, /« claude » est introuvable/);
});

test("point d'entrée, CLAUDE_CODE_EXECPATH : le binaire désigné est lancé, même sans claude dans le PATH", { skip: SANS_SH }, () => {
  const reel = (d) => path.join(d, "ailleurs", "claude-reel");
  const r = lancerEntree((journal) => fauxClaude(journal), { emplacement: reel, execpath: reel });
  assert.equal(r.code, 0, r.stderr);
  assertMessageVisible(r.stdout, "already at the latest version (6.6.1-dev)");
  assert.deepEqual(r.appels, APPELS);
});

test("point d'entrée, CLAUDE_CODE_EXECPATH vide : repli sur « claude » du PATH, jamais sur la chaîne vide", { skip: SANS_SH }, () => {
  const r = lancerEntree((journal) => fauxClaude(journal), { execpath: () => "" });
  assert.equal(r.code, 0, r.stderr);
  assertMessageVisible(r.stdout, "already at the latest version (6.6.1-dev)");
  assert.deepEqual(r.appels, APPELS);
});

test("point d'entrée, CLAUDE_CODE_EXECPATH vers un fichier absent : le message nomme le binaire tenté, pas « claude »", { skip: SANS_SH }, () => {
  const r = lancerEntree(() => null, { execpath: (d) => path.join(d, "absent", "claude") });
  assert.equal(r.code, 0, r.stderr);
  const { systemMessage } = JSON.parse(r.stdout);
  assert.ok(systemMessage.includes(`« ${r.execpath} » est introuvable (ENOENT)`), systemMessage);
  assert.ok(!systemMessage.includes("« claude »"), systemMessage);
  assert.ok(r.stderr.includes(`« ${r.execpath} » est introuvable (ENOENT)`), r.stderr);
});

// Le hook hérite du répertoire courant de la session, qui n'est pas toujours la racine du projet
// (doc des hooks : « regardless of the working directory when the hook runs ») : la CLI y situe la portée `local`.
const SOUS_DOSSIER = path.join("projet", "sous", "dossier");
const dansD = (relatif) => (d) => path.join(d, relatif);

test("point d'entrée, CLAUDE_PROJECT_DIR : les huit commandes tournent à la racine du projet, même lancé d'un sous-dossier", { skip: SANS_SH }, () => {
  const r = lancerEntree((journal) => fauxClaude(journal), { cwd: dansD(SOUS_DOSSIER), projet: dansD("projet") });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.appels.length, COMMANDES_MAX);
  assert.deepEqual(r.repertoires, ["projet"]);
});

test("point d'entrée, sans CLAUDE_PROJECT_DIR : les commandes tournent là où le hook est lancé", { skip: SANS_SH }, () => {
  const r = lancerEntree((journal) => fauxClaude(journal), { cwd: dansD(SOUS_DOSSIER) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.repertoires, [SOUS_DOSSIER]);
});

test("point d'entrée, CLAUDE_PROJECT_DIR vide : repli sur le répertoire où le hook est lancé, jamais sur la chaîne vide", { skip: SANS_SH }, () => {
  const r = lancerEntree((journal) => fauxClaude(journal), { cwd: dansD(SOUS_DOSSIER), projet: () => "" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.repertoires, [SOUS_DOSSIER]);
});

// Câblage du plugin : hooks.json lance ce script (cloud compris). La
// déclaration des marketplaces et plugins actifs est un contrat du projet
// consommateur (son settings.json, recette de docs/adoption.md) : elle n'est
// pas testée ici.
const ICI = path.dirname(fileURLToPath(import.meta.url));
const REGLAGES = JSON.parse(fs.readFileSync(path.join(ICI, "hooks.json"), "utf8"));

test("hooks.json lance plugin-a-jour.mjs au démarrage et à la reprise d'une session, avec un délai borné", () => {
  const commande = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/plugin-a-jour.mjs"';
  const entrees = (REGLAGES.hooks?.SessionStart ?? []).filter((e) => e.hooks.some((h) => h.command === commande));
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].matcher, "startup|resume");
  assert.deepEqual(entrees[0].hooks, [{ type: "command", command: commande, timeout: 600 }]);
  assert.ok(fs.existsSync(path.join(ICI, "plugin-a-jour.mjs")));
});

// Au-delà du timeout du hook, Claude Code l'annule et jette sa sortie : le message d'échec ne
// parviendrait ni à l'humain ni à Claude. Le pire cas (toutes les commandes au délai) doit tenir dedans.
const COMMANDE_HOOK = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/plugin-a-jour.mjs"';
const TIMEOUT_HOOK_MS = REGLAGES.hooks.SessionStart.flatMap((e) => e.hooks).find((h) => h.command === COMMANDE_HOOK).timeout * 1000;

test("hooks.json : COMMANDES_MAX × DELAI_COMMANDE_MS tient dans le timeout du hook", () => {
  const pireCasMs = COMMANDES_MAX * DELAI_COMMANDE_MS;
  assert.ok(pireCasMs < TIMEOUT_HOOK_MS, `${String(COMMANDES_MAX)} commandes × ${String(DELAI_COMMANDE_MS)} ms = ${String(pireCasMs)} ms, timeout du hook : ${String(TIMEOUT_HOOK_MS)} ms`);
});

test("le délai par commande emploie le budget du timeout : une commande de plus ne tiendrait plus", () => {
  const avecUneDePlusMs = (COMMANDES_MAX + 1) * DELAI_COMMANDE_MS;
  assert.ok(avecUneDePlusMs >= TIMEOUT_HOOK_MS, `${String(COMMANDES_MAX + 1)} × ${String(DELAI_COMMANDE_MS)} ms = ${String(avecUneDePlusMs)} ms < ${String(TIMEOUT_HOOK_MS)} ms : le délai gaspille le budget`);
});

// Les constantes ci-dessus ne bornent rien si le délai n'arrive pas jusqu'à spawnSync : un vrai processus le prouve.
test("creerExecuteur lie le délai à la commande : un claude qui dort 2 s, délai de 100 ms, ETIMEDOUT et processus coupé", { skip: SANS_SH }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-a-jour-delai-"));
  try {
    const faux = path.join(d, "claude");
    fs.writeFileSync(faux, "#!/bin/sh\nexec sleep 2\n", { mode: 0o755 });
    const debut = Date.now();
    const reponse = creerExecuteur(faux, 100)(["plugin", "update", PLUGIN]);
    assert.equal(reponse.code, null);
    assert.equal(reponse.erreur, "ETIMEDOUT");
    assert.ok(Date.now() - debut < 1500, "la commande est coupée au délai, pas laissée finir");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// --- SF-18 : la liste des plugins à maintenir vient du projet consommateur ---
// .claude/plugins-a-jour.json à la racine du projet de la session (env
// CLAUDE_PROJECT_DIR). Fichier absent → défaut ; présent mais invalide →
// échec franc, jamais de repli silencieux.
function projetAvec(contenuJson) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-a-jour-liste-"));
  fs.mkdirSync(path.join(d, ".claude"), { recursive: true });
  if (contenuJson !== null) fs.writeFileSync(path.join(d, ".claude", "plugins-a-jour.json"), contenuJson);
  return { env: { CLAUDE_PROJECT_DIR: d }, nettoyer: () => fs.rmSync(d, { recursive: true, force: true }) };
}

const MARCHE_SF = "softwarefactory-marketplace";
const PLUGIN_SF = `softwarefactory@${MARCHE_SF}`;
const COMMANDES_SF = [
  "claude plugin marketplace add Chewbee/SoftwareFactory",
  `claude plugin marketplace update ${MARCHE_SF}`,
  `claude plugin install ${PLUGIN_SF} --scope local`,
  `claude plugin update ${PLUGIN_SF} --scope local`,
];

test("la liste du projet consommateur fait foi : softwarefactory remplace les deux défauts, aucune commande par défaut lancée", () => {
  const p = projetAvec(JSON.stringify([{ nom: "softwarefactory", marche: MARCHE_SF, source: "Chewbee/SoftwareFactory" }]));
  try {
    // fausseCli fait échouer le test sur toute commande non prévue : les commandes par défaut ne doivent pas être lancées.
    const { executer, lancees } = fausseCli(Object.fromEntries(COMMANDES_SF.map((c) => [c, { stdout: "√ ok\n" }])));
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, true);
    assert.deepEqual(lancees, COMMANDES_SF);
    assert.deepEqual(r.commandes, COMMANDES_SF);
    assert.ok(r.message.includes("softwarefactory"));
  } finally {
    p.nettoyer();
  }
});

test("fichier présent mais JSON invalide : échec franc qui nomme le fichier, aucune commande lancée", () => {
  const p = projetAvec("pas du json");
  try {
    const { executer, lancees } = fausseCli({});
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, false);
    assert.deepEqual(lancees, []);
    assert.ok(r.message.includes("plugins-a-jour.json"), r.message);
    assert.ok(r.message.includes("n'est pas du JSON valide"), r.message);
  } finally {
    p.nettoyer();
  }
});

test("entrée fautive (source vide) : échec franc qui nomme l'entrée fautive, aucune commande lancée", () => {
  const p = projetAvec(JSON.stringify([{ nom: "x", marche: "y", source: "" }]));
  try {
    const { executer, lancees } = fausseCli({});
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, false);
    assert.deepEqual(lancees, []);
    assert.ok(r.message.includes("source"), r.message);
    assert.ok(r.message.includes("x"), r.message);
  } finally {
    p.nettoyer();
  }
});

test("liste vide : échec franc (jamais de repli silencieux vers les défauts)", () => {
  const p = projetAvec("[]");
  try {
    const { executer, lancees } = fausseCli({});
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, false);
    assert.deepEqual(lancees, []);
    assert.ok(r.message.includes("vide"), r.message);
  } finally {
    p.nettoyer();
  }
});

test("entrée non-objet : échec franc qui la nomme, aucune commande lancée", () => {
  const p = projetAvec(JSON.stringify([{ nom: "x", marche: "y", source: "z" }, "pas un objet"]));
  try {
    const { executer, lancees } = fausseCli({});
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, false);
    assert.deepEqual(lancees, []);
    assert.ok(r.message.includes("l'entrée n'est pas un objet"), r.message);
    assert.ok(r.message.includes("pas un objet"), r.message);
  } finally {
    p.nettoyer();
  }
});

test("fichier présent mais JSON non-liste : échec franc qui le dit (pas « vide »)", () => {
  const p = projetAvec(JSON.stringify({ nom: "x" }));
  try {
    const { executer, lancees } = fausseCli({});
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, false);
    assert.deepEqual(lancees, []);
    assert.ok(r.message.includes("n'est pas une liste"), r.message);
  } finally {
    p.nettoyer();
  }
});

test("fichier absent : les deux plugins par défaut, ordre conservé", () => {
  const p = projetAvec(null);
  try {
    const reussitesDefaut = Object.fromEntries(COMMANDES.map((c) => [c, { stdout: "√ ok\n" }]));
    const { executer, lancees } = fausseCli(reussitesDefaut);
    const r = mettreAJour({ executer, env: p.env });
    assert.equal(r.ok, true);
    assert.deepEqual(lancees, COMMANDES);
  } finally {
    p.nettoyer();
  }
});
