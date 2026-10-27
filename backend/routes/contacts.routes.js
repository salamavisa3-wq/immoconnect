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

// Numéro joignable pour une annonce : téléphone de l'annonceur, sauf annonces publiées par
// un compte admin (import/publication SakeurImmo) → toujours le numéro de la plateforme.
// Le numéro n'est jamais exposé par l'API publique : seuls ces redirects le contiennent.
const NUMERO_ADMIN = "221771437125";
function numeroContact(row) {
  if (row.role === "admin") return NUMERO_ADMIN;
  let d = String(row.telephone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = "221" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// GET /api/contacts/direct/:bien_id/:canal — redirige vers WhatsApp ou l'appli SMS, message prérempli
router.get("/direct/:bien_id/:canal", async (req, res) => {
  const { canal } = req.params;
  if (canal !== "whatsapp" && canal !== "sms") return res.status(404).send("Introuvable.");
  const bien = await db.get(
    `SELECT b.id, b.titre, u.telephone, u.role FROM biens b JOIN users u ON u.id = b.user_id
     WHERE b.id = ? AND b.statut = 'publie'`,
    [Number(req.params.bien_id)]
  );
  const numero = bien && numeroContact(bien);
  if (!numero) return res.status(404).send("Contact indisponible pour cette annonce.");

  const texte = `Bonjour, je suis intéressé(e) par votre annonce « ${bien.titre} » (RÉF. TF-${String(bien.id).padStart(6, "0")}) sur SakeurImmo : https://sakeurimmo.com/annonce.html?id=${bien.id}`;
  res.set("X-Robots-Tag", "noindex, nofollow");
  if (canal === "whatsapp") return res.redirect(302, `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`);

  // Le schéma sms: n'est pas toujours suivi par un redirect 302 : petite page qui l'ouvre.
  const lien = `sms:+${numero}?body=${encodeURIComponent(texte)}`;
  res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Envoyer un SMS</title><p style="font-family:sans-serif;padding:24px;">Ouverture de votre application SMS… <a href="${lien}">Cliquez ici si rien ne se passe</a>.</p><script>location.href=${JSON.stringify(lien)};</script>`);
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
