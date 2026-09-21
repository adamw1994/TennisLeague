import { expect, test } from '@playwright/test';

test('główna nawigacja prowadzi do profilu, list i pustych statystyk', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Low on Legs' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dodaj gracza' })).toBeVisible();

  await page.getByRole('link', { name: 'Gracze' }).click();
  await expect(page).toHaveURL(/\/players$/);
  await page.getByRole('link', { name: 'Dodaj gracza' }).click();
  await page.getByLabel('Imię').fill('Nawigacyjny');
  await page.getByLabel('Nazwisko').fill('Gracz');
  await page.getByLabel('Pseudonim').fill('Nawigacja');
  await page.getByRole('button', { name: 'Dodaj gracza' }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  await expect(page.getByRole('link', { name: 'Singiel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Debel' })).toBeVisible();
  await expect(page.getByText('Brak rozegranych meczów')).toHaveCount(2);

  await page.getByRole('link', { name: 'Ligi' }).click();
  await expect(page).toHaveURL(/\/leagues$/);
  await expect(page.getByRole('link', { name: 'Utwórz ligę' })).toBeVisible();
  await page.getByRole('link', { name: 'Low on Legs' }).click();
  await expect(page).toHaveURL(/\/$/);
});
