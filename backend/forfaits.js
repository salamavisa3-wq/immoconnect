// forfaits.js — Source unique de vérité des formules d'abonnement propriétaire.
// Chaque forfait : un prix (FCFA) et le nombre d'annonces actives accordées.
// Une annonce active = en attente ou publiée (supprimée/refusée → place libérée).
const FORFAITS = [
  { prix: 5000, annonces: 5 },
  { prix: 10000, annonces: 10 },
  { prix: 15000, annonces: 15 },
];

module.exports = { FORFAITS };
