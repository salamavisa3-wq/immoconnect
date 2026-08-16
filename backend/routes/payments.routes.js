// routes/payments.routes.js — Paiement des formules d'abonnement propriétaire
// (5 000 / 10 000 / 15 000 FCFA pour 5 / 10 / 15 annonces) et de la mise en
// avant (2000 FCFA / 7 jours) par QR : Wave ou Orange Money.
// C'est l'UNIQUE méthode de paiement — aucun agrégateur externe, aucune IPN.
//
// Flux :
//  1. POST /api/payments/initier { forfait: 0|1|2 } (ou /initier-mise-en-avant/:bien_id)
//     crée un enregistrement "paiements" (statut 'initie') et renvoie l'URL
//     /paiement-qr.html?reference=...
//  2. Le client scanne le QR Wave ou Orange Money (montant exact, référence dans
//     le motif) puis déclare son ID de transaction
//     (POST /api/payments/qr/:reference/declarer) → statut 'en_verification'
//  3. Un administrateur vérifie la réception des fonds dans admin.html puis
//     valide (confirmerPaiement) → quota d'annonces accordé / bien mis en avant 7 jours.

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { FORFAITS } = require("../forfaits");
const { authRequis, adminRequis } = require("../middleware/auth");
const { envoyerEmailAdmin, echapper } = require("../mail");
const paypal = require("../paypal");

const router = express.Router();

const MONTANT_MISE_EN_AVANT  = Number(process.env.FRAIS_MISE_EN_AVANT_FCFA  || 2000);

// PayPal est disponible seulement si les clés API sont renseignées (sandbox ou live).
const paypalConfigure = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

// Paiement par QR : unique méthode de paiement. Aucune confirmation automatique
// n'est possible (un QR statique ne porte ni montant ni référence de commande),
// d'où la déclaration de transaction puis la validation par un administrateur.
const QR_PAIEMENT = {
  // Libellé commercial affiché sur le site.
  beneficiaire: "SakeurImmo",
  // Nom réel du compte marchand : c'est lui que l'application du payeur affichera
  // au moment de confirmer. L'annoncer évite l'abandon au dernier écran.
  compte_marchand: "SALAMA RAHMA VOYAGES",
  wave: {
    lien: "https://pay.wave.com/mqr/rat_7kWe",
    image: "/images/qr-wave.svg",
  },
  orange_money: {
    code_marchand: "562827",
    ussd: "#144#5*562827*{montant}*code secret#",
    image: "/images/qr-orange-money.svg",
  },
};

// GET /api/payments/forfaits — liste des formules d'abonnement (public, page d'inscription)
router.get("/forfaits", (req, res) => {
  res.json({ forfaits: FORFAITS });
});

// GET /api/payments/config — moyens de paiement disponibles (public, page d'inscription).
// Le frontend masque le choix PayPal si les clés ne sont pas configurées.
router.get("/config", (req, res) => {
  res.json({ paypal: paypalConfigure() });
});

// Démarre un paiement PayPal : crée une ligne 'initie' fraîche (jamais de réutilisation —
// un ordre PayPal est lié à un montant précis) puis une commande PayPal, et stocke
// l'order_id dans provider_ref pour vérifier la propriété à la capture.
async function initierPayPal({ userId, bienId, reference, montant, type, description }) {
  await db.run(
    `INSERT INTO paiements (user_id, bien_id, reference, montant, type, statut)
     VALUES (?, ?, ?, ?, ?, 'initie')`,
    [userId, bienId, reference, montant, type]
  );
  const p = await paypal.createPayment({ reference, montant, description });
  await db.run("UPDATE paiements SET provider_ref = ? WHERE reference = ?", [p.order_id, reference]);
  return { mode: "paypal", reference, montant, redirect_url: p.redirect_url, order_id: p.order_id };
}

