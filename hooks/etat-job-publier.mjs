// Publieur détaché (ADR-0191), lancé par etat-job.mjs :
// node etat-job-publier.mjs <branche> <session>. Seul processus d'etat-job
// qui parle à GitHub.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ErreurEtatJob } from "./etat-job-core.mjs";
import { creerClient, executerPublieur, rapporterJetonAbsent, validerArguments } from "./etat-job-publier-core.mjs";

const RACINE = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const LONGUEUR_STDERR_GH = 300;
// Même garde que scripts/tableau-de-bord.mjs : un jeton GitHub tient dans l'ASCII imprimable
// sans espace. Le reste est refusé sans être cité (undici recopie la valeur d'un en-tête
// invalide dans son message d'erreur, qui finirait dans publication.json).
const JETON_VALIDE = /^[\x21-\x7e]+$/;

function journaliser(ligne) {
  const chemin = path.join(RACINE, ".claude", "logs", "etat-job.jsonl");
  try {
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.appendFileSync(chemin, `${JSON.stringify(ligne)}\n`);
  } catch (err) {
    console.error(`[etat-job-publier] journal non écrit : ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Rend { jeton } ou { cause } : la cause d'un jeton absent, message de gh
// compris (tronqué comme celui de git dans etat-job.mjs), part dans
// publication.json, que le hook suivant rapporte à l'agent.
function lireJeton() {
  try {
    const jeton = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (jeton === "") return { jeton: null, cause: "gh auth token a rendu une chaîne vide" };
    if (!JETON_VALIDE.test(jeton)) {
      return { jeton: null, cause: "gh auth token a rendu un jeton invalide : seuls l'ASCII imprimable et l'absence d'espace sont admis (gh auth login)" };
    }
    return { jeton, cause: null };
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err && typeof err.stderr === "string" ? err.stderr.replace(/\s+/g, " ").trim() : "";
    if (stderr === "") return { jeton: null, cause: `gh auth token en échec : ${err instanceof Error ? err.message : String(err)}` };
    const court = stderr.length > LONGUEUR_STDERR_GH ? `${stderr.slice(0, LONGUEUR_STDERR_GH)}…` : stderr;
    return { jeton: null, cause: `gh auth token en échec : ${court}` };
  }
}

async function main() {
  const { branche, session } = validerArguments(process.argv.slice(2));
  const maintenant = () => new Date();
  const { jeton, cause } = lireJeton();
  if (jeton === null) {
    await rapporterJetonAbsent({ racine: RACINE, branche, cause, maintenant, journaliser });
    return;
  }
  await executerPublieur({ client: creerClient({ jeton, fetchFn: fetch }), racine: RACINE, branche, session, maintenant, journaliser });
}

main().catch((err) => {
  journaliser({
    date: new Date().toISOString(),
    evenement: "publieur-erreur",
    code: err instanceof ErreurEtatJob ? err.code : "erreur-interne",
    raison: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
