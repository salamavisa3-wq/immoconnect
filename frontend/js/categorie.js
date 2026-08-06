// js/categorie.js — Affiche les annonces d'une catégorie sur une page dédiée (silo SEO)
function carteAnnonce(b) {
  const enAvant = b.mise_en_avant === 1 &&
    (!b.mise_en_avant_jusqu_au || new Date(b.mise_en_avant_jusqu_au) > new Date());
  const image = b.images && b.images[0]
    ? `<img src="${window.location.hostname === 'localhost' ? 'http://localhost:4000' : ''}${b.images[0]}" alt="${b.titre}">`
    : `<span>Pas de photo</span>`;

  return `
    <a class="annonce-carte${enAvant ? ' annonce-en-avant' : ''}" href="/annonce.html?id=${b.id}">
      <div class="annonce-image">
        <span class="badge-type">${LIBELLES_TYPE[b.type_bien] || b.type_bien}</span>
        ${enAvant ? '<span class="badge-coup-de-coeur">★ Coup de cœur</span>' : ''}
        ${image}
      </div>
      <div class="annonce-corps">
        <h4>${b.titre}</h4>
        <div class="annonce-lieu">${b.quartier ? b.quartier + ", " : ""}${b.ville}</div>
        <div class="annonce-prix">${formaterPrix(b.prix)}</div>
        <div class="annonce-carac">
          ${b.superficie ? `<span>${b.superficie} m²</span>` : ""}
          ${b.chambres ? `<span>${b.chambres} ch.</span>` : ""}
          ${b.salles_bain ? `<span>${b.salles_bain} SDB</span>` : ""}
        </div>
      </div>
    </a>`;
}

async function chargerCategorie(type) {
  const grille = document.getElementById("grille-categorie");
  if (!grille) return;
  grille.innerHTML = "<p style='color:var(--texte-clair)'>Chargement des annonces...</p>";
  try {
    const { resultats, total } = await appelApi(`/biens?type=${encodeURIComponent(type)}`);
    grille.setAttribute("data-nb", String(total || 0));
    if (resultats.length === 0) {
      grille.innerHTML = `
        <p style="color:var(--texte-clair);">Aucune annonce dans cette catégorie pour le moment. Sur SakeurImmo, les propriétaires publient leurs biens directement — soyez le premier à publier le vôtre, dès 5000 FCFA.</p>
        <p style="margin-top:18px;"><a href="/inscription.html" class="bouton bouton-primaire">Publier une annonce</a></p>`;
      return;
    }
    grille.innerHTML = resultats.map(carteAnnonce).join("");
  } catch (err) {
    grille.innerHTML = `<p style="color:var(--rouge-alerte);">${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("grille-categorie");
  if (el && el.dataset.type) chargerCategorie(el.dataset.type);
});