// ============================================================
// MICF Insights — Rendering
// ============================================================

import { COLUMNS, COLUMN_GROUPS, isSortable } from './columns.js';
import { state, dom, LS, lsSet, getRowHeight, SCROLL_BUFFER } from './state.js';
import { $, escapeHTML, distanceDisplay, distanceKmLocal, directionsUrl } from './utils.js';
import { requestFilter } from './worker-bridge.js';
import { refreshCalendarSelection } from './calendar.js';
import { conflictInfo, conflictReason } from './planner.js';

export function getVisibleColumns() {
  return COLUMNS.filter(function(c) {
    // PlanTime column: only visible when planner is open with a date selected
    if (c.key === 'PlanTime') return state.plannerOpen && !!state.planDate;
    if (c.key === 'Distance' && !state.userLat) return false;
    return state.colVisible[c.key];
  });
}

export function renderAll() {
  renderColgroup();
  renderHeader();
  renderFilters();
  renderBody();
  renderColumnChooser();
}

export function renderColgroup() {
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

export function renderHeader() {
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

export function renderFilters() {
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

export function renderBody() {
  var shows = state.filteredShows;
  var cols = getVisibleColumns();
  var colCount = cols.length;
  var rh = getRowHeight();
  var scrollTop = dom.main.scrollTop;
  var viewHeight = dom.main.clientHeight;
  var totalRows = shows.length;

  var startIdx = Math.max(0, Math.floor(scrollTop / rh) - SCROLL_BUFFER);
  var endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / rh) + SCROLL_BUFFER);

  var padTop = startIdx * rh;
  var padBottom = Math.max(0, (totalRows - endIdx) * rh);

  var html = '';

  if (padTop > 0) {
    html += '<tr><td colspan="' + colCount + '" style="height:' + padTop + 'px;padding:0;border:0"></td></tr>';
  }

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

  if (padBottom > 0) {
    html += '<tr><td colspan="' + colCount + '" style="height:' + padBottom + 'px;padding:0;border:0"></td></tr>';
  }

  dom.tbody.innerHTML = html;
  renderFooter(shows.length);
}

function renderCell(col, show) {
  var key = col.key;

  if (key === 'Title') {
    var planBtn = '';
    if (state.plannerOpen && state.planDate) {
      var sess = state.plannerDateSessions[show.ID];
      var isPlanned = state.plan.some(function(p) { return p.showId === show.ID; });
      if (isPlanned) {
        planBtn = '<button class="plan-row-btn planned" data-show-id="' + show.ID + '" title="Remove from plan">\u2713</button>';
      } else if (sess) {
        if (sess.isSoldOut) {
          planBtn = '<span class="plan-row-soldout" title="Sold out">\u2013</span>';
        } else {
          var details = conflictInfo(sess, state.plan);
          if (details) {
            var reason = conflictReason(details);
            planBtn = '<button class="plan-row-btn warn" data-show-id="' + show.ID + '" title="' + escapeHTML(reason) + '">\u26a0+</button>';
          } else {
            planBtn = '<button class="plan-row-btn add" data-show-id="' + show.ID + '" title="Add to plan">+</button>';
          }
        }
      }
    }
    return planBtn + '<a href="https://www.comedyfestival.com.au' + escapeHTML(show.URL) + '" target="_blank" class="cell-title">' + escapeHTML(show.Title) + '</a>';
  }
  if (key === 'PlanTime') {
    var sess = state.plannerDateSessions[show.ID];
    if (!sess || !sess.time) return '';
    return '<span class="plan-time-cell">' + escapeHTML(sess.time) + '</span>';
  }
  if (key === 'Distance') {
    var d = distanceDisplay(show, state);
    if (d === '-') return '<span class="cell-muted">-</span>';
    return '<a href="' + directionsUrl(show) + '" target="_blank" class="cell-distance">' + d + '</a>';
  }
  if (key === 'HasTightArse') return show.HasTightArse ? '<span class="badge badge-emerald">$</span>' : '';
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
    var badge = '';
    if (show.MinAvailPct > 0 && show.MinAvailPct < 20) {
      badge = ' <span class="badge badge-red">Hot</span>';
    } else if (show.MinAvailPct >= 20 && show.MinAvailPct < 40) {
      badge = ' <span class="badge badge-amber">Filling</span>';
    }
    return '<span class="' + cls + '">' + show.Count + '</span>' + badge;
  }
  if (key === 'Capacity') return '<span class="cell-muted">' + (show.Capacity || '-') + '</span>';
  if (key === 'Duration') return show.Duration ? '<span class="cell-muted">' + show.Duration + ' min</span>' : '';
  if (key === 'Status') return '<span class="cell-muted">' + escapeHTML(show.Status || '-') + '</span>';
  if (key === 'Price') {
    if (show.IsFree) return '<span class="badge badge-emerald">Free</span>';
    if (!show.MinPrice) return '<span class="cell-muted">-</span>';
    var lo = '$' + show.MinPrice.toFixed(0);
    if (show.MaxPrice && show.MaxPrice !== show.MinPrice) lo += ' – $' + show.MaxPrice.toFixed(0);
    return '<span class="cell-muted">' + lo + '</span>';
  }
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
  var bannerHTML = imgSrc
    ? '<div class="detail-banner" style="background-image:url(\'' + escapeHTML(imgSrc) + '\')">' +
      '<div class="detail-banner-overlay"></div></div>'
    : '';

  var subtitle = escapeHTML(show.Artist || '');
  if (show.VenueName) subtitle += ' \u00b7 ' + escapeHTML(show.VenueName);
  if (show.Duration) subtitle += ' \u00b7 ' + show.Duration + '\u202fmin';

  var mapsChip = (show.Lat && show.Lng)
    ? '<a href="' + directionsUrl(show) + '" target="_blank" class="action-chip action-chip-maps">Maps</a>'
    : '';
  var trailerChip = show.VideoEmbedURL
    ? '<a href="' + escapeHTML(show.VideoEmbedURL) + '" target="_blank" class="action-chip action-chip-trailer">Trailer</a>'
    : '';

  var descHTML = show.Description
    ? '<div class="detail-description">' + show.Description + '</div>'
    : '';

  return '<tr class="detail-row"><td colspan="' + colCount + '">' +
    '<div class="detail-inner">' +
    bannerHTML +
    '<div class="detail-content">' +
    '<div class="detail-title-row">' +
    '<div class="detail-title-group">' +
    '<div class="detail-title">' + escapeHTML(show.Title) + '</div>' +
    '<div class="detail-subtitle">' + subtitle + '</div>' +
    '</div>' +
    '<div class="detail-action-chips">' +
    '<a href="https://www.comedyfestival.com.au' + escapeHTML(show.URL) + '" target="_blank" class="action-chip">MICF Page</a>' +
    mapsChip + trailerChip +
    '</div></div>' +
    descHTML +
    '<div id="sessions-' + show.ID + '" class="detail-sessions">' + sessionsHTML + '</div>' +
    (show.AccessibilityDetails ? '<div class="detail-accessibility">' + show.AccessibilityDetails + '</div>' : '') +
    '</div></div></td></tr>';
}

