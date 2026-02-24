package main

import (
	"bytes"
	"compress/gzip"
	"embed"
	"flag"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync"
)

//go:embed templates/*
var templatesFS embed.FS

//go:embed static/*
var staticFS embed.FS

var tmpl = template.Must(template.ParseFS(templatesFS, "templates/index.html"))

// staticVersion is the short git commit hash, used as the service worker cache key.
var staticVersion = func() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	var rev string
	var dirty bool
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			if len(s.Value) >= 7 {
				rev = s.Value[:7]
			}
		case "vcs.modified":
			dirty = s.Value == "true"
		}
	}
	if rev == "" {
		return "dev"
	}
	if dirty {
		return rev + "-dirty"
	}
	return rev
}()

// Page and dates caches (invalidated after scrape).
var (
	pageCacheMu   sync.RWMutex
	pageCacheRaw  []byte
	pageCacheGzip []byte
	datesCacheMu  sync.RWMutex
	datesCacheRaw []byte
)

// staticRaw and staticGzip hold pre-compressed dist assets for serving.
var (
	staticRaw  = map[string][]byte{}
	staticGzip = map[string][]byte{}
)

// initStaticCache pre-gzips all dist files at startup for fast serving.
func initStaticCache(sub fs.FS) {
	fs.WalkDir(sub, "dist", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return nil
		}
		staticRaw[path] = data
		var buf bytes.Buffer
		gz, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		gz.Write(data)
		gz.Close()
		staticGzip[path] = buf.Bytes()
		return nil
	})
}

