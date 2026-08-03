// routes/payments.routes.js — Paiement des frais d'inscription (5000 FCFA)
// via PayTech (agrégateur sénégalais), restreint à Orange Money et Wave
// via le paramètre target_payment. Doc officielle : https://paytech.sn/documentation
//
// Flux :
//  1. Le propriétaire (déjà inscrit, statut "en_attente_paiement") appelle POST /api/payments/initier
//  2. On crée un enregistrement "paiements" et on demande une URL de paiement à PayTech
//  3. Le client est redirigé vers cette URL (Orange Money ou Wave uniquement)
//  4. PayTech notifie notre IPN (POST /api/payments/ipn) → on active le compte
//  5. Le frontend peut aussi poller GET /api/payments/statut/:reference en attendant l'IPN

const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { authRequis } = require("../middleware/auth");

const router = express.Router();

const MONTANT_INSCRIPTION    = Number(process.env.FRAIS_INSCRIPTION_FCFA    || 5000);
const MONTANT_MISE_EN_AVANT  = Number(process.env.FRAIS_MISE_EN_AVANT_FCFA  || 2000);

// POST /api/payments/initier — démarre le paiement des frais d'inscription
router.post("/initier", authRequis, async (req, res) => {
  if (req.user.statut_compte === "actif") {
    return res.status(400).json({ erreur: "Votre compte est déjà actif." });
  }

  // Réutiliser un paiement déjà initié pour éviter les doublons
  const existant = await db.get(
    "SELECT * FROM paiements WHERE user_id = ? AND type = 'inscription' AND statut = 'initie' ORDER BY id DESC LIMIT 1",
    [req.user.id]
  );

  const reference = existant ? existant.reference : `INS-${req.user.id}-${uuidv4().slice(0, 8)}`;

  if (!existant) {
    await db.run(
      `INSERT INTO paiements (user_id, reference, montant, type, statut)
       VALUES (?, ?, ?, 'inscription', 'initie')`,
      [req.user.id, reference, MONTANT_INSCRIPTION]
    );
  }

  // --- Mode démo : sans clés PayTech configurées, on renvoie une URL locale
  // qui simule le paiement afin que le projet fonctionne dès le clonage. ---
  if (!process.env.PAYTECH_API_KEY || process.env.PAYTECH_API_KEY === "votre_api_key_paytech") {
    return res.json({
      mode: "demo",
      reference,
      montant: MONTANT_INSCRIPTION,
      url_paiement: `${req.protocol}://${req.get("host")}/api/payments/demo-page/${reference}`,
      avertissement:
        "Clés PayTech non configurées : paiement simulé pour développement. Configurez PAYTECH_API_KEY / PAYTECH_API_SECRET en production.",
    });
  }

  try {
    const reponse = await fetch("https://paytech.sn/api/payment/request-payment", {
      method: "POST",
      headers: {
        "API_KEY": process.env.PAYTECH_API_KEY,
        "API_SECRET": process.env.PAYTECH_API_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item_name: "Inscription propriétaire - SakeurImmo",
        item_price: MONTANT_INSCRIPTION,
        currency: "XOF",
        ref_command: reference,
        command_name: `Frais d'inscription SakeurImmo (${req.user.email})`,
        target_payment: "Orange Money, Wave",
        env: process.env.PAYTECH_ENV || "test",
        ipn_url: `${process.env.APP_URL}/api/payments/ipn`,
        success_url: `${process.env.FRONTEND_URL}/tableau-de-bord.html?paiement=succes`,
        cancel_url: `${process.env.FRONTEND_URL}/inscription.html?paiement=annule`,
        custom_field: JSON.stringify({ user_id: req.user.id, reference }),
      }),
    });

    const data = await reponse.json();

    if (data.success !== 1) {
      return res.status(502).json({ erreur: "Échec de l'initialisation du paiement PayTech.", detail: data });
    }

    await db.run("UPDATE paiements SET token_paytech = ? WHERE reference = ?", [data.token, reference]);

    res.json({ mode: "paytech", reference, montant: MONTANT_INSCRIPTION, url_paiement: data.redirect_url, token: data.token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: "Erreur serveur lors de l'initialisation du paiement." });
  }
});

// POST /api/payments/ipn — notification serveur-à-serveur envoyée par PayTech
// (à déclarer dans le tableau de bord PayTech comme URL d'IPN)
router.post("/ipn", express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      type_event,
      ref_command,
      item_price,
      payment_method,
      api_key_sha256,
      api_secret_sha256,
    } = req.body;

    const cleAttendue = crypto.createHash("sha256").update(process.env.PAYTECH_API_KEY || "").digest("hex");
    const secretAttendu = crypto.createHash("sha256").update(process.env.PAYTECH_API_SECRET || "").digest("hex");

    if (api_key_sha256 !== cleAttendue || api_secret_sha256 !== secretAttendu) {
      return res.status(403).send("Signature invalide");
    }

    if (type_event === "sale_complete") {
      await confirmerPaiement(ref_command, payment_method);
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("Erreur");
  }
});

