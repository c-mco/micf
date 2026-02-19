/**
 * Date-filter tests, including the "not on this day" exclude feature.
 *
 * Test data recap (from global-setup):
 *   Show 1  "The Comedian"         sessions on 2026-03-20, 21, 22
 *   Show 2  "Single Night Special" session  on 2026-03-20 only
 *   Show 3  "Weekend Warrior"      sessions on 2026-03-21, 22
 *   Show 4  "Late Night"           sessions on 2026-03-22, 23
 *   Show 5  "Acoustic Set"         session  on 2026-03-21 only
 *
 * Include 2026-03-20  → shows 1 & 2 visible,   3, 4, 5 hidden
 * Exclude 2026-03-20  → shows 3, 4, 5 visible, 1 & 2 hidden
 */
import { test, expect } from '@playwright/test';

const DATE_20 = '2026-03-20'; // included in shows 1 and 2 only
const DATE_21 = '2026-03-21'; // included in shows 1, 3, 5

async function openCalendar(page: any) {
  await page.click('#date-btn');
  // Wait for calendar to populate from /api/dates
  await expect(page.locator(`.cal-day[data-iso="${DATE_20}"]`)).toBeVisible({ timeout: 5000 });
}

async function clearDates(page: any) {
  const clearBtn = page.locator('[data-action="clear"]');
  if (await clearBtn.isVisible()) await clearBtn.click();
}

test.describe('Date filter — include (regular click)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('selecting a date hides shows that have no session on that date', async ({ page }) => {
    await openCalendar(page);
    await page.click(`.cal-day[data-iso="${DATE_20}"]`);

    // Shows 1 & 2 have sessions on 2026-03-20; shows 3, 4, 5 do not
    await expect(page.locator('tr.data-row')).toHaveCount(2);

    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
    expect(body).toContain('Single Night Special');
    expect(body).not.toContain('Weekend Warrior');
    expect(body).not.toContain('Late Night');
    expect(body).not.toContain('Acoustic Set');
  });

  test('selecting a different date shows the correct subset', async ({ page }) => {
    await openCalendar(page);
    // DATE_21 → shows 1, 3, 5 have sessions on 21 Mar
    await page.click(`.cal-day[data-iso="${DATE_21}"]`);

    await expect(page.locator('tr.data-row')).toHaveCount(3);
    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
    expect(body).toContain('Weekend Warrior');
    expect(body).toContain('Acoustic Set');
    expect(body).not.toContain('Single Night Special');
    expect(body).not.toContain('Late Night');
  });

  test('clearing date selection restores all shows', async ({ page }) => {
    await openCalendar(page);
    await page.click(`.cal-day[data-iso="${DATE_20}"]`);
    await expect(page.locator('tr.data-row')).toHaveCount(2);

    await clearDates(page);
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });
});

test.describe('Date filter — exclude / "not on this day" (Ctrl+click)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tr.data-row').first()).toBeVisible();
  });

  test('Ctrl+clicking a date hides shows that have a session on that date', async ({ page }) => {
    await openCalendar(page);

    // Ctrl+click = "not on this day"
    await page.click(`.cal-day[data-iso="${DATE_20}"]`, { modifiers: ['Meta'] });

    // Shows 1 & 2 have sessions on 2026-03-20 → they should be hidden
    await expect(page.locator('tr.data-row')).toHaveCount(3);

    const body = await page.locator('#tbody').innerText();
    expect(body).not.toContain('The Comedian');
    expect(body).not.toContain('Single Night Special');
    expect(body).toContain('Weekend Warrior');
    expect(body).toContain('Late Night');
    expect(body).toContain('Acoustic Set');
  });

  test('"not on this day" footer reflects reduced count', async ({ page }) => {
    await openCalendar(page);
    await page.click(`.cal-day[data-iso="${DATE_20}"]`, { modifiers: ['Meta'] });

    await expect(page.locator('#footer-count')).toContainText('3');
  });

  test('clearing after exclude restores all shows', async ({ page }) => {
    await openCalendar(page);
    await page.click(`.cal-day[data-iso="${DATE_20}"]`, { modifiers: ['Meta'] });
    await expect(page.locator('tr.data-row')).toHaveCount(3);

    await clearDates(page);
    await expect(page.locator('tr.data-row')).toHaveCount(5);
  });

  test('exclude and include are mutually exclusive for the same date', async ({ page }) => {
    await openCalendar(page);

    // First Ctrl+click (exclude 2026-03-20)
    await page.click(`.cal-day[data-iso="${DATE_20}"]`, { modifiers: ['Meta'] });
    await expect(page.locator('tr.data-row')).toHaveCount(3);

    // Regular click on same date should flip to include mode
    await page.click(`.cal-day[data-iso="${DATE_20}"]`);
    // Now it's in "include" mode: shows 1 & 2 visible, 3,4,5 hidden
    await expect(page.locator('tr.data-row')).toHaveCount(2);

    const body = await page.locator('#tbody').innerText();
    expect(body).toContain('The Comedian');
    expect(body).toContain('Single Night Special');
  });

  test('excluding a different date produces the correct result', async ({ page }) => {
    await openCalendar(page);
    // Exclude 2026-03-21: shows 1, 3, 5 have sessions on 21 → hidden
    await page.click(`.cal-day[data-iso="${DATE_21}"]`, { modifiers: ['Meta'] });

    await expect(page.locator('tr.data-row')).toHaveCount(2);
    const body = await page.locator('#tbody').innerText();
    expect(body).not.toContain('The Comedian');
    expect(body).not.toContain('Weekend Warrior');
    expect(body).not.toContain('Acoustic Set');
    expect(body).toContain('Single Night Special');
    expect(body).toContain('Late Night');
  });
});
