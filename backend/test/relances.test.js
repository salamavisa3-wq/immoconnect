// Tests : sélection des paiements à relancer, messages WhatsApp, marquage, digest cron.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

const fichierDb = path.join(os.tmpdir(), `sakeurimmo-relances-${process.pid}.db`);
process.env.TURSO_DATABASE_URL = `file:${fichierDb}`;
process.env.JWT_SECRET = "test-secret";
delete process.env.CRON_SECRET;

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { paiementsARelancer, telephoneWhatsApp } = require("../relances");
const relancesRoutes = require("../routes/relances.routes");

let serveur, base, admin, proprio;
async function appel(chemin, { user, methode = "GET", entetes = {} } = {}) {
  const auth = user ? { Authorization: `Bearer ${jwt.sign({ id: user }, process.env.JWT_SECRET)}` } : {};
  const r = await fetch(base + chemin, { method: methode, headers: { ...auth, ...entetes } });
  return { status: r.status, json: await r.json() };
}
async function creerUser(email, role = "proprietaire", telephone = "77 123 45 67") {
  const r = await db.run(
    "INSERT INTO users (nom_complet, email, telephone, mot_de_passe, role) VALUES ('Awa Diop', ?, ?, 'x', ?)",
    [email, telephone, role]
  );
  return r.lastInsertRowid;
}
const paiement = (user, ref, statut, { cree = "-0 hours", declare = null } = {}) =>
  db.run(
    `INSERT INTO paiements (user_id, reference, montant, type, statut, cree_le, declare_le)
     VALUES (?, ?, 10000, 'inscription', ?, datetime('now', ?), ${declare ? "datetime('now', ?)" : "NULL"})`,
    declare ? [user, ref, statut, cree, declare] : [user, ref, statut, cree]
  );

test.before(async () => {
  await db.pretASync;
  admin = await creerUser("admin@t.sn", "admin");
  proprio = await creerUser("p@t.sn");
  await paiement(await creerUser("a1@t.sn"), "ABANDON-OK", "initie", { cree: "-2 hours" });
  await paiement(await creerUser("a2@t.sn"), "ABANDON-TROP-RECENT", "initie", { cree: "-30 minutes" });
  await paiement(await creerUser("a3@t.sn"), "ABANDON-TROP-VIEUX", "initie", { cree: "-9 days" });
  const paye = await creerUser("a4@t.sn");
  await paiement(paye, "ABANDON-DEJA-PAYE", "initie", { cree: "-3 hours" });
  await paiement(paye, "PAYE", "reussi", { cree: "-2 hours", declare: "-2 hours" });
  await paiement(await creerUser("v1@t.sn", "proprietaire", "pas un numero"), "VERIF-OK", "en_verification", { cree: "-2 days", declare: "-30 hours" });
  await paiement(await creerUser("v2@t.sn"), "VERIF-RECENT", "en_verification", { cree: "-6 hours", declare: "-5 hours" });

  const app = express();
  app.use("/api/relances", relancesRoutes);
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}/api/relances`;
});

test.after(() => {
  serveur.close();
  for (const f of [fichierDb, `${fichierDb}-wal`, `${fichierDb}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
});

test("téléphone → format WhatsApp (Sénégal par défaut, international conservé, invalide rejeté)", () => {
  assert.equal(telephoneWhatsApp("77 123 45 67"), "221771234567");
  assert.equal(telephoneWhatsApp("+221 77 123 45 67"), "221771234567");
  assert.equal(telephoneWhatsApp("00221771234567"), "221771234567");
  assert.equal(telephoneWhatsApp("+33 6 12 34 56 78"), "33612345678");
  assert.equal(telephoneWhatsApp("pas un numero"), null);
  assert.equal(telephoneWhatsApp(""), null);
});

test("sélection : abandons (1 h – 7 j, sans autre paiement) et déclarés > 24 h", async () => {
  const { abandons, a_verifier } = await paiementsARelancer("https://sakeurimmo.com");
  assert.deepEqual(abandons.map((a) => a.reference), ["ABANDON-OK"]);
  assert.deepEqual(a_verifier.map((a) => a.reference), ["VERIF-OK"]);
});

test("messages : prénom, montant, lien de reprise ; lien wa.me encodé ; numéro invalide → null", async () => {
  const { abandons, a_verifier } = await paiementsARelancer("https://sakeurimmo.com");
  assert.match(abandons[0].message, /^Bonjour Awa, c'est SakeurImmo\./);
  assert.match(abandons[0].message, /10[\s  ]000 FCFA/);
  assert.ok(abandons[0].message.includes("https://sakeurimmo.com/paiement-qr.html?reference=ABANDON-OK"));
  assert.ok(abandons[0].whatsapp_url.startsWith("https://wa.me/221771234567?text=Bonjour%20Awa"));
  assert.match(a_verifier[0].message, /capture du SMS/);
  assert.equal(a_verifier[0].whatsapp_url, null);
});

test("marquage : accès admin, sortie de la liste 48 h, plafond de 2 relances", async () => {
  assert.equal((await appel("/ABANDON-OK/marquer", { user: proprio, methode: "POST" })).status, 403);
  assert.equal((await appel("/ABANDON-OK/marquer", { user: admin, methode: "POST" })).status, 200);
  assert.equal((await appel("/PAYE/marquer", { user: admin, methode: "POST" })).status, 404);
  assert.deepEqual((await paiementsARelancer()).abandons, []);

  await db.run("UPDATE paiements SET relance_le = datetime('now', '-3 days') WHERE reference = 'ABANDON-OK'");
  assert.equal((await paiementsARelancer()).abandons.length, 1);
  await appel("/ABANDON-OK/marquer", { user: admin, methode: "POST" });
  await db.run("UPDATE paiements SET relance_le = datetime('now', '-3 days') WHERE reference = 'ABANDON-OK'");
  assert.equal((await paiementsARelancer()).abandons.length, 0, "2 relances max");
});

test("digest cron : 503 sans secret, 401 mauvais jeton, 200 avec le bon", async () => {
  assert.equal((await appel("/cron/digest", { methode: "POST" })).status, 503);
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await appel("/cron/digest", { methode: "POST", entetes: { Authorization: "Bearer faux" } })).status, 401);
  assert.equal((await appel("/cron/digest", { methode: "POST" })).status, 401);
  const ok = await appel("/cron/digest", { methode: "POST", entetes: { Authorization: "Bearer s3cret" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.a_verifier, 1);
});
