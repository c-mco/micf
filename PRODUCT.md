# MICF Insights — Product Definition

February 2026

---

## 1. Project Description

MICF Insights is a personal tool for navigating the Melbourne International Comedy Festival. It is a Go application that scrapes the festival's public website into a local SQLite database, then serves a fast, spreadsheet-style web interface for browsing, filtering, and planning attendance.

The festival runs annually for approximately four weeks and typically lists several hundred shows across dozens of venues scattered across inner Melbourne. The official festival website is built for marketing: it is visually rich, loads slowly, and offers limited ability to compare shows side by side, filter by multiple criteria simultaneously, check real-time availability, or build a personal schedule. Its search and filter tools are elementary — you can browse by genre or date, but not ask a question like "show me all sub-$30 shows in Fitzroy on Saturday that still have seats."

MICF Insights solves this. It is not a replacement for the festival website; it is an analysis layer on top of it. The tool is designed for a single user (or a small household) who wants to survey the entire festival, identify candidates worth attending, and construct a day-by-day schedule without double-booking themselves or failing to account for travel time between venues.

The primary audience is a seasoned festival-goer who attends many shows — the kind of person who makes a spreadsheet during MICF season anyway. This tool makes that spreadsheet automatic, live, and interactive.

---

## 2. Design Philosophy

### The Spreadsheet Metaphor

MICF has upwards of 500 shows in a typical year. The cognitive task of choosing from that catalogue is inherently one of comparison and elimination — the same task that spreadsheets solve well. A table lets the user see many shows simultaneously, sort by any attribute, and apply filters without losing context. A card-based gallery interface, like the official website, forces the user to context-switch repeatedly between an overview mode and a detail mode.

The spreadsheet metaphor also guides the interaction model: columns are resizable, sortable, and can be shown or hidden. Filters appear in a dedicated row beneath the column headers, directly under the data they affect. Active filters are surfaced as dismissible pills in the footer rather than hidden in a sidebar. This is how people who work in spreadsheets all day expect filtering to behave.

### Go Single Binary

The tool is a single compiled Go binary. This serves several practical goals:

- **Zero deployment friction.** A single `go build` produces a binary that includes the SQLite driver (via CGo), the web server, the scraper, all HTML templates, and all JavaScript and CSS assets (embedded via `//go:embed`). There is nothing to install, no runtime to manage, no configuration file to write.
- **Fast cold start.** Static assets are pre-gzipped into memory at startup; the page is rendered from an in-memory cache on subsequent requests. This is a localhost tool, so the HTML page including all show data is inlined into the initial response — no separate API calls on first load.
- **Portability.** The binary can be dropped on any machine with internet access. The database path is configurable with a single flag.

The two-mode design — `-scrape` to fetch data, then start the server — is intentional. Scraping and serving are independent concerns. Scrapes can be scheduled (e.g. daily via cron) without affecting the running server.

### Local-First, Offline-Capable

All scraped data is stored in a local SQLite database. Once the scrape is complete, the web UI works without any internet access. The UI itself is served from embedded assets; the show data is inlined into the initial HTML payload.

A service worker (`sw.js`) caches the application shell and static assets under a versioned cache key derived from the git commit hash. This means the app loads instantly after the first visit and is usable even if the local server is temporarily unreachable.

This is a deliberate trade-off: data freshness requires re-running `-scrape`, but everything else — browsing, filtering, planning — is instantaneous and reliable.

### Performance as a Feature

The entire show dataset (hundreds of rows) is loaded into the browser on initial page load. Filtering and sorting run in a dedicated Web Worker, so the main thread never blocks during filter computation. The table itself uses virtual scrolling: only the rows currently visible (plus a small buffer above and below) are rendered into the DOM. Combined, these techniques make filtering feel immediate even on modest hardware.

Static assets are served with `Cache-Control: immutable` (one-year max-age), because the cache key is the git commit hash embedded in the URL. New builds invalidate all assets atomically.

