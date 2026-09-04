# Migration SakeurImmo → VPS Oracle Cloud Free Tier

Runbook spécifique à SakeurImmo. Le skill générique est `vps-deploy`
(`~/.claude/skills/vps-deploy/`). Adaptations : base **Turso** (externe, pas de
Postgres), port **3001**, healthcheck **`/api/sante`**, **Cloudflare** en edge.

## Architecture cible

```
Cloudflare (edge, inchangé) → VPS Oracle → Caddy → app Node (port 3001)
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

## Phase 1 — Durcir + Docker

```bash
scp ~/.claude/skills/vps-deploy/scripts/provision.sh ubuntu@<IP>:/tmp/
ssh ubuntu@<IP> "sudo bash /tmp/provision.sh deploy '<TA_CLE_PUBLIQUE_DEPLOY>'"
ssh deploy@<IP> "docker --version && docker compose version"
```

## Phase 2 — .env sur le serveur

Copier les valeurs **actuelles** depuis Render (Settings → Environment) vers
`/opt/sakeurimmo/.env` (modèle : `.env.example` à la racine du repo). Variables
critiques : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CLOUDINARY_*`,
`JWT_SECRET`, `FRONTEND_URL=https://sakeurimmo.com`, `PORT=3001`,
`NODE_ENV=production`.

```bash
ssh deploy@<IP> "mkdir -p /opt/sakeurimmo && nano /opt/sakeurimmo/.env"
```

## Phase 3 — Test sans cutover (port alternatif)

Avant de toucher le DNS, tester sur un port/domaine de secours :

```bash
ssh deploy@<IP> "cd /opt/sakeurimmo && docker compose up -d --build"
ssh deploy@<IP> "curl -s http://localhost:3001/api/sante"
```

## Phase 4 — GitHub Actions

1. Générer une clé de déploiement : `ssh-keygen -t ed25519 -f deploy_key -N ""`
2. Ajouter la clé publique à `/home/deploy/.ssh/authorized_keys` sur le VPS
3. Secrets GitHub (Settings → Secrets and variables → Actions) :
   `VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_SSH_KEY`
4. Test : `workflow_dispatch` sur `vps-deploy.yml` → workflow vert

## Phase 5 — Sauvegardes

```bash
# Sur le VPS
curl -sSfL https://get.turso.tech/install.sh | bash
export TURSO_API_TOKEN=<token>   # à ajouter au .env
# rclone + remote "oci" (Object Storage OCI, 10 Go gratuits)
crontab -e   # → 0 3 * * * /opt/sakeurimmo/deploy/backup-turso.sh
```

## Phase 6 — Cutover (le moment où le site bascule)

1. Vérifier que le VPS répond : `curl -s http://<IP_VPS>/api/sante` → `{"statut":"ok"}`
2. **Certificat d'origine Cloudflare** (le site est derrière Cloudflare) :
   - Cloudflare Dashboard → SSL/TLS → Origin Server → Create Certificate
   - Copier le certificat + la clé sur le VPS : `/opt/sakeurimmo/certs/origin.pem` + `origin.key`
   - Adapter le `Caddyfile` pour charger le certificat d'origine (voir ci-dessous)
   - SSL/TLS mode : **Full (strict)**
3. **DNS** : Cloudflare → DNS → Records → changer l'A record `sakeurimmo.com`
   de l'IP Render vers l'IP du VPS (garder le proxy orange).
4. Vérifier : `curl -sI https://sakeurimmo.com` → `Server: cloudflare`, plus de `x-render-origin-server`.
5. Purger le cache Cloudflare (Purge Everything).

### Caddyfile avec certificat d'origine Cloudflare

```
sakeurimmo.com {
    tls /opt/sakeurimmo/certs/origin.pem /opt/sakeurimmo/certs/origin.key
    reverse_proxy app:3001
}
```

## Phase 7 (optionnel) — Dashboard GA4

`seo-automation/dashboard` (Flask) reste sur Render free tier. À migrer plus
tard si tu veux quitter Render complètement (même pattern : Dockerfile déjà
présent, ajouter un service au compose).

## Rollback

- **Code** : `git revert <sha>` + push → le workflow redéploie.
- **Site** : remettre l'A record Cloudflare sur l'IP Render (le VPS reste en place).