var SESSION_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var SESSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatSessionDate(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return SESSION_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + SESSION_MONTHS[d.getMonth()];
}

export function renderSessionTable(sessions) {
  if (!sessions || sessions.length === 0) return '<div class="detail-loading">No sessions found</div>';

  var rows = sessions.map(function(s) {
    var rowClass = s.IsSoldOut ? ' class="sold-out"'
      : s.Cancelled ? ' class="cancelled"'
      : s.AvailabilityPct > 60 ? ' class="avail-row-high"'
      : s.AvailabilityPct > 25 ? ' class="avail-row-med"'
      : s.AvailabilityPct > 0  ? ' class="avail-row-low"'
      : '';
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

    var priceCell = '';
    if (s.IsFreeShow) {
      priceCell = '<span class="badge badge-emerald">Free</span>';
    } else if (s.MinPrice) {
      var p = '$' + s.MinPrice.toFixed(0);
      if (s.MaxPrice && s.MaxPrice !== s.MinPrice) p += '–$' + s.MaxPrice.toFixed(0);
      priceCell = '<span class="cell-muted">' + p + '</span>';
    } else {
      priceCell = '<span class="cell-muted">-</span>';
    }

    var availCell = '';
    if (s.AvailabilityPct > 0) {
      var pct = s.AvailabilityPct;
      var cls = pct > 60 ? 'avail-high' : pct > 25 ? 'avail-med' : 'avail-low';
      availCell = '<span class="' + cls + '">' + pct + '%</span>';
    }

    return '<tr' + rowClass + '>' +
      '<td>' + formatSessionDate(s.Date) + '</td>' +
      '<td>' + escapeHTML(s.Time) + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + priceCell + '</td>' +
      '<td>' + availCell + '</td>' +
      '<td>' + escapeHTML(s.ShowType || '-') + '</td>' +
      '<td>' + tags + '</td></tr>';
  }).join('');

  return '<table class="mini-table"><thead><tr>' +
    '<th>Date</th><th>Time</th><th>Status</th><th>Price</th><th>Avail</th><th>Type</th><th>Tags</th>' +
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

  var pills = '';

  COLUMNS.forEach(function(col) {
    var f = state.filters[col.key];
    if (f) {
      pills += '<span class="filter-pill" data-pill-key="' + col.key + '">' +
        escapeHTML(col.label) + ': ' + escapeHTML(f) +
        ' <span class="pill-x">\u00d7</span></span>';
    }
  });

  if (state.searchQuery) {
    pills += '<span class="filter-pill" data-pill-key="__search">' +
      'Search: ' + escapeHTML(state.searchQuery) +
      ' <span class="pill-x">\u00d7</span></span>';
  }

  if (state.showFreeOnly) {
    pills += '<span class="filter-pill" data-pill-key="__free">Free shows only <span class="pill-x">\u00d7</span></span>';
  }

  if (state.priceMin > 0 || state.priceMax > 0) {
    var priceLabel = 'Price: ';
    if (state.priceMin > 0 && state.priceMax > 0) priceLabel += '$' + state.priceMin + ' \u2013 $' + state.priceMax;
    else if (state.priceMin > 0) priceLabel += 'min $' + state.priceMin;
    else priceLabel += 'max $' + state.priceMax;
    pills += '<span class="filter-pill" data-pill-key="__price">' + priceLabel + ' <span class="pill-x">\u00d7</span></span>';
  }

  if (state.selectedDates.length > 0) {
    var n = state.selectedDates.length;
    pills += '<span class="filter-pill" data-pill-key="__dates_include">' +
      n + ' date' + (n > 1 ? 's' : '') + ' included' +
      ' <span class="pill-x">\u00d7</span></span>';
  }

  if (state.excludedDates.length > 0) {
    var n = state.excludedDates.length;
    pills += '<span class="filter-pill pill-exclude" data-pill-key="__dates_exclude">' +
      n + ' date' + (n > 1 ? 's' : '') + ' excluded' +
      ' <span class="pill-x">\u00d7</span></span>';
  }

  dom.footerPills.innerHTML = pills;

  dom.footerPills.querySelectorAll('.filter-pill').forEach(function(pill) {
    pill.addEventListener('click', function() {
      var key = pill.dataset.pillKey;
      if (key === '__search') {
        state.searchQuery = '';
        dom.search.value = '';
        updateSearchClear();
      } else if (key === '__free') {
        state.showFreeOnly = false;
        lsSet(LS.freeOnly, false);
        var freeBtn = document.getElementById('free-filter-btn');
        if (freeBtn) freeBtn.classList.remove('active');
      } else if (key === '__price') {
        state.priceMin = 0;
        state.priceMax = 0;
        lsSet(LS.priceMin, 0);
        lsSet(LS.priceMax, 0);
        var minInput = document.getElementById('price-min-input');
        var maxInput = document.getElementById('price-max-input');
        if (minInput) minInput.value = '';
        if (maxInput) maxInput.value = '';
      } else if (key === '__dates_include') {
        state._selectedSet.clear();
        state.selectedDates = [];
        lsSet(LS.dates, state.selectedDates);
        refreshCalendarSelection();
        requestFilter(true);
        return;
      } else if (key === '__dates_exclude') {
        state._excludedSet.clear();
        state.excludedDates = [];
        lsSet(LS.excludedDates, state.excludedDates);
        refreshCalendarSelection();
        requestFilter(true);
        return;
      } else {
        state.filters[key] = '';
        var input = dom.filterRow.querySelector('[data-key="' + key + '"]');
        if (input) input.value = '';
      }
      requestFilter(true);
    });
  });
}

export function renderColumnChooser() {
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
  var ovList = document.getElementById('overflow-colchooser-list');
  if (ovList) ovList.innerHTML = html;
}

export function updateSearchClear() {
  if (state.searchQuery) {
    dom.searchClear.classList.remove('hidden');
  } else {
    dom.searchClear.classList.add('hidden');
  }
}

export function updateSortIndicators() {
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
