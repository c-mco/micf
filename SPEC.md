# MICF Insights — Full Specification

A single-binary Go web application that scrapes the Melbourne International Comedy Festival website, stores all show/session/venue data in SQLite, and serves a spreadsheet-like single-page UI for searching, filtering, sorting, and exploring every show in the festival.

---

## 1. System Overview

```
┌─────────────────────────┐
│   MICF Website / APIs   │
│  (shows, sessions,      │
│   venues, geocoding)    │
└───────────┬─────────────┘
            │  scraper (HTTP + HTML parse)
            ▼
┌─────────────────────────┐     ┌────────────────────┐
│   SQLite DB (micf.db)   │◄───►│  Nominatim OSM     │
│   WAL mode, 3 tables    │     │  (geocoding)       │
└───────────┬─────────────┘     └────────────────────┘
            │  net/http server
            ▼
┌──────────────────────────────────────────────────────┐
│  Web UI — Single HTML page                           │
│  Vanilla JS + Custom CSS (embedded in binary)        │
│  All filtering/sorting is client-side                │
│  Session details lazy-loaded via /api/sessions       │
└──────────────────────────────────────────────────────┘
```

The binary has two modes:
- **Scrape mode** (`./micf -scrape`): fetches all data, writes to SQLite, exits.
- **Server mode** (`./micf`): starts HTTP server on `:8080`, serves the UI.

---

## 2. CLI Interface

```
./micf [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-scrape` | bool | `false` | Run the scraper instead of the web server |
| `-workers` | int | `10` | Number of concurrent scrape workers |
| `-force-geocode` | bool | `false` | Re-geocode all venues (normally skips already-geocoded) |

No flag = start the web server.

---

## 3. Data Sources

### 3.1 MICF Show Search API

- **URL:** `POST https://www.comedyfestival.com.au/umbraco/api/searchapi/searchShows`
- **Content-Type:** `application/json`
- **Body:** `{"pageSize":1000,"timeView":false}`
- **Response:** JSON object with `items` array of Show objects

Each show item contains:
```json
{
  "id": 1234,
  "showName": "Show Title",
  "artistName": "Artist Name",
  "url": "/season/2026/show-slug",
  "venues": ["Venue Name"],
  "dates": "20 Mar – 18 Apr",
  "showCount": "25",
  "imageUrl": "https://...",
  "smallImageUrl": "https://...",
  "onlineShow": false,
  "onDemandShow": false,
  "status": "OnSale"
}
```

### 3.2 Show Detail Pages (Session Extraction)

- **URL:** `GET https://www.comedyfestival.com.au{show.url}`
- **Method:** Scrape HTML for embedded JavaScript variable
- **Regex:** `window\.sessionData\s*=\s*(\[.*?\]);` (dotall mode)
- **Result:** JSON array of Session objects

Each session:
```json
{
  "date": "2026-03-20",
  "time": "7:00 PM",
  "fullDate": "2026-03-20T19:00:00",
  "tightArse": false,
  "soldout": false,
  "cancelled": false,
  "sessionId": 5678,
  "status": "OnSale",
  "preview": false,
  "laughPack": false,
  "extraShow": false,
  "hasSignInterpreter": false,
  "showType": "Standard",
  "isFilmed": false,
  "isRelaxed": false
}
```

### 3.3 MICF Venues API

- **URL:** `GET https://www.comedyfestival.com.au/umbraco/api/venuesapi/getvenues`
- **Response:** JSON object with `venues` array

Each venue:
```json
{
  "id": 42,
  "name": "Melbourne Town Hall",
  "address": "90-120 Swanston St",
  "suburb": "Melbourne",
  "location": "CBD",
  "capacity": 500,
  "wheelchairAccess": true,
  "disabledToilets": true,
  "website": "https://...",
  "latitude": 0,
  "longitude": 0,
  "phoneNumber": "03 1234 5678",
  "accessibilityDetails": "<p>HTML description</p>",
  "adultsOnly": false,
  "assistedHearing": true,
  "boxOffice": true,
  "bookingPhoneNumber": ""
}
```

Note: The API returns `latitude`/`longitude` as 0 — coordinates come from geocoding.

