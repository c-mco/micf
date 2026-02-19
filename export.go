package main

import (
	"archive/zip"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// --- Export types ---

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

// --- Export query helpers ---

func queryShows() ([]exportShow, error) {
	rows, err := db.Query(`
		SELECT COALESCE(id,0), COALESCE(title,''), COALESCE(artist,''), COALESCE(url,''),
			COALESCE(venue_summary,''), COALESCE(dates,''), COALESCE(show_count,''),
			COALESCE(image_url,''), COALESCE(small_image_url,''),
			COALESCE(online_show,0), COALESCE(on_demand_show,0), COALESCE(status,'')
		FROM shows ORDER BY id`)
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
	rows, err := db.Query(`
		SELECT COALESCE(id,0), COALESCE(show_id,0), COALESCE(date,''), COALESCE(time,''),
			COALESCE(full_date,''), COALESCE(is_tight_arse,0), COALESCE(is_sold_out,0),
			COALESCE(cancelled,0), COALESCE(session_id,0), COALESCE(status,''),
			COALESCE(preview,0), COALESCE(laugh_pack,0), COALESCE(extra_show,0),
			COALESCE(has_sign_interpreter,0), COALESCE(show_type,''),
			COALESCE(is_filmed,0), COALESCE(is_relaxed,0)
		FROM sessions ORDER BY show_id, full_date`)
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
	rows, err := db.Query(`
		SELECT COALESCE(id,0), COALESCE(name,''), COALESCE(address,''), COALESCE(suburb,''),
			COALESCE(location,''), COALESCE(capacity,0), COALESCE(wheelchair_access,0),
			COALESCE(disabled_toilets,0), COALESCE(website,''), COALESCE(latitude,0),
			COALESCE(longitude,0), COALESCE(phone_number,''), COALESCE(accessibility_details,''),
			COALESCE(adults_only,0), COALESCE(assisted_hearing,0)
		FROM venues ORDER BY id`)
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

// --- Export handlers ---

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

	// Shows
	f, _ := zw.Create("shows.csv")
	cw := csv.NewWriter(f)
	cw.Write([]string{"id", "title", "artist", "url", "venue_summary", "dates", "show_count", "image_url", "small_image_url", "online_show", "on_demand_show", "status"})
	for _, s := range shows {
		cw.Write([]string{strconv.Itoa(s.ID), s.Title, s.Artist, s.URL, s.VenueSummary, s.Dates, s.ShowCount, s.ImageURL, s.SmallImage, boolStr(s.OnlineShow), boolStr(s.OnDemandShow), s.Status})
	}
	cw.Flush()

	// Sessions
	f, _ = zw.Create("sessions.csv")
	cw = csv.NewWriter(f)
	cw.Write([]string{"id", "show_id", "date", "time", "full_date", "is_tight_arse", "is_sold_out", "cancelled", "session_id", "status", "preview", "laugh_pack", "extra_show", "has_sign_interpreter", "show_type", "is_filmed", "is_relaxed"})
	for _, s := range sessions {
		cw.Write([]string{strconv.Itoa(s.ID), strconv.Itoa(s.ShowID), s.Date, s.Time, s.FullDate, boolStr(s.IsTightArse), boolStr(s.IsSoldOut), boolStr(s.Cancelled), strconv.Itoa(s.SessionID), s.Status, boolStr(s.Preview), boolStr(s.LaughPack), boolStr(s.ExtraShow), boolStr(s.HasSignInterpreter), s.ShowType, boolStr(s.IsFilmed), boolStr(s.IsRelaxed)})
	}
	cw.Flush()

	// Venues
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
		cell := cellRef(i+1, 1)
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
		cell := cellRef(i+1, 1)
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
		cell := cellRef(i+1, 1)
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
	tmpFile, err := os.CreateTemp("", "micf-export-*.db")
	if err != nil {
		http.Error(w, "Failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	if _, err = db.Exec("VACUUM INTO ?", tmpPath); err != nil {
		http.Error(w, "Failed to create database copy", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/x-sqlite3")
	w.Header().Set("Content-Disposition", `attachment; filename="micf.db"`)
	http.ServeFile(w, r, tmpPath)
}

// --- Helpers ---

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func cellRef(col, row int) string {
	s, _ := excelize.CoordinatesToCellName(col, row)
	return s
}
