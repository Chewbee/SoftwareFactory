import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as attendre } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  appliquerEvenement,
  avecVerrou,
  cheminsBranche,
  corpsCommentaire,
  DELAI_VERROU_PERIME_MS,
  envPublieur,
  ErreurEtatJob,
  extraireIdCreation,
  issueDepuisNom,
  lancerDetache,
  lienSuivant,
  lireCorpsCommentaire,
  lireMetadonnees,
  nomFichierBranche,
  normaliserEvenement,
  ordreMcp,
  resoudreCible,
  traiter,
  validerBranche,
  validerInstantane,
} from "./etat-job-core.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const maintenant = () => new Date("2026-10-17T10:00:00Z");
const CIBLE = { branche: "feat/1998-tableau", issue: 1998 };
const GIT_MUET = { brancheCourante: () => null, issueConfiguree: () => null };

function evtCreation(extra = {}) {
  return {
    session_id: "aaaaaaaa-1111",
    cwd: "/depot",
    hook_event_name: "PostToolUse",
    tool_name: "TaskCreate",
    tool_input: {
      subject: "Écrire le cœur",
      description: "d",
      metadata: { branche: "feat/1998-tableau", issue: 1998, modelTier: "standard", model: "sonnet" },
    },
    tool_response: { task: { id: "3", subject: "Écrire le cœur" } },
    ...extra,
  };
}

function evtMaj(id, status, extra = {}) {
  return {
    session_id: "aaaaaaaa-1111",
    cwd: "/ailleurs",
    hook_event_name: "PostToolUse",
    tool_name: "TaskUpdate",
    tool_input: { taskId: id, status },
    ...extra,
  };
}

