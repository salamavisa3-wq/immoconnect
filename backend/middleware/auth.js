// middleware/auth.js — Vérifie le token JWT et protège les routes.

const jwt = require("jsonwebtoken");
const db = require("../db");

async function authRequis(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erreur: "Authentification requise." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.get("SELECT * FROM users WHERE id = ?", [payload.id]);
    if (!user) return res.status(401).json({ erreur: "Utilisateur introuvable." });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ erreur: "Token invalide ou expiré." });
  }
}

function compteActifRequis(req, res, next) {
  if (req.user.statut_compte !== "actif") {
    return res.status(403).json({
      erreur: "Votre compte n'est pas encore actif. Choisissez un forfait (5 000, 10 000 ou 15 000 FCFA) pour activer votre compte et publier vos annonces.",
    });
  }
  next();
}

function adminRequis(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ erreur: "Accès réservé aux administrateurs." });
  }
  next();
}

module.exports = { authRequis, compteActifRequis, adminRequis };
