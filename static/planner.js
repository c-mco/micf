// ============================================================
// MICF Insights — Day Planner Logic
// ============================================================

import { state, dom, LS, lsSet } from './state.js';
import { escapeHTML } from './utils.js';
import { requestFilter } from './worker-bridge.js';

// --- Travel time (12 min/km walking, min 10 min) ---

function haversinePlan(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function travelTime(s1, s2) {
  if (!s1.lat || !s2.lat || !s1.lng || !s2.lng) return 15;
  var km = haversinePlan(s1.lat, s1.lng, s2.lat, s2.lng);
  return Math.max(10, Math.ceil(km * 12));
}

// Returns the conflicting planned show, or null
export function conflictInfo(candidate, plan) {
  var cStart = new Date(candidate.fullDate).getTime();
  var cEnd = cStart + (candidate.duration || 60) * 60000;
  for (var i = 0; i < plan.length; i++) {
    var p = plan[i];
    var pStart = new Date(p.fullDate).getTime();
    var pEnd = pStart + (p.duration || 60) * 60000;
    var travel = travelTime(candidate, p) * 60000;
    if (cStart < pEnd + travel && cEnd + travel > pStart) {
      return p;
    }
  }
  return null;
}

// --- Plan add/remove ---

export function addToPlan(showId) {
  var sess = state.plannerDateSessions[showId];
  if (!sess) return;
  // Remove existing entry for same show (replace)
  state.plan = state.plan.filter(function(p) { return p.showId !== showId; });
  state.plan.push(sess);
  // Sort by start time
  state.plan.sort(function(a, b) { return a.fullDate < b.fullDate ? -1 : 1; });
  lsSet(LS.plan, state.plan);
  renderPlanner();
  requestFilter(false);
}

export function removeFromPlan(showId) {
  state.plan = state.plan.filter(function(p) { return p.showId !== showId; });
  lsSet(LS.plan, state.plan);
  renderPlanner();
  requestFilter(false);
}

// --- Open/close ---

export function openPlanner() {
  state.plannerOpen = true;
  document.getElementById('planner-panel').classList.add('open');
  document.getElementById('main-scroll').classList.add('planner-offset');
  populateDateSelect();
  if (state.planDate) {
    fetchPlannerSessions(state.planDate);
  }
  requestFilter(false);
}

export function closePlanner() {
  state.plannerOpen = false;
  document.getElementById('planner-panel').classList.remove('open');
  document.getElementById('main-scroll').classList.remove('planner-offset');
  requestFilter(false);
}

// --- Date select ---

function populateDateSelect() {
  fetch('/api/dates')
    .then(function(r) { return r.json(); })
    .then(function(dates) {
      var sel = document.getElementById('planner-date-select');
      sel.innerHTML = '<option value="">Pick a date...</option>';
      dates.forEach(function(d) {
        var opt = document.createElement('option');
        opt.value = d.date;
        opt.textContent = d.date + ' (' + d.showCount + ')';
        if (d.date === state.planDate) opt.selected = true;
        sel.appendChild(opt);
      });
    })
    .catch(function() {});
}

export function setPlanDate(date) {
  state.planDate = date;
  lsSet(LS.planDate, date);
  state.plannerDateSessions = {};
  if (date) {
    fetchPlannerSessions(date);
  } else {
    renderBody();
    requestFilter(false);
  }
}

function fetchPlannerSessions(date) {
  fetch('/api/sessions-by-date?date=' + encodeURIComponent(date))
    .then(function(r) { return r.json(); })
    .then(function(sessions) {
      state.plannerDateSessions = {};
      sessions.forEach(function(s) {
        state.plannerDateSessions[s.showId] = s;
      });
      renderPlanner();
      requestFilter(false);
    })
    .catch(function() {});
}

// --- Render planner timeline ---

export function renderPlanner() {
  var timeline = document.getElementById('planner-timeline');
  var summary = document.getElementById('planner-summary');
  if (!timeline) return;

  var plan = state.plan;
  if (plan.length === 0) {
    timeline.innerHTML = '<div class="planner-empty">No shows planned yet.<br>Pick a date and click + on a show.</div>';
    if (summary) summary.textContent = '';
    return;
  }

  var html = plan.map(function(p, i) {
    var conflict = null;
    if (i > 0) conflict = conflictInfo(p, plan.slice(0, i));
    var conflictBadge = conflict ? '<span class="badge badge-red" title="Conflicts with ' + escapeHTML(conflict.title) + '">Conflict</span>' : '';
    var priceTxt = p.isFreeShow ? '<span class="badge badge-emerald">Free</span>'
      : (p.minPrice ? '$' + p.minPrice.toFixed(0) + (p.maxPrice && p.maxPrice !== p.minPrice ? '–$' + p.maxPrice.toFixed(0) : '') : '');
    var time = p.fullDate ? p.fullDate.replace('T', ' ').slice(0, 16) : p.time;
    var dur = p.duration || 60;

    return '<div class="planner-item' + (conflict ? ' planner-conflict' : '') + '">' +
      '<div class="planner-item-time">' + escapeHTML(p.time || '') + '</div>' +
      '<div class="planner-item-info">' +
        '<div class="planner-item-title">' + escapeHTML(p.title) + '</div>' +
        '<div class="planner-item-meta">' + escapeHTML(p.venueName || '') + ' &bull; ' + dur + ' min ' + priceTxt + ' ' + conflictBadge + '</div>' +
      '</div>' +
      '<button class="planner-remove-btn" data-show-id="' + p.showId + '">&times;</button>' +
    '</div>';
  }).join('');

  timeline.innerHTML = html;

  if (summary) {
    summary.textContent = plan.length + ' show' + (plan.length !== 1 ? 's' : '') + ' planned';
  }

  // Bind remove buttons
  timeline.querySelectorAll('.planner-remove-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      removeFromPlan(parseInt(btn.dataset.showId));
    });
  });
}
