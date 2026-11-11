// Hook Claude Code (PreToolUse, matcher Bash|PowerShell) : refuse toute écriture
// `git stash` (ADR-0140). Code de sortie 2 = appel bloqué, stderr montré à l'agent.
import { evaluer } from "./git-stash-guard-core.mjs";

let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (morceau) => {
  brut += morceau;
});
process.stdin.on("end", () => {
  const { code, message } = evaluer(brut);
  if (code !== 0) console.error(message);
  process.exitCode = code;
});