async function avecDossier(corps) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "etat-job-"));
  try {
    return await corps(d);
  } finally {
    // Windows : un descripteur tout juste fermé (git, publieur détaché) fait échouer la suppression en EPERM/ENOTEMPTY.
    // fs.promises.rm réessaie ; rmSync ignore maxRetries (Node 24).
    await fs.promises.rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function executer(cmd, args, { stdin = "", env = process.env } = {}) {
  return new Promise((resolu, rejete) => {
    const enfant = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    enfant.stdout.setEncoding("utf8");
    enfant.stderr.setEncoding("utf8");
    enfant.stdout.on("data", (m) => {
      stdout += m;
    });
    enfant.stderr.on("data", (m) => {
      stderr += m;
    });
    enfant.on("error", rejete);
    enfant.on("close", (code) => {
      if (code === 0) resolu({ stdout, stderr });
      else rejete(new Error(`code ${String(code)} : ${stderr}`));
    });
    enfant.stdin.end(stdin);
  });
}

test("nom de fichier : / remplacé par - (ADR-0107)", () => {
  assert.equal(nomFichierBranche("feat/1998-x"), "feat-1998-x");
  assert.equal(path.basename(cheminsBranche("/r", "feat/1998-x").instantane), "feat-1998-x.json");
});

test("issueDepuisNom : préfixes du dépôt reconnus, claude/<nom> et feature/ non", () => {
  assert.equal(issueDepuisNom("feat/1967-jev-choix-modele"), 1967);
  assert.equal(issueDepuisNom("recette/12-lot"), 12);
  assert.equal(issueDepuisNom("claude/stoic-curie-yag4jx"), null);
  assert.equal(issueDepuisNom("feature/12-x"), null);
});

test("lireMetadonnees : paramètre, sinon bloc json:metadata, sinon objet vide ; bloc illisible refusé", () => {
  assert.deepEqual(lireMetadonnees({ a: 1 }, "x"), { a: 1 });
  assert.deepEqual(lireMetadonnees(undefined, 'texte\n```json:metadata\n{"issue": 7}\n```\n'), { issue: 7 });
  assert.deepEqual(lireMetadonnees(undefined, "sans bloc"), {});
  assert.throws(() => lireMetadonnees(undefined, "```json:metadata\n{pas du json}\n```"), {
    code: "metadonnees-illisibles",
  });
});

test("extraireIdCreation : hypothèse H-A (tool_response.task.id)", () => {
  assert.equal(extraireIdCreation({ task: { id: "3" } }), "3");
  assert.equal(extraireIdCreation({ task: { id: 4 } }), "4");
  assert.equal(extraireIdCreation({}), null);
  assert.equal(extraireIdCreation("Task #3 created"), null);
});

test("normaliserEvenement : TaskCreate, TaskUpdate, TaskCreated", () => {
  const c = normaliserEvenement(evtCreation());
  assert.deepEqual([c.type, c.session, c.id, c.sujet], ["creation", "aaaaaaaa", "3", "Écrire le cœur"]);
  const m = normaliserEvenement(evtMaj("3", "in_progress"));
  assert.deepEqual([m.type, m.id, m.statut, m.sujet], ["maj", "3", "in_progress", null]);
  const tc = normaliserEvenement({
    session_id: "bbbbbbbb-2",
    cwd: "/d",
    hook_event_name: "TaskCreated",
    task_id: "4",
    task_subject: "S",
    task_description: '```json:metadata\n{"issue": 5}\n```',
  });
  assert.deepEqual([tc.type, tc.id, tc.metadonnees.issue], ["creation", "4", 5]);
});

test("normaliserEvenement : entrées refusées bruyamment", () => {
  assert.throws(() => normaliserEvenement(null), ErreurEtatJob);
  assert.throws(() => normaliserEvenement(evtCreation({ session_id: "" })), { code: "session-absente" });
  assert.throws(() => normaliserEvenement(evtCreation({ tool_response: {} })), { code: "id-absent" });
  assert.throws(() => normaliserEvenement(evtMaj("3", "en-cours")), { code: "statut-invalide" });
  assert.throws(() => normaliserEvenement(evtMaj("../x", "pending")), { code: "id-invalide" });
  assert.throws(
    () => normaliserEvenement(evtCreation({ tool_input: { description: "d" } })),
    { code: "sujet-absent" },
  );
});

test("resoudreCible : métadonnées, puis cwd et nom, puis git config", () => {
  assert.deepEqual(resoudreCible({ evenement: normaliserEvenement(evtCreation()), index: {}, git: GIT_MUET }), CIBLE);
  const sansMeta = normaliserEvenement(evtCreation({ tool_input: { subject: "s", description: "d" } }));
  const gitFix = { brancheCourante: () => "fix/1996-plafond", issueConfiguree: () => null };
  assert.deepEqual(resoudreCible({ evenement: sansMeta, index: {}, git: gitFix }), {
    branche: "fix/1996-plafond",
    issue: 1996,
  });
  const gitCloud = {
    brancheCourante: () => "claude/stoic-curie-yag4jx",
    issueConfiguree: (_cwd, b) => (b === "claude/stoic-curie-yag4jx" ? "1998" : null),
  };
  assert.deepEqual(resoudreCible({ evenement: sansMeta, index: {}, git: gitCloud }), {
    branche: "claude/stoic-curie-yag4jx",
    issue: 1998,
  });
});

test("resoudreCible : sans issue, erreur qui nomme la branche ; sans branche, erreur", () => {
  const sansMeta = normaliserEvenement(evtCreation({ tool_input: { subject: "s", description: "d" } }));
  const git = { brancheCourante: () => "claude/x", issueConfiguree: () => null };
  assert.throws(() => resoudreCible({ evenement: sansMeta, index: {}, git }), {
    code: "aucune-issue",
    message: "état non publié : aucune issue liée à claude/x",
  });
  assert.throws(() => resoudreCible({ evenement: sansMeta, index: {}, git: GIT_MUET }), { code: "branche-absente" });
});

test("resoudreCible : TaskUpdate suit l'index, jamais le cwd ; clé de prototype refusée", () => {
  const git = { brancheCourante: () => "fix/1-autre", issueConfiguree: () => null };
  const maj = normaliserEvenement(evtMaj("3", "in_progress"));
  assert.deepEqual(resoudreCible({ evenement: maj, index: { 3: CIBLE }, git }), CIBLE);
  assert.throws(() => resoudreCible({ evenement: maj, index: {}, git }), { code: "tache-inconnue" });
  const proto = normaliserEvenement(evtMaj("constructor", "pending"));
  assert.throws(() => resoudreCible({ evenement: proto, index: {}, git }), { code: "tache-inconnue" });
});

test("appliquerEvenement : création puis mise à jour, seq et champs", () => {
  const c = appliquerEvenement({
    instantane: null,
    evenement: normaliserEvenement(evtCreation()),
    cible: CIBLE,
    environnement: "local:POSTE",
    maintenant,
  });
  assert.equal(c.seq, 1);
  assert.deepEqual(c.taches, [
    { session: "aaaaaaaa", id: "3", sujet: "Écrire le cœur", statut: "pending", niveau: "standard", modele: "sonnet", porte: false },
  ]);
  const m = appliquerEvenement({
    instantane: c,
    evenement: normaliserEvenement(evtMaj("3", "in_progress")),
    cible: CIBLE,
    environnement: "local:POSTE",
    maintenant,
  });
  assert.equal(m.seq, 2);
  assert.equal(m.taches[0].statut, "in_progress");
  assert.doesNotThrow(() => validerInstantane(m));
});

test("appliquerEvenement : deux sessions au même id → deux tâches", () => {
  const a = appliquerEvenement({ instantane: null, evenement: normaliserEvenement(evtCreation()), cible: CIBLE, environnement: "local:P", maintenant });
  const b = appliquerEvenement({
    instantane: a,
    evenement: normaliserEvenement(evtCreation({ session_id: "bbbbbbbb-2222" })),
    cible: CIBLE,
    environnement: "local:P",
    maintenant,
  });
  assert.deepEqual(b.taches.map((t) => `${t.session}:${t.id}`), ["aaaaaaaa:3", "bbbbbbbb:3"]);
});

test("appliquerEvenement : user-gate → porte ; deleted → retirée ; tâche absente → erreur", () => {
  const porte = appliquerEvenement({
    instantane: null,
    evenement: normaliserEvenement(
      evtCreation({ tool_input: { subject: "Recette", description: "d", metadata: { ...CIBLE, userGate: true, tags: ["user-gate"] } } }),
    ),
    cible: CIBLE,
    environnement: "local:P",
    maintenant,
  });
  assert.equal(porte.taches[0].porte, true);
  const retiree = appliquerEvenement({ instantane: porte, evenement: normaliserEvenement(evtMaj("3", "deleted")), cible: CIBLE, environnement: "local:P", maintenant });
  assert.deepEqual(retiree.taches, []);
  assert.throws(
    () => appliquerEvenement({ instantane: retiree, evenement: normaliserEvenement(evtMaj("3", "completed")), cible: CIBLE, environnement: "local:P", maintenant }),
    { code: "tache-absente" },
  );
});

test("commentaire d'état : aller-retour, amorce non publiée, marqueur en tête exigé, JSON invalide refusé", () => {
  const inst = appliquerEvenement({ instantane: null, evenement: normaliserEvenement(evtCreation()), cible: CIBLE, environnement: "local:P", maintenant });
  const corps = corpsCommentaire({ ...inst, amorce: true });
  assert.ok(corps.startsWith("<!-- etat-job branche=feat/1998-tableau -->\n"));
  const relu = lireCorpsCommentaire(corps, "feat/1998-tableau");
  assert.deepEqual(relu.taches, inst.taches);
  assert.equal(relu.amorce, undefined);
  assert.throws(() => lireCorpsCommentaire(`Rapport qui cite ${corps}`, "feat/1998-tableau"), { code: "marqueur-absent" });
  assert.throws(
    () => lireCorpsCommentaire("<!-- etat-job branche=feat/1998-tableau -->\n```json\n{oups\n```\n", "feat/1998-tableau"),
    { code: "instantane-illisible" },
  );
});

test("lienSuivant : rel=next extrait, sinon null", () => {
  assert.equal(
    lienSuivant('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'),
    "https://api.github.com/x?page=2",
  );
  assert.equal(lienSuivant(null), null);
  assert.equal(lienSuivant('<https://api.github.com/x?page=1>; rel="prev"'), null);
});

test("envPublieur : cloud avec HTTPS_PROXY → NODE_USE_ENV_PROXY=1 et avertissement EHPA tu, entrée intacte", () => {
  const env = { CLAUDE_CODE_REMOTE: "true", HTTPS_PROXY: "http://proxy:8080", PATH: "/bin" };
  const r = envPublieur(env);
  assert.equal(r.NODE_USE_ENV_PROXY, "1");
  assert.equal(r.NODE_OPTIONS, "--disable-warning=UNDICI-EHPA");
  assert.equal(r.PATH, "/bin");
  assert.equal(r.HTTPS_PROXY, "http://proxy:8080");
  assert.deepEqual(env, { CLAUDE_CODE_REMOTE: "true", HTTPS_PROXY: "http://proxy:8080", PATH: "/bin" });
});

test("envPublieur : https_proxy minuscule, NODE_OPTIONS existant, valeur forcée, drapeau sans doublon", () => {
  const P = { CLAUDE_CODE_REMOTE: "true", HTTPS_PROXY: "http://p:1" };
  assert.equal(envPublieur({ CLAUDE_CODE_REMOTE: "true", https_proxy: "http://p:1" }).NODE_USE_ENV_PROXY, "1");
  assert.equal(
    envPublieur({ ...P, NODE_OPTIONS: "--max-old-space-size=8192" }).NODE_OPTIONS,
    "--max-old-space-size=8192 --disable-warning=UNDICI-EHPA",
  );
  assert.equal(envPublieur({ ...P, NODE_USE_ENV_PROXY: "0" }).NODE_USE_ENV_PROXY, "1");
  assert.equal(
    envPublieur({ ...P, NODE_OPTIONS: "--max-old-space-size=8192 --disable-warning=UNDICI-EHPA" }).NODE_OPTIONS,
    "--max-old-space-size=8192 --disable-warning=UNDICI-EHPA",
  );
  assert.equal(envPublieur({ ...P, NODE_OPTIONS: "" }).NODE_OPTIONS, "--disable-warning=UNDICI-EHPA");
});

test("envPublieur : sans proxy ou hors cloud → le même objet, inchangé", () => {
  for (const env of [
    { CLAUDE_CODE_REMOTE: "true" },
    { CLAUDE_CODE_REMOTE: "true", HTTPS_PROXY: "", https_proxy: "" },
    { HTTPS_PROXY: "http://p:1" },
    { CLAUDE_CODE_REMOTE: "false", HTTPS_PROXY: "http://p:1" },
  ]) {
    const copie = { ...env };
    assert.equal(envPublieur(env), env);
    assert.deepEqual(env, copie);
  }
});

test("avecVerrou : verrou plus vieux que 5 s cassé et journalisé", async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    fs.writeFileSync(verrou, "999999 2026-10-17T09:00:00Z\n");
    const passe = new Date(Date.now() - (DELAI_VERROU_PERIME_MS + 1000));
    fs.utimesSync(verrou, passe, passe);
    const journal = [];
    const r = await avecVerrou(verrou, () => "fait", {
      maintenant: () => new Date(),
      journaliser: (l) => {
        journal.push(l);
      },
    });
    assert.equal(r, "fait");
    assert.equal(journal.length, 1);
    assert.equal(journal[0].evenement, "verrou-perime-casse");
    assert.equal(fs.existsSync(verrou), false);
  });
});

test("avecVerrou : verrou récent tenu → erreur verrou-occupe au-delà du budget", async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    fs.writeFileSync(verrou, "1\n");
    await assert.rejects(
      avecVerrou(verrou, () => "jamais", { maintenant: () => new Date(), journaliser: () => undefined, budgetMs: 200 }),
      { code: "verrou-occupe", message: /^verrou b\.lock occupé depuis plus de 200 ms$/ },
    );
  });
});

test("traiter : dossier de verrous refusé (EPERM durable) → l'agent et le journal lisent la cause, jamais « verrou-occupe »", async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d);
    const { writeFileSync, openSync } = fs;
    const refuse = (chemin) => typeof chemin === "string" && chemin.endsWith(".lock");
    const eperm = (chemin) => Object.assign(new Error(`EPERM: operation not permitted, open '${chemin}'`), { code: "EPERM" });
    fs.writeFileSync = (chemin, ...reste) => {
      if (refuse(chemin)) throw eperm(chemin);
      return writeFileSync(chemin, ...reste);
    };
    fs.openSync = (chemin, ...reste) => {
      if (refuse(chemin)) throw eperm(chemin);
      return openSync(chemin, ...reste);
    };
    let resultat;
    try {
      resultat = await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    } finally {
      fs.writeFileSync = writeFileSync;
      fs.openSync = openSync;
    }
    const contexte = resultat.sortie.hookSpecificOutput.additionalContext;
    assert.match(contexte, /EPERM: operation not permitted, open '.*index-aaaaaaaa.lock'/);
    assert.doesNotMatch(contexte, /occupé/);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].code, "verrou-refuse");
    assert.match(journal[0].message, /EPERM: operation not permitted, open '.*index-aaaaaaaa.lock'/);
  });
});

