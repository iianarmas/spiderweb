import { FrameShape } from '../store/projectStore';
import { WORKING_SIZE } from './imageProcessing';

export interface NailPosition {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
}

/**
 * Compute nail positions around the perimeter of the given shape.
 * Returns normalized [0,1] coordinates.
 */
export function computeNailPositions(shape: FrameShape, nailCount: number): NailPosition[] {
  const positions: NailPosition[] = [];

  if (shape === 'circle') {
    for (let i = 0; i < nailCount; i++) {
      const angle = (2 * Math.PI * i) / nailCount - Math.PI / 2;
      positions.push({
        x: 0.5 + 0.5 * Math.cos(angle),
        y: 0.5 + 0.5 * Math.sin(angle),
      });
    }
  } else {
    // Square or rectangle: distribute nails along 4 edges proportionally
    // For square: equal nails per side. For rectangle: proportional to side length.
    // We normalize to perimeter position [0, 1]
    // Sides: top (left→right), right (top→bottom), bottom (right→left), left (bottom→top)
    for (let i = 0; i < nailCount; i++) {
      const t = i / nailCount; // 0..1 along perimeter
      const side = Math.floor(t * 4);
      const frac = (t * 4) % 1;

      let x = 0;
      let y = 0;
      // Add small margin from edges so nails don't sit exactly at corners
      const margin = 0.02;
      const range = 1 - 2 * margin;

      switch (side) {
        case 0: x = margin + frac * range; y = margin; break; // top
        case 1: x = 1 - margin; y = margin + frac * range; break; // right
        case 2: x = 1 - margin - frac * range; y = 1 - margin; break; // bottom
        case 3: x = margin; y = 1 - margin - frac * range; break; // left
      }
      positions.push({ x, y });
    }
  }

  return positions;
}

/**
 * Precompute pixel indices for every nail-to-nail line using Bresenham's algorithm.
 * Returns a 2D array: lines[i][j] = array of pixel indices for the line from nail i to nail j.
 */
export function precomputeLines(
  nails: NailPosition[],
  size: number,
): number[][][] {
  const n = nails.length;
  const lines: number[][][] = Array.from({ length: n }, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pixels = bresenham(
        Math.round(nails[i].x * (size - 1)),
        Math.round(nails[i].y * (size - 1)),
        Math.round(nails[j].x * (size - 1)),
        Math.round(nails[j].y * (size - 1)),
        size,
      );
      lines[i][j] = pixels;
      lines[j][i] = pixels;
    }
    lines[i][i] = [];
  }

  return lines;
}

function bresenham(x0: number, y0: number, x1: number, y1: number, size: number): number[] {
  const pixels: number[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      pixels.push(y * size + x);
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }

  return pixels;
}

export interface AlgorithmProgress {
  step: number;
  total: number;
  percent: number;
}

/**
 * Run the greedy string art algorithm.
 * @param gray - grayscale float array (0=white/empty, 1=black/full)
 * @param lines - precomputed pixel lines between nails
 * @param nailCount - number of nails
 * @param stringCount - max number of strings to place
 * @param minNailDistance - minimum nail index distance to avoid adjacent nails (default 20)
 * @param stringDarkness - how much each string darkens a pixel (0..1, default 0.15)
 * @param onProgress - progress callback
 * @returns ordered array of nail indices
 */
export async function runStringArtAlgorithm(
  gray: Float32Array,
  lines: number[][][],
  nailCount: number,
  stringCount: number,
  onProgress?: (progress: AlgorithmProgress) => void,
  minNailDistance = 20,
  stringDarkness = 0.15,
): Promise<number[]> {
  const residual = new Float32Array(gray); // copy — will be modified
  const sequence: number[] = [0]; // start at nail 0
  let currentNail = 0;

  // Precompute per-line sums for faster greedy selection
  const YIELD_EVERY = 100; // yield control every N iterations to avoid blocking

  for (let step = 0; step < stringCount; step++) {
    let bestNail = -1;
    let bestScore = -Infinity;

    for (let j = 0; j < nailCount; j++) {
      // Skip nails too close to current nail (avoids adjacent nail wrapping)
      const dist = Math.min(
        Math.abs(j - currentNail),
        nailCount - Math.abs(j - currentNail),
      );
      if (dist < minNailDistance) continue;

      const linePixels = lines[currentNail][j];
      if (!linePixels || linePixels.length === 0) continue;

      // Score = average residual darkness along the line
      let sum = 0;
      for (const px of linePixels) {
        sum += residual[px];
      }
      const score = sum / linePixels.length;

      if (score > bestScore) {
        bestScore = score;
        bestNail = j;
      }
    }

    if (bestNail === -1 || bestScore <= 0) break; // no improvement possible

    // Subtract this string's contribution from residual
    const linePixels = lines[currentNail][bestNail];
    for (const px of linePixels) {
      residual[px] = Math.max(0, residual[px] - stringDarkness);
    }

    sequence.push(bestNail);
    currentNail = bestNail;

    // Yield control and report progress
    if (step % YIELD_EVERY === 0) {
      if (onProgress) {
        onProgress({
          step,
          total: stringCount,
          percent: Math.round((step / stringCount) * 100),
        });
      }
      // Yield to JS event loop
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress?.({ step: stringCount, total: stringCount, percent: 100 });
  return sequence;
}

/**
 * Convenience wrapper that does full image→nail sequence pipeline.
 */
export async function computeStringArt(
  gray: Float32Array,
  nails: NailPosition[],
  stringCount: number,
  onProgress?: (progress: AlgorithmProgress) => void,
): Promise<number[]> {
  const lines = precomputeLines(nails, WORKING_SIZE);
  return runStringArtAlgorithm(gray, lines, nails.length, stringCount, onProgress);
}
