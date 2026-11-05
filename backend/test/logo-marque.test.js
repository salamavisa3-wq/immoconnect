// Garde-fou : la nouvelle marque (maison-clé) reste appliquée partout (conception du 2026-11-05).
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

test("fichiers de la marque : SVG valides et sans script", () => {
  for (const f of ["images/logo-mark.svg", "images/favicon.svg"]) {
    const svg = fs.readFileSync(path.join(front, f), "utf8");
    assert.match(svg, /^<svg[\s>]/, f);
    assert.ok(!/<script|onload=|javascript:/i.test(svg), `${f} ne doit contenir aucun script`);
    assert.ok(svg.includes("viewBox=\"0 0 48 48\""), f);
  }
});

test("la feuille de style affiche la marque, plus l'ancien point doré", () => {
  const css = fs.readFileSync(path.join(front, "css", "style.css"), "utf8");
  assert.ok(css.includes("/images/logo-mark.svg"));
  assert.ok(!/\.logo \.pastille \{[^}]*border-radius: 50%/.test(css), "l'ancien point doré ne doit plus être dessiné");
});

test("toutes les pages portent la nouvelle marque (nom en deux couleurs), aucune l'ancienne", () => {
  let nb = 0;
  for (const p of pages) {
    const html = fs.readFileSync(p, "utf8");
    assert.ok(!/class="pastille"><\/span>SakeurImmo/.test(html), `${path.relative(front, p)} a encore l'ancienne marque`);
    nb += (html.match(/<span class="mot">Sakeur<b>Immo<\/b><\/span>/g) || []).length;
  }
  assert.ok(nb >= 90, `marque attendue sur toutes les pages (${nb} trouvées)`);
});

test("image de partage : JPEG 1200x630 de taille raisonnable", () => {
  const buf = fs.readFileSync(path.join(front, "images", "og-image.jpg"));
  assert.ok(buf.length < 200 * 1024, "image trop lourde");
  let i = 2, l = 0, h = 0;
  while (i < buf.length) { // lecture du segment SOF (dimensions)
    assert.equal(buf[i], 0xff);
    const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) { h = buf.readUInt16BE(i + 5); l = buf.readUInt16BE(i + 7); break; }
    i += 2 + len;
  }
  assert.deepEqual([l, h], [1200, 630]);
});
