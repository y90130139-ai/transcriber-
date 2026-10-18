"""The OFMPro worker — what the Mac used to be asked to do by hand.

One pass:

  1. ask the cloud where each platform's coverage ends and what still has no
     R2 copy (`GET /api/worker/ofmpro/state`);
  2. wake the anti-detect browser, sign in if the session lapsed — codes from
     the AgentMail inbox — and fetch each platform's window from OFM Pro's own
     medias endpoint through that signed-in session;
  3. hand the rows to the cloud (upsert, dedupe by media id) and get back the
     rows still needing a mirror;
  4. download each file through the same browser session and put it in R2,
     then report the keys back so the console streams from R2 instead of a
     signed CDN link with days left on it;
  5. close the run with the numbers, sleep, repeat.

Environment (Railway service variables):

  CLOUD_URL            https://plan.gosianmedia.com  (the default; override
                       only for staging)
  WORKER_SECRET        the same bearer the Mac worker uses (required)
  AGENTMAIL_API_KEY    am_…   (reads the OFM Pro one-time code/link)
  AGENTMAIL_INBOX      submitbear-nora@agentmail.to
  OFMPRO_EMAIL         the OFM Pro login — the inbox address above
                       (OFM Pro is passwordless: email → one-time code)
  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
  PROXY_URL            optional residential proxy, e.g. http://user:pass@host:port
  DATA_DIR             the volume (default /data) — holds the browser profile
  LOOP_SEC             seconds between passes (default 21600 = 6h)
  WINDOW_DAYS          first-ever window when a platform has no coverage (14)
  DOWNLOADS_PER_RUN    mirror budget per pass (default 60)

Instagram (the Mac's sweep, same reader, cookies from here):

  IG_COOKIES_B64       base64 Netscape jar — capture_cookies.py prints it
  IG_STATE_B64         optional warm browser state, same capture prints it
  IG_SWEEP             daily (profiles + reels every day) | light (profiles only)
                       | full (weekly reels) | off (default)
  IG_ROSTER            "1" queues her winners for download after a clean full pass
  IG_MODEL_POSTS       on (default) | off — the daily roster read of our own
                       models' reels, which keeps the dashboard's
                       views-by-day-posted and her analytics current
"""
from __future__ import annotations

import json
import os
import random
import re
import string
import time
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import ig
import r2
from alert import alert, report as discord_report
from ofmpro import WorkerStopped, ensure_session, fetch_medias, open_browser
from schedule import finish_sweep, select_sweep

