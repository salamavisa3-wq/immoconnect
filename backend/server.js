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
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Limite de débit globale contre les abus (l'IPN PayTech a son propre parseur au-dessus)
const limiteur = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api/", limiteur);

app.get("/api/sante", (req, res) => res.json({ statut: "ok", heure: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/biens", biensRoutes);
app.use("/api/contacts", contactsRoutes);

app.use((req, res) => res.status(404).json({ erreur: "Route introuvable." }));

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
