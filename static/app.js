// ============================================================
// MICF Insights — Entry Point
// ============================================================

import { COLUMNS } from './columns.js';
import { state, dom, LS, lsGet, lsSet, lsGetRaw } from './state.js';
import { $ } from './utils.js';
import { renderAll, updateSearchClear } from './render.js';
import { bindEvents, updateLocationBtn, updateDensityBtn } from './events.js';
import { buildCalendar, updateDateBtn } from './calendar.js';
import { initWorker, requestFilter, registerSW } from './worker-bridge.js';

function init() {
  // Grab embedded data
  var data = window.__DATA__ || {};
  state.shows = data.shows || [];
  state.totalShows = data.totalShows || state.shows.length;
  state.searchQuery = data.search || '';
  state.filterOptions.Suburb = (data.suburbs || []).sort();
  state.filterOptions.Region = (data.regions || []).sort();
  state.filterOptions.Status = (data.statuses || []).sort();

  // Load preferences
  state.density = lsGetRaw(LS.density, 'compact');
  state.userLat = parseFloat(localStorage.getItem(LS.lat)) || 0;
  state.userLng = parseFloat(localStorage.getItem(LS.lng)) || 0;
  state.userSuburb = localStorage.getItem(LS.suburb) || '';
  state.useImperial = localStorage.getItem(LS.imperial) === 'true';
  state.selectedDates = lsGet(LS.dates, []);
  state._selectedSet = new Set(state.selectedDates);
  state.excludedDates = lsGet(LS.excludedDates, []);
  state._excludedSet = new Set(state.excludedDates);
  state.showFreeOnly = lsGet(LS.freeOnly, false);
  state.priceMin = lsGet(LS.priceMin, 0) || 0;
  state.priceMax = lsGet(LS.priceMax, 0) || 0;
  state.plan = lsGet(LS.plan, []);
  state.planDate = lsGetRaw(LS.planDate, '');

  // Column visibility
  var defaultVis = {};
  COLUMNS.forEach(function(c) { defaultVis[c.key] = c.visible; });
  state.colVisible = lsGet(LS.columns, defaultVis);

  // Column widths
  var savedWidths = lsGet(LS.widths, {});
  var widths = {};
  COLUMNS.forEach(function(c) { widths[c.key] = savedWidths[c.key] || c.width; });
  state.colWidths = widths;

  // Filters
  COLUMNS.forEach(function(c) { state.filters[c.key] = ''; });

  // Precompute search and date fields
  state.shows.forEach(function(show) {
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
  });

  // Cache DOM refs
  dom.body = document.body;
  dom.search = $('#search-input');
  dom.colgroup = $('#colgroup');
  dom.headerRow = $('#header-row');
  dom.filterRow = $('#filter-row');
  dom.tbody = $('#tbody');
  dom.table = $('#data-table');
  dom.footerCount = $('#footer-count');
  dom.footerTotal = $('#footer-total');
  dom.footerPills = $('#footer-pills');
  dom.main = $('#main-scroll');
  dom.locationBtn = $('#location-btn');
  dom.unitBtn = $('#unit-btn');
  dom.dateBtn = $('#date-btn');
  dom.densityBtn = $('#density-btn');
  dom.searchClear = $('#search-clear');

  // Apply density
  dom.body.className = 'density-' + state.density;

  // Set search value
  if (state.searchQuery) dom.search.value = state.searchQuery;
  updateSearchClear();

  // Update button states
  updateLocationBtn();
  updateDensityBtn();
  updateDateBtn();

  // Restore Free filter button state
  if (state.showFreeOnly) {
    var freeBtn = $('#free-filter-btn');
    if (freeBtn) freeBtn.classList.add('active');
  }

  // Restore price inputs
  if (state.priceMin) {
    var pmin = $('#price-min-input');
    if (pmin) pmin.value = state.priceMin;
  }
  if (state.priceMax) {
    var pmax = $('#price-max-input');
    if (pmax) pmax.value = state.priceMax;
  }

  // Bind events
  bindEvents();

  // Render structure first so headers are visible before data arrives
  renderAll();
  // Then apply initial filter (may trigger worker if ready, otherwise sync)
  requestFilter(false);

  // Start worker (progressive enhancement)
  initWorker();

  // Register service worker
  registerSW();

  // Fetch calendar data
  fetch('/api/dates')
    .then(function(r) { return r.json(); })
    .then(function(data) { buildCalendar(data); })
    .catch(function() {});
}

document.addEventListener('DOMContentLoaded', init);
