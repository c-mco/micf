const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterShows, sortShows, prepareShow, distanceKm } = require('./filter.js');

// Helper: create a show and prepareShow it
function makeShow(overrides) {
  var show = Object.assign({
    ID: 1,
    Title: 'Test Show',
    Artist: 'Test Artist',
    VenueName: 'Test Venue',
    Suburb: 'Melbourne',
    Region: 'CBD',
    SessionDates: '',
    HasTightArse: false,
    Wheelchair: false,
    Status: 'On Sale',
    Count: 5,
    Lat: 0,
    Lng: 0,
  }, overrides);
  prepareShow(show);
  return show;
}

function baseParams(overrides) {
  return Object.assign({
    searchQuery: '',
    selectedDates: [],
    excludedDates: [],
    filters: {},
    filterTypes: {},
  }, overrides);
}

// --- Date exclusion tests ---

describe('Date exclusion', function() {
  it('should NOT exclude a show that has sessions on only SOME excluded dates', function() {
    var show = makeShow({ SessionDates: '2025-03-28,2025-03-29,2025-03-30' });
    var result = filterShows([show], baseParams({
      excludedDates: ['2025-03-28', '2025-04-01'],
    }));
    assert.equal(result.length, 1, 'Show with sessions on only some excluded dates should remain');
  });

  it('should exclude a show that has sessions on ALL excluded dates', function() {
    var show = makeShow({ SessionDates: '2025-03-28,2025-03-29' });
    var result = filterShows([show], baseParams({
      excludedDates: ['2025-03-28', '2025-03-29'],
    }));
    assert.equal(result.length, 0, 'Show with sessions on every excluded date should be excluded');
  });

  it('should not exclude when no dates are excluded', function() {
    var show = makeShow({ SessionDates: '2025-03-28' });
    var result = filterShows([show], baseParams({ excludedDates: [] }));
    assert.equal(result.length, 1);
  });

  it('should not exclude a show with no sessions even if dates are excluded', function() {
    var show = makeShow({ SessionDates: '' });
    var result = filterShows([show], baseParams({
      excludedDates: ['2025-03-28'],
    }));
    assert.equal(result.length, 1, 'Show with no sessions should not be excluded');
  });

  it('should exclude show whose sessions are a superset of excluded dates', function() {
    var show = makeShow({ SessionDates: '2025-03-28,2025-03-29,2025-03-30' });
    var result = filterShows([show], baseParams({
      excludedDates: ['2025-03-28', '2025-03-29'],
    }));
    // Show has sessions on all excluded dates (and more), so it IS excluded
    assert.equal(result.length, 0);
  });
});

// --- Date inclusion tests ---

describe('Date inclusion', function() {
  it('should include show if it has a session on ANY included date', function() {
    var show = makeShow({ SessionDates: '2025-03-28,2025-03-30' });
    var result = filterShows([show], baseParams({
      selectedDates: ['2025-03-28'],
    }));
    assert.equal(result.length, 1);
  });

  it('should exclude show if it has no sessions on included dates', function() {
    var show = makeShow({ SessionDates: '2025-03-29' });
    var result = filterShows([show], baseParams({
      selectedDates: ['2025-03-28'],
    }));
    assert.equal(result.length, 0);
  });

  it('should return all shows when no dates are selected', function() {
    var shows = [
      makeShow({ ID: 1, SessionDates: '2025-03-28' }),
      makeShow({ ID: 2, SessionDates: '2025-03-29' }),
    ];
    var result = filterShows(shows, baseParams());
    assert.equal(result.length, 2);
  });
});

// --- Combined include + exclude ---

describe('Combined include and exclude', function() {
  it('should apply both include and exclude filters', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'A', SessionDates: '2025-03-28,2025-03-29' }),
      makeShow({ ID: 2, Title: 'B', SessionDates: '2025-03-28' }),
      makeShow({ ID: 3, Title: 'C', SessionDates: '2025-03-30' }),
    ];
    var result = filterShows(shows, baseParams({
      selectedDates: ['2025-03-28'],
      excludedDates: ['2025-03-28', '2025-03-29'],
    }));
    // Show A: has session on included date 03-28 (passes include), but has sessions on ALL excluded dates (03-28 and 03-29) → excluded
    // Show B: has session on included date 03-28 (passes include), only has 03-28 not 03-29 → NOT excluded → kept
    // Show C: no session on included date 03-28 → excluded by include filter
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 2);
  });
});

// --- Text search ---

describe('Text search', function() {
  it('should match against _haystack', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'Funny Guy', Artist: 'Bob' }),
      makeShow({ ID: 2, Title: 'Serious Talk', Artist: 'Alice' }),
    ];
    var result = filterShows(shows, baseParams({ searchQuery: 'funny' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });

  it('should match artist name', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'Show A', Artist: 'Alice Springs' }),
      makeShow({ ID: 2, Title: 'Show B', Artist: 'Bob' }),
    ];
    var result = filterShows(shows, baseParams({ searchQuery: 'alice' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });

  it('should be case-insensitive', function() {
    var shows = [makeShow({ ID: 1, Title: 'LOUD SHOW' })];
    var result = filterShows(shows, baseParams({ searchQuery: 'loud' }));
    assert.equal(result.length, 1);
  });

  it('should return all when search is empty', function() {
    var shows = [makeShow({ ID: 1 }), makeShow({ ID: 2 })];
    var result = filterShows(shows, baseParams({ searchQuery: '' }));
    assert.equal(result.length, 2);
  });
});

