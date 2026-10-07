export type PreparedImage = {
  /** The picture as WebP, base64 without the data: prefix. */
  base64: string;
  bytes: number;
  originalBytes: number;
  width: number;
  height: number;
};

/**
 * Browser-side image preparation, run before every upload so the site never has to serve a camera original:
 *  - decodes with the camera's rotation applied, scales down to `maxWidth` (never up),
 *  - re-encodes as WebP, which also removes EXIF data such as the GPS location in phone photos,
 *  - keeps lowering the quality (and then the size) until the file is small enough for phones on 4G.
 * The website build then makes smaller AVIF/WebP copies from this file (scripts/lib/optimize-uploads.mjs).
 */
export async function compressImage(
  file: File,
  maxWidth = 1600,
  maxBytes = 300 * 1024,
): Promise<PreparedImage> {
  if (!/^image\/(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.type)) {
    throw new Error('Choose a JPG, PNG or WebP image. (SVG files are not accepted.)');
  }
  if (file.size > 25 * 1024 * 1024)
    throw new Error('That image is over 25 MB. Choose a smaller one.');

  const bitmap = await decode(file);
  const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));
  let w = Math.max(1, Math.round(bitmap.width * scale));
  let h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot process images.');
  ctx.imageSmoothingQuality = 'high';

  const encode = (q: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', q));
  let blob: Blob | null = null;
  // Up to three rounds: best quality first; if even the lowest sensible quality is too big, shrink the picture.
  for (let round = 0; round < 3; round++) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bitmap, 0, 0, w, h);
    let quality = 0.82;
    blob = await encode(quality);
    if (!blob || blob.type !== 'image/webp')
      throw new Error('This browser cannot convert images to WebP. Use Chrome, Edge or Firefox.');
    while (blob.size > maxBytes && quality > 0.5) {
      quality -= 0.08;
      blob = (await encode(quality)) ?? blob;
    }
    if (blob.size <= maxBytes) break;
    w = Math.max(1, Math.round(w * 0.85));
    h = Math.max(1, Math.round(h * 0.85));
  }
  bitmap.close?.();
  if (!blob || blob.size > 1.4 * 1024 * 1024)
    throw new Error('The image is still too large after compression. Choose a smaller picture.');
  return {
    base64: await blobToBase64(blob),
    bytes: blob.size,
    originalBytes: file.size,
    width: w,
    height: h,
  };
}

/** Decode with the EXIF rotation applied (a phone photo taken upright must not come out sideways). */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error('This file could not be read as a picture. Try a JPG or PNG.');
    }
  }
}

export async function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file);
}

/** "2.4 MB" / "86 KB" for the confirmation message. */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}
