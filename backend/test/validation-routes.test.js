// Tests d'intégration (node --test) : l'inscription et les annonces refusent les valeurs piégées (audit 2026-11-05).
// Base SQLite temporaire, routeurs montés dans une mini-app Express (même principe que forfaits.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

const fichierDb = path.join(os.tmpdir(), `sakeurimmo-validation-${process.pid}.db`);
process.env.TURSO_DATABASE_URL = `file:${fichierDb}`;
process.env.JWT_SECRET = "test-secret";

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const authRoutes = require("../routes/auth.routes");
const biensRoutes = require("../routes/biens.routes");

let serveur, base;
async function appel(chemin, { methode = "GET", corps, user } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (user) headers.Authorization = `Bearer ${jwt.sign({ id: user }, process.env.JWT_SECRET)}`;
  const r = await fetch(base + chemin, { method: methode, headers, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

test.before(async () => {
  await db.pretASync;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/biens", biensRoutes);
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}/api`;
});

test.after(() => {
  serveur.close();
  for (const f of [fichierDb, `${fichierDb}-wal`, `${fichierDb}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
});

const INSCRIPTION = { nom_complet: "Awa Diop", email: "awa@test.sn", telephone: "+221 77 123 45 67", ville: "Thiès", mot_de_passe: "secret1" };

test("inscription : e-mail, nom et téléphone piégés refusés, inscription normale acceptée", async () => {
  for (const mauvais of [
    { email: "<img src=x onerror=alert(1)>@x.sn" },
    { nom_complet: "a".repeat(101) },
    { telephone: "<script>alert(1)</script>" },
    { nom_complet: { x: 1 } },
  ]) {
    const r = await appel("/auth/register", { methode: "POST", corps: { ...INSCRIPTION, ...mauvais } });
    assert.equal(r.status, 400, JSON.stringify(mauvais));
  }
  const ok = await appel("/auth/register", { methode: "POST", corps: INSCRIPTION });
  assert.equal(ok.status, 201);
});

async function proprietaireActif() {
  const r = await db.run(
    "INSERT INTO users (nom_complet, email, telephone, mot_de_passe, statut_compte, quota_annonces) VALUES ('P', ?, '770000000', 'x', 'actif', 5)",
    [`p${Date.now()}${Math.random()}@test.sn`]
  );
  return r.lastInsertRowid;
}

const ANNONCE = { titre: "Terrain 2 ha", type_bien: "terrain", transaction_type: "vente", ville: "Thiès", prix: "15000000", superficie: "20000" };

test("annonce : création valide, puis valeurs piégées refusées (POST et PUT)", async () => {
  const user = await proprietaireActif();
  const cree = await appel("/biens", { methode: "POST", user, corps: ANNONCE });
  assert.equal(cree.status, 201);
  assert.equal(cree.json.bien.superficie, 20000);
  assert.equal(cree.json.bien.prix, 15000000);
  const id = cree.json.bien.id;

  const piege = '<img src=x onerror="alert(1)">';
  const postPiege = await appel("/biens", { methode: "POST", user, corps: { ...ANNONCE, superficie: piege } });
  assert.equal(postPiege.status, 400);

  for (const champ of ["superficie", "chambres", "salles_bain", "prix"]) {
    const r = await appel(`/biens/${id}`, { methode: "PUT", user, corps: { [champ]: piege } });
    assert.equal(r.status, 400, champ);
  }
  assert.equal((await appel(`/biens/${id}`, { methode: "PUT", user, corps: { titre: "x".repeat(151) } })).status, 400);

  const apres = await db.get("SELECT titre, superficie FROM biens WHERE id = ?", [id]);
  assert.equal(apres.superficie, 20000); // la valeur n'a pas été écrasée par une tentative refusée
  assert.equal(apres.titre, "Terrain 2 ha");

  const modif = await appel(`/biens/${id}`, { methode: "PUT", user, corps: { prix: "16000000", description: "Beau terrain" } });
  assert.equal(modif.status, 200);
  const final = await db.get("SELECT prix, description, statut FROM biens WHERE id = ?", [id]);
  assert.equal(final.prix, 16000000);
  assert.equal(final.description, "Beau terrain");
  assert.equal(final.statut, "en_attente"); // toute modification repasse en modération (comportement conservé)
});
