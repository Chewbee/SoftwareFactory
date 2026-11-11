// Logique pure du hook git-stash-guard (ADR-0140) : la pile `refs/stash` est
// commune à tous les worktrees, un agent n'y écrit donc pas. Détection
// textuelle : une commande qui cite seulement « git stash » est refusée aussi
// (faux positif accepté par la décision du 2026-10-18).

// Une valeur d'option ne commence pas par « - » : sans cela, `--x --y` se lit de
// deux façons et l'expression explose en temps (n=25 options : ~5 s).
const VALEUR = `(?:"[^"]*"|'[^']*'|[^\\s'"-]\\S*)`;
const OPTIONS_GIT =
  `(?:\\s+(?:-[Cc]\\s+${VALEUR}|--(?:git-dir|work-tree|namespace)\\s+${VALEUR}|--[\\w-]+=\\S+|--[\\w-]+|-[pP]))*`;
// `git.exe` et le nom cité de l'opérateur d'appel PowerShell (`& "…\git.exe"`)
// valent `git`. La sous-commande reste sur la ligne de `stash` : après un retour
// à la ligne, bash lance `git stash` seul, donc un push.
const STASH = new RegExp(
  `\\bgit(?:\\.exe)?["']?${OPTIONS_GIT}\\s+stash(?![\\w-])(?:[ \\t]+([A-Za-z-]+))?`,
  "g",
);
const OUTILS_SHELL = new Set(["Bash", "PowerShell"]);
const LECTURES = new Set(["list", "show"]);

export const MESSAGE_REFUS =
  "git stash refusé (#1920, ADR-0140) : la pile de stash est commune à tous les worktrees, " +
  "un pop peut récupérer le travail d'une autre session. " +
  "Alternatives : un commit WIP dans votre propre worktree, " +
  "ou `git diff > patch` puis `git apply patch`. `git stash list` et `git stash show` restent permis.";

/** Vrai si la commande écrit dans la pile de stash (tout `git stash` sauf list et show). */
export function ecritDansLaPile(commande) {
  for (const m of commande.matchAll(STASH)) {
    if (!LECTURES.has(m[1] ?? "")) return true;
  }
  return false;
}

/** Décide d'un appel de hook : `{ code: 0 }` laisse passer, `{ code: 2, message }` refuse. */
export function evaluer(brut) {
  let entree;
  try {
    entree = JSON.parse(brut);
  } catch (err) {
    return {
      code: 2,
      message: `git-stash-guard : entrée JSON illisible (${err instanceof Error ? err.message : String(err)}), appel refusé`,
    };
  }
  if (entree === null || typeof entree !== "object" || !OUTILS_SHELL.has(entree.tool_name)) return { code: 0 };
  const commande = entree.tool_input?.command;
  if (typeof commande !== "string") {
    return { code: 2, message: "git-stash-guard : tool_input.command absent ou non textuel, appel refusé" };
  }
  return ecritDansLaPile(commande) ? { code: 2, message: MESSAGE_REFUS } : { code: 0 };
}
