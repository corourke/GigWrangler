// Mobile receipt capture (11-10): get a phone photo ready for the invoice scan before it
// is uploaded. Photos are shrunk and saved as JPEG, which keeps them well under the
// scan's 10 MB limit, quick to send on a phone connection, and turns iPhone HEIC photos
// (which the scan can't read) into JPEG. PDFs go up as they are.

/** The longest side of a photo after shrinking, in pixels: plenty for reading a receipt. */
export const RECEIPT_MAX_EDGE = 2000;
/** JPEG quality for the shrunk photo. */
const JPEG_QUALITY = 0.85;
/** What the ai-scan function reads (its MAX_FILE_SIZE_BYTES). */
export const SCAN_MAX_BYTES = 10 * 1024 * 1024;

/** Image types ai-scan reads as they are (its ALLOWED_MEDIA_TYPES, less PDF). */
const SCANNABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SCANNABLE_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const IMAGE_EXT = new Set([...SCANNABLE_IMAGE_EXT, 'heic', 'heif']);

export interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  release?: () => void;
}

/** Reads and writes images; the browser's by default, a fake in tests (jsdom has no canvas). */
export interface ImageCodec {
  decode(file: File): Promise<DecodedImage>;
  encodeJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
}

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const baseOf = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name) || 'receipt';

const isPdf = (file: File) => file.type === 'application/pdf' || extOf(file.name) === 'pdf';
const isImage = (file: File) => file.type.startsWith('image/') || IMAGE_EXT.has(extOf(file.name));
const isScannableImage = (file: File) => SCANNABLE_IMAGE_TYPES.has(file.type) || SCANNABLE_IMAGE_EXT.has(extOf(file.name));

const tooBig = (file: File) => new Error(`${file.name} is over 10 MB. Receipts can be up to 10 MB.`);

/**
 * The file to upload for a receipt: a photo shrunk to RECEIPT_MAX_EDGE and saved as JPEG,
 * or a PDF as it is. Throws an Error with a message to show when the file can't be used.
 */
export async function prepareReceiptFile(file: File, codec: ImageCodec = browserCodec): Promise<File> {
  if (isPdf(file)) {
    if (file.size > SCAN_MAX_BYTES) throw tooBig(file);
    return file;
  }
  if (!isImage(file)) throw new Error(`${file.name} isn't a photo or a PDF.`);

  let out: File;
  try {
    out = await shrink(file, codec);
  } catch {
    // This browser can't open it. A type the scan reads can still go up as it is.
    if (isScannableImage(file)) {
      if (file.size > SCAN_MAX_BYTES) throw tooBig(file);
      return file;
    }
    throw new Error(`${file.name} can't be read here. Take the photo with the camera, or choose a JPEG, PNG or PDF.`);
  }
  if (out.size > SCAN_MAX_BYTES) throw tooBig(file);
  return out;
}

async function shrink(file: File, codec: ImageCodec): Promise<File> {
  const image = await codec.decode(file);
  try {
    const scale = Math.min(1, RECEIPT_MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const blob = await codec.encodeJpeg(image.source, width, height, JPEG_QUALITY);
    return new File([blob], `${baseOf(file.name)}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    image.release?.();
  }
}

/** The browser's image decoder (an <img>, which also applies the photo's rotation) and a canvas. */
export const browserCodec: ImageCodec = {
  decode: (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: img,
      release: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  }),
  encodeJpeg: (source, width, height, quality) => new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('no canvas'));
    ctx.fillStyle = '#fff'; // a transparent PNG gets a white page, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  }),
};
