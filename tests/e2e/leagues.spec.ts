import { expect, test } from '@playwright/test';

async function createPlayers(
  page: import('@playwright/test').Page,
  nicknames: string[],
): Promise<void> {
  for (const [index, nickname] of nicknames.entries()) {
    await page.goto('/players/new');
    await page.getByLabel('Imię').fill(`Imię ${index + 1}`);
    await page.getByLabel('Nazwisko').fill('Ligowy');
    await page.getByLabel('Pseudonim').fill(nickname);
    await page.getByRole('button', { name: 'Dodaj gracza' }).click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  }
}

test('tworzy klasyczną ligę singlową wraz z pełnym terminarzem', async ({ page }) => {
  const nicknames = ['Singiel Alfa', 'Singiel Beta', 'Singiel Gamma'];
  await createPlayers(page, nicknames);

  await page.goto('/leagues/new');
  await page.getByLabel('Nazwa ligi').fill('Jesienna liga singlowa');
  for (const nickname of nicknames) {
    await page.getByLabel(new RegExp(nickname)).check();
  }
  await page.getByRole('button', { name: 'Przejdź do podsumowania' }).click();
  await expect(page.getByText('Mecze na start').locator('..')).toContainText('3');
  await page.getByRole('button', { name: 'Utwórz ligę' }).click();

  await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Jesienna liga singlowa' })).toBeVisible();
  await page.getByRole('link', { name: 'Terminarz' }).click();
  await expect(page.locator('.match-row')).toHaveCount(3);
  await expect(page.getByText('Do rozegrania')).toHaveCount(3);
});

test('tworzy klasyczny debel ze stałymi parami i rewanżem', async ({ page }) => {
  const nicknames = ['Debel Jeden', 'Debel Dwa', 'Debel Trzy', 'Debel Cztery'];
  await createPlayers(page, nicknames);

  await page.goto('/leagues/new');
  await page.getByLabel('Nazwa ligi').fill('Deblowa liga rewanżowa');
  await page.getByLabel('Tryb gry').selectOption('DOUBLES');
  await page.getByLabel('Mecz i rewanż').check();
  for (const nickname of nicknames) {
    await page.getByLabel(new RegExp(nickname)).check();
  }
  await expect(page.getByText('Debel Jeden / Debel Dwa')).toBeVisible();
  await expect(page.getByText('Debel Trzy / Debel Cztery')).toBeVisible();
  await page.getByRole('button', { name: 'Przejdź do podsumowania' }).click();
  await expect(page.getByText('Mecze na start').locator('..')).toContainText('2');
  await page.getByRole('button', { name: 'Utwórz ligę' }).click();

  await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Stałe pary' })).toBeVisible();
  await page.getByRole('link', { name: 'Terminarz' }).click();
  await expect(page.locator('.match-row')).toHaveCount(2);
  await expect(page.locator('.round-label').filter({ hasText: 'rewanż' })).toHaveCount(1);
});
