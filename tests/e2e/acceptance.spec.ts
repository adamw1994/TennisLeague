import { expect, test } from '@playwright/test';

async function openLeague(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.goto('/leagues');
  await page.getByRole('link', { name, exact: true }).click();
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

async function startFirstPendingResult(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Przejdź do spotkań' }).click();
  await expect(page.locator('.match-row').filter({ hasText: 'Do rozegrania' })).not.toHaveCount(0);
  await page.getByRole('link', { name: 'Wpisz wynik' }).first().click();
}

test('odbiór klasycznej ligi singlowej obejmuje mobilny wynik, STB, kolejkę, korektę i soft delete', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, 'Acceptance Classic Singles');
  await startFirstPendingResult(page);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.locator('.set-row').first().locator('input').first()).toBeVisible();

  await page.getByLabel('Format pierwszych dwóch setów').selectOption('NORMAL');
  await fillSet(page, 0, 6, 4);
  await fillSet(page, 1, 4, 6);
  await page.getByLabel('Format decydującego seta').selectOption('SUPER_TIE_BREAK');
  await fillSet(page, 2, 10, 8);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(page.getByText('2:1')).toBeVisible();
  await expect(page.getByText('10:10')).toBeVisible();

  await page.getByRole('link', { name: 'Terminarz' }).click();
  await expect(page.locator('.match-row').filter({ hasText: 'Do rozegrania' })).not.toHaveCount(0);
  await page.getByRole('link', { name: 'Szczegóły' }).first().click();
  await page.getByRole('link', { name: 'Popraw wynik' }).click();
  await page.getByLabel('Format pierwszych dwóch setów').selectOption('FAST4');
  await fillSet(page, 0, 4, 0);
  await fillSet(page, 1, 4, 1);
  await page.getByRole('button', { name: 'Zapisz poprawkę' }).click();
  await expect(page.getByText('2:0')).toBeVisible();

  await page.getByRole('link', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: 'Usuń ligę' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('6 meczów');
  await dialog.getByRole('button', { name: 'Potwierdź usunięcie' }).click();
  await expect(page).toHaveURL(/\/leagues$/);
  await expect(page.getByRole('link', { name: 'Acceptance Classic Singles', exact: true })).toHaveCount(0);
});

test('odbiór klasycznego debla zapisuje pary i klasyfikację', async ({ page }) => {
  await openLeague(page, 'Acceptance Classic Doubles');
  await startFirstPendingResult(page);
  await page.getByLabel('Format pierwszych dwóch setów').selectOption('NORMAL');
  await fillSet(page, 0, 6, 3);
  await fillSet(page, 1, 7, 5);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();
  await expect(page.getByText('2:0')).toBeVisible();
  await page.getByRole('link', { name: 'Tabela' }).click();
  await expect(page.locator('.classification-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.classification-table tbody tr').first()).toContainText('5');
});

