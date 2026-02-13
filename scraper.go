package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Shared HTTP client with connection pooling
var httpClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	},
}

// Venue struct matching the API you found
type Venue struct {
	ID                   int     `json:"id"`
	Name                 string  `json:"name"`
	Address              string  `json:"address"`
	Suburb               string  `json:"suburb"`
	Location             string  `json:"location"`
	Capacity             int     `json:"capacity"`
	WheelchairAccess     bool    `json:"wheelchairAccess"`
	DisabledToilets      bool    `json:"disabledToilets"`
	Website              string  `json:"website"`
	Latitude             float64 `json:"latitude"`
	Longitude            float64 `json:"longitude"`
	PhoneNumber          string  `json:"phoneNumber"`
	AccessibilityDetails string  `json:"accessibilityDetails"`
	AdultsOnly           bool    `json:"adultsOnly"`
	AssistedHearing      bool    `json:"assistedHearing"`
	BoxOffice            bool    `json:"boxOffice"`
	BookingPhoneNumber   string  `json:"bookingPhoneNumber"`
}

type Show struct {
	ID            int      `json:"id"`
	Title         string   `json:"showName"`
	Artist        string   `json:"artistName"`
	URL           string   `json:"url"`
	Venues        []string `json:"venues"`
	VenueSummary  string
	VenueID       int
	Dates         string `json:"dates"`
	ShowCount     string `json:"showCount"`
	ImageURL      string `json:"imageUrl"`
	SmallImageURL string `json:"smallImageUrl"`
	LargeImageURL string `json:"largeImageUrl"`
	OnlineShow    bool   `json:"onlineShow"`
	OnDemandShow  bool   `json:"onDemandShow"`
	Status        string `json:"status"`
	// Fields populated from detail page scraping
	Description     string `json:"-"`
	Duration        int    `json:"-"`
	ContentWarnings string `json:"-"`
	PriceRange      string `json:"-"`
	Tags            string `json:"-"`
}

type Session struct {
	Date               string `json:"date"`
	Time               string `json:"time"`
	FullDate           string `json:"fullDate"`
	IsTightArse        bool   `json:"tightArse"`
	IsSoldOut          bool   `json:"soldout"`
	Cancelled          bool   `json:"cancelled"`
	SessionID          int    `json:"sessionId"`
	Status             string `json:"status"`
	Preview            bool   `json:"preview"`
	LaughPack          bool   `json:"laughPack"`
	ExtraShow          bool   `json:"extraShow"`
	HasSignInterpreter bool   `json:"hasSignInterpreter"`
	ShowType           string `json:"showType"`
	IsFilmed           bool   `json:"isFilmed"`
	IsRelaxed          bool   `json:"isRelaxed"`
}

// ScrapeStats tracks what changed during a scrape
type ScrapeStats struct {
	Total, New, Updated, Unchanged, Removed, Failed int
}

// VenueStats tracks geocoding outcomes
type VenueStats struct {
	Total, Geocoded, Skipped, Failed int
}

// BuildVenueLookup queries all venues and returns a name→id map
func BuildVenueLookup() map[string]int {
	lookup := make(map[string]int)
	rows, err := db.Query("SELECT id, name FROM venues")
	if err != nil {
		log.Printf("BuildVenueLookup error: %v", err)
		return lookup
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err == nil {
			lookup[name] = id
		}
	}
	return lookup
}

// ResolveVenueID attempts to match a venue_summary string to a venue ID
func ResolveVenueID(venueSummary string, lookup map[string]int) int {
	if venueSummary == "" {
		return 0
	}
	// 1. Exact match on full string
	if id, ok := lookup[venueSummary]; ok {
		return id
	}
	// 2. Take first comma-separated entry (multi-venue shows)
	first := venueSummary
	if before, _, ok := strings.Cut(venueSummary, ","); ok {
		first = strings.TrimSpace(before)
	}
	if id, ok := lookup[first]; ok {
		return id
	}
	// 3. Strip " - RoomName" suffix and try again
	if before, _, ok := strings.Cut(first, " - "); ok {
		base := strings.TrimSpace(before)
		if id, ok := lookup[base]; ok {
			return id
		}
	}
	return 0
}

