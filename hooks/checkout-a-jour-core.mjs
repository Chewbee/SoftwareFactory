// Logique du hook checkout-a-jour (#2360). Au démarrage d'une session, le hook compare le HEAD du
// checkout principal à origin/dev et SIGNALE un retard ; il n'écrit jamais dans le checkout (pas
// de merge, pas de pull) : avancer le checkout reste un geste de l'utilisateur. Un checkout en
// retard fait créer les worktrees sur une base périmée. Seule la branche `dev` est contrôlée
// (ADR-0157 : le checkout principal reste sur `dev` à jour) : sur une autre branche ou en HEAD
// détaché le hook le dit, sans jamais prescrire d'avancer cette branche vers origin/dev.
// `bilanCheckout` est pure : l'exécution de git lui est injectée, executer(args) rend
// { code, stdout, stderr, erreur } (code null quand git n'a pas rendu de code : introuvable, délai,
// signal). Elle ne lève pas : tout échec est un message, jamais un « à jour » par défaut.
// L'exécuteur réel est celui de plugin-a-jour-core.mjs (`creerExecuteur`), qui borne chaque commande.

const LONGUEUR_DETAIL = 300;
const SHA = /^[0-9a-f]{40}$/;

const GIT_DIRS = ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"];
// Noms complets partout : git résout un nom court par tags, puis heads, puis remotes, donc un tag ou
// une branche locale `origin/dev` masquerait refs/remotes/origin/dev, et un tag `dev` ferait rendre
// « heads/dev » à symbolic-ref --short. -q : HEAD détaché rend le code 1 sans rien écrire.
const BRANCHE = ["symbolic-ref", "-q", "HEAD"];
const REF_DEV = "refs/heads/dev";
const DISTANTE = "refs/remotes/origin/dev";
// Refspec explicite : « fetch origin dev » ne met à jour la référence distante que si
// remote.origin.fetch couvre dev, sinon le hook compare HEAD à un origin/dev périmé.
const FETCH = ["fetch", "--quiet", "origin", `+${REF_DEV}:${DISTANTE}`];
const REV_HEAD = ["rev-parse", "HEAD"];
const REV_DEV = ["rev-parse", DISTANTE];
// « avance<TAB>retard » : commits de HEAD absents d'origin/dev, puis l'inverse.
const COMPTES = ["rev-list", "--left-right", "--count", `HEAD...${DISTANTE}`];
const AVANCE_RETARD = /^(\d+)\s+(\d+)$/;

// Délai par commande git : multiplié par le nombre de commandes du chemin le plus long, il doit
// rester sous le `timeout` du hook dans hooks/hooks.json (test dans checkout-a-jour.test.mjs).
// Le fetch est la seule commande réseau.
export const DELAI_COMMANDE_MS = 15_000;

// Garde la fin : la cause d'un échec est en fin de sortie.
function condenser(texte) {
  const court = texte.replace(/\s+/g, " ").trim();
  return court.length > LONGUEUR_DETAIL ? `…${court.slice(-LONGUEUR_DETAIL)}` : court;
}

function echec(commande, { code, stdout, stderr, erreur }) {
  const detail = condenser(stderr.trim() !== "" ? stderr : stdout);
  const suite = detail === "" ? "" : ` : ${detail}`;
  const sortie =
    code === null
      ? `est restée sans code de sortie (${erreur ?? "cause inconnue"})`
      : `a rendu le code ${String(code)}`;
  return `contrôle du checkout impossible, « ${commande} » ${sortie}${suite}`;
}

function inattendu(commande, stdout) {
  return `contrôle du checkout impossible, sortie inattendue de « ${commande} » : « ${condenser(stdout)} »`;
}

const pluriel = (n) => `${String(n)} commit${n === 1 ? "" : "s"}`;
const court = (sha) => sha.slice(0, 8);

