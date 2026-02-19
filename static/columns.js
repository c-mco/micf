// ============================================================
// MICF Insights — Column Definitions
// ============================================================

export var COLUMNS = [
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
  { key: 'Duration',           label: 'Duration',      width: 70,  minWidth: 45,  filter: 'none',   align: 'right',  visible: false, locked: false, group: 'Show Info' },
  { key: 'Status',             label: 'Status',        width: 80,  minWidth: 50,  filter: 'select', align: 'left',   visible: false, locked: false, group: 'Show Info' },
  { key: 'DisabledToilets',    label: 'Accessible WC', width: 90,  minWidth: 50,  filter: 'bool',   align: 'center', visible: false, locked: false, group: 'Accessibility' },
];

export var COLUMN_GROUPS = ['Show Info', 'Venue', 'Sessions', 'Accessibility'];

export var SORTABLE_NONE = { Count: 1, Distance: 1, Capacity: 1, SoldOutCount: 1, Duration: 1 };

export function isSortable(col) {
  return col.filter !== 'none' || SORTABLE_NONE[col.key];
}