---

## 3. Feature Inventory

### 3.1 Scraper

**Full show list ingestion** — The scraper posts to the MICF search API requesting up to 1,000 shows in a single call. This captures the canonical list of all shows for the current festival.

_User pain it solves:_ The festival website paginates its listing. Getting the full picture requires navigating many pages. This collapses that into a single, complete snapshot.

**Per-show detail page scraping** — For each show, the scraper fetches its individual HTML page to extract: show description, running time (`window.sessionDuration`), content tags, price range text, and the session data array (`window.sessionData`). The session data is an inline JavaScript array that contains each individual performance with its date, time, flags, and a `performanceRef` needed for the pricing API.

_User pain it solves:_ The search API alone does not return session-level data, descriptions, or duration. To plan a day, you need to know when a show runs and how long it takes.

**Per-session pricing and availability enrichment** — For every session that has a `sessionId` and `performanceRef`, the scraper calls a dedicated session-details API endpoint. This returns: exact ticket prices broken down by tier, an availability percentage (0–100), an availability level label, and the specific venue (which may differ from the show-level venue for multi-room buildings).

_User pain it solves:_ The festival website shows availability status on the booking page, but does not expose it in any browsable format. This allows the user to see, at a glance, which shows are selling out and which have plenty of capacity — before committing to a booking decision.

**Concurrent scraping with retry** — The scraper runs N concurrent workers (default 10, tunable to 20 without rate-limiting issues). Failed shows are automatically retried twice with a 5-second delay, in parallel with the database save phase. Failed shows that cannot be scraped after retries are kept in the database (not deleted) to avoid data loss.

_User pain it solves:_ A sequential scraper of 500+ shows with per-session detail calls would take impractically long. Concurrency makes a full scrape feasible in a single sit-down.

**Venue geocoding** — Venues are geocoded via the Nominatim API (OpenStreetMap). Two attempts are made per venue: first a structured address search, then a free-form name search (stripping room suffixes like "- Room A"). A `geocode_attempted` flag prevents re-hitting the API on every scrape. `--force-geocode` overrides this.

_User pain it solves:_ Haversine-based distance and travel-time calculations (used in both the Distance column and conflict detection) require lat/lng coordinates. Venue addresses alone are not sufficient.

**Stale show removal** — Shows that are no longer in the master list after a successful scrape are deleted from the database (and their sessions with them), provided they were not among the shows that failed to scrape.

_User pain it solves:_ Shows occasionally get cancelled or removed from the programme. Keeping them in the database would show cancelled shows in the UI indefinitely.

**Change history tracking** — Each scrape records availability and status changes in `session_history` and `show_history` tables. Only changed rows are inserted (not every scrape, only when key fields differ from the last record). This creates a time-series of how shows fill up across the season.

_User pain it solves:_ MICF shows can sell out or add extra sessions mid-season. The history tables let the user query "when did this session sell out?" or "did this show's availability drop in the last 24 hours?" with raw SQL against the exported database.

---

### 3.2 Web UI — Table and Filtering

**Full-text search** — A search input in the header filters shows by title, artist name, venue name, suburb, and region simultaneously. Search runs in the Web Worker so it never blocks the UI.

_User pain it solves:_ The user often wants to find a specific comedian or venue by name without knowing how it is categorised.

**Column-level text/select/boolean filters** — Each column with filter type `text`, `select`, or `bool` renders a filter input in a dedicated filter row beneath the column header. Text filters do substring matching. Select filters (Suburb, Region, Status) show a dropdown of all distinct values. Boolean filters (Wheelchair, Hearing Loop, etc.) show Yes/No/All.

_User pain it solves:_ The festival has a large number of accessibility options spread across shows. The column filter approach lets the user answer questions like "filter to wheelchair-accessible venues in Brunswick" in seconds.