test("verrou : 6 processus × 15 créations concurrentes, aucune tâche perdue", async () => {
  await avecDossier(async (d) => {
    const coeur = pathToFileURL(path.join(ICI, "etat-job-core.mjs")).href;
    const code = `
      import { appliquerEvenement, avecVerrou, cheminsBranche, ecrireJsonAtomique, lireJson, normaliserEvenement, validerInstantane } from ${JSON.stringify(coeur)};
      const [racine, n] = process.argv.slice(1);
      const cible = { branche: "feat/1998-tableau", issue: 1998 };
      const c = cheminsBranche(racine, cible.branche);
      for (let i = 0; i < 15; i += 1) {
        const evenement = normaliserEvenement({ session_id: "s" + n + "-xxxxxxx", cwd: "/d", hook_event_name: "PostToolUse", tool_name: "TaskCreate",
          tool_input: { subject: "t", description: "d", metadata: cible }, tool_response: { task: { id: String(i) } } });
        await avecVerrou(c.verrou, () => {
          const lu = lireJson(c.instantane);
          ecrireJsonAtomique(c.instantane, appliquerEvenement({ instantane: lu === null ? null : validerInstantane(lu), evenement, cible, environnement: "local:test", maintenant: () => new Date() }));
        }, { maintenant: () => new Date(), journaliser: () => undefined });
      }`;
    await Promise.all(
      [0, 1, 2, 3, 4, 5].map((n) => executer(process.execPath, ["--input-type=module", "-e", code, d, String(n)])),
    );
    const final = validerInstantane(JSON.parse(fs.readFileSync(cheminsBranche(d, "feat/1998-tableau").instantane, "utf8")));
    assert.equal(final.taches.length, 90);
    assert.equal(final.seq, 90);
  });
});

test("avecVerrou : A garde la main plus de 5 s, B casse son verrou, A sort sans effacer celui de B", async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    const journalA = [];
    const options = { maintenant: () => new Date(), journaliser: () => undefined };
    let entreeB = () => undefined;
    const bDedans = new Promise((r) => {
      entreeB = r;
    });
    let sortieB = () => undefined;
    const bTient = new Promise((r) => {
      sortieB = r;
    });
    let pB = Promise.resolve();
    await avecVerrou(
      verrou,
      async () => {
        const passe = new Date(Date.now() - (DELAI_VERROU_PERIME_MS + 1000));
        fs.utimesSync(verrou, passe, passe);
        pB = avecVerrou(
          verrou,
          async () => {
            entreeB();
            await bTient;
          },
          options,
        );
        await bDedans;
      },
      {
        ...options,
        journaliser: (l) => {
          journalA.push(l);
        },
      },
    );
    assert.equal(fs.existsSync(verrou), true, "A a effacé le verrou de B");
    await assert.rejects(avecVerrou(verrou, () => "C", { ...options, budgetMs: 100 }), {
      code: "verrou-occupe",
    });
    assert.deepEqual(
      journalA.map((l) => l.evenement),
      ["verrou-non-libere"],
    );
    sortieB();
    await pB;
    assert.equal(fs.existsSync(verrou), false);
    assert.deepEqual(fs.readdirSync(d), []);
  });
});

test("avecVerrou : budget mesuré hors de l'horloge injectée (horloge figée)", async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    fs.writeFileSync(verrou, "1\n");
    const issue = await Promise.race([
      avecVerrou(verrou, () => "jamais", { maintenant, journaliser: () => undefined, budgetMs: 200 }).then(
        () => "acquis",
        (e) => e.code,
      ),
      attendre(2000, "toujours-bloque", { ref: false }),
    ]);
    // Débloque une attente sans fin, pour que le rouge se termine.
    fs.rmSync(verrou, { force: true });
    assert.equal(issue, "verrou-occupe");
  });
});

test("validerBranche : noms dangereux ou réservés refusés, sans casse", () => {
  assert.equal(validerBranche("feat/1998-tableau"), "feat/1998-tableau");
  for (const nom of [
    "feat/../x",
    "x\\y",
    "x\\..\\..\\..\\settings.json",
    "auth",
    "AUTH",
    "index-x",
    "Index-aaaa",
    "x.publication",
    "x.Publication",
  ]) {
    assert.throws(() => validerBranche(nom), { code: "branche-invalide" }, nom);
  }
});

test("validerInstantane : version, seq et statut de tâche contrôlés", () => {
  const valide = {
    version: 1,
    seq: 2,
    branche: "feat/1998-tableau",
    issue: 1998,
    session: "local:P",
    maj: "2026-10-17T10:00:00.000Z",
    taches: [
      { session: "aaaaaaaa", id: "3", sujet: "S", statut: "pending", niveau: null, modele: null, porte: false },
    ],
  };
  assert.doesNotThrow(() => validerInstantane(valide));
  assert.throws(() => validerInstantane({ ...valide, version: 2 }), { code: "instantane-illisible" });
  assert.throws(() => validerInstantane({ ...valide, seq: -1 }), { code: "instantane-illisible" });
  assert.throws(
    () => validerInstantane({ ...valide, taches: [{ ...valide.taches[0], statut: "en-cours" }] }),
    { code: "instantane-illisible" },
  );
});

test("lireCorpsCommentaire : branche du JSON différente du marqueur refusée", () => {
  const corps = (branche) =>
    `<!-- etat-job branche=feat/1998-tableau -->\n\`\`\`json\n{"version":1,"seq":1,"branche":"${branche}","issue":1998,"session":"local:P","maj":"2026-10-17T10:00:00.000Z","taches":[]}\n\`\`\`\n`;
  assert.equal(lireCorpsCommentaire(corps("feat/1998-tableau"), "feat/1998-tableau").seq, 1);
  assert.throws(() => lireCorpsCommentaire(corps("feat/autre"), "feat/1998-tableau"), {
    code: "instantane-illisible",
  });
});

test("lireCorpsCommentaire : corps en CRLF accepté", () => {
  const inst = appliquerEvenement({
    instantane: null,
    evenement: normaliserEvenement(evtCreation()),
    cible: CIBLE,
    environnement: "local:P",
    maintenant,
  });
  const crlf = corpsCommentaire(inst).replaceAll("\n", "\r\n");
  assert.deepEqual(lireCorpsCommentaire(crlf, "feat/1998-tableau").taches, inst.taches);
});

test("appliquerEvenement : seq croît à chaque événement, y compris après un deleted", () => {
  const appliquer = (instantane, evenement) =>
    appliquerEvenement({ instantane, evenement, cible: CIBLE, environnement: "local:P", maintenant });
  const cree = appliquer(null, normaliserEvenement(evtCreation()));
  const efface = appliquer(cree, normaliserEvenement(evtMaj("3", "deleted")));
  const recree = appliquer(efface, normaliserEvenement(evtCreation()));
  assert.deepEqual([cree.seq, efface.seq, recree.seq], [1, 2, 3]);
});

test("appliquerEvenement : instantané d'une autre branche ou d'une autre issue refusé", () => {
  const appliquer = (instantane, cible, id) =>
    appliquerEvenement({
      instantane,
      evenement: normaliserEvenement(evtCreation({ tool_response: { task: { id } } })),
      cible,
      environnement: "local:P",
      maintenant,
    });
  // a : feat/a-b et feat-a/b partagent le fichier feat-a-b.json.
  assert.equal(nomFichierBranche("feat/a-b"), nomFichierBranche("feat-a/b"));
  const a = appliquer(null, { branche: "feat/a-b", issue: 10 }, "3");
  assert.throws(() => appliquer(a, { branche: "feat-a/b", issue: 20 }, "7"), {
    code: "cible-incoherente",
  });
  // b : même branche, une tâche dont les métadonnées portent une autre issue.
  const b = appliquer(null, CIBLE, "3");
  assert.throws(() => appliquer(b, { branche: CIBLE.branche, issue: 1999 }, "4"), {
    code: "cible-incoherente",
  });
});

test("normaliserEvenement : cwd absent ou vide refusé", () => {
  assert.throws(() => normaliserEvenement(evtMaj("3", "pending", { cwd: undefined })), {
    code: "cwd-absent",
  });
  assert.throws(() => normaliserEvenement(evtMaj("3", "pending", { cwd: "" })), { code: "cwd-absent" });
});

