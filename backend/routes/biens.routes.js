// routes/biens.routes.js — Gestion des annonces immobilières :
// terrains, appartements (vente/location/meublés), maisons, villas (vente/location)...

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const { authRequis, compteActifRequis, adminRequis } = require("../middleware/auth");

const router = express.Router();

const TYPES_VALIDES = [
  "terrain",
  "appartement_vente",
  "appartement_location",
  "appartement_meuble",
  "maison_vente",
  "maison_location",
  "villa_vente",
  "villa_location",
];

// --- Upload d'images ---
const dossierUploads = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(dossierUploads)) fs.mkdirSync(dossierUploads, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dossierUploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("Seules les images JPEG, PNG ou WEBP sont acceptées."));
    }
    cb(null, true);
  },
});

// GET /api/biens — liste publique avec filtres (type, ville, prix min/max, transaction)
router.get("/", (req, res) => {
  const { type, ville, transaction, prix_min, prix_max, chambres, page = 1, limite = 20 } = req.query;

  const conditions = ["statut = 'publie'"];
  const params = [];

  if (type && TYPES_VALIDES.includes(type)) {
    conditions.push("type_bien = ?");
    params.push(type);
  }
  if (ville) {
    conditions.push("ville LIKE ?");
    params.push(`%${ville}%`);
  }
  if (transaction === "vente" || transaction === "location") {
    conditions.push("transaction_type = ?");
    params.push(transaction);
  }
  if (prix_min) {
    conditions.push("prix >= ?");
    params.push(Number(prix_min));
  }
  if (prix_max) {
    conditions.push("prix <= ?");
    params.push(Number(prix_max));
  }
  if (chambres) {
    conditions.push("chambres >= ?");
    params.push(Number(chambres));
  }

  const offset = (Math.max(1, Number(page)) - 1) * Number(limite);
  const where = conditions.join(" AND ");

  const total = db.prepare(`SELECT COUNT(*) AS n FROM biens WHERE ${where}`).get(...params).n;
  const biens = db
    .prepare(
      `SELECT * FROM biens WHERE ${where}
       ORDER BY
         CASE WHEN mise_en_avant = 1
                   AND (mise_en_avant_jusqu_au IS NULL OR mise_en_avant_jusqu_au > datetime('now'))
              THEN 1 ELSE 0 END DESC,
         cree_le DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, Number(limite), offset);

  res.json({
    total,
    page: Number(page),
    limite: Number(limite),
    resultats: biens.map((b) => ({ ...b, images: JSON.parse(b.images || "[]") })),
  });
});

// GET /api/biens/:id — détail public d'une annonce publiée
router.get("/:id", (req, res) => {
  const bien = db.prepare("SELECT * FROM biens WHERE id = ?").get(req.params.id);
  if (!bien || bien.statut !== "publie") {
    return res.status(404).json({ erreur: "Annonce introuvable." });
  }
  db.prepare("UPDATE biens SET vues = vues + 1 WHERE id = ?").run(bien.id);
  res.json({ ...bien, images: JSON.parse(bien.images || "[]") });
});

// GET /api/biens/moi/liste — annonces du propriétaire connecté (tous statuts)
router.get("/moi/liste", authRequis, (req, res) => {
  const biens = db
    .prepare("SELECT * FROM biens WHERE user_id = ? ORDER BY cree_le DESC")
    .all(req.user.id);
  res.json(biens.map((b) => ({ ...b, images: JSON.parse(b.images || "[]") })));
});

// POST /api/biens — créer une annonce (compte actif = à jour des 5000 FCFA requis)
router.post("/", authRequis, compteActifRequis, upload.array("images", 8), (req, res) => {
  const {
    titre,
    type_bien,
    transaction_type,
    ville,
    quartier,
    prix,
    superficie,
    chambres,
    salles_bain,
    description,
  } = req.body;

  if (!titre || !type_bien || !transaction_type || !ville || !prix) {
    return res.status(400).json({ erreur: "Titre, type de bien, transaction, ville et prix sont obligatoires." });
  }
  if (!TYPES_VALIDES.includes(type_bien)) {
    return res.status(400).json({ erreur: "Type de bien invalide." });
  }

  const images = (req.files || []).map((f) => `/uploads/${f.filename}`);

  const info = db
    .prepare(
      `INSERT INTO biens
        (user_id, titre, type_bien, transaction_type, ville, quartier, prix, superficie, chambres, salles_bain, description, images, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente')`
    )
    .run(
      req.user.id,
      titre.trim(),
      type_bien,
      transaction_type,
      ville.trim(),
      quartier || null,
      Number(prix),
      superficie ? Number(superficie) : null,
      chambres ? Number(chambres) : null,
      salles_bain ? Number(salles_bain) : null,
      description || null,
      JSON.stringify(images)
    );

  const bien = db.prepare("SELECT * FROM biens WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({
    message: "Annonce soumise. Elle sera visible publiquement après validation par notre équipe.",
    bien: { ...bien, images: JSON.parse(bien.images) },
  });
});

// PUT /api/biens/:id — modifier sa propre annonce
router.put("/:id", authRequis, (req, res) => {
  const bien = db.prepare("SELECT * FROM biens WHERE id = ?").get(req.params.id);
  if (!bien) return res.status(404).json({ erreur: "Annonce introuvable." });
  if (bien.user_id !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ erreur: "Vous ne pouvez modifier que vos propres annonces." });
  }

  const champsModifiables = ["titre", "prix", "superficie", "chambres", "salles_bain", "description", "quartier", "ville"];
  const updates = [];
  const params = [];
  for (const champ of champsModifiables) {
    if (req.body[champ] !== undefined) {
      updates.push(`${champ} = ?`);
      params.push(req.body[champ]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ erreur: "Aucune donnée à modifier." });

  // Toute modification repasse l'annonce en attente de modération
  updates.push("statut = 'en_attente'");
  params.push(req.params.id);

  db.prepare(`UPDATE biens SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  res.json({ message: "Annonce mise à jour, en attente de nouvelle validation." });
});

// DELETE /api/biens/:id
router.delete("/:id", authRequis, (req, res) => {
  const bien = db.prepare("SELECT * FROM biens WHERE id = ?").get(req.params.id);
  if (!bien) return res.status(404).json({ erreur: "Annonce introuvable." });
  if (bien.user_id !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ erreur: "Vous ne pouvez supprimer que vos propres annonces." });
  }
  db.prepare("DELETE FROM biens WHERE id = ?").run(req.params.id);
  res.json({ message: "Annonce supprimée." });
});

// --- Modération (admin) ---

// GET /api/biens/admin/en-attente
router.get("/admin/en-attente", authRequis, adminRequis, (req, res) => {
  const biens = db.prepare("SELECT * FROM biens WHERE statut = 'en_attente' ORDER BY cree_le ASC").all();
  res.json(biens.map((b) => ({ ...b, images: JSON.parse(b.images || "[]") })));
});

// PATCH /api/biens/admin/:id/statut  { statut: 'publie' | 'refuse' }
router.patch("/admin/:id/statut", authRequis, adminRequis, (req, res) => {
  const { statut } = req.body;
  if (!["publie", "refuse", "archive"].includes(statut)) {
    return res.status(400).json({ erreur: "Statut invalide." });
  }
  db.prepare("UPDATE biens SET statut = ? WHERE id = ?").run(statut, req.params.id);
  res.json({ message: `Annonce mise à jour : ${statut}.` });
});

module.exports = router;
