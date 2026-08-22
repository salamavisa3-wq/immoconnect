"""
hybrid_verification.py
Système de vérification manuel-automatisée (MAIn) pour le tag GA4.

- En mode auto : exécute les vérifications et génère un rapport JSON.
- En mode MAIn : si des pages échouent, demande une validation humaine
  interactive avant de décider du statut final.
- Peut être piloté via variables d'environnement pour la CI (pas d'input).

Conformité CLAUDE.md : lecture seule, pas de modification du site.
"""
import os
import sys
import json
import argparse
import datetime
from typing import Dict, Any, List

from verify_ga4_tag import check_all, save_report, Config


class HybridVerification:
    def __init__(self, silent: bool = False, auto_approve: bool = False):
        self.silent = silent
        self.auto_approve = auto_approve
        self.manual_approved = False

    def run_automated_checks(self) -> Dict[str, Any]:
        return check_all()

    def request_manual_review(self, report: Dict[str, Any]) -> bool:
        failed = [r for r in report["results"] if not r["has_ga4"]]
        if not failed:
            return True

        if self.auto_approve:
            print("✅ Revue manuelle auto-approuvée (AUTO_APPROVE=true)")
            return True

        if self.silent:
            print("⚠️ Revue manuelle requise mais mode silent — échec")
            return False

        print("\n🛑 Pages nécessitant une vérification manuelle :")
        for r in failed:
            print(f"  - {r['path']} ({r['url']})")
            if r.get("error"):
                print(f"    Erreur auto: {r['error']}")

        print("\nInstructions:")
        print("1. Ouvrez ces pages dans votre navigateur")
        print("2. Ouvrez les Outils de développement → onglet Network")
        print("3. Filtrez par 'collect' ou 'gtag' et vérifiez que GA4 charge")
        print("4. Tapez YES pour approuver, NO pour rejeter")

        while True:
            try:
                response = input("Validation manuelle terminée ? (YES/NO): ").strip().upper()
            except EOFError:
                return False
            if response == "YES":
                return True
            if response == "NO":
                return False
            print("Réponse non reconnue. Tapez YES ou NO.")

    def generate_report(self, automated_report: Dict[str, Any], manual_ok: bool) -> Dict[str, Any]:
        report = dict(automated_report)
        report["mode"] = "hybrid"
        report["manual_verification"] = manual_ok
        report["final_status"] = "PASS" if (report["status"] == "PASS" or manual_ok) else "FAIL"
        report["completed_at"] = datetime.datetime.utcnow().isoformat() + "Z"
        return report

    def run(self) -> int:
        print("🔍 Exécution des vérifications automatisées...")
        automated_report = self.run_automated_checks()

        print(f"Résultat auto: {automated_report['status']} "
              f"({automated_report['pages_ok']}/{automated_report['pages_checked']} pages OK)")

        if automated_report["status"] == "PASS":
            final_report = self.generate_report(automated_report, manual_ok=True)
        else:
            manual_ok = self.request_manual_review(automated_report)
            self.manual_approved = manual_ok
            final_report = self.generate_report(automated_report, manual_ok)

        filename = save_report(final_report)

        print(f"\n📄 Rapport final: {final_report['final_status']} (sauvegardé dans {filename})")
        print(json.dumps(final_report, indent=2, ensure_ascii=False))

        return 0 if final_report["final_status"] == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vérification hybride GA4 (automatisée + validation manuelle)"
    )
    parser.add_argument("--silent", action="store_true", help="Pas d'interaction CLI (échec si validation manuelle requise)")
    parser.add_argument("--auto-approve", action="store_true", help="Auto-approuver la validation manuelle")
    args = parser.parse_args()

    verifier = HybridVerification(silent=args.silent, auto_approve=args.auto_approve)
    return verifier.run()


if __name__ == "__main__":
    sys.exit(main())
