// seed-admin.js — Crée (ou réinitialise) un compte administrateur pour la modération.
// Usage : node seed-admin.js admin@sakeurimmo.sn MonMotDePasse123

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const [, , email, motDePasse] = process.argv;

if (!email || !motDePasse) {
  console.log("Usage : node seed-admin.js <email> <mot_de_passe>");
  process.exit(1);
}

async function main() {
  await db.pretASync;

  const hash = bcrypt.hashSync(motDePasse, 10);
  const existant = await db.get("SELECT id FROM users WHERE email = ?", [email]);

  if (existant) {
    await db.run("UPDATE users SET mot_de_passe = ?, role = 'admin', statut_compte = 'actif' WHERE email = ?", [hash, email]);
    console.log(`Compte administrateur mis à jour : ${email}`);
  } else {
    await db.run(
      `INSERT INTO users (nom_complet, email, telephone, mot_de_passe, role, statut_compte)
       VALUES ('Administrateur', ?, '000000000', ?, 'admin', 'actif')`,
      [email, hash]
    );
    console.log(`Compte administrateur créé : ${email}`);
  }
}

main();
