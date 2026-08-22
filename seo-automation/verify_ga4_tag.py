"""
verify_ga4_tag.py
Vérification mensuelle (ou périodique) de la présence du tag Google Analytics 4
sur les pages critiques de www.sakeurimmo.com.

Conformité CLAUDE.md :
- Aucune modification du site (lecture seule).
- Secrets via variables d'environnement.
- Timeouts stricts, volume de requêtes minimal.
- Sortie JSON utilisable par le dashboard / CI.

Usage:
    python verify_ga4_tag.py
    WEBSITE_URL=https://sakeurimmo.com GA4_MEASUREMENT_ID=G-XXXX python verify_ga4_tag.py
"""
import os
import sys
import json
import logging
import datetime
from typing import List, Dict, Any
import requests
from requests.adapters import HTTPAdapter
from urllib.parse import urljoin

try:
    from slack_sdk import WebClient
except ImportError:  # pragma: no cover
    WebClient = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s"
)
logger = logging.getLogger("ga4_check")


class Config:
    WEBSITE_URL = os.getenv("WEBSITE_URL", "https://www.sakeurimmo.com").rstrip("/")
    GA4_MEASUREMENT_ID = os.getenv("GA4_MEASUREMENT_ID", "")
    CRITICAL_PATHS = [
        p.strip()
        for p in os.getenv("CRITICAL_PATHS", "/,/contact,/nos-annonces,/carte,/faq").split(",")
        if p.strip()
    ]
    GA4_INDICATORS = ["gtag(", "G-", "gtag/js"]
    TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))
    USER_AGENT = os.getenv("USER_AGENT", "Mozilla/5.0 (compatible; SakeurImmo-GA4-Bot/1.0)")
    SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
    SLACK_CHANNEL = os.getenv("SLACK_CHANNEL", "#sakeurimmo-alerts")
    SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
    REPORT_DIR = os.getenv("REPORT_DIR", "reports")


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})
    adapter = HTTPAdapter(max_retries=0)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def check_page(session: requests.Session, path: str) -> Dict[str, Any]:
    url = urljoin(Config.WEBSITE_URL + "/", path.lstrip("/"))
    result: Dict[str, Any] = {
        "path": path,
        "url": url,
        "status_code": None,
        "has_ga4": False,
        "ga4_id_found": None,
        "error": None,
        "response_time_ms": None,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }
    try:
        resp = session.get(url, timeout=Config.TIMEOUT, allow_redirects=True)
        result["status_code"] = resp.status_code
        result["response_time_ms"] = int(resp.elapsed.total_seconds() * 1000)

        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}"
            return result

        text = resp.text
        has_indicator = any(ind in text for ind in Config.GA4_INDICATORS)

        # Vérifie si l'ID de mesure précis est présent (quand fourni)
        ga4_id_found = None
        if Config.GA4_MEASUREMENT_ID and Config.GA4_MEASUREMENT_ID in text:
            ga4_id_found = Config.GA4_MEASUREMENT_ID

        # Si un ID est configuré, exige qu'il soit présent ; sinon un indicateur générique suffit
        result["has_ga4"] = bool(ga4_id_found) if Config.GA4_MEASUREMENT_ID else has_indicator
        result["ga4_id_found"] = ga4_id_found

    except requests.exceptions.Timeout:
        result["error"] = f"Timeout après {Config.TIMEOUT}s"
    except requests.exceptions.RequestException as exc:
        result["error"] = f"Erreur réseau: {exc}"
    except Exception as exc:  # pragma: no cover
        result["error"] = f"Erreur inattendue: {exc}"

    return result


def check_all() -> Dict[str, Any]:
    session = build_session()
    results = [check_page(session, path) for path in Config.CRITICAL_PATHS]
    failed = [r for r in results if not r["has_ga4"]]
    status = "PASS" if not failed else "FAIL"

    report: Dict[str, Any] = {
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "website": Config.WEBSITE_URL,
        "measurement_id": Config.GA4_MEASUREMENT_ID or None,
        "status": status,
        "pages_checked": len(results),
        "pages_ok": len(results) - len(failed),
        "pages_failed": len(failed),
        "results": results,
    }
    return report


def save_report(report: Dict[str, Any]) -> str:
    os.makedirs(Config.REPORT_DIR, exist_ok=True)
    filename = os.path.join(
        Config.REPORT_DIR,
        f"ga4-check-{datetime.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json"
    )
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    logger.info("Rapport sauvegardé: %s", filename)
    return filename


def send_slack_message(report: Dict[str, Any]) -> bool:
    if not Config.SLACK_BOT_TOKEN and not Config.SLACK_WEBHOOK_URL:
        logger.info("Slack non configuré — alerte ignorée")
        return False

    failed = [r for r in report["results"] if not r["has_ga4"]]
    status_icon = "✅" if not failed else "🚨"
    lines = [
        f"{status_icon} *GA4 Check* — {report['website']}",
        f"*Statut:* {report['status']}",
        f"*Pages OK:* {report['pages_ok']}/{report['pages_checked']}",
    ]
    if failed:
        lines.append("*Pages sans tag GA4:*")
        for r in failed:
            lines.append(f"  • {r['path']} — {r.get('error') or 'tag absent'}")

    text = "\n".join(lines)

    try:
        if Config.SLACK_WEBHOOK_URL:
            requests.post(
                Config.SLACK_WEBHOOK_URL,
                json={"text": text, "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": text}}]},
                timeout=10,
            )
        elif Config.SLACK_BOT_TOKEN and WebClient:
            client = WebClient(token=Config.SLACK_BOT_TOKEN)
            client.chat_postMessage(channel=Config.SLACK_CHANNEL, text=text)
        logger.info("Alerte Slack envoyée")
        return True
    except Exception as exc:
        logger.error("Échec envoi Slack: %s", exc)
        return False


def main() -> int:
    logger.info("Démarrage vérification GA4 sur %s", Config.WEBSITE_URL)
    report = check_all()
    filename = save_report(report)

    print(json.dumps(report, indent=2, ensure_ascii=False))

    if report["status"] == "FAIL":
        send_slack_message(report)
        logger.warning("Échec détecté — voir %s", filename)
        return 1

    logger.info("Succès — voir %s", filename)
    return 0


if __name__ == "__main__":
    sys.exit(main())
