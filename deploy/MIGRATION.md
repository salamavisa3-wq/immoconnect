# Migration SakeurImmo → VPS gratuit (Google Cloud Always Free)

Runbook spécifique à SakeurImmo. Le skill générique est `vps-deploy` v2.1.0
(`~/.claude/skills/vps-deploy/`, multi-app, Oracle **ou** Google Cloud).
Adaptations : base **Turso** (externe, pas de Postgres → pas de service `db`
dans le compose), port **3001**, healthcheck **`/api/sante`**
(`HEALTHZ_PATH` dans `.env`, voir `.env.example`), **Cloudflare** en edge
(certificat d'origine, pas de Let's Encrypt auto). SakeurImmo peut cohabiter
avec d'autres apps sur le même VPS — le Caddy de l'hôte est **partagé**, pas
embarqué dans ce repo.

**05/09/2026 — Pivot Oracle → Google Cloud** : Oracle Cloud refuse la
création de compte pour le Sénégal (pays de résidence, pas de sanctions —
juste un blocage de vérification côté Oracle). Les scripts `deploy/oci-*.sh`
sont conservés pour référence mais **superseded** (voir en-tête de chacun) ;
seule la Phase 0 change, tout le reste (Phases 1 à 7) est inchangé car
`provision.sh`/`onboard-app.sh` sont agnostiques au provider.

## Architecture cible

```
Cloudflare (edge, inchangé) → VPS Google Cloud (e2-micro) → Caddy (PARTAGÉ hôte) → app Node (port 3001, réseau caddy_net)
   Turso (DB) · Cloudinary (images) · PayPal · Brevo → externes, inchangés, gratuits
```

SakeurImmo étant seul sur son compose (pas de conteneur DB, Turso externe),
il tient confortablement sur le budget e2-micro (1 Go RAM) — voir
`~/.claude/skills/vps-deploy/references/multi-app-architecture.md` §
*Variante Google Cloud* avant d'onboarder une 2e app sur le même VPS.

## Phase 0 — Provisionner Google Cloud

**Prérequis, à faire une seule fois (action utilisateur, ne peut pas être
automatisée — nécessite ton compte/carte)** :
1. Créer un compte + projet dédié sur https://cloud.google.com/free (carte
   bancaire demandée pour vérification, aucun débit si les quotas Always
   Free sont respectés).
2. Poser un **budget d'alerte à 0,01 $** (Console → Facturation → Budgets et
   alertes) — voir `~/.claude/skills/vps-deploy/references/gcp-cloud-setup.md`.
   Contrairement à Oracle, GCP peut facturer directement une erreur de
   config sans bloquer le provisionnement.
3. `gcloud auth login` + `gcloud config set project <PROJECT_ID>` +
   `gcloud services enable compute.googleapis.com` (gcloud CLI à installer
   en local, ou utiliser Google Cloud Shell dans le navigateur — déjà
   authentifié, aucune installation requise).

**Provisionnement (garde-fou intégré)** :

```bash
bash ~/.claude/skills/vps-deploy/scripts/gcp-provision.sh \
  <PROJECT_ID> sakeurimmo-prod ~/.ssh/id_ed25519_sakeurimmo.pub us-central1-a
```

Le script refuse toute zone hors `us-west1`/`us-central1`/`us-east1` et
refuse de créer une 2e instance `e2-micro` si une existe déjà sur le projet.
Garde-fou complet : skill `gcp-free-tier-guard` (`/gcp-free-tier-guard`).

**Alternative — console** : suivre
`~/.claude/skills/vps-deploy/references/gcp-cloud-setup.md` (instance
Ubuntu 24.04, type `e2-micro`, région `us-west1`/`us-central1`/`us-east1`
uniquement, disque `pd-standard` 30 Go, ports 22/80/443 ouverts).

## Phase 1 — Transformer le VPS en hôte multi-app

```bash
ssh ubuntu@<IP> "mkdir -p /tmp/vps-deploy"
scp -r ~/.claude/skills/vps-deploy/scripts ~/.claude/skills/vps-deploy/templates ubuntu@<IP>:/tmp/vps-deploy/
ssh ubuntu@<IP> "sudo bash /tmp/vps-deploy/scripts/provision.sh deploy '<TA_CLE_PUBLIQUE_DEPLOY>'"
ssh deploy@<IP> "docker ps"   # → conteneur 'caddy' (partagé) up
```

## Phase 1.5 — Onboarder SakeurImmo

