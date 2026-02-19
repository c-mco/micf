// ============================================================
// MICF Insights — Utility Functions
// ============================================================

export function $(sel) { return document.querySelector(sel); }
export function $$(sel) { return document.querySelectorAll(sel); }

export function debounce(fn, ms) {
  var timer;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}

export function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toggleClass(sel, cls, on) {
  var el = document.querySelector(sel);
  if (el) { if (on) el.classList.add(cls); else el.classList.remove(cls); }
}

export function distanceDisplay(show, state) {
  if (!state.userLat || !show.Lat) return '-';
  var km = distanceKmLocal(show, state);
  return state.useImperial ? (km * 0.621371).toFixed(1) + ' mi' : km.toFixed(1) + ' km';
}

export function distanceKmLocal(show, state) {
  if (!state.userLat || !show.Lat) return 9999;
  return haversineLocal(state.userLat, state.userLng, show.Lat, show.Lng);
}

function haversineLocal(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function directionsUrl(show) {
  if (show.Lat && show.Lng) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + show.Lat + ',' + show.Lng;
  }
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent((show.Venue || show.VenueName) + ', Melbourne, Victoria');
}
