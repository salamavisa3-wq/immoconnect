// routes/relances.routes.js — Relances de paiements (admin) + digest quotidien déclenché par cron.
const crypto = require("crypto");
const express = require("express");
const { authRequis, adminRequis } = require("../middleware/auth");
const { paiementsARelancer, marquerRelance } = require("../relances");
const { envoyerEmailAdmin, echapper } = require("../mail");

const router = express.Router();

// GET /api/relances/a-relancer — paiements à relancer, avec message et lien WhatsApp prêts
router.get("/a-relancer", authRequis, adminRequis, async (req, res) => {
  res.json(await paiementsARelancer());
});

// POST /api/relances/:reference/marquer — l'admin vient d'envoyer la relance
router.post("/:reference/marquer", authRequis, adminRequis, async (req, res) => {
  if (!(await marquerRelance(req.params.reference))) {
    return res.status(404).json({ erreur: "Paiement introuvable ou déjà traité." });
  }
  res.json({ ok: true });
});

// Comparaison à temps constant du jeton du cron (GitHub Actions) avec CRON_SECRET.
function cronAutorise(req) {
  const attendu = process.env.CRON_SECRET;
  if (!attendu) return null;
  const recu = (req.headers.authorization || "").replace(/^Bearer /, "");
  const a = crypto.createHash("sha256").update(recu).digest();
  const b = crypto.createHash("sha256").update(attendu).digest();
  return crypto.timingSafeEqual(a, b);
}

const ligneHtml = (l) =>
  `<tr><td>${echapper(l.nom_complet)}</td><td>${echapper(l.montant)} FCFA</td><td><code>${echapper(l.reference)}</code></td>` +
  `<td>${l.whatsapp_url ? `<a href="${echapper(l.whatsapp_url)}">Relancer sur WhatsApp</a>` : "numéro invalide"}</td></tr>`;

// POST /api/relances/cron/digest — e-mail quotidien à l'admin avec les relances du jour.
router.post("/cron/digest", async (req, res) => {
  const autorise = cronAutorise(req);
  if (autorise === null) return res.status(503).json({ erreur: "CRON_SECRET non configuré." });
  if (!autorise) return res.status(401).json({ erreur: "Jeton invalide." });

  const { abandons, a_verifier: aVerifier } = await paiementsARelancer();
  if (abandons.length + aVerifier.length === 0) {
    return res.json({ abandons: 0, a_verifier: 0, email: "rien à envoyer" });
  }
  const tableau = (titre, lignes) => lignes.length === 0 ? "" : `
    <h3>${titre} (${lignes.length})</h3>
    <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;">
      <tr><th>Propriétaire</th><th>Montant</th><th>Référence</th><th>Action</th></tr>
      ${lignes.map(ligneHtml).join("")}
    </table>`;
  const envoi = await envoyerEmailAdmin({
    sujet: `Relances du jour — ${abandons.length} abandon(s), ${aVerifier.length} paiement(s) à rapprocher`,
    html: `
      <h2>Paiements à relancer</h2>
      ${tableau("Paiements lancés mais non terminés", abandons)}
      ${tableau("Paiements déclarés sans validation depuis plus de 24 h", aVerifier)}
      <p>Après envoi, ouvrez <a href="${process.env.FRONTEND_URL || "https://sakeurimmo.com"}/admin.html">l'espace d'administration</a> et cliquez « Relancé » pour éviter les doublons.</p>`,
  });
  res.json({ abandons: abandons.length, a_verifier: aVerifier.length, email: envoi.ok ? "envoyé" : envoi.raison });
});

module.exports = router;
