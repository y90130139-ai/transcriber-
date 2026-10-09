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

  CLOUD_URL            https://transcriber-ten-zeta.vercel.app  (required)
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
  IG_SWEEP             off (default) | light (daily story read) | full (weekly)
  IG_ROSTER            "1" queues her winners for download after a clean full pass
"""
from __future__ import annotations

import json
import os
import random
import string
import time
import urllib.request
from datetime import date, datetime, timedelta

import ig
import r2
from ofmpro import WorkerStopped, ensure_session, fetch_medias, open_browser

CLOUD = os.environ.get("CLOUD_URL", "").rstrip("/")
SECRET = os.environ.get("WORKER_SECRET", "")
PLATFORMS = ("instagram", "tiktok", "twitter")
LOOP_SEC = int(os.environ.get("LOOP_SEC", str(6 * 3600)))
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "14"))
DOWNLOADS_PER_RUN = int(os.environ.get("DOWNLOADS_PER_RUN", "60"))


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


def run_id() -> str:
    tail = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"ofm{datetime.utcnow().strftime('%y%m%d%H%M')}{tail}"


def map_item(platform: str, item: dict) -> dict:
    """OFM Pro's raw item → the row the cloud stores. The same trim the
    backfill script makes; the shape is OFM Pro's, the keys are ours."""
    pictures = item.get("type") in ("IMAGE", "SLIDESHOW")
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
        "raw_url": None if pictures else (raws[0] if raws else None),
        "mirror_url": mirrors[0] if mirrors else None,
    }


def mirror(page, platform: str, target: dict, config: dict) -> dict | None:
    """One file: CDN → bytes → R2. Videos and stills both, so a slideshow
    frame outlives the signature that served it."""
    url = target.get("raw_url")
    if not url:
        return None
    try:
        response = page.request.get(url, timeout=120_000)
        if response.status >= 400:
            print(f"  mirror {platform} {target['media_id']}: HTTP {response.status}")
            return None
        body = response.body()
        if not body:
            return None
        content_type = (response.headers.get("content-type") or "video/mp4").split(";")[0].strip()
        key = r2.key_for(platform, str(target["media_id"]), content_type)
        r2.put(config, key, body, content_type)
        print(f"  mirror {platform} {target['media_id']}: {len(body) // 1024}KB → {key}")
        return {"platform": platform, "media_id": str(target["media_id"]), "r2_key": key, "bytes": len(body)}
    except Exception as error:  # one dead file never kills the pass
        print(f"  mirror {platform} {target.get('media_id')}: {error}")
        return None


