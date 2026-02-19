package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"strings"
)

// ShowView is the data structure sent to the frontend for each show.
type ShowView struct {
	ID                   int     `json:"ID"`
	Title                string  `json:"Title"`
	Artist               string  `json:"Artist"`
	URL                  string  `json:"URL"`
	Venue                string  `json:"Venue"`
	VenueName            string  `json:"VenueName"`
	Suburb               string  `json:"Suburb"`
	Region               string  `json:"Region"`
	Count                int     `json:"Count"`
	Dates                string  `json:"Dates"`
	Wheelchair           bool    `json:"Wheelchair"`
	Capacity             int     `json:"Capacity"`
	Lat                  float64 `json:"Lat"`
	Lng                  float64 `json:"Lng"`
	ImageURL             string  `json:"ImageURL"`
	SmallImageURL        string  `json:"SmallImageURL"`
	OnlineShow           bool    `json:"OnlineShow"`
	OnDemandShow         bool    `json:"OnDemandShow"`
	Status               string  `json:"Status"`
	AssistedHearing      bool    `json:"AssistedHearing"`
	AdultsOnly           bool    `json:"AdultsOnly"`
	VenueWebsite         string  `json:"VenueWebsite"`
	AccessibilityDetails string  `json:"AccessibilityDetails"`
	HasSignInterpreter   bool    `json:"HasSignInterpreter"`
	HasRelaxed           bool    `json:"HasRelaxed"`
	HasTightArse         bool    `json:"HasTightArse"`
	SoldOutCount         int     `json:"SoldOutCount"`
	DisabledToilets      bool    `json:"DisabledToilets"`
	SessionDates         string  `json:"SessionDates"`
	Description          string  `json:"Description"`
	Duration             int     `json:"Duration"`
	LargeImageURL        string  `json:"LargeImageURL"`
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")

	// Serve from cache when there's no search query
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
				_, err := w.Write(gz)
				if err != nil {
					log.Printf("Query error: %v", err)
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
			} else {
				_, err := w.Write(raw)
				if err != nil {
					log.Printf("Query error: %v", err)
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
			}
			return
		}
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "1000"
	}

	searchParam := "%" + search + "%"

	rows, err := db.Query(`
		SELECT
			s.id,
			s.title,
			s.artist,
			s.url,
			s.venue_summary,
			COUNT(sess.id)                                                     AS total_sessions,
			COALESCE(s.dates, MIN(sess.date), 'TBA')                          AS dates,
			COALESCE(v.suburb, 'TBA')                                          AS suburb,
			COALESCE(v.wheelchair_access, 0)                                   AS wheelchair,
			COALESCE(v.capacity, 0)                                            AS capacity,
			COALESCE(v.latitude, 0)                                            AS lat,
			COALESCE(v.longitude, 0)                                           AS lng,
			COALESCE(s.image_url, '')                                          AS image_url,
			COALESCE(s.small_image_url, '')                                    AS small_image_url,
			COALESCE(s.online_show, 0)                                         AS online_show,
			COALESCE(s.on_demand_show, 0)                                      AS on_demand_show,
			COALESCE(s.status, '')                                             AS show_status,
			COALESCE(v.location, '')                                           AS region,
			COALESCE(v.assisted_hearing, 0)                                    AS assisted_hearing,
			COALESCE(v.adults_only, 0)                                         AS adults_only,
			COALESCE(v.website, '')                                            AS venue_website,
			COALESCE(v.accessibility_details, '')                              AS accessibility_details,
			COALESCE(MAX(sess.has_sign_interpreter), 0)                        AS has_sign_interpreter,
			COALESCE(MAX(sess.is_relaxed), 0)                                  AS has_relaxed,
			COALESCE(MAX(sess.is_tight_arse), 0)                               AS has_tight_arse,
			COALESCE(SUM(CASE WHEN sess.is_sold_out THEN 1 ELSE 0 END), 0)    AS sold_out_count,
			COALESCE(v.name, '')                                               AS venue_name,
			COALESCE(v.disabled_toilets, 0)                                    AS disabled_toilets,
			COALESCE(GROUP_CONCAT(DISTINCT sess.date), '')                     AS session_dates,
			COALESCE(s.description, '')                                        AS description,
			COALESCE(s.duration, 0)                                            AS duration,
			COALESCE(s.large_image_url, '')                                    AS large_image_url
		FROM shows s
		LEFT JOIN sessions sess ON s.id = sess.show_id
		LEFT JOIN venues v ON s.venue_id = v.id
		WHERE (s.title LIKE ? OR s.artist LIKE ? OR v.suburb LIKE ?)
		GROUP BY s.id
		ORDER BY dates ASC
		LIMIT ?`, searchParam, searchParam, searchParam, limit)
	if err != nil {
		log.Printf("Query error: %v", err)
		http.Error(w, "Query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var results []ShowView
	suburbs := map[string]bool{}
	regions := map[string]bool{}
	statuses := map[string]bool{}

	for rows.Next() {
		var sv ShowView
		var wheelchair, onlineShow, onDemandShow, assistedHearing, adultsOnly int
		var hasSignInterpreter, hasRelaxed, hasTightArse, disabledToilets int

		err := rows.Scan(
			&sv.ID, &sv.Title, &sv.Artist, &sv.URL, &sv.Venue,
			&sv.Count, &sv.Dates, &sv.Suburb, &wheelchair, &sv.Capacity,
			&sv.Lat, &sv.Lng, &sv.ImageURL, &sv.SmallImageURL,
			&onlineShow, &onDemandShow, &sv.Status, &sv.Region,
			&assistedHearing, &adultsOnly, &sv.VenueWebsite, &sv.AccessibilityDetails,
			&hasSignInterpreter, &hasRelaxed, &hasTightArse, &sv.SoldOutCount,
			&sv.VenueName, &disabledToilets, &sv.SessionDates,
			&sv.Description, &sv.Duration, &sv.LargeImageURL,
		)
		if err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}

		sv.Wheelchair = wheelchair == 1
		sv.OnlineShow = onlineShow == 1
		sv.OnDemandShow = onDemandShow == 1
		sv.AssistedHearing = assistedHearing == 1
		sv.AdultsOnly = adultsOnly == 1
		sv.HasSignInterpreter = hasSignInterpreter == 1
		sv.HasRelaxed = hasRelaxed == 1
		sv.HasTightArse = hasTightArse == 1
		sv.DisabledToilets = disabledToilets == 1

		if sv.Suburb != "TBA" && sv.Suburb != "" {
			suburbs[sv.Suburb] = true
		}
		if sv.Region != "" {
			regions[sv.Region] = true
		}
		if sv.Status != "" {
			statuses[sv.Status] = true
		}

		results = append(results, sv)
	}

	suburbList := make([]string, 0, len(suburbs))
	for s := range suburbs {
		suburbList = append(suburbList, s)
	}
	regionList := make([]string, 0, len(regions))
	for r := range regions {
		regionList = append(regionList, r)
	}
	statusList := make([]string, 0, len(statuses))
	for s := range statuses {
		statusList = append(statusList, s)
	}

	var totalShows int
	db.QueryRow("SELECT COUNT(*) FROM shows").Scan(&totalShows)

	showsJSON, _ := json.Marshal(results)
	suburbsJSON, _ := json.Marshal(suburbList)
	regionsJSON, _ := json.Marshal(regionList)
	statusesJSON, _ := json.Marshal(statusList)

	data := map[string]any{
		"Shows":      template.JS(showsJSON),
		"Search":     search,
		"Suburbs":    template.JS(suburbsJSON),
		"Regions":    template.JS(regionsJSON),
		"Statuses":   template.JS(statusesJSON),
		"TotalShows": totalShows,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Render failed", http.StatusInternalServerError)
		return
	}
	raw := buf.Bytes()

	// Cache the default response
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

// SessionView is the data structure returned by /api/sessions.
type SessionView struct {
	SessionID          int    `json:"SessionID"`
	Date               string `json:"Date"`
	Time               string `json:"Time"`
	FullDate           string `json:"FullDate"`
	IsTightArse        bool   `json:"IsTightArse"`
	IsSoldOut          bool   `json:"IsSoldOut"`
	Cancelled          bool   `json:"Cancelled"`
	Status             string `json:"Status"`
	Preview            bool   `json:"Preview"`
	LaughPack          bool   `json:"LaughPack"`
	ExtraShow          bool   `json:"ExtraShow"`
	HasSignInterpreter bool   `json:"HasSignInterpreter"`
	ShowType           string `json:"ShowType"`
	IsFilmed           bool   `json:"IsFilmed"`
	IsRelaxed          bool   `json:"IsRelaxed"`
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	showID := r.URL.Query().Get("show_id")
	if showID == "" {
		http.Error(w, "show_id required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query(`
		SELECT
			COALESCE(session_id, 0), COALESCE(date, ''), COALESCE(time, ''),
			COALESCE(full_date, ''), COALESCE(is_tight_arse, 0), COALESCE(is_sold_out, 0),
			COALESCE(cancelled, 0), COALESCE(status, ''), COALESCE(preview, 0),
			COALESCE(laugh_pack, 0), COALESCE(extra_show, 0),
			COALESCE(has_sign_interpreter, 0), COALESCE(show_type, ''),
			COALESCE(is_filmed, 0), COALESCE(is_relaxed, 0)
		FROM sessions WHERE show_id = ?
		ORDER BY full_date ASC`, showID)
	if err != nil {
		log.Printf("Sessions query error: %v", err)
		http.Error(w, "Query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var sessions []SessionView
	for rows.Next() {
		var sv SessionView
		var tightArse, soldOut, cancelled, preview, laughPack, extraShow int
		var hasSign, isFilmed, isRelaxed int

		err := rows.Scan(
			&sv.SessionID, &sv.Date, &sv.Time, &sv.FullDate,
			&tightArse, &soldOut, &cancelled, &sv.Status,
			&preview, &laughPack, &extraShow, &hasSign,
			&sv.ShowType, &isFilmed, &isRelaxed,
		)
		if err != nil {
			log.Printf("Session scan error: %v", err)
			continue
		}

		sv.IsTightArse = tightArse == 1
		sv.IsSoldOut = soldOut == 1
		sv.Cancelled = cancelled == 1
		sv.Preview = preview == 1
		sv.LaughPack = laughPack == 1
		sv.ExtraShow = extraShow == 1
		sv.HasSignInterpreter = hasSign == 1
		sv.IsFilmed = isFilmed == 1
		sv.IsRelaxed = isRelaxed == 1

		sessions = append(sessions, sv)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(w).Encode(sessions)
}

func handleDates(w http.ResponseWriter, r *http.Request) {
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

	var dates []dateEntry
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