**Date include/exclude picker** — A calendar widget lets the user select dates to include (show me only shows that have a session on one of these dates) or exclude (hide any show that only runs on these dates, i.e. dates when I am unavailable). Both modes can be active simultaneously. The calendar shows a show-count badge on each date indicating how many shows perform that day.

_User pain it solves:_ Festival attendance is constrained by the user's own schedule. A date filter that shows "what's on during my free weekend" is the first thing a festival-goer needs. The exclude mode handles the inverse: "I cannot attend on these days — what's left?"

**Free shows filter** — A toggle button in the header limits the view to shows with `IsFree = true`. Free shows also pass through the price range filter unconditionally.

_User pain it solves:_ The festival includes a curated free programme. Many festival-goers want to identify free shows as a category.

**Price range filter** — A panel (triggered by a Price button in the header) lets the user set a minimum and/or maximum ticket price. Shows are included if their price range overlaps the filter range (a show with min $20 and max $40 passes a filter of $25–$50 because there is overlap).

_User pain it solves:_ Tickets range from free to over $50. Budget-conscious attendees need a price ceiling. Conversely, a user willing to pay a premium may want to filter out very cheap shows (which sometimes correlate with shorter or less polished productions).

**Availability badges** — The Sessions count cell shows "Hot" (red badge) when the minimum availability percentage across non-sold-out sessions is below 20%, and "Filling" (amber badge) when between 20% and 40%.

_User pain it solves:_ Shows that are selling out quickly require the user to act immediately rather than deliberating. Without this signal, popular shows sell out before the user notices.

**Sorting** — All columns support sorting. Notable sort behaviours:

- Title sort strips leading articles (A, An, The) so "The Kid Laroi" sorts under K.
- Artist sort uses the `SortingTitle` field from the MICF API, which provides an article-stripped sort key for artist names.
- Distance sort requires the user to have set their location.
- PlanTime sort is triggered automatically by the planner and sorts by session start time on the selected date.

_User pain it solves:_ The default date-ascending sort reveals what is on soonest, but sorting by distance or price or venue helps the user prioritise differently.

**Column visibility and resizing** — A Columns button opens a column chooser, grouped by category (Show Info, Venue, Sessions, Accessibility). The Title column is locked visible. Column widths are draggable. Both visibility state and widths persist in localStorage.

_User pain it solves:_ Different use cases require different information. A user scouting for accessible shows wants the accessibility columns visible. A user focused on scheduling wants Time and Sessions visible. Everyone's default view is different.

**Row density** — The user can switch between compact (28px rows) and comfortable (36px rows) display density.

_User pain it solves:_ Compact mode fits more shows in the viewport; comfortable mode is easier to read on high-DPI displays or for users with visual impairments.

**Expandable row detail panel** — Clicking a row expands an inline detail panel showing: a banner image (using the large image URL), show title, artist, venue, duration, an MICF Page link, a Maps link (when geocoded), a Trailer link (when a video embed URL is available), the show description (HTML), and a session table. The session table lists every session with date, time, status badge, price, availability percentage, show type, and per-session tags (Tight Arse, Auslan, Relaxed, Filmed, Preview, Extra).

_User pain it solves:_ The user needs to see detailed session-level information — which specific night has an Auslan interpreter, which session is a preview, exactly how available each night is — without navigating away from the table.

**Active filter pills** — The footer displays pills for every active filter (search query, date selections, free-only, price range, column filters). Each pill has an X to dismiss it individually.

_User pain it solves:_ When multiple filters are active, it is easy to forget what is applied and why the table appears filtered. Pills make the active state explicit and provide a single-click path to removing individual filters.

**Show count footer** — The footer always shows "Showing X of Y shows", confirming at a glance how many shows match the current filters versus the total in the database.

**Location-based distance** — If the user grants geolocation access (or manually sets a location via the Location button), a Distance column becomes available showing the straight-line distance from the user to each show's venue, with a link to Google Maps directions. Distance sorts and column visibility are both conditional on this data being set.

