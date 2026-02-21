// ============================================================
// MICF Insights — Worker Bridge
// ============================================================

import { COLUMNS } from './columns.js';
import { state, dom } from './state.js';
import { renderAll, renderBody } from './render.js';

export function initWorker() {
  try {
    state.worker = new Worker('/static/worker.js');
    var filterTypes = {};
    COLUMNS.forEach(function(c) { filterTypes[c.key] = c.filter; });

    state.worker.onmessage = function(e) {
      var msg = e.data;
      if (msg.type === 'ready') {
        state.workerReady = true;
        return;
      }
      if (msg.type === 'result') {
        if (msg.seq !== state._filterSeq) return;
        state.filteredShows = msg.shows;
        if (state._pendingResetScroll && dom.main) {
          dom.main.scrollTop = 0;
        }
        if (state._needsFullRender) {
          state._needsFullRender = false;
          renderAll();
        } else {
          renderBody();
        }
      }
    };

    state.worker.postMessage({
      type: 'init',
      shows: state.shows,
      filterTypes: filterTypes,
    });
  } catch (e) {
    // Worker not supported — sync fallback already in place
  }
}

export function requestFilter(resetScroll) {
  state._filterSeq++;
  if (state.workerReady) {
    state._pendingResetScroll = resetScroll;
    state.worker.postMessage({
      type: 'query',
      seq: state._filterSeq,
      sortKey: state.sortKey,
      sortAsc: state.sortAsc,
      searchQuery: state.searchQuery,
      selectedDates: state.selectedDates,
      excludedDates: state.excludedDates,
      filters: state.filters,
      userLat: state.userLat,
      userLng: state.userLng,
      showFreeOnly: state.showFreeOnly,
      priceMin: state.priceMin,
      priceMax: state.priceMax,
      planDate: state.plannerOpen ? state.planDate : '',
      plannerTimes: state.plannerTimes,
    });
  } else {
    syncFilterSort();
    if (resetScroll && dom.main) dom.main.scrollTop = 0;
    if (state._needsFullRender) {
      state._needsFullRender = false;
      renderAll();
    } else {
      renderBody();
    }
  }
}

// Sync fallback when worker is not available
function syncFilterSort() {
  var key = state.sortKey;
  var asc = state.sortAsc;
  var plannerTimes = state.plannerTimes;
  state.shows.sort(function(a, b) {
    var v1, v2;
    if (key === 'PlanTime') {
      v1 = (plannerTimes && plannerTimes[a.ID]) || '9999';
      v2 = (plannerTimes && plannerTimes[b.ID]) || '9999';
    } else {
      v1 = a[key]; v2 = b[key];
    }
    if (typeof v1 === 'boolean') { v1 = v1 ? 1 : 0; v2 = v2 ? 1 : 0; }
    if (typeof v1 === 'string') { v1 = v1.toLowerCase(); v2 = (v2 || '').toLowerCase(); }
    if (v1 == null) v1 = '';
    if (v2 == null) v2 = '';
    if (asc) return v1 > v2 ? 1 : v1 < v2 ? -1 : 0;
    return v1 < v2 ? 1 : v1 > v2 ? -1 : 0;
  });

  // Use the same filter logic as the shared module (inlined to avoid ES module import issues in sync path)
  var q = (state.searchQuery || '').toLowerCase().trim();
  var selectedDates = state.selectedDates;
  var excludedDates = state.excludedDates;
  var hasDateFilter = selectedDates.length > 0;
  var hasExcludeFilter = excludedDates.length > 0;

  var activeFilters = [];
  COLUMNS.forEach(function(col) {
    var f = state.filters[col.key];
    if (!f) return;
    activeFilters.push({ key: col.key, type: col.filter, value: f, lower: f.toLowerCase() });
  });
  var hasColFilters = activeFilters.length > 0;

  state.filteredShows = state.shows.filter(function(show) {
    if (q && show._haystack.indexOf(q) === -1) return false;

    // Exclude only if show has sessions on EVERY excluded date
    if (hasExcludeFilter) {
      var allExcluded = true;
      for (var d = 0; d < excludedDates.length; d++) {
        if (!show._dateSet[excludedDates[d]]) { allExcluded = false; break; }
      }
      if (allExcluded) return false;
    }

    if (hasDateFilter) {
      var match = false;
      for (var i = 0; i < show._dates.length; i++) {
        if (state._selectedSet.has(show._dates[i])) { match = true; break; }
      }
      if (!match) return false;
    }

    if (hasColFilters) {
      for (var i = 0; i < activeFilters.length; i++) {
        var af = activeFilters[i];
        if (af.type === 'text') {
          if (String(show[af.key] || '').toLowerCase().indexOf(af.lower) === -1) return false;
        } else if (af.type === 'select') {
          if (show[af.key] !== af.value) return false;
        } else if (af.type === 'bool') {
          if (af.value === 'yes' && !show[af.key]) return false;
          if (af.value === 'no' && show[af.key]) return false;
        }
      }
    }

    if (state.showFreeOnly && !show.IsFree) return false;
    if (!show.IsFree) {
      if (state.priceMin > 0 && show.MaxPrice < state.priceMin) return false;
      if (state.priceMax > 0 && show.MinPrice > state.priceMax) return false;
    }
    if (state.plannerOpen && state.planDate && show._dateSet && !show._dateSet[state.planDate]) return false;

    return true;
  });
}

export function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
}
