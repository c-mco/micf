// ============================================================
// MICF Insights — Event Binding
// ============================================================

import { COLUMNS } from './columns.js';
import { state, dom, LS, lsSet, lsGet, getRowHeight } from './state.js';
import { $, $$, debounce, escapeHTML, toggleClass } from './utils.js';
import { isSortable } from './columns.js';
import { renderAll, renderBody, renderColgroup, renderHeader, renderFilters, renderColumnChooser, renderSessionTable, updateSearchClear, updateSortIndicators } from './render.js';
import { requestFilter } from './worker-bridge.js';
import { toggleDate, clearDates, selectThisWeekend, selectThisWeek } from './calendar.js';
import { openPlanner, closePlanner, setPlanDate, renderPlanner, addToPlan, removeFromPlan } from './planner.js';

// --- Filter Dropdown Portal ---

var portalState = { open: false, key: null, el: null };

function createPortal() {
  var el = document.createElement('div');
  el.className = 'filter-dropdown-portal';
  el.innerHTML = '<input class="fdd-search" placeholder="Search...">' +
    '<div class="fdd-list"></div>';
  document.body.appendChild(el);
  portalState.el = el;

  el.querySelector('.fdd-search').addEventListener('input', function() {
    var q = this.value.toLowerCase();
    el.querySelectorAll('.fdd-option').forEach(function(opt) {
      opt.style.display = opt.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    });
  });

  el.querySelector('.fdd-search').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closePortal(); e.stopPropagation(); }
  });

  el.querySelector('.fdd-list').addEventListener('click', function(e) {
    var opt = e.target.closest('.fdd-option');
    if (!opt) return;
    state.filters[portalState.key] = opt.dataset.value;
    closePortal();
    renderFilters();
    requestFilter(false);
  });

  el.addEventListener('click', function(e) { e.stopPropagation(); });
}

function openPortal(key, triggerEl) {
  if (!portalState.el) createPortal();
  var portal = portalState.el;
  var rect = triggerEl.getBoundingClientRect();

  portal.style.top = rect.bottom + 'px';
  portal.style.left = rect.left + 'px';
  portal.style.minWidth = Math.max(rect.width, 140) + 'px';

  var options = state.filterOptions[key] || [];
  var currentVal = state.filters[key] || '';
  var html = '<div class="fdd-option' + (!currentVal ? ' active' : '') + '" data-value="">All</div>';
  options.forEach(function(opt) {
    html += '<div class="fdd-option' + (opt === currentVal ? ' active' : '') + '" data-value="' + escapeHTML(opt) + '">' + escapeHTML(opt) + '</div>';
  });
  portal.querySelector('.fdd-list').innerHTML = html;

  var search = portal.querySelector('.fdd-search');
  search.value = '';
  portalState.open = true;
  portalState.key = key;
  portal.classList.add('open');
  setTimeout(function() { search.focus(); }, 0);
}

function closePortal() {
  if (portalState.el) portalState.el.classList.remove('open');
  portalState.open = false;
  portalState.key = null;
}

// --- Dropdown management ---

function closeAllDropdowns() {
  state.calendarOpen = false;
  state.colChooserOpen = false;
  state.exportOpen = false;
  state.priceOpen = false;
  updateDropdowns();
}

function updateDropdowns() {
  toggleClass('#calendar-panel', 'open', state.calendarOpen);
  toggleClass('#colchooser-panel', 'open', state.colChooserOpen);
  toggleClass('#export-panel', 'open', state.exportOpen);
  toggleClass('#price-panel', 'open', state.priceOpen);
}

// --- Location ---

function requestLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function(pos) {
    state.userLat = pos.coords.latitude;
    state.userLng = pos.coords.longitude;
    localStorage.setItem(LS.lat, state.userLat);
    localStorage.setItem(LS.lng, state.userLng);
    updateLocationBtn();
    renderColgroup();
    renderHeader();
    renderFilters();
    renderColumnChooser();
    requestFilter(false);

    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.userSuburb = data.address.suburb || data.address.town || '';
        localStorage.setItem(LS.suburb, state.userSuburb);
        updateLocationBtn();
        renderBody();
      })
      .catch(function() {});
  });
}

