// server.js — Point d'entrée de l'API ImmoConnect

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const paymentsRoutes = require("./routes/payments.routes");
const biensRoutes = require("./routes/biens.routes");
const contactsRoutes = require("./routes/contacts.routes");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
app.listen(PORT, () => {
  console.log(`✅ ImmoConnect API démarrée sur http://localhost:${PORT}`);
});
