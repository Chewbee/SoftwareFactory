import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deciderVerdict, lireVerdict, traiterVerdict } from "./jev-verdict-core.mjs";
import { faireBilan } from "./jev-cli.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const maintenant = () => new Date("2026-11-08T10:00:00Z");

// Entrées brutes de la sonde de #2551 (commentaire <!-- sonde-verdicts -->) ;
// seul le champ du rapport est vidé, avecRapport le réécrit.
const REMISE = {
  session_id: "4c9e3ab4-194c-4643-bf12-fc5627d17fd6",
  transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6.jsonl",
  cwd: "/home/user/Adonnante/.claude/worktrees/sonde-verdicts",
  scratchpad_dir:
    "/tmp/claude-0/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6/scratchpad",
  prompt_id: "81f483d5-2237-4746-b420-44645e4c8884",
  permission_mode: "auto",
  agent_id: "a6e612149ee0d4448",
  agent_type: "softwarefactory:relecteur",
  effort: { level: "medium" },
  hook_event_name: "PostToolUse",
  tool_name: "SubagentHandback",
  tool_input: { message: "" },
  tool_response: { success: true, message: "Report delivered to your caller." },
  tool_use_id: "toolu_01GLs8E5rK4UGeqepaJYRb9C",
  duration_ms: 69,
};
const ARRET = {
  session_id: "39ff9878-9c1e-4ae1-baa2-907bcf51c19b",
  transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/39ff9878-9c1e-4ae1-baa2-907bcf51c19b.jsonl",
  cwd: "/home/user/Adonnante/.claude/worktrees/sonde-verdicts",
  scratchpad_dir:
    "/tmp/claude-0/-home-user-Adonnante--claude-worktrees-sonde-verdicts/39ff9878-9c1e-4ae1-baa2-907bcf51c19b/scratchpad",
  prompt_id: "bd8e0224-caba-46e3-954e-d899327ebc6b",
  permission_mode: "acceptEdits",
  agent_id: "afa1e86dd7721a2e8",
  agent_type: "softwarefactory:relecteur",
  effort: { level: "medium" },
  hook_event_name: "SubagentStop",
  stop_hook_active: false,
  agent_transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/39ff9878-9c1e-4ae1-baa2-907bcf51c19b/subagents/agent-afa1e86dd7721a2e8.jsonl",
  last_assistant_message: "",
  background_tasks: [],
  session_crons: [],
};
const LANCEMENT_ARRIERE_PLAN = {
  session_id: "4c9e3ab4-194c-4643-bf12-fc5627d17fd6",
  transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6.jsonl",
  cwd: "/home/user/Adonnante/.claude/worktrees/sonde-verdicts",
  scratchpad_dir:
    "/tmp/claude-0/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6/scratchpad",
  prompt_id: "81f483d5-2237-4746-b420-44645e4c8884",
  permission_mode: "auto",
  effort: { level: "medium" },
  hook_event_name: "PostToolUse",
  tool_name: "Agent",
  tool_input: {
    description: "Sonde relecteur arrière-plan",
    prompt:
      "Sonde #2551, lecture seule, aucune commande ni skill. Diff à relire :\n-export const somme = (a, b) => a - b;\n+export const somme = (a, b) => a + b;\nRends un rapport de trois lignes au plus ; la dernière ligne est VERDICT : PRÊT ou VERDICT : PAS PRÊT.",
    subagent_type: "softwarefactory:relecteur",
    run_in_background: true,
  },
  tool_response: {
    isAsync: true,
    status: "async_launched",
    agentId: "ac2c2134cd3720ce8",
    description: "Sonde relecteur arrière-plan",
    resolvedModel: "claude-opus-5-5",
    prompt:
      "Sonde #2551, lecture seule, aucune commande ni skill. Diff à relire :\n-export const somme = (a, b) => a - b;\n+export const somme = (a, b) => a + b;\nRends un rapport de trois lignes au plus ; la dernière ligne est VERDICT : PRÊT ou VERDICT : PAS PRÊT.",
    outputFile:
      "/tmp/claude-0/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6/tasks/ac2c2134cd3720ce8.output",
    canReadOutputFile: true,
    canContinueAgent: true,
  },
  tool_use_id: "toolu_01Mb13cCQUYi2mWnj8bB2Psc",
  duration_ms: 7,
};

// Événement retenu par la sonde pour la remise : PostToolUse (PreToolUse porte le même message).
const EVENEMENT_REMISE = "PostToolUse";

function avecRapport(fixture, rapport) {
  if (fixture.hook_event_name === "SubagentStop") return { ...fixture, last_assistant_message: rapport };
  return { ...fixture, tool_input: { ...fixture.tool_input, message: rapport } };
}

const PIED = "\n\nhttps://claude.ai/code/session_01ABC";