export function updateLocationBtn() {
  if (state.userLat) {
    dom.locationBtn.textContent = state.userSuburb || 'Located';
    dom.unitBtn.style.display = '';
    dom.unitBtn.textContent = state.useImperial ? 'mi' : 'km';
  } else {
    dom.locationBtn.textContent = 'Enable Location';
    dom.unitBtn.style.display = 'none';
  }
}

function toggleUnits() {
  state.useImperial = !state.useImperial;
  localStorage.setItem(LS.imperial, state.useImperial);
  updateLocationBtn();
  renderBody();
}

// --- Density ---

function toggleDensity() {
  state.density = state.density === 'compact' ? 'comfortable' : 'compact';
  localStorage.setItem(LS.density, state.density);
  dom.body.className = 'density-' + state.density;
  updateDensityBtn();
}

export function updateDensityBtn() {
  dom.densityBtn.textContent = state.density === 'compact' ? 'Comfortable' : 'Compact';
}

// --- Column Reset ---

function resetColumns() {
  var defaultVis = {};
  COLUMNS.forEach(function(c) { defaultVis[c.key] = c.visible; });
  state.colVisible = defaultVis;
  lsSet(LS.columns, state.colVisible);
  renderAll();
}

// --- Row Expansion ---

function toggleExpand(showId, idx) {
  state.activeRow = idx;

  if (state.expandedRow === showId) {
    state.expandedRow = null;
    renderBody();
    return;
  }

  state.expandedRow = showId;
  renderBody();

  if (!state.sessionCache[showId]) {
    fetch('/api/sessions?show_id=' + showId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.sessionCache[showId] = data;
        var container = document.getElementById('sessions-' + showId);
        if (container) container.innerHTML = renderSessionTable(data);
      })
      .catch(function() {
        state.sessionCache[showId] = [];
      });
  }
}

// --- Keyboard ---

function handleKeydown(e) {
  if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    dom.search.focus();
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  var shows = state.filteredShows;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.activeRow = Math.min(state.activeRow + 1, shows.length - 1);
    renderBody();
    scrollToActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.activeRow = Math.max(state.activeRow - 1, 0);
    renderBody();
    scrollToActive();
  } else if (e.key === 'Enter' && state.activeRow >= 0) {
    e.preventDefault();
    var show = shows[state.activeRow];
    if (show) toggleExpand(show.ID, state.activeRow);
  } else if (e.key === 'Escape') {
    if (portalState.open) { closePortal(); return; }
    state.expandedRow = null;
    closeAllDropdowns();
    renderBody();
  }
}

function scrollToActive() {
  var rh = getRowHeight();
  var targetTop = state.activeRow * rh;
  var scrollTop = dom.main.scrollTop;
  var viewHeight = dom.main.clientHeight;
  if (targetTop < scrollTop + rh) {
    dom.main.scrollTop = targetTop;
  } else if (targetTop + rh > scrollTop + viewHeight) {
    dom.main.scrollTop = targetTop + rh - viewHeight;
  }
}

// --- Column Resize ---

