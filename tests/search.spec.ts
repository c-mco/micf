/**
 * Search and column filter tests.
 */
import { test, expect } from '@playwright/test';

test.describe('Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('typing in search box filters rows', async ({ page }) => {
    await page.fill('#search-input', 'Comedian');
    await expect(page.locator('tr.data-row')).toHaveCount(1);
    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
  });

  test('search is case-insensitive', async ({ page }) => {
    await page.fill('#search-input', 'comedian');
    await expect(page.locator('tr.data-row')).toHaveCount(1);
  });

  test('search matches artist name', async ({ page }) => {
    await page.fill('#search-input', 'Alex Rivers');
    await expect(page.locator('tr.data-row')).toHaveCount(1);
    expect(await page.locator('#tbody').innerText()).toContain('The Comedian');
  });

  test('search matching multiple shows returns all matches', async ({ page }) => {
    // "night" matches: "Single Night Special" (title), "Weekend Warrior" (via "The Night Owl" venue), "Late Night" (title)
    await page.fill('#search-input', 'night');
    await expect(page.locator('tr.data-row')).toHaveCount(3);
  });

  test('search with no matches shows empty table', async ({ page }) => {
    await page.fill('#search-input', 'zzznomatch');
    await expect(page.locator('tr.data-row')).toHaveCount(0);
    // Footer should reflect 0
    await expect(page.locator('#footer-count')).toContainText('0');
  });

  test('clearing search restores all shows', async ({ page }) => {
    await page.fill('#search-input', 'Comedian');
    await expect(page.locator('tr.data-row')).toHaveCount(1);

    await page.fill('#search-input', '');
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });

  test('clear button appears when search has text and clears on click', async ({ page }) => {
    const clearBtn = page.locator('#search-clear');
    await expect(clearBtn).toBeHidden();

    await page.fill('#search-input', 'Comedian');
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });
});

/** Enable a hidden column via the column chooser panel. */
async function enableColumn(page: any, key: string) {
  await page.click('#colchooser-btn');
  await page.check(`#colchooser-list input[data-key="${key}"]`);
  await page.click('#colchooser-btn'); // close panel
  // Wait for filter row to rebuild with the new column (scope to filter row to avoid strict-mode violations)
  await expect(page.locator(`#filter-row [data-key="${key}"]`)).toBeVisible();
}

test.describe('Column filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('Suburb filter shows only shows at matching venue suburb', async ({ page }) => {
    // The Suburb filter is a select-type dropdown
    // Shows in "Fitzroy": Weekend Warrior (venue 3)
    const suburbFilter = page.locator('.filter-select[data-key="Suburb"]');
    await suburbFilter.click();

    // Wait for portal dropdown to open and click "Fitzroy"
    const fitzroyOption = page.locator('.fdd-option', { hasText: 'Fitzroy' });
    await expect(fitzroyOption).toBeVisible();
    await fitzroyOption.click();

    await expect(page.locator('tr.data-row')).toHaveCount(1);
    expect(await page.locator('#tbody').innerText()).toContain('Weekend Warrior');
  });

  test('Status filter shows only matching shows', async ({ page }) => {
    // Status is hidden by default — enable it via column chooser
    await enableColumn(page, 'Status');

    // "Selling Fast" status: only Acoustic Set (show 5)
    const statusFilter = page.locator('.filter-select[data-key="Status"]');
    await statusFilter.click();

    const option = page.locator('.fdd-option', { hasText: 'Selling Fast' });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page.locator('tr.data-row')).toHaveCount(1);
    expect(await page.locator('#tbody').innerText()).toContain('Acoustic Set');
  });

  test('Wheelchair filter (bool=yes) shows only wheelchair-accessible shows', async ({ page }) => {
    // Wheelchair is hidden by default — enable it via column chooser
    await enableColumn(page, 'Wheelchair');

    // Wheelchair access: venue 1 (The Forum) → shows 1, 4, 5
    const select = page.locator('select.filter-input[data-key="Wheelchair"]');
    await select.selectOption('yes');

    await expect(page.locator('tr.data-row')).toHaveCount(3);
    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
    expect(body).toContain('Late Night');
    expect(body).toContain('Acoustic Set');
    expect(body).not.toContain('Weekend Warrior');
  });

  test('Tight Arse filter (bool=yes) shows only shows with tight-arse sessions', async ({ page }) => {
    // Only Late Night has tight_arse sessions
    const select = page.locator('select.filter-input[data-key="HasTightArse"]');
    await select.selectOption('yes');

    await expect(page.locator('tr.data-row')).toHaveCount(1);
    expect(await page.locator('#tbody').innerText()).toContain('Late Night');
  });
});
