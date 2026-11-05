// Tests unitaires (node --test) : échappement HTML/JSON-LD et validation des champs saisis.
const test = require("node:test");
const assert = require("node:assert/strict");
const { echapper, jsonSafe } = require("../lib/html");
const { validerChampsAnnonce, validerInscription } = require("../lib/validation");

const CHARGES = [
  '<img src=x onerror="document.title=1">',
  "</script><script>alert(1)</script>",
  "\"'><svg/onload=alert(1)>",
];

test("echapper neutralise <, >, &, \" et '", () => {
  for (const c of CHARGES) {
    const s = echapper(c);
    assert.ok(!/[<>"']/.test(s), `caractère dangereux restant dans : ${s}`);
  }
  assert.equal(echapper(null), "");
  assert.equal(echapper(5000), "5000");
});

test("jsonSafe ne laisse jamais fermer la balise <script> et se relit à l'identique", () => {
  const objet = { name: "</script><script>alert(1)</script>", n: 1, sep: "a b", amp: "x&y" };
  const sortie = jsonSafe(objet);
  assert.ok(!sortie.includes("<") && !sortie.includes(">"), sortie);
  assert.ok(!sortie.includes(" "));
  assert.deepEqual(JSON.parse(sortie), objet);
  assert.ok(jsonSafe(objet, 2).includes("\n")); // indentation conservée
});

test("annonce : un champ numérique non numérique est refusé (plus de XSS via superficie)", () => {
  for (const champ of ["superficie", "chambres", "salles_bain", "prix"]) {
    const r = validerChampsAnnonce({ titre: "T", ville: "Thiès", prix: 1000, [champ]: '<img src=x onerror=alert(1)>' });
    assert.ok(r.erreur, `${champ} devrait être refusé`);
  }
  assert.ok(validerChampsAnnonce({ titre: "T", ville: "V", prix: 1000, superficie: "NaN" }).erreur);
  assert.ok(validerChampsAnnonce({ titre: "T", ville: "V", prix: 1000, superficie: -5 }).erreur);
  assert.ok(validerChampsAnnonce({ titre: "T", ville: "V", prix: 0 }).erreur);
});

test("annonce : valeurs valides normalisées, vides → null", () => {
  const r = validerChampsAnnonce({ titre: "  Terrain 2 ha  ", ville: "Thiès", prix: "15000000", superficie: "20000", chambres: "", description: "" });
  assert.deepEqual(r.valeurs, { titre: "Terrain 2 ha", ville: "Thiès", quartier: null, description: null, prix: 15000000, superficie: 20000, chambres: null, salles_bain: null });
});

test("annonce : tailles maximales et types de texte", () => {
  assert.ok(validerChampsAnnonce({ titre: "x".repeat(151), ville: "V", prix: 1 }).erreur);
  assert.ok(validerChampsAnnonce({ titre: "T", ville: "V", prix: 1, description: "d".repeat(5001) }).erreur);
  assert.ok(validerChampsAnnonce({ titre: { a: 1 }, ville: "V", prix: 1 }).erreur);
  assert.ok(validerChampsAnnonce({ titre: "T", ville: "V", prix: 1, quartier: ["x"] }).erreur);
});

test("annonce : mode partiel (PUT) ne retourne que les champs fournis et valide ceux-là", () => {
  assert.deepEqual(validerChampsAnnonce({ prix: "20000" }, { partiel: true }), { valeurs: { prix: 20000 } });
  assert.deepEqual(validerChampsAnnonce({}, { partiel: true }), { valeurs: {} });
  assert.ok(validerChampsAnnonce({ superficie: "<b>" }, { partiel: true }).erreur);
  assert.ok(validerChampsAnnonce({ titre: "  " }, { partiel: true }).erreur);
});

test("inscription : e-mail, téléphone et tailles", () => {
  const ok = { nom_complet: "Awa Diop", email: "awa@example.sn", telephone: "+221 77 123 45 67", ville: "Thiès", mot_de_passe: "secret1" };
  assert.equal(validerInscription(ok), null);
  assert.ok(validerInscription({ ...ok, email: '<img src=x onerror=alert(1)>@x.sn' }));
  assert.ok(validerInscription({ ...ok, email: "pas-un-email" }));
  assert.ok(validerInscription({ ...ok, nom_complet: "a".repeat(101) }));
  assert.ok(validerInscription({ ...ok, telephone: "<script>" }));
  assert.ok(validerInscription({ ...ok, nom_complet: { x: 1 } }));
  assert.ok(validerInscription({ ...ok, ville: "v".repeat(81) }));
});
