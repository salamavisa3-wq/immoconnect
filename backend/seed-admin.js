// seed-admin.js — Crée (ou réinitialise) un compte administrateur pour la modération.
// Usage : node seed-admin.js admin@immoconnect.sn MonMotDePasse123

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const [, , email, motDePasse] = process.argv;

if (!email || !motDePasse) {
  console.log("Usage : node seed-admin.js <email> <mot_de_passe>");
  process.exit(1);
}

const hash = bcrypt.hashSync(motDePasse, 10);
const existant = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

if (existant) {
  db.prepare("UPDATE users SET mot_de_passe = ?, role = 'admin', statut_compte = 'actif' WHERE email = ?").run(hash, email);
  console.log(`Compte administrateur mis à jour : ${email}`);
} else {
  db.prepare(
    `INSERT INTO users (nom_complet, email, telephone, mot_de_passe, role, statut_compte)
     VALUES ('Administrateur', ?, '000000000', ?, 'admin', 'actif')`
  ).run(email, hash);
  console.log(`Compte administrateur créé : ${email}`);
}
