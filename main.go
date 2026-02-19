package main

import (
	"embed"
	"flag"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"runtime/debug"
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

func InvalidatePageCache() {
	pageCacheMu.Lock()
	pageCacheRaw = nil
	pageCacheGzip = nil
	pageCacheMu.Unlock()
	datesCacheMu.Lock()
	datesCacheRaw = nil
	datesCacheMu.Unlock()
}

func main() {
	scrapeFlag := flag.Bool("scrape", false, "Execute full sync")
	numWorkers := flag.Int("workers", 10, "Concurrent workers")
	forceGeocode := flag.Bool("force-geocode", false, "Re-geocode all venues")
	dbPath := flag.String("db", "", "Path to SQLite database (default: ./micf.db)")
	port := flag.String("port", "8080", "Port to listen on")
	flag.Parse()

	InitDB(*dbPath)
	BackfillVenueIDs()

	if *scrapeFlag {
		ScrapeAll(*numWorkers, *forceGeocode)
		return
	}

	// Serve embedded static assets (CSS, JS)
	staticSub, _ := fs.Sub(staticFS, "static")
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))

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
	http.HandleFunc("/export/json", handleExportJSON)
	http.HandleFunc("/export/csv", handleExportCSV)
	http.HandleFunc("/export/excel", handleExportExcel)
	http.HandleFunc("/export/db", handleExportDB)

	fmt.Printf("http://localhost:%s\n", *port)
	log.Fatal(http.ListenAndServe(":"+*port, nil))
}
