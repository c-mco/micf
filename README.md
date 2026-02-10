# MICF Insights

A fast, filterable show browser for the Melbourne International Comedy Festival. Scrapes the official MICF website, stores everything in SQLite, and serves a single-page data table UI where you can search, filter, sort, and explore every show in the festival.

## Why

The official MICF website is fine for browsing one show at a time, but terrible for answering questions like:

- "What's on this Saturday near me?"
- "Which shows still have tickets?"
- "Are there any wheelchair-accessible shows in the CBD with Tight Arse Tuesday?"

This tool puts all ~750 shows into a single sortable, filterable spreadsheet-like view with a calendar date picker, distance sorting, accessibility filters, and instant search.

## How it works

```
MICF API  ──scrape──>  SQLite DB  ──serve──>  Web UI
(shows, sessions,      (micf.db)              (localhost:8080)
 venues, geocoding)
```

One Go binary does everything:

1. **Scrape mode** (`-scrape`): Fetches the master show list from the MICF Search API, scrapes session data from each show's detail page, pulls venue metadata from the Venues API, and geocodes venue addresses via OpenStreetMap Nominatim. All stored in a local SQLite database with WAL mode for concurrent read/write.

2. **Server mode** (default): Serves a web UI on `:8080` with Alpine.js + Tailwind CSS. All show data is embedded in the initial page load as JSON, so filtering/sorting is instant client-side. Session details are lazy-loaded via API when you expand a row.

### Data sources

| Source | Method | Data |
|--------|--------|------|
| MICF Search API | POST `/umbraco/api/searchapi/searchShows` | Show list (title, artist, dates, images, status) |
| Show detail pages | HTML scrape + regex `window.sessionData` | Individual session times, availability, special types |
| MICF Venues API | GET `/umbraco/api/venuesapi/getvenues` | Venue details, capacity, accessibility |
| Nominatim OSM | GET geocoding | Venue lat/lng coordinates |

### Database

SQLite (`micf.db`) with three tables:
- **shows** (~750 rows) - title, artist, URL, dates, images, status
- **sessions** (~8,800 rows) - per-show date/time/availability/special types
- **venues** (~126 rows) - name, address, capacity, accessibility, coordinates

## Usage

### Prerequisites

- Go 1.21+ (uses `embed`, generics-era stdlib)
- CGO enabled (required by `go-sqlite3`)

### Build

```bash
go build -o micf .
```

### Scrape data

```bash
# Full sync with default 10 concurrent workers
./micf -scrape

# Faster with more workers
./micf -scrape -workers 20

# Force re-geocode all venues
./micf -scrape -force-geocode
```

The scraper is idempotent - it detects new/updated/unchanged/removed shows and only writes what changed. Typical run takes ~60 seconds.

### Run the web server

```bash
./micf
# http://localhost:8080
```

### Development (hot reload)

```bash
# Install air: go install github.com/air-verse/air@latest
air
```

## Web UI features

- **Instant search** across titles, artists, venues, suburbs
- **Calendar date picker** with multi-select - see show density per day, quick "this weekend" / "this week" actions
- **19 columns** (9 visible by default) with a column chooser - show info, venue, sessions, accessibility
- **Sortable + filterable** - text search, dropdowns for suburb/region, boolean yes/no for accessibility features
- **Row expansion** - click any show to see all sessions with dates, times, availability, special tags
- **Distance sorting** - enable browser location to sort by proximity, with Google Maps links
- **Resizable columns** - drag column borders, widths persist
- **Density toggle** - compact or comfortable row padding
- **Keyboard navigation** - arrow keys to navigate, Enter to expand, Escape to close
- **All state persisted** to localStorage (column choices, widths, selected dates, location, density)

## Deployment

### Current target: Home server

The intended deployment is a home server (Mac Mini or similar) that:

1. **Runs the scraper on a cron schedule** to keep data fresh
2. **Serves the web UI** on the local network (or exposed via tunnel)

#### Cron setup

```bash
# Scrape every 6 hours
0 */6 * * * cd /path/to/micf && ./micf -scrape >> /var/log/micf-scrape.log 2>&1
```

#### Systemd service (Linux) or launchd (macOS)

For the web server, run as a background service so it survives reboots.

### Edge deployment idea

The compiled frontend + SQLite database is small enough (~5MB total) to potentially distribute to edge nodes:

- The HTML template is self-contained (Alpine.js + Tailwind from CDN)
- The SQLite database is a single file, read-only at serving time
- A static binary + DB file could be deployed to edge workers (Fly.io, Cloudflare D1, Litestream replicas)
- The scraper runs centrally on the home server; the resulting `micf.db` gets pushed to edge

This would give sub-10ms response times globally for what is essentially a static dataset that updates every few hours.

**TODO**: Figure out the actual edge deployment pipeline. Options to explore:
- Litestream for SQLite replication
- Fly.io with LiteFS
- Cloudflare D1 (SQLite at the edge)
- Simple rsync of `micf.db` to edge nodes + binary restart

## Project structure

```
micf/
  main.go       - Web server, API endpoints, template rendering
  scraper.go    - MICF API scraping, session extraction, geocoding
  db.go         - SQLite schema, migrations, CRUD operations
  templates/
    index.html  - Full UI (Alpine.js + Tailwind CSS, ~900 lines)
  micf.db       - SQLite database (gitignored, created by scraper)
  air.toml      - Hot reload config for development
```

## License

Personal project. MICF data belongs to the Melbourne International Comedy Festival.