// handleStaticFile serves files from static/dist/ with immutable caching and gzip.
func handleStaticFile(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/static/")
	raw, ok := staticRaw[path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(path, ".js") {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	} else if strings.HasSuffix(path, ".css") {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Write(staticGzip[path])
	} else {
		w.Write(raw)
	}
}

func InvalidatePageCache() {
	pageCacheMu.Lock()
	pageCacheRaw = nil
	pageCacheGzip = nil
	pageCacheMu.Unlock()
	datesCacheMu.Lock()
	datesCacheRaw = nil
	datesCacheMu.Unlock()
}

const helpText = `micf — Melbourne International Comedy Festival insights tool

USAGE
    micf [flags]

MODES
    (no flags)       Start the web server (default: http://localhost:8080)
    -scrape          Scrape the MICF website into the local database, then exit

SERVER FLAGS
    -port PORT       Port for the web server (default: 8080)
    -db PATH         SQLite database path (default: ./micf.db)

SCRAPE FLAGS
    -scrape          Run a full scrape of shows, sessions, venues, and
                     per-session pricing (availability, prices), then exit
    -workers N       Concurrent HTTP workers during scrape (default: 10)
                     Higher values are faster but may rate-limit (20 is fine)
    -force-geocode   Re-geocode all venues even if lat/lng already exist
    -db PATH         SQLite database path (default: ./micf.db)

OTHER FLAGS
    -version         Print build version and exit
    -man             Print a man page to stdout and exit
                       micf -man > /tmp/micf.1 && man /tmp/micf.1
    -h, -help        Show this help message

EXAMPLES
    micf                             # serve on :8080
    micf -port 9090                  # serve on :9090
    micf -scrape                     # fetch latest data, then exit
    micf -scrape -workers 20         # scrape with more concurrency
    micf -scrape -force-geocode      # re-geocode all venues too
    micf -db /data/micf.db           # use a specific database file
    micf -man > /tmp/micf.1 && man /tmp/micf.1

SCRAPE DETAILS
    The scraper hits three MICF API endpoints:
      1. POST /umbraco/api/searchapi/searchShows  — full show list
      2. GET  /umbraco/api/venuesapi/getvenues    — venue metadata
      3. GET  {showUrl}                           — per-show detail page
         (description, duration, tags, session data)
      4. GET  /umbraco/api/showapi/getsessiondetails
         (per-session pricing and availability %)
    Venues are geocoded via the Nominatim API (OpenStreetMap).
    Change history is recorded in session_history and show_history tables.

WEB UI
    The UI is a spreadsheet-style table of all MICF shows.
    Columns can be shown/hidden, sorted, and filtered.
    Header controls: Search, Free toggle, Price range, Date picker, Planner.
    At narrow widths (≤960px) Columns/Export/Density collapse into a ··· menu.

    The Day Planner (Planner button or P key) lets you pick a date and build
    a schedule. Shows are sorted by session time automatically. A Time column
    appears in the grid. Conflict detection uses Haversine distance between
    venues (12 min/km walking, minimum 10 min gap).

EXPORTS
    /export/json    All data as JSON
    /export/csv     Three CSV files in a ZIP archive
    /export/excel   Excel workbook (.xlsx) with three sheets
    /export/db      Raw SQLite database file
`

const scrapeHelpText = `micf -scrape — scrape the MICF website into the local database

USAGE
    micf -scrape [flags]

DESCRIPTION
    Fetches all shows, sessions, venues, and per-session pricing from the
    Melbourne International Comedy Festival website and stores them in a
    local SQLite database. Existing data is updated in-place; stale shows
    (removed from the MICF website) are deleted.

    Change history is recorded in session_history and show_history tables
    so availability drops and price changes can be queried later.

FLAGS
    -workers N       Concurrent HTTP workers (default: 10)
                     Increase for faster scraping; 20 works fine without
                     hitting rate limits in practice.
    -force-geocode   Re-geocode all venues via Nominatim (OpenStreetMap)
                     even if lat/lng coordinates already exist.
    -db PATH         SQLite database path (default: ./micf.db)

EXAMPLES
    micf -scrape
    micf -scrape -workers 20
    micf -scrape -force-geocode
    micf -scrape -db ~/micf-backup.db

APIS USED
    POST /umbraco/api/searchapi/searchShows  — full show list
    GET  /umbraco/api/venuesapi/getvenues    — venue metadata
    GET  {showUrl}                           — per-show HTML (description,
                                               duration, tags, session list)
    GET  /umbraco/api/showapi/getsessiondetails
                                            — per-session pricing and
                                               availability percentage
`

const manPage = `.TH MICF 1 "2026" "micf" "User Commands"
.SH NAME
micf \- Melbourne International Comedy Festival insights tool
.SH SYNOPSIS
.B micf
[\fIflags\fR]
.SH DESCRIPTION
.B micf
scrapes the Melbourne International Comedy Festival website and serves
a fast, spreadsheet-style web UI for browsing shows, filtering by date,
venue, price, and accessibility, and planning a day schedule.
.PP
Run without flags to start the web server. Use
.B \-scrape
to refresh the local SQLite database.
.SH OPTIONS
.TP
.B \-port \fIPORT\fR
Port for the web server (default: 8080).
.TP
.B \-db \fIPATH\fR
Path to the SQLite database file (default: ./micf.db).
.TP
.B \-scrape
Run a full scrape of shows, sessions, venues, and per-session pricing,
then exit.
.TP
.B \-workers \fIN\fR
Number of concurrent HTTP workers used during scraping (default: 10).
.TP
.B \-force\-geocode
Re-geocode all venues even if latitude/longitude coordinates already exist.
.TP
.B \-version
Print the build version and exit.
.TP
.B \-man
Print this man page to stdout and exit:
.RS
micf \-man > /tmp/micf.1 && man /tmp/micf.1
.RE
.TP
.B \-h, \-help
Show a short help message and exit.
.SH EXAMPLES
.TP
Start the web server on the default port:
.B micf
.TP
Serve on a different port:
.B micf \-port 9090
.TP
Scrape the latest MICF data:
.B micf \-scrape
.TP
Scrape with higher concurrency:
.B micf \-scrape \-workers 20
.TP
Use a specific database file:
.B micf \-db /data/micf.db
.SH WEB UI
The UI is a spreadsheet-style table of all MICF shows with sortable,
filterable columns. Filtering tools include: full-text search, a date
picker calendar, a free-shows toggle, and a price range filter.
.PP
The Day Planner (\fIPlanner\fR button, or press \fBP\fR) lets you pick a date and
build a day schedule. A \fITime\fR column appears in the grid showing each show's
session time, sorted automatically. Conflict detection uses Haversine distance
between venues (12 min/km walking, 10-minute minimum gap). Travel time gaps are
shown between plan items.
.SH EXPORTS
The following endpoints serve exported data:
.IP /export/json
All shows, sessions, and venues as a single JSON file.
.IP /export/csv
Three CSV files (shows, sessions, venues) in a ZIP archive.
.IP /export/excel
An Excel workbook (.xlsx) with three sheets.
.IP /export/db
The raw SQLite database file.
.SH FILES
.TP
.I ./micf.db
Default SQLite database location.
.SH AUTHOR
Built for personal use during MICF season.
`

func main() {
	scrapeFlag := flag.Bool("scrape", false, "Run a full scrape of shows, sessions, venues, and pricing, then exit")
	numWorkers := flag.Int("workers", 10, "Concurrent HTTP workers during scrape")
	forceGeocode := flag.Bool("force-geocode", false, "Re-geocode all venues even if coordinates already exist")
	dbPath := flag.String("db", "", "SQLite database path (default: ./micf.db)")
	port := flag.String("port", "8080", "Port for the web server")
	versionFlag := flag.Bool("version", false, "Print build version and exit")
	manFlag := flag.Bool("man", false, "Print a man page to stdout and exit (pipe to: man -l -)")

	flag.Usage = func() {
		// Show scrape-specific help when -scrape is also present
		for _, arg := range os.Args[1:] {
			if arg == "-scrape" || arg == "--scrape" {
				fmt.Fprint(os.Stderr, scrapeHelpText)
				return
			}
		}
		fmt.Fprint(os.Stderr, helpText)
	}
	flag.Parse()

	if *versionFlag {
		fmt.Println(staticVersion)
		return
	}
	if *manFlag {
		fmt.Print(manPage)
		return
	}

	InitDB(*dbPath)
	BackfillVenueIDs()

	if *scrapeFlag {
		ScrapeAll(*numWorkers, *forceGeocode)
		return
	}

	// Serve embedded static assets (CSS, JS) with gzip + immutable cache
	staticSub, _ := fs.Sub(staticFS, "static")
	initStaticCache(staticSub)
	http.HandleFunc("/static/", handleStaticFile)

	// Serve service worker from root path for maximum scope.
	// Prepend CACHE_VERSION so the cache key changes automatically on each build.
	swData, _ := staticFS.ReadFile("static/sw.js")
	swBody := append([]byte("var CACHE_VERSION='"+staticVersion+"';\n"), swData...)
	http.HandleFunc("/sw.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.Header().Set("Service-Worker-Allowed", "/")
		if _, err := w.Write(swBody); err != nil {
			log.Printf("sw.js write error: %v", err)
		}
	})

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/sessions", handleSessions)
	http.HandleFunc("/api/dates", handleDates)
	http.HandleFunc("/api/sessions-by-date", handleSessionsByDate)
	http.HandleFunc("/export/json", handleExportJSON)
	http.HandleFunc("/export/csv", handleExportCSV)
	http.HandleFunc("/export/excel", handleExportExcel)
	http.HandleFunc("/export/db", handleExportDB)

	fmt.Printf("http://localhost:%s\n", *port)
	log.Fatal(http.ListenAndServe(":"+*port, nil))
}
