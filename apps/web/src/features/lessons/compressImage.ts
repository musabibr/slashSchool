/**
 * Client-side image compression before upload: phone photos are scaled so the longest side is at most
 * 1600px and re-encoded as JPEG (quality 0.8). Non-images, GIFs (animation) and SVGs are left untouched,
 * and so is any image the browser cannot decode.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;
/** Types the server accepts as-is; anything else (e.g. HEIC) is always converted when possible. */
const SERVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SKIP_TYPES = ['image/gif', 'image/svg+xml'];

export interface PreparedUpload {
  blob: Blob;
  fileName: string;
}

type Decoded = ImageBitmap | HTMLImageElement;

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> */
    }
  }
  return loadImageElement(file);
}

function dimensions(img: Decoded) {
  return img instanceof HTMLImageElement
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : { width: img.width, height: img.height };
}

function toJpegName(name: string) {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.jpg`;
}

/** Returns the bytes to upload and the file name to send with them. */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const original: PreparedUpload = { blob: file, fileName: file.name };
  if (!file.type.startsWith('image/') || SKIP_TYPES.includes(file.type)) return original;

  let img: Decoded;
  try {
    img = await decode(file);
  } catch {
    return original;
  }
  try {
    const { width, height } = dimensions(img);
    if (!width || !height) return original;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    // JPEG has no alpha: paint transparent areas (PNG/WebP) white instead of black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return original;
    // Already small enough and in a supported format: keep the original if re-encoding did not help.
    if (scale === 1 && blob.size >= file.size && SERVER_IMAGE_TYPES.includes(file.type)) return original;
    return { blob, fileName: toJpegName(file.name) };
  } finally {
    if (!(img instanceof HTMLImageElement)) img.close();
  }
}
