## Task 4: Globalni gracze i awatary

**Files:** Utwórz src/modules/players/player.entity.ts, avatar.entity.ts, commands.ts, queries.ts, avatar.ts; Migration003Players.ts; src/app/players/page.tsx, new/page.tsx, [playerId]/page.tsx, [playerId]/edit/page.tsx, actions.ts; src/app/api/players/[playerId]/avatar/route.ts; src/components/PlayerForm.tsx, FieldError.tsx, ConfirmDelete.tsx; tests/integration/players.test.ts, tests/e2e/players.spec.ts.
**Interfaces:** createPlayer(em, Creation<PlayerInput>): Promise<{id,version}>; updatePlayer(em, Versioned & PlayerInput); deletePlayer(em, Versioned); listPlayers(em, cursor?): Promise<Page<PlayerDto>>; getPlayer(em,id,includeDeleted=false); setAvatar(em,id,expectedVersion,bytes): Promise<{version}>. PlayerInput = {firstName,lastName,nickname}; PlayerDto dodaje id, version, deletedAt i avatarVersion.

- [ ] Dodaj test rezerwacji pseudonimu również po usunięciu.
~~~ts
test('usunięcie nie zwalnia pseudonimu', async () => {
  await withTestDb(async em => {
    const p = await createPlayer(em, {
      token: crypto.randomUUID(),
      data: { firstName: 'Adam', lastName: 'Nowak', nickname: ' As ' }
    });
    await deletePlayer(em, { id: p.id, expectedVersion: p.version });
    await expect(createPlayer(em, {
      token: crypto.randomUUID(),
      data: { firstName: 'Ewa', lastName: 'Nowak', nickname: 'as' }
    })).rejects.toMatchObject({ code: 'NICKNAME_TAKEN' });
  });
});
~~~
- [ ] Potwierdź czerwony test. Utwórz players z version, znacznikami czasu i nickname_key; player_avatars ma PK/FK player_id, bytes BYTEA, mime_type, updated_at. UNIQUE na nickname_key obejmuje usunięte rekordy. Opracuj jedną normalizację trim + lowercase bez usuwania diakrytyków; funkcja SQL normalize_nickname jest źródłem nickname_key (kolumna generowana normalize_nickname(nickname)). Trim usuwa ten sam zestaw białych znaków co String.trim, także tabulatory i NBSP. Wszystkie serwerowe kontrole zajętości wywołują tę funkcję; UI nie implementuje niezależnego porównania Unicode. Test polskich liter, tabulatorów i NBSP pilnuje zgodności. Nie opieraj unikalności tylko na odczycie przed INSERT.
- [ ] Zaimplementuj soft delete i edycję przez porównanie version pod blokadą. Ponowione usunięcie zwraca sukces bez podbicia wersji, zanim sprawdzisz expectedVersion dla już usuniętego rekordu. W tym zadaniu liczby powiązań wynoszą zero; po utworzeniu relacji w zadaniu 5 queries liczy prawdziwe ligi/mecze.
- [ ] Dodaj walidację i ponowne kodowanie awatara. Body czytaj strumieniowo z limitem; nie polegaj na Content-Length. Postać formularza binarna multipart; sprawdź origin i wersję przed podmianą rekordu.
~~~ts
import sharp from 'sharp';

export async function sanitizeAvatar(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > 5_000_000) throw new DomainError('AVATAR_TOO_LARGE');
  const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: true });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
      (meta.pages ?? 1) !== 1) throw new DomainError('INVALID_AVATAR');
  return image.rotate()
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .webp().toBuffer();
}
~~~
Dodaj ograniczenie liczby jednoczesnych dekoderów w procesie i timeout, oprócz współdzielonego limitu uploadów. Błędne dekodowanie mapuj na INVALID_AVATAR. GET zwraca wyłącznie przetworzone image/webp, nosniff, ETag; nigdy surowy upload.
- [ ] Zbuduj polskie strony listy, dodawania i edycji oraz prosty profil, który w zadaniu 11 otrzyma statystyki. Formularz zachowuje dane po błędzie; konflikt wersji pokazuje akcję odświeżenia. Awatar można pominąć. Zapis podstawowych danych i osobny upload mają oddzielne potwierdzenia, aby błąd obrazu nie udawał błędu utworzenia gracza.
- [ ] Testuj duplikat równoległy, trim i puste pola, edycję bez zmiany id, odrzucenie SVG udającego PNG, ponad 5 MB, zbyt dużo pikseli, animację oraz obrazy pionowe/poziome ≤256 px. E2E: dodanie bez awatara, konflikt nicku i potwierdzenie usunięcia klawiaturą.
- [ ] Uruchom players integration/E2E, typecheck, lint. Commit: feat: manage players and avatars.

**Odbiór:** Działający pierwszy fragment produktu, z walidacją i wersjami na serwerze.
