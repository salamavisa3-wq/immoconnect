// Passe « design + SEO technique » V2 — corrige ce que Lighthouse / l'inventaire SEO relèvent sur le site refondu le 22/10/2026 :
//   • balise <main id="contenu"> + lien d'évitement sur les pages publiques (landmarks)
//   • ordre des titres : titres de colonnes du pied de page ≠ <h4> ; cartes <h4> → <h3>
//   • contrastes (texte secondaire, liens terre cuite, paragraphe du bandeau diaspora)
//   • libellés accessibles (aria-label) des champs de formulaire des pages publiques
//   • CLS des pages villes/catégories : le JS ne vide plus une grille déjà rendue par le serveur (le placeholder « Chargement des annonces... » reste l'ancre d'injection SSR de server.js)
//   • robots.txt : retrait de la ligne « Link: » (non valide dans un robots.txt)
// Idempotent. Usage : node seo-automation/design-seo-pass.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const SKIP = new Set(['admin.html', 'tableau-de-bord.html', 'paiement-paypal.html', 'paiement-qr.html', 'connexion.html', 'inscription.html']);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
const stats = { main: 0, h4: 0, label: 0 };

for (const f of walk(FE).filter((p) => p.endsWith('.html'))) {
  const rel = path.relative(FE, f).replace(/\\/g, '/');
  if (SKIP.has(rel)) continue;
  let h = read(f); const before = h;
  // 1. landmarks
  if (!/<main[\s>]/.test(h) && /<\/header>/.test(h) && /<footer class="pied"/.test(h)) {
    h = h.replace('</header>', '</header>\n<main id="contenu">').replace(/(<footer class="pied")/, '</main>\n$1'); stats.main++;
  } else if (/<main(?![^>]*\sid=)/.test(h)) { h = h.replace(/<main(?![^>]*\sid=)/, '<main id="contenu"'); stats.main++; }
  if (!h.includes('lien-evitement')) h = h.replace(/(<body[^>]*>)/, '$1\n<a class="lien-evitement" href="#contenu">Aller au contenu</a>');
  // 2. titres : colonnes du pied de page → paragraphes ; autres <h4> → <h3>
  h = h.replace(/(<footer class="pied"[\s\S]*?<\/footer>)/, (m) => m.replace(/<h4>([\s\S]*?)<\/h4>/g, '<p class="pied-titre">$1</p>'));
  const n4 = (h.match(/<h4[\s>]/g) || []).length; if (n4) { h = h.replace(/<h4([\s>])/g, '<h3$1').replace(/<\/h4>/g, '</h3>'); stats.h4 += n4; }
  // 3. libellés accessibles : <label>X</label> suivi d'un champ sans id ni aria-label
  h = h.replace(/(<label>\s*)([^<]+?)(\s*<\/label>\s*<(?:input|select|textarea)\b)([^>]*)(>)/g, (m, a, txt, b, attrs, c) => {
    if (/\baria-label=|\bid=/.test(attrs)) return m;
    const lab = txt.replace(/\s*\*\s*$/, '').replace(/\s*\(optionnel\)\s*$/i, '').trim().replace(/"/g, '&quot;');
    stats.label++; return `${a}${txt}${b}${attrs} aria-label="${lab}"${c}`;
  });
  // 3b. ordre des titres : un <h2> masqué avant la grille d'annonces (h1 → h2 → cartes en h3)
  if (/<div id="grille-categorie"/.test(h) && !h.includes('titre-grille-annonces')) h = h.replace(/(\s*)(<div id="grille-categorie")/, '$1<h2 class="sr-only" id="titre-grille-annonces">Annonces disponibles</h2>$1$2');
  if (h !== before) write(f, h);
}

// CSS
const cssP = path.join(FE, 'css/style.css'); let css = read(cssP);
if (!css.includes('/* === V2 design+seo ===')) {
  css = css.replace('--texte-clair: #6B6250;', '--texte-clair: #564E3F;')
    .replace('--terre: #B5541F;', '--terre: #B5541F;\n  --terre-texte: #8F3F14;')
    .replace(/color: var\(--terre\);/g, 'color: var(--terre-texte);')
    .replace(/(\.|div\.|a\.)type-carte h4/g, '$1type-carte h3').replace('.etape h4', '.etape h3').replace('.annonce-corps h4', '.annonce-corps h3').replace('.tableau-lateral h4', '.tableau-lateral h3')
    .replace('.pied h4 {', '.pied h4, .pied .pied-titre {');
  css += `
/* === V2 design+seo === */
.lien-evitement { position: absolute; left: -999px; top: 8px; z-index: 200; background: var(--bleu-nuit, #101B2D); color: #fff; padding: 10px 16px; border-radius: 10px; }
.lien-evitement:focus { left: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pied .pied-titre { display: block; }
.acc-diaspora p { color: #fff; }
main:focus { outline: none; }
`;
  write(cssP, css);
}

// JS : ne pas vider la grille rendue par le serveur + cartes en <h3>
const jsP = path.join(FE, 'js/categorie.js'); let js = read(jsP);
const G1 = `grille.innerHTML = "<p style='color:var(--texte-clair)'>Chargement des annonces...</p>";`;
if (!js.includes('grille.querySelector(".annonce-carte")')) js = js.replace(G1, `if (!grille.querySelector(".annonce-carte")) ${G1.slice(0, -1)}; // grille déjà rendue par le serveur : on ne la vide pas`).replace(/<h4>\$\{b\.titre\}<\/h4>/g, '<h3>${b.titre}</h3>');
write(jsP, js);
// SSR (cartes annonces) : <h4> → <h3>
const srvP = path.join(ROOT, 'backend/server.js'); let srv = read(srvP);
srv = srv.replace('<h4>${echapper(b.titre)}</h4>', '<h3>${echapper(b.titre)}</h3>'); write(srvP, srv);
// robots.txt : « Link: » n'existe pas dans le protocole robots.txt
const rb = path.join(FE, 'robots.txt'); write(rb, read(rb).split('\n').filter((l) => !/^Link:/i.test(l)).join('\n'));
console.log('terminé', stats);
