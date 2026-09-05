#!/usr/bin/env bash
# ⚠️ SUPERSEDED (05/09/2026) — Oracle Cloud refuse les comptes Senegal.
# SakeurImmo migre vers Google Cloud (voir deploy/MIGRATION.md, skill
# vps-deploy scripts/gcp-provision.sh). Gardé pour reference/pays ou Oracle fonctionne.
# ============================================================
# oci-provision.sh — Provisionne l'instance Oracle Cloud Free Tier
# via OCI CLI, avec GARDE-FOU anti-paiement (Always Free uniquement).
#
# Prérequis :
#   1. OCI CLI : bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
#   2. Config  : oci setup config  (tenancy OCID, user OCID, région, clé API)
#   3. Variables d'env :
#        OCI_COMPARTMENT_OCID   (Console → Identity → Compartments)
#        OCI_SUBNET_OCID        (Networking → VCN → Subnet)
#        SSH_PUBKEY              (ta clé publique)
#      Optionnel : OCI_IMAGE_OCID, OCI_AVAILABILITY_DOMAIN
#
# Usage :
#   SSH_PUBKEY="$(cat ~/.ssh/id_ed25519_sakeurimmo.pub)" bash deploy/oci-provision.sh
#
# GARDE-FOU : refuse tout dépassement des limites Always Free → aucun paiement.
# ============================================================
set -euo pipefail

# --- Limites Always Free (ne JAMAIS dépasser) ---
MAX_OCPU=4
MAX_RAM_GB=24
MAX_BOOT_GB=200

# --- Paramètres (défauts = Always Free) ---
OCPU="${OCPU:-4}"
RAM_GB="${RAM_GB:-24}"
BOOT_GB="${BOOT_GB:-200}"
DISPLAY_NAME="${DISPLAY_NAME:-sakeurimmo-prod}"

COMPARTMENT_OCID="${OCI_COMPARTMENT_OCID:?❌ manquant : export OCI_COMPARTMENT_OCID}"
SUBNET_OCID="${OCI_SUBNET_OCID:?❌ manquant : export OCI_SUBNET_OCID}"
SSH_PUBKEY="${SSH_PUBKEY:?❌ manquant : export SSH_PUBKEY=\"\$(cat ~/.ssh/id_ed25519_sakeurimmo.pub)\"}"

# --- GARDE-FOU anti-paiement : validation des limites ---
if [ "$OCPU" -gt "$MAX_OCPU" ] || [ "$RAM_GB" -gt "$MAX_RAM_GB" ] || [ "$BOOT_GB" -gt "$MAX_BOOT_GB" ]; then
  echo "❌ REFUS : ressources hors limites Always Free (OCPU≤$MAX_OCPU, RAM≤$MAX_RAM_GB Go, boot≤$MAX_BOOT_GB Go)."
  echo "   Aucune commande exécutée. Aucun paiement possible."
  exit 1
fi

# --- Vérifier OCI CLI ---
command -v oci >/dev/null 2>&1 || {
  echo "❌ OCI CLI absent. Installe-le puis configure-le :"
  echo "   bash -c \"\$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)\""
  echo "   oci setup config"
  exit 1
}

# --- Image Ubuntu 24.04 ARM (si non fournie) ---
if [ -z "${OCI_IMAGE_OCID:-}" ]; then
  echo "==> Recherche de l'image Ubuntu 24.04 ARM..."
  OCI_IMAGE_OCID=$(oci compute image list \
    --compartment-id "$COMPARTMENT_OCID" \
    --operating-system "Canonical Ubuntu" \
    --shape VM.Standard.A1.Flex \
    --query "data[?contains(\"display-name\",'24.04')].id | [0]" --raw-output)
  if [ -z "$OCI_IMAGE_OCID" ] || [ "$OCI_IMAGE_OCID" = "null" ]; then
    echo "❌ Image Ubuntu 24.04 ARM introuvable. Fournis OCI_IMAGE_OCID."
    exit 1
  fi
fi

# --- Availability domain ---
if [ -z "${OCI_AVAILABILITY_DOMAIN:-}" ]; then
  OCI_AVAILABILITY_DOMAIN=$(oci iam availability-domain list --compartment-id "$COMPARTMENT_OCID" --query "data[0].name" --raw-output)
fi

# --- Lancer l'instance A1.Flex ---
echo "==> Lancement de $DISPLAY_NAME : ${OCPU} OCPU / ${RAM_GB} Go / ${BOOT_GB} Go boot (Always Free)"
INSTANCE_OCID=$(oci compute instance launch \
  --compartment-id "$COMPARTMENT_OCID" \
  --availability-domain "$OCI_AVAILABILITY_DOMAIN" \
  --shape VM.Standard.A1.Flex \
  --shape-config "{\"ocpus\":$OCPU,\"memoryInGBs\":$RAM_GB}" \
  --image-id "$OCI_IMAGE_OCID" \
  --subnet-id "$SUBNET_OCID" \
  --assign-public-ip true \
  --display-name "$DISPLAY_NAME" \
  --boot-volume-size-in-gbs "$BOOT_GB" \
  --metadata "{\"ssh_authorized_keys\":\"$SSH_PUBKEY\"}" \
  --query "data.id" --raw-output)
echo "✅ Instance créée : $INSTANCE_OCID"

# --- Ouvrir 22/80/443 dans la security list du subnet ---
echo "==> Ouverture des ports 22/80/443"
SEC_LIST=$(oci network subnet get --subnet-id "$SUBNET_OCID" --query "data.\"security-list-ids\"[0]" --raw-output)
oci network security-list update \
  --security-list-id "$SEC_LIST" \
  --ingress-security-rules '[
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}
  ]' --force >/dev/null
echo "✅ Ports 22/80/443 ouverts"

# --- Attendre l'IP publique (jusqu'à 5 min) ---
echo "==> Attente de l'IP publique..."
IP=""
for _ in $(seq 1 30); do
  IP=$(oci compute instance list-vnics --instance-id "$INSTANCE_OCID" --query "data[0].\"public-ip\"" --raw-output 2>/dev/null || true)
  [ -n "$IP" ] && [ "$IP" != "null" ] && break
  sleep 10
done
if [ -z "$IP" ] || [ "$IP" = "null" ]; then
  echo "❌ IP non obtenue. Vérifie la console Oracle."
  exit 1
fi

echo ""
echo "🎉 Instance prête :"
echo "   IP publique : $IP"
echo "   Connexion   : ssh -i ~/.ssh/id_ed25519_sakeurimmo ubuntu@$IP"
echo "   Prochaine étape : Phase 1 (provision.sh) — voir deploy/MIGRATION.md"
