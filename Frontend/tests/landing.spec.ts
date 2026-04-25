import { expect, test } from '@playwright/test';

test('landing page renders lector hero content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Lector' })).toBeVisible();
  await expect(
    page.getByText('Learn to read code. Learn to think like a debugger.'),
  ).toBeVisible();
});