test("normaliserEvenement : hook_event_name autre que PostToolUse ou TaskCreated refusé", () => {
  for (const nom of ["PreToolUse", undefined]) {
    assert.throws(
      () => normaliserEvenement(evtMaj("3", "completed", { hook_event_name: nom })),
      { code: "evenement-inattendu" },
      String(nom),
    );
  }
});

test("normaliserEvenement : session_id hors motif refusé avant d'entrer dans un chemin", () => {
  for (const s of ["../../x", "a/b", "a.b", "a b"]) {
    assert.throws(() => normaliserEvenement(evtMaj("3", "pending", { session_id: s })), { code: "session-invalide" }, s);
  }
  const uuid = "0d9f5c3e-7b1a-4c2e-9f00-123456789abc";
  assert.equal(normaliserEvenement(evtMaj("3", "pending", { session_id: uuid })).session, "0d9f5c3e");
});

test("métadonnées : clé présente et invalide refusée, clé absente ou nulle permise", () => {
  const cas = [
    ["modelTier", "Standard"],
    ["modelTier", 3],
    ["model", 5],
    ["model", ""],
    ["userGate", "true"],
  ];
  for (const [cle, valeur] of cas) {
    const nom = `${cle}=${JSON.stringify(valeur)}`;
    const creation = evtCreation({ tool_input: { subject: "s", description: "d", metadata: { ...CIBLE, [cle]: valeur } } });
    assert.throws(() => normaliserEvenement(creation), { code: "metadonnees-invalides" }, `création ${nom}`);
    const maj = evtMaj("3", "pending", { tool_input: { taskId: "3", metadata: { [cle]: valeur } } });
    assert.throws(() => normaliserEvenement(maj), { code: "metadonnees-invalides" }, `maj ${nom}`);
  }
  const bloc = '```json:metadata\n{"issue": 1998, "modelTier": "fast"}\n```';
  assert.throws(
    () => normaliserEvenement(evtCreation({ tool_input: { subject: "s", description: bloc } })),
    { code: "metadonnees-invalides" },
  );
  const sans = appliquerEvenement({
    instantane: null,
    evenement: normaliserEvenement(
      evtCreation({ tool_input: { subject: "s", description: "d", metadata: { ...CIBLE, modelTier: null } } }),
    ),
    cible: CIBLE,
    environnement: "local:P",
    maintenant,
  });
  const t = sans.taches[0];
  assert.deepEqual([t.niveau, t.modele, t.porte], [null, null, false]);
});

test("resoudreCible : numéro tiré du nom validé (fix/0-typo refusé)", () => {
  const sansMeta = normaliserEvenement(evtCreation({ tool_input: { subject: "s", description: "d" } }));
  const git = { brancheCourante: () => "fix/0-typo", issueConfiguree: () => null };
  assert.throws(() => resoudreCible({ evenement: sansMeta, index: {}, git }), { code: "issue-invalide" });
});

export { attendre, avecDossier, evtCreation, evtMaj, executer, CIBLE, GIT_MUET, ICI, maintenant };

function deps(d, extra = {}) {
  const lances = [];
  const journal = [];
  const args = {
    racine: d,
    env: { CLAUDE_CODE_REMOTE: "false" },
    git: GIT_MUET,
    lancerPublieur: (branche, session) => {
      lances.push([branche, session]);
    },
    maintenant,
    journaliser: (l) => {
      journal.push(l);
    },
    ...extra,
  };
  return { lances, journal, args };
}

const fichier = (d, nom) => path.join(d, ".claude", "logs", "etat-job", nom);

test("traiter : TaskCreate puis TaskUpdate → instantané, publieur lancé, aucune sortie", async () => {
  await avecDossier(async (d) => {
    const { lances, args } = deps(d);
    assert.deepEqual(await traiter({ brut: JSON.stringify(evtCreation()), ...args }), { sortie: null, diagnostic: null });
    assert.deepEqual(await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args }), { sortie: null, diagnostic: null });
    const inst = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")));
    assert.equal(inst.taches[0].statut, "in_progress");
    assert.deepEqual(lances, [
      ["feat/1998-tableau", "aaaaaaaa"],
      ["feat/1998-tableau", "aaaaaaaa"],
    ]);
  });
});

test("traiter : TaskUpdate après changement de répertoire → branche de l'index", async () => {
  await avecDossier(async (d) => {
    const { args } = deps(d, { git: { brancheCourante: () => "fix/1-autre", issueConfiguree: () => null } });
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    await traiter({ brut: JSON.stringify(evtMaj("3", "completed")), ...args });
    assert.equal(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")).taches[0].statut, "completed");
    assert.equal(fs.existsSync(fichier(d, "fix-1-autre.json")), false);
  });
});

// EPERM « delete pending » de Windows, injecté sous Linux : le cœur appelle les
// fonctions par l'objet node:fs, que ces tests remplacent puis restaurent. Au-delà
// de BORNE_APPELS, un piège lève une erreur qui n'est pas EPERM : une boucle serrée
// échoue au lieu de bloquer le processus.
const BORNE_APPELS = 1000;
const estVerrou = (chemin) => typeof chemin === "string" && chemin.endsWith(".lock");
const erreurEperm = (op, chemin) =>
  Object.assign(new Error(`EPERM: operation not permitted, ${op} '${chemin}'`), { code: "EPERM" });
const optionsVerrou = { maintenant: () => new Date(), journaliser: () => undefined, budgetMs: 200 };

async function avecFsPiege(pieges, corps) {
  const originaux = Object.fromEntries(Object.keys(pieges).map((nom) => [nom, fs[nom]]));
  for (const [nom, piege] of Object.entries(pieges)) fs[nom] = piege(originaux[nom]);
  try {
    return await corps();
  } finally {
    Object.assign(fs, originaux);
  }
}

function compteur(nom) {
  let n = 0;
  return () => {
    n += 1;
    if (n > BORNE_APPELS) throw new Error(`${nom} : plus de ${String(BORNE_APPELS)} appels, boucle serrée`);
    return n;
  };
}

function verrouPerime(d) {
  const verrou = path.join(d, "b.lock");
  fs.writeFileSync(verrou, "999999 2026-10-17T09:00:00Z\n");
  const passe = new Date(Date.now() - (DELAI_VERROU_PERIME_MS + 1000));
  fs.utimesSync(verrou, passe, passe);
  return verrou;
}

// traiter garde le budget par défaut (6 s) : le timeout le dépasse, pour que l'échec dise sa cause.
test("traiter : EPERM transitoire sur la création wx et la lecture du verrou → verrou pris, tâche écrite", { timeout: 10000 }, async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d);
    const restants = { creation: 3, lecture: 3 };
    const resultat = await avecFsPiege(
      {
        writeFileSync: (original) => (chemin, donnees, options) => {
          if (estVerrou(chemin) && restants.creation > 0) {
            restants.creation -= 1;
            throw erreurEperm("open", chemin);
          }
          return original(chemin, donnees, options);
        },
        openSync: (original) => (chemin, ...reste) => {
          if (estVerrou(chemin) && restants.lecture > 0) {
            restants.lecture -= 1;
            throw erreurEperm("open", chemin);
          }
          return original(chemin, ...reste);
        },
      },
      () => traiter({ brut: JSON.stringify(evtCreation()), ...args }),
    );
    assert.deepEqual(restants, { creation: 0, lecture: 0 }, "EPERM injecté jamais rencontré");
    assert.deepEqual(resultat, { sortie: null, diagnostic: null });
    assert.deepEqual(journal, []);
    const inst = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")));
    assert.deepEqual(
      inst.taches.map((t) => t.id),
      ["3"],
    );
  });
});

test("avecVerrou : EPERM durable à la création → essais espacés, jamais une boucle serrée", { timeout: 5000 }, async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    const creation = compteur("création");
    let essais = 0;
    await avecFsPiege(
      {
        writeFileSync: (original) => (chemin, ...reste) => {
          if (chemin !== verrou) return original(chemin, ...reste);
          essais = creation();
          throw erreurEperm("open", chemin);
        },
      },
      () => assert.rejects(avecVerrou(verrou, () => "jamais", optionsVerrou), { code: "verrou-refuse" }),
    );
    // 200 ms de budget à 25 ms de pas : une dizaine d'essais.
    assert.ok(essais >= 2 && essais <= 20, `${String(essais)} essais en 200 ms`);
  });
});

