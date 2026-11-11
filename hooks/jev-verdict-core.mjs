// Logique pure du hook jev-verdict (ADR-0194, point 9) : lit le verdict d'un
// relecteur dans son rapport. Le rapport passe par la remise SubagentHandback
// (tool_input.message) ou par SubagentStop (last_assistant_message), jamais
// par le résultat de l'outil Agent (doc des hooks, sonde de #2551).
import { estObjet } from "./jev-model-core.mjs";

export const RELECTEURS = ["softwarefactory:relecteur", "softwarefactory:relecteur-basic"];
const OUTIL_REMISE = "SubagentHandback";

// Dernière ligne qui commence par « VERDICT : » (ADR-0135, point 3) ; un pied
// d'attribution peut la suivre. Toute autre valeur vaut absent.
export function lireVerdict(rapport) {
  if (typeof rapport !== "string") return "absent";
  const lignes = rapport.normalize("NFC").split(/\r?\n/);
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const m = /^VERDICT\s*:\s*(.*)$/.exec(lignes[i].trim());
    if (m === null) continue;
    const valeur = m[1].replace(/\s+/g, " ").trim();
    return valeur === "PRÊT" || valeur === "PAS PRÊT" ? valeur : "absent";
  }
  return "absent";
}

function lireRapport(entree) {
  if (entree.hook_event_name === "SubagentStop") {
    return { source: "stop", rapport: entree.last_assistant_message };
  }
  const evenementOutil = entree.hook_event_name === "PreToolUse" || entree.hook_event_name === "PostToolUse";
  if (evenementOutil && entree.tool_name === OUTIL_REMISE) {
    return { source: "handback", rapport: estObjet(entree.tool_input) ? entree.tool_input.message : undefined };
  }
  return null;
}

// Rend la ligne de journal, ou null quand l'événement ne porte pas de rapport de relecteur.
export function deciderVerdict({ entree, maintenant }) {
  if (!estObjet(entree) || !RELECTEURS.includes(entree.agent_type)) return null;
  const lu = lireRapport(entree);
  if (lu === null) return null;
  return {
    date: maintenant().toISOString(),
    session_id: typeof entree.session_id === "string" ? entree.session_id : null,
    agent_id: typeof entree.agent_id === "string" ? entree.agent_id : null,
    agent: entree.agent_type,
    source: lu.source,
    verdict: lireVerdict(lu.rapport),
  };
}

export function traiterVerdict({ brut, maintenant }) {
  let entree;
  try {
    entree = JSON.parse(brut);
  } catch {
    return {
      sortie: { systemMessage: "Jev : verdict non journalisé (entree-illisible)" },
      journal: { date: maintenant().toISOString(), raison: "verdict-entree-illisible" },
      diagnostic: "entrée illisible",
    };
  }
  return { sortie: null, journal: deciderVerdict({ entree, maintenant }), diagnostic: null };
}
