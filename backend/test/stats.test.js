// Tests : statistiques admin (entonnoir, revenus, canaux, accès réservé).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

const fichierDb = path.join(os.tmpdir(), `sakeurimmo-stats-${process.pid}.db`);
process.env.TURSO_DATABASE_URL = `file:${fichierDb}`;
process.env.JWT_SECRET = "test-secret";

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const adminRoutes = require("../routes/admin.routes");

let serveur, base, admin, proprio;
const get = async (chemin, user) => {
  const r = await fetch(base + chemin, { headers: { Authorization: `Bearer ${jwt.sign({ id: user }, process.env.JWT_SECRET)}` } });
  return { status: r.status, json: await r.json() };
};
async function creerUser(email, { role = "proprietaire", code = null, cree = "datetime('now')" } = {}) {
  const r = await db.run(
    `INSERT INTO users (nom_complet, email, telephone, mot_de_passe, role, code_createur, cree_le)
     VALUES ('T', ?, '770000000', 'x', ?, ?, ${cree})`,
    [email, role, code]
  );
  return r.lastInsertRowid;
}
const paiement = (user, ref, montant, statut, extra = "") =>
  db.run(
    `INSERT INTO paiements (user_id, reference, montant, type, statut, cree_le, declare_le, confirme_le)
     VALUES (?, ?, ?, 'inscription', ?, ${extra || "datetime('now')"}, ${statut === "initie" ? "NULL" : "datetime('now', '-30 hours')"}, ${statut === "reussi" ? "datetime('now')" : "NULL"})`,
    [user, ref, montant, statut]
  );

test.before(async () => {
  await db.pretASync;
  admin = await creerUser("admin@t.sn", { role: "admin" });
  proprio = await creerUser("p0@t.sn", { cree: "datetime('now', '-200 days')" }); // hors période
  const u1 = await creerUser("p1@t.sn", { code: "fb" });
  const u2 = await creerUser("p2@t.sn");
  const u3 = await creerUser("p3@t.sn");
  await creerUser("p4@t.sn");
  await paiement(u1, "R1", 5000, "reussi");
  await paiement(u2, "R2", 10000, "en_verification");
  await paiement(u3, "R3", 15000, "initie", "datetime('now', '-3 hours')");

  const app = express();
  app.use("/api/admin", adminRoutes);
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}/api/admin`;
});

test.after(() => {
  serveur.close();
  for (const f of [fichierDb, `${fichierDb}-wal`, `${fichierDb}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
});

test("accès réservé aux administrateurs", async () => {
  assert.equal((await get("/stats", proprio)).status, 403);
  assert.equal((await get("/stats", admin)).status, 200);
});

test("entonnoir : cohorte de la période seulement, taux en %", async () => {
  const { json } = await get("/stats?jours=30", admin);
  assert.equal(json.periode_jours, 30);
  assert.deepEqual(
    [json.entonnoir.inscrits, json.entonnoir.initie, json.entonnoir.declare, json.entonnoir.valide],
    [4, 3, 2, 1]
  );
  assert.equal(json.entonnoir.taux_valide, 25);
  assert.equal(json.entonnoir.taux_declare, 50);
});

test("revenus validés vs déclarés non vérifiés, backlog et paniers abandonnés", async () => {
  const { json } = await get("/stats", admin);
  assert.equal(json.revenus.valide, 5000);
  assert.equal(json.revenus.declare_non_verifie, 10000);
  assert.deepEqual(json.a_valider, { nb: 1, montant: 10000, plus_de_24h: 1 });
  assert.deepEqual(json.paniers_abandonnes, { nb: 1, montant: 15000 });
});

test("canaux : attribution ?c= et « direct »", async () => {
  const { json } = await get("/stats", admin);
  const fb = json.canaux.find((c) => c.canal === "fb");
  const direct = json.canaux.find((c) => c.canal === "direct");
  assert.deepEqual([fb.inscrits, fb.payeurs, fb.taux, fb.valide], [1, 1, 100, 5000]);
  assert.deepEqual([direct.inscrits, direct.payeurs], [3, 1]);
});

test("période invalide → 30 jours ; série journalière présente", async () => {
  const { json } = await get("/stats?jours=999", admin);
  assert.equal(json.periode_jours, 30);
  assert.equal(json.par_jour[0].inscrits, 4);
  assert.equal(json.par_jour[0].valide, 5000);
});
