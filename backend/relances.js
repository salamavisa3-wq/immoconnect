// relances.js — Paiements à relancer et messages WhatsApp prêts à envoyer.
// Deux cas :
//  - abandon : paiement d'inscription lancé (statut 'initie') jamais déclaré → on relance le propriétaire ;
//  - a_verifier : paiement déclaré (statut 'en_verification') depuis plus de 24 h sans validation →
//    on demande la capture du SMS Wave / Orange Money pour pouvoir le rapprocher.
// Le message est ouvert dans WhatsApp par l'admin (lien wa.me) : aucun envoi automatique,
// donc aucune clé d'API WhatsApp à stocker. `nb_relances` / `relance_le` évitent le harcèlement.
const db = require("./db");

const MAX_RELANCES = 2;
const DELAI_ENTRE_RELANCES_H = 48;

// Numéro WhatsApp au format international sans "+" : 9 chiffres → préfixe Sénégal 221.
function telephoneWhatsApp(telephone) {
  let chiffres = String(telephone || "").replace(/\D/g, "");
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  if (chiffres.length === 9) return `221${chiffres}`;
  if (chiffres.length >= 11 && chiffres.length <= 15) return chiffres;
  return null;
}

const prenom = (nomComplet) => String(nomComplet || "").trim().split(/\s+/)[0] || "";
const montantFr = (m) => `${Number(m).toLocaleString("fr-FR")} FCFA`;

function messageRelance(type, { nom_complet, montant, reference }, baseUrl) {
  const bonjour = `Bonjour ${prenom(nom_complet)}`.trim();
  if (type === "abandon") {
    return `${bonjour}, c'est SakeurImmo. Vous avez commencé le paiement de votre forfait (${montantFr(montant)}) mais il n'est pas terminé. ` +
      `Vous pouvez le finaliser ici : ${baseUrl}/paiement-qr.html?reference=${encodeURIComponent(reference)} — ` +
      `une fois payé, votre compte est activé et vous publiez vos annonces. Besoin d'aide ? Répondez à ce message.`;
  }
  return `${bonjour}, c'est SakeurImmo. Nous n'avons pas encore pu rapprocher votre paiement de ${montantFr(montant)} (réf. ${reference}). ` +
    `Pouvez-vous nous envoyer une capture du SMS de confirmation Wave / Orange Money ? Dès réception, nous le validons. Merci !`;
}

function enrichir(type, lignes, baseUrl) {
  return lignes.map((l) => {
    const numero = telephoneWhatsApp(l.telephone);
    const message = messageRelance(type, l, baseUrl);
    return {
      reference: l.reference,
      montant: Number(l.montant),
      nom_complet: l.nom_complet,
      telephone: l.telephone,
      depuis: type === "abandon" ? l.cree_le : l.declare_le,
      nb_relances: Number(l.nb_relances) || 0,
      message,
      whatsapp_url: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(message)}` : null,
    };
  });
}

const FILTRE_RELANCE = `p.nb_relances < ${MAX_RELANCES}
  AND (p.relance_le IS NULL OR p.relance_le < datetime('now', '-${DELAI_ENTRE_RELANCES_H} hours'))`;

async function paiementsARelancer(baseUrl = process.env.FRONTEND_URL || "https://sakeurimmo.com") {
  const abandons = await db.all(
    `SELECT p.reference, p.montant, p.cree_le, p.nb_relances, u.nom_complet, u.telephone
       FROM paiements p JOIN users u ON u.id = p.user_id
      WHERE p.statut = 'initie' AND p.type = 'inscription'
        AND p.cree_le < datetime('now', '-1 hours') AND p.cree_le >= datetime('now', '-7 days')
        AND ${FILTRE_RELANCE}
        AND NOT EXISTS (SELECT 1 FROM paiements q WHERE q.user_id = p.user_id AND q.type = 'inscription'
                         AND q.statut IN ('en_verification', 'reussi'))
      ORDER BY p.cree_le ASC`
  );
  const aVerifier = await db.all(
    `SELECT p.reference, p.montant, p.declare_le, p.nb_relances, u.nom_complet, u.telephone
       FROM paiements p JOIN users u ON u.id = p.user_id
      WHERE p.statut = 'en_verification' AND p.declare_le < datetime('now', '-24 hours')
        AND ${FILTRE_RELANCE}
      ORDER BY p.declare_le ASC`
  );
  return { abandons: enrichir("abandon", abandons, baseUrl), a_verifier: enrichir("a_verifier", aVerifier, baseUrl) };
}

// Enregistre qu'une relance vient d'être envoyée. Retourne false si le paiement n'est plus relançable.
async function marquerRelance(reference) {
  const r = await db.run(
    `UPDATE paiements SET relance_le = datetime('now'), nb_relances = nb_relances + 1
      WHERE reference = ? AND statut IN ('initie', 'en_verification')`,
    [reference]
  );
  return r.changes > 0;
}

module.exports = { paiementsARelancer, marquerRelance, telephoneWhatsApp, messageRelance, MAX_RELANCES };
