package main

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// setupTestDB initializes an in-memory SQLite database with the full schema.
func setupTestDB(t *testing.T) {
	t.Helper()
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	// Run the same schema setup as InitDB but against our in-memory db
	schemas := []string{
		`CREATE TABLE IF NOT EXISTS shows (id INTEGER PRIMARY KEY, title TEXT, artist TEXT, url TEXT, venue_summary TEXT)`,
		`CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, show_id INTEGER, date TEXT, time TEXT, full_date TEXT, is_tight_arse BOOLEAN, is_sold_out BOOLEAN, cancelled BOOLEAN, FOREIGN KEY(show_id) REFERENCES shows(id))`,
		`CREATE TABLE IF NOT EXISTS venues (id INTEGER PRIMARY KEY, name TEXT, address TEXT, suburb TEXT, location TEXT, capacity INTEGER, wheelchair_access BOOLEAN, disabled_toilets BOOLEAN, website TEXT)`,
		`CREATE TABLE IF NOT EXISTS session_history (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, show_id INTEGER, scraped_at TEXT, availability_percentage INTEGER, availability_level TEXT, is_sold_out BOOLEAN, min_price REAL, max_price REAL, status TEXT)`,
		`CREATE TABLE IF NOT EXISTS show_history (id INTEGER PRIMARY KEY AUTOINCREMENT, show_id INTEGER, scraped_at TEXT, status TEXT, availability_level TEXT)`,
	}
	for _, s := range schemas {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(err)
		}
	}

	// Migrations
	migrations := []string{
		"ALTER TABLE venues ADD COLUMN latitude REAL",
		"ALTER TABLE venues ADD COLUMN longitude REAL",
		"ALTER TABLE venues ADD COLUMN phone_number TEXT",
		"ALTER TABLE venues ADD COLUMN accessibility_details TEXT",
		"ALTER TABLE venues ADD COLUMN adults_only BOOLEAN",
		"ALTER TABLE venues ADD COLUMN assisted_hearing BOOLEAN",
		"ALTER TABLE venues ADD COLUMN box_office BOOLEAN",
		"ALTER TABLE venues ADD COLUMN booking_phone_number TEXT",
		"ALTER TABLE shows ADD COLUMN dates TEXT",
		"ALTER TABLE shows ADD COLUMN show_count TEXT",
		"ALTER TABLE shows ADD COLUMN image_url TEXT",
		"ALTER TABLE shows ADD COLUMN small_image_url TEXT",
		"ALTER TABLE shows ADD COLUMN online_show BOOLEAN",
		"ALTER TABLE shows ADD COLUMN on_demand_show BOOLEAN",
		"ALTER TABLE shows ADD COLUMN status TEXT",
		"ALTER TABLE sessions ADD COLUMN session_id INTEGER",
		"ALTER TABLE sessions ADD COLUMN status TEXT",
		"ALTER TABLE sessions ADD COLUMN preview BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN laugh_pack BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN extra_show BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN has_sign_interpreter BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN show_type TEXT",
		"ALTER TABLE sessions ADD COLUMN is_filmed BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN is_relaxed BOOLEAN",
		"ALTER TABLE shows ADD COLUMN venue_id INTEGER",
		"ALTER TABLE shows ADD COLUMN large_image_url TEXT",
		"ALTER TABLE shows ADD COLUMN description TEXT",
		"ALTER TABLE shows ADD COLUMN duration INTEGER",
		"ALTER TABLE shows ADD COLUMN content_warnings TEXT",
		"ALTER TABLE shows ADD COLUMN price_range TEXT",
		"ALTER TABLE shows ADD COLUMN tags TEXT",
		"ALTER TABLE shows ADD COLUMN guide_image_url TEXT",
		"ALTER TABLE shows ADD COLUMN video_embed_url TEXT",
		"ALTER TABLE shows ADD COLUMN red61_show_id TEXT",
		"ALTER TABLE shows ADD COLUMN availability_level TEXT",
		"ALTER TABLE shows ADD COLUMN sorting_title TEXT",
		"ALTER TABLE sessions ADD COLUMN performance_ref TEXT",
		"ALTER TABLE sessions ADD COLUMN availability_level TEXT",
		"ALTER TABLE sessions ADD COLUMN availability_percentage INTEGER",
		"ALTER TABLE sessions ADD COLUMN min_price REAL",
		"ALTER TABLE sessions ADD COLUMN max_price REAL",
		"ALTER TABLE sessions ADD COLUMN is_free_show BOOLEAN",
		"ALTER TABLE sessions ADD COLUMN ticket_types_json TEXT",
		"ALTER TABLE sessions ADD COLUMN venue_id INTEGER",
	}
	for _, m := range migrations {
		db.Exec(m) // ignore errors (column may already exist)
	}
}

