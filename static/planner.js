// ============================================================
// MICF Insights — Day Planner Logic
// ============================================================

import { state, LS, lsSet, lsGet } from './state.js';
import { escapeHTML } from './utils.js';
import { requestFilter } from './worker-bridge.js';
import { renderPlannerCal, refreshPlannerCalSelection } from './calendar.js';

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

// Returns conflict details or null.
// { conflict: planItem, travelMins: N, gapMins: N }
// gapMins: actual minutes between the two shows (negative = they overlap in time)
export function conflictInfo(candidate, plan) {
  var cStart = new Date(candidate.fullDate).getTime();
  var cEnd = cStart + (candidate.duration || 60) * 60000;
  for (var i = 0; i < plan.length; i++) {
    var p = plan[i];
    var pStart = new Date(p.fullDate).getTime();
    var pEnd = pStart + (p.duration || 60) * 60000;
    var travel = travelTime(candidate, p);
    var travelMs = travel * 60000;
    if (cStart < pEnd + travelMs && cEnd + travelMs > pStart) {
      // Compute gap between the two shows (whichever comes first)
      var gapMs;
      if (cStart >= pEnd) {
        gapMs = cStart - pEnd;          // candidate starts after p ends
      } else if (pStart >= cEnd) {
        gapMs = pStart - cEnd;          // p starts after candidate ends
      } else {
        gapMs = -1;                     // actual overlap
      }
      return {
        conflict: p,
        travelMins: travel,
        gapMins: gapMs < 0 ? -1 : Math.round(gapMs / 60000),
      };
    }
  }
  return null;
}

// Human-readable conflict reason string
export function conflictReason(details) {
  if (!details) return '';
  var name = '\u201c' + details.conflict.title + '\u201d';
  if (details.gapMins < 0) {
    return 'Overlaps with ' + name;
  }
  return 'Only ' + details.gapMins + ' min gap after ' + name +
    ' \u2014 need ~' + details.travelMins + ' min travel';
}

// --- Sort indicator update (inlined to avoid circular dep with render.js) ---

function updateSortIndicatorsInline() {
  var headerRow = document.getElementById('header-row');
  if (!headerRow) return;
  headerRow.querySelectorAll('th[data-key]').forEach(function(th) {
    var key = th.dataset.key;
    var ind = th.querySelector('.sort-indicator');
    if (!ind) return;
    if (key === state.sortKey) {
      ind.textContent = state.sortAsc ? '\u25B2' : '\u25BC';
      ind.classList.add('active');
    } else {
      ind.textContent = '\u21D5';
      ind.classList.remove('active');
    }
  });
}

function switchToPlanTimeSort() {
  if (state.sortKey === 'PlanTime') return;
  state._prevSortKey = state.sortKey;
  state._prevSortAsc = state.sortAsc;
  state.sortKey = 'PlanTime';
  state.sortAsc = true;
  updateSortIndicatorsInline();
}

function restorePrevSort() {
  if (!state._prevSortKey) return;
  state.sortKey = state._prevSortKey;
  state.sortAsc = state._prevSortAsc;
  state._prevSortKey = null;
  updateSortIndicatorsInline();
}

// --- PlannerTimes (showId → fullDate, for PlanTime sort) ---
// Includes all sessions on the selected date so the sort covers every visible row.

function buildPlannerTimes() {
  state.plannerTimes = {};
  for (var id in state.plannerDateSessions) {
    var s = state.plannerDateSessions[id];
    state.plannerTimes[parseInt(id)] = s.fullDate || '9999';
  }
}

// --- Plan add/remove ---

function savePlan() {
  state.plans[state.planDate] = state.plan;
  lsSet(LS.plans, state.plans);
}

export function addToPlan(showId) {
  var sess = state.plannerDateSessions[showId];
  if (!sess || !state.planDate) return;
  state.plan = state.plan.filter(function(p) { return p.showId !== showId; });
  state.plan.push(sess);
  state.plan.sort(function(a, b) { return a.fullDate < b.fullDate ? -1 : 1; });
  buildPlannerTimes();
  savePlan();
  renderPlanner();
  requestFilter(false);
}

export function removeFromPlan(showId) {
  state.plan = state.plan.filter(function(p) { return p.showId !== showId; });
  buildPlannerTimes();
  savePlan();
  renderPlanner();
  requestFilter(false);
}

export function clearDayPlan() {
  state.plan = [];
  buildPlannerTimes();
  savePlan();
  renderPlanner();
  requestFilter(false);
}

// --- Planner button badge ---