_User pain it solves:_ Festival venues are spread across inner Melbourne suburbs. For a user based in Carlton, a show in St Kilda represents a meaningful travel commitment compared to one at Melbourne Town Hall. Distance makes this comparison explicit.

**Responsive layout** — At 960px and below, the Columns, Export, Density, and Location controls collapse into a "···" overflow menu. At 768px and below, the Day Planner panel becomes a bottom sheet rather than a side panel.

_User pain it solves:_ The tool is occasionally used on a tablet or large phone (e.g. during the festival itself). A collapsed overflow menu avoids the header becoming unusable at narrow widths.

---

### 3.3 Day Planner

**Planner panel** — The Planner button (keyboard shortcut: P) opens a 360px-wide side panel. When open, the main table shifts left to remain fully usable alongside the planner. A date selector calendar at the top of the panel lets the user pick which day to plan.

**Date-contextual table mode** — When a planner date is selected, the main table automatically:

1. Filters to only shows performing on that date.
2. Adds a Time column showing each show's session start time on the selected date.
3. Sorts by Time (ascending), saving and restoring the previous sort key when the planner closes or the date is cleared.

_User pain it solves:_ Planning a day requires knowing what is available on that specific day, sorted by time. The automatic mode switch means the user does not have to manually reconfigure the table every time they open the planner.

**Add/remove shows from plan** — When the planner is open with a date selected, each row in the table gains an action button in the Title column:

- **+** — add the show to the plan (shown in green).
- **✓** — remove the show from the plan (shown for already-planned shows).
- **⚠+** — add despite a conflict warning (shown in amber, with the conflict reason as a tooltip).
- **–** — sold out, cannot be added (shown as a dash).

**Timeline display** — The planner panel shows a chronological timeline of planned shows, each displaying: start time, title, venue, duration, price (or a Free badge), and a remove button. Between consecutive shows, a travel gap row shows the estimated travel time.

_User pain it solves:_ Knowing that two shows are booked for the same day is not enough. The timeline shows the day as a lived sequence, revealing whether the schedule is achievable.

**Conflict detection** — When a show is added to the plan, and before displaying the "⚠+" button for shows already in the table, the system checks for conflicts. A conflict is defined as: the sum of one show's end time plus the estimated travel time to the next venue overlaps with the next show's start time. Travel time is calculated using the Haversine formula between venue coordinates, at a rate of 12 minutes per kilometre, with a minimum of 10 minutes (to account for exiting, walking to a car or tram stop, and entering the next venue). Overlapping show times always produce a conflict. Insufficient travel time (a gap that exists but is shorter than the travel estimate) produces a "tight" warning rather than an outright conflict; the item is shown with an amber border in the timeline.

_User pain it solves:_ The most common mistake when planning a festival day is failing to account for travel time between venues. A 7pm show at ACMI and an 8pm show at The Forum look fine on paper until you realise they are 12 minutes apart on foot, and exiting a theatre at 8pm takes at least 5 minutes. This is the central value proposition of the planner.

**Estimated day cost** — The timeline footer displays the total number of planned shows and an estimated minimum cost (summing the minimum price across all non-free shows).

_User pain it solves:_ Festival budgets are real. Seeing the day's estimated spend before committing helps avoid sticker shock at the box office.

**Plan count badge** — The Planner button displays the number of shows currently planned for the active date (e.g. "Planner (3)"). This provides at-a-glance confirmation of how full the day is without opening the panel.

**Plan persistence** — Plans are stored in localStorage keyed by date (`micf_plans` → `{ "YYYY-MM-DD": [...] }`). The user can close the browser and return to find their plan intact. Multiple days can be planned independently.

**Sold-out suppression** — Shows that are sold out on the selected date show a "–" placeholder instead of an add button. They cannot be added to the plan. This prevents the user from planning a day around shows they cannot actually attend.

---

### 3.4 Data Export

The application serves four export endpoints:

