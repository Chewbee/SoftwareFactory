// Garde : skills préchargées et citées par les agents du plugin.
// Adapté de la garde Adonnante #2000 (une skill manquante ou désactivée est
// sautée SILENCIEUSEMENT par Claude Code, avec pour seule trace un
// avertissement dans le journal de debug). Version plugin :
//   1. chaque entrée `skills:` du frontmatter d'un agent est NAMESPACÉE ;
//   2. chaque référence `softwarefactory:<nom>` (frontmatter ou corps, agents
//      ou skills) résout vers `skills/<nom>/SKILL.md` dans CE plugin ;
//   3. les préfixes tiers autorisés sont déclarés ci-dessous — toute autre
//      forme est un échec bruyant.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER_AGENTS = path.join(RACINE, "agents");
const DOSSIER_SKILLS = path.join(RACINE, "skills");
const PREFIXE_PLUGIN = "softwarefactory";
const PREFIXES_TIERS = ["superpowers-extended-cc", "typesafe", "cesiumjs"];

function lireFichiersMd(dossier) {
  return fs.readdirSync(dossier).filter((f) => f.endsWith(".md")).map((f) => path.join(dossier, f));
}

function extraireFrontmatter(texte, fichier) {
  const lignes = texte.split(/\r?\n/);
  if (lignes[0] !== "---") return { lignes, finEntete: 0 };
  const fin = lignes.findIndex((l, i) => i > 0 && l === "---");
  if (fin === -1) throw new Error(`frontmatter non fermé : ${fichier}`);
  return { lignes, finEntete: fin };
}

function entréesSkills(lignes, finEntete) {
  const entetes = lignes.slice(0, finEntete);
  const idx = entetes.findIndex((l) => l === "skills:");
  if (idx === -1) return [];
  const refs = [];
  for (const l of entetes.slice(idx + 1)) {
    const m = l.match(/^\s*-\s*(\S+)\s*$/);
    if (!m) break;
    refs.push(m[1]);
  }
  return refs;
}

test("chaque entrée skills: d'un agent est namespacée et le préfixe est connu", () => {
  const erreurs = [];
  for (const fichier of lireFichiersMd(DOSSIER_AGENTS)) {
    const texte = fs.readFileSync(fichier, "utf8");
    const { lignes, finEntete } = extraireFrontmatter(texte, fichier);
    for (const ref of entréesSkills(lignes, finEntete)) {
      const [prefixe] = ref.split(":");
      if (prefixe === ref) {
        erreurs.push(`${path.basename(fichier)} : entrée sans préfixe « ${ref} » (attendu ${PREFIXE_PLUGIN}:… ou un préfixe tiers déclaré)`);
      } else if (prefixe !== PREFIXE_PLUGIN && !PREFIXES_TIERS.includes(prefixe)) {
        erreurs.push(`${path.basename(fichier)} : préfixe inconnu « ${prefixe}: » (tiers autorisés : ${PREFIXES_TIERS.join(", ")})`);
      }
    }
  }
  assert.deepEqual(erreurs, [], erreurs.join("\n"));
});

test("toute référence softwarefactory:<nom> résout vers skills/<nom>/SKILL.md", () => {
  const erreurs = [];
  const cibles = [...lireFichiersMd(DOSSIER_AGENTS), ...lireFichiersMd(DOSSIER_SKILLS).map((f) => f).filter((f) => fs.statSync(f).isFile() && path.basename(f) === "SKILL.md")];
  for (const fichier of cibles) {
    const texte = fs.readFileSync(fichier, "utf8");
    for (const m of texte.matchAll(/`softwarefactory:([a-z0-9-]+)`/g)) {
      const sk = path.join(DOSSIER_SKILLS, m[1], "SKILL.md");
      if (!fs.existsSync(sk)) {
        erreurs.push(`${path.relative(RACINE, fichier)} : softwarefactory:${m[1]} citée, ${path.relative(RACINE, sk)} introuvable`);
      }
    }
  }
  assert.deepEqual(erreurs, [], erreurs.join("\n"));
});