// ScrapeAll orchestrates the full sync in 3 decoupled phases:
// Phase 1: Fetch master list + start venue sync in parallel
// Phase 2: Scrape show details immediately (don't wait for venues)
// Phase 3: After both finish, resolve venue IDs and save to DB
func ScrapeAll(numWorkers int, forceGeocode bool) {
	start := time.Now()

	// Phase 1: Kick off venue sync + fetch master list in parallel
	var venueWg sync.WaitGroup
	var venueStats VenueStats
	venueWg.Go(func() {
		venueStats = FetchAndSaveVenues(forceGeocode)
	})

	fmt.Println("🛰️  Fetching master show list from MICF...")
	shows, err := fetchMasterList()
	if err != nil {
		fmt.Printf("❌ Fatal Error: %v\n", err)
		return
	}
	total := len(shows)
	fmt.Printf("✅ Found %d shows. Firing up %d workers...\n", total, numWorkers)

	// Phase 2: Scrape show details immediately (no waiting on venues)
	type scrapeResult struct {
		show     Show
		sessions []Session
	}
	results := make([]scrapeResult, 0, total)
	var resultsMu sync.Mutex
	processed := 0
	failed := 0

	jobs := make(chan Show, total)
	var wg sync.WaitGroup

	sessionRe := regexp.MustCompile(`(?s)window\.sessionData\s*=\s*(\[.*?\]);`)
	durationRe := regexp.MustCompile(`window\.sessionDuration\s*=\s*'(\d+)'`)

	for w := 1; w <= numWorkers; w++ {
		wg.Go(func() {
			for show := range jobs {
				sessions, err := scrapeShowDetails(&show, sessionRe, durationRe)

				resultsMu.Lock()
				if err != nil {
					failed++
					log.Printf("Skipping %q: %v", show.Title, err)
				} else {
					results = append(results, scrapeResult{show, sessions})
				}
				processed++
				fmt.Printf("\r🚀 Progress: [%d/%d] shows scraped (%.1f%%)...",
					processed, total, float64(processed)/float64(total)*100)
				resultsMu.Unlock()

				time.Sleep(time.Duration(100+rand.Intn(200)) * time.Millisecond)
			}
		})
	}

	for _, s := range shows {
		jobs <- s
	}
	close(jobs)
	wg.Wait()

	// Phase 3: Wait for venues, resolve IDs, and save
	venueWg.Wait()
	venueLookup := BuildVenueLookup()
	existing := GetExistingShowData()

	stats := ScrapeStats{Failed: failed}
	scrapedIDs := make(map[int]bool)

	for _, r := range results {
		r.show.VenueSummary = strings.Join(r.show.Venues, ", ")
		r.show.VenueID = ResolveVenueID(r.show.VenueSummary, venueLookup)
		SaveShow(r.show, r.sessions)
		scrapedIDs[r.show.ID] = true

		if snap, exists := existing[r.show.ID]; !exists {
			stats.New++
		} else if snap.Title != r.show.Title || snap.Artist != r.show.Artist ||
			snap.URL != r.show.URL || snap.VenueSummary != r.show.VenueSummary ||
			snap.SessionCount != len(r.sessions) {
			stats.Updated++
		} else {
			stats.Unchanged++
		}
	}

	// Remove shows that no longer exist in the festival
	var staleIDs []int
	for id := range existing {
		if !scrapedIDs[id] {
			staleIDs = append(staleIDs, id)
		}
	}
	stats.Removed = RemoveStaleShows(staleIDs)
	stats.Total = stats.New + stats.Updated + stats.Unchanged + stats.Failed

	// Invalidate page cache so next request gets fresh data
	InvalidatePageCache()

	fmt.Printf("\n\n🏁 Scrape completed in %v\n", time.Since(start).Round(time.Second))
	fmt.Printf("📊 Shows: %d total — %d new, %d updated, %d unchanged, %d removed, %d failed\n",
		stats.Total, stats.New, stats.Updated, stats.Unchanged, stats.Removed, stats.Failed)
	fmt.Printf("📍 Venues: %d synced — %d geocoded, %d skipped, %d failed\n",
		venueStats.Total, venueStats.Geocoded, venueStats.Skipped, venueStats.Failed)
}

