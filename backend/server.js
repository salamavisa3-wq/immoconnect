// server.js — Point d'entrée de l'API SakeurImmo

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
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

// Render (et la plupart des hébergeurs Node) placent l'app derrière un proxy inverse ;
// sans ça, express-rate-limit refuse de lire X-Forwarded-For pour identifier les clients.
app.set("trust proxy", 1);

// Filet de sécurité : une erreur synchrone dans un handler async (ex. jwt.sign avec un
// secret manquant) devient un rejet de promesse non intercepté par Express 4 et tuait
// tout le process. On log au lieu de laisser Node terminer le serveur.
process.on("unhandledRejection", (err) => {
  console.error("Rejet de promesse non géré :", err);
});

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// Cache CDN : HTML court (5 min), assets statiques long (24h) — max-age=0 par défaut ne met rien en cache au edge
app.use(express.static(path.join(__dirname, "..", "frontend"), {
  maxAge: "5m",
  setHeaders: (res, chemin) => {
    if (/\.(css|js|svg|jpg|jpeg|png|webp|ico)$/i.test(chemin)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

// Limite de débit globale contre les abus (l'IPN PayTech a son propre parseur au-dessus)
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
    const pages = [
      { loc: "https://sakeurimmo.com/", lastmod: aujourdHui, prio: "1.0" },
      { loc: "https://sakeurimmo.com/annonces.html", lastmod: aujourdHui, prio: "0.9" },
      ...categories,
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

// Fiches annonces à URLs à slugs (SEO) : /annonce/<slug>-<id> sert la même page annonce.html
app.get("/annonce/:slugId", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "annonce.html"));
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