test("avecVerrou : rename du verrou périmé refusé en EPERM transitoire → réessayé, verrou cassé", { timeout: 5000 }, async () => {
  await avecDossier(async (d) => {
    const verrou = verrouPerime(d);
    const journal = [];
    let refus = 2;
    const r = await avecFsPiege(
      {
        renameSync: (original) => (source, cible) => {
          if (source === verrou && refus > 0) {
            refus -= 1;
            throw erreurEperm("rename", source);
          }
          return original(source, cible);
        },
      },
      () =>
        avecVerrou(verrou, () => "fait", {
          ...optionsVerrou,
          journaliser: (l) => {
            journal.push(l);
          },
        }),
    );
    assert.equal(r, "fait");
    assert.equal(refus, 0, "EPERM injecté jamais rencontré");
    assert.deepEqual(
      journal.map((l) => l.evenement),
      ["verrou-perime-casse"],
    );
    assert.deepEqual(fs.readdirSync(d), []);
  });
});

test("avecVerrou : rename du verrou périmé refusé durablement → verrou-occupe qui cite la cause", { timeout: 5000 }, async () => {
  await avecDossier(async (d) => {
    const verrou = verrouPerime(d);
    const renommage = compteur("rename");
    await avecFsPiege(
      {
        renameSync: (original) => (source, cible) => {
          if (source !== verrou) return original(source, cible);
          renommage();
          throw erreurEperm("rename", source);
        },
      },
      () =>
        assert.rejects(avecVerrou(verrou, () => "jamais", optionsVerrou), {
          code: "verrou-occupe",
          message: /^verrou b\.lock occupé depuis plus de 200 ms \(dernier refus : EPERM: operation not permitted, rename '.*b\.lock'\)$/,
        }),
    );
  });
});

test("avecVerrou : verrou tenu et lu, un EPERM passager à la création → verrou-occupe, jamais verrou-refuse", { timeout: 5000 }, async () => {
  await avecDossier(async (d) => {
    const verrou = path.join(d, "b.lock");
    fs.writeFileSync(verrou, "1\n");
    let refus = 1;
    await avecFsPiege(
      {
        writeFileSync: (original) => (chemin, ...reste) => {
          if (chemin === verrou && refus > 0) {
            refus -= 1;
            throw erreurEperm("open", chemin);
          }
          return original(chemin, ...reste);
        },
      },
      // La cause reste citée même si l'EPERM est ancien : c'est le dernier refus vu.
      () =>
        assert.rejects(avecVerrou(verrou, () => "jamais", optionsVerrou), {
          code: "verrou-occupe",
          message: /^verrou b\.lock occupé depuis plus de 200 ms \(dernier refus : EPERM: operation not permitted, open '.*b\.lock'\)$/,
        }),
    );
    assert.equal(refus, 0, "EPERM injecté jamais rencontré");
  });
});

test("traiter : sans issue → additionalContext, rien écrit, aucun publieur, journalisé", async () => {
  await avecDossier(async (d) => {
    const { lances, journal, args } = deps(d, { git: { brancheCourante: () => "claude/x", issueConfiguree: () => null } });
    const { sortie } = await traiter({ brut: JSON.stringify(evtCreation({ tool_input: { subject: "s", description: "d" } })), ...args });
    assert.deepEqual(sortie, {
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "etat-job : état non publié : aucune issue liée à claude/x" },
    });
    assert.equal(lances.length, 0);
    assert.equal(fs.existsSync(fichier(d, "claude-x.json")), false);
    assert.equal(journal.at(-1).message, "état non publié : aucune issue liée à claude/x");
  });
});

test("traiter : session marquée 401 → ordre MCP avec l'instantané entier, aucun publieur", async () => {
  await avecDossier(async (d) => {
    const { lances, journal, args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ aaaaaaaa: { statut: 401, date: "2026-10-17T10:00:00Z", branche: "feat/1998-tableau" } }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    const texte = sortie.hookSpecificOutput.additionalContext;
    assert.match(texte, /outil MCP GitHub/);
    assert.match(texte, /labels existants plus `en-cours`/);
    assert.match(texte, /issue #1998/);
    // lastIndexOf : la consigne cite le marqueur entre apostrophes avant le corps à publier.
    const inst = lireCorpsCommentaire(texte.slice(texte.lastIndexOf("<!-- etat-job")), "feat/1998-tableau");
    assert.equal(inst.taches[0].statut, "in_progress");
    assert.equal(lances.length, 1);
    // Le message envoyé à l'agent est aussi journalisé, et ne bloque jamais l'outil.
    assert.equal(journal.length, 1);
    assert.equal(texte, `etat-job : ${journal[0].message}`);
    assert.equal(journal[0].session_id, "aaaaaaaa-1111");
    assert.doesNotMatch(JSON.stringify(sortie), /"decision"/);
  });
});

test("traiter : dernière publication en échec → rapportée à l'agent", async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "feat-1998-tableau.publication.json"), JSON.stringify({ seq: 1, ok: false, raison: "HTTP 502", date: "x" }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    assert.equal(
      sortie.hookSpecificOutput.additionalContext,
      "etat-job : dernière publication de feat/1998-tableau en échec (seq 1) : HTTP 502",
    );
    // Le message envoyé à l'agent est aussi journalisé, et ne bloque jamais l'outil.
    assert.equal(journal.length, 1);
    assert.equal(journal[0].message, "dernière publication de feat/1998-tableau en échec (seq 1) : HTTP 502");
    assert.doesNotMatch(JSON.stringify(sortie), /"decision"/);
  });
});

test("traiter : jamais de décision block, même sur erreur interne ou entrée illisible", async () => {
  await avecDossier(async (d) => {
    const { args } = deps(d, {
      lancerPublieur: () => {
        throw new Error("spawn impossible");
      },
    });
    const interne = await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    assert.match(interne.sortie.hookSpecificOutput.additionalContext, /erreur interne : spawn impossible/);
    const illisible = await traiter({ brut: "pas du json", ...args });
    assert.match(illisible.sortie.hookSpecificOutput.additionalContext, /entrée de hook illisible/);
    for (const r of [interne, illisible]) assert.doesNotMatch(JSON.stringify(r.sortie), /"decision"/);
  });
});

