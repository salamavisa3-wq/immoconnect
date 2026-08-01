// routes/auth.routes.js — Inscription (compte créé "en attente de paiement"),
// connexion, et récupération du profil courant.

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { authRequis } = require("../middleware/auth");

const router = express.Router();

function genererToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function assainirUser(user) {
  const { mot_de_passe, ...reste } = user;
  return reste;
}

// POST /api/auth/register
// Crée le compte propriétaire avec statut "en_attente_paiement".
// Il devra régler les 5000 FCFA (voir /api/payments) avant de pouvoir publier.
router.post("/register", (req, res) => {
  const { nom_complet, email, telephone, ville, mot_de_passe } = req.body;

  if (!nom_complet || !email || !telephone || !mot_de_passe) {
    return res.status(400).json({ erreur: "Tous les champs obligatoires doivent être renseignés." });
  }
  if (mot_de_passe.length < 6) {
    return res.status(400).json({ erreur: "Le mot de passe doit contenir au moins 6 caractères." });
  }

  const existant = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existant) {
    return res.status(409).json({ erreur: "Un compte existe déjà avec cet email." });
  }

  const hash = bcrypt.hashSync(mot_de_passe, 10);

  const info = db
    .prepare(
      `INSERT INTO users (nom_complet, email, telephone, ville, mot_de_passe, statut_compte)
       VALUES (?, ?, ?, ?, ?, 'en_attente_paiement')`
    )
    .run(nom_complet.trim(), email.toLowerCase().trim(), telephone.trim(), ville || null, hash);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = genererToken(user);

  res.status(201).json({
    message: "Compte créé. Réglez les frais d'inscription de 5000 FCFA pour l'activer.",
    token,
    user: assainirUser(user),
    frais_inscription_fcfa: Number(process.env.FRAIS_INSCRIPTION_FCFA || 5000),
  });
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: "Email et mot de passe requis." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(mot_de_passe, user.mot_de_passe)) {
    return res.status(401).json({ erreur: "Identifiants incorrects." });
  }

  const token = genererToken(user);
  res.json({ token, user: assainirUser(user) });
});

// GET /api/auth/moi — profil de l'utilisateur connecté
router.get("/moi", authRequis, (req, res) => {
  res.json({ user: assainirUser(req.user) });
});

module.exports = router;
