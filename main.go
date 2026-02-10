package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
)

//go:embed templates/*
var templatesFS embed.FS

var tmpl = template.Must(template.ParseFS(templatesFS, "templates/index.html"))

func main() {
	scrapeFlag := flag.Bool("scrape", false, "Execute full sync")
	numWorkers := flag.Int("workers", 10, "Concurrent workers")
	forceGeocode := flag.Bool("force-geocode", false, "Re-geocode all venues")
	flag.Parse()

	InitDB()

	if *scrapeFlag {
		ScrapeAll(*numWorkers, *forceGeocode)
		return
	}

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/sessions", handleSessions)
	http.HandleFunc("/api/dates", handleDates)

	fmt.Println("http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := q.Get("search")
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
		LEFT JOIN venues v ON s.venue_summary LIKE '%' || v.name || '%'
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
	tmpl.Execute(w, data)
}

func handleDates(w http.ResponseWriter, r *http.Request) {
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dates)
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
	json.NewEncoder(w).Encode(sessions)
}
