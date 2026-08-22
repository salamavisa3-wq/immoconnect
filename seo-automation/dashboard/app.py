"""
Dashboard web Flask pour les rapports de vérification GA4.

Fonctionnalités :
- Liste des derniers rapports
- Graphiques Chart.js (succès/échecs, tendance, temps de réponse)
- Authentification basique HTTP via BASIC_AUTH_USERNAME / BASIC_AUTH_PASSWORD
- Endpoint API JSON /api/checks
- Lecture seule des rapports (pas de modification du site)
"""
import os
import json
import glob
from functools import wraps
from datetime import datetime
from flask import Flask, render_template, jsonify, request, Response

app = Flask(__name__)

REPORTS_DIR = os.path.abspath(os.getenv("REPORT_DIR", "reports"))
BASIC_AUTH_USERNAME = os.getenv("BASIC_AUTH_USERNAME", "admin")
BASIC_AUTH_PASSWORD = os.getenv("BASIC_AUTH_PASSWORD", "admin")
BASIC_AUTH_ENABLED = os.getenv("BASIC_AUTH_ENABLED", "true").lower() in ("1", "true", "yes")


def load_reports(limit: int = 100) -> list:
    if not os.path.isdir(REPORTS_DIR):
        return []
    files = sorted(
        glob.glob(os.path.join(REPORTS_DIR, "*.json")),
        key=os.path.getmtime,
        reverse=True,
    )[:limit]
    reports = []
    for path in files:
        try:
            with open(path, "r", encoding="utf-8") as f:
                report = json.load(f)
            report["_filename"] = os.path.basename(path)
            reports.append(report)
        except Exception:
            continue
    return reports


def check_auth(username: str, password: str) -> bool:
    return username == BASIC_AUTH_USERNAME and password == BASIC_AUTH_PASSWORD


def authenticate() -> Response:
    return Response(
        "Authentification requise",
        401,
        {"WWW-Authenticate": 'Basic realm="MAIn Dashboard"'},
    )


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not BASIC_AUTH_ENABLED:
            return f(*args, **kwargs)
        auth = request.authorization
        if not auth or not check_auth(auth.username, auth.password):
            return authenticate()
        return f(*args, **kwargs)

    return decorated


@app.route("/")
@requires_auth
def dashboard():
    reports = load_reports(limit=50)
    return render_template("index.html", reports=reports)


@app.route("/api/checks")
@requires_auth
def api_checks():
    return jsonify(load_reports(limit=200))


@app.route("/api/stats")
@requires_auth
def api_stats():
    reports = load_reports(limit=200)
    total = len(reports)
    if not total:
        return jsonify({})
    ok = sum(1 for r in reports if (r.get("final_status") or r.get("status")) == "PASS")
    fail = total - ok
    avg_response = 0
    values = []
    for r in reports:
        for page in r.get("results", []):
            rt = page.get("response_time_ms")
            if rt is not None:
                values.append(rt)
    if values:
        avg_response = sum(values) // len(values)

    last_7 = reports[:7]
    trend = [
        {
            "date": r.get("timestamp", "")[:10],
            "status": r.get("final_status") or r.get("status"),
        }
        for r in last_7
    ]

    return jsonify({
        "total_checks": total,
        "passed": ok,
        "failed": fail,
        "avg_response_ms": avg_response,
        "trend": trend,
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=port, debug=debug)
