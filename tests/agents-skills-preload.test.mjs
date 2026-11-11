// Garde : skills préchargées et citées par les agents du plugin.
// Adapté de la garde Adonnante #2000 (une skill manquante ou désactivée est
// sautée SILENCIEUSEMENT par Claude Code, avec pour seule trace un
// avertissement dans le journal de debug). Version plugin :
//   1. chaque entrée `skills:` du frontmatter d'un agent est NAMESPACÉE et,
//      si elle est `softwarefactory:`, RÉSOUT vers `skills/<nom>/SKILL.md` ;
//   2. chaque citation `softwarefactory:<nom>` du corps d'un agent ou d'une
//      skill résout vers `agents/<nom>.md` OU `skills/<nom>/SKILL.md` ;
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

function lireSkillMds() {
  // skills/<dossier>/SKILL.md uniquement : les .md en racine de skills/
  // (ex. la NOTICE) sont de la prose, pas des skills.
  return fs
    .readdirSync(DOSSIER_SKILLS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(DOSSIER_SKILLS, e.name, "SKILL.md"))
    .filter((f) => fs.existsSync(f));
}

function extraireFrontmatter(texte, fichier) {
  const lignes = texte.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lignes[0] !== "---") return { lignes, finEntete: 0 };
  const fin = lignes.findIndex((l, i) => i > 0 && l === "---");
  if (fin === -1) throw new Error(`frontmatter non fermé : ${fichier}`);
  return { lignes, finEntete: fin };
}

function entréesSkills(lignes, finEntete, fichier, erreurs) {
  const entetes = lignes.slice(0, finEntete);
  const idx = entetes.findIndex((l) => l === "skills:");
  if (idx === -1) return [];
  // Forme inline : skills: [a, b]
  if (/^skills:\s*\[.*\]\s*$/.test(entetes[idx])) {
    return entetes[idx]
      .replace(/^skills:\s*\[/, "")
      .replace(/\]\s*$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const refs = [];
  for (const l of entetes.slice(idx + 1)) {
    const m = l.match(/^\s*-\s*(\S+)\s*$/);
    if (m) {
      refs.push(m[1]);
    } else if (/^\s*-/.test(l)) {
      // une entrée mal formée ne doit pas masquer les suivantes en silence
      erreurs.push(`${path.basename(fichier)} : entrée skills mal formée « ${l.trim()} »`);
    } else {
      break; // clé suivante, ligne vide ou fin du frontmatter : fin de liste
    }
  }
  return refs;
}

test("chaque entrée skills: d'un agent est namespacée, préfixe connu, et résout", () => {
  const erreurs = [];
  for (const fichier of lireFichiersMd(DOSSIER_AGENTS)) {
    const texte = fs.readFileSync(fichier, "utf8");
    const { lignes, finEntete } = extraireFrontmatter(texte, fichier);
    for (const ref of entréesSkills(lignes, finEntete, fichier, erreurs)) {
      const [prefixe, nom] = ref.split(":");
      if (prefixe === ref) {
        erreurs.push(`${path.basename(fichier)} : entrée sans préfixe « ${ref} » (attendu ${PREFIXE_PLUGIN}:… ou un préfixe tiers déclaré)`);
      } else if (prefixe !== PREFIXE_PLUGIN && !PREFIXES_TIERS.includes(prefixe)) {
        erreurs.push(`${path.basename(fichier)} : préfixe inconnu « ${prefixe}: » (tiers autorisés : ${PREFIXES_TIERS.join(", ")})`);
      } else if (prefixe === PREFIXE_PLUGIN) {
        const sk = path.join(DOSSIER_SKILLS, nom, "SKILL.md");
        if (!fs.existsSync(sk)) {
          erreurs.push(`${path.basename(fichier)} : entrée « ${ref} » sans skills/${nom}/SKILL.md`);
        }
      }
    }
  }
  assert.deepEqual(erreurs, [], erreurs.join("\n"));
});

test("toute citation softwarefactory:<nom> (agents et skills) résout", () => {
  const erreurs = [];
  const cibles = [...lireFichiersMd(DOSSIER_AGENTS), ...lireSkillMds()];
  for (const fichier of cibles) {
    const texte = fs.readFileSync(fichier, "utf8");
    for (const m of texte.matchAll(/`softwarefactory:([a-z0-9-]+)`/g)) {
      const agent = path.join(DOSSIER_AGENTS, `${m[1]}.md`);
      const skill = path.join(DOSSIER_SKILLS, m[1], "SKILL.md");
      if (!fs.existsSync(agent) && !fs.existsSync(skill)) {
        erreurs.push(`${path.relative(RACINE, fichier)} : softwarefactory:${m[1]} citée, ni agents/${m[1]}.md ni skills/${m[1]}/SKILL.md`);
      }
    }
  }
  assert.deepEqual(erreurs, [], erreurs.join("\n"));
});
