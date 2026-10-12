## Task 2: Idempotentne i kontrolowane mutacje

**Files:** Utwórz pliki src/shared/ z mapy, src/db/migrations/Migration002Mutations.ts, tests/integration/mutations.test.ts, tests/unit/input.test.ts.
**Interfaces:** Consumes withDb i kontrakty. Produces once<T>(em, operation: string, token: string, canonicalPayload: unknown, execute: () => Promise<T>): Promise<T>; assertVersion(actual: number, expected: number): void; consumeLimit(em, clientKey: string, operation: string): Promise<void>; DomainError(code, fields?).

- [ ] Dodaj test konfliktu i powtórzenia tokenu; testy wywołują once w transakcji na osobnym em, nie współdzielą transakcji równolegle.
~~~ts
test('ten sam token nie tworzy drugiego zasobu', async () => {
  await withTestDb(async em => {
    let calls = 0;
    const invoke = (payload: object) => em.transactional(tx =>
      once(tx, 'CREATE_PLAYER', 'token-1', payload, async () => {
        calls += 1;
        return { id: 'saved' };
      }));
    expect(await invoke({ nickname: 'Adam' })).toEqual({ id: 'saved' });
    expect(await invoke({ nickname: 'Adam' })).toEqual({ id: 'saved' });
    expect(calls).toBe(1);
    await expect(invoke({ nickname: 'Ewa' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
~~~
- [ ] Uruchom test przed implementacją. Utwórz request_tokens z UNIQUE(operation, token), payload_hash i response JSONB. W tej samej transakcji INSERT ON CONFLICT DO NOTHING RETURNING, następnie SELECT FOR UPDATE; porównaj hash, zwróć istniejący response lub wykonaj callback i zapisz wynik. Rollback usuwa także nowy token. Hash SHA-256 z rekursywnie sortowanych kluczy, zachowując kolejność tablic; normalizacja danych przed hashem.
- [ ] Dodaj application_settings oraz rate_limit_buckets(key, operation, window_start, count), z kluczem złożonym. Atomowy UPSERT zwiększa licznik tylko poniżej limitu; brak RETURNING oznacza RATE_LIMITED. Kontrola limitu przed dekodowaniem obrazów i kosztowną transakcją; odrzucone próby mogą zużyć limit, ale nie tworzą zasobów.
~~~sql
INSERT INTO rate_limit_buckets(key, operation, window_start, count)
VALUES (?, ?, ?, 1)
ON CONFLICT (key, operation, window_start)
DO UPDATE SET count = rate_limit_buckets.count + 1
WHERE rate_limit_buckets.count < ?
RETURNING count;
~~~
- [ ] Dodaj ścisłe schematy Zod odrzucające nieznane pola, nieujemne wersje meczu (0 dla PENDING), dodatnie wersje gracza i ligi, UUID zasobów i token UUID tworzony przez formularz. Token żyje w stanie formularza/sessionStorage do potwierdzonego sukcesu lub świadomego rozpoczęcia nowej operacji. Ten sam payload po błędzie sieciowym używa tego samego tokenu.
- [ ] Dodaj błędy VALIDATION, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, RATE_LIMITED, NOT_FOUND, FORBIDDEN_OPERATION; mapuj później także domenowe kody specyfikacji §25. Zewnętrzny błąd zawiera polski komunikat, log wewnętrzny requestId, code i czas bez całego formularza.
- [ ] Sprawdź 20 jednoczesnych identycznych utworzeń, różny payload pod tym samym tokenem, rollback callbacku, limit z dwóch połączeń, niezaufany forwarded header i przekroczenie body. Użyj Promise.all na oddzielnych forkach EM, bez sleep jako synchronizacji.
- [ ] Uruchom testy mutations/input, typecheck i lint. Commit: feat: protect public mutations.

**Odbiór:** Mechanizm serwerowy działa między procesami; nie polega na zablokowaniu przycisku ani pamięci aplikacji.
