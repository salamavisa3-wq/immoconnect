#!/usr/bin/env bash
# Sauvegarde Turso (dump SQL) + sync vers OCI Object Storage (10 Go gratuits) via rclone.
# Prérequis sur le serveur :
#   - turso CLI : curl -sSfL https://get.turso.tech/install.sh | bash
#   - auth : export TURSO_API_TOKEN=<token> (ou `turso auth login` interactif)
#   - rclone + remote "oci" configuré (Object Storage OCI) ou Backblaze B2
# Turso n'est ni Postgres ni MySQL : le backup.sh générique du skill vps-deploy
# ne le détecte pas (sans danger, il logue juste "rien à dumper" pour cette app).
# Ce script-ci est donc le SEUL mécanisme de sauvegarde DB de SakeurImmo — il a
# besoin de son propre cron, distinct de celui posé par onboard-app.sh :
# Cron (en tant que deploy) : crontab -e → 0 3 * * * /opt/apps/sakeurimmo/deploy/backup-turso.sh
set -euo pipefail

APP_DIR="/opt/apps/sakeurimmo"
BACKUP_DIR="$APP_DIR/backups"
RETENTION_DAYS=14
DATE=$(date +%Y%m%d-%H%M%S)
ALERT="/opt/scripts/alert.sh"
trap '[ -x "$ALERT" ] && "$ALERT" "Échec sauvegarde Turso SakeurImmo ($DATE)" critical' ERR

# Charge les variables du .env de l'app (TURSO_DATABASE_URL, TURSO_API_TOKEN…)
set -a
# shellcheck disable=SC1091
source "$APP_DIR/.env"
set +a

mkdir -p "$BACKUP_DIR"

echo "==> Dump Turso"
# Nom de la base = dernière partie de l'URL (ex. libsql://monapp-org.turso.io → monapp-org)
DB_NAME=$(basename "$TURSO_DATABASE_URL" .turso.io)
turso db dump "$DB_NAME" --output "$BACKUP_DIR/turso-$DATE.sql"

echo "==> Purge locale (> ${RETENTION_DAYS}j)"
find "$BACKUP_DIR" -name "turso-*.sql" -mtime +$RETENTION_DAYS -delete

echo "==> Sync vers OCI Object Storage"
if command -v rclone >/dev/null 2>&1; then
  rclone copy "$BACKUP_DIR" oci:sakeurimmo-backups/ --include "turso-*.sql" --max-age ${RETENTION_DAYS}d
else
  echo "   rclone absent — sauvegarde locale uniquement. Installe rclone pour la sync cloud."
fi

echo "✅ Sauvegarde terminée : $BACKUP_DIR/turso-$DATE.sql"
