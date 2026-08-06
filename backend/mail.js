// mail.js — Notifications e-mail transactionnelles via l'API HTTP Brevo.
// Pas de dépendance supplémentaire : node-fetch est déjà une dépendance du projet.
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

// Retourne { ok, raison } plutôt qu'un booléen : la cause exacte d'un échec
// (clé absente, expéditeur non validé, quota…) doit pouvoir être affichée dans
// l'espace d'administration, sans obliger à ouvrir les logs de l'hébergeur.
async function envoyerEmailAdmin({ sujet, html }) {
  const destinataire = process.env.ADMIN_EMAIL;
  const cle = process.env.BREVO_API_KEY;

  if (!cle || !destinataire) {
    const raison = `configuration incomplète (BREVO_API_KEY ${cle ? "définie" : "absente"}, ADMIN_EMAIL ${destinataire ? "défini" : "absent"})`;
    console.log(`[mail] ${raison} — e-mail non envoyé : ${sujet}`);
    return { ok: false, raison };
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
      const raison = `Brevo a répondu ${reponse.status} : ${(await reponse.text()).slice(0, 200)}`;
      console.error("[mail] échec d'envoi :", raison);
      return { ok: false, raison };
    }
    return { ok: true, raison: `envoyé à ${destinataire}` };
  } catch (e) {
    console.error("[mail] erreur d'envoi :", e.message);
    return { ok: false, raison: `erreur réseau : ${e.message}` };
  }
}

module.exports = { envoyerEmailAdmin, echapper };
