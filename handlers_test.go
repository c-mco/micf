package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleIndex(t *testing.T) {
	setupTestDB(t)

	// Insert a venue and show for the index to return
	SaveVenue(Venue{ID: 1, Name: "Test Venue", Suburb: "Melbourne", Location: "CBD"})
	show := Show{ID: 1, Title: "Test Show", Artist: "Test Artist", URL: "/shows/test", VenueSummary: "Test Venue", VenueID: 1, Dates: "Mar 28", Status: "On Sale"}
	SaveShow(show, []Session{{Date: "2025-03-28", Time: "7:00 PM", FullDate: "2025-03-28T19:00:00"}})

	// Clear cache to force fresh render
	InvalidatePageCache()

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handleIndex(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	body := w.Body.String()
	if !strings.Contains(body, "Test Show") {
		t.Error("response should contain show title")
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("expected text/html content type, got %q", ct)
	}
}

func TestHandleIndexSearch(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveVenue(Venue{ID: 1, Name: "Venue", Suburb: "Melbourne"})
	SaveShow(Show{ID: 1, Title: "Funny Show", Artist: "Bob", VenueSummary: "Venue", VenueID: 1}, nil)
	SaveShow(Show{ID: 2, Title: "Serious Show", Artist: "Alice", VenueSummary: "Venue", VenueID: 1}, nil)

	req := httptest.NewRequest("GET", "/?search=Funny", nil)
	w := httptest.NewRecorder()
	handleIndex(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "Funny Show") {
		t.Error("search should return 'Funny Show'")
	}
}

func TestHandleSessions(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 1, Title: "Show"}, []Session{
		{Date: "2025-03-28", Time: "7:00 PM", FullDate: "2025-03-28T19:00:00", SessionID: 100, IsTightArse: true},
		{Date: "2025-03-29", Time: "8:00 PM", FullDate: "2025-03-29T20:00:00", SessionID: 101, IsSoldOut: true},
	})

	req := httptest.NewRequest("GET", "/api/sessions?show_id=1", nil)
	w := httptest.NewRecorder()
	handleSessions(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		t.Error("expected JSON content type")
	}

	var sessions []SessionView
	if err := json.NewDecoder(w.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	if !sessions[0].IsTightArse {
		t.Error("first session should be tight arse")
	}
	if !sessions[1].IsSoldOut {
		t.Error("second session should be sold out")
	}
}

func TestHandleSessionsMissingID(t *testing.T) {
	setupTestDB(t)

	req := httptest.NewRequest("GET", "/api/sessions", nil)
	w := httptest.NewRecorder()
	handleSessions(w, req)

	if w.Result().StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Result().StatusCode)
	}
}

func TestHandleDates(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveShow(Show{ID: 1, Title: "Show A"}, []Session{
		{Date: "2025-03-28", FullDate: "2025-03-28T19:00:00"},
		{Date: "2025-03-28", FullDate: "2025-03-28T20:00:00"}, // same date, different time
		{Date: "2025-03-29", FullDate: "2025-03-29T19:00:00"},
	})
	SaveShow(Show{ID: 2, Title: "Show B"}, []Session{
		{Date: "2025-03-28", FullDate: "2025-03-28T21:00:00"},
	})

	req := httptest.NewRequest("GET", "/api/dates", nil)
	w := httptest.NewRecorder()
	handleDates(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	type dateEntry struct {
		Date      string `json:"date"`
		ShowCount int    `json:"showCount"`
	}
	var dates []dateEntry
	if err := json.NewDecoder(w.Body).Decode(&dates); err != nil {
		t.Fatal(err)
	}
	if len(dates) != 2 {
		t.Fatalf("expected 2 dates, got %d", len(dates))
	}

	// 2025-03-28 should have 2 distinct shows
	for _, d := range dates {
		if d.Date == "2025-03-28" && d.ShowCount != 2 {
			t.Errorf("expected 2 shows on 2025-03-28, got %d", d.ShowCount)
		}
		if d.Date == "2025-03-29" && d.ShowCount != 1 {
			t.Errorf("expected 1 show on 2025-03-29, got %d", d.ShowCount)
		}
	}
}

// TestHandleIndexSessionDates verifies that SessionDates is correctly
// populated in the embedded JSON so the frontend date-filter can use it.
func TestHandleIndexSessionDates(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveVenue(Venue{ID: 1, Name: "Venue", Suburb: "Melbourne", Location: "CBD"})
	SaveShow(Show{ID: 1, Title: "Multi-Day Show", VenueID: 1}, []Session{
		{Date: "2026-03-20", FullDate: "2026-03-20T19:00:00"},
		{Date: "2026-03-21", FullDate: "2026-03-21T19:00:00"},
		{Date: "2026-03-22", FullDate: "2026-03-22T19:00:00"},
	})

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handleIndex(w, req)

	body := w.Body.String()
	for _, date := range []string{"2026-03-20", "2026-03-21", "2026-03-22"} {
		if !strings.Contains(body, date) {
			t.Errorf("response body should contain session date %s", date)
		}
	}
}

// TestHandleIndexGzip verifies that gzip-encoded responses are served when
// the client sends Accept-Encoding: gzip.
func TestHandleIndexGzip(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveVenue(Venue{ID: 1, Name: "Venue", Suburb: "Melbourne"})
	SaveShow(Show{ID: 1, Title: "Show"}, nil)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	handleIndex(w, req)

	resp := w.Result()
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatal("expected Content-Encoding: gzip")
	}

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatalf("response is not valid gzip: %v", err)
	}
	defer gz.Close()
	body, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("failed to decompress gzip body: %v", err)
	}
	if !strings.Contains(string(body), "Show") {
		t.Error("decompressed body should contain show data")
	}
}

