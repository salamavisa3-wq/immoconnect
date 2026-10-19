// forfaits.js — Source unique de vérité des formules d'abonnement propriétaire.
// Chaque forfait : un prix (FCFA) et le nombre d'annonces actives accordées.
// Une annonce active = en attente ou publiée (supprimée/refusée → place libérée).
// `mensuel: true` = abonnement Agence : les places expirent après `jours` jours
// (renouvelable en repayant avant l'échéance : la durée s'ajoute).
const FORFAITS = [
  { prix: 5000, annonces: 5 },
  { prix: 10000, annonces: 10 },
  { prix: 15000, annonces: 15 },
  { prix: 30000, annonces: 50, mensuel: true, jours: 30 },
];

// Mise en avant d'une annonce : durée → prix (FCFA). La durée 7 j reste pilotée par
// FRAIS_MISE_EN_AVANT_FCFA (comportement historique, 2 000 FCFA par défaut).
const BOOSTS = [
  { jours: 7, prix: Number(process.env.FRAIS_MISE_EN_AVANT_FCFA || 2000) },
  { jours: 15, prix: 3500 },
  { jours: 30, prix: 6000 },
];

module.exports = { FORFAITS, BOOSTS };
