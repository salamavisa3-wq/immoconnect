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
    let user = await db.get("SELECT * FROM users WHERE id = ?", [payload.id]);
    if (!user) return res.status(401).json({ erreur: "Utilisateur introuvable." });
    // Abonnement Agence échu : retirer ses places (les annonces déjà en ligne restent,
    // seules les nouvelles publications sont bloquées au-delà du quota restant).
    if (user.abonnement_annonces > 0 && user.abonnement_jusqu_au && user.abonnement_jusqu_au <= new Date().toISOString().slice(0, 19).replace("T", " ")) {
      await db.run(
        "UPDATE users SET quota_annonces = MAX(0, quota_annonces - abonnement_annonces), abonnement_annonces = 0 WHERE id = ? AND abonnement_annonces > 0",
        [user.id]
      );
      user = await db.get("SELECT * FROM users WHERE id = ?", [user.id]);
    }
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
