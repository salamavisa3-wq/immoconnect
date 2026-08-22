# MAIn — SEO Automation for SakeurImmo

Projet de vérification automatisée du tag **Google Analytics 4 (GA4)** pour le site [www.sakeurimmo.com](https://www.sakeurimmo.com).

Ce dossier fournit :
- un script de vérification automatique des pages critiques ;
- un mode hybride (automatisé + validation manuelle) ;
- une CLI interactive ;
- un dashboard web Flask avec authentification basique ;
- un mode *jailbreak* temporaire pour désactiver les vérifications.

## Sommaire

1. [Prérequis](#prérequis)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Scripts](#scripts)
5. [CLI](#cli)
6. [Dashboard web](#dashboard-web)
7. [Mode jail](#mode-jail)
8. [Automatisation](#automatisation)
9. [Architecture](#architecture)
10. [Sécurité](#sécurité)

---

## Prérequis

- Python 3.10+
- pip
- (Optionnel) compte Slack pour les alertes
- (Optionnel) hébergement Render / VPS pour exécuter le dashboard

## Installation

```bash
cd seo-automation
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Éditez .env avec vos secrets
```

## Configuration

Copiez `.env.example` vers `.env` puis renseignez au minimum :

| Variable | Description | Exemple |
|---|---|---|
| `WEBSITE_URL` | Site à auditer | `https://www.sakeurimmo.com` |
| `GA4_MEASUREMENT_ID` | ID de mesure GA4 | `G-XXXXXXXXXX` |
| `CRITICAL_PATHS` | Pages à vérifier | `/,/contact,/nos-annonces` |
| `SLACK_BOT_TOKEN` | Token Slack (optionnel) | `xoxb-...` |
| `SLACK_WEBHOOK_URL` | Webhook Slack (optionnel) | `https://hooks.slack.com/...` |
| `BASIC_AUTH_USERNAME` | Login dashboard | `admin` |
| `BASIC_AUTH_PASSWORD` | Mot de passe dashboard | `change-me` |

> **Règle d'or** : aucune clé API ou mot de passe n'est écrit dans le code source.

## Scripts

### 1. `verify_ga4_tag.py`

Vérification automatique, lecture seule, de toutes les pages critiques.

```bash
python verify_ga4_tag.py
```

- Génère un rapport JSON dans `reports/`.
- Envoie une alerte Slack si au moins une page n'a pas de tag GA4.
- Retourne `0` si tout est OK, `1` sinon.

### 2. `hybrid_verification.py`

Mode **MAIn** (Manual-Automated Hybrid) : exécute d'abord la vérification automatique, puis demande une validation humaine si une page échoue.

```bash
python hybrid_verification.py              # interactif
python hybrid_verification.py --silent   # CI/CD, échoue sans input
python hybrid_verification.py --auto-approve
```

## CLI

```bash
python ma_in_cli.py
```

Menu interactif :
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
python ma_in_cli.py jail activate --hours 24 --reason "maintenance WordPress"
python ma_in_cli.py jail deactivate
python ma_in_cli.py jail status
```

## Dashboard web

Lancez le dashboard Flask :

```bash
cd dashboard
python app.py
```

Puis ouvrez [http://localhost:5000](http://localhost:5000).

### Endpoints

| Endpoint | Description |
|---|---|
| `/` | Dashboard HTML avec graphiques |
| `/api/checks` | Tous les rapports au format JSON |
| `/api/stats` | Statistiques agrégées |

### Authentification basique

Protégée par `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`.  
Désactivez-la en dev avec `BASIC_AUTH_ENABLED=false`.

## Mode jail

Désactive temporairement les vérifications (par exemple pendant une maintenance).

```bash
python ma_in_jail.py activate --hours 72 --reason "migration hébergeur"
python ma_in_jail.py status
python ma_in_jail.py deactivate
```

- Le jail est stocké dans `.ma-in-jail.lock`.
- Il expire automatiquement après le TTL.
- Les commandes `check` et `hybrid` sont bloquées tant qu'il est actif.

## Automatisation

### Cron local (vérification mensuelle)

```bash
# crontab -e
0 3 1 * * cd /chemin/vers/seo-automation && source .venv/bin/activate && python verify_ga4_tag.py
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

## Architecture

```
seo-automation/
├── verify_ga4_tag.py          # Vérification automatique
├── hybrid_verification.py     # Validation hybride
├── ma_in_cli.py               # Interface CLI
├── ma_in_jail.py              # Mode maintenance / jailbreak
├── dashboard/
│   ├── app.py                 # Serveur Flask
│   └── templates/index.html   # UI
├── requirements.txt
├── .env.example
├── README.md
└── reports/                   # Rapports JSON générés
```

## Sécurité

- Aucune clé API dans le code source.
- Aucune modification du site (lecture seule).
- Authentification basique HTTP sur le dashboard.
- Mode jail avec TTL et raison pour tracer les désactivations.
- Requêtes HTTP avec timeout strict et user-agent identifié.

---

Besoin d'étendre ce système ? Prochaines étapes possibles :
- intégrer un vrai backend PostgreSQL pour l'historique ;
- ajouter des alertes e-mail/SMS ;
- vérifier d'autres balises (GTM, Meta Pixel, etc.).
