/**
 * Decomposes an RGBA image into per-color grayscale layers
 * for use in multi-color string art.
 *
 * Each layer is a Float32Array (0=no contribution, 1=full contribution)
 * representing how much of that thread color is needed at each pixel.
 */

export interface ThreadColor {
  name: string;
  hex: string; // e.g. "#000000"
  r: number;
  g: number;
  b: number;
}

// Predefined common thread color palettes
export const PRESET_PALETTES: Record<string, ThreadColor[]> = {
  cmy: [
    { name: 'Cyan', hex: '#00FFFF', r: 0, g: 255, b: 255 },
    { name: 'Magenta', hex: '#FF00FF', r: 255, g: 0, b: 255 },
    { name: 'Yellow', hex: '#FFFF00', r: 255, g: 255, b: 0 },
    { name: 'Black', hex: '#000000', r: 0, g: 0, b: 0 },
  ],
  rgb: [
    { name: 'Red', hex: '#FF0000', r: 255, g: 0, b: 0 },
    { name: 'Green', hex: '#00FF00', r: 0, g: 255, b: 0 },
    { name: 'Blue', hex: '#0000FF', r: 0, g: 0, b: 255 },
    { name: 'Black', hex: '#000000', r: 0, g: 0, b: 0 },
  ],
  warm: [
    { name: 'Black', hex: '#000000', r: 0, g: 0, b: 0 },
    { name: 'Red', hex: '#CC0000', r: 204, g: 0, b: 0 },
    { name: 'Gold', hex: '#FFD700', r: 255, g: 215, b: 0 },
    { name: 'White', hex: '#FFFFFF', r: 255, g: 255, b: 255 },
  ],
};

/**
 * Parse hex color string to RGB components.
 */
export function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/**
 * Decompose an RGBA image into per-color layers.
 *
 * For each color, compute how much that color contributes to each pixel
 * using dot-product similarity in RGB space.
 *
 * Returns one Float32Array per color (0=no thread needed, 1=full thread needed).
 */
export function decomposeToColorLayers(
  pixels: Uint8ClampedArray,
  size: number,
  colors: ThreadColor[],
): Float32Array[] {
  const layers: Float32Array[] = colors.map(() => new Float32Array(size * size));
  const white = { r: 255, g: 255, b: 255 };

  for (let i = 0; i < size * size; i++) {
    const pr = pixels[i * 4];
    const pg = pixels[i * 4 + 1];
    const pb = pixels[i * 4 + 2];

    for (let c = 0; c < colors.length; c++) {
      const color = colors[c];

      // Contribution: how different is this pixel from the background (white)
      // in the direction of this color vs white?
      // Simple approach: project the pixel color onto the color vector from white

      // Vector from white to color (the thread contribution direction)
      const dvr = (white.r - color.r) / 255;
      const dvg = (white.g - color.g) / 255;
      const dvb = (white.b - color.b) / 255;

      // Vector from white to pixel
      const dpr = (white.r - pr) / 255;
      const dpg = (white.g - pg) / 255;
      const dpb = (white.b - pb) / 255;

      const vecLen = Math.sqrt(dvr * dvr + dvg * dvg + dvb * dvb);
      if (vecLen < 0.001) {
        layers[c][i] = 0;
        continue;
      }

      // Projection (dot product / magnitude)
      const proj = (dpr * dvr + dpg * dvg + dpb * dvb) / (vecLen * vecLen);
      layers[c][i] = Math.max(0, Math.min(1, proj));
    }
  }

  return layers;
}

/**
 * Simplified version: use CMY subtractive mixing.
 * Works well for dark-on-white thread art with standard thread colors.
 */
export function decomposeToCMYK(
  pixels: Uint8ClampedArray,
  size: number,
): { c: Float32Array; m: Float32Array; y: Float32Array; k: Float32Array } {
  const c = new Float32Array(size * size);
  const m = new Float32Array(size * size);
  const y = new Float32Array(size * size);
  const k = new Float32Array(size * size);

  for (let i = 0; i < size * size; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;

    // RGB to CMYK conversion
    const kv = 1 - Math.max(r, g, b);
    if (kv >= 1) {
      k[i] = 1;
    } else {
      const denom = 1 - kv;
      c[i] = (1 - r - kv) / denom;
      m[i] = (1 - g - kv) / denom;
      y[i] = (1 - b - kv) / denom;
      k[i] = kv;
    }
  }

  return { c, m, y, k };
}

/**
 * Given user-chosen thread colors, produce grayscale layers
 * for the string art algorithm using nearest-color projection.
 */
export function buildColorLayers(
  pixels: Uint8ClampedArray,
  size: number,
  colors: ThreadColor[],
): Float32Array[] {
  if (
    colors.length === 4 &&
    colors.some((c) => c.name === 'Cyan') &&
    colors.some((c) => c.name === 'Magenta')
  ) {
    // Use CMYK decomposition for CMY palette
    const { c, m, y, k } = decomposeToCMYK(pixels, size);
    return [c, m, y, k];
  }

  // Generic decomposition for custom colors
  return decomposeToColorLayers(pixels, size, colors);
}
