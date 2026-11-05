// lib/validation.js — Contrôle du type et de la taille des champs saisis (inscription, annonces).
// Audit sécurité 2026-11-05 : le PUT d'une annonce enregistrait n'importe quelle valeur (même du texte dans
// un champ numérique) et l'inscription n'imposait ni format d'e-mail ni taille de nom.

const LIMITES_TEXTE = { titre: 150, ville: 80, quartier: 80, description: 5000 };
const CHAMPS_OBLIGATOIRES = ["titre", "ville"];
const CHAMPS_NOMBRE = ["prix", "superficie", "chambres", "salles_bain"];
const NOMBRE_MAX = 1e12;

const vide = (v) => v === undefined || v === null || v === "";

/**
 * Valide les champs d'une annonce. `partiel: true` (PUT) ne retourne que les champs fournis.
 * @returns {{erreur: string} | {valeurs: object}} valeurs normalisées (texte nettoyé, nombres convertis, null si vide)
 */
function validerChampsAnnonce(corps, { partiel = false } = {}) {
  const valeurs = {};

  for (const [champ, max] of Object.entries(LIMITES_TEXTE)) {
    const brut = corps[champ];
    if (brut === undefined && partiel) continue;
    if (vide(brut)) {
      if (CHAMPS_OBLIGATOIRES.includes(champ)) return { erreur: `Le champ « ${champ} » est obligatoire.` };
      valeurs[champ] = null;
      continue;
    }
    if (typeof brut !== "string") return { erreur: `Le champ « ${champ} » doit être un texte.` };
    const texte = brut.trim();
    if (!texte && CHAMPS_OBLIGATOIRES.includes(champ)) return { erreur: `Le champ « ${champ} » est obligatoire.` };
    if (texte.length > max) return { erreur: `Le champ « ${champ} » dépasse ${max} caractères.` };
    valeurs[champ] = texte || null;
  }

  for (const champ of CHAMPS_NOMBRE) {
    const brut = corps[champ];
    if (brut === undefined && partiel) continue;
    if (vide(brut)) {
      if (champ === "prix") return { erreur: "Le prix est obligatoire." };
      valeurs[champ] = null;
      continue;
    }
    if (typeof brut === "string" && !/^\s*\d+([.,]\d+)?\s*$/.test(brut)) {
      return { erreur: `Le champ « ${champ} » doit être un nombre.` };
    }
    if (typeof brut !== "string" && typeof brut !== "number") return { erreur: `Le champ « ${champ} » doit être un nombre.` };
    const n = Number(String(brut).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > NOMBRE_MAX) return { erreur: `Le champ « ${champ} » est invalide.` };
    if (champ === "prix" && n <= 0) return { erreur: "Le prix doit être supérieur à 0." };
    valeurs[champ] = n;
  }

  return { valeurs };
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const TELEPHONE = /^[0-9+\-.() ]{6,30}$/;

/** Retourne un message d'erreur, ou null si l'inscription est acceptable. */
function validerInscription({ nom_complet, email, telephone, ville, mot_de_passe }) {
  if ([nom_complet, email, telephone, mot_de_passe].some((v) => typeof v !== "string")) {
    return "Les champs doivent être des textes.";
  }
  if (nom_complet.trim().length < 2 || nom_complet.trim().length > 100) return "Le nom doit faire entre 2 et 100 caractères.";
  if (email.length > 254 || !EMAIL.test(email.trim())) return "Adresse e-mail invalide.";
  if (!TELEPHONE.test(telephone.trim())) return "Numéro de téléphone invalide.";
  if (ville !== undefined && ville !== null && (typeof ville !== "string" || ville.length > 80)) return "Ville invalide.";
  if (mot_de_passe.length > 200) return "Mot de passe trop long.";
  return null;
}

module.exports = { validerChampsAnnonce, validerInscription };