test("aucun appel réseau : une commande calculée n'échappe pas au contrôle (spawn et execFileSync)", () => {
  const coeur = fs.readFileSync(path.join(ICI, "etat-job-core.mjs"), "utf8");
  const entree = fs.readFileSync(path.join(ICI, "etat-job.mjs"), "utf8");
  // Le cœur lance node, jamais un exécutable calculé ; il n'a qu'un seul spawn.
  assert.equal(coeur.match(/\bspawn\(/g)?.length, 1);
  assert.match(coeur, /spawn\(process\.execPath,/);
  // L'entrée n'appelle execFileSync qu'avec "git".
  assert.equal(entree.match(/\bexecFileSync\(/g)?.length, entree.match(/\bexecFileSync\("git",/g)?.length);
  // Aucune autre fonction de child_process (execSync, spawnSync, fork…) n'est importée.
  assert.ok(coeur.includes('import { spawn } from "node:child_process";'));
  assert.ok(entree.includes('import { execFileSync } from "node:child_process";'));
  assert.equal(coeur.match(/node:child_process/g)?.length, 1);
  assert.equal(entree.match(/node:child_process/g)?.length, 1);
});

test("aucun appel réseau : source sans fetch/http/gh, et fetch global piégé jamais appelé", async () => {
  for (const f of ["etat-job-core.mjs", "etat-job.mjs"]) {
    const source = fs.readFileSync(path.join(ICI, f), "utf8");
    const interdits = [
      /\bfetch\s*\(/,
      /node:https?\b/,
      /node:net\b/,
      /node:dns\b/,
      /node:tls\b/,
      /["'](node:)?(https?|net|dns|tls|http2)["']/,
      /["'](gh|curl|wget)["']/,
    ];
    for (const interdit of interdits) {
      assert.doesNotMatch(source, interdit, `${f} : ${String(interdit)}`);
    }
  }
  const fetchOrigine = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = () => {
    appels += 1;
    throw new Error("réseau interdit au hook");
  };
  try {
    await avecDossier(async (d) => {
      const { args } = deps(d);
      await traiter({ brut: JSON.stringify(evtCreation()), ...args });
      await traiter({ brut: JSON.stringify(evtMaj("3", "completed")), ...args });
    });
  } finally {
    globalThis.fetch = fetchOrigine;
  }
  assert.equal(appels, 0);
});

test("point d'entrée : rend la main sans attendre le publieur détaché", async () => {
  await avecDossier(async (d) => {
    const hooks = path.join(d, ".claude", "hooks");
    fs.mkdirSync(hooks, { recursive: true });
    for (const f of ["etat-job.mjs", "etat-job-core.mjs"]) fs.copyFileSync(path.join(ICI, f), path.join(hooks, f));
    const temoin = path.join(d, "publie.txt");
    fs.writeFileSync(
      path.join(hooks, "etat-job-publier.mjs"),
      `import fs from "node:fs";\nsetTimeout(() => { fs.writeFileSync(${JSON.stringify(temoin)}, process.argv.slice(2).join(" ")); }, 2000);\n`,
    );
    const debut = Date.now();
    const { stdout } = await executer(process.execPath, [path.join(hooks, "etat-job.mjs")], {
      stdin: JSON.stringify(evtCreation({ cwd: d })),
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d },
    });
    const duree = Date.now() - debut;
    assert.equal(stdout, "");
    assert.ok(duree < 1500, `durée ${String(duree)} ms`);
    assert.equal(fs.existsSync(temoin), false, "le hook a attendu le publieur");
    await attendre(3000);
    assert.equal(fs.readFileSync(temoin, "utf8"), "feat/1998-tableau aaaaaaaa");
  });
});

// Arbitrage du coordinateur : deux appels git à 2 s de délai sous le verrou
// d'index approcheraient sa péremption (5 s). La cible se résout avant.
test("traiter : git n'est jamais appelé pendant que le verrou d'index est tenu", async () => {
  await avecDossier(async (d) => {
    const verrouIndex = fichier(d, "index-aaaaaaaa.lock");
    const verrousTenus = [];
    const git = {
      brancheCourante: () => {
        verrousTenus.push(fs.existsSync(verrouIndex));
        return "claude/stoic-curie-yag4jx";
      },
      issueConfiguree: () => {
        verrousTenus.push(fs.existsSync(verrouIndex));
        return "1998";
      },
    };
    const { args } = deps(d, { git });
    const sansMeta = evtCreation({ tool_input: { subject: "s", description: "d" } });
    assert.deepEqual(await traiter({ brut: JSON.stringify(sansMeta), ...args }), { sortie: null, diagnostic: null });
    assert.deepEqual(verrousTenus, [false, false]);
    assert.equal(fs.existsSync(fichier(d, "claude-stoic-curie-yag4jx.json")), true);
  });
});

test("traiter : résultat de publication en échec sans raison → erreur nommée, jamais « undefined »", async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "feat-1998-tableau.publication.json"), JSON.stringify({ seq: 1, ok: false, date: "x" }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    const texte = sortie.hookSpecificOutput.additionalContext;
    assert.match(texte, /résultat de publication illisible/);
    assert.doesNotMatch(texte, /undefined/);
    assert.equal(journal.at(-1).code, "publication-illisible");
  });
});

test("traiter : sortie de TaskCreated sous son propre hookEventName", async () => {
  await avecDossier(async (d) => {
    const { args } = deps(d, { git: { brancheCourante: () => "claude/x", issueConfiguree: () => null } });
    const evenement = {
      session_id: "aaaaaaaa-1111",
      cwd: "/depot",
      hook_event_name: "TaskCreated",
      task_id: "4",
      task_subject: "S",
      task_description: "d",
    };
    const { sortie } = await traiter({ brut: JSON.stringify(evenement), ...args });
    assert.equal(sortie.hookSpecificOutput.hookEventName, "TaskCreated");
  });
});

test("traiter : chaque message à l'agent est journalisé avec la session et son code", async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d, {
      git: { brancheCourante: () => "claude/x", issueConfiguree: () => null },
      lancerPublieur: () => {
        throw new Error("spawn impossible");
      },
    });
    const sansIssue = evtCreation({ tool_input: { subject: "s", description: "d" } });
    await traiter({ brut: JSON.stringify(sansIssue), ...args });
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    await traiter({ brut: "pas du json", ...args });
    assert.deepEqual(
      journal.map((l) => [l.session_id ?? null, l.code ?? null]),
      [
        ["aaaaaaaa-1111", "aucune-issue"],
        ["aaaaaaaa-1111", "erreur-interne"],
        [null, null],
      ],
    );
    assert.ok(journal.every((l) => typeof l.message === "string" && l.date === "2026-10-17T10:00:00.000Z"));
  });
});

test("traiter : session absente d'auth.json (marquée sous un autre id) → publieur lancé", async () => {
  await avecDossier(async (d) => {
    const { lances, args } = deps(d);
    fs.mkdirSync(path.dirname(fichier(d, "auth.json")), { recursive: true });
    fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ bbbbbbbb: { statut: 401 } }));
    assert.deepEqual(await traiter({ brut: JSON.stringify(evtCreation()), ...args }), { sortie: null, diagnostic: null });
    assert.equal(lances.length, 1);
  });
});

test("traiter : index ou auth.json qui n'est pas un objet → erreur nommée pour l'agent", async () => {
  await avecDossier(async (d) => {
    const { lances, args } = deps(d);
    fs.mkdirSync(path.dirname(fichier(d, "auth.json")), { recursive: true });
    fs.writeFileSync(fichier(d, "index-aaaaaaaa.json"), "[]");
    const index = await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    assert.match(index.sortie.hookSpecificOutput.additionalContext, /index de session illisible/);
    fs.rmSync(fichier(d, "index-aaaaaaaa.json"));
    fs.writeFileSync(fichier(d, "auth.json"), "[]");
    const auth = await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    assert.match(auth.sortie.hookSpecificOutput.additionalContext, /fichier illisible/);
    assert.equal(lances.length, 0);
  });
});

// Copie le hook dans un dossier jetable avec un publieur inoffensif : le vrai
// publieur (tâche 4) parlerait à GitHub.
function installerHook(d, publieur = "// publieur inoffensif\n") {
  const hooks = path.join(d, ".claude", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  for (const f of ["etat-job.mjs", "etat-job-core.mjs"]) fs.copyFileSync(path.join(ICI, f), path.join(hooks, f));
  if (publieur !== null) fs.writeFileSync(path.join(hooks, "etat-job-publier.mjs"), publieur);
  return path.join(hooks, "etat-job.mjs");
}

test("point d'entrée : en cloud avec HTTPS_PROXY, le publieur reçoit NODE_USE_ENV_PROXY=1 et le drapeau EHPA ; en local, rien", async () => {
  const cas = [
    [
      "cloud",
      { CLAUDE_CODE_REMOTE: "true", HTTPS_PROXY: "http://127.0.0.1:9" },
      { proxy: "1", options: "--disable-warning=UNDICI-EHPA" },
    ],
    ["local", { HTTPS_PROXY: "http://127.0.0.1:9" }, { proxy: null, options: null }],
  ];
  for (const [nom, extra, attendu] of cas) {
    await avecDossier(async (d) => {
      const temoin = path.join(d, "env.json");
      const hook = installerHook(
        d,
        `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(temoin)}, JSON.stringify({ proxy: process.env.NODE_USE_ENV_PROXY ?? null, options: process.env.NODE_OPTIONS ?? null }));\n`,
      );
      await executer(process.execPath, [hook], {
        stdin: JSON.stringify(evtCreation({ cwd: d })),
        env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d, ...extra },
      });
      for (let i = 0; i < 30 && !fs.existsSync(temoin); i += 1) await attendre(100);
      assert.deepEqual(JSON.parse(fs.readFileSync(temoin, "utf8")), attendu, nom);
    });
  }
});

test("point d'entrée : git réel — branche et issue lues du dépôt du cwd", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    const depot = path.join(d, "depot");
    fs.mkdirSync(depot);
    git(depot, "init", "--quiet", "--initial-branch=claude/x");
    git(depot, "config", "branch.claude/x.issue", "1998");
    const sansMeta = evtCreation({ cwd: depot, tool_input: { subject: "s", description: "d" } });
    const { stdout } = await executer(process.execPath, [hook], {
      stdin: JSON.stringify(sansMeta),
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d },
    });
    assert.equal(stdout, "");
    const inst = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "claude-x.json"), "utf8")));
    assert.deepEqual([inst.branche, inst.issue], ["claude/x", 1998]);
  });
});

test("point d'entrée : entrée illisible → code 0, additionalContext, journal écrit, jamais de décision", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    const { stdout, stderr } = await executer(process.execPath, [hook], {
      stdin: "pas du json",
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d },
    });
    const sortie = JSON.parse(stdout);
    assert.match(sortie.hookSpecificOutput.additionalContext, /entrée de hook illisible/);
    assert.doesNotMatch(stdout, /"decision"/);
    assert.match(stderr, /\[etat-job\] entrée de hook illisible/);
    const lignes = fs.readFileSync(path.join(d, ".claude", "logs", "etat-job.jsonl"), "utf8").trim().split("\n");
    assert.equal(lignes.length, 1);
    assert.match(JSON.parse(lignes[0]).message, /entrée de hook illisible/);
  });
});

