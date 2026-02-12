// ============================================================
// MICF Insights — Client Application
// ============================================================

// --- Column Definitions ---

var COLUMNS = [
  { key: 'Title',              label: 'Title',         width: 280, minWidth: 120, filter: 'text',   align: 'left',   visible: true,  locked: true,  group: 'Show Info' },
  { key: 'Artist',             label: 'Artist',        width: 160, minWidth: 80,  filter: 'text',   align: 'left',   visible: true,  locked: false, group: 'Show Info' },
  { key: 'Dates',              label: 'Dates',         width: 110, minWidth: 70,  filter: 'text',   align: 'left',   visible: true,  locked: false, group: 'Show Info' },
  { key: 'VenueName',          label: 'Venue',         width: 170, minWidth: 80,  filter: 'text',   align: 'left',   visible: true,  locked: false, group: 'Venue' },
  { key: 'Suburb',             label: 'Suburb',        width: 100, minWidth: 60,  filter: 'select', align: 'left',   visible: true,  locked: false, group: 'Venue' },
  { key: 'Region',             label: 'Region',        width: 90,  minWidth: 60,  filter: 'select', align: 'left',   visible: true,  locked: false, group: 'Venue' },
  { key: 'Distance',           label: 'Dist',          width: 65,  minWidth: 50,  filter: 'none',   align: 'right',  visible: true,  locked: false, group: 'Venue' },
  { key: 'Count',              label: 'Sessions',      width: 65,  minWidth: 45,  filter: 'none',   align: 'right',  visible: true,  locked: false, group: 'Sessions' },
  { key: 'HasTightArse',       label: 'Tight Arse',    width: 75,  minWidth: 50,  filter: 'bool',   align: 'center', visible: true,  locked: false, group: 'Sessions' },
  { key: 'Capacity',           label: 'Capacity',      width: 70,  minWidth: 45,  filter: 'none',   align: 'right',  visible: false, locked: false, group: 'Venue' },
  { key: 'SoldOutCount',       label: 'Sold Out',      width: 70,  minWidth: 45,  filter: 'none',   align: 'right',  visible: false, locked: false, group: 'Sessions' },
  { key: 'Wheelchair',         label: 'Wheelchair',    width: 80,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
  { key: 'AssistedHearing',    label: 'Hearing Loop',  width: 90,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
  { key: 'HasSignInterpreter', label: 'Auslan',        width: 65,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
  { key: 'HasRelaxed',         label: 'Relaxed',       width: 65,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
  { key: 'AdultsOnly',         label: '18+',           width: 50,  minWidth: 40,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Show Info' },
  { key: 'OnlineShow',         label: 'Online',        width: 60,  minWidth: 45,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Show Info' },
  { key: 'Duration',            label: 'Duration',      width: 70,  minWidth: 45,  filter: 'none',   align: 'right',  visible: false, locked: false, group: 'Show Info' },
  { key: 'Status',             label: 'Status',        width: 80,  minWidth: 50,  filter: 'select', align: 'left',   visible: false, locked: false, group: 'Show Info' },
  { key: 'DisabledToilets',    label: 'Accessible WC', width: 90,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
];

var COLUMN_GROUPS = ['Show Info', 'Venue', 'Sessions', 'Accessibility'];

// Columns that render as plain text
var PLAIN_KEYS = { Artist: 1, Dates: 1, VenueName: 1, Suburb: 1, Region: 1 };

// Columns with filter:none that are still sortable
var SORTABLE_NONE = { Count: 1, Distance: 1, Capacity: 1, SoldOutCount: 1, Duration: 1 };

// --- Virtual Scroll ---

var ROW_HEIGHT = { compact: 28, comfortable: 36 };
var SCROLL_BUFFER = 30;

// --- LocalStorage Keys ---

var LS = {
  columns:  'micf_columns',
  widths:   'micf_col_widths',
  density:  'micf_density',
  dates:    'micf_selected_dates',
  lat:      'micf_user_lat',
  lng:      'micf_user_lng',
  suburb:   'micf_user_suburb',
  imperial: 'micf_use_imperial',
};

// --- State ---

var state = {
  shows: [],
  filteredShows: [],
  totalShows: 0,
  searchQuery: '',
  sortKey: 'Dates',
  sortAsc: true,
  activeRow: -1,
  expandedRow: null,
  sessionCache: {},
  density: 'compact',
  userLat: 0,
  userLng: 0,
  userSuburb: '',
  useImperial: false,
  colVisible: {},
  colWidths: {},
  filters: {},
  selectedDates: [],
  _selectedSet: null,
  dateShowCounts: {},
  calendarMonths: [],
  filterOptions: { Suburb: [], Region: [], Status: [] },
  // Dropdown visibility
  calendarOpen: false,
  colChooserOpen: false,
  exportOpen: false,
  // Worker
  worker: null,
  workerReady: false,
  scrollRAF: 0,
  _filterSeq: 0,
  _pendingResetScroll: false,
};

// --- DOM References ---

var dom = {};

// --- Helpers ---

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function lsGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

function lsGetRaw(key, fallback) {
  var v = localStorage.getItem(key);
  return v !== null ? v : fallback;
}

function debounce(fn, ms) {
  var timer;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getRowHeight() {
  return ROW_HEIGHT[state.density] || 28;
}

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

// --- Initialization ---

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

  // Update location button text
  updateLocationBtn();

  // Update density button text
  updateDensityBtn();

  // Update date button
  updateDateBtn();

  // Bind events
  bindEvents();

  // Initial sync render (user sees data immediately)
  syncSort();
  state.filteredShows = getFilteredShows();
  renderAll();

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

// --- Event Binding ---

function bindEvents() {
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

  // Search clear button
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
    // Calendar button in dates filter
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
    if (e.target.closest('a')) return; // Don't intercept links
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

  // Calendar panel event delegation
  $('#calendar-panel').addEventListener('click', function(e) {
    var dayEl = e.target.closest('.cal-day.has-shows');
    if (dayEl) {
      toggleDate(dayEl.dataset.iso);
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

// --- Rendering ---

function renderAll() {
  renderColgroup();
  renderHeader();
  renderFilters();
  renderBody();
  renderColumnChooser();
}

function renderColgroup() {
  var cols = getVisibleColumns();
  var total = 0;
  var html = cols.map(function(col) {
    var w = state.colWidths[col.key];
    total += w;
    return '<col style="width:' + w + 'px">';
  }).join('');
  dom.colgroup.innerHTML = html;
  dom.table.style.minWidth = total + 'px';
}

function renderHeader() {
  var cols = getVisibleColumns();
  dom.headerRow.innerHTML = cols.map(function(col) {
    var align = col.align === 'right' ? ' cell-right' : col.align === 'center' ? ' cell-center' : '';
    var sortable = isSortable(col);
    var sortClass = sortable ? ' sortable' : '';
    var indicator = '';
    if (sortable) {
      var isActive = state.sortKey === col.key;
      var symbol = isActive ? (state.sortAsc ? '\u25B2' : '\u25BC') : '\u21D5';
      indicator = '<span class="sort-indicator' + (isActive ? ' active' : '') + '">' + symbol + '</span>';
    }
    return '<th class="' + align + sortClass + '" data-key="' + col.key + '" style="position:relative">' +
      '<span>' + escapeHTML(col.label) + '</span>' + indicator +
      '<div class="resize-handle" data-key="' + col.key + '"></div>' +
      '</th>';
  }).join('');
}

function renderFilters() {
  var cols = getVisibleColumns();
  dom.filterRow.innerHTML = cols.map(function(col) {
    var inner = '';
    if (col.filter === 'text') {
      if (col.key === 'Dates') {
        inner = '<div class="filter-date-wrap">' +
          '<input type="text" class="filter-input" placeholder="Filter..." data-key="' + col.key + '" value="' + escapeHTML(state.filters[col.key] || '') + '">' +
          '<button class="filter-date-btn" title="Open calendar">&#x25BE;</button>' +
          '</div>';
      } else {
        inner = '<input type="text" class="filter-input" placeholder="Filter..." data-key="' + col.key + '" value="' + escapeHTML(state.filters[col.key] || '') + '">';
      }
    } else if (col.filter === 'select') {
      var val = state.filters[col.key] || '';
      var label = val || 'All';
      inner = '<div class="filter-select" data-key="' + col.key + '">' +
        '<span class="filter-select-label">' + escapeHTML(label) + '</span>' +
        (val ? '<span class="filter-select-clear">&times;</span>' : '') +
        '<span class="filter-select-arrow">&#x25BE;</span>' +
        '</div>';
    } else if (col.filter === 'bool') {
      var val = state.filters[col.key] || '';
      inner = '<select class="filter-input" data-key="' + col.key + '">' +
        '<option value="">All</option>' +
        '<option value="yes"' + (val === 'yes' ? ' selected' : '') + '>Yes</option>' +
        '<option value="no"' + (val === 'no' ? ' selected' : '') + '>No</option>' +
        '</select>';
    }
    return '<th>' + inner + '</th>';
  }).join('');
}

function renderBody() {
  var shows = state.filteredShows;
  var cols = getVisibleColumns();
  var colCount = cols.length;
  var rh = getRowHeight();
  var scrollTop = dom.main.scrollTop;
  var viewHeight = dom.main.clientHeight;
  var totalRows = shows.length;

  // Virtual scroll: calculate visible range with buffer
  var startIdx = Math.max(0, Math.floor(scrollTop / rh) - SCROLL_BUFFER);
  var endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / rh) + SCROLL_BUFFER);

  var padTop = startIdx * rh;
  var padBottom = Math.max(0, (totalRows - endIdx) * rh);

  var html = '';

  // Top spacer
  if (padTop > 0) {
    html += '<tr><td colspan="' + colCount + '" style="height:' + padTop + 'px;padding:0;border:0"></td></tr>';
  }

  // Visible rows only
  for (var i = startIdx; i < endIdx; i++) {
    var show = shows[i];
    var rowClass = 'data-row' + (i % 2 ? ' even' : '') +
      (i === state.activeRow ? ' active' : '') +
      (state.expandedRow === show.ID ? ' expanded' : '');

    var cells = '';
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var align = col.align === 'right' ? ' cell-right' : col.align === 'center' ? ' cell-center' : '';
      cells += '<td class="' + align + cellClass(col, show) + '">' + renderCell(col, show) + '</td>';
    }

    html += '<tr class="' + rowClass + '" data-id="' + show.ID + '" data-idx="' + i + '">' + cells + '</tr>';

    if (state.expandedRow === show.ID) {
      html += renderDetailRow(show, colCount);
    }
  }

  // Bottom spacer
  if (padBottom > 0) {
    html += '<tr><td colspan="' + colCount + '" style="height:' + padBottom + 'px;padding:0;border:0"></td></tr>';
  }

  dom.tbody.innerHTML = html;
  renderFooter(shows.length);
}

function renderCell(col, show) {
  var key = col.key;

  if (key === 'Title') {
    return '<a href="https://www.comedyfestival.com.au' + escapeHTML(show.URL) + '" target="_blank" class="cell-title">' + escapeHTML(show.Title) + '</a>';
  }
  if (key === 'Distance') {
    var d = distanceDisplay(show);
    if (d === '-') return '<span class="cell-muted">-</span>';
    return '<a href="' + directionsUrl(show) + '" target="_blank" class="cell-distance">' + d + '</a>';
  }
  if (key === 'HasTightArse') {
    return show.HasTightArse ? '<span class="badge badge-emerald">$</span>' : '';
  }
  if (key === 'Wheelchair') return show.Wheelchair ? '<span class="badge badge-blue">Yes</span>' : '';
  if (key === 'AssistedHearing') return show.AssistedHearing ? '<span class="badge badge-violet">Yes</span>' : '';
  if (key === 'HasSignInterpreter') return show.HasSignInterpreter ? '<span class="badge badge-indigo">Yes</span>' : '';
  if (key === 'HasRelaxed') return show.HasRelaxed ? '<span class="badge badge-teal">Yes</span>' : '';
  if (key === 'AdultsOnly') return show.AdultsOnly ? '<span class="badge badge-rose">18+</span>' : '';
  if (key === 'OnlineShow') return show.OnlineShow ? '<span class="badge badge-sky">Yes</span>' : '';
  if (key === 'DisabledToilets') return show.DisabledToilets ? '<span class="badge badge-blue">Yes</span>' : '';
  if (key === 'SoldOutCount') {
    var cls = show.SoldOutCount > 0 ? 'cell-soldout-active' : 'cell-muted';
    return '<span class="' + cls + '">' + show.SoldOutCount + '</span>';
  }
  if (key === 'Count') {
    var cls = show.Count <= 1 ? 'cell-count-low' : '';
    return '<span class="' + cls + '">' + show.Count + '</span>';
  }
  if (key === 'Capacity') {
    return '<span class="cell-muted">' + (show.Capacity || '-') + '</span>';
  }
  if (key === 'Duration') {
    return show.Duration ? '<span class="cell-muted">' + show.Duration + ' min</span>' : '';
  }
  if (key === 'Status') {
    return '<span class="cell-muted">' + escapeHTML(show.Status || '-') + '</span>';
  }
  // Plain text columns
  return escapeHTML(String(show[key] || ''));
}

function cellClass(col, show) {
  if (col.key === 'Dates') return ' cell-dates';
  if (col.key === 'VenueName') return ' cell-venue';
  if (col.key === 'Region') return ' cell-region';
  if (col.key === 'Suburb' && state.userSuburb && show.Suburb === state.userSuburb) return ' cell-suburb-match';
  return '';
}

function renderDetailRow(show, colCount) {
  var sessions = state.sessionCache[show.ID];
  var sessionsHTML = sessions ? renderSessionTable(sessions) : '<div class="detail-loading">Loading sessions...</div>';

  var imgSrc = show.LargeImageURL || show.ImageURL || show.SmallImageURL;
  var img = imgSrc
    ? '<img src="' + escapeHTML(imgSrc) + '" class="detail-thumb" alt="">'
    : '';

  var mapsLink = (show.Lat && show.Lng)
    ? '<a href="' + directionsUrl(show) + '" target="_blank" class="maps-link">Maps</a>'
    : '';

  var durationBadge = show.Duration
    ? '<span class="badge badge-slate">' + show.Duration + ' min</span>'
    : '';

  var descHTML = show.Description
    ? '<div class="detail-description">' + show.Description + '</div>'
    : '';

  return '<tr class="detail-row"><td colspan="' + colCount + '">' +
    '<div class="detail-inner"><div class="detail-top">' +
    img +
    '<div class="detail-info">' +
    '<div class="detail-header">' +
    '<span class="detail-title">' + escapeHTML(show.Title) + '</span>' +
    '<span class="detail-artist">' + escapeHTML(show.Artist) + '</span>' +
    '<span class="detail-venue">' + escapeHTML(show.VenueName) + '</span>' +
    durationBadge +
    '<div class="detail-links">' +
    '<a href="https://www.comedyfestival.com.au' + escapeHTML(show.URL) + '" target="_blank">MICF Page</a>' +
    mapsLink +
    '</div></div>' +
    descHTML +
    '<div id="sessions-' + show.ID + '" class="detail-sessions">' + sessionsHTML + '</div>' +
    (show.AccessibilityDetails ? '<div class="detail-accessibility">' + show.AccessibilityDetails + '</div>' : '') +
    '</div></div></div></td></tr>';
}

function renderSessionTable(sessions) {
  if (!sessions || sessions.length === 0) return '<div class="detail-loading">No sessions found</div>';

  var rows = sessions.map(function(s) {
    var rowClass = s.IsSoldOut ? ' class="sold-out"' : s.Cancelled ? ' class="cancelled"' : '';
    var statusBadge = s.IsSoldOut ? '<span class="badge badge-red">Sold Out</span>'
      : s.Cancelled ? '<span class="badge badge-slate">Cancelled</span>'
      : '<span class="badge badge-green">' + escapeHTML(s.Status || 'Available') + '</span>';

    var tags = '';
    if (s.IsTightArse) tags += '<span class="badge badge-emerald">$</span> ';
    if (s.HasSignInterpreter) tags += '<span class="badge badge-indigo">Auslan</span> ';
    if (s.IsRelaxed) tags += '<span class="badge badge-teal">Relaxed</span> ';
    if (s.IsFilmed) tags += '<span class="badge badge-slate">Filmed</span> ';
    if (s.Preview) tags += '<span class="badge badge-amber">Preview</span> ';
    if (s.ExtraShow) tags += '<span class="badge badge-orange">Extra</span> ';

    return '<tr' + rowClass + '>' +
      '<td>' + escapeHTML(s.Date) + '</td>' +
      '<td>' + escapeHTML(s.Time) + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + escapeHTML(s.ShowType || '-') + '</td>' +
      '<td>' + tags + '</td></tr>';
  }).join('');

  return '<table class="mini-table"><thead><tr>' +
    '<th>Date</th><th>Time</th><th>Status</th><th>Type</th><th>Tags</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderFooter(filteredCount) {
  dom.footerCount.textContent = 'Showing ' + filteredCount + ' of ' + state.shows.length + ' shows';

  if (state.totalShows > state.shows.length) {
    dom.footerTotal.textContent = '(' + state.totalShows + ' total in DB)';
    dom.footerTotal.style.display = '';
  } else {
    dom.footerTotal.style.display = 'none';
  }

  // Build filter pills
  var pills = '';

  // Column filter pills
  COLUMNS.forEach(function(col) {
    var f = state.filters[col.key];
    if (f) {
      pills += '<span class="filter-pill" data-pill-key="' + col.key + '">' +
        escapeHTML(col.label) + ': ' + escapeHTML(f) +
        ' <span class="pill-x">\u00d7</span></span>';
    }
  });

  // Search pill
  if (state.searchQuery) {
    pills += '<span class="filter-pill" data-pill-key="__search">' +
      'Search: ' + escapeHTML(state.searchQuery) +
      ' <span class="pill-x">\u00d7</span></span>';
  }

  // Date pill
  if (state.selectedDates.length > 0) {
    var n = state.selectedDates.length;
    pills += '<span class="filter-pill" data-pill-key="__dates">' +
      n + ' date' + (n > 1 ? 's' : '') + ' selected' +
      ' <span class="pill-x">\u00d7</span></span>';
  }

  dom.footerPills.innerHTML = pills;

  // Bind pill click events
  dom.footerPills.querySelectorAll('.filter-pill').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var key = pill.dataset.pillKey;
      if (key === '__search') {
        state.searchQuery = '';
        dom.search.value = '';
        updateSearchClear();
      } else if (key === '__dates') {
        clearDates();
        return; // clearDates already calls requestFilter
      } else {
        state.filters[key] = '';
        var input = dom.filterRow.querySelector('[data-key="' + key + '"]');
        if (input) input.value = '';
      }
      requestFilter(true);
    });
  });
}

function renderColumnChooser() {
  var html = '';
  COLUMN_GROUPS.forEach(function(group) {
    var cols = COLUMNS.filter(function(c) { return c.group === group; });
    html += '<div class="colchooser-group">';
    html += '<div class="colchooser-group-label">' + escapeHTML(group) + '</div>';
    cols.forEach(function(col) {
      var checked = state.colVisible[col.key] ? ' checked' : '';
      var locked = col.locked ? ' locked' : '';
      var disabled = col.locked ? ' disabled' : '';
      html += '<label class="colchooser-item' + locked + '">' +
        '<input type="checkbox" data-key="' + col.key + '"' + checked + disabled + '> ' +
        escapeHTML(col.label) + '</label>';
    });
    html += '</div>';
  });
  $('#colchooser-list').innerHTML = html;
}

// --- Calendar ---

function buildCalendar(data) {
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
    // Padding
    for (var p = 0; p < offset; p++) daysHTML += '<div></div>';
    // Days
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var count = counts[iso] || 0;
      var selected = state._selectedSet.has(iso);
      var cls = 'cal-day';
      if (count > 0) {
        cls += ' has-shows';
        if (!selected) {
          if (count <= q1) cls += ' density-low';
          else if (count <= q2) cls += ' density-med';
          else cls += ' density-high';
        }
      } else {
        cls += ' no-shows';
      }
      if (selected) cls += ' selected';
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

  var clearBtn = state.selectedDates.length > 0
    ? '<button class="clear-action" data-action="clear">Clear all</button>'
    : '';

  $('#calendar-content').innerHTML = months.join('') +
    '<div class="cal-actions">' +
    '<button class="quick-action" data-action="weekend">This weekend</button>' +
    '<button class="quick-action" data-action="week">This week</button>' +
    '<div class="flex-grow"></div>' +
    clearBtn +
    '</div>';

  state.calendarMonths = months; // store for re-render
}

function refreshCalendarSelection() {
  // Update calendar day classes without full rebuild
  $$('#calendar-panel .cal-day').forEach(function(el) {
    var iso = el.dataset.iso;
    if (!iso) return;
    if (state._selectedSet.has(iso)) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
  // Update clear button visibility
  var clearBtn = $('#calendar-panel [data-action="clear"]');
  if (clearBtn) clearBtn.style.display = state.selectedDates.length > 0 ? '' : 'none';
  updateDateBtn();
}

// --- Filtering & Sorting ---

function getVisibleColumns() {
  return COLUMNS.filter(function(c) {
    if (c.key === 'Distance' && !state.userLat) return false;
    return state.colVisible[c.key];
  });
}

function isSortable(col) {
  return col.filter !== 'none' || SORTABLE_NONE[col.key];
}

function getFilteredShows() {
  var hasDateFilter = state.selectedDates.length > 0;
  var dateSet = state._selectedSet;
  var q = (state.searchQuery || '').toLowerCase().trim();

  // Pre-collect active filters
  var activeFilters = [];
  COLUMNS.forEach(function(col) {
    var f = state.filters[col.key];
    if (!f) return;
    activeFilters.push({ key: col.key, type: col.filter, value: f, lower: f.toLowerCase() });
  });
  var hasColFilters = activeFilters.length > 0;

  return state.shows.filter(function(show) {
    // Global search
    if (q && show._haystack.indexOf(q) === -1) return false;

    // Date filter
    if (hasDateFilter) {
      var match = false;
      for (var i = 0; i < show._dates.length; i++) {
        if (dateSet.has(show._dates[i])) { match = true; break; }
      }
      if (!match) return false;
    }

    // Column filters
    if (hasColFilters) {
      for (var i = 0; i < activeFilters.length; i++) {
        var af = activeFilters[i];
        if (af.type === 'text') {
          var val = String(show[af.key] || '').toLowerCase();
          if (val.indexOf(af.lower) === -1) return false;
        } else if (af.type === 'select') {
          if (show[af.key] !== af.value) return false;
        } else if (af.type === 'bool') {
          if (af.value === 'yes' && !show[af.key]) return false;
          if (af.value === 'no' && show[af.key]) return false;
        }
      }
    }

    return true;
  });
}

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

// Sort state.shows in place (sync fallback when worker unavailable)
function syncSort() {
  var key = state.sortKey;
  var asc = state.sortAsc;
  state.shows.sort(function(a, b) {
    var v1 = a[key], v2 = b[key];
    if (key === 'Distance') { v1 = distanceKm(a); v2 = distanceKm(b); }
    if (typeof v1 === 'boolean') { v1 = v1 ? 1 : 0; v2 = v2 ? 1 : 0; }
    if (typeof v1 === 'string') { v1 = v1.toLowerCase(); v2 = (v2 || '').toLowerCase(); }
    if (v1 == null) v1 = '';
    if (v2 == null) v2 = '';
    if (asc) return v1 > v2 ? 1 : v1 < v2 ? -1 : 0;
    return v1 < v2 ? 1 : v1 > v2 ? -1 : 0;
  });
}

function updateSortIndicators() {
  dom.headerRow.querySelectorAll('th[data-key]').forEach(function(th) {
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
  // "/" to focus search
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

// --- Date Selection ---

function toggleDate(iso) {
  if (state._selectedSet.has(iso)) {
    state._selectedSet.delete(iso);
  } else {
    state._selectedSet.add(iso);
  }
  state.selectedDates = Array.from(state._selectedSet).sort();
  lsSet(LS.dates, state.selectedDates);
  refreshCalendarSelection();
  requestFilter(false);
}

function clearDates() {
  state._selectedSet.clear();
  state.selectedDates = [];
  lsSet(LS.dates, state.selectedDates);
  refreshCalendarSelection();
  requestFilter(true);
}

function selectThisWeekend() {
  var today = new Date();
  var dow = today.getDay();
  var daysToFri = dow <= 5 ? (5 - dow) : (5 + 7 - dow);
  var fri = new Date(today);
  fri.setDate(today.getDate() + daysToFri);
  for (var i = 0; i < 3; i++) {
    var d = new Date(fri);
    d.setDate(fri.getDate() + i);
    var iso = d.toISOString().slice(0, 10);
    if (state.dateShowCounts[iso]) state._selectedSet.add(iso);
  }
  state.selectedDates = Array.from(state._selectedSet).sort();
  lsSet(LS.dates, state.selectedDates);
  refreshCalendarSelection();
  requestFilter(false);
}

function selectThisWeek() {
  var today = new Date();
  var dow = today.getDay();
  var daysToMon = dow === 0 ? -6 : 1 - dow;
  var mon = new Date(today);
  mon.setDate(today.getDate() + daysToMon);
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon);
    d.setDate(mon.getDate() + i);
    var iso = d.toISOString().slice(0, 10);
    if (state.dateShowCounts[iso]) state._selectedSet.add(iso);
  }
  state.selectedDates = Array.from(state._selectedSet).sort();
  lsSet(LS.dates, state.selectedDates);
  refreshCalendarSelection();
  requestFilter(false);
}

// --- Density ---

function toggleDensity() {
  state.density = state.density === 'compact' ? 'comfortable' : 'compact';
  localStorage.setItem(LS.density, state.density);
  dom.body.className = 'density-' + state.density;
  updateDensityBtn();
}

function updateDensityBtn() {
  dom.densityBtn.textContent = state.density === 'compact' ? 'Comfortable' : 'Compact';
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

    // Reverse geocode for suburb name
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.userSuburb = data.address.suburb || data.address.town || '';
        localStorage.setItem(LS.suburb, state.userSuburb);
        updateLocationBtn();
        renderBody(); // re-render for suburb highlighting
      })
      .catch(function() {});
  });
}

function updateLocationBtn() {
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

// --- Distance ---

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceKm(show) {
  if (!state.userLat || !show.Lat) return 9999;
  return haversine(state.userLat, state.userLng, show.Lat, show.Lng);
}

function distanceDisplay(show) {
  if (!state.userLat || !show.Lat) return '-';
  var km = distanceKm(show);
  return state.useImperial ? (km * 0.621371).toFixed(1) + ' mi' : km.toFixed(1) + ' km';
}

function directionsUrl(show) {
  if (show.Lat && show.Lng) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + show.Lat + ',' + show.Lng;
  }
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent((show.Venue || show.VenueName) + ', Melbourne, Victoria');
}

// --- Dropdowns ---

function closeAllDropdowns() {
  state.calendarOpen = false;
  state.colChooserOpen = false;
  state.exportOpen = false;
  updateDropdowns();
}

function updateDropdowns() {
  toggleClass('#calendar-panel', 'open', state.calendarOpen);
  toggleClass('#colchooser-panel', 'open', state.colChooserOpen);
  toggleClass('#export-panel', 'open', state.exportOpen);
}

function updateDateBtn() {
  var n = state.selectedDates.length;
  dom.dateBtn.textContent = n > 0 ? 'Dates (' + n + ')' : 'Dates';
  if (n > 0) dom.dateBtn.classList.add('active');
  else dom.dateBtn.classList.remove('active');
}

function toggleClass(sel, cls, on) {
  var el = $(sel);
  if (el) { if (on) el.classList.add(cls); else el.classList.remove(cls); }
}

// --- Search Clear ---

function updateSearchClear() {
  if (state.searchQuery) {
    dom.searchClear.classList.remove('hidden');
  } else {
    dom.searchClear.classList.add('hidden');
  }
}

// --- Column Reset ---

function resetColumns() {
  var defaultVis = {};
  COLUMNS.forEach(function(c) { defaultVis[c.key] = c.visible; });
  state.colVisible = defaultVis;
  lsSet(LS.columns, state.colVisible);
  renderAll();
}

// --- Worker Integration ---

function initWorker() {
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
        renderBody();
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

function requestFilter(resetScroll) {
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
      filters: state.filters,
      userLat: state.userLat,
      userLng: state.userLng,
    });
  } else {
    syncSort();
    state.filteredShows = getFilteredShows();
    if (resetScroll && dom.main) dom.main.scrollTop = 0;
    renderBody();
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
}

// --- Start ---

document.addEventListener('DOMContentLoaded', init);
