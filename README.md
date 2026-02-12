# MICF Insights

A fast, filterable show browser for the Melbourne International Comedy Festival. Scrapes the official MICF website, stores everything in SQLite, and serves a single-page data table UI where you can search, filter, sort, and explore every show in the festival.

## Why

The official MICF website is fine for browsing one show at a time, but terrible for answering questions like:

- "What's on this Saturday near me?"
- "Which shows still have tickets?"
- "Are there any wheelchair-accessible shows in the CBD with Tight Arse Tuesday?"

This tool puts all ~750 shows into a single sortable, filterable view with a calendar date picker, distance sorting, accessibility filters, and instant search.

## How it works

```
MICF API  ──scrape──>  SQLite DB  ──serve──>  Web UI
(shows, sessions,      (micf.db)              (localhost:8080)
 venues, geocoding)
```

One Go binary does everything:

1. **Scrape mode** (`-scrape`): Fetches shows from the MICF API, scrapes session data from each show page, pulls venue metadata, and geocodes addresses via OpenStreetMap. All stored in SQLite with WAL mode.

2. **Server mode** (default): Serves a web UI on `:8080`. All show data is embedded in the initial page load as JSON, so filtering and sorting are instant. Session details load on demand when you expand a row.

### Data sources

| Source | Method | Data |
|--------|--------|------|
| MICF Search API | POST `/umbraco/api/searchapi/searchShows` | Show list |
| Show detail pages | HTML scrape + regex `window.sessionData` | Session times and availability |
| MICF Venues API | GET `/umbraco/api/venuesapi/getvenues` | Venue details and accessibility |
| Nominatim OSM | GET geocoding | Venue coordinates |

### Database

SQLite (`micf.db`) with three tables:
- **shows** (~750 rows)
- **sessions** (~8,800 rows)
- **venues** (~126 rows)

## Architecture

```
micf/
  main.go         Server, API handlers, template rendering, export endpoints
  scraper.go      MICF API scraping, session extraction, venue geocoding
  db.go           SQLite schema, migrations, CRUD operations
  templates/
    index.html    HTML template (data injected by server)
  static/
    app.css       All styles (no framework)
    app.js        All client logic (vanilla JavaScript)
```

### Performance design

- **Zero external dependencies at runtime**: CSS and JS are embedded in the binary. No CDN requests.
- **Single HTTP request** for the initial page load (CSS/JS served from embedded filesystem).
- **All filtering and sorting happens client-side** on precomputed data — instant response.
- **Gzip compression** and in-memory caching on the server side.
- **Lazy-loaded sessions**: detail data fetched only when a row is expanded, then cached.

### Frontend

Vanilla JavaScript with no framework. The entire UI is driven by simple DOM manipulation and event delegation. The code is organized into clear sections: column definitions, state management, rendering, filtering, sorting, event handling.

## Usage

### Prerequisites

- Go 1.21+ (uses `embed`)
- CGO enabled (required by `go-sqlite3`)

### Build

```bash
go build -o micf .
```

### Scrape data

```bash
./micf -scrape                # Full sync, 10 workers
./micf -scrape -workers 20    # Faster
./micf -scrape -force-geocode # Re-geocode all venues
```

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

## Features

- **Instant search** across titles, artists, venues, suburbs
- **Calendar date picker** with multi-select and show density per day
- **19 columns** (9 visible by default) with column chooser
- **Sortable + filterable** — text, dropdowns, boolean yes/no
- **Row expansion** — click any show to see all sessions
- **Distance sorting** — enable browser location, sort by proximity
- **Resizable columns** — drag borders, widths persist
- **Density toggle** — compact or comfortable
- **Keyboard navigation** — `/` to search, arrows to navigate, Enter to expand
- **Export** — JSON, CSV, Excel, SQLite database
- **All preferences persist** in localStorage

## Deployment

Run on a home server:

1. Cron: `0 */6 * * * ./micf -scrape` to keep data fresh
2. Service: `./micf` as a background process on `:8080`

Only two files needed: the binary and `micf.db`.

## License

Personal project. MICF data belongs to the Melbourne International Comedy Festival.