def pass_once() -> None:
    state = cloud_get(f"/api/worker/ofmpro/state?downloads={DOWNLOADS_PER_RUN}")
    coverage = {row["platform"]: row for row in state.get("coverage", [])}
    print(f"state: coverage {json.dumps(coverage)} · pending downloads {len(state.get('pending', []))}")
    run = run_id()
    cloud_post("/api/worker/ofmpro/run", {"action": "open", "id": run})

    fetched = inserted = updated = downloaded = failed = 0
    per_platform: dict[str, dict] = {}
    buckets: list[dict] = []

    playwright, context, page = open_browser()
    try:
        ensure_session(page)

        today = date.today()
        for platform in PLATFORMS:
            latest = coverage.get(platform, {}).get("latest")
            since = (datetime.fromisoformat(latest).date() - timedelta(days=1)) if latest \
                else today - timedelta(days=WINDOW_DAYS)
            print(f"{platform}: window {since} → {today}")
            raw = fetch_medias(page, platform, since.isoformat(), today.isoformat())
            rows = [map_item(platform, item) for item in raw if item.get("id") or item.get("external_id")]
            fetched += len(rows)
            sync = cloud_post("/api/worker/ofmpro/sync", {"platform": platform, "items": rows})
            inserted += sync.get("inserted", 0)
            updated += sync.get("updated", 0)
            per_platform[platform] = {"fetched": len(rows), **{k: sync.get(k, 0) for k in ("inserted", "updated")}}
            for target in sync.get("need", []):
                if len(buckets) >= DOWNLOADS_PER_RUN:
                    break
                buckets.append(target)
            time.sleep(random.uniform(4, 9))  # a person between tabs

        config = r2.bucket()
        if config:
            for target in buckets:
                platform = str(target["platform"])
                done = mirror(page, platform, target, config)
                if done:
                    downloaded += 1
                    cloud_post("/api/worker/ofmpro/run", {"updates": [done]})
                else:
                    failed += 1
                time.sleep(random.uniform(2, 6))
        else:
            print("no R2 credentials — rows stored, mirrors skipped")

        cloud_post("/api/worker/ofmpro/run", {
            "action": "close", "id": run, "status": "done",
            "window_from": (date.today() - timedelta(days=WINDOW_DAYS)).isoformat(),
            "window_to": date.today().isoformat(),
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

def ig_pass() -> None:
    """The Mac's sweep, unchanged in process — roster from the cloud, the same
    two-tab reader, the same stop rules — posting to the same ingest route.
    Only the cookie's address changed: it arrives in an env var."""
    mode = os.environ.get("IG_SWEEP", "off").strip().lower()
    if mode not in ("light", "full"):
        return
    burners = ig.jars()
    if not burners:
        print("ig: skipped — no cookies (set IG_COOKIES_B64 / IG_COOKIES_BACKUP_B64)")
        return

    targets = cloud_post("/api/scout/targets", {})
    creators = [str(c.get("handle") if isinstance(c, dict) else c) for c in targets.get("creators") or []]
    handles = [h for h in dict.fromkeys(creators + [str(h) for h in targets.get("mine") or []]) if h]
    if not handles:
        print("ig: no handles to sweep")
        return

    run_id = "ig" + datetime.utcnow().strftime("%y%m%d%H%M") + "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    started = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"ig {mode} pass {run_id}: {len(handles)} handles · burners {[b[0] for b in burners]}")

    if mode == "light":
        snapshots: list[dict] = []
        stopped: str | None = None
        for label, jar, state in burners:
            if stopped:
                print(f"ig: burner '{label}' takes over the story read")
            found, stopped = ig.light_sweep(handles, jar, state)
            snapshots += found
            if not stopped:
                break
        result = cloud_post("/api/scout/ingest", {
            "run_id": run_id, "started_at": started,
            "snapshots": snapshots, "final": True,
            "stats": {
                "snapshots": len(snapshots),
                "errors": [f"burner stopped: {stopped}"[:300]] if stopped else [],
            },
        })
        print(f"ig light done: {len(snapshots)} snapshots · picked {result.get('picked', 0)}"
              + (f" · stopped: {stopped}" if stopped else ""))
        return

    pending: dict[str, list] = {"posts": [], "snaps": []}

    def keep(reels, rows, snap) -> None:
        pending["posts"].extend(rows)
        if snap:
            pending["snaps"].append(snap)

    # The primary reads; a stop moves the REST of the roster to the backup —
    # the Mac's registry rule, same pass, no human between.
    remaining = handles
    sightings: list[dict] = []
    access: dict[str, str] = {}
    stopped = None
    for label, jar, state in burners:
        if stopped:
            print(f"ig: burner '{label}' takes over {len(remaining)} remaining handles")
        found, learned, stopped = ig.sweep(remaining, jar, state, record=keep)
        sightings += found
        access.update(learned)
        if not stopped:
            break
        remaining = [h for h in remaining if h not in access]
    cadence = pending["posts"]
    stats = {"sightings": len(sightings), "errors": []}
    if stopped:
        stats["errors"].append(f"burner stopped: {stopped}"[:300])

    swept = sorted({s["handle"] for s in sightings} | set(access))
    access_rows = [{"handle": h, "access": a} for h, a in access.items()]

    # Enough chunks for whichever list is longer: there are always more cadence
    # rows than sightings, because photos and carousels have no plays to score.
    span = max(len(sightings), len(cadence))
    chunks = [sightings[i:i + IG_CHUNK] for i in range(0, span, IG_CHUNK)] or [[]]
    # Every chunk but the last only stores. A chunk that still fails is
    # recorded and skipped — its reels are picked up next run — but the final
    # call always goes, because it is the one that picks.
    result: dict = {}
    for index, chunk in enumerate(chunks):
        final = index == len(chunks) - 1
        body = {
            "run_id": run_id, "started_at": started,
            "sightings": chunk,
            "posts": cadence[index * IG_CHUNK:(index + 1) * IG_CHUNK],
            "snapshots": pending["snaps"] if index == 0 else [],
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

    if os.environ.get("IG_ROSTER") == "1" and not stopped:
        queued = cloud_post("/api/scout/hers", {})
        print(f"ig roster: queued {queued.get('queued', 0)} winners for download")


def main() -> None:
    if not CLOUD or not SECRET:
        raise SystemExit("CLOUD_URL and WORKER_SECRET are required")
    while True:
        try:
            pass_once()
        except WorkerStopped as stop:
            print(f"stopped: {stop}")
            # A wall is not a crash loop's problem — wait an hour and retry a
            # fresh session rather than hammering whatever asked for a human.
            time.sleep(3600)
            continue
        except Exception as error:
            print(f"pass failed: {error}")
            time.sleep(900)
            continue
        try:
            ig_pass()
        except WorkerStopped as stop:
            print(f"ig stopped: {stop}")
            time.sleep(1800)
            continue
        except Exception as error:
            print(f"ig pass failed: {error}")
        time.sleep(LOOP_SEC + random.uniform(0, 600))


if __name__ == "__main__":
    main()
