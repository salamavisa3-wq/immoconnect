// db.js — Connexion libSQL (compatible SQLite) + création du schéma au démarrage.
// En local / dev : fichier local sakeurimmo.db (aucune configuration requise).
// En production : pointez TURSO_DATABASE_URL / TURSO_AUTH_TOKEN vers une base
// Turso pour une persistance réelle sur les hébergeurs Node à disque éphémère
// (Render, Railway, Fly.io...). Voir README pour la procédure.

const { createClient } = require("@libsql/client");
const path = require("path");

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${path.join(__dirname, "sakeurimmo.db")}` }
);

async function exec(sql) {
  await client.executeMultiple(sql);
}

async function run(sql, params = []) {
  const res = await client.execute({ sql, args: params });
  return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
}

async function get(sql, params = []) {
  const res = await client.execute({ sql, args: params });
  return res.rows[0];
}

async function all(sql, params = []) {
  const res = await client.execute({ sql, args: params });
  return res.rows;
}

async function initialiser() {
  await exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nom_complet   TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  telephone     TEXT NOT NULL,
  ville         TEXT,
  mot_de_passe  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'proprietaire', -- proprietaire | admin
  statut_compte TEXT NOT NULL DEFAULT 'en_attente_paiement', -- en_attente_paiement | actif | suspendu
  quota_annonces INTEGER NOT NULL DEFAULT 0, -- nombre d'annonces actives payées (forfaits 5/10/15)
  cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paiements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bien_id         INTEGER REFERENCES biens(id) ON DELETE SET NULL, -- rempli pour type=mise_en_avant
  reference       TEXT UNIQUE NOT NULL,
  montant         INTEGER NOT NULL,
  type            TEXT NOT NULL DEFAULT 'inscription', -- inscription | mise_en_avant
  statut          TEXT NOT NULL DEFAULT 'initie', -- initie | en_verification | reussi | echoue
  moyen_paiement  TEXT,
  transaction_id  TEXT, -- identifiant Wave / Orange Money déclaré lors d'un paiement par QR
  cree_le         TEXT NOT NULL DEFAULT (datetime('now')),
  declare_le      TEXT, -- horodatage de la déclaration de paiement par QR
  confirme_le     TEXT
);

CREATE TABLE IF NOT EXISTS biens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titre         TEXT NOT NULL,
  type_bien     TEXT NOT NULL, -- terrain | appartement_vente | appartement_location | appartement_meuble | maison_vente | maison_location | villa_vente | villa_location
  transaction_type TEXT NOT NULL, -- vente | location
  ville         TEXT NOT NULL,
  quartier      TEXT,
  prix          INTEGER NOT NULL,
  superficie    REAL,
  chambres      INTEGER,
  salles_bain   INTEGER,
  description   TEXT,
  images        TEXT DEFAULT '[]', -- JSON: liste d'URLs d'images (Cloudinary en prod)
  statut        TEXT NOT NULL DEFAULT 'en_attente', -- en_attente | publie | refuse | archive
  mise_en_avant          INTEGER NOT NULL DEFAULT 0,
  mise_en_avant_jusqu_au TEXT,  -- datetime ISO ; NULL = pas d'expiration connue
  vues                   INTEGER NOT NULL DEFAULT 0,
  cree_le                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_biens_statut ON biens(statut);
CREATE INDEX IF NOT EXISTS idx_biens_type ON biens(type_bien);
CREATE INDEX IF NOT EXISTS idx_biens_ville ON biens(ville);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bien_id    INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
  nom        TEXT NOT NULL,
  email      TEXT NOT NULL,
  telephone  TEXT,
  message    TEXT NOT NULL,
  lu         INTEGER NOT NULL DEFAULT 0,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_bien ON contacts(bien_id);
`);

  // Migrations incrémentales pour les bases déjà existantes
  try { await exec("ALTER TABLE paiements ADD COLUMN bien_id INTEGER REFERENCES biens(id) ON DELETE SET NULL;"); } catch (_) {}
  try { await exec("ALTER TABLE biens ADD COLUMN mise_en_avant_jusqu_au TEXT;"); } catch (_) {}
  try { await exec("ALTER TABLE paiements ADD COLUMN transaction_id TEXT;"); } catch (_) {}
  try { await exec("ALTER TABLE paiements ADD COLUMN declare_le TEXT;"); } catch (_) {}
  try { await exec("ALTER TABLE paiements ADD COLUMN places_creditees INTEGER NOT NULL DEFAULT 0;"); } catch (_) {}
  try { await exec("ALTER TABLE users ADD COLUMN quota_annonces INTEGER NOT NULL DEFAULT 0;"); } catch (_) {}
  // Grand-fathering : les anciens comptes actifs (modèle "illimité") gardent le plafond
  // maximum au lieu d'être bloqués à 0 place après la migration. Idempotent.
  try { await exec("UPDATE users SET quota_annonces = 15 WHERE statut_compte = 'actif' AND quota_annonces = 0;"); } catch (_) {}
}

const pretASync = initialiser();

module.exports = { get, all, run, exec, pretASync };
