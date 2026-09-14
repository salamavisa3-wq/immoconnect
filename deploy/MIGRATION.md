# Migration SakeurImmo → Cloudflare Workers (Free tier, sans carte)

**14/09/2026 — 2e pivot.** Oracle Cloud (compte refusé pour le Sénégal) puis
Google Cloud (carte + vérification identité requises pour créer le compte —
étape que l'automatisation ne doit pas franchir) ont été abandonnés au profit
de **Cloudflare Workers** : hébergement serverless, confirmé sans carte
bancaire à l'inscription, et `sakeurimmo.com` est déjà derrière Cloudflare
(edge), donc pas de changement de nameservers à faire.

Ceci **sort du champ du skill `vps-deploy`** (pas de VPS, pas de Docker, pas
de Caddy). Les fichiers `deploy/oci-*.sh`, `Dockerfile`, `docker-compose.yml`,
`Caddyfile`, `.github/workflows/vps-deploy.yml` sont **obsolètes** (conservés
tels quels, à supprimer plus tard si le cutover Cloudflare est validé).

## Architecture

```
Cloudflare edge
 ├── Assets (frontend/ servi directement, aucune invocation Worker)
 └── Worker (backend/worker-entry.mjs → Express via cloudflare:node)
       ↳ routes forcées via run_worker_first (wrangler.jsonc) :
         /annonces.html, /categorie/*, /villes/*, /annonce/*, /sitemap.xml, /api/*
Turso (DB, HTTP edge-safe via @libsql/client/web) · Cloudinary · PayPal · Brevo
```

## Ce qui a déjà été fait (code)

- `wrangler.jsonc` (racine) : config Worker + assets + `run_worker_first`.
- `backend/worker-entry.mjs` : point d'entrée edge (`cloudflare:node`,
  `httpServerHandler`) + `avecEnv()` (AsyncLocalStorage) pour faire circuler
  `env` (donc `env.ASSETS`) jusque dans Express.
- `backend/cf-context.js` (nouveau) : `getEnv()` / `avecEnv()` / `estSurWorkers()`.
- `backend/server.js` : `app.listen()` sorti du `.then()` DB (doit s'exécuter
  de façon synchrone pour l'adaptateur Workers) + garde-fou `db.pretASync` par
  requête à la place ; `module.exports = app` ; nouveau helper `lireAsset()`
  qui lit `frontend/*.html` via `env.ASSETS.fetch()` sous Workers (fs n'a pas
  accès aux fichiers du binding assets) ou via `fs` en Node classique — les
  7 lectures de templates (fiche annonce, grilles SSR, 404) passent par là ;
  `express.static` (uploads + frontend complet) désactivé sous Workers
  (redondant : Assets sert déjà tout ce qui n'est pas dans `run_worker_first`) ;
  limiteur de débit instancié paresseusement (son store par défaut démarre un
  `setInterval`, interdit en portée globale sous Workers).
- `backend/db.js` : `@libsql/client/web` (HTTP pur, edge-safe) détecté par
  runtime (`navigator.userAgent === "Cloudflare-Workers"`, pas par la simple
  présence de `TURSO_DATABASE_URL` — sinon le client natif, qui plante au
  chargement sous Workers, reste sollicitable par erreur de config) ;
  `pretASync` converti en getter paresseux (la 1re requête déclenche
  `initialiser()`, jamais le chargement du module — même raison que le
  limiteur : pas d'I/O asynchrone en portée globale sous Workers).
- `backend/routes/biens.routes.js` : le calcul de `dossierUploads`
  (`__dirname`, absent du bundle Workers) n'est évalué que si Cloudinary est
  inactif (jamais le cas en prod).
- `package.json` (racine) : `wrangler` en devDependency.
- `.github/workflows/cloudflare-deploy.yml` : déploiement CI/CD.

**Validé en local** (`wrangler dev` + `.dev.vars` factice, non commité —
voir `.gitignore`) : démarrage du Worker sans crash, assets statiques servis
en 200 sans invoquer le Worker, routes dynamiques (`/api/sante`,
`/sitemap.xml`) atteignent bien la logique métier (échec propre en 500 dû aux
fausses creds Turso de test, pas un crash), et surtout **`env.ASSETS.fetch()`
confirmé fonctionnel** à travers l'AsyncLocalStorage (page 404 complète
récupérée correctement) — c'était le point le plus incertain de toute
l'architecture.

## Ce qu'il reste à faire (actions utilisateur — nécessitent ton compte)

### 1. Compte Cloudflare (si pas déjà fait pour ce domaine)
`sakeurimmo.com` semble déjà géré par Cloudflare — si un compte existe déjà
(Dashboard → le domaine apparaît), passer à l'étape 2.

### 2. Jeton API Cloudflare (scope minimal)
Dashboard Cloudflare → **My Profile → API Tokens → Create Token** → template
« Edit Cloudflare Workers » (donne uniquement les droits Workers Scripts +
Workers Routes + Zone Read sur `sakeurimmo.com`, pas un accès compte complet).
Noter aussi l'**Account ID** (visible dans l'URL du dashboard ou en bas de la
page d'un domaine).

### 3. Secrets GitHub
Repo → Settings → Secrets and variables → Actions :
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### 4. Secrets applicatifs (une seule fois, pas dans le repo ni le workflow)
```bash
npm install -g wrangler   # ou npx wrangler
wrangler login
wrangler secret put TURSO_DATABASE_URL
wrangler secret put TURSO_AUTH_TOKEN
wrangler secret put JWT_SECRET
wrangler secret put CLOUDINARY_CLOUD_NAME
wrangler secret put CLOUDINARY_API_KEY
wrangler secret put CLOUDINARY_API_SECRET
wrangler secret put FRONTEND_URL     # https://sakeurimmo.com
# PAYPAL_*/BREVO_* si utilisés en prod
```

### 5. Premier déploiement (test, avant cutover DNS — le domaine y est déjà routé via wrangler.jsonc, donc ceci EST le cutover)
```bash
npm install && npm install --prefix backend
npx wrangler deploy
curl -s https://sakeurimmo.com/api/sante   # → {"statut":"ok",...}
```
`wrangler.jsonc` route déjà `sakeurimmo.com` et `www.sakeurimmo.com` vers ce
Worker (`custom_domain: true`, auto-provisionné car le domaine est déjà sur
Cloudflare) — **le premier `wrangler deploy` réussi bascule le trafic
immédiatement**. Prévoir de le faire à un moment calme, pas en pleine journée
de trafic.

### 6. Après cutover validé
- Basculer `push master` définitivement sur `cloudflare-deploy.yml` (déjà actif).
- Supprimer `render-deploy.yml` et `keepalive.yml` (Render, plus utile — Workers
  ne dort jamais) et `vps-deploy.yml` + fichiers `oci-*.sh`/Docker/Caddy.
- Downgrade ou suppression du service Render (pour ne plus rien payer/consommer
  côté Render — il est en free tier donc 0 coût, mais autant nettoyer).

## Rollback

- **Déploiement Worker cassé** : `wrangler rollback` (revient à la version
  précédente instantanément — Cloudflare garde l'historique des déploiements).
- **Cutover complet à annuler** : retirer les entrées `routes` de
  `wrangler.jsonc` et redéployer, ou pointer à nouveau le DNS vers Render tant
  que ce service est encore actif.
