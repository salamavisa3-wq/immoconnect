// api.js — Petit client HTTP commun à toutes les pages.

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3001/api"
  : "/api"; // en production, servez le frontend derrière le même domaine que l'API (proxy)

const Session = {
  getToken: () => localStorage.getItem("immoconnect_token"),
  setToken: (t) => localStorage.setItem("immoconnect_token", t),
  getUser: () => JSON.parse(localStorage.getItem("immoconnect_user") || "null"),
  setUser: (u) => localStorage.setItem("immoconnect_user", JSON.stringify(u)),
  clear: () => {
    localStorage.removeItem("immoconnect_token");
    localStorage.removeItem("immoconnect_user");
  },
  estConnecte: () => !!localStorage.getItem("immoconnect_token"),
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