test("point d'entrée : git introuvable → erreur interne signalée, pas un faux « hors dépôt »", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    const sansMeta = evtCreation({ cwd: d, tool_input: { subject: "s", description: "d" } });
    const { stdout, stderr } = await executer(process.execPath, [hook], {
      stdin: JSON.stringify(sansMeta),
      env: { PATH: "", CLAUDE_PROJECT_DIR: d },
    });
    const texte = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert.match(texte, /erreur interne : .*git/);
    assert.doesNotMatch(texte, /HEAD détachée ou hors dépôt/);
    assert.match(stderr, /\[etat-job\] erreur interne : .*git/);
  });
});

// Prépare un dépôt jetable. Synchrone et sans tube sur stdin : git n'y lit rien, et
// un tube refermé par un git rapide lève EPIPE sous charge (cas de executer).
function git(depot, ...args) {
  execFileSync("git", ["-C", depot, ...args], { stdio: "ignore" });
}

// Lance le hook sur une création sans métadonnées, donc résolue par git dans cwd.
async function lancerSansMeta(d, hook, cwd) {
  // GIT_CEILING_DIRECTORIES : git ne remonte pas au-delà du dossier jetable.
  const env = { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d, GIT_CEILING_DIRECTORIES: path.dirname(d) };
  const sansMeta = evtCreation({ cwd, tool_input: { subject: "s", description: "d" } });
  const { stdout } = await executer(process.execPath, [hook], { stdin: JSON.stringify(sansMeta), env });
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

test("point d'entrée : git sans stderr (clé absente, HEAD détachée) → cause générique conservée", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    const depot = path.join(d, "depot");
    fs.mkdirSync(depot);
    git(depot, "init", "--quiet", "--initial-branch=claude/y");
    // Clé branch.claude/y.issue absente : git sort en 1, sans stderr.
    assert.match(await lancerSansMeta(d, hook, depot), /aucune issue liée à claude\/y/);
    const commit = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "x"];
    git(depot, ...commit);
    git(depot, "checkout", "--quiet", "--detach");
    // HEAD détachée : branch --show-current sort en 0, sans rien afficher.
    assert.match(await lancerSansMeta(d, hook, depot), /aucune branche pour .* \(HEAD détachée ou hors dépôt\)/);
  });
});

test("point d'entrée : git qui refuse avec un message → stderr relayé à l'agent et journalisé (m4)", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    const depot = path.join(d, "depot");
    fs.mkdirSync(depot);
    git(depot, "init", "--quiet", "--initial-branch=claude/y");
    fs.appendFileSync(path.join(depot, ".git", "config"), "ligne invalide sans section\n");
    const horsDepot = await lancerSansMeta(d, hook, d);
    assert.match(horsDepot, /git a refusé « branch --show-current » : fatal: not a git repository/);
    assert.doesNotMatch(horsDepot, /HEAD détachée ou hors dépôt/);
    const texte = await lancerSansMeta(d, hook, depot);
    assert.match(texte, /git a refusé « branch --show-current » : .*bad config line/);
    assert.doesNotMatch(texte, /HEAD détachée ou hors dépôt/);
    const lignes = fs.readFileSync(path.join(d, ".claude", "logs", "etat-job.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lignes.at(-1).code, "git-refuse");
    assert.equal(texte, `etat-job : ${lignes.at(-1).message}`);
  });
});

test("point d'entrée : stderr de git tronqué à 300 caractères", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d);
    // git -C <dossier absent> écrit le chemin entier dans son message d'erreur.
    const absent = path.join(d, ...["a", "b", "c", "e"].map((c) => c.repeat(100)));
    const texte = await lancerSansMeta(d, hook, absent);
    const cause = texte.slice(texte.indexOf("fatal:"));
    assert.equal(cause.length, 301, texte);
    assert.ok(cause.endsWith("…"));
  });
});

test("ordre MCP : consignes anti-doublon, et corps à publier tel quel avec le marqueur en tête", async () => {
  await avecDossier(async (d) => {
    const { args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ aaaaaaaa: { statut: 401 } }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    const texte = sortie.hookSpecificOutput.additionalContext;
    assert.match(texte, /labels existants plus `en-cours`/);
    assert.match(texte, /mets à jour le plus ancien/);
    assert.match(texte, /n'en crée jamais un second/);
    assert.match(texte, /ou crée-en un s'il n'y en a aucun/);
    // Sans cette clause, l'agent écraserait le plus ancien commentaire de l'issue, quel qu'il soit.
    assert.ok(texte.includes("dont le corps commence par `<!-- etat-job branche=feat/1998-tableau -->`"));
    const instantane = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")));
    const corps = corpsCommentaire(instantane);
    assert.ok(corps.startsWith("<!-- etat-job branche=feat/1998-tableau -->\n"));
    assert.ok(texte.endsWith(corps), "le corps à publier n'est pas rendu tel quel en fin d'ordre");
  });
});

// issue_write remplace toute la liste des labels : `en-cours` écrit seul effacerait les autres,
// ready-for-human compris (ADR-0135, décision 6).
test("ordre MCP : labels de l'issue lus d'abord, puis réécrits en entier avec `en-cours`, jamais seul (B2)", async () => {
  await avecDossier(async (d) => {
    const texte = ordreMcp(instantaneAvecSujet(1), d);
    assert.match(texte, /lis d'abord les labels actuels de l'issue par l'outil MCP de lecture d'issue/);
    assert.match(texte, /si `en-cours` manque, écris avec `issue_write` la liste complète : labels existants plus `en-cours`, jamais `en-cours` seul/);
  });
});

// Aucun outil MCP ne supprime un commentaire d'issue : l'ordre ne demande aucune suppression
// (« supprimés » décrit le publieur local, ce n'est pas une consigne à l'agent).
test("ordre MCP : met à jour le plus ancien commentaire marqué, n'en crée jamais un second, ne demande aucune suppression (M1)", async () => {
  await avecDossier(async (d) => {
    const texte = ordreMcp(instantaneAvecSujet(1), d);
    assert.doesNotMatch(texte, /supprime/);
    assert.match(texte, /mets à jour le plus ancien avec le corps à publier ci-dessous \(`update_issue_comment`\), ou crée-en un s'il n'y en a aucun/);
    assert.match(texte, /n'en crée jamais un second/);
    assert.match(texte, /les doublons éventuels seront supprimés par le publieur local au passage suivant/);
  });
});

test("point d'entrée : publieur absent → « publieur introuvable » dans additionalContext, code 0", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d, null);
    const { stdout, stderr } = await executer(process.execPath, [hook], {
      stdin: JSON.stringify(evtCreation({ cwd: d })),
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d },
    });
    assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /publieur introuvable/);
    assert.doesNotMatch(stdout, /"decision"/);
    assert.match(stderr, /\[etat-job\] erreur interne : publieur introuvable/);
  });
});