CLOUD = os.environ.get("CLOUD_URL", "https://plan.gosianmedia.com").rstrip("/")
SECRET = os.environ.get("WORKER_SECRET", "")
PLATFORMS = ("instagram", "tiktok", "twitter")
LOOP_SEC = int(os.environ.get("LOOP_SEC", str(6 * 3600)))
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "14"))
DOWNLOADS_PER_RUN = int(os.environ.get("DOWNLOADS_PER_RUN", "60"))
OFMPRO_SCRAPE_ENABLED = os.environ.get("OFMPRO_SCRAPE_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
R2_MIRROR_WORKERS = max(1, min(int(os.environ.get("R2_MIRROR_WORKERS", "4")), 8))
MEDIA_MIRROR_PAUSE_SEC = (0.2, 0.5)
SYNC_CHUNK = 200
FULL_RESCAN_MAX_PAGES = 300
# The daily pull's page budget. One page is ten rows, sort is newest-first,
# so a budget that runs out drops the OLDEST end of the window, never the
# days just added.
OFMPRO_DAILY_MAX_PAGES = int(os.environ.get("OFMPRO_DAILY_MAX_PAGES", "150"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
OFMPRO_PULL_STATE_PATH = DATA_DIR / "ofmpro-daily-pull.json"
IG_SCHEDULE_PATH = DATA_DIR / "ig-sweep-schedule.json"
IG_COOLDOWN_PATH = DATA_DIR / "ig-cooldown.json"
IG_REPORTS_PATH = DATA_DIR / "ig-daily-reports.json"
IG_MODEL_POSTS_PATH = DATA_DIR / "ig-model-posts.json"
IG_MODEL_POSTS_ENABLED = os.environ.get("IG_MODEL_POSTS", "1").strip().lower() not in {"0", "false", "no", "off"}
ACTIVE_IG_MODE: str | None = None
IG_REFRESH_HANDLES = tuple(sorted({
    handle.strip().lstrip("@").lower()
    for handle in os.environ.get("IG_REFRESH_HANDLES", "").split(",")
    if handle.strip()
}))
IG_REFRESH_KEY = ",".join(IG_REFRESH_HANDLES)
try:
    SCRAPE_ZONE = ZoneInfo(os.environ.get("SCRAPE_TIMEZONE", "America/New_York"))
except Exception:
    SCRAPE_ZONE = timezone.utc


def cloud_get(path: str) -> dict:
    request = urllib.request.Request(f"{CLOUD}{path}", headers={"Authorization": f"Bearer {SECRET}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def cloud_post(path: str, body: dict) -> dict:
    request = urllib.request.Request(
        f"{CLOUD}{path}",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read())


def cloud_delete(path: str) -> dict:
    request = urllib.request.Request(
        f"{CLOUD}{path}",
        headers={"Authorization": f"Bearer {SECRET}"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as response:
        try:
            return json.loads(response.read())
        except Exception:
            return {"deleted": False, "status": response.code}


def run_id() -> str:
    tail = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"ofm{datetime.utcnow().strftime('%y%m%d%H%M')}{tail}"


def notify_daily_summary(
    scrape_date: date,
    window_from: date,
    window_to: date,
    per_platform: dict[str, dict],
    fetched: int,
    inserted: int,
    updated: int,
    r2_queued: int,
) -> None:
    """Send one success report after the previous day's rows are upserted."""
    state_path = DATA_DIR / "ofmpro-daily-summary.json"
    report_date = scrape_date.isoformat()
    try:
        state = json.loads(state_path.read_text())
    except Exception:
        state = {}
    if state.get("sent_date") == report_date:
        return

    platform_lines = [
        f"{platform}: {counts.get('fetched', 0)} fetched, {counts.get('inserted', 0)} inserted, "
        f"{counts.get('updated', 0)} updated"
        for platform, counts in sorted(per_platform.items())
    ]
    detail = "\n".join([
        f"Previous day: {report_date}",
        f"Refetched window: {window_from.isoformat()} → {window_to.isoformat()}",
        *platform_lines,
        f"Total: {fetched} fetched · {inserted} inserted · {updated} updated",
        f"Cloudflare R2: {r2_queued} files queued for mirroring",
    ])
    title = f"OFM Pro daily scrape complete — {report_date}"
    if alert(title, detail):
        try:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(json.dumps({"sent_date": report_date}))
        except Exception as error:
            print(f"daily summary state could not be saved: {error}", flush=True)


def map_item(platform: str, item: dict) -> dict:
    """OFM Pro's raw item → the row the cloud stores. The same trim the
    backfill script makes; the shape is OFM Pro's, the keys are ours."""
    raws = item.get("raw_source_urls") or []
    mirrors = item.get("source_urls") or []
    account = item.get("account_data") or {}
    audio = item.get("audio_data") or {}
    score = item.get("outer_score")
    return {
        "media_id": str(item.get("id") or item.get("external_id") or ""),
        "shortcode": item.get("shortcode"),
        "post_url": item.get("share_url"),
        "posted_at": item.get("created_at"),
        "caption": item.get("caption"),
        "media_type": item.get("type"),
        "slides": len(raws) if item.get("type") == "SLIDESHOW" else None,
        "views": item.get("view_count") or 0,
        "likes": item.get("like_count") or 0,
        "comments": item.get("comment_count") or 0,
        "score": round(score * 100) / 100 if isinstance(score, (int, float)) else None,
        "username": account.get("username"),
        "nickname": account.get("nickname"),
        "followers": account.get("follower_count"),
        "audio": audio.get("name"),
        # Keep the first source for images/slideshows too so the worker can
        # mirror every media type and the app can replace signed links with R2.
        "raw_url": raws[0] if raws else None,
        "mirror_url": mirrors[0] if mirrors else None,
    }


def refresh_media_url(page, target: dict) -> str | None:
    """Ask OFM Pro for a fresh signed source URL when a stored link expired."""
    media_id = str(target.get("media_id") or "")
    if not media_id:
        return None
    base = os.environ.get("OFMPRO_MEDIAS_BASE", "https://api.ofmpro.com").rstrip("/")
    app = os.environ.get("OFMPRO_URL", "https://app.ofmpro.com").rstrip("/")
    headers = {
        "Content-Type": "application/json",
        "Referer": f"{app}/",
        "User-Agent": page.evaluate("() => navigator.userAgent"),
    }
    try:
        response = page.request.post(
            f"{base}/v2/medias/refresh/{urllib.parse.quote(media_id, safe='')}",
            headers=headers,
            timeout=30_000,
        )
        if not response.ok:
            return None
        envelope = response.json()
        if not isinstance(envelope, dict) or envelope.get("error"):
            return None
        data = envelope.get("data", envelope)
        if isinstance(data, dict):
            media = data.get("media") or data.get("item") or data
            if isinstance(media, dict):
                urls = media.get("raw_source_urls") or media.get("source_urls") or []
                if urls and isinstance(urls[0], str):
                    return urls[0]
                direct = media.get("raw_url") or media.get("source_url")
                if isinstance(direct, str):
                    return direct
    except Exception as error:
        print(f"  media refresh {target.get('platform')} {media_id}: {str(error)[:180]}")
    return None


def media_sources(target: dict) -> list[str]:
    return list(dict.fromkeys(
        value for value in (target.get("raw_url"), target.get("mirror_url"))
        if isinstance(value, str) and value
    ))


def mirror(page, platform: str, target: dict, config: dict) -> dict | None:
    """Browser-authenticated fallback for signed URLs that reject parallel GETs."""
    sources = media_sources(target)
    if not sources:
        return None
    headers = {
        "Referer": f"{os.environ.get('OFMPRO_URL', 'https://app.ofmpro.com').rstrip('/')}/",
        "User-Agent": page.evaluate("() => navigator.userAgent"),
    }
    response = None
    last_status: int | None = None
    media_url = sources[0]
    try:
        for source in sources:
            media_url = source
            try:
                response = page.request.get(source, headers=headers, timeout=120_000)
            except Exception as error:
                print(f"  mirror {platform} {target.get('media_id')}: {str(error)[:120]}", flush=True)
                continue
            if response.status == 403:
                refreshed = refresh_media_url(page, target)
                if refreshed:
                    media_url = refreshed
                    response = page.request.get(refreshed, headers=headers, timeout=120_000)
            if response.status == 403 and platform.lower() == "twitter":
                proxy_url = "https://cors-proxy.ofmpro.com/fetch?" + urllib.parse.urlencode({"url": media_url})
                response = page.request.get(proxy_url, headers=headers, timeout=120_000)
            if response.status < 400:
                break
            last_status = response.status
        if response is None or response.status >= 400:
            if last_status:
                print(f"  mirror {platform} {target['media_id']}: HTTP {last_status}", flush=True)
            return None
        body = response.body()
        if not body:
            return None
        content_type = (response.headers.get("content-type") or "video/mp4").split(";")[0].strip()
        key = r2.key_for(platform, str(target["media_id"]), content_type)
        r2.put(config, key, body, content_type)
        print(f"  mirror {platform} {target['media_id']}: {len(body) // 1024}KB → {key}", flush=True)
        return {"platform": platform, "media_id": str(target["media_id"]), "r2_key": key, "bytes": len(body)}
    except Exception as error:  # one dead file never kills the pass
        print(f"  mirror {platform} {target.get('media_id')}: {str(error)[:180]}", flush=True)
        return None


def mirror_parallel(
    platform: str,
    target: dict,
    config: dict,
    user_agent: str,
) -> tuple[dict | None, bool]:
    """Download a signed media URL and upload it to R2 in a bounded worker.

    The browser-only mirror remains the fallback for URLs that reject a direct
    signed fetch, where it can refresh the link in the authenticated session.
    The bool says whether that fallback should be attempted.
    """
    sources = media_sources(target)
    if not sources:
        return None, False
    headers = {
        "Referer": f"{os.environ.get('OFMPRO_URL', 'https://app.ofmpro.com').rstrip('/')}/",
        "User-Agent": user_agent,
    }
    needs_browser_fallback = False
    body = b""
    content_type = "video/mp4"
    for url in sources:
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read()
                content_type = (response.headers.get("content-type") or "video/mp4").split(";")[0].strip()
            if body:
                break
            needs_browser_fallback = True
        except urllib.error.HTTPError as error:
            print(f"  parallel mirror {platform} {target.get('media_id')}: HTTP {error.code}", flush=True)
            needs_browser_fallback = needs_browser_fallback or error.code in (401, 403)
        except Exception as error:
            print(f"  parallel mirror {platform} {target.get('media_id')}: {str(error)[:140]}", flush=True)
            needs_browser_fallback = True
    if not body:
        return None, needs_browser_fallback

    key = r2.key_for(platform, str(target["media_id"]), content_type)
    try:
        r2.put(config, key, body, content_type)
    except Exception as error:
        print(f"  parallel R2 upload {platform} {target.get('media_id')}: {str(error)[:140]}", flush=True)
        return None, False
    print(f"  mirror {platform} {target['media_id']}: {len(body) // 1024}KB → {key}", flush=True)
    return {"platform": platform, "media_id": str(target["media_id"]), "r2_key": key, "bytes": len(body)}, False


def discard_if_unplayable(target: dict) -> bool:
    """Ask the cloud to remove a media row only after R2 and source probes fail."""
    platform = str(target.get("platform") or "")
    media_id = str(target.get("media_id") or "")
    if not platform or not media_id:
        return False
    path = f"/api/ofmpro/{urllib.parse.quote(platform, safe='')}?{urllib.parse.urlencode({'mediaId': media_id})}"
    try:
        result = cloud_delete(path)
        if result.get("deleted"):
            print(f"  removed confirmed-unavailable {platform} media {media_id} from the feed", flush=True)
            return True
    except Exception as error:
        print(f"  availability cleanup {platform} {media_id}: {str(error)[:140]}", flush=True)
    return False


def pass_once() -> None:
    if not OFMPRO_SCRAPE_ENABLED:
        print("OFMPro scraping disabled by OFMPRO_SCRAPE_ENABLED; skipping scrape and mirror work", flush=True)
        return
    state = cloud_get(f"/api/worker/ofmpro/state?downloads={DOWNLOADS_PER_RUN}")
    coverage = {row["platform"]: row for row in state.get("coverage", [])}
    today = datetime.now(SCRAPE_ZONE).date()
    scrape_date = today - timedelta(days=1)
    rescan_marker = DATA_DIR / "ofmpro-full-refetch.done"
    full_refetch = os.environ.get("OFMPRO_RESCAN_ALL", "").strip() == "1" and not rescan_marker.exists()
    try:
        pull_state = json.loads(OFMPRO_PULL_STATE_PATH.read_text())
    except Exception:
        pull_state = {}
    daily_pull = pull_state.get("last_scrape_date") != today.isoformat()
    # A platform's newest day falling behind means the daily pull kept missing
    # it — a disabled or restarted worker, or a window that cannot see its own
    # end date. One extra pull per day is allowed to catch up; the guard
    # keeps a genuinely quiet platform from refetching on every pass.
    latest_days: list[date] = []
    for row in coverage.values():
        try:
            latest_days.append(date.fromisoformat(str(row["latest"])[:10]))
        except (KeyError, TypeError, ValueError):
            continue
    behind_days = (today - min(latest_days)).days if latest_days else 0
    catchup_pull = behind_days >= 2 and pull_state.get("last_catchup_date") != today.isoformat()
    should_fetch = daily_pull or full_refetch or catchup_pull
    # `maximum_created_at` is exclusive of the date it names — measured
    # 2026-10-13: until=2026-10-12 returned nothing created after Oct 11
    # 23:59. To read through the end of today, ask for tomorrow.
    fetch_until = today + timedelta(days=1)
    print(f"state: coverage {json.dumps(coverage)} · pending downloads {len(state.get('pending', []))}")
    if full_refetch:
        print("OFMPro: starting one-time historical page refetch", flush=True)
    if catchup_pull:
        print(f"OFMPro: coverage is {behind_days} days behind (newest is {min(latest_days)}); catching up", flush=True)
    buckets = [
        target for target in state.get("pending", [])
        if target.get("raw_url") or target.get("mirror_url")
    ][:DOWNLOADS_PER_RUN]
    if not should_fetch and not buckets:
        print("OFMPro: daily pull is complete and no R2 mirrors are waiting", flush=True)
        return
    if not should_fetch:
        print(f"OFMPro: daily pull already complete; mirroring {len(buckets)} pending files", flush=True)
    run = run_id()
    cloud_post("/api/worker/ofmpro/run", {"action": "open", "id": run})

    fetched = inserted = updated = downloaded = failed = 0
    per_platform: dict[str, dict] = {}
    # Drain already-stored rows first; the current OFM Pro API sync only
    # reports newly fetched rows, so ignoring this list leaves a backfill
    # permanently without R2 copies.
    queued = {(str(target.get("platform")), str(target.get("media_id"))) for target in buckets}
    bucket_indices = {
        (str(target.get("platform")), str(target.get("media_id"))): index
        for index, target in enumerate(buckets)
    }

    print("OFM Pro: launching browser", flush=True)
    playwright, context, page = open_browser()
    print("OFM Pro: browser ready; checking session", flush=True)
    try:
        ensure_session(page)

        run_window_from = scrape_date
        if should_fetch and full_refetch:
            earliest_dates = [
                date.fromisoformat(row["earliest"])
                for row in coverage.values()
                if row.get("earliest")
            ]
            if earliest_dates:
                run_window_from = min(earliest_dates)

        if should_fetch:
            for platform in PLATFORMS:
                platform_coverage = coverage.get(platform, {})
                latest = platform_coverage.get("latest")
                earliest = platform_coverage.get("earliest")
                if full_refetch:
                    since = date.fromisoformat(earliest) if earliest else scrape_date - timedelta(days=WINDOW_DAYS)
                    page_limit = FULL_RESCAN_MAX_PAGES
                else:
                    since = (datetime.fromisoformat(latest).date() - timedelta(days=1)) if latest \
                        else scrape_date - timedelta(days=WINDOW_DAYS)
                    page_limit = FULL_RESCAN_MAX_PAGES if catchup_pull else OFMPRO_DAILY_MAX_PAGES
                if since < run_window_from:
                    run_window_from = since
                # Newest first, always: the sort is what decides which rows
                # survive the page budget, and recency is the one thing the
                # active feed cannot do without. Score order starved the new
                # days behind old high-score posts (measured 2026-10-13).
                print(f"{platform}: window {since} → {today}")
                raw = fetch_medias(
                    page,
                    platform,
                    since.isoformat(),
                    fetch_until.isoformat(),
                    max_pages=page_limit,
                    sort="MOST_CREATED_AT",
                )
                rows = [map_item(platform, item) for item in raw if item.get("id") or item.get("external_id")]
                fetched += len(rows)
                platform_inserted = platform_updated = 0
                for at in range(0, len(rows), SYNC_CHUNK):
                    sync = cloud_post(
                        "/api/worker/ofmpro/sync",
                        {"platform": platform, "items": rows[at:at + SYNC_CHUNK]},
                    )
                    platform_inserted += sync.get("inserted", 0)
                    platform_updated += sync.get("updated", 0)
                    for target in sync.get("need", []):
                        key = (str(target.get("platform")), str(target.get("media_id")))
                        if key in queued:
                            # Prefer the URL just refreshed by the live API over a
                            # potentially expired signed URL from the stored backlog.
                            if key in bucket_indices:
                                buckets[bucket_indices[key]] = target
                            continue
                        if len(buckets) >= DOWNLOADS_PER_RUN:
                            break
                        buckets.append(target)
                        queued.add(key)
                        bucket_indices[key] = len(buckets) - 1
                inserted += platform_inserted
                updated += platform_updated
                per_platform[platform] = {
                    "fetched": len(rows),
                    "inserted": platform_inserted,
                    "updated": platform_updated,
                }
                time.sleep(random.uniform(4, 9))  # a person between tabs

        if full_refetch:
            rescan_marker.parent.mkdir(parents=True, exist_ok=True)
            rescan_marker.write_text(json.dumps({
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "window_from": run_window_from.isoformat(),
                "window_to": scrape_date.isoformat(),
                "fetched": fetched,
            }))
            print(f"OFMPro: historical refetch complete ({fetched} rows); marker saved", flush=True)

        if should_fetch:
            OFMPRO_PULL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            pull_marker = {"last_scrape_date": today.isoformat()}
            if catchup_pull:
                pull_marker["last_catchup_date"] = today.isoformat()
            OFMPRO_PULL_STATE_PATH.write_text(json.dumps(pull_marker))

        config = r2.bucket()
        if should_fetch:
            notify_daily_summary(
                scrape_date, run_window_from, today, per_platform,
                fetched, inserted, updated, len(buckets) if config else 0,
            )
        if config:
            user_agent = page.evaluate("() => navigator.userAgent")
            fallback_targets: list[dict] = []
            updates: list[dict] = []
            with ThreadPoolExecutor(max_workers=R2_MIRROR_WORKERS) as pool:
                futures = {
                    pool.submit(
                        mirror_parallel,
                        str(target["platform"]),
                        target,
                        config,
                        user_agent,
                    ): target
                    for target in buckets
                }
                for future in as_completed(futures):
                    target = futures[future]
                    try:
                        done, should_fallback = future.result()
                    except Exception as error:
                        print(f"  parallel mirror {target.get('platform')} {target.get('media_id')}: {str(error)[:140]}", flush=True)
                        done, should_fallback = None, True
                    if done:
                        downloaded += 1
                        updates.append(done)
                        if len(updates) >= 1_000:
                            cloud_post("/api/worker/ofmpro/run", {"updates": updates})
                            updates = []
                    elif should_fallback:
                        fallback_targets.append(target)
                    else:
                        failed += 1
                        discard_if_unplayable(target)
                if updates:
                    cloud_post("/api/worker/ofmpro/run", {"updates": updates})

            # The authenticated browser gets a sequential retry for signed URLs
            # that rejected a direct parallel fetch, unless the cloud confirms
            # every R2/source copy is already unavailable.
            for target in fallback_targets:
                if discard_if_unplayable(target):
                    failed += 1
                    continue
                done = mirror(page, str(target["platform"]), target, config)
                if done:
                    downloaded += 1
                    cloud_post("/api/worker/ofmpro/run", {"updates": [done]})
                else:
                    failed += 1
                    discard_if_unplayable(target)
                time.sleep(random.uniform(*MEDIA_MIRROR_PAUSE_SEC))
        else:
            alert("R2 credentials missing — videos are not being mirrored",
                  "rows are stored, but every preview keeps streaming from a signed CDN link with days left on it")

        cloud_post("/api/worker/ofmpro/run", {
            "action": "close", "id": run, "status": "done",
            "window_from": run_window_from.isoformat(),
            "window_to": today.isoformat(),
            "per_platform": per_platform,
            "fetched": fetched, "inserted": inserted, "updated": updated,
            "downloaded": downloaded, "failed": failed,
        })
        print(f"pass done: fetched {fetched} · inserted {inserted} · updated {updated} · mirrored {downloaded} · failed {failed}")
    except WorkerStopped as stop:
        cloud_post("/api/worker/ofmpro/run", {"action": "close", "id": run, "status": "failed", "error": str(stop)})
        raise
    except Exception as error:
        cloud_post("/api/worker/ofmpro/run", {"action": "close", "id": run, "status": "failed", "error": str(error)[:2000]})
        raise
    finally:
        context.close()
        playwright.stop()


IG_CHUNK = 250


def read_ig_reports() -> dict:
    try:
        data = json.loads(IG_REPORTS_PATH.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_ig_reports(reports: dict) -> None:
    IG_REPORTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    IG_REPORTS_PATH.write_text(json.dumps(reports))


def ig_report_sent_for_date(report_date: str) -> bool:
    return any(
        key.startswith(f"{report_date}:") and isinstance(value, dict) and value.get("sent")
        for key, value in read_ig_reports().items()
    )


def flush_ig_reports() -> None:
    """Deliver queued daily reports and retry failures at most hourly."""
    reports = read_ig_reports()
    now = datetime.now(timezone.utc)
    changed = False
    for entry in reports.values():
        if not isinstance(entry, dict) or entry.get("sent"):
            continue
        try:
            retry_after = datetime.fromisoformat(str(entry.get("retry_after", "")))
            if retry_after.tzinfo is None:
                retry_after = retry_after.replace(tzinfo=timezone.utc)
            if retry_after > now:
                continue
        except Exception:
            pass
        if discord_report(str(entry.get("title") or "Instagram daily refresh"),
                          str(entry.get("detail") or "No report details were recorded.")):
            entry["sent"] = True
            entry["sent_at"] = now.isoformat()
            entry.pop("retry_after", None)
        else:
            entry["retry_after"] = (now + timedelta(hours=1)).isoformat()
        changed = True
    if changed:
        try:
            write_ig_reports(reports)
        except Exception as error:
            print(f"ig: could not persist Discord report state: {error}", flush=True)


def queue_ig_report(report_date: str, outcome: str, detail: str) -> None:
    """Queue one durable Discord report per local date and outcome."""
    reports = read_ig_reports()
    key = f"{report_date}:{outcome}"
    existing = reports.get(key)
    if isinstance(existing, dict) and existing.get("sent"):
        return
    label = outcome.replace("_", " ").title()
    if not isinstance(existing, dict):
        existing = {
            "sent": False,
            "retry_after": datetime.now(timezone.utc).isoformat(),
        }
    existing["title"] = f"Instagram daily follower refresh — {report_date} · {label}"
    existing["detail"] = detail
    reports[key] = existing
    try:
        write_ig_reports(reports)
    except Exception as error:
        print(f"ig: could not queue Discord report: {error}", flush=True)
        return
    flush_ig_reports()


def active_ig_cooldown() -> dict | None:
    try:
        cooldown = json.loads(IG_COOLDOWN_PATH.read_text())
        until = datetime.fromisoformat(str(cooldown.get("until", "")))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return cooldown if until > datetime.now(timezone.utc) else None
    except Exception:
        return None

def scheduled_ig_mode(configured: str) -> str | None:
    """Choose a due pass; successful slots survive Railway restarts."""
    now = datetime.now(SCRAPE_ZONE)
    try:
        state = json.loads(IG_SCHEDULE_PATH.read_text())
    except Exception:
        state = {}
    cooldown = active_ig_cooldown()
    if cooldown:
        print(f"ig: honoring Instagram cooldown until {cooldown.get('until')}", flush=True)
        return None

    selected = select_sweep(configured, now, state, IG_REFRESH_KEY)
    if selected is None:
        return None
    try:
        IG_SCHEDULE_PATH.parent.mkdir(parents=True, exist_ok=True)
        IG_SCHEDULE_PATH.write_text(json.dumps(state))
    except Exception as error:
        print(f"ig: could not persist sweep schedule: {error}", flush=True)
    return selected


def record_ig_cooldown(reason: str) -> None:
    """Persist a conservative pause after Instagram signals a block or login wall."""
    retry_after = re.search(r"retry-after[=:\s]+(\d+)", reason, re.IGNORECASE)
    if retry_after:
        seconds = max(30 * 60, min(int(retry_after.group(1)), 24 * 60 * 60))
    elif any(signal in reason.lower() for signal in ("http 401", "http 403", "http 429", "challenge", "login")):
        seconds = 12 * 60 * 60
    else:
        seconds = 6 * 60 * 60
    until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    try:
        IG_COOLDOWN_PATH.parent.mkdir(parents=True, exist_ok=True)
        IG_COOLDOWN_PATH.write_text(json.dumps({
            "until": until.isoformat(),
            "reason": reason[:300],
        }))
    except Exception as error:
        print(f"ig: could not persist cooldown: {error}", flush=True)
    print(f"ig: paused all sessions for {seconds // 60} minutes after Instagram pushback", flush=True)


def finish_ig_schedule(mode: str | None, success: bool) -> None:
    if mode not in ("light", "full"):
        return
    now = datetime.now(SCRAPE_ZONE)
    try:
        state = json.loads(IG_SCHEDULE_PATH.read_text())
    except Exception:
        state = {}
    finish_sweep(os.environ.get("IG_SWEEP", "off").strip().lower(), mode, now, state, success, IG_REFRESH_KEY)
    try:
        IG_SCHEDULE_PATH.parent.mkdir(parents=True, exist_ok=True)
        IG_SCHEDULE_PATH.write_text(json.dumps(state))
    except Exception as error:
        print(f"ig: could not persist sweep result: {error}", flush=True)


def mark_model_posts_done() -> None:
    try:
        IG_MODEL_POSTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        IG_MODEL_POSTS_PATH.write_text(
            json.dumps({"last_completed_date": datetime.now(SCRAPE_ZONE).date().isoformat()}))
    except Exception as error:
        print(f"ig: could not persist model-reels schedule: {error}", flush=True)


def maybe_model_posts() -> None:
    """Read our own models' reels for the analytics tables — the Mac's roster
    pass, on its own once-a-day slot so the dashboard's views-by-day-posted
    keeps moving even when the follower read already ran today or the
    container restarted (measured 2026-10-13: the Railway move left it
    behind and model posts stopped at Oct 10).

    Posts only: no sightings, no winners. A model's own posts are the record
    of what she has done, not ideas to hand her — the same rule the Mac kept.
    The light sweep already read every header; this half brings the plays.
    """
    if not IG_MODEL_POSTS_ENABLED:
        return
    cooldown = active_ig_cooldown()
    if cooldown:
        print(f"ig: model-reels refresh skipped — cooldown until {cooldown.get('until')}", flush=True)
        return
    today = datetime.now(SCRAPE_ZONE).date().isoformat()
    try:
        state = json.loads(IG_MODEL_POSTS_PATH.read_text())
    except Exception:
        state = {}
    if state.get("last_completed_date") == today:
        return
    burners = ig.jars()
    if not burners:
        print("ig: model-reels refresh has no cookie session", flush=True)
        return
    targets = cloud_post("/api/scout/targets", {})
    mine = [str(h) for h in targets.get("mine") or [] if h]
    if not mine:
        print("ig: no model accounts to read for the analytics tables", flush=True)
        mark_model_posts_done()
        return

    label, jar, cookie_state = burners[0]
    run = "roster" + datetime.utcnow().strftime("%y%m%d%H%M")
    started = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    collected: list[dict] = []

    def keep(_reels: list, rows: list, _snap) -> None:
        collected.extend(rows)

    print(f"ig roster pass {run}: {len(mine)} model accounts on burner '{label}'", flush=True)
    stopped: str | None = None
    try:
        _found, _access, stopped = ig.sweep(mine, jar, cookie_state, record=keep)
    except Exception as error:
        stopped = f"{type(error).__name__}: {error}"
    stored = 0
    for at in range(0, len(collected), IG_CHUNK):
        result = cloud_post("/api/scout/ingest", {
            "run_id": run, "started_at": started,
            "sightings": [], "posts": collected[at:at + IG_CHUNK],
            "final": False,
        })
        stored += int(result.get("posts") or 0)
    if stopped:
        record_ig_cooldown(stopped)
        print(f"ig roster pass stopped: {stopped[:240]}", flush=True)
    else:
        mark_model_posts_done()
    print(f"ig roster done: {stored} posts from {len(mine)} accounts of {len(collected)} read"
          + (f" · stopped: {stopped[:160]}" if stopped else ""), flush=True)


def ig_pass() -> None:
    """The Mac's sweep, unchanged in process — roster from the cloud, the same
    two-tab reader, the same stop rules — posting to the same ingest route.
    Only the cookie's address changed: it arrives in an env var."""
    flush_ig_reports()
    configured_mode = os.environ.get("IG_SWEEP", "off").strip().lower()
    if configured_mode not in ("light", "full", "daily"):
        return
    mode = scheduled_ig_mode(configured_mode)
    if mode is None:
        cooldown = active_ig_cooldown()
        report_date = datetime.now(SCRAPE_ZONE).date().isoformat()
        if cooldown and not ig_report_sent_for_date(report_date):
            queue_ig_report(report_date, "paused", "Status: PAUSED — no Instagram requests were made today.\n"
                            f"Cooldown until: {cooldown.get('until')}\n"
                            f"Reason: {str(cooldown.get('reason') or 'Instagram pushback')[:300]}")
        # The follower read is done (or cooling down) for today; the
        # model-reels pass has its own slot and may not have run yet.
        maybe_model_posts()
        return
    global ACTIVE_IG_MODE
    ACTIVE_IG_MODE = mode
    burners = ig.jars()
    if not burners:
        detail = (f"Status: FAILED — no Instagram cookie sessions were available.\n"
                  f"Configured mode: {mode}. Neither the primary nor backup cookie jar was found.")
        alert("Instagram sweep is configured but has no cookies", detail)
        finish_ig_schedule(mode, success=False)
        queue_ig_report(datetime.now(SCRAPE_ZONE).date().isoformat(), "failed", detail)
        ACTIVE_IG_MODE = None
        return

    targets = cloud_post("/api/scout/targets", {})
    creators = [str(c.get("handle") if isinstance(c, dict) else c) for c in targets.get("creators") or []]
    handles = [h for h in dict.fromkeys(creators + [str(h) for h in targets.get("mine") or []]) if h]
    force_handles = IG_REFRESH_HANDLES if mode == "light" else ()
    if force_handles:
        try:
            schedule_state = json.loads(IG_SCHEDULE_PATH.read_text())
        except Exception:
            schedule_state = {}
        if schedule_state.get("last_forced_light_refresh") == IG_REFRESH_KEY:
            force_handles = ()
    if force_handles:
        available = {handle.lower() for handle in handles}
        unknown = [handle for handle in force_handles if handle not in available]
        forced = set(force_handles)
        handles = [handle for handle in handles if handle.lower() in forced]
        if unknown:
            print(f"ig: forced refresh handles not in today's target list: {unknown}", flush=True)
        print(f"ig: forced refresh of {len(handles)} requested handles", flush=True)
    if not handles:
        print("ig: no handles to sweep")
        detail = "Status: FAILED — the cloud returned no tracked Instagram handles.\nFresh follower snapshots: 0."
        finish_ig_schedule(mode, success=False)
        queue_ig_report(datetime.now(SCRAPE_ZONE).date().isoformat(), "failed", detail)
        ACTIVE_IG_MODE = None
        return

    run_id = "ig" + datetime.utcnow().strftime("%y%m%d%H%M") + "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    started = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"ig {mode} pass {run_id}: {len(handles)} handles · burners {[b[0] for b in burners]}")

    if mode == "light":
        snapshots_by_handle: dict[str, dict] = {}
        stopped: str | None = None
        gone: dict[str, str] = {}
        renamed: dict[str, str] = {}
        remaining = handles
        for index, (label, jar, state) in enumerate(burners):
            if index:
                if stopped:
                    break
                delay = random.uniform(120.0, 240.0)
                print(f"ig: waiting {int(delay)}s before backup retries {len(remaining)} missing profiles", flush=True)
                time.sleep(delay)
            found, missing, burner_gone, burner_renamed, burner_stopped = ig.light_sweep(remaining, jar, state)
            for snapshot in found:
                if snapshot.get("followers") is not None:
                    snapshots_by_handle[str(snapshot["handle"]).lower()] = snapshot
            gone.update(burner_gone)
            renamed.update(burner_renamed)
            # Only genuinely-unclassified misses go to the backup session:
            # a handle Instagram no longer serves is not worth a second try,
            # and every skipped retry is a session left alone.
            remaining = missing
            if not remaining:
                break
            if burner_stopped:
                stopped = burner_stopped
                record_ig_cooldown(stopped)
                print(f"ig: burner '{label}' stopped; backup held to protect its session", flush=True)
                break
            elif missing:
                print(f"ig: burner '{label}' returned no follower count for {len(missing)} handles", flush=True)
        snapshots = list(snapshots_by_handle.values())
        if remaining:
            print(f"ig: {len(remaining)} handles still missing follower counts: {remaining}", flush=True)
        if gone:
            print(f"ig: {len(gone)} handles no longer resolve on Instagram: {sorted(gone)}", flush=True)
        result = cloud_post("/api/scout/ingest", {
            "run_id": run_id, "started_at": started,
            "kind": "profiles",
            "snapshots": snapshots, "final": True,
            "stats": {
                "handles": len(handles),
                "snapshots": len(snapshots),
                "errors": ([f"{len(remaining)} handles missing follower counts: {', '.join(remaining[:30])}"[:1000]] if remaining else [])
                    + ([f"{len(gone)} handles no longer resolve on Instagram: {', '.join(sorted(gone)[:30])}"[:1000]] if gone else [])
                    + ([f"burner stopped: {stopped}"[:300]] if stopped else []),
            },
        })
        coverage_label = "requested-handle coverage" if force_handles else "target coverage"
        print(f"ig light done: {len(snapshots)}/{len(handles)} follower snapshots Â· picked {result.get('picked', 0)}"
              + (f" Â· {len(remaining)} still missing" if remaining else f" Â· 100% {coverage_label}")
              + (f" Â· {len(gone)} no longer on Instagram" if gone else ""))
        outcome = "blocked" if stopped else "incomplete" if remaining else "complete"
        report_date = datetime.now(SCRAPE_ZONE).date().isoformat()
        report_lines = [
            f"Run date: {report_date} ({SCRAPE_ZONE})",
            "Refresh: daily Instagram profile/follower read",
            f"Outcome: {outcome.upper()}",
            f"Tracked handles in this run: {len(handles)}",
            f"Fresh follower snapshots: {len(snapshots)}",
            f"Missing follower snapshots: {len(remaining)}",
            f"Cookie sessions available: {', '.join(label for label, _, _ in burners)}",
            "Creator view: /creators",
        ]
        if remaining:
            report_lines.append(f"Handles without a follower read: {', '.join(remaining[:40])}")
        if renamed:
            report_lines.append("Renamed on Instagram (update the watchlist handle): "
                                + ", ".join(f"{old} -> {new}" for old, new in sorted(renamed.items())))
        if gone:
            report_lines.append(f"Accounts Instagram no longer resolves ({len(gone)}): {', '.join(sorted(gone)[:40])}")
            report_lines.append("These were deleted, renamed or suspended. Re-point or stop watching them on /creators;"
                                " they are checked again every day and drop off this list if they come back.")
        if stopped:
            report_lines.append(f"Stopped for session safety: {stopped[:300]}")
        finish_ig_schedule(mode, success=not remaining)
        queue_ig_report(report_date, outcome, "\n".join(report_lines))
        ACTIVE_IG_MODE = None
        # The follower read is done for today; the model-reels pass keeps its
        # own once-a-day slot and runs now on the same warm session.
        if not stopped:
            maybe_model_posts()
        return

    pending: dict[str, list] = {"posts": [], "snaps": []}
    ingest_errors: list[str] = []

    def keep(reels, rows, snap) -> None:
        pending["posts"].extend(rows)
        if snap:
            pending["snaps"].append(snap)
        # Save each creator as it is read. A full watchlist takes hours; a
        # container restart or late login wall must not lose the entire day.
        handle = (snap or {}).get("handle") or next(
            (row.get("handle") for row in [*reels, *rows] if row.get("handle")), None)
        for at in range(0, max(len(reels), len(rows), 1), IG_CHUNK):
            try:
                cloud_post("/api/scout/ingest", {
                    "run_id": run_id, "started_at": started, "kind": "sweep",
                    "sightings": reels[at:at + IG_CHUNK],
                    "posts": rows[at:at + IG_CHUNK],
                    "snapshots": [snap] if snap and at == 0 else [],
                    "swept": [handle] if handle and at == 0 else [],
                    "final": False,
                })
            except Exception as error:
                ingest_errors.append(f"@{handle or 'unknown'} chunk not stored: {error}"[:300])
                print(f"ig: {ingest_errors[-1]}", flush=True)

    # Any Instagram pushback stops the entire multi-session pass. The cooldown
    # prevents the backup account from immediately repeating blocked traffic.
    remaining = handles
    sightings: list[dict] = []
    access: dict[str, str] = {}
    stopped = None
    for label, jar, state in burners:
        found, learned, stopped = ig.sweep(remaining, jar, state, record=keep)
        sightings += found
        access.update(learned)
        if not stopped:
            break
        record_ig_cooldown(stopped)
        print(f"ig: burner '{label}' stopped; remaining sessions held to protect them", flush=True)
        break
    cadence = pending["posts"]
    stats = {"handles": len(handles), "sightings": len(sightings), "errors": ingest_errors}
    if stopped:
        stats["errors"].append(f"burner stopped: {stopped}"[:300])

    swept = sorted({s["handle"] for s in sightings} | set(access))
    access_rows = [{"handle": h, "access": a} for h, a in access.items()]

    # If a streaming write failed, retry the collected rows once before picking.
    # All upserts are idempotent. Normally only the final pick request remains.
    retry_span = max(len(sightings), len(cadence)) if ingest_errors else 0
    chunks = [sightings[i:i + IG_CHUNK] for i in range(0, retry_span, IG_CHUNK)] or [[]]
    result: dict = {}
    for index, chunk in enumerate(chunks):
        final = index == len(chunks) - 1
        body = {
            "run_id": run_id, "started_at": started,
            "kind": "sweep",
            "sightings": chunk,
            "posts": cadence[index * IG_CHUNK:(index + 1) * IG_CHUNK] if retry_span else [],
            "snapshots": pending["snaps"] if retry_span and index == 0 else [],
            "access": access_rows if index == 0 else [],
            "swept": swept if index == 0 else [],
            "final": final,
            "stats": stats if final else None,
        }
        try:
            result = cloud_post("/api/scout/ingest", body)
        except Exception as error:
            if final:
                raise
            stats["errors"].append(f"chunk {index + 1} not stored: {error}"[:300])
    print(f"ig full done: {len(sightings)} sightings · {len(cadence)} cadence rows · "
          f"picked {result.get('picked', 0)}" + (f" · stopped: {stopped}" if stopped else ""))

    report_date = datetime.now(SCRAPE_ZONE).date().isoformat()
    snapshots_read = len(pending["snaps"])
    snapshot_missing = max(0, len(handles) - snapshots_read)
    outcome = "blocked" if stopped else "incomplete" if snapshot_missing else "complete"
    report_lines = [
        f"Run date: {report_date} ({SCRAPE_ZONE})",
        "Refresh: daily creator profiles + reels + last 3 days' winning content" if configured_mode == "daily"
            else "Refresh: Instagram profile/follower read + full reel sweep",
        f"Outcome: {outcome.upper()}",
        f"Tracked handles in this run: {len(handles)}",
        f"Fresh follower snapshots: {snapshots_read}",
        f"Missing follower snapshots: {snapshot_missing}",
        f"Cookie sessions available: {', '.join(label for label, _, _ in burners)}",
        "Creator view: /creators",
        f"Reels refreshed: {len(sightings)}",
        f"New winners queued for the Media Library: {result.get('queued', 0)}",
    ]
    if stopped:
        report_lines.append(f"Stopped for session safety: {stopped[:300]}")

    if os.environ.get("IG_ROSTER") == "1" and not stopped:
        queued = cloud_post("/api/scout/hers", {})
        print(f"ig roster: queued {queued.get('queued', 0)} winners for download")
    if not stopped:
        # The full sweep already read the models' reels; today's separate
        # model-reels slot is spent.
        mark_model_posts_done()
    finish_ig_schedule(mode, success=not stopped and not stats["errors"])
    queue_ig_report(report_date, outcome, "\n".join(report_lines))
    ACTIVE_IG_MODE = None


def main() -> None:
    global ACTIVE_IG_MODE
    if not CLOUD or not SECRET:
        raise SystemExit("CLOUD_URL and WORKER_SECRET are required")
    while True:
        try:
            ig_pass()
        except WorkerStopped as stop:
            finish_ig_schedule(ACTIVE_IG_MODE, success=False)
            if ACTIVE_IG_MODE:
                queue_ig_report(
                    datetime.now(SCRAPE_ZONE).date().isoformat(),
                    "blocked",
                    f"Status: HALTED — Instagram instructed the worker to stop for session safety.\n{str(stop)[:500]}",
                )
            ACTIVE_IG_MODE = None
            alert("Instagram sweep stopped — a human is needed", str(stop))
            time.sleep(1800)
        except Exception as error:
            finish_ig_schedule(ACTIVE_IG_MODE, success=False)
            if ACTIVE_IG_MODE:
                queue_ig_report(
                    datetime.now(SCRAPE_ZONE).date().isoformat(),
                    "failed",
                    f"Status: FAILED — the daily Instagram refresh did not finish.\n{type(error).__name__}: {str(error)[:500]}",
                )
            ACTIVE_IG_MODE = None
            alert("Instagram sweep failed", f"{type(error).__name__}: {error}")
        try:
            pass_once()
        except WorkerStopped as stop:
            alert("OFM Pro scrape stopped — a human is needed", str(stop))
            time.sleep(3600)
            continue
        except Exception as error:
            alert("OFM Pro scrape failed", f"{type(error).__name__}: {error}")
            time.sleep(900)
            continue
        time.sleep(LOOP_SEC + random.uniform(0, 600))


if __name__ == "__main__":
    main()