func FetchAndSaveVenues(forceGeocode bool) VenueStats {
	var stats VenueStats
	fmt.Println("🏨 Fetching venue master list...")
	resp, err := httpClient.Get("https://www.comedyfestival.com.au/umbraco/api/venuesapi/getvenues")
	if err != nil {
		fmt.Printf("❌ Venue API Error: %v\n", err)
		return stats
	}

	defer resp.Body.Close()

	var data struct {
		Venues []Venue `json:"venues"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		fmt.Printf("❌ Venue JSON Error: %v\n", err)
		return stats
	}

	geocoded := GetGeocodedVenueIDs()
	stats.Total = len(data.Venues)

	for i, v := range data.Venues {
		if !forceGeocode && geocoded[v.ID] {
			// Preserve existing coordinates, just update other fields
			lat, lng := GetExistingVenueCoords(v.ID)
			data.Venues[i].Latitude = lat
			data.Venues[i].Longitude = lng
			SaveVenue(data.Venues[i])
			stats.Skipped++
		} else {
			lat, lng := geocodeVenue(v)
			data.Venues[i].Latitude = lat
			data.Venues[i].Longitude = lng
			SaveVenue(data.Venues[i])
			if lat != 0 {
				fmt.Printf("  📍 %s → %.4f, %.4f\n", v.Name, lat, lng)
				stats.Geocoded++
			} else {
				stats.Failed++
			}
			time.Sleep(1 * time.Second) // Nominatim rate limit: 1 req/sec
		}
	}
	fmt.Printf("✅ %d venues synced (%d geocoded, %d skipped, %d failed)\n",
		stats.Total, stats.Geocoded, stats.Skipped, stats.Failed)
	return stats
}

// geocodeVenue uses Nominatim to resolve a venue address to lat/lng
func geocodeVenue(v Venue) (float64, float64) {
	if v.Address == "" {
		return 0, 0
	}

	query := v.Address
	if v.Suburb != "" {
		query += ", " + v.Suburb
	}
	query += ", Victoria, Australia"

	apiURL := "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + url.QueryEscape(query)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0
	}
	req.Header.Set("User-Agent", "MICF-Insights/1.0")

	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("Geocode error for %s: %v", v.Name, err)
		return 0, 0
	}
	defer resp.Body.Close()

	var results []struct {
		Lat string `json:"lat"`
		Lon string `json:"lon"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil || len(results) == 0 {
		return 0, 0
	}

	lat, _ := strconv.ParseFloat(results[0].Lat, 64)
	lng, _ := strconv.ParseFloat(results[0].Lon, 64)
	return lat, lng
}

func fetchMasterList() ([]Show, error) {
	payload := []byte(`{"pageSize":1000,"timeView":false}`)
	resp, err := httpClient.Post("https://www.comedyfestival.com.au/umbraco/api/searchapi/searchShows",
		"application/json", bytes.NewBuffer(payload))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var data struct {
		Items []Show `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data.Items, nil
}

func scrapeShowDetails(show *Show, sessionRe, durationRe *regexp.Regexp) ([]Session, error) {
	fullURL := "https://www.comedyfestival.com.au" + show.URL
	resp, err := httpClient.Get(fullURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	match := sessionRe.FindSubmatch(body)
	if len(match) < 2 {
		return nil, fmt.Errorf("no data")
	}

	var sessions []Session
	if err := json.Unmarshal(match[1], &sessions); err != nil {
		return nil, err
	}

	bodyStr := string(body)

	// Duration from window.sessionDuration
	if dm := durationRe.FindStringSubmatch(bodyStr); len(dm) >= 2 {
		show.Duration, _ = strconv.Atoi(dm[1])
	}

	// Description from <section class="rte">
	if _, after, ok := strings.Cut(bodyStr, `<section class="rte">`); ok {
		rest := after
		if before, _, ok0 := strings.Cut(rest, "</section>"); ok0 {
			show.Description = strings.TrimSpace(before)
		}
	}

	// Tags from <li class="show-page__tag">
	tagRe := regexp.MustCompile(`<li[^>]*class="show-page__tag[^"]*"[^>]*>([^<]+)</li>`)
	if tagMatches := tagRe.FindAllStringSubmatch(bodyStr, -1); len(tagMatches) > 0 {
		var tags []string
		for _, m := range tagMatches {
			tags = append(tags, strings.TrimSpace(m[1]))
		}
		show.Tags = strings.Join(tags, ", ")
	}

	// Price range (e.g. "$28 - $31")
	priceRe := regexp.MustCompile(`\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)`)
	if pm := priceRe.FindString(bodyStr); pm != "" {
		show.PriceRange = pm
	}

	// Content warnings
	cwRe := regexp.MustCompile(`(?i)content\s+warning[s]?\s*:?\s*([^<]+)`)
	if cm := cwRe.FindStringSubmatch(bodyStr); len(cm) >= 2 {
		show.ContentWarnings = strings.TrimSpace(cm[1])
	}

	return sessions, nil
}