// Rend { ok, message } et ne lève pas. ok vaut vrai si le checkout est à jour, ou si la session
// n'est pas dans le checkout principal (un worktree n'a rien à contrôler ici).
export function bilanCheckout({ executer }) {
  const lancer = (args) => {
    const commande = `git ${args.join(" ")}`;
    return { commande, reponse: executer(args) };
  };

  const dirs = lancer(GIT_DIRS);
  if (dirs.reponse.code !== 0) return { ok: false, message: echec(dirs.commande, dirs.reponse) };
  const [gitDir, commonDir, ...reste] = dirs.reponse.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (gitDir === undefined || commonDir === undefined || reste.length > 0) {
    return { ok: false, message: inattendu(dirs.commande, dirs.reponse.stdout) };
  }
  if (gitDir !== commonDir) {
    return { ok: true, message: "session lancée dans un worktree, le checkout principal n'est pas contrôlé" };
  }

  const branche = lancer(BRANCHE);
  if (branche.reponse.code === 1 && branche.reponse.stdout.trim() === "") {
    return {
      ok: false,
      message: "checkout principal en HEAD détaché, pas sur dev : basculez-le sur dev, au niveau d'origin/dev, avant de créer un worktree (ADR-0157), le hook n'écrit rien lui-même",
    };
  }
  if (branche.reponse.code !== 0) return { ok: false, message: echec(branche.commande, branche.reponse) };
  const ref = branche.reponse.stdout.trim();
  if (ref === "") return { ok: false, message: inattendu(branche.commande, branche.reponse.stdout) };
  if (ref !== REF_DEV) {
    const nom = ref.replace(/^refs\/heads\//, "");
    return {
      ok: false,
      message: `checkout principal sur « ${nom} », pas sur dev : basculez-le sur dev, au niveau d'origin/dev, avant de créer un worktree (ADR-0157), le hook n'écrit rien lui-même`,
    };
  }

  const fetch = lancer(FETCH);
  if (fetch.reponse.code !== 0) return { ok: false, message: echec(fetch.commande, fetch.reponse) };

  const sha = (args) => {
    const r = lancer(args);
    if (r.reponse.code !== 0) return { message: echec(r.commande, r.reponse) };
    const valeur = r.reponse.stdout.trim();
    return SHA.test(valeur) ? { valeur } : { message: inattendu(r.commande, r.reponse.stdout) };
  };
  const head = sha(REV_HEAD);
  if (head.valeur === undefined) return { ok: false, message: head.message };
  const dev = sha(REV_DEV);
  if (dev.valeur === undefined) return { ok: false, message: dev.message };

  const comptes = lancer(COMPTES);
  if (comptes.reponse.code !== 0) return { ok: false, message: echec(comptes.commande, comptes.reponse) };
  const lus = AVANCE_RETARD.exec(comptes.reponse.stdout.trim());
  if (lus === null) return { ok: false, message: inattendu(comptes.commande, comptes.reponse.stdout) };

  const avance = Number(lus[1]);
  const retard = Number(lus[2]);
  const reperes = `HEAD ${court(head.valeur)}, origin/dev ${court(dev.valeur)}`;
  if (avance > 0 && retard > 0) {
    return {
      ok: false,
      message: `checkout principal sur dev diverge d'origin/dev (${pluriel(avance)} en avance, ${String(retard)} en retard ; ${reperes}) : rapprochez-le vous-même d'origin/dev avant de créer un worktree, le hook n'écrit rien`,
    };
  }
  if (retard > 0) {
    return {
      ok: false,
      message: `checkout principal sur dev en retard de ${pluriel(retard)} sur origin/dev (${reperes}) : avancez-le avec « git merge --ff-only origin/dev » avant de créer un worktree, le hook n'écrit rien lui-même`,
    };
  }
  const enAvance = avance > 0 ? `, en avance de ${pluriel(avance)}` : "";
  return { ok: true, message: `checkout principal sur dev à jour avec origin/dev (${court(dev.valeur)}${enAvance})` };
}