### 3.4 Nominatim OpenStreetMap Geocoding

- **URL:** `GET https://nominatim.openstreetmap.org/search?format=json&limit=1&q={encoded_query}`
- **User-Agent:** `MICF-Insights/1.0` (required by Nominatim TOS)
- **Rate limit:** 1 request/second (enforced via `time.Sleep`)
- **Query construction:** `{address}, {suburb}, Victoria, Australia`
- **Response:** Array of `{ "lat": "string", "lon": "string" }`
- **Caching:** Only geocodes venues that don't already have coordinates (unless `-force-geocode`)

Also used client-side for reverse geocoding user location to suburb name.

---

## 4. Database Schema

SQLite database file: `micf.db`, WAL mode enabled for concurrent read/write.

### 4.1 `shows` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Primary key (from MICF API) |
| `title` | TEXT | Show name |
| `artist` | TEXT | Artist/performer name |
| `url` | TEXT | URL path (relative to comedyfestival.com.au) |
| `venue_summary` | TEXT | Comma-joined venue names from API |
| `venue_id` | INTEGER | FK to venues.id (resolved during scrape) |
| `dates` | TEXT | Human-readable date range string |
| `show_count` | TEXT | Number of sessions as string |
| `image_url` | TEXT | Full-size image URL |
| `small_image_url` | TEXT | Thumbnail image URL |
| `online_show` | BOOLEAN | |
| `on_demand_show` | BOOLEAN | |
| `status` | TEXT | e.g. "OnSale", "SoldOut" |

### 4.2 `sessions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Autoincrement PK |
| `show_id` | INTEGER | FK to shows.id |
| `session_id` | INTEGER | Session ID from MICF |
| `date` | TEXT | ISO date (YYYY-MM-DD) |
| `time` | TEXT | Display time string |
| `full_date` | TEXT | Full ISO datetime |
| `is_tight_arse` | BOOLEAN | Discounted "Tight Arse Tuesday" |
| `is_sold_out` | BOOLEAN | |
| `cancelled` | BOOLEAN | |
| `status` | TEXT | |
| `preview` | BOOLEAN | Preview performance |
| `laugh_pack` | BOOLEAN | |
| `extra_show` | BOOLEAN | Added show |
| `has_sign_interpreter` | BOOLEAN | Auslan interpreter |
| `show_type` | TEXT | |
| `is_filmed` | BOOLEAN | Being recorded |
| `is_relaxed` | BOOLEAN | Relaxed/sensory-friendly |

### 4.3 `venues` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | Primary key (from MICF API) |
| `name` | TEXT | |
| `address` | TEXT | |
| `suburb` | TEXT | |
| `location` | TEXT | Region name (e.g. "CBD", "Southbank") |
| `capacity` | INTEGER | |
| `wheelchair_access` | BOOLEAN | |
| `disabled_toilets` | BOOLEAN | |
| `website` | TEXT | |
| `latitude` | REAL | From geocoding |
| `longitude` | REAL | From geocoding |
| `phone_number` | TEXT | |
| `accessibility_details` | TEXT | HTML content |
| `adults_only` | BOOLEAN | |
| `assisted_hearing` | BOOLEAN | |
| `box_office` | BOOLEAN | |
| `booking_phone_number` | TEXT | |

### 4.4 Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_sessions_date_showid` | `sessions(date, show_id)` | Date queries |
| `idx_shows_venue_id` | `shows(venue_id)` | Venue join |
| `idx_sessions_show_id` | `sessions(show_id)` | Session lookups |

### 4.5 Schema Management

All schema changes use idempotent migrations — `CREATE TABLE IF NOT EXISTS` for initial tables, `ALTER TABLE ADD COLUMN` for additions (errors silently ignored if column exists). No migration framework; migrations are Go code in `InitDB()`.

### 4.6 Venue ID Resolution

Shows link to venues via `venue_id` (integer FK). Resolution uses a 3-tier matching strategy on the `venue_summary` text:

1. **Exact match** — full `venue_summary` string matches a venue name
2. **First entry** — take text before first comma (for multi-venue shows like `"Venue A, Venue B"`)
3. **Strip room** — remove ` - RoomName` suffix (e.g. `"Town Hall - Main Room"` → `"Town Hall"`)
4. Returns 0 if no match

