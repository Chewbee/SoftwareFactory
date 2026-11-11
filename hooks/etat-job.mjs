// Hook Claude Code (PostToolUse TaskCreate|TaskUpdate, ADR-0191) : tient
// l'instantané local des tâches du plan et lance le publieur détaché.
// N'appelle jamais le réseau ; ne bloque jamais l'outil (code 0, jamais de
// champ decision).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErreurEtatJob, envPublieur, lancerDetache, traiter } from "./etat-job-core.mjs";

const RACINE = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const PUBLIEUR = path.join(path.dirname(fileURLToPath(import.meta.url)), "etat-job-publier.mjs");
const LONGUEUR_STDERR_GIT = 300;

function journaliser(ligne) {
  const chemin = path.join(RACINE, ".claude", "logs", "etat-job.jsonl");
  try {
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.appendFileSync(chemin, `${JSON.stringify(ligne)}\n`);
  } catch (err) {
    console.error(`[etat-job] journal non écrit : ${err instanceof Error ? err.message : String(err)}`);
  }
}

// git local seulement. Un refus de git (code de sortie non nul) sans rien sur
// stderr (clé absente) rend null, que resoudreCible transforme en erreur nommée
// pour l'agent. Avec un message sur stderr (config invalide, propriétaire
// douteux), il remonte tronqué, plutôt que de passer pour un « hors dépôt ».
// Git absent ou délai dépassé n'a pas de code de sortie : l'erreur remonte telle quelle.
function gitLocal(args, cwd) {
  try {
    const sortie = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    return sortie === "" ? null : sortie;
  } catch (err) {
    if (!(err instanceof Error) || !("status" in err) || typeof err.status !== "number") throw err;
    const stderr = "stderr" in err && typeof err.stderr === "string" ? err.stderr.replace(/\s+/g, " ").trim() : "";
    if (stderr === "") return null;
    const court = stderr.length > LONGUEUR_STDERR_GIT ? `${stderr.slice(0, LONGUEUR_STDERR_GIT)}…` : stderr;
    throw new ErreurEtatJob("git-refuse", `état non publié : git a refusé « ${args.join(" ")} » : ${court}`);
  }
}

const git = {
  brancheCourante: (cwd) => gitLocal(["branch", "--show-current"], cwd),
  issueConfiguree: (cwd, branche) => gitLocal(["config", "--get", `branch.${branche}.issue`], cwd),
};

function lancerPublieur(branche, session) {
  if (!fs.existsSync(PUBLIEUR)) throw new Error(`publieur introuvable : ${PUBLIEUR}`);
  lancerDetache({
    script: PUBLIEUR,
    args: [branche, session],
    cwd: RACINE,
    env: envPublieur(process.env),
    fichierErreurs: path.join(RACINE, ".claude", "logs", "etat-job-publieur.log"),
    journaliser,
    maintenant: () => new Date(),
  });
}

let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (morceau) => {
  brut += morceau;
});
process.stdin.on("end", () => {
  traiter({ brut, racine: RACINE, env: process.env, git, lancerPublieur, maintenant: () => new Date(), journaliser })
    .then(({ sortie, diagnostic }) => {
      if (diagnostic !== null) console.error(`[etat-job] ${diagnostic}`);
      if (sortie !== null) process.stdout.write(JSON.stringify(sortie));
    })
    .catch((err) => {
      console.error(`[etat-job] erreur interne : ${err instanceof Error ? err.message : String(err)}`);
    });
});
