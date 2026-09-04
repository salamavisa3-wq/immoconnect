#!/usr/bin/env bash
# ============================================================
# oci-automate.sh — Enchaîne les 3 étapes OCI (config → réseau →
# instance) puis pose le secret GitHub VPS_HOST dès que l'IP est
# connue. Une seule commande, un seul point d'entrée.
#
# Prérequis :
#   - OCI CLI :        oci --version        (3.92.0 OK)
#   - clé SSH :        ~/.ssh/id_ed25519_sakeurimmo(.pub)
#   - gh authentifié : gh auth status       (salamavisa3-wq/immoconnect)
#
# Usage :
#   OCI_TENANCY_OCID=ocid1.tenancy... OCI_USER_OCID=ocid1.user... \
#   OCI_REGION=eu-marseille-1 bash deploy/oci-automate.sh
#   (variables absentes → saisie interactive UNE fois)
#
# GARDE-FOUS :
#   - hérite des limites Always Free (oci-provision.sh refuse tout
#     dépassement : OCPU>4, RAM>24 Go, boot>200 Go → 0 € possible)
#   - anti-redondance : une instance sakeurimmo-prod déjà RUNNING →
#     on récupère son IP au lieu d'en créer une seconde (Always Free
#     = 1×A1.Flex).
# ============================================================
set -euo pipefail

REPO="salamavisa3-wq/immoconnect"
INSTANCE_NAME="sakeurimmo-prod"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v oci >/dev/null 2>&1 || { echo "❌ OCI CLI absent. Voir deploy/MIGRATION.md Phase 0."; exit 1; }
[ -d "$SCRIPT_DIR" ] || { echo "❌ deploy/ introuvable. Lance depuis la racine du repo."; exit 1; }

# --- Les 3 valeurs (env en priorité, sinon saisie interactive une fois) ---
TENANCY="${OCI_TENANCY_OCID:-}"
USER_OCID="${OCI_USER_OCID:-}"
REGION="${OCI_REGION:-}"
[ -n "$TENANCY" ]   || read -rp "Tenancy OCID : " TENANCY
[ -n "$USER_OCID" ] || read -rp "User OCID   : " USER_OCID
[ -n "$REGION" ]    || read -rp "Région OCI   : " REGION

echo "=============================================="
echo "ÉTAPE 1/3 — Config OCI CLI (clé API + fingerprint)"
echo "=============================================="
OCI_TENANCY_OCID="$TENANCY" OCI_USER_OCID="$USER_OCID" OCI_REGION="$REGION" \
  bash "$SCRIPT_DIR/oci-config.sh"

echo ""
echo "==> Vérification de l'authentification (oci iam compartment list)..."
if ! TENANCY="$TENANCY" oci iam compartment list --compartment-id "$TENANCY" >/dev/null 2>&1; then
  echo "❌ Authentification refusée pour l'instant."
  echo ""
  echo "   ACTION MANUELLE UNIQUE — ajoute la clé API dans la console :"
  echo "   1. https://cloud.oracle.com → Profil → Mon profil → API keys"
  echo "   2. « Add API key » → coller le contenu de ~/.oci/oci_api_key_public.pem"
  echo "      (fingerprint affiché = celui calculé par oci-config.sh)"
  echo "   3. Relance : bash deploy/oci-automate.sh  (mêmes variables)"
  echo ""
  exit 1
fi
echo "✅ Authentification OK — compartiment racine lisible."

echo ""
echo "=============================================="
echo "ÉTAPE 2/3 — Réseau VCN + subnet public (Always Free)"
echo "=============================================="
NET_OUT=$(OCI_COMPARTMENT_OCID="$TENANCY" bash "$SCRIPT_DIR/oci-network.sh")
echo "$NET_OUT"

SUBNET_OCID=$(printf '%s\n' "$NET_OUT" | grep -oE 'OCI_SUBNET_OCID=[^ ]+' | head -1 | sed 's/^OCI_SUBNET_OCID=//')
if [ -z "$SUBNET_OCID" ]; then
  echo "❌ OCI_SUBNET_OCID introuvable dans la sortie de oci-network.sh."
  exit 1
fi
echo "✅ Subnet prêt : $SUBNET_OCID"

echo ""
echo "=============================================="
echo "ÉTAPE 3/3 — Instance A1.Flex (Always Free) + ports 22/80/443"
echo "=============================================="
# GARDE-FOU anti-redondance : ne jamais empiler une 2e instance prod.
EXISTING=$(oci compute instance list --compartment-id "$TENANCY" \
  --query "data[?\"display-name\"=='$INSTANCE_NAME' && (\"lifecycle-state\"=='RUNNING' || \"lifecycle-state\"=='STARTING' || \"lifecycle-state\"=='PROVISIONING')].id | [0]" \
  --raw-output 2>/dev/null || true)

if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  echo "ℹ️  $INSTANCE_NAME existe déjà — pas de nouvelle instance (Always Free)."
  IP=$(oci compute instance list-vnics --instance-id "$EXISTING" \
    --query "data[0].\"public-ip\"" --raw-output 2>/dev/null || true)
  [ -n "$IP" ] && [ "$IP" != "null" ] || {
    echo "❌ IP pas encore attribuée à l'instance existante. Vérifie la console Oracle."; exit 1;
  }
  echo "   → IP existante : $IP"
else
  SSH_PUBKEY=$(cat "$HOME/.ssh/id_ed25519_sakeurimmo.pub")
  PROV_OUT=$(OCI_COMPARTMENT_OCID="$TENANCY" OCI_SUBNET_OCID="$SUBNET_OCID" \
    SSH_PUBKEY="$SSH_PUBKEY" bash "$SCRIPT_DIR/oci-provision.sh")
  echo "$PROV_OUT"
  IP=$(printf '%s\n' "$PROV_OUT" | grep -oE 'IP publique : [0-9.]+' | head -1 | sed 's/.*: //')
  [ -n "$IP" ] || { echo "❌ IP publique introuvable dans la sortie de oci-provision.sh."; exit 1; }
fi

echo ""
echo "=============================================="
echo "Secret GitHub VPS_HOST → déploiement automatique"
echo "=============================================="
if command -v gh >/dev/null 2>&1; then
  if gh secret set VPS_HOST --repo "$REPO" --body "$IP"; then
    echo "✅ VPS_HOST=$IP posé sur $REPO — le prochain push déploiera en vert."
  else
    echo "⚠️  Échec gh secret set. À faire manuellement :"
    echo "   gh secret set VPS_HOST --repo $REPO --body $IP"
  fi
else
  echo "⚠️  gh absent. Définis le secret manuellement :"
  echo "   gh secret set VPS_HOST --repo $REPO --body $IP"
fi

echo ""
echo "🎉 Instance prête : ssh -i ~/.ssh/id_ed25519_sakeurimmo ubuntu@$IP"
echo "   Prochaine étape : Phase 1 (provision.sh) + .env — voir deploy/MIGRATION.md"
