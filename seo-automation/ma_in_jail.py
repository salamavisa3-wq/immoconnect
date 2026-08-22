"""
Jailbreak / Safety mode pour le système MAIn.

Ce module fournit les fonctions de base pour activer/désactiver temporairement
les vérifications, avec TTL, raison et logging. Utilisé par ma_in_cli.py
et réutilisable dans le dashboard web.
"""
import os
import json
import logging
import datetime
from typing import Dict, Any, Optional

JAIL_FILE = os.path.join(os.path.dirname(__file__), ".ma-in-jail.lock")
logger = logging.getLogger("ma_in_jail")


def now_iso() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def is_jailed(jail_file: str = JAIL_FILE) -> bool:
    """Retourne True si un jail actif existe et n'a pas expiré."""
    if not os.path.exists(jail_file):
        return False
    try:
        with open(jail_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        expire = data.get("expire", 0)
        if datetime.datetime.utcnow().timestamp() >= expire:
            # Nettoyage automatique d'un jail expiré
            try:
                os.remove(jail_file)
                logger.info("Jail expiré supprimé automatiquement")
            except OSError:
                pass
            return False
        return True
    except Exception:
        return False


def jail_status(jail_file: str = JAIL_FILE) -> Dict[str, Any]:
    """Retourne l'état détaillé du jail."""
    if not os.path.exists(jail_file):
        return {"active": False, "file": jail_file}
    try:
        with open(jail_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        expire = data.get("expire", 0)
        remaining = max(0, int(expire - datetime.datetime.utcnow().timestamp()))
        return {
            "active": remaining > 0,
            "activated_at": data.get("activated_at"),
            "ttl_hours": data.get("ttl_hours"),
            "reason": data.get("reason"),
            "remaining_seconds": remaining,
            "remaining_hours": remaining // 3600,
            "file": jail_file,
        }
    except Exception as exc:
        return {"active": False, "error": str(exc), "file": jail_file}


def activate_jail(ttl_hours: int, reason: str, jail_file: str = JAIL_FILE) -> Dict[str, Any]:
    """Active un jail avec TTL et raison."""
    if ttl_hours <= 0:
        raise ValueError("ttl_hours doit être > 0")
    expire = datetime.datetime.utcnow().timestamp() + ttl_hours * 3600
    data = {
        "activated_at": now_iso(),
        "expire": expire,
        "ttl_hours": ttl_hours,
        "reason": reason,
    }
    os.makedirs(os.path.dirname(jail_file) or ".", exist_ok=True)
    with open(jail_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    logger.warning("Jail activé: %sh — %s", ttl_hours, reason)
    return jail_status(jail_file)


def deactivate_jail(jail_file: str = JAIL_FILE) -> Dict[str, Any]:
    """Désactive le jail."""
    removed = False
    if os.path.exists(jail_file):
        try:
            os.remove(jail_file)
            removed = True
            logger.info("Jail désactivé manuellement")
        except OSError as exc:
            logger.error("Impossible de supprimer le jail: %s", exc)
    return {"active": False, "removed": removed, "file": jail_file}


def ensure_not_jailed(jail_file: str = JAIL_FILE) -> None:
    """Lève une exception si un jail est actif."""
    if is_jailed(jail_file):
        status = jail_status(jail_file)
        raise RuntimeError(
            f"Vérification désactivée par le mode jail (encore {status['remaining_hours']}h, "
            f"raison: {status['reason']})"
        )


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Gestion du mode jail MAIn")
    parser.add_argument("action", choices=["activate", "deactivate", "status", "check"])
    parser.add_argument("--hours", type=int, default=72)
    parser.add_argument("--reason", default="maintenance")
    args = parser.parse_args()

    if args.action == "activate":
        status = activate_jail(args.hours, args.reason)
        print(json.dumps(status, indent=2, ensure_ascii=False))
    elif args.action == "deactivate":
        status = deactivate_jail()
        print(json.dumps(status, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(jail_status(), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
