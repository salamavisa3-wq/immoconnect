# SakeurImmo — Plateforme SaaS immobilière (Sénégal)

Plateforme permettant aux propriétaires de publier directement leurs biens
(terrains, appartements à vendre/louer, appartements meublés, maisons,
villas à vendre/louer...) moyennant des **frais d'inscription uniques de
5000 FCFA**, payables par Orange Money ou Wave via **PayTech**.

## Architecture

```
sakeurimmo/
├── backend/              API REST Node.js / Express + libSQL (SQLite en local, Turso en prod)
│   ├── server.js         Point d'entrée
│   ├── db.js             Schéma de base de données
│   ├── seed-admin.js     Création d'un compte administrateur
│   ├── middleware/auth.js
│   └── routes/
│       ├── auth.routes.js       inscription / connexion
│       ├── payments.routes.js   paiement PayTech (5000 FCFA)
│       └── biens.routes.js      CRUD des annonces + modération
└── frontend/             Site statique HTML / CSS / JS (aucun framework requis)
    ├── index.html            page d'accueil
    ├── inscription.html      inscription + paiement
    ├── connexion.html
    ├── tableau-de-bord.html  espace propriétaire
    ├── annonces.html         recherche publique
    ├── annonce.html          détail d'une annonce
    └── admin.html            modération des annonces
```

## Installation

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# Éditez .env : JWT_SECRET, et si disponibles vos clés PAYTECH_API_KEY / PAYTECH_API_SECRET
npm start
```

L'API démarre sur `http://localhost:3001`.

> **Sans clés PayTech configurées**, le système bascule automatiquement en
> **mode démo** : une page de simulation de paiement permet de tester tout
> le parcours (inscription → paiement → activation du compte → publication
> d'annonces) sans compte marchand réel. Idéal pour le développement.

### 2. Créer un compte administrateur (modération des annonces)

```bash
node seed-admin.js admin@sakeurimmo.sn VotreMotDePasse123
```

Connectez-vous ensuite sur `connexion.html` avec cet email, puis ouvrez
`admin.html` pour valider ou refuser les annonces soumises.

### 3. Frontend

Le frontend est 100% statique : ouvrez `frontend/index.html` avec une
extension type *Live Server*, ou servez le dossier :

```bash
cd frontend
npx serve -l 5500
```

Mettez à jour `FRONTEND_URL` dans `backend/.env` pour qu'il corresponde à
l'adresse utilisée (ex : `http://localhost:5500`).

## Déploiement en production (disque éphémère : Render, Railway, Fly.io...)

La plupart des hébergeurs Node.js gratuits/pas chers ont un **disque éphémère**
(remis à zéro à chaque redéploiement). Ce projet est donc conçu pour tourner
sans écriture disque persistante en production :

1. **Base de données** — créez une base sur [turso.tech](https://turso.tech)
   (gratuit) et renseignez `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` dans
   les variables d'environnement de votre service. Sans ces variables,
   `db.js` utilise automatiquement un fichier SQLite local (pratique en dev).
2. **Images des annonces** — créez un compte sur
   [cloudinary.com](https://cloudinary.com) (gratuit) et renseignez
   `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`.
   Sans ces variables, `biens.routes.js` bascule sur le disque local
   `./uploads` (dev uniquement — perdu à chaque redéploiement en prod).
3. **Frontend** — servi directement par le backend Express
   (`express.static` sur `../frontend`), donc un seul service à déployer :
   pas de configuration CORS/sous-domaine séparée nécessaire.

## Paiement réel avec PayTech (production)

1. Créez un compte marchand sur [paytech.sn](https://paytech.sn).
2. Récupérez votre `API_KEY` et `API_SECRET` dans le tableau de bord.
3. Renseignez-les dans `backend/.env`, avec `PAYTECH_ENV=prod`.
4. Déclarez l'URL d'IPN dans votre tableau de bord PayTech :
   `https://votre-domaine.com/api/payments/ipn`
5. Le paiement redirige l'utilisateur vers Orange Money ou Wave selon son
   choix (seules ces deux méthodes sont proposées, via `target_payment`) ;
   l'IPN active automatiquement le compte propriétaire dès confirmation
   du paiement.

## Flux fonctionnel

1. **Inscription** (`POST /api/auth/register`) — le compte est créé avec le
   statut `en_attente_paiement`.
2. **Paiement** (`POST /api/payments/initier`) — génère une session de
   paiement PayTech de 5000 FCFA.
3. **Confirmation** — l'IPN PayTech (`POST /api/payments/ipn`) marque le
   paiement `reussi` et passe le compte à `actif`.
4. **Publication** (`POST /api/biens`, réservé aux comptes `actif`) — le
   propriétaire soumet son annonce (photos, prix, description...), qui
   entre en statut `en_attente`.
5. **Modération** (`PATCH /api/biens/admin/:id/statut`) — un administrateur
   valide (`publie`) ou refuse (`refuse`) l'annonce avant sa mise en ligne
   publique.

## Types de biens pris en charge

`terrain` · `appartement_vente` · `appartement_location` ·
`appartement_meuble` · `maison_vente` · `maison_location` ·
`villa_vente` · `villa_location`

## Aller plus loin (roadmap suggérée)

- Notifications SMS/WhatsApp (ex. Twilio, ou passerelle locale) à la
  publication et lors de messages d'acheteurs intéressés.
- Messagerie interne acheteur ↔ propriétaire (au lieu d'afficher les
  coordonnées directement).
- Mise en avant payante d'annonces (`type = 'mise_en_avant'`, déjà prévu
  dans le schéma `paiements`).
- Migration Turso → PostgreSQL pour la très forte montée en charge (le code
  SQL est volontairement simple à adapter).
- Tableau de bord analytique (vues, taux de conversion par type de bien).

## Sécurité

- Mots de passe hashés avec bcrypt.
- Authentification par JWT (expiration configurable).
- Vérification de signature de l'IPN PayTech (SHA-256 de la clé/secret).
- Limitation de débit sur l'API (`express-rate-limit`).
- Validation des types/tailles de fichiers uploadés (images uniquement, 5 Mo max).

Ce projet est une base solide et fonctionnelle : avant une mise en
production réelle, faites auditer la gestion des secrets, ajoutez des
tests automatisés et un HTTPS strict (reverse proxy Nginx + certificat).
