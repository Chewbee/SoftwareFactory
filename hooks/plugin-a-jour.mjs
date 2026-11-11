// Hook Claude Code (SessionStart) : installe ou met à jour les plugins
// superpowers-extended-cc et cesiumjs-skills sur disque (#2268, ADR-0157, #2315). Ne bloque jamais la session :
// code de sortie 0. Succès comme échec : bilan sur stderr, plus un JSON sur stdout où le
// texte va à l'humain (systemMessage) et à Claude (additionalContext), sans quoi une
// session sans humain ne verrait rien.
import { creerExecuteur, DELAI_COMMANDE_MS, mettreAJour } from "./plugin-a-jour-core.mjs";

// La CLI qui héberge la session (CLAUDE_CODE_EXECPATH) si elle est connue, sinon « claude » du PATH :
// en cloud, `claude` n'est pas forcément dans le PATH d'un hook.
const execpath = process.env.CLAUDE_CODE_EXECPATH;
const binaire = execpath !== undefined && execpath !== "" ? execpath : "claude";

const { message } = mettreAJour({ executer: creerExecuteur(binaire, DELAI_COMMANDE_MS), binaire });
console.error(`[plugin-a-jour] ${message}`);
const texte = `plugin-a-jour : ${message}`;
const sortie = { systemMessage: texte, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texte } };
process.stdout.write(JSON.stringify(sortie));
