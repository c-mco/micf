// ============================================================
// MICF Insights — State & LocalStorage
// ============================================================

export var ROW_HEIGHT = { compact: 28, comfortable: 36 };
export var SCROLL_BUFFER = 30;

export var LS = {
  columns:  'micf_columns',
  widths:   'micf_col_widths',
  density:  'micf_density',
  dates:    'micf_selected_dates',
  excludedDates: 'micf_excluded_dates',
  lat:      'micf_user_lat',
  lng:      'micf_user_lng',
  suburb:   'micf_user_suburb',
  imperial: 'micf_use_imperial',
};

export var state = {
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
  excludedDates: [],
  _excludedSet: null,
  dateShowCounts: {},
  calendarMonths: [],
  filterOptions: { Suburb: [], Region: [], Status: [] },
  calendarOpen: false,
  colChooserOpen: false,
  exportOpen: false,
  worker: null,
  workerReady: false,
  scrollRAF: 0,
  _filterSeq: 0,
  _pendingResetScroll: false,
};

export var dom = {};

// --- LocalStorage helpers ---

export function lsGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}

export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

export function lsGetRaw(key, fallback) {
  var v = localStorage.getItem(key);
  return v !== null ? v : fallback;
}

export function getRowHeight() {
  return ROW_HEIGHT[state.density] || 28;
}
