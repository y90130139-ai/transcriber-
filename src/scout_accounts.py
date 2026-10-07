"""The burner accounts Scout may use, and which one is active.

One burner was a single point of failure: when its session expired, the next
pass produced nothing until a human re-read cookies off the phone. This keeps a
list instead — the main account plus any number of backups — so an expired
session is a failover, not an outage.

The registry is `secrets/scout-accounts.json` (0600, never committed). With no
file, everything behaves exactly as before: one account, the jar named in
config.json under `scout.burner_cookies`.

Health (`last_status`, `last_checked_at`, `last_error`) is written by
src.session_health, never here — this module only records and reads. Passes ask
`active()` for the jar to use; probes call `mark()` and `rotate()`.

    entry = active()                     # {'id': 'scout', 'jar': '…', …}
    mark('scout', 'dead', why)           # what a probe or a stopped pass learned
    rotate(exclude='scout')              # point active at the next healthy one
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from . import config

REGISTRY = config.ROOT / "secrets" / "scout-accounts.json"
DEFAULT_JAR = "secrets/scout-cookies.txt"
STATUSES = ("alive", "dead", "unknown", "off")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _legacy() -> dict:
    """The account as config.json describes it today, for upgrades."""
    settings = config.load_user_config().get("scout") or {}
    jar = str(settings.get("burner_cookies") or DEFAULT_JAR)
    return {
        "id": "scout",
        "label": "Scout (main)",
        "jar": jar,
        "enabled": True,
        "last_status": None,
        "last_checked_at": None,
        "last_error": None,
    }


def resolve(path: str | Path) -> Path:
    """A registry jar path → an absolute path, relative to the project."""
    candidate = Path(path).expanduser()
    return candidate if candidate.is_absolute() else config.ROOT / candidate


def state_for(jar: Path) -> Path:
    """Each account keeps its own browser profile beside its jar.

    The legacy name is preserved for the main jar so an upgrade does not lose
    the warm session the passes have been carrying forward.
    """
    name = jar.name
    if name.endswith("-cookies.txt"):
        stem = name[: -len("-cookies.txt")]
        return jar.with_name("scout-state.json" if stem == "scout" else f"{stem}-state.json")
    return jar.with_name(jar.name + ".state.json")


def load() -> dict:
    """The registry, with the configured account present even before the file
    exists — so callers never need a special case for 'no backups yet'."""
    try:
        reg = json.loads(REGISTRY.read_text())
    except (OSError, ValueError):
        reg = {}
    accounts = reg.get("accounts")
    if not isinstance(accounts, list):
        accounts = []
    if not any(a.get("id") == "scout" or a.get("jar") == _legacy()["jar"] for a in accounts):
        accounts.insert(0, _legacy())
    reg = {"active": reg.get("active"), "accounts": accounts}
    if not reg["active"] or not any(a.get("id") == reg["active"] for a in accounts):
        first = next((a for a in accounts if a.get("enabled", True)), accounts[0])
        reg["active"] = first["id"]
    return reg


def save(reg: dict) -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    handle = os.open(str(REGISTRY), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(handle, "w") as file:
        file.write(json.dumps(reg, indent=1))
    os.chmod(REGISTRY, 0o600)


def entries(enabled_only: bool = False) -> list[dict]:
    rows = load()["accounts"]
    if enabled_only:
        rows = [a for a in rows if a.get("enabled", True)]
    return rows


def get(account_id: str) -> dict | None:
    return next((a for a in entries() if a.get("id") == account_id), None)


def active() -> dict:
    reg = load()
    return next((a for a in reg["accounts"] if a.get("id") == reg["active"]), _legacy())


def active_jar() -> Path:
    return resolve(active()["jar"])


def set_active(account_id: str) -> dict | None:
    reg = load()
    entry = next((a for a in reg["accounts"] if a.get("id") == account_id), None)
    if entry is None:
        return None
    reg["active"] = account_id
    save(reg)
    return entry


def next_healthy(exclude: str | None = None) -> dict | None:
    """The best account to use if the current one dies.

    `alive` first, then never-checked, then `unknown`; `dead` never. The active
    account is skipped so a rotation always moves."""
    candidates = [a for a in entries(enabled_only=True) if a.get("id") != exclude]
    rank = {"alive": 0, None: 1, "unknown": 2}
    ranked = [a for a in candidates if a.get("last_status") in rank]
    ranked.sort(key=lambda a: rank[a.get("last_status")])
    return ranked[0] if ranked else None


def rotate(exclude: str | None = None) -> tuple[dict, dict] | None:
    """Move `active` to the next healthy account. (old, new) or None."""
    reg = load()
    old = next((a for a in reg["accounts"] if a.get("id") == reg["active"]), None)
    if old is None:
        return None
    new = next_healthy(exclude=old["id"])
    if new is None:
        return None
    reg["active"] = new["id"]
    save(reg)
    return old, new


def mark(account_id: str, status: str, why: str = "") -> None:
    """Record what a probe or a stopped pass learned about one account."""
    reg = load()
    entry = next((a for a in reg["accounts"] if a.get("id") == account_id), None)
    if entry is None:
        return
    entry["last_status"] = status if status in STATUSES else "unknown"
    entry["last_checked_at"] = _now()
    entry["last_error"] = why[:200] if why else None
    save(reg)


def slug(label: str) -> str:
    """A label → a stable id. Falls back to the next free `backup-N`."""
    base = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-") or "backup"
    taken = {a.get("id") for a in entries()}
    if base not in taken:
        return base
    for n in range(2, 100):
        if f"{base}-{n}" not in taken:
            return f"{base}-{n}"
    return f"backup-{int(time.time())}"


def add(label: str, jar: str) -> dict:
    """Register an account and return its entry. The caller writes the jar."""
    reg = load()
    entry = {
        "id": slug(label),
        "label": label.strip() or "Backup",
        "jar": jar,
        "enabled": True,
        "last_status": None,
        "last_checked_at": None,
        "last_error": None,
    }
    reg["accounts"].append(entry)
    save(reg)
    return entry
