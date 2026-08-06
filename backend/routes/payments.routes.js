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
const { authRequis, adminRequis } = require("../middleware/auth");
const { envoyerEmailAdmin, echapper } = require("../mail");

const router = express.Router();

const MONTANT_INSCRIPTION    = Number(process.env.FRAIS_INSCRIPTION_FCFA    || 5000);
const MONTANT_MISE_EN_AVANT  = Number(process.env.FRAIS_MISE_EN_AVANT_FCFA  || 2000);

// Paiement par QR : circuit manuel de secours quand le client préfère scanner
// plutôt que passer par la redirection PayTech. Aucune confirmation automatique
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

function modeDemo() {
  return !process.env.PAYTECH_API_KEY || process.env.PAYTECH_API_KEY === "votre_api_key_paytech";
}

// Les routes de simulation ne doivent pas exister dès lors que de vraies clés
// PayTech sont configurées : sans ce garde, tout inscrit pouvait récupérer sa
// référence via /initier puis appeler /demo-confirmer pour activer son compte
// sans payer.
function demoSeulement(req, res, next) {
  if (!modeDemo()) return res.status(404).json({ erreur: "Route introuvable." });
  next();
}

// POST /api/payments/initier — démarre le paiement des frais d'inscription
router.post("/initier", authRequis, async (req, res) => {
  if (req.user.statut_compte === "actif") {
    return res.status(400).json({ erreur: "Votre compte est déjà actif." });
  }

  // Réutiliser un paiement déjà initié pour éviter les doublons
  const existant = await db.get(
    "SELECT * FROM paiements WHERE user_id = ? AND type = 'inscription' AND statut IN ('initie', 'en_verification') ORDER BY id DESC LIMIT 1",
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

  // Paiement par QR : circuit manuel, aucun token PayTech à demander.
  if (req.body.moyen === "qr") {
    return res.json({
      mode: "qr",
      reference,
      montant: MONTANT_INSCRIPTION,
      url_paiement: `/paiement-qr.html?reference=${encodeURIComponent(reference)}`,
    });
  }

  // --- Mode démo : sans clés PayTech configurées, on renvoie une URL locale
  // qui simule le paiement afin que le projet fonctionne dès le clonage. ---
  if (modeDemo()) {
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
router.get("/demo-page/:reference", demoSeulement, (req, res) => {
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

router.post("/demo-confirmer/:reference", demoSeulement, async (req, res) => {
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

  if (req.body.moyen === "qr") {
    return res.json({
      mode: "qr",
      reference,
      montant: MONTANT_MISE_EN_AVANT,
      url_paiement: `/paiement-qr.html?reference=${encodeURIComponent(reference)}`,
    });
  }

  if (modeDemo()) {
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
router.get("/demo-mise-en-avant/:reference", demoSeulement, async (req, res) => {
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

router.post("/demo-confirmer-mea/:reference", demoSeulement, async (req, res) => {
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

// --- Paiement par QR (Wave / Orange Money), circuit manuel de secours ---

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

  res.json({
    statut: "en_verification",
    message: "Paiement déclaré. Nous le vérifions et activons votre compte sous 24 h ouvrées.",
  });
});

function notifierDeclaration(user, paiement, moyen, transactionId) {
  const operateur = moyen === "orange_money_qr" ? "Orange Money" : "Wave";
  const objet = paiement.type === "inscription"
    ? "Inscription propriétaire"
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
  res.json({ statut: "echoue", reference: paiement.reference });
});

module.exports = router;