// POST /api/payments/initier — démarre le paiement d'un forfait (inscription ou ajout de places)
router.post("/initier", authRequis, async (req, res) => {
  const forfait = FORFAITS[Number(req.body.forfait)];
  if (!forfait) {
    return res.status(400).json({ erreur: "Choisissez un forfait (5 000, 10 000 ou 15 000 FCFA)." });
  }

  const moyen = req.body.moyen === "paypal" ? "paypal" : "qr";

  // PayPal : toujours une ligne fraîche (jamais de réutilisation). Un ordre PayPal est
  // lié à un montant précis : réutiliser une ligne 'initie' et re-synchroniser son montant
  // laisserait l'ordre PayPal à l'ancien montant → mauvais crédit de places à la capture.
  if (moyen === "paypal") {
    if (!paypalConfigure()) {
      return res.status(400).json({ erreur: "Le paiement PayPal n'est pas configuré." });
    }
    const reference = `INS-${req.user.id}-${uuidv4().slice(0, 8)}`;
    try {
      const data = await initierPayPal({
        userId: req.user.id,
        bienId: null,
        reference,
        montant: forfait.prix,
        type: "inscription",
        description: `SakeurImmo — forfait ${forfait.annonces} annonces`,
      });
      return res.json({ ...data, annonces: forfait.annonces });
    } catch (e) {
      console.error("Erreur création commande PayPal :", e);
      return res.status(502).json({ erreur: "Le paiement PayPal est momentanément indisponible. Réessayez dans quelques instants." });
    }
  }

  // Réutiliser un paiement déjà initié pour éviter les doublons. Seuls les paiements
  // encore au stade 'initie' ET sans provider_ref (donc jamais PayPal) sont réutilisables :
  // un paiement 'en_verification' a déjà été payé/déclaré pour son propre montant — un
  // achat de places supplémentaire doit créer une nouvelle référence (sinon le crédit
  // utiliserait le mauvais montant).
  const existant = await db.get(
    "SELECT * FROM paiements WHERE user_id = ? AND type = 'inscription' AND statut = 'initie' AND provider_ref IS NULL ORDER BY id DESC LIMIT 1",
    [req.user.id]
  );

  const reference = existant ? existant.reference : `INS-${req.user.id}-${uuidv4().slice(0, 8)}`;

  if (!existant) {
    await db.run(
      `INSERT INTO paiements (user_id, reference, montant, type, statut)
       VALUES (?, ?, ?, 'inscription', 'initie')`,
      [req.user.id, reference, forfait.prix]
    );
  } else if (Number(existant.montant) !== forfait.prix) {
    // Le forfait choisi a changé entre deux initiations : re-synchroniser le montant.
    await db.run("UPDATE paiements SET montant = ? WHERE reference = ?", [forfait.prix, reference]);
  }

  // Paiement par QR : Wave / Orange Money, circuit manuel.
  res.json({
    mode: "qr",
    reference,
    montant: forfait.prix,
    annonces: forfait.annonces,
    url_paiement: `/paiement-qr.html?reference=${encodeURIComponent(reference)}`,
  });
});

// Crédite les places d'un paiement d'inscription (activation du compte + quota) une
// seule fois, grâce au flag places_creditees. Depuis l'activation instantanée, ce
// crédit est fait dès la déclaration ; la validation admin ne le répète donc jamais.
async function crediterInscription(paiement) {
  if (paiement.places_creditees) return;
  // Le montant du paiement détermine le forfait → nombre de places accordées.
  // Le "+" couvre à la fois la 1ʳᵉ activation (0 + N) et l'ajout de places (upgrade).
  const forfait = FORFAITS.find((f) => f.prix === Number(paiement.montant));
  const places = forfait ? forfait.annonces : 0;
  await db.run(
    "UPDATE users SET statut_compte = 'actif', quota_annonces = quota_annonces + ? WHERE id = ?",
    [places, paiement.user_id]
  );
  await db.run("UPDATE paiements SET places_creditees = 1 WHERE reference = ?", [paiement.reference]);
}

async function confirmerPaiement(reference, moyenPaiement) {
  const paiement = await db.get("SELECT * FROM paiements WHERE reference = ?", [reference]);
  if (!paiement || paiement.statut === "reussi") return;

  await db.run(
    "UPDATE paiements SET statut = 'reussi', moyen_paiement = ?, confirme_le = datetime('now') WHERE reference = ?",
    [moyenPaiement, reference]
  );

  if (paiement.type === "inscription") {
    // Ne crédite que si la déclaration ne l'a pas déjà fait (idempotent).
    await crediterInscription(paiement);
  } else if (paiement.type === "mise_en_avant" && paiement.bien_id) {
    await db.run(
      "UPDATE biens SET mise_en_avant = 1, mise_en_avant_jusqu_au = datetime('now', '+7 days') WHERE id = ?",
      [paiement.bien_id]
    );
  }
}

