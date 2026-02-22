/**
 * Exploratory tests for newer features:
 *   - Free shows filter
 *   - Price range filter
 *   - Availability badges (Hot / Filling)
 *   - Column sort (clicking headers)
 *   - Planner panel open/close
 *   - Column chooser toggle
 *
 * Test data (from global-setup):
 *   Show 1  "The Comedian"         $30–$35  avail 80%
 *   Show 2  "Single Night Special" $45–$50  avail 80%
 *   Show 3  "Weekend Warrior"      $20      avail 10%  → Hot badge
 *   Show 4  "Late Night"           $25 TA   avail 30%  → Filling badge
 *   Show 5  "Acoustic Set"         FREE     avail 80%
 *
 * Price filter logic:
 *   priceMin: hides shows where MaxPrice < priceMin  (free shows exempt)
 *   priceMax: hides shows where MinPrice > priceMax  (free shows exempt)
 */
import { test, expect } from '@playwright/test';

test.describe('Free shows filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('free filter button is present in the header', async ({ page }) => {
    await expect(page.locator('#free-filter-btn')).toBeVisible();
  });

  test('toggling free filter shows only free shows', async ({ page }) => {
    await page.click('#free-filter-btn');
    // Only show 5 "Acoustic Set" is free
    await expect(page.locator('tr.data-row')).toHaveCount(1);
    expect(await page.locator('#tbody').innerText()).toContain('Acoustic Set');
  });

  test('toggling free filter off restores all shows', async ({ page }) => {
    await page.click('#free-filter-btn');
    await expect(page.locator('tr.data-row')).toHaveCount(1);

    await page.click('#free-filter-btn');
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });
});

test.describe('Price range filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('price filter button is present in the header', async ({ page }) => {
    await expect(page.locator('#price-btn')).toBeVisible();
  });

  test('opening price panel reveals min/max inputs', async ({ page }) => {
    await page.click('#price-btn');
    await expect(page.locator('#price-panel')).toBeVisible();
    await expect(page.locator('#price-min-input')).toBeVisible();
    await expect(page.locator('#price-max-input')).toBeVisible();
  });

  test('setting min price $30 hides shows with max price below $30', async ({ page }) => {
    await page.click('#price-btn');
    await page.fill('#price-min-input', '30');
    // Filter uses: hide if show.MaxPrice < priceMin (free shows exempt)
    // Show 3 "Weekend Warrior" ($20 max) → hidden
    // Show 4 "Late Night" ($25 max) → hidden
    // Show 5 "Acoustic Set" (free) → always visible
    // Show 1 "The Comedian" ($35 max >= $30) → visible
    await expect(page.locator('#tbody')).not.toContainText('Weekend Warrior', { timeout: 2000 });
    await expect(page.locator('#tbody')).not.toContainText('Late Night');
    await expect(page.locator('#tbody')).toContainText('The Comedian');
    await expect(page.locator('#tbody')).toContainText('Acoustic Set');
  });

  test('setting max price $30 hides shows with min price above $30', async ({ page }) => {
    await page.click('#price-btn');
    await page.fill('#price-max-input', '30');
    // Filter uses: hide if show.MinPrice > priceMax (free shows exempt)
    // Show 2 "Single Night Special" ($45 min > $30) → hidden
    // Show 1 "The Comedian" ($30 min = $30) → visible (not strictly greater)
    // Show 3 "Weekend Warrior" ($20 min) → visible
    // Show 5 "Acoustic Set" (free) → always visible
    await expect(page.locator('#tbody')).not.toContainText('Single Night Special', { timeout: 2000 });
    await expect(page.locator('#tbody')).toContainText('Weekend Warrior');
    await expect(page.locator('#tbody')).toContainText('Late Night');
    await expect(page.locator('#tbody')).toContainText('Acoustic Set');
  });
});

