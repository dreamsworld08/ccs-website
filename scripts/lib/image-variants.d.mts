export const WIDTHS: number[];
export const ENCODE: {
  webp: { quality: number; effort: number };
  avif: { quality: number; effort: number };
};
export function isMaster(urlPath: string): boolean;
export function plan(
  urlPath: string,
  width: number,
): {
  files: { url: string; width: number; format: 'webp' | 'avif' }[];
  webp: [number, string][];
  avif: [number, string][];
};