`BackfillVenueIDs()` runs on startup to resolve any shows that have `venue_summary` but no `venue_id`.

---

## 5. Scraper Behavior

### 5.1 Orchestration Flow

```
ScrapeAll(numWorkers, forceGeocode):
  1. Start venue fetch + geocoding in background goroutine
  2. Fetch master show list from Search API
  3. Wait for venue goroutine to complete
  4. Build venue name→id lookup map
  5. Snapshot existing show data for change detection
  6. Fan out show scraping across N worker goroutines
  7. Each worker:
     a. Fetch show detail page
     b. Extract sessionData via regex
     c. Parse sessions JSON
     d. Set VenueSummary = join(show.Venues, ", ")
     e. Set VenueID = ResolveVenueID(VenueSummary, lookup)
     f. SaveShow (INSERT OR REPLACE show + DELETE/INSERT sessions)
     g. Track new/updated/unchanged via snapshot comparison
     h. Sleep 100-300ms between requests (random jitter)
  8. Detect and remove stale shows (in API snapshot but not in scrape)
  9. Invalidate response cache
  10. Print statistics
```

### 5.2 Change Detection

Before scraping, a snapshot of all existing shows is taken: `{id → {Title, Artist, URL, VenueSummary, SessionCount}}`. After scraping each show, it's compared to the snapshot:
- **New:** ID not in snapshot
- **Updated:** Any field differs or session count changed
- **Unchanged:** All fields match
- **Removed:** IDs in snapshot that weren't scraped (deleted from DB)

### 5.3 Venue Geocoding

- Runs concurrently with show list fetch (but must complete before show workers start)
- For each venue from the Venues API:
  - If already geocoded (lat/lng != 0) and not force-geocode: preserve existing coords, update other fields
  - Otherwise: geocode via Nominatim, save coordinates
  - 1-second delay between geocode requests (Nominatim rate limit)

### 5.4 Show Save Transaction

Each show save is atomic (single transaction):
1. `INSERT OR REPLACE INTO shows` (upsert by primary key)
2. `DELETE FROM sessions WHERE show_id = ?` (clear old sessions)
3. `INSERT INTO sessions` for each new session
4. Commit

### 5.5 HTTP Client

Shared `http.Client` with connection pooling:
- Timeout: 15 seconds
- MaxIdleConns: 100
- MaxIdleConnsPerHost: 20
- IdleConnTimeout: 90 seconds

### 5.6 Output Statistics

```
Scrape completed in Xs
Shows: N total — N new, N updated, N unchanged, N removed, N failed
Venues: N synced — N geocoded, N skipped, N failed
```

---

## 6. Web Server

### 6.1 Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Main page — renders template with all show data embedded as JSON |
| `/static/*` | GET | Embedded CSS and JS assets |
| `/api/sessions` | GET | Session details for a specific show |
| `/api/dates` | GET | Date → show count mapping for calendar |
| `/export/json` | GET | Download all data as JSON |
| `/export/csv` | GET | Download all data as ZIP of 3 CSVs |
| `/export/excel` | GET | Download all data as XLSX with 3 sheets |
| `/export/db` | GET | Download a clean copy of the SQLite database |

### 6.2 `GET /` — Main Page

**Query parameters:**
- `search` (optional) — pre-fills search field, filters SQL results
- `limit` (optional, default `1000`) — max rows returned

**SQL query:** Joins `shows`, `sessions`, and `venues` (via `venue_id`), groups by show, aggregates session stats.

**Template data injected:**
- `Shows` — JSON array of ShowView objects (embedded as `template.JS`)
- `Search` — current search string
- `Suburbs` — JSON array of unique suburb names
- `Regions` — JSON array of unique region names
- `TotalShows` — total count from DB

**ShowView fields (typed struct):**
```go
type ShowView struct {
    ID, Title, Artist, URL, Venue, VenueName, Suburb, Region,
    Count, Dates, Wheelchair, Capacity, Lat, Lng,
    ImageURL, SmallImageURL, OnlineShow, OnDemandShow, Status,
    AssistedHearing, AdultsOnly, VenueWebsite, AccessibilityDetails,
    HasSignInterpreter, HasRelaxed, HasTightArse, SoldOutCount,
    DisabledToilets, SessionDates
}
```

