package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQueryShows(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 1, Title: "Show A", Artist: "Alice", Status: "On Sale"}, nil)
	SaveShow(Show{ID: 2, Title: "Show B", Artist: "Bob", OnlineShow: true}, nil)

	shows, err := queryShows()
	if err != nil {
		t.Fatal(err)
	}
	if len(shows) != 2 {
		t.Fatalf("expected 2 shows, got %d", len(shows))
	}

	// Verify order (by id)
	if shows[0].Title != "Show A" || shows[1].Title != "Show B" {
		t.Error("shows not in expected order")
	}
	if !shows[1].OnlineShow {
		t.Error("Show B should be online")
	}
}

func TestQuerySessions(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 1, Title: "Show"}, []Session{
		{Date: "2025-03-28", Time: "7:00 PM", FullDate: "2025-03-28T19:00:00", IsTightArse: true, SessionID: 100},
	})

	sessions, err := querySessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if !sessions[0].IsTightArse {
		t.Error("session should be tight arse")
	}
	if sessions[0].ShowID != 1 {
		t.Errorf("expected show_id 1, got %d", sessions[0].ShowID)
	}
}

func TestQueryVenues(t *testing.T) {
	setupTestDB(t)

	SaveVenue(Venue{ID: 1, Name: "Venue A", Suburb: "Melbourne", WheelchairAccess: true})
	SaveVenue(Venue{ID: 2, Name: "Venue B", Suburb: "Southbank"})

	venues, err := queryVenues()
	if err != nil {
		t.Fatal(err)
	}
	if len(venues) != 2 {
		t.Fatalf("expected 2 venues, got %d", len(venues))
	}
	if !venues[0].WheelchairAccess {
		t.Error("Venue A should have wheelchair access")
	}
}

func TestHandleExportJSON(t *testing.T) {
	setupTestDB(t)

	SaveVenue(Venue{ID: 1, Name: "Venue"})
	SaveShow(Show{ID: 1, Title: "Show", VenueSummary: "Venue", VenueID: 1}, []Session{
		{Date: "2025-03-28", FullDate: "2025-03-28T19:00:00"},
	})

	req := httptest.NewRequest("GET", "/export/json", nil)
	w := httptest.NewRecorder()
	handleExportJSON(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		t.Error("expected JSON content type")
	}

	var result map[string]json.RawMessage
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if _, ok := result["shows"]; !ok {
		t.Error("export should contain 'shows' key")
	}
	if _, ok := result["sessions"]; !ok {
		t.Error("export should contain 'sessions' key")
	}
	if _, ok := result["venues"]; !ok {
		t.Error("export should contain 'venues' key")
	}
}

func TestHandleExportCSV(t *testing.T) {
	setupTestDB(t)

	SaveVenue(Venue{ID: 1, Name: "Venue"})
	SaveShow(Show{ID: 1, Title: "Show"}, nil)

	req := httptest.NewRequest("GET", "/export/csv", nil)
	w := httptest.NewRecorder()
	handleExportCSV(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "application/zip") {
		t.Error("expected zip content type")
	}
	if w.Body.Len() == 0 {
		t.Error("response body should not be empty")
	}
}
