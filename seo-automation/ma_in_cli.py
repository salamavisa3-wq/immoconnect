#!/usr/bin/env python3
"""
ma-in-cli
Interface CLI textuelle pour le système MAIn (Manual-Automated Hybrid Verification).

Usage:
    python ma_in_cli.py
    python ma_in_cli.py check
    python ma_in_cli.py hybrid
    python ma_in_cli.py jail activate 72h
    python ma_in_cli.py history
"""
import os
import sys
import json
import argparse
import datetime
import subprocess
from typing import List, Dict, Any

REPORTS_DIR = os.getenv("REPORT_DIR", "reports")
JAIL_FILE = os.path.join(os.path.dirname(__file__), ".ma-in-jail.lock")


def is_jailed() -> bool:
    if not os.path.exists(JAIL_FILE):
        return False
    try:
        with open(JAIL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        expire = data.get("expire", 0)
        return datetime.datetime.utcnow().timestamp() < expire
    except Exception:
        return False


def jail_status() -> Dict[str, Any]:
    if not os.path.exists(JAIL_FILE):
        return {"active": False}
    with open(JAIL_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    remaining = max(0, int(data.get("expire", 0) - datetime.datetime.utcnow().timestamp()))
    return {"active": remaining > 0, "remaining_seconds": remaining, "reason": data.get("reason", "")}


def activate_jail(ttl_hours: int, reason: str) -> None:
    expire = datetime.datetime.utcnow().timestamp() + ttl_hours * 3600
    data = {
        "activated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "expire": expire,
        "ttl_hours": ttl_hours,
        "reason": reason,
    }
    with open(JAIL_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"🔒 Mode jail activé pour {ttl_hours}h (expire le {datetime.datetime.fromtimestamp(expire).isoformat()})")


def deactivate_jail() -> None:
    if os.path.exists(JAIL_FILE):
        os.remove(JAIL_FILE)
        print("🔓 Mode jail désactivé")
    else:
        print("ℹ️ Aucun jail actif")


def print_header() -> None:
    print("=" * 50)
    print("  MAIn CLI — Manual-Automated Verification v1.0")
    print("=" * 50)


def run_check(script: str, extra_args: List[str] = None) -> int:
    base_dir = os.path.dirname(__file__)
    cmd = [sys.executable, os.path.join(base_dir, script)]
    if extra_args:
        cmd.extend(extra_args)
    result = subprocess.run(cmd, cwd=base_dir)
    return result.returncode


def show_history(limit: int = 10) -> None:
    if not os.path.isdir(REPORTS_DIR):
        print("Aucun rapport disponible")
        return
    files = sorted(
        [f for f in os.listdir(REPORTS_DIR) if f.endswith(".json")],
        reverse=True,
    )[:limit]
    if not files:
        print("Aucun rapport trouvé")
        return

    print(f"\n📊 {len(files)} derniers rapports :")
    print(f"{'Date':20} {'Status':8} {'Mode':10} {'Pages OK':10}")
    print("-" * 55)
    for fname in files:
        path = os.path.join(REPORTS_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                report = json.load(f)
            ts = report.get("timestamp", "?")[:19]
            status = report.get("final_status", report.get("status", "?"))
            mode = report.get("mode", "auto")
            pages_ok = f"{report.get('pages_ok', 0)}/{report.get('pages_checked', 0)}"
            print(f"{ts:20} {status:8} {mode:10} {pages_ok:10}")
        except Exception:
            print(f"{fname:20} (lecture impossible)")


def interactive_menu() -> int:
    print_header()
    jail = jail_status()
    if jail["active"]:
        print(f"⚠️  MODE JAIL ACTIF — {jail['remaining_seconds'] // 3600}h restantes")
        print(f"   Raison: {jail['reason']}")
    print()
    print("Commandes disponibles :")
    print("  [1] Vérification automatique")
    print("  [2] Vérification hybride (auto + validation manuelle)")
    print("  [3] Historique des rapports")
    print("  [4] Gérer le mode jail")
    print("  [5] Quitter")

    while True:
        choice = input("\nChoix : ").strip()
        if choice == "1":
            if is_jailed():
                print("🔒 Vérification bloquée par le mode jail")
                continue
            return run_check("verify_ga4_tag.py")
        elif choice == "2":
            if is_jailed():
                print("🔒 Vérification bloquée par le mode jail")
                continue
            return run_check("hybrid_verification.py")
        elif choice == "3":
            show_history()
        elif choice == "4":
            manage_jail_menu()
        elif choice == "5":
            print("Au revoir 👋")
            return 0
        else:
            print("Choix non reconnu")


def manage_jail_menu() -> None:
    print("\nMode jail :")
    print("  [a] Activer")
    print("  [d] Désactiver")
    print("  [s] Statut")
    print("  [r] Retour")
    choice = input("Choix : ").strip().lower()
    if choice == "a":
        try:
            hours = int(input("Durée en heures (défaut 72) : ").strip() or "72")
        except ValueError:
            hours = 72
        reason = input("Raison : ").strip() or "maintenance"
        activate_jail(hours, reason)
    elif choice == "d":
        deactivate_jail()
    elif choice == "s":
        jail = jail_status()
        if jail["active"]:
            print(f"🔒 Actif — {jail['remaining_seconds'] // 3600}h restantes — {jail['reason']}")
        else:
            print("🔓 Aucun jail actif")


def main() -> int:
    parser = argparse.ArgumentParser(description="MAIn CLI pour vérification GA4")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("check", help="Vérification automatique")
    sub.add_parser("hybrid", help="Vérification hybride")
    sub.add_parser("history", help="Historique des rapports")

    jail_parser = sub.add_parser("jail", help="Gestion du mode jail")
    jail_parser.add_argument("action", choices=["activate", "deactivate", "status"])
    jail_parser.add_argument("--hours", type=int, default=72)
    jail_parser.add_argument("--reason", default="maintenance")

    args = parser.parse_args()

    if not args.command:
        return interactive_menu()

    if args.command == "check":
        if is_jailed():
            print("🔒 Vérification bloquée par le mode jail")
            return 2
        return run_check("verify_ga4_tag.py")
    elif args.command == "hybrid":
        if is_jailed():
            print("🔒 Vérification bloquée par le mode jail")
            return 2
        return run_check("hybrid_verification.py")
    elif args.command == "history":
        show_history()
        return 0
    elif args.command == "jail":
        if args.action == "activate":
            activate_jail(args.hours, args.reason)
        elif args.action == "deactivate":
            deactivate_jail()
        elif args.action == "status":
            jail = jail_status()
            print(json.dumps(jail, indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
