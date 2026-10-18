"""Persistent Instagram slots, independent of the worker's polling interval."""
from __future__ import annotations

from datetime import datetime


def select_sweep(configured: str, now: datetime, state: dict, refresh_key: str = "") -> str | None:
    today = now.date().isoformat()
    week = now.strftime("%G-W%V")
    if configured == "daily":
        if today in (state.get("last_content_completed_date"), state.get("last_content_failed_date")):
            return None
        state["last_content_started_date"] = today
        return "full"
    if configured == "light":
        if refresh_key and state.get("last_forced_light_refresh") != refresh_key:
            state["forced_light_started"] = refresh_key
        elif today in (state.get("last_light_completed_date"), state.get("last_light_failed_date")):
            return None
        else:
            state["last_light_started_date"] = today
        return "light"
    if configured == "full":
        if (now.weekday() == 4 and state.get("last_full_completed_week") != week
                and state.get("last_full_failed_week") != week):
            state["last_full_started_week"] = week
            return "full"
        if today not in (state.get("last_light_completed_date"), state.get("last_light_failed_date")):
            state["last_light_started_date"] = today
            return "light"
    return None


def finish_sweep(configured: str, mode: str, now: datetime, state: dict, success: bool,
                 refresh_key: str = "") -> None:
    today = now.date().isoformat()
    result = "completed" if success else "failed"
    if mode == "full":
        if configured == "daily":
            # Use the date the pass STARTED. A large watchlist can cross midnight;
            # finishing yesterday's work must not spend today's refresh slot.
            state[f"last_content_{result}_date"] = state.get("last_content_started_date", today)
        else:
            state[f"last_full_{result}_week"] = state.get("last_full_started_week", now.strftime("%G-W%V"))
        if success:
            state["last_light_completed_date"] = today
    elif mode == "light":
        state[f"last_light_{result}_date"] = state.get("last_light_started_date", today)
        if refresh_key and state.get("forced_light_started") == refresh_key:
            state["last_forced_light_refresh"] = refresh_key
            state.pop("forced_light_started", None)