test('odbiór Elo obejmuje nowego członka, korektę, worker i soft delete meczu', async ({ page }) => {
  await openLeague(page, 'Acceptance Elo Singles');
  await page.getByRole('link', { name: 'Dodaj mecz' }).click();
  await fillSet(page, 0, 4, 0);
  await fillSet(page, 1, 4, 1);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/);
  await expect(page.getByText('Ranking aktualny')).toBeVisible();

  await page.getByRole('link', { name: 'Ustawienia' }).click();
  await page.getByLabel('Gracz').selectOption({ label: 'Acceptance Doubles 1' });
  await page.getByRole('button', { name: 'Dodaj gracza' }).click();
  await expect(page.getByText('Gracz dołączył do ligi.')).toBeVisible();
  await page.getByRole('link', { name: 'Ranking' }).click();
  await expect(page.getByRole('row', { name: /Acceptance Doubles 1/ })).toContainText('1000');

  await page.getByRole('link', { name: 'Mecze' }).click();
  await page.getByRole('link', { name: 'Szczegóły' }).first().click();
  await page.getByRole('link', { name: 'Popraw wynik' }).click();
  await fillSet(page, 0, 4, 1);
  await fillSet(page, 1, 4, 2);
  await page.getByRole('button', { name: 'Zapisz poprawkę' }).click();
  await expect(
    page.getByText(/Oczekiwanie na przeliczenie Elo\.|Obliczenia Elo dotyczą bieżącej wersji meczu\./),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Obliczenia Elo dotyczą bieżącej wersji meczu.')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Usuń mecz' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ranking zostanie przeliczony');
  await dialog.getByRole('button', { name: 'Potwierdź usunięcie' }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await expect(page.getByText('Brak meczów')).toBeVisible();
});

test('odbiór deblowego Elo wymaga czterech stron i pokazuje ranking', async ({ page }) => {
  await openLeague(page, 'Acceptance Elo Doubles');
  await page.getByRole('link', { name: 'Dodaj mecz' }).click();
  await expect(page.getByLabel('Strona A — gracz 1')).toBeVisible();
  await expect(page.getByLabel('Strona B — gracz 2')).toBeVisible();
  await fillSet(page, 0, 4, 2);
  await fillSet(page, 1, 4, 3);
  await page.getByRole('button', { name: 'Zapisz wynik' }).click();
  await expect(page.getByText('2:0')).toBeVisible();
  await page.getByRole('link', { name: 'Ranking' }).click();
  await expect(page.locator('.classification-table tbody tr')).toHaveCount(4);
});

test('odbiór formularzy zachowuje błąd, blokuje submit, wykrywa konflikt i oddaje focus dialogu', async ({
  page,
}) => {
  await openLeague(page, 'Acceptance Classic Doubles');
  await page.getByRole('link', { name: 'Dodaj wynik' }).click();
  await page.getByRole('link', { name: 'Wpisz wynik' }).first().click();
  await fillSet(page, 0, 3, 3);
  await fillSet(page, 1, 4, 0);
  const submit = page.locator('.score-form button[type="submit"]');
  await submit.click();
  await expect(page.locator('.error-message[role="alert"]')).toContainText('Wynik tenisowy jest nieprawidłowy');
  await expect(page.locator('.set-row').first().locator('input').first()).toHaveValue('3');

  await fillSet(page, 0, 4, 0);
  await fillSet(page, 1, 4, 0);
  let delayedPost = false;
  await page.route('**/*', async route => {
    if (!delayedPost && route.request().method() === 'POST') {
      delayedPost = true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await route.continue().catch(() => undefined);
  });
  await submit.click({ noWaitAfter: true });
  await expect(submit).toBeDisabled({ timeout: 2_000 });
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+$/, { timeout: 15_000 });
  await page.unroute('**/*');
  const matchUrl = page.url();
  const stalePage = await page.context().newPage();
  await stalePage.goto(`${matchUrl}/edit`);
  await page.getByRole('link', { name: 'Popraw wynik' }).click();
  await fillSet(page, 0, 4, 1);
  await fillSet(page, 1, 4, 1);
  await page.getByRole('button', { name: 'Zapisz poprawkę' }).click();
  await expect(page.getByText('2:0')).toBeVisible();
  await fillSet(stalePage, 0, 4, 2);
  await fillSet(stalePage, 1, 4, 2);
  await stalePage.getByRole('button', { name: 'Zapisz poprawkę' }).click();
  await expect(stalePage.locator('.error-message[role="alert"]')).toContainText('Dane zostały zmienione');
  await stalePage.close();

  await page.goto('/players');
  await page.getByRole('link', { name: 'Acceptance Classic 1', exact: true }).click();
  const deleteButton = page.getByRole('button', { name: 'Usuń gracza' });
  await deleteButton.click();
  await expect(page.getByRole('dialog')).toContainText('historia');
  await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
  await expect(deleteButton).toBeFocused();
});