for (const [nom, fixture, source] of [
  ["remise", { ...REMISE, hook_event_name: EVENEMENT_REMISE }, "handback"],
  ["arrêt", ARRET, "stop"],
]) {
  test(`${nom} : PAS PRÊT, PRÊT suivi d'un pied, absent`, () => {
    for (const [rapport, verdict] of [
      ["Finding bloquant : la somme soustrait.\nVERDICT : PAS PRÊT", "PAS PRÊT"],
      [`Aucun finding bloquant.\nVERDICT : PRÊT${PIED}`, "PRÊT"],
      ["Rapport sans verdict.", "absent"],
    ]) {
      assert.deepEqual(deciderVerdict({ entree: avecRapport(fixture, rapport), maintenant }), {
        date: "2026-11-08T10:00:00.000Z",
        session_id: fixture.session_id,
        agent_id: fixture.agent_id,
        agent: "softwarefactory:relecteur",
        source,
        verdict,
      });
    }
  });
}

test("softwarefactory:relecteur-basic : journalisé", () => {
  const e = { ...avecRapport(ARRET, "VERDICT : PRÊT"), agent_type: "softwarefactory:relecteur-basic" };
  assert.equal(deciderVerdict({ entree: e, maintenant }).agent, "softwarefactory:relecteur-basic");
});

test("lireVerdict : espaces insécables, Ê décomposé, dernière ligne VERDICT, valeur inconnue", () => {
  assert.equal(lireVerdict("VERDICT : PAS PRÊT"), "PAS PRÊT");
  assert.equal(lireVerdict("VERDICT : PRÊT"), "PRÊT");
  assert.equal(lireVerdict("VERDICT\u202f: PAS\u202fPRÊT"), "PAS PRÊT");
  assert.equal(lireVerdict("VERDICT\u202f: PRÊT"), "PRÊT");
  assert.equal(lireVerdict("VERDICT : PAS PRÊT\nCorrigé.\nVERDICT : PRÊT"), "PRÊT");
  assert.equal(lireVerdict("VERDICT : PRÊT avec réserves"), "absent");
  assert.equal(lireVerdict("**VERDICT : PRÊT**"), "absent");
  assert.equal(lireVerdict(undefined), "absent");
});

test("remise sans tool_input objet : absent", () => {
  const e = { ...REMISE, tool_input: "texte" };
  assert.equal(deciderVerdict({ entree: e, maintenant }).verdict, "absent");
});

test("lancement en arrière-plan (PostToolUse Agent, async_launched) : aucune ligne", () => {
  assert.equal(deciderVerdict({ entree: LANCEMENT_ARRIERE_PLAN, maintenant }), null);
  assert.equal(deciderVerdict({ entree: { ...LANCEMENT_ARRIERE_PLAN, agent_type: "softwarefactory:relecteur" }, maintenant }), null);
});

test("agent autre qu'un relecteur : aucune ligne, même avec un verdict", () => {
  for (const typeAgent of ["softwarefactory:implementeur", "softwarefactory:analyste", "", undefined]) {
    for (const fixture of [REMISE, ARRET]) {
      const e = { ...avecRapport(fixture, "VERDICT : PRÊT"), agent_type: typeAgent };
      assert.equal(deciderVerdict({ entree: e, maintenant }), null);
    }
  }
});

test("traiterVerdict : entrée illisible → systemMessage et ligne verdict-entree-illisible", () => {
  const r = traiterVerdict({ brut: "pas du json", maintenant });
  assert.deepEqual(r.sortie, { systemMessage: "Jev : verdict non journalisé (entree-illisible)" });
  assert.deepEqual(r.journal, { date: "2026-11-08T10:00:00.000Z", raison: "verdict-entree-illisible" });
  assert.match(r.diagnostic, /entrée illisible/);
});

// Ligne 3 de la sonde (.superpowers/sdd/2026-11-08-jev-systematique/sonde-verdicts-brut.jsonl,
// dossier non versionné, d'où la copie) : arrêt du relecteur de REMISE en mode auto,
// sans last_assistant_message.
const ARRET_AUTO = {
  session_id: "4c9e3ab4-194c-4643-bf12-fc5627d17fd6",
  transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6.jsonl",
  cwd: "/home/user/Adonnante/.claude/worktrees/sonde-verdicts",
  scratchpad_dir:
    "/tmp/claude-0/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6/scratchpad",
  prompt_id: "81f483d5-2237-4746-b420-44645e4c8884",
  permission_mode: "auto",
  agent_id: "a6e612149ee0d4448",
  agent_type: "softwarefactory:relecteur",
  effort: { level: "medium" },
  hook_event_name: "SubagentStop",
  stop_hook_active: false,
  agent_transcript_path:
    "/root/.claude/projects/-home-user-Adonnante--claude-worktrees-sonde-verdicts/4c9e3ab4-194c-4643-bf12-fc5627d17fd6/subagents/agent-a6e612149ee0d4448.jsonl",
  background_tasks: [],
  session_crons: [],
};

