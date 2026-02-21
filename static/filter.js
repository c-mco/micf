// ============================================================
// MICF Insights — Shared Filter & Sort Logic
// Used by both the main thread (app.js) and the web worker.
// ============================================================

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

// --- Filtering ---

function filterShows(shows, params) {
  var q = (params.searchQuery || '').toLowerCase().trim();
  var selectedDates = params.selectedDates || [];
  var excludedDates = params.excludedDates || [];
  var hasDateFilter = selectedDates.length > 0;
  var hasExcludeFilter = excludedDates.length > 0;
  var filterTypes = params.filterTypes || {};
  var showFreeOnly = params.showFreeOnly || false;
  var priceMin = params.priceMin || 0;
  var priceMax = params.priceMax || 0;
  var planDate = params.planDate || '';

  // Build lookup objects for dates
  var dateSet = {};
  for (var i = 0; i < selectedDates.length; i++) dateSet[selectedDates[i]] = true;
  var excludeSet = {};
  for (var i = 0; i < excludedDates.length; i++) excludeSet[excludedDates[i]] = true;

  // Pre-collect active column filters
  var activeFilters = [];
  var filters = params.filters || {};
  for (var key in filters) {
    var val = filters[key];
    if (!val) continue;
    var type = filterTypes[key] || 'text';
    activeFilters.push({ key: key, type: type, value: val, lower: val.toLowerCase() });
  }
  var hasColFilters = activeFilters.length > 0;

  var result = [];
  for (var i = 0; i < shows.length; i++) {
    var show = shows[i];

    // Global search
    if (q && show._haystack.indexOf(q) === -1) continue;

    // Check EXCLUDE: only exclude if show has sessions on EVERY excluded date
    if (hasExcludeFilter) {
      var allExcluded = true;
      for (var d = 0; d < excludedDates.length; d++) {
        if (!show._dateSet[excludedDates[d]]) { allExcluded = false; break; }
      }
      if (allExcluded) continue;
    }

    // Check INCLUDE: show appears if it has a session on ANY included date
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

    // Free only filter
    if (showFreeOnly && !show.IsFree) continue;

    // Price range filter (free shows always pass)
    if (!show.IsFree) {
      if (priceMin > 0 && show.MaxPrice < priceMin) continue;
      if (priceMax > 0 && show.MinPrice > priceMax) continue;
    }

    // Planner date filter
    if (planDate && show._dateSet && !show._dateSet[planDate]) continue;

    result.push(show);
  }

  return result;
}

// --- Sorting ---

function stripArticle(s) {
  return (s || '').replace(/^(a |an |the )/i, '');
}

function sortShows(shows, key, asc, userLat, userLng, plannerTimes) {
  shows.sort(function(a, b) {
    var v1, v2;
    if (key === 'PlanTime') {
      v1 = (plannerTimes && plannerTimes[a.ID]) || '9999';
      v2 = (plannerTimes && plannerTimes[b.ID]) || '9999';
    } else if (key === 'Distance') {
      v1 = distanceKm(a, userLat, userLng);
      v2 = distanceKm(b, userLat, userLng);
    } else if (key === 'Title') {
      v1 = stripArticle(a.Title).toLowerCase();
      v2 = stripArticle(b.Title).toLowerCase();
    } else if (key === 'Artist') {
      v1 = (a.SortingTitle || a.Artist || '').toLowerCase();
      v2 = (b.SortingTitle || b.Artist || '').toLowerCase();
    } else {
      v1 = a[key]; v2 = b[key];
      if (typeof v1 === 'boolean') { v1 = v1 ? 1 : 0; v2 = v2 ? 1 : 0; }
      if (typeof v1 === 'string') { v1 = v1.toLowerCase(); v2 = (v2 || '').toLowerCase(); }
      if (v1 == null) v1 = '';
      if (v2 == null) v2 = '';
    }
    if (asc) return v1 > v2 ? 1 : v1 < v2 ? -1 : 0;
    return v1 < v2 ? 1 : v1 > v2 ? -1 : 0;
  });
}

// --- Precompute helpers ---

function prepareShow(show) {
  show._haystack = (
    (show.Title || '') + ' ' +
    (show.Artist || '') + ' ' +
    (show.VenueName || '') + ' ' +
    (show.Suburb || '') + ' ' +
    (show.Region || '')
  ).toLowerCase();
  show._dates = show.SessionDates ? show.SessionDates.split(',') : [];
  show._dateSet = {};
  for (var i = 0; i < show._dates.length; i++) {
    show._dateSet[show._dates[i]] = true;
  }
  // Computed field used by Price column sort
  show.Price = show.IsFree ? 0 : (show.MinPrice || 9999);
}

// --- Exports ---
// Works as both ES module and classic script (for worker importScripts)

if (typeof exports !== 'undefined') {
  // Node.js (for testing)
  exports.filterShows = filterShows;
  exports.sortShows = sortShows;
  exports.prepareShow = prepareShow;
  exports.distanceKm = distanceKm;
  exports.haversine = haversine;
} else if (typeof self !== 'undefined' && typeof self.importScripts === 'function') {
  // Web Worker
  self.filterShows = filterShows;
  self.sortShows = sortShows;
  self.prepareShow = prepareShow;
  self.distanceKm = distanceKm;
}
