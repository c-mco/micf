package main

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/xuri/excelize/v2"
)

//go:embed templates/*
var templatesFS embed.FS

var tmpl = template.Must(template.ParseFS(templatesFS, "templates/index.html"))

// Response caches
var (
	pageCacheMu   sync.RWMutex
	pageCacheRaw  []byte
	pageCacheGzip []byte
	datesCacheMu  sync.RWMutex
	datesCacheRaw []byte
)

// InvalidatePageCache clears all response caches (called after scrape)
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
	flag.Parse()

	InitDB()
	BackfillVenueIDs()

	if *scrapeFlag {
		ScrapeAll(*numWorkers, *forceGeocode)
		return
	}

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/sessions", handleSessions)
	http.HandleFunc("/api/dates", handleDates)
	http.HandleFunc("/export/json", handleExportJSON)
	http.HandleFunc("/export/csv", handleExportCSV)
	http.HandleFunc("/export/excel", handleExportExcel)
	http.HandleFunc("/export/db", handleExportDB)

	fmt.Println("http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := q.Get("search")

	// Serve from cache for default (no search) requests
	if search == "" {
		pageCacheMu.RLock()
		raw := pageCacheRaw
		gz := pageCacheGzip
		pageCacheMu.RUnlock()

		if raw != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=300")
			if gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				w.Header().Set("Content-Encoding", "gzip")
				w.Write(gz)
			} else {
				w.Write(raw)
			}
			return
		}
	}

	limit := q.Get("limit")
	if limit == "" {
		limit = "1000"
	}

	searchParam := "%" + search + "%"

	baseQuery := `
		SELECT
			s.id,
			s.title,
			s.artist,
			s.url,
			s.venue_summary,
			COUNT(sess.id) as total_sessions,
			COALESCE(s.dates, MIN(sess.date), 'TBA') as dates,
			COALESCE(v.suburb, 'TBA') as suburb,
			COALESCE(v.wheelchair_access, 0) as wheelchair,
			COALESCE(v.capacity, 0) as capacity,
			COALESCE(v.latitude, 0) as lat,
			COALESCE(v.longitude, 0) as lng,
			COALESCE(s.image_url, '') as image_url,
			COALESCE(s.small_image_url, '') as small_image_url,
			COALESCE(s.online_show, 0) as online_show,
			COALESCE(s.on_demand_show, 0) as on_demand_show,
			COALESCE(s.status, '') as show_status,
			COALESCE(v.location, '') as region,
			COALESCE(v.assisted_hearing, 0) as assisted_hearing,
			COALESCE(v.adults_only, 0) as adults_only,
			COALESCE(v.website, '') as venue_website,
			COALESCE(v.accessibility_details, '') as accessibility_details,
			COALESCE(MAX(sess.has_sign_interpreter), 0) as has_sign_interpreter,
			COALESCE(MAX(sess.is_relaxed), 0) as has_relaxed,
			COALESCE(MAX(sess.is_tight_arse), 0) as has_tight_arse,
			COALESCE(SUM(CASE WHEN sess.is_sold_out THEN 1 ELSE 0 END), 0) as sold_out_count,
			COALESCE(v.name, '') as venue_name,
			COALESCE(v.disabled_toilets, 0) as disabled_toilets,
			COALESCE(GROUP_CONCAT(DISTINCT sess.date), '') as session_dates
		FROM shows s
		LEFT JOIN sessions sess ON s.id = sess.show_id
		LEFT JOIN venues v ON s.venue_id = v.id
		WHERE (s.title LIKE ? OR s.artist LIKE ? OR v.suburb LIKE ?)
		GROUP BY s.id
		ORDER BY dates ASC LIMIT ?`

	rows, err := db.Query(baseQuery, searchParam, searchParam, searchParam, limit)
	if err != nil {
		log.Printf("Query Error: %v", err)
		http.Error(w, "Query Failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	results := make([]map[string]interface{}, 0)
	suburbs := make(map[string]bool)
	regions := make(map[string]bool)

	for rows.Next() {
		var id, count, wheelchair, capacity, assistedHearing, adultsOnly int
		var onlineShow, onDemandShow, hasSignInterpreter, hasRelaxed, hasTightArse int
		var soldOutCount, disabledToilets int
		var title, artist, urlStr, venue, dates, suburb string
		var imageURL, smallImageURL, showStatus, region string
		var venueWebsite, accessibilityDetails, venueName string
		var sessionDates string
		var lat, lng float64

		err := rows.Scan(&id, &title, &artist, &urlStr, &venue, &count, &dates,
			&suburb, &wheelchair, &capacity, &lat, &lng,
			&imageURL, &smallImageURL, &onlineShow, &onDemandShow, &showStatus,
			&region, &assistedHearing, &adultsOnly, &venueWebsite, &accessibilityDetails,
			&hasSignInterpreter, &hasRelaxed, &hasTightArse, &soldOutCount, &venueName,
			&disabledToilets, &sessionDates)
		if err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}

		if suburb != "TBA" && suburb != "" {
			suburbs[suburb] = true
		}
		if region != "" {
			regions[region] = true
		}

		results = append(results, map[string]interface{}{
			"ID":                   id,
			"Title":                title,
			"Artist":               artist,
			"Venue":                venue,
			"VenueName":            venueName,
			"Suburb":               suburb,
			"Region":               region,
			"Count":                count,
			"Dates":                dates,
			"URL":                  urlStr,
			"Wheelchair":           wheelchair == 1,
			"Capacity":             capacity,
			"Lat":                  lat,
			"Lng":                  lng,
			"ImageURL":             imageURL,
			"SmallImageURL":        smallImageURL,
			"OnlineShow":           onlineShow == 1,
			"OnDemandShow":         onDemandShow == 1,
			"Status":               showStatus,
			"AssistedHearing":      assistedHearing == 1,
			"AdultsOnly":           adultsOnly == 1,
			"VenueWebsite":         venueWebsite,
			"AccessibilityDetails": accessibilityDetails,
			"HasSignInterpreter":   hasSignInterpreter == 1,
			"HasRelaxed":           hasRelaxed == 1,
			"HasTightArse":         hasTightArse == 1,
			"SoldOutCount":         soldOutCount,
			"DisabledToilets":      disabledToilets == 1,
			"SessionDates":         sessionDates,
		})
	}

	// Collect unique suburbs and regions for filter dropdowns
	suburbList := make([]string, 0, len(suburbs))
	for s := range suburbs {
		suburbList = append(suburbList, s)
	}
	regionList := make([]string, 0, len(regions))
	for r := range regions {
		regionList = append(regionList, r)
	}

	// Get total show count
	var totalShows int
	db.QueryRow("SELECT COUNT(*) FROM shows").Scan(&totalShows)

	showsJSON, err := json.Marshal(results)
	if err != nil {
		log.Printf("JSON marshal error: %v", err)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	suburbsJSON, _ := json.Marshal(suburbList)
	regionsJSON, _ := json.Marshal(regionList)

	data := map[string]interface{}{
		"Shows":      template.JS(showsJSON),
		"Search":     search,
		"Suburbs":    template.JS(suburbsJSON),
		"Regions":    template.JS(regionsJSON),
		"TotalShows": totalShows,
	}

	var buf bytes.Buffer
	tmpl.Execute(&buf, data)
	raw := buf.Bytes()

	// Cache the default (no search) response
	if search == "" {
		var gzBuf bytes.Buffer
		gz := gzip.NewWriter(&gzBuf)
		gz.Write(raw)
		gz.Close()

		pageCacheMu.Lock()
		pageCacheRaw = raw
		pageCacheGzip = gzBuf.Bytes()
		pageCacheMu.Unlock()
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	if search == "" && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		pageCacheMu.RLock()
		gz := pageCacheGzip
		pageCacheMu.RUnlock()
		if gz != nil {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(gz)
			return
		}
	}
	w.Write(raw)
}

func handleDates(w http.ResponseWriter, r *http.Request) {
	// Serve from cache if available
	datesCacheMu.RLock()
	cached := datesCacheRaw
	datesCacheMu.RUnlock()
	if cached != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Write(cached)
		return
	}

	rows, err := db.Query(`
		SELECT date, COUNT(DISTINCT show_id)
		FROM sessions
		WHERE date IS NOT NULL AND date != ''
		GROUP BY date
		ORDER BY MIN(full_date) ASC`)
	if err != nil {
		log.Printf("Dates query error: %v", err)
		http.Error(w, "Query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type dateEntry struct {
		Date      string `json:"date"`
		ShowCount int    `json:"showCount"`
	}

	dates := make([]dateEntry, 0)
	for rows.Next() {
		var d dateEntry
		if err := rows.Scan(&d.Date, &d.ShowCount); err != nil {
			log.Printf("Date scan error: %v", err)
			continue
		}
		dates = append(dates, d)
	}

	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(dates)
	raw := buf.Bytes()

	datesCacheMu.Lock()
	datesCacheRaw = raw
	datesCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(raw)
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	showID := r.URL.Query().Get("show_id")
	if showID == "" {
		http.Error(w, "show_id required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query(`
		SELECT
			COALESCE(session_id, 0),
			COALESCE(date, ''),
			COALESCE(time, ''),
			COALESCE(full_date, ''),
			COALESCE(is_tight_arse, 0),
			COALESCE(is_sold_out, 0),
			COALESCE(cancelled, 0),
			COALESCE(status, ''),
			COALESCE(preview, 0),
			COALESCE(laugh_pack, 0),
			COALESCE(extra_show, 0),
			COALESCE(has_sign_interpreter, 0),
			COALESCE(show_type, ''),
			COALESCE(is_filmed, 0),
			COALESCE(is_relaxed, 0)
		FROM sessions WHERE show_id = ?
		ORDER BY full_date ASC`, showID)
	if err != nil {
		log.Printf("Sessions query error: %v", err)
		http.Error(w, "Query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	sessions := make([]map[string]interface{}, 0)
	for rows.Next() {
		var sessionID, tightArse, soldOut, cancelled, preview, laughPack, extraShow int
		var hasSignInterpreter, isFilmed, isRelaxed int
		var date, timeStr, fullDate, status, showType string

		err := rows.Scan(&sessionID, &date, &timeStr, &fullDate, &tightArse, &soldOut, &cancelled,
			&status, &preview, &laughPack, &extraShow, &hasSignInterpreter, &showType, &isFilmed, &isRelaxed)
		if err != nil {
			log.Printf("Session scan error: %v", err)
			continue
		}

		sessions = append(sessions, map[string]interface{}{
			"SessionID":          sessionID,
			"Date":               date,
			"Time":               timeStr,
			"FullDate":           fullDate,
			"IsTightArse":        tightArse == 1,
			"IsSoldOut":          soldOut == 1,
			"Cancelled":          cancelled == 1,
			"Status":             status,
			"Preview":            preview == 1,
			"LaughPack":          laughPack == 1,
			"ExtraShow":          extraShow == 1,
			"HasSignInterpreter": hasSignInterpreter == 1,
			"ShowType":           showType,
			"IsFilmed":           isFilmed == 1,
			"IsRelaxed":          isRelaxed == 1,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(w).Encode(sessions)
}

// ---- Export helpers ----

type exportShow struct {
	ID           int    `json:"id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	URL          string `json:"url"`
	VenueSummary string `json:"venue_summary"`
	Dates        string `json:"dates"`
	ShowCount    string `json:"show_count"`
	ImageURL     string `json:"image_url"`
	SmallImage   string `json:"small_image_url"`
	OnlineShow   bool   `json:"online_show"`
	OnDemandShow bool   `json:"on_demand_show"`
	Status       string `json:"status"`
}

type exportSession struct {
	ID                 int    `json:"id"`
	ShowID             int    `json:"show_id"`
	Date               string `json:"date"`
	Time               string `json:"time"`
	FullDate           string `json:"full_date"`
	IsTightArse        bool   `json:"is_tight_arse"`
	IsSoldOut          bool   `json:"is_sold_out"`
	Cancelled          bool   `json:"cancelled"`
	SessionID          int    `json:"session_id"`
	Status             string `json:"status"`
	Preview            bool   `json:"preview"`
	LaughPack          bool   `json:"laugh_pack"`
	ExtraShow          bool   `json:"extra_show"`
	HasSignInterpreter bool   `json:"has_sign_interpreter"`
	ShowType           string `json:"show_type"`
	IsFilmed           bool   `json:"is_filmed"`
	IsRelaxed          bool   `json:"is_relaxed"`
}

type exportVenue struct {
	ID                   int     `json:"id"`
	Name                 string  `json:"name"`
	Address              string  `json:"address"`
	Suburb               string  `json:"suburb"`
	Location             string  `json:"location"`
	Capacity             int     `json:"capacity"`
	WheelchairAccess     bool    `json:"wheelchair_access"`
	DisabledToilets      bool    `json:"disabled_toilets"`
	Website              string  `json:"website"`
	Latitude             float64 `json:"latitude"`
	Longitude            float64 `json:"longitude"`
	PhoneNumber          string  `json:"phone_number"`
	AccessibilityDetails string  `json:"accessibility_details"`
	AdultsOnly           bool    `json:"adults_only"`
	AssistedHearing      bool    `json:"assisted_hearing"`
}

func queryShows() ([]exportShow, error) {
	rows, err := db.Query(`SELECT COALESCE(id,0), COALESCE(title,''), COALESCE(artist,''), COALESCE(url,''),
		COALESCE(venue_summary,''), COALESCE(dates,''), COALESCE(show_count,''),
		COALESCE(image_url,''), COALESCE(small_image_url,''),
		COALESCE(online_show,0), COALESCE(on_demand_show,0), COALESCE(status,'') FROM shows ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []exportShow
	for rows.Next() {
		var s exportShow
		var online, onDemand int
		if err := rows.Scan(&s.ID, &s.Title, &s.Artist, &s.URL, &s.VenueSummary,
			&s.Dates, &s.ShowCount, &s.ImageURL, &s.SmallImage,
			&online, &onDemand, &s.Status); err != nil {
			continue
		}
		s.OnlineShow = online == 1
		s.OnDemandShow = onDemand == 1
		result = append(result, s)
	}
	return result, nil
}

func querySessions() ([]exportSession, error) {
	rows, err := db.Query(`SELECT COALESCE(id,0), COALESCE(show_id,0), COALESCE(date,''), COALESCE(time,''),
		COALESCE(full_date,''), COALESCE(is_tight_arse,0), COALESCE(is_sold_out,0), COALESCE(cancelled,0),
		COALESCE(session_id,0), COALESCE(status,''), COALESCE(preview,0), COALESCE(laugh_pack,0),
		COALESCE(extra_show,0), COALESCE(has_sign_interpreter,0), COALESCE(show_type,''),
		COALESCE(is_filmed,0), COALESCE(is_relaxed,0) FROM sessions ORDER BY show_id, full_date`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []exportSession
	for rows.Next() {
		var s exportSession
		var ta, so, ca, pr, lp, ex, si, fi, re int
		if err := rows.Scan(&s.ID, &s.ShowID, &s.Date, &s.Time, &s.FullDate,
			&ta, &so, &ca, &s.SessionID, &s.Status, &pr, &lp, &ex, &si, &s.ShowType, &fi, &re); err != nil {
			continue
		}
		s.IsTightArse = ta == 1
		s.IsSoldOut = so == 1
		s.Cancelled = ca == 1
		s.Preview = pr == 1
		s.LaughPack = lp == 1
		s.ExtraShow = ex == 1
		s.HasSignInterpreter = si == 1
		s.IsFilmed = fi == 1
		s.IsRelaxed = re == 1
		result = append(result, s)
	}
	return result, nil
}

func queryVenues() ([]exportVenue, error) {
	rows, err := db.Query(`SELECT COALESCE(id,0), COALESCE(name,''), COALESCE(address,''), COALESCE(suburb,''),
		COALESCE(location,''), COALESCE(capacity,0), COALESCE(wheelchair_access,0), COALESCE(disabled_toilets,0),
		COALESCE(website,''), COALESCE(latitude,0), COALESCE(longitude,0), COALESCE(phone_number,''),
		COALESCE(accessibility_details,''), COALESCE(adults_only,0), COALESCE(assisted_hearing,0) FROM venues ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []exportVenue
	for rows.Next() {
		var v exportVenue
		var wc, dt, ao, ah int
		if err := rows.Scan(&v.ID, &v.Name, &v.Address, &v.Suburb, &v.Location,
			&v.Capacity, &wc, &dt, &v.Website, &v.Latitude, &v.Longitude,
			&v.PhoneNumber, &v.AccessibilityDetails, &ao, &ah); err != nil {
			continue
		}
		v.WheelchairAccess = wc == 1
		v.DisabledToilets = dt == 1
		v.AdultsOnly = ao == 1
		v.AssistedHearing = ah == 1
		result = append(result, v)
	}
	return result, nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// ---- Export handlers ----

func handleExportJSON(w http.ResponseWriter, r *http.Request) {
	shows, err := queryShows()
	if err != nil {
		http.Error(w, "Failed to query shows", http.StatusInternalServerError)
		return
	}
	sessions, err := querySessions()
	if err != nil {
		http.Error(w, "Failed to query sessions", http.StatusInternalServerError)
		return
	}
	venues, err := queryVenues()
	if err != nil {
		http.Error(w, "Failed to query venues", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="micf-export.json"`)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"shows":    shows,
		"sessions": sessions,
		"venues":   venues,
	})
}

func handleExportCSV(w http.ResponseWriter, r *http.Request) {
	shows, err := queryShows()
	if err != nil {
		http.Error(w, "Failed to query shows", http.StatusInternalServerError)
		return
	}
	sessions, err := querySessions()
	if err != nil {
		http.Error(w, "Failed to query sessions", http.StatusInternalServerError)
		return
	}
	venues, err := queryVenues()
	if err != nil {
		http.Error(w, "Failed to query venues", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="micf-export.zip"`)

	zw := zip.NewWriter(w)
	defer zw.Close()

	// Shows CSV
	f, _ := zw.Create("shows.csv")
	cw := csv.NewWriter(f)
	cw.Write([]string{"id", "title", "artist", "url", "venue_summary", "dates", "show_count", "image_url", "small_image_url", "online_show", "on_demand_show", "status"})
	for _, s := range shows {
		cw.Write([]string{strconv.Itoa(s.ID), s.Title, s.Artist, s.URL, s.VenueSummary, s.Dates, s.ShowCount, s.ImageURL, s.SmallImage, boolStr(s.OnlineShow), boolStr(s.OnDemandShow), s.Status})
	}
	cw.Flush()

	// Sessions CSV
	f, _ = zw.Create("sessions.csv")
	cw = csv.NewWriter(f)
	cw.Write([]string{"id", "show_id", "date", "time", "full_date", "is_tight_arse", "is_sold_out", "cancelled", "session_id", "status", "preview", "laugh_pack", "extra_show", "has_sign_interpreter", "show_type", "is_filmed", "is_relaxed"})
	for _, s := range sessions {
		cw.Write([]string{strconv.Itoa(s.ID), strconv.Itoa(s.ShowID), s.Date, s.Time, s.FullDate, boolStr(s.IsTightArse), boolStr(s.IsSoldOut), boolStr(s.Cancelled), strconv.Itoa(s.SessionID), s.Status, boolStr(s.Preview), boolStr(s.LaughPack), boolStr(s.ExtraShow), boolStr(s.HasSignInterpreter), s.ShowType, boolStr(s.IsFilmed), boolStr(s.IsRelaxed)})
	}
	cw.Flush()

	// Venues CSV
	f, _ = zw.Create("venues.csv")
	cw = csv.NewWriter(f)
	cw.Write([]string{"id", "name", "address", "suburb", "location", "capacity", "wheelchair_access", "disabled_toilets", "website", "latitude", "longitude", "phone_number", "accessibility_details", "adults_only", "assisted_hearing"})
	for _, v := range venues {
		cw.Write([]string{strconv.Itoa(v.ID), v.Name, v.Address, v.Suburb, v.Location, strconv.Itoa(v.Capacity), boolStr(v.WheelchairAccess), boolStr(v.DisabledToilets), v.Website, fmt.Sprintf("%.6f", v.Latitude), fmt.Sprintf("%.6f", v.Longitude), v.PhoneNumber, v.AccessibilityDetails, boolStr(v.AdultsOnly), boolStr(v.AssistedHearing)})
	}
	cw.Flush()
}

func handleExportExcel(w http.ResponseWriter, r *http.Request) {
	shows, err := queryShows()
	if err != nil {
		http.Error(w, "Failed to query shows", http.StatusInternalServerError)
		return
	}
	sessions, err := querySessions()
	if err != nil {
		http.Error(w, "Failed to query sessions", http.StatusInternalServerError)
		return
	}
	venues, err := queryVenues()
	if err != nil {
		http.Error(w, "Failed to query venues", http.StatusInternalServerError)
		return
	}

	f := excelize.NewFile()
	defer f.Close()

	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})

	// Shows sheet
	f.SetSheetName("Sheet1", "Shows")
	showHeaders := []string{"ID", "Title", "Artist", "URL", "Venue Summary", "Dates", "Show Count", "Image URL", "Small Image URL", "Online Show", "On Demand Show", "Status"}
	for i, h := range showHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue("Shows", cell, h)
		f.SetCellStyle("Shows", cell, cell, bold)
	}
	for ri, s := range shows {
		row := ri + 2
		f.SetCellValue("Shows", cellRef(1, row), s.ID)
		f.SetCellValue("Shows", cellRef(2, row), s.Title)
		f.SetCellValue("Shows", cellRef(3, row), s.Artist)
		f.SetCellValue("Shows", cellRef(4, row), s.URL)
		f.SetCellValue("Shows", cellRef(5, row), s.VenueSummary)
		f.SetCellValue("Shows", cellRef(6, row), s.Dates)
		f.SetCellValue("Shows", cellRef(7, row), s.ShowCount)
		f.SetCellValue("Shows", cellRef(8, row), s.ImageURL)
		f.SetCellValue("Shows", cellRef(9, row), s.SmallImage)
		f.SetCellValue("Shows", cellRef(10, row), s.OnlineShow)
		f.SetCellValue("Shows", cellRef(11, row), s.OnDemandShow)
		f.SetCellValue("Shows", cellRef(12, row), s.Status)
	}

	// Sessions sheet
	f.NewSheet("Sessions")
	sessHeaders := []string{"ID", "Show ID", "Date", "Time", "Full Date", "Tight Arse", "Sold Out", "Cancelled", "Session ID", "Status", "Preview", "Laugh Pack", "Extra Show", "Sign Interpreter", "Show Type", "Filmed", "Relaxed"}
	for i, h := range sessHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue("Sessions", cell, h)
		f.SetCellStyle("Sessions", cell, cell, bold)
	}
	for ri, s := range sessions {
		row := ri + 2
		f.SetCellValue("Sessions", cellRef(1, row), s.ID)
		f.SetCellValue("Sessions", cellRef(2, row), s.ShowID)
		f.SetCellValue("Sessions", cellRef(3, row), s.Date)
		f.SetCellValue("Sessions", cellRef(4, row), s.Time)
		f.SetCellValue("Sessions", cellRef(5, row), s.FullDate)
		f.SetCellValue("Sessions", cellRef(6, row), s.IsTightArse)
		f.SetCellValue("Sessions", cellRef(7, row), s.IsSoldOut)
		f.SetCellValue("Sessions", cellRef(8, row), s.Cancelled)
		f.SetCellValue("Sessions", cellRef(9, row), s.SessionID)
		f.SetCellValue("Sessions", cellRef(10, row), s.Status)
		f.SetCellValue("Sessions", cellRef(11, row), s.Preview)
		f.SetCellValue("Sessions", cellRef(12, row), s.LaughPack)
		f.SetCellValue("Sessions", cellRef(13, row), s.ExtraShow)
		f.SetCellValue("Sessions", cellRef(14, row), s.HasSignInterpreter)
		f.SetCellValue("Sessions", cellRef(15, row), s.ShowType)
		f.SetCellValue("Sessions", cellRef(16, row), s.IsFilmed)
		f.SetCellValue("Sessions", cellRef(17, row), s.IsRelaxed)
	}

	// Venues sheet
	f.NewSheet("Venues")
	venueHeaders := []string{"ID", "Name", "Address", "Suburb", "Location", "Capacity", "Wheelchair Access", "Disabled Toilets", "Website", "Latitude", "Longitude", "Phone Number", "Accessibility Details", "Adults Only", "Assisted Hearing"}
	for i, h := range venueHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue("Venues", cell, h)
		f.SetCellStyle("Venues", cell, cell, bold)
	}
	for ri, v := range venues {
		row := ri + 2
		f.SetCellValue("Venues", cellRef(1, row), v.ID)
		f.SetCellValue("Venues", cellRef(2, row), v.Name)
		f.SetCellValue("Venues", cellRef(3, row), v.Address)
		f.SetCellValue("Venues", cellRef(4, row), v.Suburb)
		f.SetCellValue("Venues", cellRef(5, row), v.Location)
		f.SetCellValue("Venues", cellRef(6, row), v.Capacity)
		f.SetCellValue("Venues", cellRef(7, row), v.WheelchairAccess)
		f.SetCellValue("Venues", cellRef(8, row), v.DisabledToilets)
		f.SetCellValue("Venues", cellRef(9, row), v.Website)
		f.SetCellValue("Venues", cellRef(10, row), v.Latitude)
		f.SetCellValue("Venues", cellRef(11, row), v.Longitude)
		f.SetCellValue("Venues", cellRef(12, row), v.PhoneNumber)
		f.SetCellValue("Venues", cellRef(13, row), v.AccessibilityDetails)
		f.SetCellValue("Venues", cellRef(14, row), v.AdultsOnly)
		f.SetCellValue("Venues", cellRef(15, row), v.AssistedHearing)
	}

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="micf-export.xlsx"`)
	f.Write(w)
}

func handleExportDB(w http.ResponseWriter, r *http.Request) {
	// Create a clean copy using VACUUM INTO (handles WAL mode properly)
	tmpFile, err := os.CreateTemp("", "micf-export-*.db")
	if err != nil {
		http.Error(w, "Failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	_, err = db.Exec("VACUUM INTO ?", tmpPath)
	if err != nil {
		http.Error(w, "Failed to create database copy", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-sqlite3")
	w.Header().Set("Content-Disposition", `attachment; filename="micf.db"`)
	http.ServeFile(w, r, tmpPath)
}

func cellRef(col, row int) string {
	s, _ := excelize.CoordinatesToCellName(col, row)
	return s
}