- `/export/json` — All shows, sessions, and venues as a single JSON file. Useful for importing into analysis tools or sharing with others.
- `/export/csv` — Three CSV files (shows, sessions, venues) packaged in a ZIP archive. Suitable for Excel, Google Sheets, or any data tool.
- `/export/excel` — An `.xlsx` workbook with three sheets (Shows, Sessions, Venues), produced by the `excelize` library.
- `/export/db` — The raw SQLite database file. The most powerful export: allows direct SQL queries against `session_history` and `show_history` tables that the web UI does not expose.

_User pain it solves:_ The session and show history tables contain data the web UI does not currently visualise. A user who wants to analyse how availability changed over the month, or write their own queries, can do so against the exported database.

---

### 3.5 Operational Features

**WAL mode** — The SQLite database runs in Write-Ahead Logging mode. This allows the scraper to write to the database while the web server is reading from it, without locking errors.

**Immutable static asset caching** — Built assets in `static/dist/` are served with `Cache-Control: public, max-age=31536000, immutable` and are pre-gzipped in memory at startup. The cache key is the git commit hash embedded in the binary.

**Service worker** — A service worker caches the application shell. The cache is versioned by the commit hash injected at startup as `CACHE_VERSION`. Stale assets are always invalidated on new builds.

**In-memory page cache** — The rendered HTML of the main page (which includes all show data serialised as JSON) is cached in memory after the first request. The cache is invalidated after each scrape via `InvalidatePageCache()`. This makes subsequent page loads near-instant for a tool running on localhost.

**Man page** — `micf -man` produces a properly formatted roff man page that can be piped directly into `man`. This is a quality-of-life feature for a command-line tool that deserves documentation.

---

## 4. User Stories

**The opening weekend scout**
It is two weeks before the festival opens. The user runs `-scrape` to load the complete programme. They open the UI, sort by Dates ascending to see what opens first, and apply a date filter selecting the opening Saturday and Sunday. They enable the Tight Arse column — Tight Arse sessions are discounted tickets offered on specific dates — and sort by price to find the best-value shows available that weekend.

**The budget planner**
The user sets a maximum price of $30 in the price filter. The table immediately collapses to shows within that range. They notice the "Free" badge appearing for several shows. They enable the free filter to see free shows only, make a note of a few, then remove the free filter and keep the $30 cap. They export to CSV to share with a friend who is joining them.

**The accessibility researcher**
The user has a family member with impaired hearing. They open the column chooser and enable the Hearing Loop and Auslan columns. They filter the Hearing Loop column to "Yes." They expand a row to read the venue's accessibility details text and confirm which specific sessions have an Auslan interpreter via the per-session tags in the session table.

**The single day planner**
The user opens the planner panel and picks the upcoming Saturday. The table immediately filters to Saturday shows and sorts by time. They scan the 10am–12pm window, find a show with good availability, and click "+". They look at the 1pm–3pm window — the "⚠+" button on one show reveals that it starts only 15 minutes after their first show ends, with a 20-minute travel time required. They skip it and pick one starting at 2pm instead. A third show at 8pm rounds out the day. The planner footer shows "3 shows · ~$72."

**The neighbourhood focuser**
The user lives in Fitzroy. They tap the Location button and set their suburb. The Distance column appears. They sort by Distance ascending. The first dozen rows are all in Fitzroy, Collingwood, and Fitzroy North — shows they could walk to. They also notice that two shows in Prahran appear surprisingly high in the list; on inspection, they are online shows that report no coordinates and default to maximum distance.

**The availability watcher**
The user has been running `-scrape` daily via cron. They notice one of their favourite shows now has a "Hot" badge — minimum availability is under 20%. They expand the row to check the session table: the Tuesday night session is at 8% availability (shown in red), but Thursday still has 45% (shown in green). They book Thursday.

**The historian**
After the festival, the user exports the raw SQLite database. They open it with DB Browser for SQLite and query `session_history` to see how the availability of a particular show changed day by day across the festival. They find that a show that looked obscure during week one was virtually sold out by week three, suggesting it was getting strong word-of-mouth.

