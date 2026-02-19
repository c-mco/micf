import { test, expect } from '@playwright/test';

test('inspect filter row DOM', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('tr.data-row').first()).toBeVisible();
  
  // Check filter row HTML
  const filterRowHTML = await page.locator('#filter-row').innerHTML();
  console.log('filter-row innerHTML (first 500):', filterRowHTML.slice(0, 500));
  
  // Check if .filter-select exists anywhere
  const selects = await page.locator('.filter-select').all();
  console.log('filter-select count:', selects.length);
  
  // Check by data-key
  const suburbEl = await page.locator('[data-key="Suburb"]').all();
  console.log('[data-key=Suburb] count:', suburbEl.length);
  
  // Check HasTightArse select
  const taEl = await page.locator('[data-key="HasTightArse"]').all();
  console.log('[data-key=HasTightArse] count:', taEl.length);
  
  // Check if filter row is visible
  const filterRow = page.locator('#filter-row');
  const box = await filterRow.boundingBox();
  console.log('filter-row bounding box:', box);
});