**Response caching:**
- Default (no search) requests are cached in memory (raw + gzip)
- Gzipped response served when `Accept-Encoding: gzip` present
- Cache invalidated by `InvalidatePageCache()` after scrape
- `Cache-Control: public, max-age=300` (5 minutes browser cache)

### 6.3 `GET /static/*` — Embedded Assets

CSS (`app.css`) and JavaScript (`app.js`) are embedded in the binary via `//go:embed static/*` and served through Go's `http.FileServer`. No external CDN dependencies.

### 6.4 `GET /api/sessions?show_id={id}`

Returns JSON array of SessionView objects. `Cache-Control: public, max-age=3600` (1 hour).

### 6.5 `GET /api/dates`

Returns JSON array of `{ "date": "YYYY-MM-DD", "showCount": N }` ordered by date. Cached in memory. `Cache-Control: public, max-age=3600`.

### 6.6 Export Endpoints

#### `GET /export/json`
- `{ "shows": [...], "sessions": [...], "venues": [...] }`

#### `GET /export/csv`
- ZIP with `shows.csv`, `sessions.csv`, `venues.csv`

#### `GET /export/excel`
- XLSX with 3 sheets: Shows, Sessions, Venues (bold headers)

#### `GET /export/db`
- Clean SQLite copy via `VACUUM INTO`

### 6.7 Response Caching

Two in-memory caches, both protected by `sync.RWMutex`:
1. **Page cache** (`pageCacheRaw` + `pageCacheGzip`): rendered HTML for the default index page
2. **Dates cache** (`datesCacheRaw`): `/api/dates` JSON response

Both invalidated by `InvalidatePageCache()`.

### 6.8 Asset Embedding

All files are embedded into the binary:
- `//go:embed templates/*` — HTML template
- `//go:embed static/*` — CSS and JS

No external file dependencies at runtime.

---

## 7. Frontend UI

### 7.1 Technology

- **Vanilla JavaScript** — no framework, DOM manipulation + event delegation
- **Custom CSS** — hand-written stylesheet, CSS custom properties for theming
- **No build step** — separate `.css` and `.js` files, embedded in binary
- **Zero CDN dependencies** — everything served from the Go binary
- Show data embedded in the page as a JSON literal (server-rendered)

### 7.2 File Structure

```
static/
  app.css    All styles (~300 lines)
  app.js     All client logic (~600 lines)
templates/
  index.html HTML structure + data injection (~100 lines)
```

### 7.3 Layout

Three-section layout filling the viewport:

```
┌─────────────────────────────────────────────────────┐
│ HEADER: Logo | Search | Location | Calendar |       │
│         Columns | Export | Density                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ MAIN: Scrollable data table                         │
│   - Header row (sortable)                           │
│   - Filter row (per-column)                         │
│   - Data rows (expandable)                          │
│                                                     │
├─────────────────────────────────────────────────────┤
│ FOOTER: "Showing X of Y shows" | Filter pills | /  │
└─────────────────────────────────────────────────────┘
```

### 7.4 Column Definitions

19 columns total, 9 visible by default, organized into 4 groups:

**Show Info:** Title (locked), Artist, Dates, 18+, Online, Status
**Venue:** Venue, Suburb, Region, Distance, Capacity
**Sessions:** Sessions, Tight Arse, Sold Out
**Accessibility:** Wheelchair, Hearing Loop, Auslan, Relaxed, Accessible WC

### 7.5 Filter Types

- **text** — free-text substring match (case-insensitive)
- **select** — dropdown of all unique values
- **bool** — dropdown: All / Yes / No
- **none** — no filter input (sortable only)

### 7.6 Global Search

- Debounced at 150ms
- Searches: Title, Artist, VenueName, Suburb, Region
- Uses precomputed `_haystack` field (concatenated + lowercased once)
- Press `/` to focus, Escape to clear

### 7.7 Sorting