---

## 5. Data Model Rationale

### Shows Table

| Field                                                                | What it enables                                                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                                                                 | Primary key; also the MICF/red61 show ID used in API calls                                               |
| `title`, `artist`                                                    | The two primary human-readable identifiers                                                               |
| `sorting_title`                                                      | Article-stripped sort key for Artist column; prevents "The Chaser" from sorting under T                  |
| `url`                                                                | Relative path to the show's MICF page; used to construct the full URL and for per-show scraping          |
| `venue_id`                                                           | Foreign key to the venues table; enables geography, accessibility, and geocoordinates via JOIN           |
| `dates`                                                              | Human-readable date range string from the search API ("28 Mar – 20 Apr"); displayed in the Dates column  |
| `image_url`, `small_image_url`, `large_image_url`, `guide_image_url` | Three sizes for banner display in the detail panel; largest available is used                            |
| `video_embed_url`                                                    | YouTube/Vimeo URL for the show's trailer; rendered as a Trailer chip in the detail panel                 |
| `description`                                                        | Show description scraped from the detail page; displayed as formatted HTML in the detail panel           |
| `duration`                                                           | Show running time in minutes from `window.sessionDuration`; used in conflict detection and the timeline  |
| `content_warnings`                                                   | Regex-extracted content warning text; stored for reference (not yet a UI filter)                         |
| `price_range`                                                        | Human-readable price string from the detail page; stored but superseded by per-session pricing           |
| `tags`                                                               | Genre/topic tags from the show page (e.g. "comedy, storytelling, LGBTQIA+"); stored but not yet a filter |
| `online_show`, `on_demand_show`                                      | Flags for shows that are not physically in Melbourne; affects distance calculations                      |
| `status`, `availability_level`                                       | Show-level status and availability from the search API (coarser than session-level percentage)           |

### Sessions Table

| Field                                           | What it enables                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `show_id`                                       | Foreign key; all session queries filter by this                                                                    |
| `date`, `time`, `full_date`                     | Date and time fields; `full_date` is ISO datetime used for chronological sorting and conflict arithmetic           |
| `session_id`, `performance_ref`                 | Credentials used to call the session-details pricing API                                                           |
| `is_tight_arse`                                 | Whether this session offers the discounted Tight Arse rate                                                         |
| `is_sold_out`, `cancelled`                      | Status flags; sold-out sessions are suppressed in the planner; cancelled sessions excluded from `sessions-by-date` |
| `preview`, `extra_show`, `laugh_pack`           | Session type flags; displayed as badges in the session table                                                       |
| `has_sign_interpreter`, `is_relaxed`            | Per-session accessibility flags; aggregated to show level for the Auslan and Relaxed columns                       |
| `is_filmed`                                     | Whether the session is being recorded; shown as a badge                                                            |
| `availability_level`, `availability_percentage` | From the session-details API; `availability_percentage` powers the Hot/Filling badges                              |
| `min_price`, `max_price`                        | From the session-details API ticket types; aggregated to show level for the Price column and filter                |
| `is_free_show`                                  | From the session-details API; free shows are excluded from the price filter                                        |
| `ticket_types_json`                             | Full JSON array of ticket tiers preserved for possible future use                                                  |
| `venue_id`                                      | Session-level venue ID (more specific than show-level for multi-room buildings); used in conflict detection        |

### Venues Table

| Field                                                                      | What it enables                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                                                                       | Primary key; joins to both `shows.venue_id` and `sessions.venue_id`                                        |
| `name`, `address`, `suburb`, `location`                                    | `suburb` populates the Suburb column and filter; `location` populates the Region column                    |
| `latitude`, `longitude`                                                    | Geocoded coordinates; enable the Distance column, distance sorting, Maps link, and travel-time calculation |
| `capacity`                                                                 | Shown in the optional Capacity column                                                                      |
| `wheelchair_access`, `disabled_toilets`, `assisted_hearing`, `adults_only` | Accessibility and classification flags shown in dedicated columns                                          |
| `accessibility_details`                                                    | Full accessibility description text shown in the detail panel                                              |
| `geocode_attempted`                                                        | Prevents redundant Nominatim calls on subsequent scrapes                                                   |

