// ============================================================
// MICF Insights — Filter/Sort Web Worker
//
// Runs filtering and sorting off the main thread so the UI
// never stutters, even with thousands of shows.
// ============================================================

var shows = [];
var filterTypes = {};  // column key → filter type ('text'|'select'|'bool'|'none')

self.onmessage = function(e) {
  var msg = e.data;

  if (msg.type === 'init') {
    shows = msg.shows;
    filterTypes = msg.filterTypes;
    // Precompute search and date fields once
    for (var i = 0; i < shows.length; i++) {
      var s = shows[i];
      s._haystack = (
        (s.Title || '') + ' ' + (s.Artist || '') + ' ' +
        (s.VenueName || '') + ' ' + (s.Suburb || '') + ' ' + (s.Region || '')
      ).toLowerCase();
      s._dates = s.SessionDates ? s.SessionDates.split(',') : [];
    }
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'query') {
    var result = filterAndSort(msg);
    self.postMessage({ type: 'result', shows: result, seq: msg.seq });
    return;
  }
};

// --- Core filter + sort logic ---

function filterAndSort(params) {
  // Sort
  sortShows(params.sortKey, params.sortAsc, params.userLat, params.userLng);

  // Filter
  var q = (params.searchQuery || '').toLowerCase().trim();
  var selectedDates = params.selectedDates || [];
  var excludedDates = params.excludedDates || [];
  var hasDateFilter = selectedDates.length > 0;
  var hasExcludeFilter = excludedDates.length > 0;
  var dateSet = {};
  var excludeSet = {};
  for (var i = 0; i < selectedDates.length; i++) dateSet[selectedDates[i]] = true;
  for (var i = 0; i < excludedDates.length; i++) excludeSet[excludedDates[i]] = true;

  // Pre-collect active column filters
  var activeFilters = [];
  var filters = params.filters || {};
  for (var key in filters) {
    var val = filters[key];
    if (!val) continue;
    activeFilters.push({ key: key, type: filterTypes[key], value: val, lower: val.toLowerCase() });
  }
  var hasColFilters = activeFilters.length > 0;

  var result = [];
  for (var i = 0; i < shows.length; i++) {
    var show = shows[i];

    // Global search
    if (q && show._haystack.indexOf(q) === -1) continue;

    // Check EXCLUDE first (fails faster)
    if (hasExcludeFilter) {
      var isExcluded = false;
      for (var d = 0; d < show._dates.length; d++) {
        if (excludeSet[show._dates[d]]) { isExcluded = true; break; }
      }
      if (isExcluded) continue;
    }

    // Then check INCLUDE (if specified)
    if (hasDateFilter) {
      var dateMatch = false;
      for (var d = 0; d < show._dates.length; d++) {
        if (dateSet[show._dates[d]]) { dateMatch = true; break; }
      }
      if (!dateMatch) continue;
    }

    // Column filters
    if (hasColFilters) {
      var skip = false;
      for (var f = 0; f < activeFilters.length; f++) {
        var af = activeFilters[f];
        if (af.type === 'text') {
          if (String(show[af.key] || '').toLowerCase().indexOf(af.lower) === -1) { skip = true; break; }
        } else if (af.type === 'select') {
          if (show[af.key] !== af.value) { skip = true; break; }
        } else if (af.type === 'bool') {
          if (af.value === 'yes' && !show[af.key]) { skip = true; break; }
          if (af.value === 'no' && show[af.key]) { skip = true; break; }
        }
      }
      if (skip) continue;
    }

    result.push(show);
  }

  return result;
}

function sortShows(key, asc, userLat, userLng) {
  shows.sort(function(a, b) {
    var v1 = a[key], v2 = b[key];
    if (key === 'Distance') {
      v1 = distanceKm(a, userLat, userLng);
      v2 = distanceKm(b, userLat, userLng);
    }
    if (typeof v1 === 'boolean') { v1 = v1 ? 1 : 0; v2 = v2 ? 1 : 0; }
    if (typeof v1 === 'string') { v1 = v1.toLowerCase(); v2 = (v2 || '').toLowerCase(); }
    if (v1 == null) v1 = '';
    if (v2 == null) v2 = '';
    if (asc) return v1 > v2 ? 1 : v1 < v2 ? -1 : 0;
    return v1 < v2 ? 1 : v1 > v2 ? -1 : 0;
  });
}

// --- Distance helpers ---

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceKm(show, userLat, userLng) {
  if (!userLat || !show.Lat) return 9999;
  return haversine(userLat, userLng, show.Lat, show.Lng);
}
