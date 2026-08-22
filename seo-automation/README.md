# SakeurImmo MAIn Dashboard — GA4 Verification

Dashboard + outils CLI pour la vérification automatisée du tag **Google Analytics 4 (GA4)** sur [www.sakeurimmo.com](https://www.sakeurimmo.com).

Le système est appelé **MAIn** (Manual-Automated Hybrid Verification) :
- automatisation complète des checks mensuels ;
- validation manuelle possible en cas d'échec (mode hybride) ;
- mode **Jailbreak / CO Survivance** pour suspendre temporairement les alertes ;
- authentification basique HTTP sur le dashboard.

---

## 1. Fonctionnalités

| Fonction | Fichier |
|---|---|
| Rapport mensuel automatisé GA4 | `verify_ga4_tag.py` |
| Mode hybride auto + validation manuelle | `hybrid_verification.py` |
| Interface CLI interactive | `ma_in_cli.py` |
| Mode Jailbreak temporaire | `ma_in_jail.py` |
| Dashboard web Flask + Chart.js | `dashboard/app.py` |
| Authentification basique HTTP | `dashboard/app.py` |

---

## 2. Prérequis

- Python 3.10+
- pip
- Un compte **Google Analytics 4** avec une **Measurement ID** (`G-XXXXXXXXXX`)
- (Optionnel) Un compte Slack avec un **Bot Token** ou un **Webhook entrant** pour les alertes
- Accès en lecture à `https://www.sakeurimmo.com`

---

## 3. Installation

```bash
cd seo-automation
python -m venv .venv

# Linux/macOS
source .venv/bin/activate

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
cp .env.example .env
# Éditez .env avec vos valeurs réelles
```

---

## 4. Configuration

Le fichier `.env` (créé à partir de `.env.example`) contient tous les paramètres sensibles.

| Variable | Description | Exemple |
|---|---|---|
| `WEBSITE_URL` | Site à auditer | `https://www.sakeurimmo.com` |
| `GA4_MEASUREMENT_ID` | ID de mesure GA4 | `G-XXXXXXXXXX` |
| `CRITICAL_PATHS` | Pages à vérifier (séparées par des virgules) | `/,/contact,/nos-annonces` |
| `SLACK_BOT_TOKEN` | Token Slack (optionnel) | `xoxb-...` |
| `SLACK_WEBHOOK_URL` | Webhook Slack (optionnel) | `https://hooks.slack.com/...` |
| `BASIC_AUTH_USERNAME` | Login dashboard | `admin` |
| `BASIC_AUTH_PASSWORD` | Mot de passe dashboard | `change-me-strong-password` |
| `BASIC_AUTH_ENABLED` | Active/désactive l'auth | `true` |

> **⚠️ Ne jamais commiter `.env` dans git.** Le fichier est déjà ignoré.

---

## 5. Utilisation

### 5.1 Vérification automatique

```bash
python verify_ga4_tag.py
```

- Génère un rapport JSON dans `reports/`.
- Envoie une alerte Slack si une page critique n'a pas de tag GA4.
- Retourne `0` si OK, `1` sinon.
- Le rapport JSON est écrit sur `stdout` (les logs vont sur `stderr`).

### 5.2 Vérification hybride

```bash
python hybrid_verification.py              # interactif
python hybrid_verification.py --silent     # CI/CD
python hybrid_verification.py --auto-approve
```

### 5.3 CLI interactive

```bash
python ma_in_cli.py
```

Menu disponible :
- `1` : vérification automatique
- `2` : vérification hybride
- `3` : historique des rapports
- `4` : gestion du mode jail
- `5` : quitter

Commandes directes :

```bash
python ma_in_cli.py check
python ma_in_cli.py hybrid
python ma_in_cli.py history
python ma_in_cli.py jail activate --hours 72 --reason "maintenance"
python ma_in_cli.py jail deactivate
python ma_in_cli.py jail status
```

---

## 6. Dashboard web

Lancer le serveur Flask :

```bash
cd dashboard
python app.py
```

Ouvrir [http://127.0.0.1:5000](http://127.0.0.1:5000).

### Endpoints

| Endpoint | Description |
|---|---|
| `/` | Dashboard HTML avec graphiques |
| `/api/checks` | Tous les rapports au format JSON |
| `/api/stats` | Statistiques agrégées |

### Authentification basique

Le dashboard est protégé par **HTTP Basic Auth**.

- Les identifiants par défaut sont définis dans `.env` :
  - utilisateur : `admin`
  - mot de passe : celui défini dans `BASIC_AUTH_PASSWORD`
- Pour désactiver l'authentification en local : `BASIC_AUTH_ENABLED=false`
- En production, utilisez un mot de passe fort et préférez HTTPS.

---

## 7. Mode Jailbreak — CO Survivance

Le mode Jailbreak suspend temporairement les alertes et les vérifications automatiques.

| Commande | Description |
|---|---|
| `python ma_in_cli.py jail activate --hours 72 --reason "maintenance"` | Active le jail pour 72 heures |
| `python ma_in_cli.py jail deactivate` | Désactive immédiatement |
| `python ma_in_cli.py jail status` | Affiche l'état actuel |

Mécanisme :
- Un fichier `.ma-in-jail.lock` est créé avec un timestamp d'expiration.
- Les commandes `check` et `hybrid` sont bloquées tant que le jail est actif.
- Le jail expire automatiquement après le TTL.
- La raison est journalisée pour l'audit.

---

## 8. Automatisation

### Cron local — vérification mensuelle

```bash
# crontab -e
0 3 1 * * cd /chemin/vers/seo-automation && source .venv/bin/activate && python verify_ga4_tag.py >> /var/log/ga4-check.log 2>&1
```

### GitHub Actions

Exemple `.github/workflows/ga4-check.yml` :

```yaml
name: GA4 Monthly Check
on:
  schedule:
    - cron: '0 3 1 * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: python verify_ga4_tag.py
        env:
          WEBSITE_URL: https://www.sakeurimmo.com
          GA4_MEASUREMENT_ID: ${{ secrets.GA4_MEASUREMENT_ID }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: ga4-report
          path: reports/*.json
```

---

## 9. Structure du projet

```
seo-automation/
├── verify_ga4_tag.py          # Vérification automatique
├── hybrid_verification.py     # Validation hybride
├── ma_in_cli.py               # Interface CLI
├── ma_in_jail.py              # Mode Jailbreak
├── dashboard/
│   ├── app.py                 # Serveur Flask
│   └── templates/index.html   # UI
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

---

## 10. Sécurité

- Aucune clé API ou mot de passe n'est écrite dans le code source.
- Les secrets sont chargés depuis `.env` (non versionné).
- Le dashboard utilise l'authentification basique HTTP.
- Les scripts sont en lecture seule : aucune modification du site.
- Requêtes HTTP avec timeout strict et user-agent identifié.

---

## 11. Prochaines améliorations possibles

- Backend PostgreSQL pour l'historique des rapports.
- Alertes e-mail/SMS en plus de Slack.
- Vérification d'autres balises (GTM, Meta Pixel, etc.).
- Déploiement conteneurisé (Docker / Render / VPS).
