// Tests d'intégration : abonnement Agence + mise en avant à durées (node --test).
// Base SQLite temporaire, routeur paiements monté dans une mini-app Express.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

const fichierDb = path.join(os.tmpdir(), `sakeurimmo-test-${process.pid}.db`);
process.env.TURSO_DATABASE_URL = `file:${fichierDb}`;
process.env.JWT_SECRET = "test-secret";

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const paymentsRoutes = require("../routes/payments.routes");

let serveur, base;
const jeton = (id) => jwt.sign({ id }, process.env.JWT_SECRET);
async function api(chemin, { user, methode = "GET", corps } = {}) {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton(user)}` },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: r.status, json: await r.json() };
}
async function creerUser(email, role = "proprietaire") {
  const r = await db.run(
    "INSERT INTO users (nom_complet, email, telephone, mot_de_passe, role) VALUES (?, ?, '770000000', 'x', ?)",
    ["Test", email, role]
  );
  return r.lastInsertRowid;
}
const joursJusqua = (iso) => Math.round((new Date(iso.replace(" ", "T") + "Z") - Date.now()) / 86400000);

test.before(async () => {
  await db.pretASync;
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRoutes);
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}/api/payments`;
});

test.after(async () => {
  serveur.close();
  // Windows garde le fichier ouvert tant que le client libSQL vit : nettoyage au mieux.
  for (const f of [fichierDb, `${fichierDb}-wal`, `${fichierDb}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
});

async function payerAgence(user) {
  const { json: init } = await api("/initier", { user, methode: "POST", corps: { forfait: 3 } });
  assert.equal(init.montant, 30000);
  const d = await api(`/qr/${init.reference}/declarer`, { user, methode: "POST", corps: { transaction_id: "TX12345" } });
  assert.equal(d.status, 200);
  return init.reference;
}

test("forfaits publics : 4 formules dont l'abonnement Agence", async () => {
  const u = await creerUser("a@test.sn");
  const { json } = await api("/forfaits", { user: u });
  assert.deepEqual(json.forfaits.map((f) => f.prix), [5000, 10000, 15000, 30000]);
  assert.equal(json.forfaits[3].mensuel, true);
});

test("Agence : 50 places + 30 jours, renouvellement additionne la durée sans recréditer", async () => {
  const u = await creerUser("b@test.sn");
  await payerAgence(u);
  let user = await db.get("SELECT * FROM users WHERE id = ?", [u]);
  assert.equal(user.quota_annonces, 50);
  assert.equal(user.statut_compte, "actif");
  assert.ok(Math.abs(joursJusqua(user.abonnement_jusqu_au) - 30) <= 1);

  await payerAgence(u);
  user = await db.get("SELECT * FROM users WHERE id = ?", [u]);
  assert.equal(user.quota_annonces, 50);
  assert.ok(Math.abs(joursJusqua(user.abonnement_jusqu_au) - 60) <= 1);
});

test("Agence échue : les 50 places sont retirées à la requête suivante, le quota payant reste", async () => {
  const u = await creerUser("c@test.sn");
  await db.run("UPDATE users SET quota_annonces = 5, statut_compte = 'actif' WHERE id = ?", [u]); // forfait 5 000 antérieur
  await payerAgence(u);
  assert.equal((await db.get("SELECT quota_annonces q FROM users WHERE id = ?", [u])).q, 55);

  await db.run("UPDATE users SET abonnement_jusqu_au = datetime('now', '-1 hour') WHERE id = ?", [u]);
  await api("/qr/inexistante", { user: u }); // toute route authRequis déclenche l'expiration
  const user = await db.get("SELECT * FROM users WHERE id = ?", [u]);
  assert.equal(user.quota_annonces, 5);
  assert.equal(user.abonnement_annonces, 0);
});

test("Rejet d'un paiement Agence : places et abonnement révoqués", async () => {
  const admin = await creerUser("admin@test.sn", "admin");
  const u = await creerUser("d@test.sn");
  const ref = await payerAgence(u);
  const r = await api(`/admin/${ref}/rejeter`, { user: admin, methode: "POST" });
  assert.equal(r.status, 200);
  const user = await db.get("SELECT * FROM users WHERE id = ?", [u]);
  assert.equal(user.quota_annonces, 0);
  assert.equal(user.abonnement_annonces, 0);
  assert.equal(user.abonnement_jusqu_au, null);
});

test("Mise en avant : prix et durée suivent le palier choisi (7 / 15 / 30 j)", async () => {
  const admin = (await db.get("SELECT id FROM users WHERE role = 'admin'")).id;
  const u = await creerUser("e@test.sn");
  const attendu = { 7: 2000, 15: 3500, 30: 6000 };
  for (const jours of [7, 15, 30]) {
    const b = await db.run(
      "INSERT INTO biens (user_id, titre, type_bien, transaction_type, ville, prix, statut) VALUES (?, 't', 'terrain', 'vente', 'Thiès', 1, 'publie')",
      [u]
    );
    const { json: init } = await api(`/initier-mise-en-avant/${b.lastInsertRowid}`, { user: u, methode: "POST", corps: { jours } });
    assert.equal(init.montant, attendu[jours]);
    await api(`/qr/${init.reference}/declarer`, { user: u, methode: "POST", corps: { transaction_id: "TXMEA1" } });
    await api(`/admin/${init.reference}/valider`, { user: admin, methode: "POST" });
    const bien = await db.get("SELECT * FROM biens WHERE id = ?", [b.lastInsertRowid]);
    assert.ok(Math.abs(joursJusqua(bien.mise_en_avant_jusqu_au) - jours) <= 1, `durée ${jours} j`);
  }
});

test("Mise en avant : durée par défaut 7 j, durée inconnue refusée", async () => {
  const u = await creerUser("f@test.sn");
  const b = await db.run(
    "INSERT INTO biens (user_id, titre, type_bien, transaction_type, ville, prix, statut) VALUES (?, 't', 'terrain', 'vente', 'Thiès', 1, 'publie')",
    [u]
  );
  const defaut = await api(`/initier-mise-en-avant/${b.lastInsertRowid}`, { user: u, methode: "POST", corps: {} });
  assert.equal(defaut.json.montant, 2000);
  const invalide = await api(`/initier-mise-en-avant/${b.lastInsertRowid}`, { user: u, methode: "POST", corps: { jours: 99 } });
  assert.equal(invalide.status, 400);
});