### History Tables

`session_history` and `show_history` are append-only tables that record a snapshot whenever key fields change. The `session_history` table records `availability_percentage`, `availability_level`, `is_sold_out`, `min_price`, `max_price`, and `status` per session per scrape (only on change). The `show_history` table records `status` and `availability_level` per show per scrape (only on change).

These tables are not exposed in the web UI but are queryable via the `/export/db` endpoint. They enable post-festival analysis of how the programme evolved — which shows went on sale late, which sold out early, and whether any shows changed price.

---

## 6. Constraints and Trade-offs

### Single User, No Authentication

The tool has no user accounts, no session management, and no access control. It is designed to run on localhost (or a trusted private network). This dramatically simplifies the code: all state is client-side in localStorage; all server state is the SQLite database; there is no middleware layer, no ORM, no framework.

The trade-off is obvious: the tool cannot be deployed as a shared web service. This is an accepted constraint — the tool is for personal use.

### No Real-Time Data

Data is as fresh as the last `-scrape` run. The UI does not poll or push updates. This is a deliberate local-first trade-off: the alternative — making API calls from the browser to the MICF website — would tie the UI's performance to MICF's API latency and risk rate-limiting or terms-of-service issues.

The practical mitigation is that a scrape takes two to four minutes and can be scheduled via cron. During the festival itself, re-scraping daily captures meaningful availability changes.

### No Plan Sharing

Plans are stored in localStorage. There is no server-side persistence of the user's plan, no export of the plan itself, and no sharing mechanism. If the user clears localStorage or switches browsers, the plan is lost.

### Content Warnings Not Yet Filterable

Content warnings are scraped and stored in the database but are not exposed as a column or filter in the UI. The data exists; the feature was not implemented because the warning text is free-form (not normalised) and would require additional parsing work to be useful as a filter.

### Tags Not Yet Filterable

Show genre tags (comedy, storytelling, improv, etc.) are scraped from the detail page and stored as a comma-separated string. They are not exposed in the UI. A tags filter would be valuable — but it requires normalisation work (the tags vary in capitalisation and phrasing) and was deferred.

### Distance Is Straight-Line, Not Walking or Transit

The Distance column and conflict detection use the Haversine formula to compute great-circle distance. This is not the same as walking distance or transit time. The 12 min/km walking estimate in conflict detection is a calibrated heuristic that works reasonably well for inner-Melbourne distances but will underestimate travel time for venues that are far apart on a map but poorly connected by public transport. The 10-minute minimum gap partially compensates.

### Exports Do Not Include History Tables

The JSON, CSV, and Excel exports cover the live `shows`, `sessions`, and `venues` tables. The `session_history` and `show_history` tables are only accessible via the raw SQLite database export. History tables are large, append-only, and primarily useful for SQL-based analysis rather than spreadsheet consumption.

### No Ticket Purchase Integration

The tool links to each show's MICF page (which leads to the ticketing system) but has no booking capability. It is a research and planning tool, not a booking tool.

### Scraping Fragility

The per-show session data and duration are scraped from inline JavaScript variables in the HTML (`window.sessionData`, `window.sessionDuration`). Tags, descriptions, price ranges, and content warnings are extracted using regular expressions on the HTML body. Any change to the MICF website's HTML structure or JavaScript variable names will break these scrapers. The MICF API endpoints (`searchShows`, `getvenues`, `getsessiondetails`) are undocumented and unofficial; they could change or be removed.

This is an inherent trade-off of scraping a website that does not provide an official API. The tool monitors for failures (session warnings are printed during scrape; failed shows are retried and logged) and preserves stale data for shows that could not be scraped, minimising the impact of transient failures.
