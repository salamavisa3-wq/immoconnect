// api.js — Petit client HTTP commun à toutes les pages.

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3001/api"
  : "/api"; // en production, servez le frontend derrière le même domaine que l'API (proxy)

const Session = {
  getToken: () => localStorage.getItem("sakeurimmo_token"),
  setToken: (t) => localStorage.setItem("sakeurimmo_token", t),
  getUser: () => JSON.parse(localStorage.getItem("sakeurimmo_user") || "null"),
  setUser: (u) => localStorage.setItem("sakeurimmo_user", JSON.stringify(u)),
  clear: () => {
    localStorage.removeItem("sakeurimmo_token");
    localStorage.removeItem("sakeurimmo_user");
  },
  estConnecte: () => !!localStorage.getItem("sakeurimmo_token"),
};

async function appelApi(chemin, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const token = Session.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const reponse = await fetch(`${API_BASE}${chemin}`, { ...options, headers });
  const data = await reponse.json().catch(() => ({}));

  if (!reponse.ok) {
    throw new Error(data.erreur || "Une erreur est survenue.");
  }
  return data;
}

const LIBELLES_TYPE = {
  terrain: "Terrain",
  appartement_vente: "Appartement à vendre",
  appartement_location: "Appartement à louer",
  appartement_meuble: "Appartement meublé",
  maison_vente: "Maison à vendre",
  maison_location: "Maison à louer",
  villa_vente: "Villa à vendre",
  villa_location: "Villa à louer",
};

function formaterPrix(montant) {
  return Number(montant).toLocaleString("fr-FR") + " FCFA";
}

// Slug SEO déterministe d'un titre (accents, ponctuation, longueur)
function slugifier(titre) {
  return String(titre || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// URL canonique d'une annonce : /annonce/<slug>-<id>
function urlAnnonce(b) {
  return `/annonce/${slugifier(b.titre) || "annonce"}-${b.id}`;
}