function startResize(e, key) {
  var startX = e.clientX;
  var startW = state.colWidths[key];
  var col = COLUMNS.find(function(c) { return c.key === key; });

  function onMove(ev) {
    var diff = ev.clientX - startX;
    state.colWidths[key] = Math.max(col.minWidth, startW + diff);
    renderColgroup();
  }

  function onUp() {
    lsSet(LS.widths, state.colWidths);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Sort ---

function sortShows(key) {
  if (state.sortKey === key) {
    state.sortAsc = !state.sortAsc;
  } else {
    state.sortKey = key;
    state.sortAsc = true;
  }
  updateSortIndicators();
  requestFilter(false);
}

// --- Main bind function ---

export function bindEvents() {
  // Search
  dom.search.addEventListener('input', debounce(function() {
    state.searchQuery = dom.search.value;
    updateSearchClear();
    requestFilter(true);
  }, 150));

  dom.search.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      state.searchQuery = '';
      dom.search.value = '';
      dom.search.blur();
      updateSearchClear();
      requestFilter(true);
    }
  });

  dom.searchClear.addEventListener('click', function() {
    state.searchQuery = '';
    dom.search.value = '';
    updateSearchClear();
    requestFilter(true);
  });

  // Table header clicks (sort)
  dom.headerRow.addEventListener('click', function(e) {
    if (e.target.closest('.resize-handle')) return;
    var th = e.target.closest('th[data-key]');
    if (!th) return;
    var key = th.dataset.key;
    var col = COLUMNS.find(function(c) { return c.key === key; });
    if (col && isSortable(col)) sortShows(key);
  });

  // Table header resize handles
  dom.headerRow.addEventListener('mousedown', function(e) {
    var handle = e.target.closest('.resize-handle');
    if (!handle) return;
    e.preventDefault();
    startResize(e, handle.dataset.key);
  });

  // Filter inputs (delegated)
  dom.filterRow.addEventListener('input', function(e) {
    var el = e.target;
    if (el.dataset.key) {
      state.filters[el.dataset.key] = el.value;
      requestFilter(false);
    }
  });
  dom.filterRow.addEventListener('change', function(e) {
    var el = e.target;
    if (el.dataset.key) {
      state.filters[el.dataset.key] = el.value;
      requestFilter(false);
    }
  });

  // Select filter clicks (portal dropdown)
  dom.filterRow.addEventListener('click', function(e) {
    var selectEl = e.target.closest('.filter-select');
    if (selectEl) {
      var key = selectEl.dataset.key;
      if (e.target.classList.contains('filter-select-clear')) {
        state.filters[key] = '';
        renderFilters();
        requestFilter(false);
        return;
      }
      if (portalState.open && portalState.key === key) {
        closePortal();
      } else {
        openPortal(key, selectEl);
      }
      return;
    }
    var calBtn = e.target.closest('.filter-date-btn');
    if (calBtn) {
      state.calendarOpen = !state.calendarOpen;
      state.colChooserOpen = false;
      state.exportOpen = false;
      updateDropdowns();
    }
  });

  // Table body clicks (row expand)
  dom.tbody.addEventListener('click', function(e) {
    if (e.target.closest('a')) return;
    var row = e.target.closest('tr.data-row');
    if (!row) return;
    var id = parseInt(row.dataset.id);
    var idx = parseInt(row.dataset.idx);
    toggleExpand(id, idx);
  });

  // Keyboard navigation
  document.addEventListener('keydown', handleKeydown);

  // Close dropdowns on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.dropdown-wrap')) {
      closeAllDropdowns();
    }
    if (portalState.open && !e.target.closest('.filter-dropdown-portal') && !e.target.closest('.filter-select')) {
      closePortal();
    }
  });

  // Location button
  dom.locationBtn.addEventListener('click', requestLocation);

  // Unit toggle
  dom.unitBtn.addEventListener('click', toggleUnits);

  // Date button
  dom.dateBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    state.calendarOpen = !state.calendarOpen;
    state.colChooserOpen = false;
    state.exportOpen = false;
    updateDropdowns();
  });

  // Column chooser button
  $('#colchooser-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    state.colChooserOpen = !state.colChooserOpen;
    state.calendarOpen = false;
    state.exportOpen = false;
    updateDropdowns();
  });

  // Export button
  $('#export-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    state.exportOpen = !state.exportOpen;
    state.calendarOpen = false;
    state.colChooserOpen = false;
    updateDropdowns();
  });

  // Density toggle
  dom.densityBtn.addEventListener('click', toggleDensity);

  // Prevent dropdown panels from closing when clicked inside
  $$('.dropdown-panel').forEach(function(panel) {
    panel.addEventListener('click', function(e) { e.stopPropagation(); });
  });

  // Column chooser: reset button
  $('#colchooser-reset').addEventListener('click', resetColumns);

  // Column chooser: checkboxes (delegated)
  $('#colchooser-list').addEventListener('change', function(e) {
    var input = e.target;
    if (input.type === 'checkbox' && input.dataset.key) {
      state.colVisible[input.dataset.key] = input.checked;
      lsSet(LS.columns, state.colVisible);
      renderAll();
    }
  });

  // Virtual scroll
  dom.main.addEventListener('scroll', function() {
    if (state.scrollRAF) return;
    state.scrollRAF = requestAnimationFrame(function() {
      state.scrollRAF = 0;
      renderBody();
    });
  }, { passive: true });

  // Free filter button
  $('#free-filter-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    state.showFreeOnly = !state.showFreeOnly;
    lsSet(LS.freeOnly, state.showFreeOnly);
    this.classList.toggle('active', state.showFreeOnly);
    requestFilter(true);
  });

  // Price filter button
  $('#price-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    state.priceOpen = !state.priceOpen;
    state.calendarOpen = false;
    state.colChooserOpen = false;
    state.exportOpen = false;
    updateDropdowns();
  });

  // Price inputs
  var priceDebounce = debounce(function() {
    var minVal = parseFloat($('#price-min-input').value) || 0;
    var maxVal = parseFloat($('#price-max-input').value) || 0;
    state.priceMin = minVal;
    state.priceMax = maxVal;
    lsSet(LS.priceMin, minVal);
    lsSet(LS.priceMax, maxVal);
    requestFilter(true);
  }, 300);
  $('#price-min-input').addEventListener('input', priceDebounce);
  $('#price-max-input').addEventListener('input', priceDebounce);

  // Price reset
  $('#price-reset').addEventListener('click', function() {
    state.priceMin = 0;
    state.priceMax = 0;
    lsSet(LS.priceMin, 0);
    lsSet(LS.priceMax, 0);
    $('#price-min-input').value = '';
    $('#price-max-input').value = '';
    requestFilter(true);
  });

  // Planner button
  $('#planner-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (state.plannerOpen) { closePlanner(); } else { openPlanner(); }
  });

  // Planner close button
  $('#planner-close').addEventListener('click', closePlanner);

  // Planner date select
  $('#planner-date-select').addEventListener('change', function() {
    setPlanDate(this.value);
  });

  // Planner clear
  $('#planner-clear').addEventListener('click', function() {
    state.plan = [];
    lsSet(LS.plan, []);
    renderPlanner();
    requestFilter(false);
  });

  // Planner row buttons (plan add/remove — event delegation on tbody)
  dom.tbody.addEventListener('click', function(e) {
    var btn = e.target.closest('.plan-row-btn');
    if (!btn) return;
    e.stopPropagation();
    var showId = parseInt(btn.dataset.showId);
    if (btn.classList.contains('planned')) {
      removeFromPlan(showId);
    } else if (btn.classList.contains('add')) {
      addToPlan(showId);
    }
  });

  // Calendar panel event delegation
  $('#calendar-panel').addEventListener('click', function(e) {
    var dayEl = e.target.closest('.cal-day.has-shows');
    if (dayEl) {
      var isExclude = e.ctrlKey || e.metaKey;
      toggleDate(dayEl.dataset.iso, isExclude);
      return;
    }
    var btn = e.target.closest('[data-action]');
    if (btn) {
      var action = btn.dataset.action;
      if (action === 'weekend') selectThisWeekend();
      else if (action === 'week') selectThisWeek();
      else if (action === 'clear') clearDates();
    }
  });
}
