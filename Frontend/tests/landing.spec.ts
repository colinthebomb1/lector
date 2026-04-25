import { expect, test } from '@playwright/test';

test('landing page renders lector hero content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Lector' })).toBeVisible();
  await expect(
    page.getByText(/most-used skill in software engineering/i),
  ).toBeVisible();
});
