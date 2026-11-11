// Hook Claude Code (SessionStart) : signale un checkout principal en retard sur origin/dev (#2360).
// N'écrit jamais dans le checkout et ne bloque jamais la session : code de sortie 0. Succès comme
// échec : bilan sur stderr, plus un JSON sur stdout où le texte va à l'humain (systemMessage) et
// à Claude (additionalContext), sans quoi une session sans humain ne verrait rien.
import { creerExecuteur } from "./plugin-a-jour-core.mjs";
import { bilanCheckout, DELAI_COMMANDE_MS } from "./checkout-a-jour-core.mjs";

// Le git enfant hérite de process.env : un identifiant HTTPS demandé au terminal échoue franchement
// au lieu de bloquer jusqu'au délai.
process.env.GIT_TERMINAL_PROMPT = "0";

// Réglage réservé aux tests (le vrai délai est DELAI_COMMANDE_MS) : une valeur invalide est refusée,
// pas ignorée, et un délai dépassé sous ce réglage le nomme.
const VAR_DELAI = "CHECKOUT_A_JOUR_DELAI_MS";
const brut = process.env[VAR_DELAI];
const delai = brut === undefined ? DELAI_COMMANDE_MS : Number(brut);

function executerBorne() {
  const executer = creerExecuteur("git", delai);
  if (brut === undefined) return executer;
  return (args) => {
    const r = executer(args);
    return r.erreur === "ETIMEDOUT" ? { ...r, erreur: `ETIMEDOUT, délai ${VAR_DELAI}=${brut} ms` } : r;
  };
}

const message =
  Number.isInteger(delai) && delai > 0
    ? bilanCheckout({ executer: executerBorne() }).message
    : `contrôle du checkout impossible, ${VAR_DELAI} invalide : « ${String(brut)} »`;
console.error(`[checkout-a-jour] ${message}`);
const texte = `checkout-a-jour : ${message}`;
const sortie = { systemMessage: texte, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texte } };
process.stdout.write(JSON.stringify(sortie));
