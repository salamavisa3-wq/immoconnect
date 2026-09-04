# Migration SakeurImmo → VPS Oracle Cloud Free Tier

Runbook spécifique à SakeurImmo. Le skill générique est `vps-deploy` v2
(`~/.claude/skills/vps-deploy/`, multi-app). Adaptations : base **Turso**
(externe, pas de Postgres → pas de service `db` dans le compose), port
**3001**, healthcheck **`/api/sante`** (`HEALTHZ_PATH` dans `.env`, voir
`.env.example`), **Cloudflare** en edge (certificat d'origine, pas de Let's
Encrypt auto). SakeurImmo peut cohabiter avec d'autres apps sur le même VPS
(ex. DelegPharma) — le Caddy de l'hôte est **partagé**, pas embarqué dans ce repo.

## Architecture cible

```
Cloudflare (edge, inchangé) → VPS Oracle → Caddy (PARTAGÉ hôte) → app Node (port 3001, réseau caddy_net)
   Turso (DB) · Cloudinary (images) · PayPal · Brevo → externes, inchangés, gratuits
```

## Phase 0 — Provisionner Oracle Cloud

**Option A — automatisé (recommandé)** en 3 sous-étapes, toutes OCI CLI :

```bash
# 0.1 — Config non-interactive : génère ~/.oci/config + clé API, affiche l'action manuelle unique.
OCI_TENANCY_OCID=ocid1.tenancy... OCI_USER_OCID=ocid1.user... OCI_REGION=eu-marseille-1 \
  bash deploy/oci-config.sh
#     → Ajouter ~/.oci/oci_api_key_public.pem via Console → Profil → API keys.
#     → Vérif : oci iam compartment list --compartment-id $OCI_TENANCY_OCID (test = OCID compartiment racine)

# 0.2 — Réseau VCN + subnet public (Always Free) → affiche OCI_SUBNET_OCID à exporter.
OCI_COMPARTMENT_OCID=ocid1.compartment... bash deploy/oci-network.sh

# 0.3 — Instance A1.Flex + ouverture des ports 22/80/443 → affiche l'IP publique.
# Prérequis : exporter OCI_COMPARTMENT_OCID, OCI_SUBNET_OCID depuis 0.2.
SSH_PUBKEY="$(cat ~/.ssh/id_ed25519_sakeurimmo.pub)" bash deploy/oci-provision.sh
```

Les scripts **refusent tout dépassement des limites Always Free** (4 OCPU /
24 Go / 200 Go, 2 VCN max) → aucun paiement possible. Garde-fou complet :
skill `oracle-free-tier-guard` (`/oracle-free-tier-guard`).

**Option B — console** : suivre
`~/.claude/skills/vps-deploy/references/oracle-cloud-setup.md` :
instance Ubuntu 24.04 ARM, shape `VM.Standard.A1.Flex` (4 OCPU / 24 Go),
200 Go boot volume, ports 22/80/443 ouverts.

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