test("sonde ligne 3 (arrêt en mode auto, sans last_assistant_message) : ligne absent figée", () => {
  const r = traiterVerdict({ brut: JSON.stringify(ARRET_AUTO), maintenant });
  assert.equal(r.sortie, null);
  assert.deepEqual(r.journal, {
    date: "2026-11-08T10:00:00.000Z",
    session_id: "4c9e3ab4-194c-4643-bf12-fc5627d17fd6",
    agent_id: "a6e612149ee0d4448",
    agent: "softwarefactory:relecteur",
    source: "stop",
    verdict: "absent",
  });
});

test("sonde : la remise PAS PRÊT puis l'arrêt absent de la ligne 3 donnent 1 PAS PRÊT, 0 absent au bilan", () => {
  const dispatch = JSON.stringify({
    date: "2026-11-08T09:00:00.000Z",
    session_id: ARRET_AUTO.session_id,
    agent: "softwarefactory:implementeur",
    defaut: "sonnet",
    retenu: "sonnet",
    raison: "model-explicite",
  });
  const remise = deciderVerdict({ entree: avecRapport(REMISE, "Finding bloquant.\nVERDICT : PAS PRÊT"), maintenant });
  const arret = traiterVerdict({ brut: JSON.stringify(ARRET_AUTO), maintenant }).journal;
  const b = faireBilan([dispatch, JSON.stringify(remise), JSON.stringify(arret)].join("\n"));
  assert.deepEqual(b, {
    lignes: [{ agent: "softwarefactory:implementeur", modele: "sonnet", source: "explicite", pret: 0, pasPret: 1 }],
    nonAttribues: 0,
    absents: 0,
    illisibles: 0,
  });
});

const POINT_ENTREE = path.join(ICI, "jev-verdict.mjs");

function lancer(stdin, dossier) {
  return new Promise((resolu, rejete) => {
    const enfant = spawn(process.execPath, [POINT_ENTREE], {
      env: { PATH: process.env.PATH ?? "", CLAUDE_PROJECT_DIR: dossier },
      stdio: ["pipe", "pipe", "pipe"],
    });
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
      resolu({ code, stdout, stderr });
    });
    enfant.stdin.end(stdin);
  });
}

async function avecDossier(corps) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "jev-verdict-"));
  try {
    return await corps(dossier);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

for (const [nom, fixture, source] of [
  ["arrêt", ARRET, "stop"],
  ["remise", REMISE, "handback"],
]) {
  test(`point d'entrée : ${nom} d'un relecteur → une ligne au journal, stdout vide, code 0`, async () => {
    await avecDossier(async (dossier) => {
      const { code, stdout } = await lancer(JSON.stringify(avecRapport(fixture, "VERDICT : PAS PRÊT")), dossier);
      assert.equal(code, 0);
      assert.equal(stdout, "");
      const lignes = fs.readFileSync(path.join(dossier, ".claude", "logs", "jev-model.jsonl"), "utf8").trim().split("\n");
      assert.equal(lignes.length, 1);
      const ligne = JSON.parse(lignes[0]);
      assert.equal(ligne.verdict, "PAS PRÊT");
      assert.equal(ligne.source, source);
      assert.ok(!lignes[0].includes("Finding"));
    });
  });
}

test("point d'entrée : journal non écrivable → systemMessage et stderr, code 0", async () => {
  await avecDossier(async (dossier) => {
    fs.writeFileSync(path.join(dossier, ".claude"), "un fichier, pas un dossier");
    const { code, stdout, stderr } = await lancer(JSON.stringify(avecRapport(ARRET, "VERDICT : PRÊT")), dossier);
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).systemMessage, "Jev : verdict non journalisé (journal-non-ecrit)");
    assert.match(stderr, /journal non écrit/);
  });
});

function commandes(evenement, matcher) {
  const reglages = JSON.parse(fs.readFileSync(path.join(ICI, "hooks.json"), "utf8"));
  const entrees = reglages.hooks[evenement] ?? [];
  return entrees.filter((e) => e.matcher === matcher).flatMap((e) => e.hooks.map((h) => h.command));
}

test("hooks.json : SubagentStop des relecteurs lance jev-verdict.mjs", () => {
  assert.ok(commandes("SubagentStop", "softwarefactory:relecteur|softwarefactory:relecteur-basic").some((c) => c.includes("hooks/jev-verdict.mjs")));
});

test(`hooks.json : ${EVENEMENT_REMISE} sur SubagentHandback lance jev-verdict.mjs`, () => {
  assert.ok(commandes(EVENEMENT_REMISE, "SubagentHandback").some((c) => c.includes("hooks/jev-verdict.mjs")));
});