// Route de secours utilisée uniquement en mode démo (sans clés PayTech réelles)
router.get("/demo-page/:reference", (req, res) => {
  const { reference } = req.params;
  res.send(`
    <html lang="fr"><head><meta charset="utf-8"><title>Paiement simulé</title>
    <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center}
    button{background:#0a5c46;color:#fff;border:0;padding:14px 28px;border-radius:8px;font-size:16px;cursor:pointer;margin-top:20px}</style>
    </head><body>
    <h2>Paiement simulé (mode démo)</h2>
    <p>Référence : ${reference}</p>
    <p>Montant : ${MONTANT_INSCRIPTION} FCFA</p>
    <form method="POST" action="/api/payments/demo-confirmer/${reference}">
      <button type="submit">Simuler un paiement réussi</button>
    </form>
    </body></html>
  `);
});

router.post("/demo-confirmer/:reference", async (req, res) => {
  await confirmerPaiement(req.params.reference, "demo");
  res.redirect(`${process.env.FRONTEND_URL}/tableau-de-bord.html?paiement=succes`);
});

async function confirmerPaiement(reference, moyenPaiement) {
  const paiement = await db.get("SELECT * FROM paiements WHERE reference = ?", [reference]);
  if (!paiement || paiement.statut === "reussi") return;

  await db.run(
    "UPDATE paiements SET statut = 'reussi', moyen_paiement = ?, confirme_le = datetime('now') WHERE reference = ?",
    [moyenPaiement, reference]
  );

  if (paiement.type === "inscription") {
    await db.run("UPDATE users SET statut_compte = 'actif' WHERE id = ?", [paiement.user_id]);
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
  await db.run(
    `INSERT INTO paiements (user_id, bien_id, reference, montant, type, statut)
     VALUES (?, ?, ?, ?, 'mise_en_avant', 'initie')`,
    [req.user.id, bienId, reference, MONTANT_MISE_EN_AVANT]
  );

  if (!process.env.PAYTECH_API_KEY || process.env.PAYTECH_API_KEY === "votre_api_key_paytech") {
    return res.json({
      mode: "demo",
      reference,
      montant: MONTANT_MISE_EN_AVANT,
      url_paiement: `${req.protocol}://${req.get("host")}/api/payments/demo-mise-en-avant/${reference}`,
    });
  }

  try {
    const reponse = await fetch("https://paytech.sn/api/payment/request-payment", {
      method: "POST",
      headers: {
        "API_KEY": process.env.PAYTECH_API_KEY,
        "API_SECRET": process.env.PAYTECH_API_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item_name: `Mise en avant 7 jours — ${bien.titre}`,
        item_price: MONTANT_MISE_EN_AVANT,
        currency: "XOF",
        ref_command: reference,
        command_name: `Mise en avant SakeurImmo (annonce #${bienId})`,
        target_payment: "Orange Money, Wave",
        env: process.env.PAYTECH_ENV || "test",
        ipn_url: `${process.env.APP_URL}/api/payments/ipn`,
        success_url: `${process.env.FRONTEND_URL}/tableau-de-bord.html?paiement=mea_succes`,
        cancel_url: `${process.env.FRONTEND_URL}/tableau-de-bord.html?paiement=annule`,
        custom_field: JSON.stringify({ user_id: req.user.id, bien_id: bienId, reference }),
      }),
    });
    const data = await reponse.json();
    if (data.success !== 1) {
      return res.status(502).json({ erreur: "Échec de l'initialisation PayTech.", detail: data });
    }
    await db.run("UPDATE paiements SET token_paytech = ? WHERE reference = ?", [data.token, reference]);
    res.json({ mode: "paytech", reference, montant: MONTANT_MISE_EN_AVANT, url_paiement: data.redirect_url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: "Erreur serveur lors de l'initialisation du paiement." });
  }
});

// Page démo mise en avant (sans clés PayTech)
router.get("/demo-mise-en-avant/:reference", async (req, res) => {
  const paiement = await db.get(
    "SELECT p.*, b.titre FROM paiements p LEFT JOIN biens b ON b.id = p.bien_id WHERE p.reference = ?",
    [req.params.reference]
  );
  if (!paiement) return res.status(404).send("Paiement introuvable.");
  res.send(`
    <html lang="fr"><head><meta charset="utf-8"><title>Paiement simulé — Mise en avant</title>
    <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center}
    button{background:#C89B3C;color:#101B2D;border:0;padding:14px 28px;border-radius:8px;font-size:16px;cursor:pointer;margin-top:20px;font-weight:700}</style>
    </head><body>
    <h2>Paiement simulé (mode démo)</h2>
    <p>★ Mise en avant 7 jours</p>
    <p><strong>${paiement.titre || "Annonce #" + paiement.bien_id}</strong></p>
    <p>Montant : <strong>${MONTANT_MISE_EN_AVANT.toLocaleString("fr-FR")} FCFA</strong></p>
    <form method="POST" action="/api/payments/demo-confirmer-mea/${req.params.reference}">
      <button type="submit">Simuler un paiement réussi</button>
    </form>
    </body></html>
  `);
});

router.post("/demo-confirmer-mea/:reference", async (req, res) => {
  await confirmerPaiement(req.params.reference, "demo");
  res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5500"}/tableau-de-bord.html?paiement=mea_succes`);
});

// GET /api/payments/statut/:reference — le frontend interroge ce endpoint (polling)
router.get("/statut/:reference", authRequis, async (req, res) => {
  const paiement = await db.get(
    "SELECT * FROM paiements WHERE reference = ? AND user_id = ?",
    [req.params.reference, req.user.id]
  );
  if (!paiement) return res.status(404).json({ erreur: "Paiement introuvable." });
  res.json({ statut: paiement.statut, reference: paiement.reference });
});

module.exports = router;