// POST /api/payments/initier-mise-en-avant/:bien_id — démarre le paiement de mise en avant (2000 FCFA / 7 jours)
router.post("/initier-mise-en-avant/:bien_id", authRequis, async (req, res) => {
  const bienId = Number(req.params.bien_id);

  const bien = await db.get("SELECT * FROM biens WHERE id = ? AND user_id = ?", [bienId, req.user.id]);
  if (!bien) return res.status(404).json({ erreur: "Annonce introuvable." });
  if (bien.statut !== "publie") {
    return res.status(400).json({ erreur: "Seules les annonces publiées peuvent être mises en avant." });
  }

  const dejaActif =
    bien.mise_en_avant === 1 &&
    bien.mise_en_avant_jusqu_au &&
    new Date(bien.mise_en_avant_jusqu_au) > new Date();
  if (dejaActif) {
    const dateExpiry = new Date(bien.mise_en_avant_jusqu_au).toLocaleDateString("fr-FR");
    return res.status(400).json({ erreur: `Ce bien est déjà mis en avant jusqu'au ${dateExpiry}.` });
  }

  const reference = `MEA-${bienId}-${uuidv4().slice(0, 8)}`;

  // PayPal : même helper que pour les forfaits (le frontend reste en QR pour la mise en
  // avant, mais l'API est prête). QR : comportement historique.
  if (req.body.moyen === "paypal") {
    if (!paypalConfigure()) {
      return res.status(400).json({ erreur: "Le paiement PayPal n'est pas configuré." });
    }
    try {
      const data = await initierPayPal({
        userId: req.user.id,
        bienId,
        reference,
        montant: MONTANT_MISE_EN_AVANT,
        type: "mise_en_avant",
        description: `SakeurImmo — mise en avant de l'annonce #${bienId} (7 jours)`,
      });
      return res.json(data);
    } catch (e) {
      console.error("Erreur création commande PayPal (mise en avant) :", e);
      return res.status(502).json({ erreur: "Le paiement PayPal est momentanément indisponible. Réessayez dans quelques instants." });
    }
  }

  await db.run(
    `INSERT INTO paiements (user_id, bien_id, reference, montant, type, statut)
     VALUES (?, ?, ?, ?, 'mise_en_avant', 'initie')`,
    [req.user.id, bienId, reference, MONTANT_MISE_EN_AVANT]
  );

  // Paiement par QR : Wave / Orange Money, circuit manuel.
  res.json({
    mode: "qr",
    reference,
    montant: MONTANT_MISE_EN_AVANT,
    url_paiement: `/paiement-qr.html?reference=${encodeURIComponent(reference)}`,
  });
});

// POST /api/payments/paypal-capture — confirme un paiement PayPal au retour de la page
// /paiement-paypal.html. PayPal est l'autorité : la capture réussie = fonds reçus, le
// paiement passe directement à 'reussi' (aucune vérification admin, contrairement au QR).
router.post("/paypal-capture", authRequis, async (req, res) => {
  const orderId = String(req.body.order_id || "").trim();
  if (!orderId) return res.status(400).json({ erreur: "order_id manquant." });

  // Fast-path : déjà confirmé (refresh de la page de retour) — on ne rappelle pas PayPal.
  let paiement = await db.get(
    "SELECT * FROM paiements WHERE provider_ref = ? ORDER BY id DESC LIMIT 1",
    [orderId]
  );
  if (paiement && paiement.statut === "reussi") {
    return res.json({ statut: "reussi", reference: paiement.reference, type: paiement.type });
  }

  let cap;
  try {
    cap = await paypal.capture({ order_id: orderId });
  } catch (e) {
    console.error("Erreur capture PayPal :", e);
    return res.status(502).json({ erreur: "Le paiement PayPal est momentanément indisponible. Réessayez dans quelques instants." });
  }
  if (!cap.paid) {
    return res.status(400).json({ erreur: "Le paiement PayPal n'est pas confirmé." });
  }

  // Lier la commande capturée à notre paiement via le reference_id passé à la création.
  if (!paiement) {
    paiement = await db.get("SELECT * FROM paiements WHERE reference = ?", [cap.reference]);
  }
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });
  if (paiement.user_id !== req.user.id) {
    return res.status(403).json({ erreur: "Ce paiement ne vous appartient pas." });
  }
  if (paiement.provider_ref !== orderId) {
    return res.status(400).json({ erreur: "Commande PayPal inconnue pour ce paiement." });
  }

  // confirmerPaiement est idempotent ; crediterInscription ne crédite qu'une fois
  // (places_creditees). Les paiements PayPal n'apparaissent jamais dans la file admin.
  await confirmerPaiement(paiement.reference, "paypal");
  res.json({ statut: "reussi", reference: paiement.reference, type: paiement.type });
});

