import sharp from 'sharp';
import { DomainError } from '@/shared/errors';

const MAX_AVATAR_BYTES = 5_000_000;
const MAX_INPUT_PIXELS = 16_000_000;
const DECODER_TIMEOUT_SECONDS = 5;
const MAX_CONCURRENT_DECODERS = 2;

class DecoderGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async enter(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENT_DECODERS) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

const decoderGate = new DecoderGate();

export async function sanitizeAvatar(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new DomainError('AVATAR_TOO_LARGE');
  }

  const leave = await decoderGate.enter();
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: true,
    }).timeout({ seconds: DECODER_TIMEOUT_SECONDS });
    const metadata = await image.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new DomainError('INVALID_AVATAR');
    }
    return await image
      .rotate()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('INVALID_AVATAR');
  } finally {
    leave();
  }
}