export function updatePlannerBtn() {
  var btn = document.getElementById('planner-btn');
  if (!btn) return;
  var n = state.plan.length;
  btn.textContent = n > 0 ? 'Planner (' + n + ')' : 'Planner';
  btn.classList.toggle('active', state.plannerOpen);
}

// --- Open/close ---

export function openPlanner() {
  state.plannerOpen = true;
  document.getElementById('planner-panel').classList.add('open');
  document.getElementById('main-scroll').classList.add('planner-offset');
  renderPlannerCal();
  // Sync plan from the per-date store (in case we're returning to the site)
  state.plan = state.plans[state.planDate] || [];
  buildPlannerTimes();
  updatePlannerBtn();
  if (state.planDate) {
    switchToPlanTimeSort();
    fetchPlannerSessions(state.planDate); // calls requestFilter internally
  } else {
    renderPlanner();
    state._needsFullRender = true;
    requestFilter(false);
  }
}

export function closePlanner() {
  state.plannerOpen = false;
  restorePrevSort();
  document.getElementById('planner-panel').classList.remove('open');
  document.getElementById('main-scroll').classList.remove('planner-offset');
  updatePlannerBtn();
  state._needsFullRender = true;
  requestFilter(false);
}

// --- Date selection ---

export function setPlanDate(date) {
  state.planDate = date;
  lsSet(LS.planDate, date);
  state.plannerDateSessions = {};
  // Load this day's plan (may already have items from a previous visit)
  state.plan = state.plans[date] || [];
  buildPlannerTimes();
  refreshPlannerCalSelection();
  if (date) {
    if (state.plannerOpen) switchToPlanTimeSort();
    fetchPlannerSessions(date); // sets _needsFullRender internally
  } else {
    restorePrevSort();
    state._needsFullRender = true;
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
      buildPlannerTimes();
      renderPlanner();
      state._needsFullRender = true;
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
    timeline.innerHTML = '<div class="planner-empty">No shows planned.<br>' +
      (state.planDate ? 'Click + on a show to add it.' : 'Pick a date to get started.') + '</div>';
    if (summary) summary.textContent = '';
    updatePlannerBtn();
    return;
  }

  var html = '';
  var totalCost = 0;

  for (var i = 0; i < plan.length; i++) {
    var p = plan[i];
    var conflict = i > 0 ? conflictInfo(p, plan.slice(0, i)) : null;

    // Travel gap between items
    if (i > 0) {
      var prev = plan[i - 1];
      var travel = travelTime(prev, p);
      html += '<div class="planner-gap' + (conflict ? ' gap-conflict' : '') + '">' +
        '<span class="planner-gap-line"></span>' +
        '<span class="planner-gap-label">~' + travel + '\u202fmin</span>' +
        '<span class="planner-gap-line"></span>' +
        '</div>';
    }

    var conflictBadge = conflict
      ? ' <span class="badge badge-amber" title="' + escapeHTML(conflictReason(conflict)) + '">\u26a0 Conflict</span>'
      : '';
    var priceTxt = p.isFreeShow
      ? ' <span class="badge badge-emerald">Free</span>'
      : (p.minPrice ? ' $' + p.minPrice.toFixed(0) + (p.maxPrice && p.maxPrice !== p.minPrice ? '\u2013$' + p.maxPrice.toFixed(0) : '') : '');

    if (!p.isFreeShow && p.minPrice) totalCost += p.minPrice;

    html += '<div class="planner-item' + (conflict ? ' planner-conflict' : '') + '">' +
      '<div class="planner-item-time">' + escapeHTML(p.time || '') + '</div>' +
      '<div class="planner-item-info">' +
        '<div class="planner-item-title">' + escapeHTML(p.title) + '</div>' +
        '<div class="planner-item-meta">' + escapeHTML(p.venueName || '') +
          ' \u2022 ' + (p.duration || 60) + '\u202fmin' + priceTxt + conflictBadge + '</div>' +
      '</div>' +
      '<button class="planner-remove-btn" data-show-id="' + p.showId + '">&times;</button>' +
    '</div>';
  }

  timeline.innerHTML = html;

  if (summary) {
    var costTxt = totalCost > 0 ? ' \u2022 ~$' + totalCost.toFixed(0) : '';
    summary.innerHTML = plan.length + ' show' + (plan.length !== 1 ? 's' : '') + costTxt;
  }

  timeline.querySelectorAll('.planner-remove-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      removeFromPlan(parseInt(btn.dataset.showId));
    });
  });

  updatePlannerBtn();
}

// --- Init (called once on page load) ---

export function initPlannerUI() {
  // state.plan already derived from state.plans[state.planDate] in app.js
  buildPlannerTimes();
  updatePlannerBtn();
  renderPlanner();
}