// --- Paiement par QR (Wave / Orange Money) ---

// GET /api/payments/qr/:reference — données à afficher sur la page de paiement par QR
router.get("/qr/:reference", authRequis, async (req, res) => {
  const paiement = await db.get(
    "SELECT * FROM paiements WHERE reference = ? AND user_id = ?",
    [req.params.reference, req.user.id]
  );
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });

  res.json({
    reference: paiement.reference,
    montant: paiement.montant,
    statut: paiement.statut,
    transaction_id: paiement.transaction_id,
    qr: {
      ...QR_PAIEMENT,
      orange_money: {
        ...QR_PAIEMENT.orange_money,
        ussd: QR_PAIEMENT.orange_money.ussd.replace("{montant}", paiement.montant),
      },
    },
  });
});

// POST /api/payments/qr/:reference/declarer — le payeur déclare son ID de transaction.
// Aucun droit n'est accordé ici : le paiement passe en attente de vérification humaine.
router.post("/qr/:reference/declarer", authRequis, async (req, res) => {
  const transactionId = String(req.body.transaction_id || "").trim();
  const moyen = req.body.moyen === "orange_money" ? "orange_money_qr" : "wave_qr";

  if (transactionId.length < 4 || transactionId.length > 64) {
    return res.status(400).json({ erreur: "Indiquez l'identifiant de transaction reçu par SMS (4 à 64 caractères)." });
  }

  const paiement = await db.get(
    "SELECT * FROM paiements WHERE reference = ? AND user_id = ?",
    [req.params.reference, req.user.id]
  );
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });
  if (paiement.statut === "reussi") {
    return res.status(400).json({ erreur: "Ce paiement est déjà confirmé." });
  }

  await db.run(
    "UPDATE paiements SET statut = 'en_verification', moyen_paiement = ?, transaction_id = ?, declare_le = datetime('now') WHERE reference = ?",
    [moyen, transactionId, paiement.reference]
  );

  // Notification best-effort : volontairement pas attendue, et toute erreur est
  // absorbée par envoyerEmailAdmin — la déclaration reste valide sans e-mail.
  notifierDeclaration(req.user, paiement, moyen, transactionId);

  // Activation instantanée : le compte devient actif et les places sont créditées
  // dès la déclaration (paiement d'inscription uniquement). Le paiement reste en
  // 'en_verification' pour l'audit admin, qui peut le rejeter et révoquer les places.
  let compteActive = false;
  if (paiement.type === "inscription") {
    await crediterInscription(paiement);
    compteActive = true;
  }

  res.json({
    statut: "en_verification",
    message: compteActive
      ? "Paiement déclaré : votre compte est activé et vos places sont créditées immédiatement. L'équipe vérifie la transaction."
      : "Paiement déclaré. Nous vérifions la transaction.",
  });
});

function notifierDeclaration(user, paiement, moyen, transactionId) {
  const operateur = moyen === "orange_money_qr" ? "Orange Money" : "Wave";
  const forfait = FORFAITS.find((f) => f.prix === Number(paiement.montant));
  const objet = paiement.type === "inscription"
    ? `Inscription — ${forfait ? `${forfait.annonces} annonces (${forfait.prix} FCFA)` : `${paiement.montant} FCFA`}`
    : `Mise en avant (annonce #${paiement.bien_id})`;

  envoyerEmailAdmin({
    sujet: `Paiement à vérifier — ${paiement.montant} FCFA · ${paiement.reference}`,
    html: `
      <h2>Nouveau paiement par QR à vérifier</h2>
      <p>Vérifiez la réception des fonds sur le compte <strong>${echapper(operateur)}</strong>
         avant de valider dans l'espace d'administration.</p>
      <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;">
        <tr><td><strong>Montant</strong></td><td>${echapper(paiement.montant)} FCFA</td></tr>
        <tr><td><strong>Objet</strong></td><td>${echapper(objet)}</td></tr>
        <tr><td><strong>Référence</strong></td><td><code>${echapper(paiement.reference)}</code></td></tr>
        <tr><td><strong>Opérateur</strong></td><td>${echapper(operateur)}</td></tr>
        <tr><td><strong>ID de transaction</strong></td><td><code>${echapper(transactionId)}</code></td></tr>
        <tr><td><strong>Propriétaire</strong></td><td>${echapper(user.nom_complet)}</td></tr>
        <tr><td><strong>Contact</strong></td><td>${echapper(user.email)} · ${echapper(user.telephone)}</td></tr>
      </table>
      <p><a href="${process.env.FRONTEND_URL || "https://sakeurimmo.com"}/admin.html">Ouvrir l'espace d'administration</a></p>
    `,
  });
}