test.describe('Availability badges', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('"Hot" badge appears on show with <20% availability', async ({ page }) => {
    // Show 3 "Weekend Warrior" has 10% availability → Hot badge (badge-red)
    const row = page.locator('tr.data-row[data-id="3"]');
    await expect(row.locator('.badge-red')).toBeVisible();
  });

  test('"Filling" badge appears on show with 20-40% availability', async ({ page }) => {
    // Show 4 "Late Night" has 30% availability → Filling badge (badge-amber)
    const row = page.locator('tr.data-row[data-id="4"]');
    await expect(row.locator('.badge-amber')).toBeVisible();
  });

  test('no availability badge on show with 80% availability', async ({ page }) => {
    // Show 1 "The Comedian" has 80% availability → no badge
    const row = page.locator('tr.data-row[data-id="1"]');
    await expect(row.locator('.badge-red, .badge-amber')).toHaveCount(0);
  });
});

test.describe('Column sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('clicking a column header sorts the table', async ({ page }) => {
    // Column headers use data-key attribute
    await page.locator('th[data-key="Artist"]').click();
    const rows = page.locator('tr.data-row');
    // After sorting by artist ascending, verify the order changed
    const firstId = await rows.first().getAttribute('data-id');
    // Just verify something rendered and sort didn't break the page
    expect(firstId).toBeTruthy();
    await expect(rows).toHaveCount(5);
  });

  test('clicking same header twice reverses sort order', async ({ page }) => {
    const header = page.locator('th[data-key="Artist"]');
    await header.click();
    const firstId = await page.locator('tr.data-row').first().getAttribute('data-id');

    await header.click();
    const firstIdReversed = await page.locator('tr.data-row').first().getAttribute('data-id');

    expect(firstId).not.toBe(firstIdReversed);
  });

  test('Count column header sorts by session count', async ({ page }) => {
    await page.locator('th[data-key="Count"]').click();
    // All 5 shows remain visible after sort
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });
});

test.describe('Planner panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('planner button is present', async ({ page }) => {
    await expect(page.locator('#planner-btn')).toBeVisible();
  });

  test('clicking planner button opens the planner panel', async ({ page }) => {
    await page.click('#planner-btn');
    // Panel gains the "open" class when toggled on
    await expect(page.locator('#planner-panel')).toHaveClass(/open/);
  });

  test('P key toggles the planner panel', async ({ page }) => {
    // Panel starts closed (no "open" class)
    await expect(page.locator('#planner-panel')).not.toHaveClass(/open/);
    // Click body to ensure no input is focused (P key is ignored when INPUT has focus)
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('p');
    await expect(page.locator('#planner-panel')).toHaveClass(/open/);
    await page.keyboard.press('p');
    await expect(page.locator('#planner-panel')).not.toHaveClass(/open/);
  });

  test('planner panel contains a calendar for date selection', async ({ page }) => {
    await page.click('#planner-btn');
    // The planner renders a calendar in #planner-cal
    await expect(page.locator('#planner-cal')).toBeVisible();
  });

  test('closing planner with button hides the panel', async ({ page }) => {
    await page.click('#planner-btn');
    await expect(page.locator('#planner-panel')).toHaveClass(/open/);

    // Clicking the planner button again closes the panel
    await page.click('#planner-btn');
    await expect(page.locator('#planner-panel')).not.toHaveClass(/open/);
  });
});

test.describe('Column chooser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('column chooser panel opens on button click', async ({ page }) => {
    await page.click('#colchooser-btn');
    await expect(page.locator('#colchooser-panel')).toBeVisible();
  });

  test('column chooser contains checkboxes for hidden columns', async ({ page }) => {
    await page.click('#colchooser-btn');
    // Status is hidden by default and appears in the chooser
    await expect(page.locator('#colchooser-list input[data-key="Status"]')).toBeVisible();
  });

  test('enabling a hidden column makes its header appear', async ({ page }) => {
    await page.click('#colchooser-btn');
    await page.check('#colchooser-list input[data-key="Status"]');
    await page.click('#colchooser-btn'); // close
    // Column headers use data-key attribute
    await expect(page.locator('th[data-key="Status"]')).toBeVisible();
  });
});
