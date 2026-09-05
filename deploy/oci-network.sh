#!/usr/bin/env bash
# ⚠️ SUPERSEDED (05/09/2026) — Oracle Cloud refuse les comptes Senegal.
# SakeurImmo migre vers Google Cloud (voir deploy/MIGRATION.md, skill
# vps-deploy scripts/gcp-provision.sh). Gardé pour reference/pays ou Oracle fonctionne.
# ============================================================
# oci-network.sh — Crée le réseau VCN + subnet public pour
# l'instance (gratuit, Always Free) via OCI CLI.
#
# Prérequis : OCI CLI configuré (deploy/oci-config.sh), et
#             le test `oci iam compartment list` passe.
#
# Usage :
#   OCI_COMPARTMENT_OCID=ocid1.compartment... bash deploy/oci-network.sh
#   (compartiment racine = ton tenancy OCID ; un sous-compartiment va aussi)
#
# Sortie : export OCI_SUBNET_OCID à reprendre pour la suite.
# GARDE-FOU : VCN/subnet sont des ressources Always Free (2 VCN max).
# ============================================================
set -euo pipefail

COMPARTMENT_OCID="${OCI_COMPARTMENT_OCID:?❌ manquant : export OCI_COMPARTMENT_OCID}"
VCN_NAME="sakeurimmo-vcn"
SUB_NAME="sakeurimmo-subnet-public"
CIDR="${VCN_CIDR:-10.0.0.0/16}"

command -v oci >/dev/null || { echo "❌ OCI CLI absent. Voir deploy/MIGRATION.md Phase 0."; exit 1; }

echo "==> VCN (Always Free)"
VCN=$(oci network vcn list --compartment-id "$COMPARTMENT_OCID" \
  --query "data[?\"display-name\"=='$VCN_NAME'].id | [0]" --raw-output)
if [ -z "$VCN" ] || [ "$VCN" = "null" ]; then
  VCN=$(oci network vcn create --compartment-id "$COMPARTMENT_OCID" \
    --cidr-block "$CIDR" --display-name "$VCN_NAME" --dns-label sakeurimmo \
    --query "data.id" --raw-output)
  echo "   → créée : $VCN"
else
  echo "   → existante : $VCN"
fi

echo "==> Internet Gateway (Always Free)"
IGW=$(oci network internet-gateway list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --query "data[0].id" --raw-output)
if [ -z "$IGW" ] || [ "$IGW" = "null" ]; then
  IGW=$(oci network internet-gateway create --compartment-id "$COMPARTMENT_OCID" \
    --vcn-id "$VCN" --is-enabled true --display-name "sakeurimmo-igw" \
    --query "data.id" --raw-output)
  echo "   → créée : $IGW"
else
  echo "   → existante : $IGW"
fi

echo "==> Route table (0.0.0.0/0 → IGW)"
RT=$(oci network route-table create --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW\"}]" \
  --display-name "sakeurimmo-rt" --query "data.id" --raw-output)
echo "   → $RT"

echo "==> Subnet public (IP publique auto, DNS public)"
SUB=$(oci network subnet list --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
  --query "data[0].id" --raw-output)
if [ -z "$SUB" ] || [ "$SUB" = "null" ]; then
  SUB=$(oci network subnet create --compartment-id "$COMPARTMENT_OCID" --vcn-id "$VCN" \
    --cidr-block "$CIDR" --route-table-id "$RT" --display-name "$SUB_NAME" \
    --dns-label public --prohibit-public-ip-on-vnic false \
    --query "data.id" --raw-output)
  echo "   → créée : $SUB"
else
  echo "   → existante : $SUB"
fi

echo ""
echo "🎉 Réseau prêt. À recopier pour la suite :"
echo "   export OCI_COMPARTMENT_OCID=$COMPARTMENT_OCID"
echo "   export OCI_SUBNET_OCID=$SUB"
echo ""
echo "Suite : SSH_PUBKEY=\"\$(cat ~/.ssh/id_ed25519_sakeurimmo.pub)\" bash deploy/oci-provision.sh"