// GET /api/payments/admin/diagnostic-mail — état de la configuration e-mail et
// envoi d'un message de test. Permet de voir la cause exacte d'un échec depuis
// l'interface, sans accès aux logs de l'hébergeur. La clé n'est jamais exposée.
router.get("/admin/diagnostic-mail", authRequis, adminRequis, async (req, res) => {
  const envoi = await envoyerEmailAdmin({
    sujet: "Test d'envoi — SakeurImmo",
    html: `<p>Ceci est un message de test envoyé depuis l'espace d'administration de SakeurImmo.</p>
           <p>Si vous le recevez, les notifications de paiement par QR fonctionnent.</p>`,
  });

  res.json({
    brevo_api_key_definie: Boolean(process.env.BREVO_API_KEY),
    admin_email: process.env.ADMIN_EMAIL || null,
    mail_expediteur: process.env.MAIL_EXPEDITEUR || process.env.ADMIN_EMAIL || null,
    envoi,
  });
});

// GET /api/payments/admin/a-verifier — file d'attente des paiements QR déclarés
router.get("/admin/a-verifier", authRequis, adminRequis, async (req, res) => {
  const paiements = await db.all(
    `SELECT p.*, u.nom_complet, u.email, u.telephone, b.titre AS bien_titre
       FROM paiements p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN biens b ON b.id = p.bien_id
      WHERE p.statut = 'en_verification'
      ORDER BY p.declare_le ASC`
  );
  res.json(paiements);
});

// POST /api/payments/admin/:reference/valider — l'admin confirme avoir reçu les fonds
router.post("/admin/:reference/valider", authRequis, adminRequis, async (req, res) => {
  const paiement = await db.get("SELECT * FROM paiements WHERE reference = ?", [req.params.reference]);
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });
  if (paiement.statut !== "en_verification") {
    return res.status(400).json({ erreur: "Seul un paiement en attente de vérification peut être validé." });
  }

  await confirmerPaiement(paiement.reference, paiement.moyen_paiement || "qr");
  res.json({ statut: "reussi", reference: paiement.reference });
});

// POST /api/payments/admin/:reference/rejeter — fonds non retrouvés
router.post("/admin/:reference/rejeter", authRequis, adminRequis, async (req, res) => {
  const paiement = await db.get("SELECT * FROM paiements WHERE reference = ?", [req.params.reference]);
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });
  if (paiement.statut !== "en_verification") {
    return res.status(400).json({ erreur: "Seul un paiement en attente de vérification peut être rejeté." });
  }

  await db.run("UPDATE paiements SET statut = 'echoue' WHERE reference = ?", [paiement.reference]);

  // Fausse déclaration : révoquer les places déjà créditées à l'activation instantanée.
  if (paiement.type === "inscription" && paiement.places_creditees) {
    const forfait = FORFAITS.find((f) => f.prix === Number(paiement.montant));
    const places = forfait ? forfait.annonces : 0;
    const utilisateur = await db.get("SELECT quota_annonces, statut_compte FROM users WHERE id = ?", [paiement.user_id]);
    if (utilisateur) {
      const quota = Math.max(0, (utilisateur.quota_annonces || 0) - places);
      const statut = quota === 0 ? "en_attente_paiement" : utilisateur.statut_compte;
      await db.run("UPDATE users SET quota_annonces = ?, statut_compte = ? WHERE id = ?", [quota, statut, paiement.user_id]);
    }
  }

  res.json({ statut: "echoue", reference: paiement.reference });
});

module.exports = router;