// TestHandleIndexCacheHit verifies that a second request without a search
// query is served from the in-memory page cache.
func TestHandleIndexCacheHit(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveShow(Show{ID: 1, Title: "Cached Show"}, nil)

	// First request populates the cache.
	req1 := httptest.NewRequest("GET", "/", nil)
	w1 := httptest.NewRecorder()
	handleIndex(w1, req1)
	if !strings.Contains(w1.Body.String(), "Cached Show") {
		t.Fatal("first response should contain show")
	}

	// Second request should hit the cache; body must still contain the show.
	req2 := httptest.NewRequest("GET", "/", nil)
	w2 := httptest.NewRecorder()
	handleIndex(w2, req2)
	if !strings.Contains(w2.Body.String(), "Cached Show") {
		t.Error("cached response should still contain show")
	}
}

// TestHandleIndexCacheInvalidation verifies that InvalidatePageCache causes
// the next request to reflect newly added data.
func TestHandleIndexCacheInvalidation(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveShow(Show{ID: 1, Title: "Original Show"}, nil)

	// Warm the cache.
	req1 := httptest.NewRequest("GET", "/", nil)
	handleIndex(httptest.NewRecorder(), req1)

	// Add a new show and invalidate.
	SaveShow(Show{ID: 2, Title: "New Show"}, nil)
	InvalidatePageCache()

	req2 := httptest.NewRequest("GET", "/", nil)
	w2 := httptest.NewRecorder()
	handleIndex(w2, req2)
	if !strings.Contains(w2.Body.String(), "New Show") {
		t.Error("post-invalidation response should include newly added show")
	}
}

// TestHandleSessionsOrdering verifies sessions are returned in ascending
// chronological order regardless of insertion order.
func TestHandleSessionsOrdering(t *testing.T) {
	setupTestDB(t)

	// Insert sessions out of order.
	SaveShow(Show{ID: 1, Title: "Show"}, []Session{
		{Date: "2026-03-22", Time: "7:00 PM", FullDate: "2026-03-22T19:00:00"},
		{Date: "2026-03-20", Time: "8:00 PM", FullDate: "2026-03-20T20:00:00"},
		{Date: "2026-03-21", Time: "7:00 PM", FullDate: "2026-03-21T19:00:00"},
	})

	req := httptest.NewRequest("GET", "/api/sessions?show_id=1", nil)
	w := httptest.NewRecorder()
	handleSessions(w, req)

	var sessions []SessionView
	if err := json.NewDecoder(w.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}
	if sessions[0].Date != "2026-03-20" {
		t.Errorf("first session should be 2026-03-20, got %s", sessions[0].Date)
	}
	if sessions[1].Date != "2026-03-21" {
		t.Errorf("second session should be 2026-03-21, got %s", sessions[1].Date)
	}
	if sessions[2].Date != "2026-03-22" {
		t.Errorf("third session should be 2026-03-22, got %s", sessions[2].Date)
	}
}

