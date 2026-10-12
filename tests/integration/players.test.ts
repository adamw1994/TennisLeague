import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import {
  createPlayer,
  deletePlayer,
  setAvatar,
  updatePlayer,
} from '@/modules/players/commands';
import { sanitizeAvatar } from '@/modules/players/avatar';
import { getPlayer, listPlayers } from '@/modules/players/queries';
import { withTestDb } from '../support/database';

const player = (nickname: string) => ({
  firstName: 'Adam',
  lastName: 'Nowak',
  nickname,
});

test('usunięcie nie zwalnia pseudonimu', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: player(' As '),
    });
    await deletePlayer(em, {
      id: created.id,
      expectedVersion: created.version,
    });

    await expect(
      createPlayer(em, {
        token: randomUUID(),
        data: { firstName: 'Ewa', lastName: 'Nowak', nickname: 'as' },
      }),
    ).rejects.toMatchObject({ code: 'NICKNAME_TAKEN' });
  });
});

test('normalizacja pseudonimu odpowiada String.trim dla polskich liter, tabulatorów i NBSP', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: player('\t\u00a0ŻÓŁĆ\u00a0'),
    });

    expect(await getPlayer(em, created.id)).toMatchObject({ nickname: 'ŻÓŁĆ' });
    await expect(
      createPlayer(em, {
        token: randomUUID(),
        data: player('żółć'),
      }),
    ).rejects.toMatchObject({ code: 'NICKNAME_TAKEN' });
  });
});

test('waliduje i przycina dane gracza, odrzucając puste i nadmiarowe pola', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: {
        firstName: '  Adam  ',
        lastName: '\tNowak\u00a0',
        nickname: '  As  ',
      },
    });
    expect(await getPlayer(em, created.id)).toMatchObject({
      firstName: 'Adam',
      lastName: 'Nowak',
      nickname: 'As',
    });

    await expect(
      createPlayer(em, {
        token: randomUUID(),
        data: { firstName: ' ', lastName: 'Nowak', nickname: 'inny' },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fields: { firstName: 'Podaj imię.' },
    });
    await expect(
      createPlayer(em, {
        token: randomUUID(),
        data: { firstName: 'Adam', lastName: 'Nowak', nickname: 'x'.repeat(41) },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fields: { nickname: 'Pseudonim może mieć maksymalnie 40 znaków.' },
    });
    await expect(
      createPlayer(em, {
        token: randomUUID(),
        data: { ...player('jeszcze-inny'), admin: true } as never,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

test('równoległa rezerwacja tego samego pseudonimu ma jednego zwycięzcę', async () => {
  await withTestDb(async (_em, context) => {
    const attempts = await Promise.allSettled(
      ['Pierwszy', 'Drugi'].map(firstName =>
        createPlayer(context.orm.em.fork(), {
          token: randomUUID(),
          data: { firstName, lastName: 'Nowak', nickname: ' Wspólny ' },
        }),
      ),
    );

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'NICKNAME_TAKEN' },
    });
  });
});

test('edycja zachowuje id i wykrywa konflikt wersji pod blokadą', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: player('As'),
    });
    const updated = await updatePlayer(em, {
      id: created.id,
      expectedVersion: created.version,
      firstName: 'Ewa',
      lastName: 'Kowalska',
      nickname: 'Ewka',
    });

    expect(updated).toEqual({ id: created.id, version: 2 });
    await expect(
      updatePlayer(em, {
        id: created.id,
        expectedVersion: created.version,
        ...player('kolejny'),
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

test('ponowione usunięcie jest sukcesem bez podbicia wersji mimo starej expectedVersion', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: player('As'),
    });
    const removed = await deletePlayer(em, {
      id: created.id,
      expectedVersion: created.version,
    });

    await expect(
      deletePlayer(em, { id: created.id, expectedVersion: 1 }),
    ).resolves.toEqual(removed);
    await expect(getPlayer(em, created.id)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
    });
    await expect(getPlayer(em, created.id, true)).resolves.toMatchObject({
      version: 2,
      deletedAt: expect.any(String),
    });
  });
});

test('lista zwraca aktywnych graczy stabilnie po 25 i zerowe liczniki relacji', async () => {
  await withTestDb(async em => {
    for (let index = 0; index < 27; index += 1) {
      await createPlayer(em, {
        token: randomUUID(),
        data: player(`Gracz-${String(index).padStart(2, '0')}`),
      });
    }

    const first = await listPlayers(em);
    const second = await listPlayers(em, first.nextCursor ?? undefined);

    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(item => item.id))).toHaveLength(27);
    expect(first.items[0]).toMatchObject({ leagueCount: 0, matchCount: 0 });
  });
});

test('sanityzacja odrzuca SVG, nadmiar bajtów, ponad 16 mln pikseli i animację', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  );
  const hugeDimensions = await sharp({
    create: { width: 4_001, height: 4_001, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const frames = await Promise.all(
    ['red', 'blue'].map(background =>
      sharp({ create: { width: 2, height: 2, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  );
  const animation = await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();

  await expect(sanitizeAvatar(svg)).rejects.toMatchObject({ code: 'INVALID_AVATAR' });
  await expect(sanitizeAvatar(Buffer.alloc(5_000_001))).rejects.toMatchObject({
    code: 'AVATAR_TOO_LARGE',
  });
  await expect(sanitizeAvatar(hugeDimensions)).rejects.toMatchObject({
    code: 'INVALID_AVATAR',
  });
  await expect(sanitizeAvatar(animation)).rejects.toMatchObject({
    code: 'INVALID_AVATAR',
  });
});

test('sanityzacja zachowuje proporcje pionowego i poziomego obrazu w granicy 256 px', async () => {
  const portrait = await sharp({
    create: { width: 300, height: 600, channels: 3, background: 'green' },
  })
    .jpeg()
    .toBuffer();
  const landscape = await sharp({
    create: { width: 600, height: 300, channels: 3, background: 'green' },
  })
    .png()
    .toBuffer();

  const portraitMeta = await sharp(await sanitizeAvatar(portrait)).metadata();
  const landscapeMeta = await sharp(await sanitizeAvatar(landscape)).metadata();

  expect(portraitMeta).toMatchObject({ format: 'webp', width: 128, height: 256 });
  expect(landscapeMeta).toMatchObject({ format: 'webp', width: 256, height: 128 });
});

test('ustawienie awatara zapisuje wyłącznie WebP i podbija wersję gracza', async () => {
  await withTestDb(async em => {
    const created = await createPlayer(em, {
      token: randomUUID(),
      data: player('As'),
    });
    const upload = await sharp({
      create: { width: 20, height: 10, channels: 3, background: 'orange' },
    })
      .jpeg()
      .toBuffer();

    await expect(setAvatar(em, created.id, created.version, upload)).resolves.toEqual({
      version: 2,
    });
    const [stored] = await em.getConnection().execute<
      { bytes: Buffer; mime_type: string }[]
    >('select bytes, mime_type from player_avatars where player_id = ?', [created.id]);
    expect(stored?.mime_type).toBe('image/webp');
    expect(Buffer.from(stored?.bytes ?? [])).not.toEqual(upload);
    expect(await sharp(stored?.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 20,
      height: 10,
    });
    await expect(getPlayer(em, created.id)).resolves.toMatchObject({
      version: 2,
      avatarVersion: 2,
    });
  });
});
