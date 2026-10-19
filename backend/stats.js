// stats.js — Chiffres de pilotage pour l'admin : inscriptions, paiements, conversion.
// Lecture seule. Une inscription "convertit" quand son propriétaire a un paiement
// d'inscription au stade voulu : initié → déclaré (en_verification ou reussi) → validé (reussi).
const db = require("./db");

const PERIODES = [7, 30, 90];

const taux = (partie, total) => (total > 0 ? Math.round((partie / total) * 1000) / 10 : 0);
const n = (v) => Number(v) || 0;

async function calculerStats(jours) {
  const periode = PERIODES.includes(jours) ? jours : 30;
  const depuis = `-${periode} days`;

  const totaux = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'proprietaire') AS proprietaires,
       (SELECT COUNT(*) FROM users WHERE role = 'proprietaire' AND statut_compte = 'actif') AS actifs,
       (SELECT COUNT(*) FROM biens WHERE statut = 'publie') AS annonces_publiees,
       (SELECT COUNT(*) FROM biens WHERE statut = 'en_attente') AS annonces_en_attente,
       (SELECT COALESCE(SUM(vues), 0) FROM biens) AS vues,
       (SELECT COUNT(*) FROM contacts WHERE cree_le >= datetime('now', ?)) AS contacts_periode`,
    [depuis]
  );

  const entonnoir = await db.get(
    `SELECT COUNT(*) AS inscrits,
       COALESCE(SUM(EXISTS(SELECT 1 FROM paiements p WHERE p.user_id = u.id AND p.type = 'inscription')), 0) AS initie,
       COALESCE(SUM(EXISTS(SELECT 1 FROM paiements p WHERE p.user_id = u.id AND p.type = 'inscription'
                            AND p.statut IN ('en_verification', 'reussi'))), 0) AS declare,
       COALESCE(SUM(EXISTS(SELECT 1 FROM paiements p WHERE p.user_id = u.id AND p.type = 'inscription'
                            AND p.statut = 'reussi')), 0) AS valide
     FROM users u
     WHERE u.role = 'proprietaire' AND u.cree_le >= datetime('now', ?)`,
    [depuis]
  );

  // Montants par type : "valide" = confirmé (QR validé par l'admin ou PayPal capturé),
  // "declare" = déclaré mais pas encore vérifié (fonds probablement reçus, à contrôler).
  const parType = await db.all(
    `SELECT type,
       SUM(CASE WHEN statut = 'reussi' THEN 1 ELSE 0 END) AS nb_valides,
       COALESCE(SUM(CASE WHEN statut = 'reussi' THEN montant END), 0) AS valide,
       SUM(CASE WHEN statut = 'en_verification' THEN 1 ELSE 0 END) AS nb_declares,
       COALESCE(SUM(CASE WHEN statut = 'en_verification' THEN montant END), 0) AS declare
       FROM paiements
      WHERE COALESCE(confirme_le, declare_le, cree_le) >= datetime('now', ?)
        AND statut IN ('reussi', 'en_verification')
      GROUP BY type`,
    [depuis]
  );

  const retard = await db.get(
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant), 0) AS montant,
            COALESCE(SUM(declare_le < datetime('now', '-24 hours')), 0) AS plus_de_24h
       FROM paiements WHERE statut = 'en_verification'`
  );
  const abandons = await db.get(
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant), 0) AS montant
       FROM paiements
      WHERE statut = 'initie' AND cree_le < datetime('now', '-1 hours') AND cree_le >= datetime('now', ?)`,
    [depuis]
  );

  const canaux = await db.all(
    `SELECT COALESCE(u.code_createur, 'direct') AS canal,
       COUNT(*) AS inscrits,
       SUM(EXISTS(SELECT 1 FROM paiements p WHERE p.user_id = u.id AND p.type = 'inscription'
                   AND p.statut IN ('en_verification', 'reussi'))) AS payeurs,
       COALESCE(SUM((SELECT SUM(p.montant) FROM paiements p WHERE p.user_id = u.id AND p.statut = 'reussi')), 0) AS valide
     FROM users u
     WHERE u.role = 'proprietaire' AND u.cree_le >= datetime('now', ?)
     GROUP BY canal ORDER BY inscrits DESC LIMIT 20`,
    [depuis]
  );

  const inscritsParJour = await db.all(
    `SELECT date(cree_le) AS jour, COUNT(*) AS inscrits FROM users
      WHERE role = 'proprietaire' AND cree_le >= datetime('now', ?) GROUP BY jour`,
    [depuis]
  );
  const revenuParJour = await db.all(
    `SELECT date(COALESCE(confirme_le, cree_le)) AS jour, SUM(montant) AS valide FROM paiements
      WHERE statut = 'reussi' AND COALESCE(confirme_le, cree_le) >= datetime('now', ?) GROUP BY jour`,
    [depuis]
  );
  const jourMap = new Map();
  for (const r of inscritsParJour) jourMap.set(r.jour, { jour: r.jour, inscrits: n(r.inscrits), valide: 0 });
  for (const r of revenuParJour) {
    const ligne = jourMap.get(r.jour) || { jour: r.jour, inscrits: 0, valide: 0 };
    ligne.valide = n(r.valide);
    jourMap.set(r.jour, ligne);
  }

  const e = { inscrits: n(entonnoir.inscrits), initie: n(entonnoir.initie), declare: n(entonnoir.declare), valide: n(entonnoir.valide) };
  const valideTotal = parType.reduce((s, t) => s + n(t.valide), 0);
  const declareTotal = parType.reduce((s, t) => s + n(t.declare), 0);

  return {
    periode_jours: periode,
    totaux: Object.fromEntries(Object.entries(totaux).map(([k, v]) => [k, n(v)])),
    entonnoir: {
      ...e,
      taux_initie: taux(e.initie, e.inscrits),
      taux_declare: taux(e.declare, e.inscrits),
      taux_valide: taux(e.valide, e.inscrits),
    },
    revenus: {
      valide: valideTotal,
      declare_non_verifie: declareTotal,
      par_type: parType.map((t) => ({
        type: t.type, nb_valides: n(t.nb_valides), valide: n(t.valide), nb_declares: n(t.nb_declares), declare: n(t.declare),
      })),
    },
    a_valider: { nb: n(retard.nb), montant: n(retard.montant), plus_de_24h: n(retard.plus_de_24h) },
    paniers_abandonnes: { nb: n(abandons.nb), montant: n(abandons.montant) },
    canaux: canaux.map((c) => ({
      canal: c.canal, inscrits: n(c.inscrits), payeurs: n(c.payeurs), taux: taux(n(c.payeurs), n(c.inscrits)), valide: n(c.valide),
    })),
    par_jour: [...jourMap.values()].sort((a, b) => (a.jour < b.jour ? 1 : -1)),
  };
}

module.exports = { calculerStats, PERIODES };
