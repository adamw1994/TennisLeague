import { expect, test } from '@playwright/test';

async function createPlayers(
  page: import('@playwright/test').Page,
  nicknames: string[],
): Promise<void> {
  for (const [index, nickname] of nicknames.entries()) {
    await page.goto('/players/new');
    await page.getByLabel('Imię').fill(`Kortowy ${index + 1}`);
    await page.getByLabel('Nazwisko').fill('Wynik');
    await page.getByLabel('Pseudonim').fill(nickname);
    await page.getByRole('button', { name: 'Dodaj gracza' }).click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  }
}

async function createClassicLeague(
  page: import('@playwright/test').Page,
  name: string,
  nicknames: string[],
  doubles = false,
): Promise<void> {
  await page.goto('/leagues/new');
  await page.getByLabel('Nazwa ligi').fill(name);
  if (doubles) await page.getByLabel('Tryb gry').selectOption('DOUBLES');
  for (const nickname of nicknames) {
    await page.getByLabel(new RegExp(nickname)).check();
  }
  await page.getByRole('button', { name: 'Przejdź do podsumowania' }).click();
  await page.getByRole('button', { name: 'Utwórz ligę' }).click();
  await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]+$/);
}

async function fillSet(
  page: import('@playwright/test').Page,
  index: number,
  sideA: number,
  sideB: number,
): Promise<void> {
  const row = page.locator('.set-row').nth(index);
  await row.locator('input').nth(0).fill(String(sideA));
  await row.locator('input').nth(1).fill(String(sideB));
}

test('zamyka ligę singlową, pokazuje 5/0 i zachowuje mobilną korektę 2:1 z STB', async ({
  page,
}) => {
  const nicknames = ['Wynik Alfa', 'Wynik Beta'];
  await createPlayers(page, nicknames);
  await createClassicLeague(page, 'Klasyczna z wynikami', nicknames);

  await page.getByRole('link', { name: 'Dodaj wynik' }).click();
  await page.getByRole('link', { name: 'Wpisz wynik' }).click();
  await fillSet(page, 0, 4, 1);
  await fillSet(page, 1, 4, 2);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();

  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(page.getByText('2:0')).toBeVisible();
  await expect(page.getByText(/Wynik zapisano/)).toBeVisible();
  await page.getByRole('link', { name: 'Tabela' }).click();
  await expect(page.locator('.classification-table tbody tr').nth(0)).toContainText('5');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Terminarz' }).click();
  await page.getByRole('link', { name: 'Szczegóły' }).click();
  await page.getByRole('link', { name: 'Popraw wynik' }).click();
  await page.getByLabel('Format pierwszych dwóch setów').selectOption('NORMAL');
  await fillSet(page, 0, 6, 4);
  await fillSet(page, 1, 4, 6);
  await expect(page.getByLabel('Format decydującego seta')).toBeVisible();
  await page.getByLabel('Format decydującego seta').selectOption('SUPER_TIE_BREAK');
  await fillSet(page, 2, 10, 8);
  await page.getByRole('button', { name: 'Zapisz poprawkę' }).click();

  await expect(page.getByText('2:1')).toBeVisible();
  await expect(page.getByText('10:10')).toBeVisible();
  await page.getByRole('link', { name: 'Tabela' }).click();
  const rows = page.locator('.classification-table tbody tr');
  await expect(rows.nth(0)).toContainText('4');
  await expect(rows.nth(1)).toContainText('2');
});

test('zapisuje wynik klasycznego debla dla stałych par', async ({ page }) => {
  const nicknames = ['Para A1', 'Para A2', 'Para B1', 'Para B2'];
  await createPlayers(page, nicknames);
  await createClassicLeague(page, 'Debel z wynikiem', nicknames, true);

  await page.getByRole('link', { name: 'Dodaj wynik' }).click();
  await page.getByRole('link', { name: 'Wpisz wynik' }).click();
  await page.getByLabel('Format pierwszych dwóch setów').selectOption('NORMAL');
  await fillSet(page, 0, 6, 3);
  await fillSet(page, 1, 7, 5);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();

  await expect(page.getByText('2:0')).toBeVisible();
  await page.getByRole('link', { name: 'Tabela' }).click();
  await expect(page.locator('.classification-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.classification-table tbody tr').nth(0)).toContainText('5');
});