func TestSaveAndQueryShow(t *testing.T) {
	setupTestDB(t)

	show := Show{
		ID:           100,
		Title:        "Funny Night",
		Artist:       "Bob Smith",
		URL:          "/shows/funny-night",
		VenueSummary: "Comedy Theatre",
		Dates:        "Mar 28 - Apr 5",
		Status:       "On Sale",
	}
	sessions := []Session{
		{Date: "2025-03-28", Time: "7:00 PM", FullDate: "2025-03-28T19:00:00", IsTightArse: true},
		{Date: "2025-03-29", Time: "8:00 PM", FullDate: "2025-03-29T20:00:00", IsSoldOut: true},
	}

	SaveShow(show, sessions)

	// Verify show was saved
	var title string
	err := db.QueryRow("SELECT title FROM shows WHERE id = ?", 100).Scan(&title)
	if err != nil {
		t.Fatal(err)
	}
	if title != "Funny Night" {
		t.Errorf("expected title 'Funny Night', got %q", title)
	}

	// Verify sessions were saved
	var count int
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE show_id = ?", 100).Scan(&count)
	if count != 2 {
		t.Errorf("expected 2 sessions, got %d", count)
	}

	// Verify session details
	var isTightArse bool
	db.QueryRow("SELECT is_tight_arse FROM sessions WHERE show_id = ? AND date = '2025-03-28'", 100).Scan(&isTightArse)
	if !isTightArse {
		t.Error("expected first session to be tight arse")
	}
}

func TestSaveShowReplacesExisting(t *testing.T) {
	setupTestDB(t)

	show := Show{ID: 200, Title: "Original Title", Artist: "Alice"}
	SaveShow(show, []Session{{Date: "2025-03-28", FullDate: "2025-03-28T19:00:00"}})

	// Update the show
	show.Title = "Updated Title"
	SaveShow(show, []Session{
		{Date: "2025-04-01", FullDate: "2025-04-01T19:00:00"},
		{Date: "2025-04-02", FullDate: "2025-04-02T19:00:00"},
	})

	var title string
	db.QueryRow("SELECT title FROM shows WHERE id = ?", 200).Scan(&title)
	if title != "Updated Title" {
		t.Errorf("expected 'Updated Title', got %q", title)
	}

	// Sessions should be replaced (old ones deleted)
	var count int
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE show_id = ?", 200).Scan(&count)
	if count != 2 {
		t.Errorf("expected 2 sessions after update, got %d", count)
	}
}

func TestSaveVenue(t *testing.T) {
	setupTestDB(t)

	v := Venue{
		ID:               1,
		Name:             "Comedy Theatre",
		Address:          "240 Exhibition St",
		Suburb:           "Melbourne",
		Location:         "CBD",
		Capacity:         1000,
		WheelchairAccess: true,
		Latitude:         -37.8102,
		Longitude:        144.9697,
	}
	SaveVenue(v)

	var name, suburb string
	var capacity int
	var lat float64
	err := db.QueryRow("SELECT name, suburb, capacity, latitude FROM venues WHERE id = 1").Scan(&name, &suburb, &capacity, &lat)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Comedy Theatre" || suburb != "Melbourne" || capacity != 1000 {
		t.Errorf("unexpected venue data: name=%q suburb=%q capacity=%d", name, suburb, capacity)
	}
	if lat != -37.8102 {
		t.Errorf("expected lat -37.8102, got %f", lat)
	}
}

func TestRemoveStaleShows(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 300, Title: "Stale Show"}, []Session{{Date: "2025-03-28", FullDate: "2025-03-28T19:00:00"}})
	SaveShow(Show{ID: 301, Title: "Keep This"}, nil)

	removed := RemoveStaleShows([]int{300})
	if removed != 1 {
		t.Errorf("expected 1 removed, got %d", removed)
	}

	// Show 300 should be gone
	var count int
	db.QueryRow("SELECT COUNT(*) FROM shows WHERE id = 300").Scan(&count)
	if count != 0 {
		t.Error("stale show was not removed")
	}

	// Its sessions should be gone too
	db.QueryRow("SELECT COUNT(*) FROM sessions WHERE show_id = 300").Scan(&count)
	if count != 0 {
		t.Error("stale sessions were not removed")
	}

	// Show 301 should still exist
	db.QueryRow("SELECT COUNT(*) FROM shows WHERE id = 301").Scan(&count)
	if count != 1 {
		t.Error("non-stale show was incorrectly removed")
	}
}

func TestGetExistingShowData(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 400, Title: "Test Show", Artist: "Artist", URL: "/test", VenueSummary: "Venue"}, []Session{
		{Date: "2025-03-28", FullDate: "2025-03-28T19:00:00"},
		{Date: "2025-03-29", FullDate: "2025-03-29T19:00:00"},
	})

	data := GetExistingShowData()
	snap, ok := data[400]
	if !ok {
		t.Fatal("show 400 not found in existing data")
	}
	if snap.Title != "Test Show" {
		t.Errorf("expected title 'Test Show', got %q", snap.Title)
	}
	if snap.SessionCount != 2 {
		t.Errorf("expected 2 sessions, got %d", snap.SessionCount)
	}
}
