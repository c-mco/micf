/**
 * Playwright global setup — creates a deterministic SQLite test database at
 * /tmp/micf_test.db so the E2E tests run against known, stable data.
 *
 * Schema mirrors db.go (base tables + all migrations applied inline).
 *
 * Test data
 * ─────────
 * Venues
 *   1  The Forum          Melbourne  CBD   wheelchair+hearing
 *   2  Southbank Theatre  Southbank  South (no special access)
 *   3  The Night Owl      Fitzroy    North adults_only
 *
 * Shows / sessions (dates all in MICF 2026 window)
 *   1  "The Comedian"         2026-03-20 21 22          venue 1
 *   2  "Single Night Special" 2026-03-20 only           venue 2
 *   3  "Weekend Warrior"      2026-03-21 22             venue 3 (adults only)
 *   4  "Late Night"           2026-03-22 23  tight-arse venue 1
 *   5  "Acoustic Set"         2026-03-21 only  sign-interp+relaxed  venue 1
 *
 * Date-filter expectations
 *   Exclude 2026-03-20  → shows 1 & 2 hidden, 3 & 4 & 5 visible
 *   Include 2026-03-20  → shows 1 & 2 visible, 3 & 4 & 5 hidden
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const TEST_DB = '/tmp/micf_test.db';
export const TEST_PORT = 8081;

export default async function globalSetup() {
  // Remove stale DB and any WAL/SHM journal files from a previous run
  for (const ext of ['', '-wal', '-shm']) {
    const p = TEST_DB + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const db = new Database(TEST_DB);

  // Full schema — mirrors db.go base tables + all migrations applied inline.
  // Keeping this in sync with db.go avoids a race between InitDB ALTER TABLE
  // migrations and the first incoming HTTP request during test startup.
  db.exec(`
    CREATE TABLE IF NOT EXISTS venues (
      id                    INTEGER PRIMARY KEY,
      name                  TEXT,
      address               TEXT,
      suburb                TEXT,
      location              TEXT,
      capacity              INTEGER,
      wheelchair_access     BOOLEAN,
      disabled_toilets      BOOLEAN,
      website               TEXT,
      latitude              REAL,
      longitude             REAL,
      phone_number          TEXT,
      accessibility_details TEXT,
      adults_only           BOOLEAN,
      assisted_hearing      BOOLEAN,
      box_office            BOOLEAN,
      booking_phone_number  TEXT,
      geocode_attempted     BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS shows (
      id               INTEGER PRIMARY KEY,
      title            TEXT,
      artist           TEXT,
      url              TEXT,
      venue_summary    TEXT,
      dates            TEXT,
      show_count       TEXT,
      image_url        TEXT,
      small_image_url  TEXT,
      online_show      BOOLEAN,
      on_demand_show   BOOLEAN,
      status           TEXT,
      venue_id         INTEGER,
      large_image_url  TEXT,
      description      TEXT,
      duration         INTEGER,
      content_warnings TEXT,
      price_range      TEXT,
      tags             TEXT,
      guide_image_url  TEXT,
      video_embed_url  TEXT,
      red61_show_id    TEXT,
      availability_level TEXT,
      sorting_title    TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id               INTEGER,
      date                  TEXT,
      time                  TEXT,
      full_date             TEXT,
      is_tight_arse         BOOLEAN DEFAULT 0,
      is_sold_out           BOOLEAN DEFAULT 0,
      cancelled             BOOLEAN DEFAULT 0,
      session_id            INTEGER,
      status                TEXT,
      preview               BOOLEAN DEFAULT 0,
      laugh_pack            BOOLEAN DEFAULT 0,
      extra_show            BOOLEAN DEFAULT 0,
      has_sign_interpreter  BOOLEAN DEFAULT 0,
      show_type             TEXT,
      is_filmed             BOOLEAN DEFAULT 0,
      is_relaxed            BOOLEAN DEFAULT 0,
      performance_ref       TEXT,
      availability_level    TEXT,
      availability_percentage INTEGER,
      min_price             REAL,
      max_price             REAL,
      is_free_show          BOOLEAN DEFAULT 0,
      ticket_types_json     TEXT,
      venue_id              INTEGER,
      FOREIGN KEY(show_id) REFERENCES shows(id)
    );

    CREATE TABLE IF NOT EXISTS session_history (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id              INTEGER,
      show_id                 INTEGER,
      scraped_at              TEXT,
      availability_percentage INTEGER,
      availability_level      TEXT,
      is_sold_out             BOOLEAN,
      min_price               REAL,
      max_price               REAL,
      status                  TEXT
    );

    CREATE TABLE IF NOT EXISTS show_history (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id            INTEGER,
      scraped_at         TEXT,
      status             TEXT,
      availability_level TEXT
    );
  `);

  // ── Venues ────────────────────────────────────────────────────────────────
  const insertVenue = db.prepare(`
    INSERT INTO venues
      (id, name, address, suburb, location, capacity,
       wheelchair_access, disabled_toilets, assisted_hearing, adults_only,
       latitude, longitude)
    VALUES
      (@id, @name, @address, @suburb, @location, @capacity,
       @wheelchair_access, @disabled_toilets, @assisted_hearing, @adults_only,
       @latitude, @longitude)
  `);

  insertVenue.run({ id: 1, name: 'The Forum', address: '154 Flinders St', suburb: 'Melbourne', location: 'CBD', capacity: 400, wheelchair_access: 1, disabled_toilets: 1, assisted_hearing: 1, adults_only: 0, latitude: -37.8181, longitude: 144.9673 });
  insertVenue.run({ id: 2, name: 'Southbank Theatre', address: '140 Southbank Blvd', suburb: 'Southbank', location: 'South', capacity: 250, wheelchair_access: 0, disabled_toilets: 0, assisted_hearing: 0, adults_only: 0, latitude: -37.8247, longitude: 144.9631 });
  insertVenue.run({ id: 3, name: 'The Night Owl', address: '50 Smith St', suburb: 'Fitzroy', location: 'North', capacity: 100, wheelchair_access: 0, disabled_toilets: 0, assisted_hearing: 0, adults_only: 1, latitude: -37.7997, longitude: 144.9782 });

  // ── Shows ─────────────────────────────────────────────────────────────────
  const insertShow = db.prepare(`
    INSERT INTO shows
      (id, title, artist, url, venue_summary, venue_id, status, dates, description, duration)
    VALUES
      (@id, @title, @artist, @url, @venue_summary, @venue_id, @status, @dates, @description, @duration)
  `);

  insertShow.run({ id: 1, title: 'The Comedian', artist: 'Alex Rivers', url: '/shows/the-comedian', venue_summary: 'The Forum', venue_id: 1, status: 'On Sale', dates: '20-22 Mar', description: 'Stand-up gold.', duration: 60 });
  insertShow.run({ id: 2, title: 'Single Night Special', artist: 'Sam Blue', url: '/shows/single-night-special', venue_summary: 'Southbank Theatre', venue_id: 2, status: 'On Sale', dates: '20 Mar', description: 'One night only.', duration: 75 });
  insertShow.run({ id: 3, title: 'Weekend Warrior', artist: 'Jordan Marsh', url: '/shows/weekend-warrior', venue_summary: 'The Night Owl', venue_id: 3, status: 'On Sale', dates: '21-22 Mar', description: 'Adults only laughs.', duration: 55 });
  insertShow.run({ id: 4, title: 'Late Night', artist: 'Casey Voss', url: '/shows/late-night', venue_summary: 'The Forum', venue_id: 1, status: 'On Sale', dates: '22-23 Mar', description: 'Late night laughs.', duration: 65 });
  insertShow.run({ id: 5, title: 'Acoustic Set', artist: 'Riley Park', url: '/shows/acoustic-set', venue_summary: 'The Forum', venue_id: 1, status: 'Selling Fast', dates: '21 Mar', description: 'Musical comedy.', duration: 50 });

  // ── Sessions ──────────────────────────────────────────────────────────────
  const insertSession = db.prepare(`
    INSERT INTO sessions
      (show_id, date, time, full_date,
       is_tight_arse, is_sold_out, has_sign_interpreter, is_relaxed, preview,
       session_id, min_price, max_price, is_free_show, availability_percentage)
    VALUES
      (@show_id, @date, @time, @full_date,
       @is_tight_arse, @is_sold_out, @has_sign_interpreter, @is_relaxed, @preview,
       @session_id, @min_price, @max_price, @is_free_show, @availability_percentage)
  `);

  let nextSessionId = 1;
  const sess = (show_id: number, date: string, time: string, overrides: Record<string, any> = {}) =>
    insertSession.run({
      show_id, date, time,
      full_date: `${date}T${time}:00`,
      is_tight_arse: 0, is_sold_out: 0, has_sign_interpreter: 0, is_relaxed: 0, preview: 0,
      session_id: nextSessionId++,
      min_price: 30, max_price: 35,
      is_free_show: 0, availability_percentage: 80,
      ...overrides,
    });

  // Show 1 — three days, $30-$35, normal availability
  sess(1, '2026-03-20', '19:00');
  sess(1, '2026-03-21', '19:00');
  sess(1, '2026-03-22', '19:00');

  // Show 2 — single day, $45-$50
  sess(2, '2026-03-20', '20:00', { min_price: 45, max_price: 50 });

  // Show 3 — weekend, $20 flat, LOW availability (Hot badge <20%)
  sess(3, '2026-03-21', '21:00', { min_price: 20, max_price: 20, availability_percentage: 10 });
  sess(3, '2026-03-22', '21:00', { min_price: 20, max_price: 20, availability_percentage: 10 });

  // Show 4 — late night, tight-arse $25, MEDIUM availability (Filling badge 20-40%)
  sess(4, '2026-03-22', '22:00', { is_tight_arse: 1, min_price: 25, max_price: 25, availability_percentage: 30 });
  sess(4, '2026-03-23', '22:00', { is_tight_arse: 1, min_price: 25, max_price: 25, availability_percentage: 30 });

  // Show 5 — FREE, sign interpreter + relaxed
  sess(5, '2026-03-21', '18:00', { has_sign_interpreter: 1, is_relaxed: 1, min_price: 0, max_price: 0, is_free_show: 1 });

  db.close();
  console.log(`[global-setup] Test DB created at ${TEST_DB}`);
}
