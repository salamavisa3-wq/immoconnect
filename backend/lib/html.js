// lib/html.js — Échappement des valeurs d'utilisateur écrites dans du HTML ou dans un bloc JSON-LD.
// Audit sécurité 2026-11-05 : titre, ville, description... sont saisis par les propriétaires et ne doivent
// jamais être interprétés comme du HTML (XSS stockée).

// Échappement HTML (texte ET valeurs d'attributs entre guillemets).
function echapper(texte) {
  return String(texte ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Séparateurs de ligne Unicode : valides en JSON mais ils cassent un script en ligne (construits par code
// pour que le fichier ne contienne aucun caractère invisible).
const SEP_LIGNE = String.fromCharCode(0x2028);
const SEP_PARAGRAPHE = String.fromCharCode(0x2029);

// JSON.stringify sûr pour <script type="application/ld+json"> : un titre contenant "</script>" ne peut plus
// fermer la balise. Le JSON reste valide et se relit à l'identique (< = "<" pour JSON.parse).
function jsonSafe(valeur, espace) {
  return JSON.stringify(valeur, null, espace)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(SEP_LIGNE).join("\\u2028")
    .split(SEP_PARAGRAPHE).join("\\u2029");
}

module.exports = { echapper, jsonSafe };
