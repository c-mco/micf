package main

import (
	"database/sql"
	"log"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// InitDB sets up the schema and enables high-performance WAL mode.
// path defaults to "./micf.db" if empty.
func InitDB(path string) {
	if path == "" {
		path = "./micf.db"
	}
	var err error
	db, err = sql.Open("sqlite3", path)
	if err != nil {
		log.Fatal(err)
	}

	// 1. Shows Table
	showSchema := `
	CREATE TABLE IF NOT EXISTS shows (
		id INTEGER PRIMARY KEY,
		title TEXT,
		artist TEXT,
		url TEXT,
		venue_summary TEXT
	);`

	// 2. Sessions Table
	sessionSchema := `
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		show_id INTEGER,
		date TEXT,
		time TEXT,
		full_date TEXT,
		is_tight_arse BOOLEAN,
		is_sold_out BOOLEAN,
		cancelled BOOLEAN,
		FOREIGN KEY(show_id) REFERENCES shows(id)
	);`

	// 3. Venues Table (The new nerdy addition)
	venueSchema := `
	CREATE TABLE IF NOT EXISTS venues (
		id INTEGER PRIMARY KEY,
		name TEXT,
		address TEXT,
		suburb TEXT,
		location TEXT,
		capacity INTEGER,
		wheelchair_access BOOLEAN,
		disabled_toilets BOOLEAN,
		website TEXT
	);`

	// Execute schemas
	_, err = db.Exec(showSchema)
	if err != nil {
		log.Fatal(err)
	}
	_, err = db.Exec(sessionSchema)
	if err != nil {
		log.Fatal(err)
	}
	_, err = db.Exec(venueSchema)
	if err != nil {
		log.Fatal(err)
	}

	// Idempotent migrations (ALTER TABLE errors are silently ignored if column exists)

	// Venues: lat/lng
	db.Exec("ALTER TABLE venues ADD COLUMN latitude REAL")
	db.Exec("ALTER TABLE venues ADD COLUMN longitude REAL")
	// Venues: expanded fields
	db.Exec("ALTER TABLE venues ADD COLUMN phone_number TEXT")
	db.Exec("ALTER TABLE venues ADD COLUMN accessibility_details TEXT")
	db.Exec("ALTER TABLE venues ADD COLUMN adults_only BOOLEAN")
	db.Exec("ALTER TABLE venues ADD COLUMN assisted_hearing BOOLEAN")
	db.Exec("ALTER TABLE venues ADD COLUMN box_office BOOLEAN")
	db.Exec("ALTER TABLE venues ADD COLUMN booking_phone_number TEXT")

	// Shows: expanded fields
	db.Exec("ALTER TABLE shows ADD COLUMN dates TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN show_count TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN image_url TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN small_image_url TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN online_show BOOLEAN")
	db.Exec("ALTER TABLE shows ADD COLUMN on_demand_show BOOLEAN")
	db.Exec("ALTER TABLE shows ADD COLUMN status TEXT")

	// Sessions: expanded fields
	db.Exec("ALTER TABLE sessions ADD COLUMN session_id INTEGER")
	db.Exec("ALTER TABLE sessions ADD COLUMN status TEXT")
	db.Exec("ALTER TABLE sessions ADD COLUMN preview BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN laugh_pack BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN extra_show BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN has_sign_interpreter BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN show_type TEXT")
	db.Exec("ALTER TABLE sessions ADD COLUMN is_filmed BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN is_relaxed BOOLEAN")

	// Shows: venue_id for fast join
	db.Exec("ALTER TABLE shows ADD COLUMN venue_id INTEGER")

	// Shows: detail page data
	db.Exec("ALTER TABLE shows ADD COLUMN large_image_url TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN description TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN duration INTEGER")
	db.Exec("ALTER TABLE shows ADD COLUMN content_warnings TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN price_range TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN tags TEXT")

	// Shows: extra fields from search API
	db.Exec("ALTER TABLE shows ADD COLUMN guide_image_url TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN video_embed_url TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN red61_show_id TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN availability_level TEXT")
	db.Exec("ALTER TABLE shows ADD COLUMN sorting_title TEXT")

	// Sessions: performanceRef + pricing/availability from getsessiondetails
	db.Exec("ALTER TABLE sessions ADD COLUMN performance_ref TEXT")
	db.Exec("ALTER TABLE sessions ADD COLUMN availability_level TEXT")
	db.Exec("ALTER TABLE sessions ADD COLUMN availability_percentage INTEGER")
	db.Exec("ALTER TABLE sessions ADD COLUMN min_price REAL")
	db.Exec("ALTER TABLE sessions ADD COLUMN max_price REAL")
	db.Exec("ALTER TABLE sessions ADD COLUMN is_free_show BOOLEAN")
	db.Exec("ALTER TABLE sessions ADD COLUMN ticket_types_json TEXT")

	// 4. History tables for change tracking
	db.Exec(`CREATE TABLE IF NOT EXISTS session_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER,
		show_id INTEGER,
		scraped_at TEXT,
		availability_percentage INTEGER,
		availability_level TEXT,
		is_sold_out BOOLEAN,
		min_price REAL,
		max_price REAL,
		status TEXT
	)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_session_history_session ON session_history(session_id, scraped_at)`)

	db.Exec(`CREATE TABLE IF NOT EXISTS show_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		show_id INTEGER,
		scraped_at TEXT,
		status TEXT,
		availability_level TEXT
	)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_show_history_show ON show_history(show_id, scraped_at)`)

	// 5. Indexes for performance
	db.Exec("CREATE INDEX IF NOT EXISTS idx_sessions_date_showid ON sessions(date, show_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_shows_venue_id ON shows(venue_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_sessions_show_id ON sessions(show_id)")

	// 5. Optimization: Enable WAL mode
	// This allows the scraper to write while you read the UI on your Mac Mini
	_, err = db.Exec("PRAGMA journal_mode=WAL;")
	if err != nil {
		log.Printf("Could not enable WAL: %v", err)
	}
}

// ShowSnapshot captures a show's state for change detection
type ShowSnapshot struct {
	Title, Artist, URL, VenueSummary string
	SessionCount                     int
}

// GetGeocodedVenueIDs returns IDs of venues that already have coordinates
func GetGeocodedVenueIDs() map[int]bool {
	result := make(map[int]bool)
	rows, err := db.Query("SELECT id FROM venues WHERE latitude != 0 AND longitude != 0")
	if err != nil {
		log.Printf("Error querying geocoded venues: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil {
			result[id] = true
		}
	}
	return result
}

// GetExistingVenueCoords returns lat/lng for a venue ID
func GetExistingVenueCoords(id int) (float64, float64) {
	var lat, lng float64
	err := db.QueryRow("SELECT latitude, longitude FROM venues WHERE id = ?", id).Scan(&lat, &lng)
	if err != nil {
		return 0, 0
	}
	return lat, lng
}

// GetExistingShowData returns a snapshot of all current shows for change detection
func GetExistingShowData() map[int]ShowSnapshot {
	result := make(map[int]ShowSnapshot)
	rows, err := db.Query(`SELECT s.id, s.title, s.artist, s.url, s.venue_summary,
		(SELECT COUNT(*) FROM sessions WHERE show_id = s.id)
		FROM shows s`)
	if err != nil {
		log.Printf("Error querying existing shows: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var snap ShowSnapshot
		if err := rows.Scan(&id, &snap.Title, &snap.Artist, &snap.URL, &snap.VenueSummary, &snap.SessionCount); err == nil {
			result[id] = snap
		}
	}
	return result
}

// RemoveStaleShows deletes shows (and their sessions) that no longer exist
func RemoveStaleShows(ids []int) int {
	if len(ids) == 0 {
		return 0
	}
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting removal transaction: %v", err)
		return 0
	}
	defer tx.Rollback()

	count := 0
	for _, id := range ids {
		tx.Exec("DELETE FROM sessions WHERE show_id = ?", id)
		res, err := tx.Exec("DELETE FROM shows WHERE id = ?", id)
		if err == nil {
			n, _ := res.RowsAffected()
			count += int(n)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("Error committing removal: %v", err)
		return 0
	}
	return count
}

// SaveShow handles the core show data and associated sessions
func SaveShow(show Show, sessions []Session) {
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction for %s: %v", show.Title, err)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`INSERT OR REPLACE INTO shows (id, title, artist, url, venue_summary, dates, show_count, image_url, small_image_url, online_show, on_demand_show, status, venue_id, large_image_url, description, duration, content_warnings, price_range, tags, guide_image_url, video_embed_url, red61_show_id, availability_level, sorting_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		show.ID, show.Title, show.Artist, show.URL, show.VenueSummary, show.Dates, show.ShowCount, show.ImageURL, show.SmallImageURL, show.OnlineShow, show.OnDemandShow, show.Status, show.VenueID, show.LargeImageURL, show.Description, show.Duration, show.ContentWarnings, show.PriceRange, show.Tags, show.GuideImageURL, show.VideoEmbedURL, show.Red61ShowID, show.AvailabilityLevel, show.SortingTitle)
	if err != nil {
		log.Printf("Error saving show %s: %v", show.Title, err)
		return
	}

	_, err = tx.Exec("DELETE FROM sessions WHERE show_id = ?", show.ID)
	if err != nil {
		log.Printf("Error clearing sessions for %s: %v", show.Title, err)
		return
	}

	for _, s := range sessions {
		_, err := tx.Exec(`INSERT INTO sessions (show_id, date, time, full_date, is_tight_arse, is_sold_out, cancelled, session_id, status, preview, laugh_pack, extra_show, has_sign_interpreter, show_type, is_filmed, is_relaxed, performance_ref, availability_level, availability_percentage, min_price, max_price, is_free_show, ticket_types_json)
						  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			show.ID, s.Date, s.Time, s.FullDate, s.IsTightArse, s.IsSoldOut, s.Cancelled, s.SessionID, s.Status, s.Preview, s.LaughPack, s.ExtraShow, s.HasSignInterpreter, s.ShowType, s.IsFilmed, s.IsRelaxed, s.PerformanceRef, s.AvailabilityLevel, s.AvailabilityPct, s.MinPrice, s.MaxPrice, s.IsFreeShow, s.TicketTypesJSON)
		if err != nil {
			log.Printf("Error saving session for %s: %v", show.Title, err)
			return
		}
	}

	// Record session history (change-only: only insert if key fields changed vs last row)
	for _, s := range sessions {
		if s.SessionID == 0 {
			continue
		}
		tx.Exec(`INSERT INTO session_history (session_id, show_id, scraped_at, availability_percentage, availability_level, is_sold_out, min_price, max_price, status)
			SELECT ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?
			WHERE NOT EXISTS (
				SELECT 1 FROM session_history
				WHERE session_id = ?
				AND availability_percentage = ? AND is_sold_out = ? AND status = ?
				ORDER BY scraped_at DESC LIMIT 1
			)`,
			s.SessionID, show.ID, s.AvailabilityPct, s.AvailabilityLevel, s.IsSoldOut, s.MinPrice, s.MaxPrice, s.Status,
			s.SessionID, s.AvailabilityPct, s.IsSoldOut, s.Status)
	}

	// Record show history (change-only)
	tx.Exec(`INSERT INTO show_history (show_id, scraped_at, status, availability_level)
		SELECT ?, datetime('now'), ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM show_history
			WHERE show_id = ? AND status = ? AND availability_level = ?
			ORDER BY scraped_at DESC LIMIT 1
		)`,
		show.ID, show.Status, show.AvailabilityLevel,
		show.ID, show.Status, show.AvailabilityLevel)

	if err := tx.Commit(); err != nil {
		log.Printf("Error committing show %s: %v", show.Title, err)
	}
}

// BackfillVenueIDs resolves venue_id for existing shows that have venue_summary but no venue_id
func BackfillVenueIDs() {
	lookup := BuildVenueLookup()
	if len(lookup) == 0 {
		return
	}

	rows, err := db.Query("SELECT id, venue_summary FROM shows WHERE venue_id IS NULL OR venue_id = 0")
	if err != nil {
		log.Printf("BackfillVenueIDs query error: %v", err)
		return
	}
	defer rows.Close()

	type pending struct {
		id      int
		summary string
	}
	var updates []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.summary); err == nil && p.summary != "" {
			updates = append(updates, p)
		}
	}

	if len(updates) == 0 {
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("BackfillVenueIDs tx error: %v", err)
		return
	}
	defer tx.Rollback()

	count := 0
	for _, u := range updates {
		vid := ResolveVenueID(u.summary, lookup)
		if vid != 0 {
			tx.Exec("UPDATE shows SET venue_id = ? WHERE id = ?", vid, u.id)
			count++
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("BackfillVenueIDs commit error: %v", err)
		return
	}
	if count > 0 {
		log.Printf("Backfilled venue_id for %d shows", count)
	}
}

// SaveVenue persists the rich venue metadata from the Venues API
func SaveVenue(v Venue) {
	query := `INSERT OR REPLACE INTO venues (
		id, name, address, suburb, location, capacity, wheelchair_access, disabled_toilets, website, latitude, longitude,
		phone_number, accessibility_details, adults_only, assisted_hearing, box_office, booking_phone_number
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := db.Exec(query, v.ID, v.Name, v.Address, v.Suburb, v.Location, v.Capacity, v.WheelchairAccess, v.DisabledToilets, v.Website, v.Latitude, v.Longitude,
		v.PhoneNumber, v.AccessibilityDetails, v.AdultsOnly, v.AssistedHearing, v.BoxOffice, v.BookingPhoneNumber)
	if err != nil {
		log.Printf("Error saving venue %s: %v", v.Name, err)
	}
}
