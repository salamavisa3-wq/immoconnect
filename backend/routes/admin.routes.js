// routes/admin.routes.js — Chiffres de pilotage (admin uniquement).
const express = require("express");
const { authRequis, adminRequis } = require("../middleware/auth");
const { calculerStats } = require("../stats");

const router = express.Router();

// GET /api/admin/stats?jours=7|30|90 — inscriptions, entonnoir de paiement, revenus, canaux
router.get("/stats", authRequis, adminRequis, async (req, res) => {
  try {
    res.json(await calculerStats(Number(req.query.jours) || 30));
  } catch (e) {
    console.error("Erreur calcul des statistiques :", e);
    res.status(500).json({ erreur: "Impossible de calculer les statistiques." });
  }
});

module.exports = router;
