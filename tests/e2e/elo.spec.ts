import { expect, test } from '@playwright/test';

async function createPlayers(
  page: import('@playwright/test').Page,
  nicknames: string[],
): Promise<void> {
  for (const [index, nickname] of nicknames.entries()) {
    await page.goto('/players/new');
    await page.getByLabel('Imię').fill(`Elo ${index + 1}`);
    await page.getByLabel('Nazwisko').fill('Przeglądarka');
    await page.getByLabel('Pseudonim').fill(nickname);
    await page.getByRole('button', { name: 'Dodaj gracza' }).click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  }
}

async function createEloLeague(
  page: import('@playwright/test').Page,
  name: string,
  members: string[],
  doubles = false,
): Promise<void> {
  await page.goto('/leagues/new');
  await page.getByLabel('Nazwa ligi').fill(name);
  await page.getByLabel('Rodzaj ligi').selectOption('ELO_INFINITE');
  if (doubles) await page.getByLabel('Tryb gry').selectOption('DOUBLES');
  for (const member of members) {
    await page.getByLabel(new RegExp(member)).check();
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

test('dodaje mecz singlowy Elo, aktualizuje ranking i przyjmuje nowego członka', async ({
  page,
}) => {
  const members = ['Elo Alfa', 'Elo Beta'];
  const newcomer = 'Elo Gamma';
  await createPlayers(page, [...members, newcomer]);
  await createEloLeague(page, 'Nieskończona singlowa', members);

  await page.getByRole('link', { name: 'Dodaj mecz' }).click();
  await fillSet(page, 0, 4, 0);
  await fillSet(page, 1, 4, 1);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();

  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(page.getByText('2:0')).toBeVisible();
  await page.getByRole('link', { name: 'Ranking' }).click();
  const rows = page.locator('.classification-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('1016');
  await expect(rows.nth(1)).toContainText('984');

  await page.getByRole('link', { name: 'Ustawienia' }).click();
  await page.getByLabel('Gracz').selectOption({ label: newcomer });
  await page.getByRole('button', { name: 'Dodaj gracza' }).click();
  await expect(page.getByText('Singiel · 3 graczy')).toBeVisible();
  await page.getByRole('link', { name: 'Ranking' }).click();
  await expect(page.locator('.classification-table tbody tr')).toHaveCount(3);
  await expect(page.getByRole('row', { name: new RegExp(newcomer) })).toContainText('1000');
});

test('formularz meczu deblowego Elo wymaga czterech różnych graczy', async ({ page }) => {
  const members = ['Debel Elo A', 'Debel Elo B', 'Debel Elo C', 'Debel Elo D'];
  await createPlayers(page, members);
  await createEloLeague(page, 'Nieskończona deblowa', members, true);

  await page.getByRole('link', { name: 'Dodaj mecz' }).click();
  await expect(page.getByLabel('Strona A — gracz 1')).toBeVisible();
  await expect(page.getByLabel('Strona B — gracz 2')).toBeVisible();
  await fillSet(page, 0, 4, 2);
  await fillSet(page, 1, 4, 3);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();

  await page.getByRole('link', { name: 'Ranking' }).click();
  const rows = page.locator('.classification-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: '1016' })).toHaveCount(2);
  await expect(rows.filter({ hasText: '984' })).toHaveCount(2);
});
