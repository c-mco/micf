// ============================================================
// MICF Insights — Calendar
// ============================================================

import { state, dom, LS, lsSet } from './state.js';
import { $, $$, escapeHTML } from './utils.js';
import { requestFilter } from './worker-bridge.js';

export function buildCalendar(data) {
  var counts = {};
  var maxCount = 0;
  data.forEach(function(d) {
    counts[d.date] = d.showCount;
    if (d.showCount > maxCount) maxCount = d.showCount;
  });
  state.dateShowCounts = counts;

  var q1 = Math.floor(maxCount * 0.33);
  var q2 = Math.floor(maxCount * 0.66);

  var isoKeys = Object.keys(counts).sort();
  if (isoKeys.length === 0) return;

  var firstDate = new Date(isoKeys[0] + 'T00:00:00');
  var lastDate = new Date(isoKeys[isoKeys.length - 1] + 'T00:00:00');

  var todayISO = new Date().toISOString().slice(0, 10);
  var months = [];
  var cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  while (cursor <= lastDate) {
    var year = cursor.getFullYear();
    var month = cursor.getMonth();
    var label = monthNames[month] + ' ' + year;
    var firstDow = new Date(year, month, 1).getDay();
    var offset = firstDow === 0 ? 6 : firstDow - 1;
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var daysHTML = '';
    for (var p = 0; p < offset; p++) daysHTML += '<div></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var count = counts[iso] || 0;
      var selected = state._selectedSet.has(iso);
      var excluded = state._excludedSet.has(iso);
      var cls = 'cal-day';
      if (count > 0) {
        cls += ' has-shows';
        if (selected) {
          cls += ' selected';
        } else if (excluded) {
          cls += ' excluded';
        } else {
          if (count <= q1) cls += ' density-low';
          else if (count <= q2) cls += ' density-med';
          else cls += ' density-high';
        }
      } else {
        cls += ' no-shows';
      }
      if (iso === todayISO) cls += ' today';

      daysHTML += '<div class="' + cls + '" data-iso="' + iso + '">' +
        '<span>' + d + '</span>' +
        (count > 0 ? '<span class="day-count">' + count + '</span>' : '') +
        '</div>';
    }

    months.push(
      '<div class="cal-month">' +
      '<div class="cal-month-label">' + label + '</div>' +
      '<div class="cal-grid" style="margin-bottom:4px">' +
      ['Mo','Tu','We','Th','Fr','Sa','Su'].map(function(d) { return '<div class="cal-weekday">' + d + '</div>'; }).join('') +
      '</div>' +
      '<div class="cal-grid">' + daysHTML + '</div>' +
      '</div>'
    );

    cursor = new Date(year, month + 1, 1);
  }

  var clearBtn = (state.selectedDates.length > 0 || state.excludedDates.length > 0)
    ? '<button class="clear-action" data-action="clear">Clear all</button>'
    : '';

  $('#calendar-content').innerHTML = months.join('') +
    '<div class="cal-help">Click to include \u2022 Ctrl/Cmd+click to exclude</div>' +
    '<div class="cal-actions">' +
    '<button class="quick-action" data-action="weekend">This weekend</button>' +
    '<button class="quick-action" data-action="week">This week</button>' +
    '<div class="flex-grow"></div>' +
    clearBtn +
    '</div>';

  state.calendarMonths = months;
}

export function refreshCalendarSelection() {
  $$('#calendar-panel .cal-day').forEach(function(el) {
    var iso = el.dataset.iso;
    if (!iso) return;
    if (state._selectedSet.has(iso)) {
      el.classList.add('selected');
      el.classList.remove('excluded');
    } else if (state._excludedSet.has(iso)) {
      el.classList.add('excluded');
      el.classList.remove('selected');
    } else {
      el.classList.remove('selected');
      el.classList.remove('excluded');
    }
  });
  var hasDates = state.selectedDates.length > 0 || state.excludedDates.length > 0;
  var clearBtn = $('#calendar-panel [data-action="clear"]');
  if (!clearBtn && hasDates) {
    var calActions = $('#calendar-panel .cal-actions');
    if (calActions) {
      clearBtn = document.createElement('button');
      clearBtn.className = 'clear-action';
      clearBtn.dataset.action = 'clear';
      clearBtn.textContent = 'Clear all';
      calActions.appendChild(clearBtn);
    }
  }
  if (clearBtn) clearBtn.style.display = hasDates ? '' : 'none';
  updateDateBtn();
}

