// Régression XSS (audit sécurité 2026-11-05) : aucune donnée d'utilisateur ne doit être écrite brute dans une page.
// 1) Rendu serveur : on appelle les vraies fonctions de server.js avec des charges utiles.
// 2) Rendu navigateur : on vérifie qu'aucun gabarit n'interpole un champ d'utilisateur sans esc()/escHtml().
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.SAKEURIMMO_NO_LISTEN = "1";
process.env.TURSO_DATABASE_URL = `file:${path.join(os.tmpdir(), `sakeurimmo-rendu-${process.pid}.db`)}`;
process.env.JWT_SECRET = "test-secret";

const app = require("../server");
const { carteAnnonceHtml, jsonLdItemList, jsonLdRealEstateListing } = app.locals.rendu;

const BIEN = {
  id: 7,
  titre: "</script><script>alert(1)</script>",
  type_bien: "terrain",
  transaction_type: "vente",
  ville: '<img src=x onerror="alert(2)">',
  quartier: "<b>Q</b>",
  prix: 1000,
  superficie: "<img src=x onerror=alert(3)>",
  chambres: "<svg/onload=alert(4)>",
  salles_bain: "<script>alert(5)</script>",
  description: "</script><script>alert(6)</script>",
  images: ['x" onerror="alert(7)'],
  cree_le: "2026-11-05 10:00:00",
};

const DANGEREUX = /<script|<img src=x|<svg\/onload|<b>Q|onerror="alert/i;

test("carte d'annonce rendue par le serveur : aucune balise injectée", () => {
  const html = carteAnnonceHtml(BIEN);
  assert.ok(!DANGEREUX.test(html), html);
});

test("JSON-LD (liste et fiche) : impossible de fermer la balise <script>", () => {
  const liste = jsonLdItemList([BIEN], "https://sakeurimmo.com/annonces.html");
  const fiche = jsonLdRealEstateListing(BIEN, "https://sakeurimmo.com/annonce/x-7");
  for (const s of [liste, fiche]) {
    assert.ok(!s.includes("<"), s);
    JSON.parse(s); // reste du JSON valide
  }
  assert.equal(JSON.parse(liste).itemListElement[0].name, BIEN.titre); // la donnée est intacte
});

const racine = path.join(__dirname, "..", "..", "frontend");
const FICHIERS = ["admin.html", "annonce.html", "annonces.html", "tableau-de-bord.html", "js/categorie.js"];
// ${b.titre}, ${p.nom_complet}, ${m.message}... sans esc( / escHtml( devant
const BRUT = /\$\{\s*(?:b|p|m|bien|user|x)\.(?:titre|ville|quartier|description|superficie|chambres|salles_bain|nom_complet|email|telephone|transaction_id|bien_titre|bien_ville|message|nom)\s*(?:\}|\.|\|\||\+)/;

test("gabarits du navigateur : aucun champ d'utilisateur interpolé sans échappement", () => {
  for (const f of FICHIERS) {
    const lignes = fs.readFileSync(path.join(racine, f), "utf8").split(/\r?\n/);
    lignes.forEach((l, i) => {
      assert.ok(!BRUT.test(l), `${f}:${i + 1} interpole un champ brut : ${l.trim().slice(0, 120)}`);
    });
  }
});

test("server.js : plus de remplacement de « < » sans effet ni JSON.stringify dans les JSON-LD", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(!/\.replace\(\/<\/g, "\\u003c"\)/.test(src));
  assert.ok(!/JSON\.stringify\(\{\s*"@context"/.test(src));
  assert.ok(!/return JSON\.stringify\(data/.test(src));
});
