// Hook Claude Code (SubagentStop des relecteurs, et remise SubagentHandback
// selon la sonde de #2551) : journalise le verdict d'un relecteur (ADR-0194,
// point 9). Ne bloque jamais, n'ajoute rien au contexte.
import fs from "node:fs";
import path from "node:path";
import { traiterVerdict } from "./jev-verdict-core.mjs";

function journaliser(ligne) {
  const racine = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const dossier = path.join(racine, ".claude", "logs");
  try {
    fs.mkdirSync(dossier, { recursive: true });
    fs.appendFileSync(path.join(dossier, "jev-model.jsonl"), `${JSON.stringify(ligne)}\n`);
    return true;
  } catch (err) {
    console.error(`[jev-verdict] journal non écrit : ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (morceau) => {
  brut += morceau;
});
process.stdin.on("end", () => {
  try {
    const { sortie, journal, diagnostic } = traiterVerdict({ brut, maintenant: () => new Date() });
    if (diagnostic !== null) console.error(`[jev-verdict] ${diagnostic}`);
    const ecrit = journal === null || journaliser(journal);
    const message = ecrit ? sortie : { systemMessage: "Jev : verdict non journalisé (journal-non-ecrit)" };
    if (message !== null) process.stdout.write(JSON.stringify(message));
  } catch (err) {
    console.error(`[jev-verdict] erreur interne : ${err instanceof Error ? err.message : String(err)}`);
    process.stdout.write(JSON.stringify({ systemMessage: "Jev : verdict non journalisé (erreur-interne)" }));
  }
});