```bash
ssh deploy@<IP> "sudo bash /opt/scripts/onboard-app.sh sakeurimmo sakeurimmo.com node 3001"
```
Crée `/opt/apps/sakeurimmo/`, écrit une route Caddy par défaut (Let's Encrypt
auto) dans `/opt/caddy/apps/sakeurimmo.caddy` — **à remplacer par la version
avec certificat d'origine Cloudflare au Phase 6** (voir plus bas), et
programme le cron de backup générique (harmless pour SakeurImmo : pas de
service `db` Postgres/MySQL à dumper, voir Phase 5 pour le vrai mécanisme Turso).

## Phase 2 — .env sur le serveur

Copier les valeurs **actuelles** depuis Render (Settings → Environment) vers
`/opt/apps/sakeurimmo/.env` (modèle : `.env.example` à la racine du repo).
Variables critiques : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`CLOUDINARY_*`, `JWT_SECRET`, `FRONTEND_URL=https://sakeurimmo.com`,
`PORT=3001`, `NODE_ENV=production`, `PUBLIC_URL=sakeurimmo.com`,
`HEALTHZ_PATH=/api/sante`.

```bash
ssh deploy@<IP> "nano /opt/apps/sakeurimmo/.env"
```

## Phase 3 — Test sans cutover (port alternatif)

Avant de toucher le DNS, tester sur un port/domaine de secours :

```bash
ssh deploy@<IP> "cd /opt/apps/sakeurimmo && docker compose up -d --build"
ssh deploy@<IP> "curl -s http://localhost:3001/api/sante"
```

## Phase 4 — GitHub Actions

1. Générer une clé de déploiement : `ssh-keygen -t ed25519 -f deploy_key -N ""`
2. Ajouter la clé publique à `/home/deploy/.ssh/authorized_keys` sur le VPS
3. Secrets GitHub (Settings → Secrets and variables → Actions) :
   `VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_SSH_KEY`
4. Test : `workflow_dispatch` sur `vps-deploy.yml` → workflow vert. Le
   `SCRIPT_AFTER` appelle `/opt/scripts/deploy-rollback.sh` (health-gated,
   rollback auto si `/api/sante` ne répond pas 200 sous 90s après déploiement).

## Phase 5 — Sauvegardes

```bash
# Sur le VPS
curl -sSfL https://get.turso.tech/install.sh | bash
export TURSO_API_TOKEN=<token>   # à ajouter au .env
# rclone + remote "oci" (Object Storage OCI, 10 Go gratuits)
crontab -e   # → 0 3 * * * /opt/apps/sakeurimmo/deploy/backup-turso.sh
```

## Phase 6 — Cutover (le moment où le site bascule)

1. Vérifier que le VPS répond : `curl -s http://<IP_VPS>/api/sante` → `{"statut":"ok"}`
2. **Certificat d'origine Cloudflare** (le site est derrière Cloudflare) :
   - Cloudflare Dashboard → SSL/TLS → Origin Server → Create Certificate
   - Copier le certificat + la clé sur le VPS : `/opt/apps/sakeurimmo/certs/origin.pem` + `origin.key`
   - Remplacer `/opt/caddy/apps/sakeurimmo.caddy` (généré par `onboard-app.sh`
     en Phase 1.5, Let's Encrypt auto) par la version avec certificat
     d'origine (voir `Caddyfile` à la racine de ce repo, tenu à jour comme
     référence) puis recharger : `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`
     — **ne casse pas les autres apps** déjà onboardées sur le même VPS.
   - SSL/TLS mode Cloudflare : **Full (strict)**
3. **DNS** : Cloudflare → DNS → Records → changer l'A record `sakeurimmo.com`
   de l'IP Render vers l'IP du VPS (garder le proxy orange).
4. Vérifier : `curl -sI https://sakeurimmo.com` → `Server: cloudflare`, plus de `x-render-origin-server`.
5. Purger le cache Cloudflare (Purge Everything).

## Phase 7 (optionnel) — Dashboard GA4

`seo-automation/dashboard` (Flask) reste sur Render free tier. À migrer plus
tard si tu veux quitter Render complètement : **onboarder comme une 2e app**
sur le même VPS (`onboard-app.sh seo-dashboard <sous-domaine> python <port>`)
plutôt que d'ajouter un service au compose de SakeurImmo — garde les deux
apps isolées réseau (voir `references/multi-app-architecture.md` du skill).

## Rollback

- **Déploiement cassé (healthcheck /api/sante échoue)** : automatique — `deploy-rollback.sh` retag et relance l'image précédente sous 90s, aucune action requise.
- **Déploiement "healthy" mais buggé fonctionnellement** : `git revert <sha>` + push → le workflow redéploie (health-gated) la version revert.
- **Site** : remettre l'A record Cloudflare sur l'IP Render (le VPS reste en place).
