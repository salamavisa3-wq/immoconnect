// server.js — Point d'entrée de l'API SakeurImmo

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

const db = require("./db");
const authRoutes = require("./routes/auth.routes");
const paymentsRoutes = require("./routes/payments.routes");
const biensRoutes = require("./routes/biens.routes");
const contactsRoutes = require("./routes/contacts.routes");

const app = express();

// Slug SEO déterministe d'un titre (miroir de frontend/js/api.js)
function slugifier(titre) {
  return String(titre || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Libellés des types (miroir de frontend/js/api.js — évite le doublon « à vendre à vendre »)
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

const formaterPrix = (montant) => Number(montant).toLocaleString("fr-FR") + " FCFA";
const urlAnnonce = (b) => `/annonce/${slugifier(b.titre) || "annonce"}-${b.id}`;

// Échappement HTML minimal pour les valeurs injectées côté serveur
function echapper(texte) {
  return String(texte ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Template de la fiche annonce, lu une seule fois au démarrage
const templateAnnonce = fs.readFileSync(path.join(__dirname, "..", "frontend", "annonce.html"), "utf8");

// Construit le JSON-LD RealEstateListing pour une fiche
function jsonLdRealEstateListing(b, canonicalUrl) {
  const images = (b.images || [])
    .filter(Boolean)
    .map((img) => (img.startsWith("http") ? img : `https://sakeurimmo.com${img}`));
  const image = images[0] || "https://sakeurimmo.com/images/og-image.jpg";
  const data = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": `${canonicalUrl}#listing`,
    url: canonicalUrl,
    name: b.titre,
    description: b.description ? b.description.slice(0, 300).replace(/\n/g, " ") : `Annonce immobilière au Sénégal sur SakeurImmo.`,
    datePosted: String(b.cree_le || "").slice(0, 10),
    image: images.length ? images : [image],
    about: {
      "@type": "Place",
      name: b.ville || "Sénégal",
      address: {
        "@type": "PostalAddress",
        addressCountry: "SN",
        ...(b.ville ? { addressLocality: b.ville } : {}),
        ...(b.quartier ? { streetAddress: b.quartier } : {}),
      },
    },
    offers: {
      "@type": "Offer",
      price: String(Number(b.prix) || 0),
      priceCurrency: "XOF",
      availability: "https://schema.org/InStock",
      url: canonicalUrl,
      seller: {
        "@type": "RealEstateAgent",
        name: "SakeurImmo",
        url: "https://sakeurimmo.com",
      },
    },
  };
  if (b.superficie) {
    data.about.floorSize = {
      "@type": "QuantitativeValue",
      value: Number(b.superficie),
      unitCode: "MTK",
    };
  }
  return JSON.stringify(data, null, 2);
}

// Rendu serveur de la fiche : SEO (title/desc/canonical/og/twitter) + contenu statique de
// repli, identiques à ceux que le JS client poserait. Sans JS, Google voit une page complète
// et auto-canonique au lieu d'un doublon de /annonce.html.
function rendreFicheAnnonce(b) {
  const typeTxt = LIBELLES_TYPE[b.type_bien] || b.type_bien;
  const transactionTxt = b.transaction_type === "vente" ? "à vendre" : "à louer";
  const villeTxt = b.ville ? ` à ${b.ville}` : "";
  const titreType = /à vendre|à louer/.test(typeTxt) ? typeTxt : `${typeTxt} ${transactionTxt}`;
  const titreSeo = `${titreType}${villeTxt} · ${formaterPrix(b.prix)} — SakeurImmo`;
  const descSeo = b.description
    ? b.description.slice(0, 155).replace(/\n/g, " ") + "..."
    : `Consultez cette annonce de ${titreType}${villeTxt} sur SakeurImmo.`;
  const canonicalUrl = `https://sakeurimmo.com${urlAnnonce(b)}`;
  const images = (b.images || []).filter(Boolean);
  const image = images[0] ? (images[0].startsWith("http") ? images[0] : `https://sakeurimmo.com${images[0]}`) : "https://sakeurimmo.com/images/og-image.jpg";
  const altText = `${echapper(b.titre)} — ${echapper(b.quartier ? b.quartier + ", " : "")}${echapper(b.ville)}`;
  const jsonLd = jsonLdRealEstateListing(b, canonicalUrl);

  const imagesHtml = images
    .map((img) => {
      const src = img.startsWith("http") ? img : `https://sakeurimmo.com${img}`;
      return `<img src="${echapper(src)}" alt="${altText}" style="width:220px;height:150px;object-fit:cover;border-radius:6px;border:1px solid var(--sable-fonce);">`;
    })
    .join("");

  const contenu = `
    <div class="cachet-ref" style="margin-bottom:10px;">RÉF. TF-${String(b.id).padStart(6, "0")}</div>
    <h1>${echapper(b.titre)}</h1>
    <p style="color:var(--texte-clair);margin-top:-6px;">${echapper(b.quartier ? b.quartier + ", " : "")}${echapper(b.ville)}</p>
    <p style="font-size:1.6rem;font-weight:700;margin:12px 0;">${formaterPrix(b.prix)}</p>
    ${image ? `<img src="${echapper(image)}" alt="${altText}" style="max-width:100%;border-radius:6px;">` : ""}
    <p style="margin-top:14px;">${echapper(b.description || "")}</p>
    <h3>Description complète</h3>
    <div style="color:var(--texte);line-height:1.7;">${echapper(b.description || "Aucune description fournie.").replace(/\n/g, "<br>")}</div>
    <div style="margin-top:32px;background:var(--blanc);border:1px solid var(--sable-fonce);border-radius:8px;padding:30px;">
      <h3 style="margin-top:0;">Contacter le propriétaire</h3>
      <div id="msg-contact-erreur"></div>
      <div id="msg-contact-succes"></div>
      <form id="form-contact" style="display:grid;gap:14px;">
        <div class="grille-2" style="gap:14px;">
          <div class="champ" style="margin:0;">
            <label>Votre nom *</label>
            <input type="text" name="nom" required placeholder="Prénom et nom">
          </div>
          <div class="champ" style="margin:0;">
            <label>Votre e-mail *</label>
            <input type="email" name="email" required placeholder="vous@exemple.com">
          </div>
        </div>
        <div class="champ" style="margin:0;">
          <label>Téléphone (optionnel)</label>
          <input type="text" name="telephone" placeholder="+221 77 000 00 00">
        </div>
        <div class="champ" style="margin:0;">
          <label>Votre message *</label>
          <textarea name="message" rows="4" required placeholder="Bonjour, je suis intéressé(e) par ce bien..."></textarea>
        </div>
        <button type="submit" class="bouton bouton-primaire" id="btn-envoyer-message">Envoyer le message</button>
      </form>
    </div>`;

  return templateAnnonce
    .replace(/<title>[^<]*<\/title>/, `<title>${echapper(titreSeo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, `$1${echapper(descSeo)}$2`)
    .replace(/(<link rel="canonical" id="canonical-bien" href=")[^"]*(">)/, `$1${canonicalUrl}$2`)
    .replace(/(<meta property="og:url" id="og-url-bien" content=")[^"]*(">)/, `$1${canonicalUrl}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${echapper(titreSeo)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${echapper(descSeo)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(">)/, `$1${image}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(">)/, `$1${echapper(titreSeo)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(">)/, `$1${echapper(descSeo)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(">)/, `$1${image}$2`)
    .replace(/<\/head>/, `  <script type="application/ld+json">${jsonLd}</script>\n</head>`)
    .replace(/\n    Chargement...\n/, `\n${contenu}\n`);
}

// Render (et la plupart des hébergeurs Node) placent l'app derrière un proxy inverse ;
// sans ça, express-rate-limit refuse de lire X-Forwarded-For pour identifier les clients.
app.set("trust proxy", 1);

// Filet de sécurité : une erreur synchrone dans un handler async (ex. jwt.sign avec un
// secret manquant) devient un rejet de promesse non intercepté par Express 4 et tuait
// tout le process. On log au lieu de laisser Node terminer le serveur.
process.on("unhandledRejection", (err) => {
  console.error("Rejet de promesse non géré :", err);
});

// CORS uniquement sur l'API : sans ça, Vary:Origin est envoyé sur les fichiers statiques
// et Cloudflare ne met rien en cache (cf-cache-status: DYNAMIC = chaque requête touche Render)
app.use("/api/", cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Cache CDN : HTML court (5 min), assets statiques long (24h) — max-age=0 par défaut ne met rien en cache au edge
app.use(express.static(path.join(__dirname, "..", "frontend"), {
  maxAge: "1h",
  setHeaders: (res, chemin) => {
    if (/\.(css|js|svg|jpg|jpeg|png|webp|ico)$/i.test(chemin)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

// Limite de débit globale contre les abus
const limiteur = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api/", limiteur);

app.get("/api/sante", (req, res) => res.json({ statut: "ok", heure: new Date().toISOString() }));

// Sitemap XML dynamique : pages statiques + annonces publiées (SEO)
app.get("/sitemap.xml", async (req, res) => {
  try {
    const biens = await db.all("SELECT id, titre, cree_le FROM biens WHERE statut = 'publie' ORDER BY cree_le DESC");
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const categories = [
      "terrains-a-vendre",
      "appartements-a-vendre",
      "appartements-a-louer",
      "appartements-meubles",
      "maisons-a-vendre",
      "maisons-a-louer",
      "villas-a-vendre",
      "villas-a-louer",
    ].map((slug) => ({
      loc: `https://sakeurimmo.com/categorie/${slug}.html`,
      lastmod: aujourdHui,
      prio: "0.8",
    }));
    const villes = [
      "immobilier-a-dakar",
      "immobilier-a-thies",
      "immobilier-a-saly",
      "immobilier-a-saint-louis",
      "immobilier-a-touba",
    ].map((slug) => ({
      loc: `https://sakeurimmo.com/villes/${slug}.html`,
      lastmod: aujourdHui,
      prio: "0.8",
    }));
    const pages = [
      { loc: "https://sakeurimmo.com/", lastmod: aujourdHui, prio: "1.0" },
      { loc: "https://sakeurimmo.com/annonces.html", lastmod: aujourdHui, prio: "0.9" },
      { loc: "https://sakeurimmo.com/guides.html", lastmod: aujourdHui, prio: "0.8" },
      { loc: "https://sakeurimmo.com/diaspora.html", lastmod: aujourdHui, prio: "0.8" },
      { loc: "https://sakeurimmo.com/contact.html", lastmod: aujourdHui, prio: "0.8" },
      ...categories,
      ...villes,
      { loc: "https://sakeurimmo.com/guides/acheter-un-terrain-au-senegal.html", lastmod: aujourdHui, prio: "0.8" },
      { loc: "https://sakeurimmo.com/guides/vendre-son-bien-au-senegal.html", lastmod: aujourdHui, prio: "0.8" },
      { loc: "https://sakeurimmo.com/guides/quartiers-investir-dakar-thies.html", lastmod: aujourdHui, prio: "0.8" },
      { loc: "https://sakeurimmo.com/guides/louer-un-appartement-au-senegal.html", lastmod: aujourdHui, prio: "0.8" },
    ];
    const annonces = biens.map((b) => ({
      loc: `https://sakeurimmo.com/annonce/${slugifier(b.titre) || "annonce"}-${b.id}`,
      lastmod: String(b.cree_le || "").slice(0, 10),
      prio: "0.8",
    }));
    const urls = [...pages, ...annonces]
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <priority>${u.prio}</priority>\n  </url>`
      )
      .join("\n");
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
    );
  } catch (e) {
    console.error("Erreur sitemap :", e);
    res.status(500).json({ erreur: "Erreur sitemap." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/biens", biensRoutes);
app.use("/api/contacts", contactsRoutes);

// Fiches annonces à URLs à slugs (SEO) : /annonce/<slug>-<id> est rendu côté serveur
// (SEO + contenu), sinon Google classait le shell statique comme doublon de /annonce.html.
app.get("/annonce/:slugId", async (req, res) => {
  try {
    const id = Number((req.params.slugId.replace(/\.html$/, "").match(/(\d+)$/) || [])[1]);
    if (!id) return res.status(404).sendFile(path.join(__dirname, "..", "frontend", "404.html"));
    const b = await db.get("SELECT * FROM biens WHERE id = ? AND statut = 'publie'", [id]);
    if (!b) return res.status(404).sendFile(path.join(__dirname, "..", "frontend", "404.html"));
    b.images = JSON.parse(b.images || "[]");
    res.set("Cache-Control", "public, max-age=300");
    res.send(rendreFicheAnnonce(b));
  } catch (e) {
    console.error("Erreur fiche annonce :", e);
    res.status(500).send("Erreur serveur.");
  }
});

app.use((req, res) => {
  // API → 404 JSON ; pages → vraie page 404 HTML
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ erreur: "Route introuvable." });
  }
  res.status(404).sendFile(path.join(__dirname, "..", "frontend", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: err.message || "Erreur interne du serveur." });
});

const PORT = process.env.PORT || 3001;
db.pretASync
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ SakeurImmo API démarrée sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Échec d'initialisation de la base de données :", err);
    process.exit(1);
  });
