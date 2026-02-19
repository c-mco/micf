/**
 * Smoke tests — basic page load and structure.
 */
import { test, expect } from '@playwright/test';

test.describe('Smoke', () => {
  test('page loads with title and table', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('MICF Insights');
    await expect(page.locator('#data-table')).toBeVisible();
  });

  test('header controls are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#date-btn')).toBeVisible();
    await expect(page.locator('#colchooser-btn')).toBeVisible();
    await expect(page.locator('#export-btn')).toBeVisible();
  });

  test('all 5 seeded shows appear on load', async ({ page }) => {
    await page.goto('/');
    // Wait for JS to render the table body
    await expect(page.locator('tr.data-row').first()).toBeVisible();
    const rows = page.locator('tr.data-row');
    await expect(rows).toHaveCount(5);
  });

  test('footer shows correct show count', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
    const footer = page.locator('#footer-count');
    await expect(footer).toContainText('5');
  });

  test('show titles are visible in table', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
    expect(body).toContain('Single Night Special');
    expect(body).toContain('Weekend Warrior');
  });

  test('no JS errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
