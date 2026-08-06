// js/menu.js — Menu hamburger mobile (≤860px) : bascule de la nav en panneau
document.addEventListener("DOMContentLoaded", () => {
  const bouton = document.querySelector(".bouton-menu");
  const nav = document.querySelector(".nav");
  if (!bouton || !nav) return;

  bouton.addEventListener("click", () => {
    const ouvert = nav.classList.toggle("ouvert");
    bouton.setAttribute("aria-expanded", String(ouvert));
  });

  // Ferme le menu après le clic sur un lien
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
    nav.classList.remove("ouvert");
    bouton.setAttribute("aria-expanded", "false");
  }));

  // Ferme au clic à l'extérieur
  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target) && !bouton.contains(e.target)) {
      nav.classList.remove("ouvert");
      bouton.setAttribute("aria-expanded", "false");
    }
  });
});