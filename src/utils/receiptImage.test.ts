import { describe, it, expect, vi } from 'vitest';
import { prepareReceiptFile, RECEIPT_MAX_EDGE, SCAN_MAX_BYTES, type ImageCodec } from './receiptImage';

/** A codec that "decodes" every image to the given size and encodes a small JPEG. */
function fakeCodec(width: number, height: number, overrides: Partial<ImageCodec> = {}): ImageCodec & { encodeJpeg: ReturnType<typeof vi.fn> } {
  return {
    decode: vi.fn(async () => ({ width, height, source: {} as CanvasImageSource, release: vi.fn() })),
    encodeJpeg: vi.fn(async () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
    ...overrides,
  } as any;
}

const bigFile = (name: string, type: string, bytes: number) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

describe('prepareReceiptFile', () => {
  it('shrinks a large photo to the longest edge and saves it as a JPEG', async () => {
    const codec = fakeCodec(4032, 3024);
    const out = await prepareReceiptFile(new File(['x'], 'IMG_0001.jpeg', { type: 'image/jpeg' }), codec);
    expect(codec.encodeJpeg).toHaveBeenCalledWith(expect.anything(), RECEIPT_MAX_EDGE, 1500, 0.85);
    expect(out.name).toBe('IMG_0001.jpg');
    expect(out.type).toBe('image/jpeg');
  });

  it('keeps a small photo at its own size', async () => {
    const codec = fakeCodec(1200, 1600);
    await prepareReceiptFile(new File(['x'], 'r.png', { type: 'image/png' }), codec);
    expect(codec.encodeJpeg).toHaveBeenCalledWith(expect.anything(), 1200, 1600, 0.85);
  });

  it('turns an iPhone HEIC photo into a JPEG the scan can read', async () => {
    const codec = fakeCodec(3024, 4032);
    const out = await prepareReceiptFile(new File(['x'], 'IMG_0002.HEIC', { type: 'image/heic' }), codec);
    expect(out.name).toBe('IMG_0002.jpg');
    expect(out.type).toBe('image/jpeg');
  });

  it('sends a PDF as it is', async () => {
    const codec = fakeCodec(1, 1);
    const pdf = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
    expect(await prepareReceiptFile(pdf, codec)).toBe(pdf);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it('refuses a PDF over the scan limit', async () => {
    await expect(prepareReceiptFile(bigFile('big.pdf', 'application/pdf', SCAN_MAX_BYTES + 1), fakeCodec(1, 1)))
      .rejects.toThrow('big.pdf is over 10 MB. Receipts can be up to 10 MB.');
  });

  it('sends a readable photo as it is when this browser cannot decode it', async () => {
    const codec = fakeCodec(1, 1, { decode: vi.fn(async () => { throw new Error('no'); }) });
    const jpg = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    expect(await prepareReceiptFile(jpg, codec)).toBe(jpg);
  });

  it('refuses a HEIC photo this browser cannot decode', async () => {
    const codec = fakeCodec(1, 1, { decode: vi.fn(async () => { throw new Error('no'); }) });
    await expect(prepareReceiptFile(new File(['x'], 'r.heic', { type: 'image/heic' }), codec))
      .rejects.toThrow("r.heic can't be read here. Take the photo with the camera, or choose a JPEG, PNG or PDF.");
  });

  it('refuses a file that is not a photo or a PDF', async () => {
    await expect(prepareReceiptFile(new File(['x'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), fakeCodec(1, 1)))
      .rejects.toThrow("notes.docx isn't a photo or a PDF.");
  });

  it('frees the decoded image', async () => {
    const release = vi.fn();
    const codec = fakeCodec(10, 10, { decode: vi.fn(async () => ({ width: 10, height: 10, source: {} as CanvasImageSource, release })) });
    await prepareReceiptFile(new File(['x'], 'r.jpg', { type: 'image/jpeg' }), codec);
    expect(release).toHaveBeenCalled();
  });
});
