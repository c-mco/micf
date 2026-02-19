#!/usr/bin/env python3
# micf_show.py — search for a show and get all session details
# Usage: python3 micf_show.py "gift horse"

import sys
import json
import urllib.request
import urllib.parse

BASE = "https://www.comedyfestival.com.au/umbraco/api"


def post(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def main():
    term = " ".join(sys.argv[1:])
    if not term:
        print("Usage: python3 micf_show.py \"show name\"")
        sys.exit(1)

    # ── 1. Search ────────────────────────────────────────────────────────────
    print(f"\n🔍 Searching for: \"{term}\"...")
    results = post(f"{BASE}/searchapi/searchShows", {"query": term})
    items = results.get("items", [])

    if not items:
        print(f"❌ No shows found for \"{term}\"")
        sys.exit(1)

    # Show a numbered list if multiple results
    if len(items) > 1:
        print(f"Found {len(items)} shows — picking the first. Others:")
        for i, s in enumerate(items[:5]):
            marker = "→" if i == 0 else " "
            print(f"  {marker} [{i}] {s['showName']} — {s['artistName']}")
        print()

    show      = items[0]
    show_name = show["showName"]
    artist    = show["artistName"]
    show_id   = show["id"]
    perf_ref  = show["red61ShowId"]
    dates     = show["dates"]

    print(f"✓ {show_name} — {artist} ({dates})")
    print(f"  showId={show_id}  performanceRef={perf_ref}")

    # ── 2. Get performances ──────────────────────────────────────────────────
    print(f"\n📅 Fetching performances...")
    perf_data    = get(f"{BASE}/showapi/getperformances?showId={show_id}")
    performances = perf_data.get("performances", [])

    if not performances:
        print("❌ No performances found")
        sys.exit(1)

    print(f"✓ {len(performances)} sessions found")
    print("\n" + "━" * 55)

    # ── 3. Get session details for each ─────────────────────────────────────
    for perf in performances:
        perf_id    = perf["id"]                  # "3936:105978"
        session_id = perf_id.split(":")[1]       # "105978"
        event_ref  = perf.get("eventid", perf_ref)
        dt         = perf.get("datetime", "?")
        venue_name = perf.get("venuename", "?")
        status     = perf.get("status", "?")

        print(f"\n📍 {dt}  —  {venue_name}  [{status}]")

        url = (f"{BASE}/showapi/getsessiondetails"
               f"?showId={show_id}&performanceRef={urllib.parse.quote(event_ref)}&sessionId={session_id}")

        try:
            d         = get(url)
            venue     = d.get("venue", {})
            avail     = d.get("availabilityPercentage", "?")
            avail_lvl = d.get("availabilityLevel", "")
            tickets   = d.get("ticketTypes", [])
            buy_urls  = d.get("ticketProviderUrls", [])

            print(f"   Venue:        {venue.get('name', '?')} — {venue.get('address', '')}")
            avail_str = f"{avail}%" + (f" ({avail_lvl})" if avail_lvl else "")
            print(f"   Availability: {avail_str}")
            if tickets:
                prices = [f"${t['price']:.2f} ({t['concession']['title']})" for t in tickets]
                print(f"   Prices:       {', '.join(prices)}")
            if buy_urls:
                print(f"   Buy:          {buy_urls[0]['url']}")
        except Exception as e:
            print(f"   ⚠ {e}")

    print("\n" + "━" * 55)
    print("Done!\n")


if __name__ == "__main__":
    main()
