// ============================================================
// MICF Insights — Filter/Sort Web Worker
// ============================================================

importScripts('./filter.js');

var shows = [];
var workerFilterTypes = {};

self.onmessage = function(e) {
  var msg = e.data;

  if (msg.type === 'init') {
    shows = msg.shows;
    workerFilterTypes = msg.filterTypes;
    for (var i = 0; i < shows.length; i++) {
      prepareShow(shows[i]);
    }
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'query') {
    sortShows(shows, msg.sortKey, msg.sortAsc, msg.userLat, msg.userLng, msg.plannerTimes);
    var result = filterShows(shows, {
      searchQuery: msg.searchQuery,
      selectedDates: msg.selectedDates,
      excludedDates: msg.excludedDates,
      filters: msg.filters,
      filterTypes: workerFilterTypes,
      showFreeOnly: msg.showFreeOnly,
      priceMin: msg.priceMin,
      priceMax: msg.priceMax,
      planDate: msg.planDate,
    });
    self.postMessage({ type: 'result', shows: result, seq: msg.seq });
    return;
  }
};
