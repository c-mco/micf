package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Compiled once at startup — used in every scrapeShowDetails call.
var (
	sessionRe = regexp.MustCompile(`(?s)window\.sessionData\s*=\s*(\[.*?\]);`)
	durationRe = regexp.MustCompile(`window\.sessionDuration\s*=\s*'(\d+)'`)
	tagRe      = regexp.MustCompile(`<li[^>]*class="show-page__tag[^"]*"[^>]*>([^<]+)</li>`)
	priceRe    = regexp.MustCompile(`\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)`)
	cwRe       = regexp.MustCompile(`(?i)content\s+warning[s]?\s*:?\s*([^<]+)`)
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
	GuideImageURL string `json:"guideImageUrl"`
	VideoEmbedURL string `json:"videoEmbedUrl"`
	Red61ShowID   string `json:"red61ShowId"`
	AvailabilityLevel string `json:"availabilityLevel"`
	SortingTitle  string `json:"sortingTitle"`
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
	PerformanceRef     string `json:"performanceRef"`
	Status             string `json:"status"`
	Preview            bool   `json:"preview"`
	LaughPack          bool   `json:"laughPack"`
	ExtraShow          bool   `json:"extraShow"`
	HasSignInterpreter bool   `json:"hasSignInterpreter"`
	ShowType           string `json:"showType"`
	IsFilmed           bool   `json:"isFilmed"`
	IsRelaxed          bool   `json:"isRelaxed"`
	// Fields populated from getsessiondetails API
	AvailabilityLevel string  `json:"-"`
	AvailabilityPct   int     `json:"-"`
	MinPrice          float64 `json:"-"`
	MaxPrice          float64 `json:"-"`
	IsFreeShow        bool    `json:"-"`
	TicketTypesJSON   string  `json:"-"`
	VenueID           int     `json:"-"`
}

// TicketType represents one pricing tier from getsessiondetails
type TicketType struct {
	Price     float64 `json:"price"`
	Concession struct {
		Title string `json:"title"`
		Code  string `json:"code"`
	} `json:"concession"`
}

// SessionDetails is the response shape from showapi/getsessiondetails
type SessionDetails struct {
	Venue             Venue        `json:"venue"`
	AvailabilityLevel string       `json:"availabilityLevel"`
	AvailabilityPct   int          `json:"availabilityPercentage"`
	TicketTypes       []TicketType `json:"ticketTypes"`
	IsFreeShow        bool         `json:"isFreeShow"`
}

// ScrapeStats tracks what changed during a scrape
type ScrapeStats struct {
	Total, New, Updated, Unchanged, Removed, Failed int
}

// VenueStats tracks geocoding outcomes
type VenueStats struct {
	Total, Geocoded, Skipped, Failed int
	Lines                            []string // buffered log lines, printed after progress
}