// --- Column filters ---

describe('Column filters', function() {
  it('should filter by text column', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'Comedy Night' }),
      makeShow({ ID: 2, Title: 'Drama Hour' }),
    ];
    var result = filterShows(shows, baseParams({
      filters: { Title: 'comedy' },
      filterTypes: { Title: 'text' },
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });

  it('should filter by select column (exact match)', function() {
    var shows = [
      makeShow({ ID: 1, Suburb: 'Melbourne' }),
      makeShow({ ID: 2, Suburb: 'Southbank' }),
    ];
    var result = filterShows(shows, baseParams({
      filters: { Suburb: 'Melbourne' },
      filterTypes: { Suburb: 'select' },
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });

  it('should filter by bool column (yes)', function() {
    var shows = [
      makeShow({ ID: 1, HasTightArse: true }),
      makeShow({ ID: 2, HasTightArse: false }),
    ];
    var result = filterShows(shows, baseParams({
      filters: { HasTightArse: 'yes' },
      filterTypes: { HasTightArse: 'bool' },
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });

  it('should filter by bool column (no)', function() {
    var shows = [
      makeShow({ ID: 1, HasTightArse: true }),
      makeShow({ ID: 2, HasTightArse: false }),
    ];
    var result = filterShows(shows, baseParams({
      filters: { HasTightArse: 'no' },
      filterTypes: { HasTightArse: 'bool' },
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 2);
  });

  it('should combine multiple column filters', function() {
    var shows = [
      makeShow({ ID: 1, Suburb: 'Melbourne', HasTightArse: true }),
      makeShow({ ID: 2, Suburb: 'Melbourne', HasTightArse: false }),
      makeShow({ ID: 3, Suburb: 'Southbank', HasTightArse: true }),
    ];
    var result = filterShows(shows, baseParams({
      filters: { Suburb: 'Melbourne', HasTightArse: 'yes' },
      filterTypes: { Suburb: 'select', HasTightArse: 'bool' },
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].ID, 1);
  });
});

// --- Sorting ---

describe('Sorting', function() {
  it('should sort strings ascending', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'Zebra' }),
      makeShow({ ID: 2, Title: 'Apple' }),
      makeShow({ ID: 3, Title: 'Mango' }),
    ];
    sortShows(shows, 'Title', true, 0, 0);
    assert.deepEqual(shows.map(function(s) { return s.Title; }), ['Apple', 'Mango', 'Zebra']);
  });

  it('should sort strings descending', function() {
    var shows = [
      makeShow({ ID: 1, Title: 'Zebra' }),
      makeShow({ ID: 2, Title: 'Apple' }),
    ];
    sortShows(shows, 'Title', false, 0, 0);
    assert.deepEqual(shows.map(function(s) { return s.Title; }), ['Zebra', 'Apple']);
  });

  it('should sort numbers ascending', function() {
    var shows = [
      makeShow({ ID: 1, Count: 10 }),
      makeShow({ ID: 2, Count: 3 }),
      makeShow({ ID: 3, Count: 7 }),
    ];
    sortShows(shows, 'Count', true, 0, 0);
    assert.deepEqual(shows.map(function(s) { return s.Count; }), [3, 7, 10]);
  });

  it('should sort booleans (true first when ascending)', function() {
    var shows = [
      makeShow({ ID: 1, HasTightArse: false }),
      makeShow({ ID: 2, HasTightArse: true }),
      makeShow({ ID: 3, HasTightArse: false }),
    ];
    sortShows(shows, 'HasTightArse', false, 0, 0);
    assert.equal(shows[0].HasTightArse, true);
  });

  it('should sort by distance when key is Distance', function() {
    var shows = [
      makeShow({ ID: 1, Lat: -37.8, Lng: 144.96 }),  // closer
      makeShow({ ID: 2, Lat: -38.0, Lng: 145.5 }),   // farther
    ];
    sortShows(shows, 'Distance', true, -37.81, 144.96);
    assert.equal(shows[0].ID, 1);
  });
});

// --- distanceKm ---

describe('distanceKm', function() {
  it('should return 9999 when no user location', function() {
    var show = makeShow({ Lat: -37.8, Lng: 144.96 });
    assert.equal(distanceKm(show, 0, 0), 9999);
  });

  it('should return 9999 when show has no location', function() {
    var show = makeShow({ Lat: 0, Lng: 0 });
    assert.equal(distanceKm(show, -37.8, 144.96), 9999);
  });

  it('should compute reasonable distance', function() {
    var show = makeShow({ Lat: -37.8136, Lng: 144.9631 });
    var km = distanceKm(show, -37.8, 144.96);
    assert.ok(km > 0 && km < 5, 'Expected small distance for nearby points, got ' + km);
  });
});
