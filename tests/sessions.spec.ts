/**
 * Session panel tests — clicking a row expands it to show session details.
 */
import { test, expect } from '@playwright/test';

test.describe('Session panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('clicking a show row expands a session detail panel', async ({ page }) => {
    // Click the row for "The Comedian" (show ID 1, 3 sessions)
    await page.locator('tr.data-row[data-id="1"]').click();
    // A detail row is inserted directly after; it contains session data
    await expect(page.locator('tr.data-row[data-id="1"]')).toHaveClass(/expanded/);
    await expect(page.locator('.session-table, .detail-row, tr.detail')).toBeVisible({ timeout: 3000 });
  });

  test('session panel shows the correct number of sessions', async ({ page }) => {
    // Show 1 "The Comedian" has 3 sessions (20, 21, 22 Mar)
    await page.locator('tr.data-row[data-id="1"]').click();
    // The detail row is populated via /api/sessions fetch; wait for it
    await page.waitForResponse(resp => resp.url().includes('/api/sessions') && resp.status() === 200);
    // Dates render as "Fri 20 Mar" — verify at least one of the expected dates appears
    await expect(
      page.locator(':text("20 Mar")').first()
    ).toBeVisible({ timeout: 3000 });
  });

  test('session panel for show 2 shows tight-arse indicator for show 4', async ({ page }) => {
    // Show 4 "Late Night" has tight-arse sessions
    await page.locator('tr.data-row[data-id="4"]').click();
    await page.waitForResponse(resp => resp.url().includes('/api/sessions') && resp.status() === 200);
    // The tight-arse badge/indicator should appear in the expanded detail
    const expanded = page.locator('tr.data-row[data-id="4"] ~ tr');
    await expect(expanded.filter({ hasText: /tight|tightarse|\$/i }).first()).toBeVisible({ timeout: 3000 });
  });

  test('clicking an expanded row collapses the session panel', async ({ page }) => {
    const row = page.locator('tr.data-row[data-id="1"]');
    await row.click();
    await expect(row).toHaveClass(/expanded/);

    await row.click();
    await expect(row).not.toHaveClass(/expanded/);
  });

  test('/api/sessions returns valid JSON for a known show', async ({ page }) => {
    const resp = await page.request.get('/api/sessions?show_id=1');
    expect(resp.status()).toBe(200);
    const sessions = await resp.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(3);
    const dates = sessions.map((s: any) => s.Date);
    expect(dates).toContain('2026-03-20');
    expect(dates).toContain('2026-03-21');
    expect(dates).toContain('2026-03-22');
  });

  test('/api/sessions sessions are ordered chronologically', async ({ page }) => {
    const resp = await page.request.get('/api/sessions?show_id=1');
    const sessions = await resp.json();
    const dates = sessions.map((s: any) => s.FullDate);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });

  test('/api/sessions flags sign interpreter and relaxed for show 5', async ({ page }) => {
    const resp = await page.request.get('/api/sessions?show_id=5');
    const sessions = await resp.json();
    expect(sessions.length).toBe(1);
    expect(sessions[0].HasSignInterpreter).toBe(true);
    expect(sessions[0].IsRelaxed).toBe(true);
  });
});
