// Hook Claude Code (SessionStart, après plugin-a-jour) : écrit dans le
// projet consommateur le shim .claude/hooks/jev-cli.mjs qui délègue au
// jev-cli.mjs du plugin installé (SF-19). Ne bloque jamais la session :
// code de sortie 0 en cas de succès ; en cas d'impossibilité (plugin non
// installé, registre illisible), le message passe en systemMessage et sur
// stderr — jamais de repli silencieux.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ecrireShims } from "./ecrire-shims-core.mjs";

const CHEMIN_REGISTRE = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");

let sortie;
try {
  const registreJson = fs.readFileSync(CHEMIN_REGISTRE, "utf8");
  const { chemin, cible } = ecrireShims({
    env: process.env,
    registreJson,
    ecrire: (cibleFichier, contenu) => {
      fs.mkdirSync(path.dirname(cibleFichier), { recursive: true });
      fs.writeFileSync(cibleFichier, contenu);
    },
  });
  const texte = `ecrire-shims : shim jev-cli écrit (${chemin} → ${cible}) ; l'usage « node .claude/hooks/jev-cli.mjs niveau --role … » est inchangé.`;
  console.error(`[ecrire-shims] ${texte}`);
  sortie = { systemMessage: texte };
} catch (e) {
  const texte = `ecrire-shims : ${e instanceof Error ? e.message : String(e)} — le shim n'est pas (re)écrit, l'existant (s'il y en a un) reste en place.`;
  console.error(`[ecrire-shims] ${texte}`);
  sortie = { systemMessage: texte };
}
process.stdout.write(JSON.stringify(sortie));
