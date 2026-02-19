#!/usr/bin/env python3
"""
micf_scrape_all.py — Scrape ALL MICF 2026 show data into a single JSON file.

Data sources:
  1. searchapi/searchShows   → all shows with rich metadata
  2. venuesapi/getvenues     → all venue details
  3. Show page HTML          → window.sessionData (real sessionIds) + duration
  4. showapi/getsessiondetails → pricing, availability, booking URLs per session

Usage:
  python3 micf_scrape_all.py                # scrape everything
  python3 micf_scrape_all.py --limit 10     # scrape first 10 shows (for testing)
  python3 micf_scrape_all.py --resume       # resume from last checkpoint
"""
import sys
import os
import json
import re
import time
import urllib.request
import urllib.parse
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://www.comedyfestival.com.au/umbraco/api"
SITE = "https://www.comedyfestival.com.au"
OUTPUT = "micf_2026_full.json"
CHECKPOINT = ".micf_checkpoint.json"

# ── HTTP helpers ─────────────────────────────────────────────────────────────

def post_json(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def get_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")

# ── Step 1: Get all shows ───────────────────────────────────────────────────

def fetch_all_shows():
    """Get all shows via searchShows (rich metadata)."""
    print("📋 Fetching all shows via searchapi/searchShows...")
    result = post_json(f"{BASE}/searchapi/searchShows", {
        "query": "",
        "pageSize": 1000,
        "page": 1,
    })
    items = result.get("items", [])
    print(f"   ✓ {len(items)} shows found")
    return items

# ── Step 2: Get all venues ──────────────────────────────────────────────────

def fetch_all_venues():
    """Get all venue details."""
    print("🏛  Fetching all venues via venuesapi/getvenues...")
    result = get_json(f"{BASE}/venuesapi/getvenues")
    venues = result.get("venues", [])
    print(f"   ✓ {len(venues)} venues found")
    return {v["id"]: v for v in venues}

# ── Step 3: Scrape show page for sessionData + duration ─────────────────────

def scrape_show_page(show_url):
    """Scrape a show page for window.sessionData and window.sessionDuration."""
    full_url = SITE + show_url
    html = get_html(full_url)

    sessions = []
    match = re.search(r'window\.sessionData\s*=\s*(\[.*?\]);', html, re.DOTALL)
    if match:
        try:
            sessions = json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    duration = None
    match = re.search(r"window\.sessionDuration\s*=\s*['\"](\d+)['\"]", html)
    if match:
        duration = int(match.group(1))

    return sessions, duration

# ── Step 4: Get session details (pricing/availability) ──────────────────────

def fetch_session_details(show_id, session_id, performance_ref=None):
    """Get pricing, availability, venue details for one session."""
    params = f"showId={show_id}&sessionId={session_id}"
    if performance_ref:
        params += f"&performanceRef={urllib.parse.quote(performance_ref)}"
    url = f"{BASE}/showapi/getsessiondetails?{params}"
    return get_json(url)

# ── Scrape one show ─────────────────────────────────────────────────────────

def scrape_one_show(show, idx, total):
    """Scrape all data for a single show. Returns enriched show dict."""
    show_id = show["id"]
    name = show["showName"]
    url = show.get("url", "")

    result = {
        "id": show_id,
        "showName": name,
        "artistName": show.get("artistName", ""),
        "dates": show.get("dates", ""),
        "showCount": show.get("showCount", ""),
        "venues": show.get("venues", []),
        "url": url,
        "imageUrl": show.get("imageUrl", ""),
        "guideImageUrl": show.get("guideImageUrl", ""),
        "videoEmbedUrl": show.get("videoEmbedUrl"),
        "red61ShowId": show.get("red61ShowId", ""),
        "availabilityLevel": show.get("availabilityLevel", ""),
        "onlineShow": show.get("onlineShow", False),
        "onDemandShow": show.get("onDemandShow", False),
        "duration": None,
        "sessions": [],
    }

    # Scrape show page for sessionData + duration
    if url:
        try:
            sessions, duration = scrape_show_page(url)
            result["duration"] = duration
        except Exception as e:
            print(f"   ⚠ [{idx+1}/{total}] {name}: page scrape failed: {e}")
            sessions = []
    else:
        sessions = []

    # Get session details for each session
    for sess in sessions:
        session_id = sess.get("sessionId")
        perf_ref = sess.get("performanceRef")
        if not session_id:
            continue

        session_data = {
            "sessionId": session_id,
            "performanceRef": perf_ref,
            "date": sess.get("date"),
            "time": sess.get("time"),
            "fullDate": sess.get("fullDate"),
            "status": sess.get("status"),
            "showType": sess.get("showType"),
            "preview": sess.get("preview", False),
            "tightArse": sess.get("tightArse", False),
            "laughPack": sess.get("laughPack", False),
            "extraShow": sess.get("extraShow", False),
            "soldout": sess.get("soldout", False),
            "cancelled": sess.get("cancelled", False),
            "isFilmed": sess.get("isFilmed", False),
            "isRelaxed": sess.get("isRelaxed", False),
            "hasSignInterpreter": sess.get("hasSignInterpreter", False),
            # Details filled from API:
            "details": None,
        }

        try:
            details = fetch_session_details(show_id, session_id, perf_ref)
            session_data["details"] = details
        except Exception as e:
            err_msg = str(e)
            if hasattr(e, "read"):
                try:
                    err_msg = e.read().decode()[:200]
                except:
                    pass
            session_data["details"] = {"error": err_msg}

        result["sessions"].append(session_data)

    status = "✓" if result["sessions"] else "○"
    print(f"   {status} [{idx+1}/{total}] {name} — {len(result['sessions'])} sessions")
    return result

# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape all MICF 2026 data")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of shows (0=all)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--workers", type=int, default=5, help="Concurrent workers (default 5)")
    parser.add_argument("--output", type=str, default=OUTPUT, help="Output file")
    args = parser.parse_args()

    # Step 1: Shows
    all_shows = fetch_all_shows()

    # Step 2: Venues
    venues_by_id = fetch_all_venues()

    # Load checkpoint if resuming
    done_ids = set()
    completed_shows = []
    if args.resume and os.path.exists(CHECKPOINT):
        with open(CHECKPOINT) as f:
            checkpoint = json.load(f)
        completed_shows = checkpoint.get("shows", [])
        done_ids = {s["id"] for s in completed_shows}
        print(f"📂 Resuming: {len(done_ids)} shows already scraped")

    # Filter shows
    shows_to_scrape = [s for s in all_shows if s["id"] not in done_ids]
    if args.limit:
        shows_to_scrape = shows_to_scrape[:args.limit]

    total = len(shows_to_scrape)
    print(f"\n🚀 Scraping {total} shows (workers={args.workers})...\n")

    # Step 3+4: Scrape each show
    t0 = time.time()
    newly_scraped = []

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(scrape_one_show, show, i, total): show
            for i, show in enumerate(shows_to_scrape)
        }
        for future in as_completed(futures):
            try:
                result = future.result()
                newly_scraped.append(result)
            except Exception as e:
                show = futures[future]
                print(f"   ✗ {show['showName']}: {e}")
                newly_scraped.append({
                    "id": show["id"],
                    "showName": show["showName"],
                    "error": str(e),
                    "sessions": [],
                })

            # Checkpoint every 50 shows
            if len(newly_scraped) % 50 == 0:
                _save_checkpoint(completed_shows + newly_scraped)

    elapsed = time.time() - t0
    all_scraped = completed_shows + newly_scraped

    # Sort by show ID for consistency
    all_scraped.sort(key=lambda s: s.get("id", 0))

    # Build final output
    output = {
        "meta": {
            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "total_shows": len(all_scraped),
            "total_sessions": sum(len(s.get("sessions", [])) for s in all_scraped),
            "total_venues": len(venues_by_id),
            "scrape_duration_seconds": round(elapsed, 1),
        },
        "venues": venues_by_id,
        "shows": all_scraped,
    }

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"✅ Done! {len(all_scraped)} shows, "
          f"{output['meta']['total_sessions']} sessions scraped in {elapsed:.0f}s")
    print(f"📄 Output: {args.output}")
    print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # Clean up checkpoint
    if os.path.exists(CHECKPOINT):
        os.remove(CHECKPOINT)

def _save_checkpoint(shows):
    with open(CHECKPOINT, "w") as f:
        json.dump({"shows": shows}, f)

if __name__ == "__main__":
    main()