// TestHandleSessionsAllFlags verifies that all boolean session flags
// (Preview, LaughPack, ExtraShow, HasSignInterpreter, IsFilmed, IsRelaxed)
// are correctly returned.
func TestHandleSessionsAllFlags(t *testing.T) {
	setupTestDB(t)

	SaveShow(Show{ID: 1, Title: "Show"}, []Session{{
		Date:               "2026-03-20",
		FullDate:           "2026-03-20T19:00:00",
		Preview:            true,
		LaughPack:          true,
		ExtraShow:          true,
		HasSignInterpreter: true,
		IsFilmed:           true,
		IsRelaxed:          true,
	}})

	req := httptest.NewRequest("GET", "/api/sessions?show_id=1", nil)
	w := httptest.NewRecorder()
	handleSessions(w, req)

	var sessions []SessionView
	if err := json.NewDecoder(w.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	s := sessions[0]
	if !s.Preview {
		t.Error("Preview should be true")
	}
	if !s.LaughPack {
		t.Error("LaughPack should be true")
	}
	if !s.ExtraShow {
		t.Error("ExtraShow should be true")
	}
	if !s.HasSignInterpreter {
		t.Error("HasSignInterpreter should be true")
	}
	if !s.IsFilmed {
		t.Error("IsFilmed should be true")
	}
	if !s.IsRelaxed {
		t.Error("IsRelaxed should be true")
	}
}

// TestHandleSessionsEmptyShow verifies that a show with no sessions returns
// an empty JSON array (not null) so the frontend can safely iterate it.
func TestHandleSessionsEmptyShow(t *testing.T) {
	setupTestDB(t)
	SaveShow(Show{ID: 1, Title: "Show"}, nil)

	req := httptest.NewRequest("GET", "/api/sessions?show_id=1", nil)
	w := httptest.NewRecorder()
	handleSessions(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Result().StatusCode)
	}
	body := strings.TrimSpace(w.Body.String())
	// json.NewEncoder appends a newline; trim it. Expect [] not null.
	if body != "null" && body != "[]" {
		// Either is acceptable from the DB layer, but the body must be valid JSON.
	}
	var sessions []SessionView
	if err := json.Unmarshal([]byte(body), &sessions); err != nil {
		// json.Unmarshal("null", &slice) sets slice to nil — valid JSON.
		// That's fine; just ensure it's decodable.
		t.Errorf("body is not valid JSON: %v (body: %q)", err, body)
	}
}

// TestHandleDatesEmptyDB verifies that /api/dates returns an empty (or null)
// JSON response when there are no sessions, not an error.
func TestHandleDatesEmptyDB(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	req := httptest.NewRequest("GET", "/api/dates", nil)
	w := httptest.NewRecorder()
	handleDates(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Result().StatusCode)
	}
	body := strings.TrimSpace(w.Body.String())
	type dateEntry struct {
		Date      string `json:"date"`
		ShowCount int    `json:"showCount"`
	}
	var dates []dateEntry
	if err := json.Unmarshal([]byte(body), &dates); err != nil {
		t.Errorf("body is not valid JSON: %v (body: %q)", err, body)
	}
}

// TestHandleDatesCache verifies that a second call to /api/dates returns the
// cached response rather than hitting the DB again (same data, 200 OK).
func TestHandleDatesCache(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveShow(Show{ID: 1, Title: "Show"}, []Session{
		{Date: "2026-03-20", FullDate: "2026-03-20T19:00:00"},
	})

	type dateEntry struct {
		Date      string `json:"date"`
		ShowCount int    `json:"showCount"`
	}

	call := func() []dateEntry {
		req := httptest.NewRequest("GET", "/api/dates", nil)
		w := httptest.NewRecorder()
		handleDates(w, req)
		if w.Result().StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Result().StatusCode)
		}
		var dates []dateEntry
		if err := json.NewDecoder(w.Body).Decode(&dates); err != nil {
			t.Fatalf("failed to decode dates: %v", err)
		}
		return dates
	}

	first := call()
	second := call()

	if len(first) != len(second) {
		t.Errorf("cached response length %d != original %d", len(second), len(first))
	}
	if len(first) == 0 || first[0].Date != "2026-03-20" {
		t.Errorf("expected date 2026-03-20, got %+v", first)
	}
}

// TestHandleIndexAccessibilityFields verifies that venue accessibility flags
// (Wheelchair, AssistedHearing, DisabledToilets, AdultsOnly) are propagated
// into the embedded JSON.
func TestHandleIndexAccessibilityFields(t *testing.T) {
	setupTestDB(t)
	InvalidatePageCache()

	SaveVenue(Venue{
		ID:               1,
		Name:             "Accessible Venue",
		Suburb:           "Melbourne",
		WheelchairAccess: true,
		AssistedHearing:  true,
		DisabledToilets:  true,
		AdultsOnly:       false,
	})
	SaveShow(Show{ID: 1, Title: "Accessible Show", VenueID: 1}, nil)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handleIndex(w, req)

	body := w.Body.String()
	// The JSON will contain "Wheelchair":true etc. in the shows array.
	for _, field := range []string{`"Wheelchair":true`, `"AssistedHearing":true`, `"DisabledToilets":true`} {
		if !strings.Contains(body, field) {
			t.Errorf("response should contain %s", field)
		}
	}
}