- Click column header: ascending, click again: descending
- Indicators: `⇕` (neutral), `▲` (asc), `▼` (desc)
- String sort: case-insensitive. Boolean sort: false < true. Distance: haversine km.

### 7.8 Date Filtering (Calendar)

Calendar dropdown built from `/api/dates`:
- All months with festival shows
- Day cells show count, color-coded density (green tints at 33%/66% quartiles)
- Today highlighted with amber ring
- Multi-select, quick actions ("This weekend", "This week")
- Persisted to localStorage

### 7.9 Row Expansion

Click row to expand inline detail panel:
- Thumbnail, title, artist, venue
- Links: MICF Page, Google Maps
- Session table: Date, Time, Status, Type, Tags
- Sessions lazy-loaded on first expand, cached client-side

### 7.10 Column Resizing

Drag right edge of header. `table-layout: fixed` with `<colgroup>`. Widths persist in localStorage.

### 7.11 Column Chooser

Dropdown with grouped checkboxes. Title locked. Reset to defaults.

### 7.12 Density Toggle

Compact (12px, 2px padding) or Comfortable (13px, 6px padding). Persisted.

### 7.13 Location / Distance

Browser geolocation → haversine distance → sort by proximity. Reverse geocode suburb via Nominatim. Units: km or mi.

### 7.14 Keyboard Navigation

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Escape` | Clear search, close dropdowns |
| `↑`/`↓` | Navigate rows |
| `Enter` | Toggle expand on active row |

### 7.15 Rendering Architecture

```
renderAll()  → renderColgroup + renderHeader + renderFilters + renderBody + renderFooter
renderBody() → regenerate tbody innerHTML + footer (called on filter/sort/search changes)
```

- Table body rendered as HTML strings via template concatenation (fast)
- Event delegation on thead and tbody (no per-row listeners)
- Sort indicator updates via DOM manipulation (no header re-render)
- Calendar selection updates via class toggling (no full calendar re-render)

### 7.16 Performance Optimizations

- **Zero CDN requests**: All assets embedded in binary
- **Single-pass filtering**: Precomputed `_haystack` and `_dates` arrays
- **Active filter pre-collection**: Only iterate non-empty filters
- **Event delegation**: Single listener per container, not per row/cell
- **Minimal DOM updates**: innerHTML for bulk updates, class toggling for small changes
- **Debounced search**: 150ms delay prevents excessive re-renders
- **Session caching**: Fetched once per show, never re-fetched

---

## 8. localStorage Keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `micf_columns` | JSON object | (from column defs) | Column visibility |
| `micf_col_widths` | JSON object | (from column defs) | Column widths |
| `micf_density` | string | `"compact"` | Density mode |
| `micf_selected_dates` | JSON array | `[]` | Calendar selections |
| `micf_user_lat` | float string | `""` | User latitude |
| `micf_user_lng` | float string | `""` | User longitude |
| `micf_user_suburb` | string | `""` | Reverse-geocoded suburb |
| `micf_use_imperial` | string | `"false"` | Distance units |

---

## 9. Dependencies

### Go Modules

| Module | Version | Purpose |
|--------|---------|---------|
| `github.com/mattn/go-sqlite3` | v1.14.33 | SQLite driver (requires CGO) |
| `github.com/xuri/excelize/v2` | v2.10.0 | Excel file generation |

### Frontend

None. Vanilla JavaScript and hand-written CSS, all embedded in the binary.

---

## 10. Deployment

### Intended Target

Home server (Mac Mini or similar) running:
1. Cron job: `0 */6 * * * ./micf -scrape`
2. Background service: `./micf` on `:8080`

### Files Required

- `micf` binary (~19MB, all assets embedded)
- `micf.db` SQLite database (~1MB, created by scraper)

### Development

Hot reload via Air: `air` (watches `*.go`, `*.html`, `*.css`, `*.js`)

---

## 11. Data Volumes

| Entity | Count |
|--------|-------|
| Shows | ~750 |
| Sessions | ~8,800 |
| Venues | ~126 |
| Database size | ~1 MB |
| Rendered HTML (gzipped) | ~40 KB |
| CSS | ~14 KB |
| JS | ~38 KB |
