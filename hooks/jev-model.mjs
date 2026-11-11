// Hook Claude Code (PreToolUse, matchers Agent et create_session) : journalise l'avis
// de Jev sur le brief à côté du model de l'appel et signale un model absent
// (ADR-0194). Ne réécrit ni ne bloque jamais l'appel.
import fs from "node:fs";
import path from "node:path";
import { traiter } from "./jev-model-core.mjs";

const LIGNE_NON_JOURNALISE = "Jev : dispatch non journalisé (journal-non-ecrit)";

function journaliser(ligne) {
  const racine = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const dossier = path.join(racine, ".claude", "logs");
  try {
    fs.mkdirSync(dossier, { recursive: true });
    fs.appendFileSync(path.join(dossier, "jev-model.jsonl"), `${JSON.stringify(ligne)}\n`);
    return true;
  } catch (err) {
    console.error(`[jev-model] journal non écrit : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (morceau) => {
  brut += morceau;
});
process.stdin.on("end", () => {
  traiter({ brut, env: process.env, fetchFn: fetch, maintenant: () => new Date() })
    .then(({ sortie, journal, diagnostic }) => {
      if (diagnostic !== null) console.error(`[jev-model] ${diagnostic} : appel inchangé`);
      const ecrit = journal === null || journaliser(journal);
      const message = ecrit ? sortie : { systemMessage: sortie === null ? LIGNE_NON_JOURNALISE : `${sortie.systemMessage}\n${LIGNE_NON_JOURNALISE}` };
      if (message !== null) process.stdout.write(JSON.stringify(message));
    })
    .catch((err) => {
      console.error(`[jev-model] erreur interne : ${err instanceof Error ? err.message : String(err)} ; appel inchangé`);
    });
});