export function toggleDate(iso, isExclude) {
  if (isExclude) {
    if (state._excludedSet.has(iso)) {
      state._excludedSet.delete(iso);
    } else {
      state._excludedSet.add(iso);
      state._selectedSet.delete(iso);
    }
    state.excludedDates = Array.from(state._excludedSet).sort();
    state.selectedDates = Array.from(state._selectedSet).sort();
    lsSet(LS.excludedDates, state.excludedDates);
    lsSet(LS.dates, state.selectedDates);
  } else {
    if (state._selectedSet.has(iso)) {
      state._selectedSet.delete(iso);
    } else {
      state._selectedSet.add(iso);
      state._excludedSet.delete(iso);
    }
    state.selectedDates = Array.from(state._selectedSet).sort();
    state.excludedDates = Array.from(state._excludedSet).sort();
    lsSet(LS.dates, state.selectedDates);
    lsSet(LS.excludedDates, state.excludedDates);
  }
  refreshCalendarSelection();
  requestFilter(false);
}

export function clearDates() {
  state._selectedSet.clear();
  state.selectedDates = [];
  state._excludedSet.clear();
  state.excludedDates = [];
  lsSet(LS.dates, state.selectedDates);
  lsSet(LS.excludedDates, state.excludedDates);
  refreshCalendarSelection();
  requestFilter(true);
}

export function selectThisWeekend() {
  var today = new Date();
  var dow = today.getDay();
  var daysToFri = dow <= 5 ? (5 - dow) : (5 + 7 - dow);
  var fri = new Date(today);
  fri.setDate(today.getDate() + daysToFri);
  for (var i = 0; i < 3; i++) {
    var d = new Date(fri);
    d.setDate(fri.getDate() + i);
    var iso = d.toISOString().slice(0, 10);
    if (state.dateShowCounts[iso]) {
      state._selectedSet.add(iso);
      state._excludedSet.delete(iso);
    }
  }
  state.selectedDates = Array.from(state._selectedSet).sort();
  state.excludedDates = Array.from(state._excludedSet).sort();
  lsSet(LS.dates, state.selectedDates);
  lsSet(LS.excludedDates, state.excludedDates);
  refreshCalendarSelection();
  requestFilter(false);
}

export function selectThisWeek() {
  var today = new Date();
  var dow = today.getDay();
  var daysToMon = dow === 0 ? -6 : 1 - dow;
  var mon = new Date(today);
  mon.setDate(today.getDate() + daysToMon);
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon);
    d.setDate(mon.getDate() + i);
    var iso = d.toISOString().slice(0, 10);
    if (state.dateShowCounts[iso]) {
      state._selectedSet.add(iso);
      state._excludedSet.delete(iso);
    }
  }
  state.selectedDates = Array.from(state._selectedSet).sort();
  state.excludedDates = Array.from(state._excludedSet).sort();
  lsSet(LS.dates, state.selectedDates);
  lsSet(LS.excludedDates, state.excludedDates);
  refreshCalendarSelection();
  requestFilter(false);
}

export function updateDateBtn() {
  var n = state.selectedDates.length;
  dom.dateBtn.textContent = n > 0 ? 'Dates (' + n + ')' : 'Dates';
  if (n > 0) dom.dateBtn.classList.add('active');
  else dom.dateBtn.classList.remove('active');
}

// --- Planner calendar (single-select, no exclude) ---

export function renderPlannerCal() {
  var container = document.getElementById('planner-cal');
  if (!container || !state.calendarMonths.length) return;
  container.innerHTML = state.calendarMonths.join('');
  // Strip main calendar selection state — planner uses plan-selected instead
  container.querySelectorAll('.cal-day').forEach(function(el) {
    el.classList.remove('selected', 'excluded');
  });
  refreshPlannerCalSelection();
}

export function refreshPlannerCalSelection() {
  var container = document.getElementById('planner-cal');
  if (!container) return;
  container.querySelectorAll('.cal-day').forEach(function(el) {
    var iso = el.dataset.iso;
    if (!iso) return;
    el.classList.toggle('plan-selected', iso === state.planDate);
    var hasPlan = !!(state.plans[iso] && state.plans[iso].length > 0);
    el.classList.toggle('plan-has-items', hasPlan);
  });
}
