// routes/contacts.routes.js — Messagerie interne acheteur → propriétaire
// Envoi sans compte requis (visiteur), lecture réservée au propriétaire connecté.

const express = require("express");
const db = require("../db");
const { authRequis } = require("../middleware/auth");

const router = express.Router();

// POST /api/contacts/:bien_id — envoyer un message à propos d'une annonce (sans compte)
router.post("/:bien_id", (req, res) => {
  const bienId = Number(req.params.bien_id);
  const bien = db.prepare("SELECT * FROM biens WHERE id = ? AND statut = 'publie'").get(bienId);
  if (!bien) return res.status(404).json({ erreur: "Annonce introuvable." });

  const { nom, email, telephone, message } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ erreur: "Votre nom est requis." });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erreur: "Adresse e-mail invalide." });
  if (!message || message.trim().length < 10)
    return res.status(400).json({ erreur: "Le message doit faire au moins 10 caractères." });

  db.prepare(
    `INSERT INTO contacts (bien_id, nom, email, telephone, message)
     VALUES (?, ?, ?, ?, ?)`
  ).run(bienId, nom.trim(), email.trim().toLowerCase(), (telephone || "").trim() || null, message.trim());

  res.status(201).json({ message: "Votre message a bien été envoyé. Le propriétaire vous contactera directement." });
});

// GET /api/contacts/moi — boîte de réception du propriétaire connecté
// Retourne tous les messages liés à ses annonces, du plus récent au plus ancien.
router.get("/moi", authRequis, (req, res) => {
  const messages = db
    .prepare(
      `SELECT c.*, b.titre AS bien_titre, b.ville AS bien_ville
       FROM contacts c
       JOIN biens b ON b.id = c.bien_id
       WHERE b.user_id = ?
       ORDER BY c.cree_le DESC`
    )
    .all(req.user.id);

  res.json(messages);
});

// PATCH /api/contacts/:id/lu — marquer un message comme lu
router.patch("/:id/lu", authRequis, (req, res) => {
  const msg = db
    .prepare(
      `SELECT c.id FROM contacts c
       JOIN biens b ON b.id = c.bien_id
       WHERE c.id = ? AND b.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);

  if (!msg) return res.status(404).json({ erreur: "Message introuvable." });

  db.prepare("UPDATE contacts SET lu = 1 WHERE id = ?").run(msg.id);
  res.json({ ok: true });
});

// DELETE /api/contacts/:id — supprimer un message (propriétaire uniquement)
router.delete("/:id", authRequis, (req, res) => {
  const msg = db
    .prepare(
      `SELECT c.id FROM contacts c
       JOIN biens b ON b.id = c.bien_id
       WHERE c.id = ? AND b.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);

  if (!msg) return res.status(404).json({ erreur: "Message introuvable." });

  db.prepare("DELETE FROM contacts WHERE id = ?").run(msg.id);
  res.json({ ok: true });
});

module.exports = router;