// BuildVenueLookup queries all venues and returns a name→id map
func BuildVenueLookup() map[string]int {
	lookup := make(map[string]int)
	rows, err := db.Query("SELECT id, name FROM venues")
	if err != nil {
		fmt.Printf("❌ BuildVenueLookup: %v\n", err)
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

// ScrapeAll orchestrates the full sync in 4 phases:
// Phase 1: Fetch master list + start venue sync in parallel
// Phase 2: Scrape show details with N concurrent workers
// Phase 3: Resolve venue IDs and save to DB
// Phase 4: Geocode any newly discovered session venues
func ScrapeAll(numWorkers int, forceGeocode bool) {
	start := time.Now()

	// Phase 1: Kick off venue sync + fetch master list in parallel.
	// Use a channel so we can do a non-blocking check after shows finish.
	venueDone := make(chan struct{})
	var venueStats VenueStats
	var venueElapsed time.Duration
	go func() {
		t := time.Now()
		venueStats = FetchAndSaveVenues(forceGeocode)
		venueElapsed = time.Since(t).Round(time.Second)
		close(venueDone)
	}()

	fmt.Println("🛰️  Fetching master show list from MICF...")
	shows, err := fetchMasterList()
	if err != nil {
		fmt.Printf("❌ Fatal: %v\n", err)
		return
	}
	total := len(shows)
	fmt.Printf("✅ Found %d shows. Firing up %d workers...\n", total, numWorkers)

	// Phase 2: Scrape show details concurrently
	type scrapeResult struct {
		show     Show
		sessions []Session
	}
	results := make([]scrapeResult, 0, total)
	var resultsMu sync.Mutex
	processed, failed := 0, 0
	var failedShows []Show      // for retry + stale-detection protection
	var sessionWarnings []string

	jobs := make(chan Show, total)
	var wg sync.WaitGroup

	scrapeStart := time.Now()
	for w := 1; w <= numWorkers; w++ {
		wg.Go(func() {
			for show := range jobs {
				sessions, warns, err := scrapeShowDetails(&show)

				resultsMu.Lock()
				if err != nil {
					failed++
					failedShows = append(failedShows, show)
				} else {
					results = append(results, scrapeResult{show, sessions})
					sessionWarnings = append(sessionWarnings, warns...)
				}
				processed++
				fmt.Printf("\r🚀 [%d/%d] %.1f%% — %d failed — %v",
					processed, total,
					float64(processed)/float64(total)*100,
					failed,
					time.Since(scrapeStart).Round(time.Second))
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

	// ── Retries: fire concurrently so Phase 3 can start immediately ─────────
	// All failed shows are retried in parallel (not sequentially), and the 5s
	// delay between attempts overlaps with Phase 3 DB saves below.
	type retryResult struct {
		show     Show
		sessions []Session
		warns    []string
	}
	retryCh := make(chan retryResult, len(failedShows)+1)
	var scrapeEndTime time.Time

	if len(failedShows) > 0 {
		toRetry := append([]Show(nil), failedShows...)
		go func() {
			for attempt := 1; attempt <= 2 && len(toRetry) > 0; attempt++ {
				fmt.Printf("\n🔄 Retrying %d failed show(s) (attempt %d/2)...\n", len(toRetry), attempt)
				time.Sleep(5 * time.Second)
				var rWg sync.WaitGroup
				type attemptRes struct {
					show     Show
					sessions []Session
					warns    []string
					ok       bool
				}
				ach := make(chan attemptRes, len(toRetry))
				for _, s := range toRetry {
					rWg.Add(1)
					go func(show Show) {
						defer rWg.Done()
						sessions, warns, err := scrapeShowDetails(&show)
						if err != nil {
							ach <- attemptRes{show: show}
						} else {
							ach <- attemptRes{show, sessions, warns, true}
						}
					}(s)
				}
				rWg.Wait()
				close(ach)
				var next []Show
				for r := range ach {
					if !r.ok {
						next = append(next, r.show)
					} else {
						retryCh <- retryResult{r.show, r.sessions, r.warns}
					}
				}
				toRetry = next
			}
			failedShows = toRetry // write back permanently-failed shows
			scrapeEndTime = time.Now()
			close(retryCh)
		}()
	} else {
		scrapeEndTime = time.Now()
		close(retryCh)
	}

	// Phase 3: Wait for venues (print a message if still running), resolve IDs, save.
	// Starts immediately — overlaps with the retry delay above.
	saveStart := time.Now()
	select {
	case <-venueDone:
	default:
		fmt.Printf("\n⏳ Waiting for venue sync to finish...")
		<-venueDone
		fmt.Printf(" done (%v)\n", venueElapsed)
	}
	venueLookup := BuildVenueLookup()
	existing := GetExistingShowData()

	type changeEntry struct{ show, detail string }
	var newShows []string
	var updatedShows []changeEntry
	stats := ScrapeStats{}
	scrapedIDs := make(map[int]bool)

	saveOne := func(show Show, sessions []Session) {
		show.VenueSummary = strings.Join(show.Venues, ", ")
		show.VenueID = ResolveVenueID(show.VenueSummary, venueLookup)
		if show.VenueID == 0 {
			for _, sess := range sessions {
				if sess.VenueID != 0 {
					show.VenueID = sess.VenueID
					break
				}
			}
		}
		SaveShow(show, sessions)
		scrapedIDs[show.ID] = true

		label := fmt.Sprintf("%s — %s", show.Title, show.Artist)
		if snap, exists := existing[show.ID]; !exists {
			stats.New++
			newShows = append(newShows, label)
		} else if snap.Title != show.Title || snap.Artist != show.Artist ||
			snap.URL != show.URL || snap.VenueSummary != show.VenueSummary ||
			snap.SessionCount != len(sessions) {
			stats.Updated++
			var changes []string
			if snap.Title != show.Title {
				changes = append(changes, fmt.Sprintf("title: %q→%q", snap.Title, show.Title))
			}
			if snap.Artist != show.Artist {
				changes = append(changes, fmt.Sprintf("artist: %q→%q", snap.Artist, show.Artist))
			}
			if snap.VenueSummary != show.VenueSummary {
				changes = append(changes, fmt.Sprintf("venue: %q→%q", snap.VenueSummary, show.VenueSummary))
			}
			if snap.SessionCount != len(sessions) {
				changes = append(changes, fmt.Sprintf("sessions: %d→%d", snap.SessionCount, len(sessions)))
			}
			updatedShows = append(updatedShows, changeEntry{label, strings.Join(changes, ", ")})
		} else {
			stats.Unchanged++
		}
	}

	for _, r := range results {
		saveOne(r.show, r.sessions)
	}

	// Drain retry results — blocks until retry goroutine closes retryCh.
	// By the time this loop exits, failedShows holds any permanently-failed shows.
	for r := range retryCh {
		saveOne(r.show, r.sessions)
		sessionWarnings = append(sessionWarnings, r.warns...)
	}

	// Retries complete
	failed = len(failedShows)
	stats.Failed = failed
	scrapeElapsed := scrapeEndTime.Sub(scrapeStart).Round(time.Second)

	// Shows that failed scraping are NOT stale — don't delete them
	failedIDs := make(map[int]bool, len(failedShows))
	for _, s := range failedShows {
		failedIDs[s.ID] = true
	}

	var staleIDs []int
	for id := range existing {
		if !scrapedIDs[id] && !failedIDs[id] {
			staleIDs = append(staleIDs, id)
		}
	}
	stats.Removed = RemoveStaleShows(staleIDs)
	stats.Total = stats.New + stats.Updated + stats.Unchanged + stats.Failed
	saveElapsed := time.Since(saveStart).Round(time.Second)

	// Phase 4: Geocode newly discovered session venues
	geocodeStart := time.Now()
	sessionVenueStats := GeocodeNewVenues(forceGeocode)
	geocodeElapsed := time.Since(geocodeStart).Round(time.Second)

	InvalidatePageCache()

	// ── Output ────────────────────────────────────────────────────────────────
	fmt.Printf("\n\n")

	// Buffered geocoding details from FetchAndSaveVenues (ran in parallel — buffered to avoid interleaving)
	if len(venueStats.Lines) > 0 {
		for _, line := range venueStats.Lines {
			fmt.Println(line)
		}
		fmt.Println()
	}

	// Shows that couldn't be scraped even after retries
	if len(failedShows) > 0 {
		fmt.Printf("⚠️  Skipped shows (%d — still in DB, not removed):\n", len(failedShows))
		for _, s := range failedShows {
			fmt.Printf("  ⚠️  %s — %s\n", s.Title, s.Artist)
		}
		fmt.Println()
	}

	// Session detail warnings
	if len(sessionWarnings) > 0 {
		fmt.Printf("⚠️  Session detail errors (%d shows affected):\n", len(sessionWarnings))
		for _, w := range sessionWarnings {
			fmt.Println(w)
		}
		fmt.Println()
	}

	// Summary
	fmt.Printf("🏁 Scrape complete in %v\n", time.Since(start).Round(time.Second))
	fmt.Printf("   Show scraping:  %v (incl. retries)\n", scrapeElapsed)
	fmt.Printf("   Venue sync:     %v (parallel with scraping)\n", venueElapsed)
	fmt.Printf("   DB save:        %v (parallel with retries)\n", saveElapsed)
	if geocodeElapsed > 0 {
		fmt.Printf("   Geocoding:      %v\n", geocodeElapsed)
	}
	fmt.Println()
	fmt.Printf("📊 Shows:  %d total — %d new, %d updated, %d unchanged, %d removed, %d failed\n",
		stats.Total, stats.New, stats.Updated, stats.Unchanged, stats.Removed, stats.Failed)
	fmt.Printf("📍 Venues: %d synced — %d geocoded, %d skipped, %d failed",
		venueStats.Total, venueStats.Geocoded, venueStats.Skipped, venueStats.Failed)
	if sessionVenueStats.Total > 0 {
		fmt.Printf(" | sessions: %d new — %d geocoded, %d failed",
			sessionVenueStats.Total, sessionVenueStats.Geocoded, sessionVenueStats.Failed)
	}
	fmt.Println()

	if len(newShows) > 0 {
		fmt.Printf("\n✨ New shows (%d):\n", len(newShows))
		for _, s := range newShows {
			fmt.Printf("   + %s\n", s)
		}
	}
	if len(updatedShows) > 0 {
		fmt.Printf("\n✏️  Updated shows (%d):\n", len(updatedShows))
		for _, e := range updatedShows {
			fmt.Printf("   ~ %s\n", e.show)
			fmt.Printf("     %s\n", e.detail)
		}
	}
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

	if forceGeocode {
		// Clear geocode_attempted so GeocodeNewVenues will retry session venues too
		db.Exec("UPDATE venues SET geocode_attempted = 0")
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
				stats.Lines = append(stats.Lines, fmt.Sprintf("  📍 %s → %.4f, %.4f", v.Name, lat, lng))
				stats.Geocoded++
			} else {
				stats.Lines = append(stats.Lines, fmt.Sprintf("  ❌ %s (geocode failed)", v.Name))
				stats.Failed++
			}
			time.Sleep(1 * time.Second) // Nominatim rate limit: 1 req/sec
		}
	}
	fmt.Printf("✅ %d venues synced (%d geocoded, %d skipped, %d failed)\n",
		stats.Total, stats.Geocoded, stats.Skipped, stats.Failed)
	return stats
}

// geocodeVenue uses Nominatim structured search to resolve a venue address to lat/lng.
// Using structured fields (street/city/state) instead of a free-form query avoids
// matching streets in outer suburbs that share the same name.
func geocodeVenue(v Venue) (float64, float64) {
	if v.Address == "" {
		return 0, 0
	}

	city := "Melbourne"
	if v.Suburb != "" {
		city = v.Suburb
	}

	apiURL := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/search?format=json&limit=1&street=%s&city=%s&state=Victoria&country=Australia",
		url.QueryEscape(v.Address), url.QueryEscape(city),
	)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0
	}
	req.Header.Set("User-Agent", "MICF-Insights/1.0")

	resp, err := httpClient.Do(req)
	if err != nil {
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

// fetchSessionDetails calls the getsessiondetails API for one session,
// returning pricing and availability data.
func fetchSessionDetails(showID, sessionID int, performanceRef string) (*SessionDetails, error) {
	u := fmt.Sprintf(
		"https://www.comedyfestival.com.au/umbraco/api/showapi/getsessiondetails?showId=%d&sessionId=%d&performanceRef=%s",
		showID, sessionID, url.QueryEscape(performanceRef),
	)
	resp, err := httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var d SessionDetails
	if err := json.NewDecoder(resp.Body).Decode(&d); err != nil {
		return nil, err
	}
	return &d, nil
}

func scrapeShowDetails(show *Show) ([]Session, []string, error) {
	fullURL := "https://www.comedyfestival.com.au" + show.URL
	resp, err := httpClient.Get(fullURL)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	match := sessionRe.FindSubmatch(body)
	if len(match) < 2 {
		return nil, nil, fmt.Errorf("no session data")
	}

	var sessions []Session
	if err := json.Unmarshal(match[1], &sessions); err != nil {
		return nil, nil, err
	}

	bodyStr := string(body)

	// Duration from window.sessionDuration
	if dm := durationRe.FindStringSubmatch(bodyStr); len(dm) >= 2 {
		show.Duration, _ = strconv.Atoi(dm[1])
	}

	// Description from <section class="rte">
	if _, after, ok := strings.Cut(bodyStr, `<section class="rte">`); ok {
		if before, _, ok0 := strings.Cut(after, "</section>"); ok0 {
			show.Description = strings.TrimSpace(before)
		}
	}

	// Tags from <li class="show-page__tag">
	if tagMatches := tagRe.FindAllStringSubmatch(bodyStr, -1); len(tagMatches) > 0 {
		var tags []string
		for _, m := range tagMatches {
			tags = append(tags, strings.TrimSpace(m[1]))
		}
		show.Tags = strings.Join(tags, ", ")
	}

	// Price range (e.g. "$28 - $31")
	if pm := priceRe.FindString(bodyStr); pm != "" {
		show.PriceRange = pm
	}

	// Content warnings
	if cm := cwRe.FindStringSubmatch(bodyStr); len(cm) >= 2 {
		show.ContentWarnings = strings.TrimSpace(cm[1])
	}

	// Enrich sessions with pricing/availability from getsessiondetails API.
	// Fetch all sessions concurrently, bounded to 5 in-flight at a time.
	type detailResult struct {
		idx     int
		details *SessionDetails
	}

	eligible := 0
	for _, s := range sessions {
		if s.SessionID != 0 && s.PerformanceRef != "" {
			eligible++
		}
	}

	var warns []string
	if eligible > 0 {
		detailCh := make(chan detailResult, eligible)
		errCh := make(chan string, eligible)
		sem := make(chan struct{}, 5)
		var detailWg sync.WaitGroup

		for i, s := range sessions {
			if s.SessionID == 0 || s.PerformanceRef == "" {
				continue
			}
			detailWg.Add(1)
			sem <- struct{}{} // blocks when 5 goroutines are already running
			go func(idx int, sess Session) {
				defer detailWg.Done()
				defer func() { <-sem }()
				d, err := fetchSessionDetails(show.ID, sess.SessionID, sess.PerformanceRef)
				if err != nil {
					errCh <- fmt.Sprintf("session %d: %v", sess.SessionID, err)
					return
				}
				detailCh <- detailResult{idx, d}
			}(i, s)
		}
		detailWg.Wait()
		close(detailCh)
		close(errCh)

		// Aggregate session errors into one warning per show
		var errs []string
		for e := range errCh {
			errs = append(errs, e)
		}
		if len(errs) > 0 {
			warns = append(warns, fmt.Sprintf("  ⚠️  %s — %s: %d session detail error(s)",
				show.Title, show.Artist, len(errs)))
		}

		for r := range detailCh {
			s := &sessions[r.idx]
			d := r.details
			s.AvailabilityLevel = d.AvailabilityLevel
			s.AvailabilityPct = d.AvailabilityPct
			s.IsFreeShow = d.IsFreeShow
			if d.Venue.ID != 0 {
				s.VenueID = d.Venue.ID
				SaveVenueIfNew(d.Venue)
			}
			if len(d.TicketTypes) > 0 {
				s.MinPrice = d.TicketTypes[0].Price
				s.MaxPrice = d.TicketTypes[0].Price
				for _, t := range d.TicketTypes[1:] {
					if t.Price < s.MinPrice {
						s.MinPrice = t.Price
					}
					if t.Price > s.MaxPrice {
						s.MaxPrice = t.Price
					}
				}
			}
			if jsonBytes, err := json.Marshal(d.TicketTypes); err == nil {
				s.TicketTypesJSON = string(jsonBytes)
			}
		}
	}

	return sessions, warns, nil
}