test("ordre MCP : le corps est publié tel quel, sans fusion avec les tâches d'autres sessions (m3)", async () => {
  await avecDossier(async (d) => {
    const { args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ aaaaaaaa: { statut: 401 } }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    const texte = sortie.hookSpecificOutput.additionalContext;
    assert.doesNotMatch(texte, /en gardant/);
    assert.doesNotMatch(texte, /d'autres sessions/);
    assert.match(texte, /Corps à publier, tel quel :/);
  });
});

function instantaneAvecSujet(longueur) {
  const creation = evtCreation({
    tool_input: { subject: "x".repeat(longueur), description: "d", metadata: { branche: CIBLE.branche, issue: CIBLE.issue } },
  });
  return appliquerEvenement({ instantane: null, evenement: normaliserEvenement(creation), cible: CIBLE, environnement: "local:P", maintenant });
}

test("ordre MCP : à 9 000 caractères le corps reste dans l'ordre, à 9 001 il passe par un fichier (I4)", async () => {
  await avecDossier(async (d) => {
    const ordre = path.join(d, ".claude", "logs", "etat-job", "feat-1998-tableau.ordre.md");
    // La longueur de l'ordre en ligne croît d'un caractère par caractère de sujet.
    const pile = 9000 - ordreMcp(instantaneAvecSujet(1), d).length + 1;
    const dedans = instantaneAvecSujet(pile);
    const enLigne = ordreMcp(dedans, d);
    assert.equal(enLigne.length, 9000);
    assert.ok(enLigne.endsWith(corpsCommentaire(dedans)));
    assert.equal(fs.existsSync(ordre), false, "fichier d'ordre écrit sous le seuil");

    const dehors = instantaneAvecSujet(pile + 1);
    const parFichier = ordreMcp(dehors, d);
    assert.ok(parFichier.length < 9000, `longueur ${String(parFichier.length)}`);
    assert.ok(!parFichier.includes(corpsCommentaire(dehors)), "le corps est resté dans l'ordre");
    assert.ok(parFichier.includes(ordre), "le chemin du fichier manque");
    assert.match(parFichier, /outil Read/);
    assert.match(parFichier, /publie son contenu tel quel/);
    assert.equal(fs.readFileSync(ordre, "utf8"), corpsCommentaire(dehors));
    assert.deepEqual(fs.readdirSync(path.dirname(ordre)), ["feat-1998-tableau.ordre.md"], "reste d'écriture provisoire");
  });
});

test("traiter : session marquée 401 et instantané long → ordre court, fichier relu par lireCorpsCommentaire", async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d);
    const long = evtCreation({
      tool_input: { subject: "y".repeat(9500), description: "d", metadata: { branche: CIBLE.branche, issue: CIBLE.issue } },
    });
    await traiter({ brut: JSON.stringify(long), ...args });
    fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ aaaaaaaa: { statut: 401 } }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    const texte = sortie.hookSpecificOutput.additionalContext;
    assert.ok(texte.length < 1500, `longueur ${String(texte.length)}`);
    assert.ok(texte.includes(fichier(d, "feat-1998-tableau.ordre.md")));
    const relu = lireCorpsCommentaire(fs.readFileSync(fichier(d, "feat-1998-tableau.ordre.md"), "utf8"), "feat/1998-tableau");
    assert.equal(relu.taches[0].statut, "in_progress");
    assert.equal(relu.seq, 2);
    assert.equal(texte, `etat-job : ${journal.at(-1).message}`);
  });
});

test("lancerDetache : spawn en échec → erreur synchrone nommée, cause journalisée (I3)", async () => {
  await avecDossier(async (d) => {
    const journal = [];
    assert.throws(
      () =>
        lancerDetache({
          script: path.join(d, "publier.mjs"),
          args: ["feat/1998-tableau", "aaaaaaaa"],
          cwd: path.join(d, "absent"),
          env: process.env,
          fichierErreurs: path.join(d, "erreurs.log"),
          maintenant,
          journaliser: (l) => {
            journal.push(l);
          },
        }),
      { code: "publieur-non-lance" },
    );
    // La cause (ENOENT) n'arrive qu'au tick suivant, par l'événement error du processus.
    await attendre(200);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].evenement, "publieur-non-lance");
    assert.match(journal[0].raison, /ENOENT/);
  });
});

test("point d'entrée : un publieur qui plante au chargement laisse sa trace dans etat-job-publieur.log (m5)", async () => {
  await avecDossier(async (d) => {
    const hook = installerHook(d, 'throw new Error("plantage du publieur de test");\n');
    const { stdout } = await executer(process.execPath, [hook], {
      stdin: JSON.stringify(evtCreation({ cwd: d })),
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: d },
    });
    assert.equal(stdout, "");
    const traces = path.join(d, ".claude", "logs", "etat-job-publieur.log");
    const limite = Date.now() + 5000;
    let contenu = "";
    while (Date.now() < limite && !contenu.includes("plantage du publieur de test")) {
      await attendre(50);
      contenu = fs.existsSync(traces) ? fs.readFileSync(traces, "utf8") : "";
    }
    assert.match(contenu, /plantage du publieur de test/);
  });
});

// Le publieur remplace auth.json et publication.json par rename, sous leur
// verrou ; sous Windows, ce rename peut échouer si le hook a le fichier ouvert.
// Chaque test tient le verrou de l'écrivain et n'écrit l'état final qu'en fin
// de prise : une lecture hors verrou voit l'état d'avant.
const SANS_JOURNAL = { maintenant, journaliser: () => undefined };
const DELAI_TEST = { timeout: 20000 };

test("traiter : auth.json lu sous le verrou d'auth, sous lequel le publieur l'écrit", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const { lances, args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    let reponse = null;
    await avecVerrou(
      fichier(d, "auth.lock"),
      async () => {
        reponse = traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
        await attendre(300);
        fs.writeFileSync(fichier(d, "auth.json"), JSON.stringify({ aaaaaaaa: { statut: 401, date: "x", branche: "feat/1998-tableau" } }));
      },
      SANS_JOURNAL,
    );
    const { sortie } = await reponse;
    assert.equal(lances.length, 1);
    assert.match(sortie.hookSpecificOutput.additionalContext, /outil MCP GitHub/);
  });
});

test("traiter : publication.json lu sous le verrou de la branche, sous lequel le publieur l'écrit", DELAI_TEST, async () => {
  await avecDossier(async (d) => {
    const publication = fichier(d, "feat-1998-tableau.publication.json");
    let publieur = null;
    const { args } = deps(d, {
      lancerPublieur: () => {
        publieur = avecVerrou(
          cheminsBranche(d, "feat/1998-tableau").verrou,
          async () => {
            await attendre(300);
            fs.writeFileSync(publication, JSON.stringify({ seq: 2, ok: true, raison: null, date: "x" }));
          },
          SANS_JOURNAL,
        );
      },
    });
    fs.mkdirSync(path.dirname(publication), { recursive: true });
    fs.writeFileSync(publication, JSON.stringify({ seq: 1, ok: false, raison: "HTTP 502", date: "x" }));
    const { sortie } = await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    await publieur;
    assert.equal(sortie, null);
  });
});

// Un auth.lock orphelin (publieur tué pendant marquer401) se périme en 5 s. Le
// hook qui l'attend ne doit tenir aucun verrou de branche pendant ce temps :
// sinon un second hook de la même branche le juge périmé et le casse alors que
// le premier est encore dans sa section critique. Horloge réelle : la
// péremption compare l'horloge injectée à la date du fichier.
test("traiter : auth.lock orphelin → aucun verrou de branche cassé, les deux mises à jour appliquées", { timeout: 30000 }, async () => {
  await avecDossier(async (d) => {
    const { journal, args } = deps(d, { maintenant: () => new Date() });
    const sessionB = { session_id: "bbbbbbbb-2222" };
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    await traiter({ brut: JSON.stringify(evtCreation(sessionB)), ...args });
    fs.writeFileSync(fichier(d, "auth.lock"), "999999 orphelin\n");
    const h1 = traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    await attendre(100);
    const h2 = traiter({ brut: JSON.stringify(evtMaj("3", "completed", sessionB)), ...args });
    for (const { sortie } of await Promise.all([h1, h2])) assert.equal(sortie, null);
    const verrousBranche = journal.filter((l) => l.verrou === "feat-1998-tableau.lock").map((l) => l.evenement);
    assert.deepEqual(verrousBranche, []);
    const inst = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")));
    assert.deepEqual(inst.taches.map((t) => `${t.session}:${t.statut}`).sort(), ["aaaaaaaa:in_progress", "bbbbbbbb:completed"]);
  });
});

test("traiter : auth.json illisible → l'instantané est écrit, puis l'erreur atteint l'agent", async () => {
  await avecDossier(async (d) => {
    const { lances, args } = deps(d);
    await traiter({ brut: JSON.stringify(evtCreation()), ...args });
    fs.writeFileSync(fichier(d, "auth.json"), "[]");
    const { sortie } = await traiter({ brut: JSON.stringify(evtMaj("3", "in_progress")), ...args });
    assert.match(sortie.hookSpecificOutput.additionalContext, /fichier illisible : .*auth\.json/);
    const inst = validerInstantane(JSON.parse(fs.readFileSync(fichier(d, "feat-1998-tableau.json"), "utf8")));
    assert.equal(inst.taches[0].statut, "in_progress");
    assert.equal(lances.length, 1);
  });
});

test("hooks.json déclare etat-job en PostToolUse TaskCreate|TaskUpdate, timeout 10 s", () => {
  const reglages = JSON.parse(fs.readFileSync(path.join(ICI, "hooks.json"), "utf8"));
  const entrees = reglages.hooks.PostToolUse.filter((e) => e.hooks.some((h) => h.command.includes("etat-job.mjs")));
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].matcher, "TaskCreate|TaskUpdate");
  assert.deepEqual(entrees[0].hooks, [
    { type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/etat-job.mjs"', timeout: 10 },
  ]);
});
