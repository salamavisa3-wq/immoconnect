#!/usr/bin/env bash
# ============================================================
# oci-config.sh — Configure OCI CLI NON-interactivement
# (remplace le wizard `oci setup config`, qui est interactif).
#
# Prérequis : compte Oracle Cloud (https://cloud.oracle.com) + OCI CLI installé.
#
# Usage :
#   OCI_TENANCY_OCID=ocid1.tenancy... \
#   OCI_USER_OCID=ocid1.user... \
#   OCI_REGION=eu-marseille-1 \
#   bash deploy/oci-config.sh
#
# Si une variable est absente → saisie interactive UNE seule fois.
#
# Après (1 seule action manuelle) :
#   Ajouter ~/.oci/oci_api_key_public.pem dans la console Oracle
#   (Profil → API keys → Add API key → coller le contenu).
#   Le fingerprint affiché doit correspondre à celui calculé ici.
# ============================================================
set -euo pipefail

TENANCY="${OCI_TENANCY_OCID:-}"
USER_OCID="${OCI_USER_OCID:-}"
REGION="${OCI_REGION:-}"

[ -n "$TENANCY" ] || read -rp "Tenancy OCID (Console → Profil → Tenancy Info): " TENANCY
[ -n "$USER_OCID" ] || read -rp "User OCID   (Console → Profil → user, bouton Copier): " USER_OCID
[ -n "$REGION" ]   || read -rp "Région OCI   (ex. eu-marseille-1, me-jeddah-1, eu-frankfurt-1): " REGION

mkdir -p "$HOME/.oci"
chmod 700 "$HOME/.oci"

if [ ! -f "$HOME/.oci/oci_api_key.pem" ]; then
  echo "==> Génération de la clé API RSA 2048"
  openssl genrsa -out "$HOME/.oci/oci_api_key.pem" 2048
  openssl rsa -pubout -in "$HOME/.oci/oci_api_key.pem" -out "$HOME/.oci/oci_api_key_public.pem"
fi
chmod 600 "$HOME/.oci/oci_api_key.pem"

# Fingerprint = MD5 de la clé publique au format DER — identique à celui
# affiché par la console Oracle après ajout de la clé API.
FPR=$(openssl rsa -pubin -in "$HOME/.oci/oci_api_key_public.pem" -outform DER 2>/dev/null \
  | openssl md5 -c | sed 's/.*=[[:space:]]*//')

cat > "$HOME/.oci/config" <<EOF
[DEFAULT]
user=$USER_OCID
fingerprint=$FPR
tenancy=$TENANCY
region=$REGION
key_file=$HOME/.oci/oci_api_key.pem
EOF
chmod 600 "$HOME/.oci/config"

echo ""
echo "✅ ~/.oci/config écrit (région $REGION)"
echo ""
echo "▶️  ACTION MANUELLE UNIQUE — ajoute la clé API dans la console :"
echo "   1. https://cloud.oracle.com → Profil (en haut à droite) → Mon profil → API keys"
echo "   2. « Add API key » → coller le contenu de $HOME/.oci/oci_api_key_public.pem"
echo "   3. La console affiche un fingerprint → doit correspondre à : $FPR"
echo ""
echo "Test ensuite : oci iam compartment list --compartment-id $TENANCY"
