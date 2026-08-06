// mail.js — Notifications e-mail transactionnelles via l'API HTTP Brevo.
// Pas de dépendance supplémentaire : node-fetch sert déjà pour PayTech.
//
// Principe : l'envoi est "best-effort". Sans clé configurée, ou si Brevo est
// indisponible, on journalise et on rend la main — une notification ratée ne
// doit jamais faire échouer l'action métier qui l'a déclenchée (une déclaration
// de paiement perdue coûte bien plus cher qu'un e-mail manquant).

const fetch = require("node-fetch");

const API_BREVO = "https://api.brevo.com/v3/smtp/email";

// Les valeurs insérées dans le HTML viennent en partie de la saisie utilisateur
// (identifiant de transaction) : elles doivent être échappées.
function echapper(valeur) {
  return String(valeur ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function envoyerEmailAdmin({ sujet, html }) {
  const destinataire = process.env.ADMIN_EMAIL;
  const cle = process.env.BREVO_API_KEY;

  if (!cle || !destinataire) {
    console.log(`[mail] BREVO_API_KEY ou ADMIN_EMAIL absent — e-mail non envoyé : ${sujet}`);
    return false;
  }

  try {
    const reponse = await fetch(API_BREVO, {
      method: "POST",
      headers: {
        "api-key": cle,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "SakeurImmo", email: process.env.MAIL_EXPEDITEUR || destinataire },
        to: [{ email: destinataire }],
        subject: sujet,
        htmlContent: html,
      }),
    });

    if (!reponse.ok) {
      console.error("[mail] échec d'envoi :", reponse.status, (await reponse.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mail] erreur d'envoi :", e.message);
    return false;
  }
}

module.exports = { envoyerEmailAdmin, echapper };
