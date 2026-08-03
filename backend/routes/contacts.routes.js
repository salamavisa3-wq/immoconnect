// routes/contacts.routes.js — Messagerie interne acheteur → propriétaire
// Envoi sans compte requis (visiteur), lecture réservée au propriétaire connecté.

const express = require("express");
const db = require("../db");
const { authRequis } = require("../middleware/auth");

const router = express.Router();

// POST /api/contacts/:bien_id — envoyer un message à propos d'une annonce (sans compte)
router.post("/:bien_id", async (req, res) => {
  const bienId = Number(req.params.bien_id);
  const bien = await db.get("SELECT * FROM biens WHERE id = ? AND statut = 'publie'", [bienId]);
  if (!bien) return res.status(404).json({ erreur: "Annonce introuvable." });

  const { nom, email, telephone, message } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: "Votre nom est requis." });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erreur: "Adresse e-mail invalide." });
  if (!message || message.trim().length < 10)
    return res.status(400).json({ erreur: "Le message doit faire au moins 10 caractères." });

  await db.run(
    `INSERT INTO contacts (bien_id, nom, email, telephone, message)
     VALUES (?, ?, ?, ?, ?)`,
    [bienId, nom.trim(), email.trim().toLowerCase(), (telephone || "").trim() || null, message.trim()]
  );

  res.status(201).json({ message: "Votre message a bien été envoyé. Le propriétaire vous contactera directement." });
});

// GET /api/contacts/moi — boîte de réception du propriétaire connecté
// Retourne tous les messages liés à ses annonces, du plus récent au plus ancien.
router.get("/moi", authRequis, async (req, res) => {
  const messages = await db.all(
    `SELECT c.*, b.titre AS bien_titre, b.ville AS bien_ville
     FROM contacts c
     JOIN biens b ON b.id = c.bien_id
     WHERE b.user_id = ?
     ORDER BY c.cree_le DESC`,
    [req.user.id]
  );

  res.json(messages);
});

// PATCH /api/contacts/:id/lu — marquer un message comme lu
router.patch("/:id/lu", authRequis, async (req, res) => {
  const msg = await db.get(
    `SELECT c.id FROM contacts c
     JOIN biens b ON b.id = c.bien_id
     WHERE c.id = ? AND b.user_id = ?`,
    [Number(req.params.id), req.user.id]
  );

  if (!msg) return res.status(404).json({ erreur: "Message introuvable." });

  await db.run("UPDATE contacts SET lu = 1 WHERE id = ?", [msg.id]);
  res.json({ ok: true });
});

// DELETE /api/contacts/:id — supprimer un message (propriétaire uniquement)
router.delete("/:id", authRequis, async (req, res) => {
  const msg = await db.get(
    `SELECT c.id FROM contacts c
     JOIN biens b ON b.id = c.bien_id
     WHERE c.id = ? AND b.user_id = ?`,
    [Number(req.params.id), req.user.id]
  );

  if (!msg) return res.status(404).json({ erreur: "Message introuvable." });

  await db.run("DELETE FROM contacts WHERE id = ?", [msg.id]);
  res.json({ ok: true });
});

module.exports = router;
