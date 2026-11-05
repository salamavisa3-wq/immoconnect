// Garde-fou : le bouton « Publier une annonce » du bandeau reste sur une seule ligne sur mobile.
// Libellé court « Publier » (<= 560 px et 861-980 px), nom complet conservé pour les lecteurs d'écran.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const front = path.join(__dirname, "..", "..", "frontend");
const pages = [];
(function parcourir(dossier) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".")) parcourir(p); }
    else if (e.name.endsWith(".html")) pages.push(p);
  }
})(front);

const bandeau = (html) => (html.match(/<header class="entete">[\s\S]*?<\/header>/) || [""])[0];

test("chaque bouton « Publier une annonce » du bandeau a le libellé court et aria-label", () => {
  let nb = 0;
  for (const p of pages) {
    const b = bandeau(fs.readFileSync(p, "utf8"));
    assert.ok(!/class="bouton bouton-primaire">Publier une annonce<\/a>/.test(b), `${path.relative(front, p)} : ancien bouton sur deux lignes`);
    if (b.includes('class="cta-suite"')) {
      nb++;
      assert.ok(b.includes('aria-label="Publier une annonce"'), `${path.relative(front, p)} : aria-label manquant`);
      assert.ok(b.includes('<span>Publier<span class="cta-suite"> une annonce</span></span>'), `${path.relative(front, p)} : le libellé doit être dans un seul bloc (sinon espace en trop dans le flex)`);
    }
  }
  assert.ok(nb >= 40, `bouton attendu sur la plupart des pages (${nb})`);
});

test("la feuille de style garde le bouton sur une ligne et masque la suite du libellé sur mobile", () => {
  const css = fs.readFileSync(path.join(front, "css", "style.css"), "utf8");
  assert.ok(/\.entete \.barre > \.bouton \{ white-space: nowrap; \}/.test(css));
  assert.ok(/@media \(max-width: 560px\), \(min-width: 861px\) and \(max-width: 980px\) \{ \.entete \.cta-suite \{ display: none; \} \}/.test(css));
});
