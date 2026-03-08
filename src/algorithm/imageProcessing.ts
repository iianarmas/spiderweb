import * as ImageManipulator from 'expo-image-manipulator';
import { FrameShape } from '../store/projectStore';

export const WORKING_SIZE = 700; // pixels — high accuracy

/**
 * Resize and prepare image for the string art algorithm.
 * Returns a flat Uint8ClampedArray of RGBA pixel data (size x size x 4).
 */
export async function prepareImage(
  uri: string,
  shape: FrameShape,
): Promise<{ pixels: Uint8ClampedArray; size: number }> {
  // Resize to square working size
  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: WORKING_SIZE, height: WORKING_SIZE } }],
    { format: ImageManipulator.SaveFormat.PNG, base64: true },
  );

  const base64 = resized.base64;
  if (!base64) throw new Error('Image processing failed: could not get base64 data from image');
  const pixels = base64ToRGBA(base64, WORKING_SIZE);

  // Apply circular mask for circle shape
  if (shape === 'circle') {
    applyCircularMask(pixels, WORKING_SIZE);
  }

  return { pixels, size: WORKING_SIZE };
}

/**
 * Convert base64 PNG to flat RGBA Uint8ClampedArray.
 * Uses a simple pure-JS PNG decoder approach via raw data URI.
 */
function base64ToRGBA(base64: string, size: number): Uint8ClampedArray {
  // Decode base64 to binary
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Parse PNG IDAT chunks to extract pixel data
  // PNG signature: 8 bytes, then chunks
  // Each chunk: 4 bytes length, 4 bytes type, data, 4 bytes CRC
  // We need to find IHDR for dimensions and IDAT for pixel data
  // For simplicity, use a canvas-based approach via the raw pixel buffer
  // Note: In React Native we rely on expo-image-manipulator which already gives us
  // decoded PNG. We use a simple stride-based parser.

  // Since PNG is compressed (zlib), we use a different approach:
  // Re-encode as raw data and parse the raw bytes from the PNG chunks
  return parsePNGBytes(bytes, size);
}

function parsePNGBytes(bytes: Uint8Array, size: number): Uint8ClampedArray {
  // PNG magic bytes check
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a valid PNG');
    }
  }

  // Collect all IDAT chunks
  const idatChunks: Uint8Array[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;

  while (offset < bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (type === 'IHDR') {
      width = readUint32BE(bytes, offset + 8);
      height = readUint32BE(bytes, offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.slice(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }

    offset += 4 + 4 + length + 4; // length + type + data + CRC
  }

  // Decompress IDAT chunks (zlib/deflate)
  // We combine all IDAT chunks first
  let totalLength = 0;
  for (const chunk of idatChunks) totalLength += chunk.length;
  const compressed = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, pos);
    pos += chunk.length;
  }

  const decompressed = zlibDecompress(compressed);
  return reconstruct(decompressed, width, height, bitDepth, colorType, size);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

// Minimal zlib decompressor (deflate)
function zlibDecompress(data: Uint8Array): Uint8Array {
  // Skip 2-byte zlib header
  return inflate(data.subarray(2, data.length - 4));
}

function inflate(data: Uint8Array): Uint8Array {
  // Implement deflate decompression
  const output: number[] = [];
  let pos = 0;
  let bfinal = 0;

  function readBit(): number {
    const bit = (data[Math.floor(pos / 8)] >> (pos % 8)) & 1;
    pos++;
    return bit;
  }

  function readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val |= readBit() << i;
    }
    return val;
  }

  function readByte(): number {
    // Align to byte boundary
    pos = Math.ceil(pos / 8) * 8;
    const b = data[pos / 8];
    pos += 8;
    return b;
  }

  function readUint16LE(): number {
    pos = Math.ceil(pos / 8) * 8;
    const lo = data[pos / 8];
    const hi = data[pos / 8 + 1];
    pos += 16;
    return lo | (hi << 8);
  }

  // Fixed Huffman trees for literal/length and distance codes
  const fixedLitLen = buildFixedLitLenTree();
  const fixedDist = buildFixedDistTree();

  do {
    bfinal = readBit();
    const btype = readBits(2);

    if (btype === 0) {
      // No compression
      pos = Math.ceil(pos / 8) * 8;
      const len = readUint16LE();
      readUint16LE(); // nlen (ignored)
      for (let i = 0; i < len; i++) {
        output.push(readByte());
      }
    } else if (btype === 1) {
      // Fixed Huffman
      decodeBlock(fixedLitLen, fixedDist, readBit, readBits, output);
    } else if (btype === 2) {
      // Dynamic Huffman
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;

      const clOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const clLens = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) {
        clLens[clOrder[i]] = readBits(3);
      }
      const clTree = buildHuffmanTree(clLens);

      const allLens: number[] = [];
      while (allLens.length < hlit + hdist) {
        const sym = decodeSymbol(clTree, readBit);
        if (sym < 16) {
          allLens.push(sym);
        } else if (sym === 16) {
          const rep = readBits(2) + 3;
          for (let i = 0; i < rep; i++) allLens.push(allLens[allLens.length - 1]);
        } else if (sym === 17) {
          const rep = readBits(3) + 3;
          for (let i = 0; i < rep; i++) allLens.push(0);
        } else {
          const rep = readBits(7) + 11;
          for (let i = 0; i < rep; i++) allLens.push(0);
        }
      }

      const litLenTree = buildHuffmanTree(allLens.slice(0, hlit));
      const distTree = buildHuffmanTree(allLens.slice(hlit));
      decodeBlock(litLenTree, distTree, readBit, readBits, output);
    }
  } while (!bfinal);

  return new Uint8Array(output);
}

interface HuffTree {
  [code: string]: number;
}

function buildHuffmanTree(lengths: number[]): HuffTree {
  const maxBits = Math.max(...lengths);
  const blCount = new Array(maxBits + 1).fill(0);
  for (const l of lengths) if (l > 0) blCount[l]++;

  const nextCode = new Array(maxBits + 2).fill(0);
  for (let bits = 1; bits <= maxBits; bits++) {
    nextCode[bits] = (nextCode[bits - 1] + blCount[bits - 1]) << 1;
  }

  const tree: HuffTree = {};
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (len > 0) {
      const code = nextCode[len].toString(2).padStart(len, '0');
      tree[code] = i;
      nextCode[len]++;
    }
  }
  return tree;
}

function decodeSymbol(tree: HuffTree, readBit: () => number): number {
  let code = '';
  for (let i = 0; i < 16; i++) {
    code += readBit();
    if (code in tree) return tree[code];
  }
  throw new Error('Invalid Huffman code');
}

function buildFixedLitLenTree(): HuffTree {
  const lens: number[] = [];
  for (let i = 0; i <= 143; i++) lens.push(8);
  for (let i = 144; i <= 255; i++) lens.push(9);
  for (let i = 256; i <= 279; i++) lens.push(7);
  for (let i = 280; i <= 287; i++) lens.push(8);
  return buildHuffmanTree(lens);
}

function buildFixedDistTree(): HuffTree {
  const lens = new Array(32).fill(5);
  return buildHuffmanTree(lens);
}

const LENGTH_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const LENGTH_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];

function decodeBlock(
  litLenTree: HuffTree,
  distTree: HuffTree,
  readBit: () => number,
  readBits: (n: number) => number,
  output: number[],
): void {
  while (true) {
    const sym = decodeSymbol(litLenTree, readBit);
    if (sym === 256) break;
    if (sym < 256) {
      output.push(sym);
    } else {
      const li = sym - 257;
      const length = LENGTH_BASE[li] + readBits(LENGTH_EXTRA[li]);
      const distSym = decodeSymbol(distTree, readBit);
      const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
      const start = output.length - dist;
      for (let i = 0; i < length; i++) {
        output.push(output[start + i]);
      }
    }
  }
}

function reconstruct(
  raw: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  targetSize: number,
): Uint8ClampedArray {
  // Determine channels per pixel
  let channels = 0;
  if (colorType === 0) channels = 1; // Grayscale
  else if (colorType === 2) channels = 3; // RGB
  else if (colorType === 3) channels = 1; // Indexed (palette) - simplified
  else if (colorType === 4) channels = 2; // Grayscale+Alpha
  else if (colorType === 6) channels = 4; // RGBA

  const bytesPerPixel = Math.ceil((bitDepth * channels) / 8);
  const stride = width * bytesPerPixel;

  // Un-filter each scanline
  const pixels = new Uint8Array(width * height * bytesPerPixel);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos++];
    const scanline = raw.slice(rawPos, rawPos + stride);
    rawPos += stride;

    const prev = y === 0 ? new Uint8Array(stride) : pixels.slice((y - 1) * stride, y * stride);
    const decoded = unfilter(filterType, scanline, prev, bytesPerPixel);
    pixels.set(decoded, y * stride);
  }

  // Convert to RGBA flat array at targetSize x targetSize
  const result = new Uint8ClampedArray(targetSize * targetSize * 4);
  const scaleX = width / targetSize;
  const scaleY = height / targetSize;

  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      const sx = Math.min(Math.floor(tx * scaleX), width - 1);
      const sy = Math.min(Math.floor(ty * scaleY), height - 1);
      const srcIdx = (sy * width + sx) * bytesPerPixel;
      const dstIdx = (ty * targetSize + tx) * 4;

      if (colorType === 6) {
        result[dstIdx] = pixels[srcIdx];
        result[dstIdx + 1] = pixels[srcIdx + 1];
        result[dstIdx + 2] = pixels[srcIdx + 2];
        result[dstIdx + 3] = pixels[srcIdx + 3];
      } else if (colorType === 2) {
        result[dstIdx] = pixels[srcIdx];
        result[dstIdx + 1] = pixels[srcIdx + 1];
        result[dstIdx + 2] = pixels[srcIdx + 2];
        result[dstIdx + 3] = 255;
      } else if (colorType === 0) {
        const v = pixels[srcIdx];
        result[dstIdx] = v;
        result[dstIdx + 1] = v;
        result[dstIdx + 2] = v;
        result[dstIdx + 3] = 255;
      } else {
        // Fallback
        result[dstIdx] = pixels[srcIdx];
        result[dstIdx + 1] = pixels[srcIdx];
        result[dstIdx + 2] = pixels[srcIdx];
        result[dstIdx + 3] = 255;
      }
    }
  }

  return result;
}

function unfilter(
  type: number,
  scanline: Uint8Array,
  prev: Uint8Array,
  bpp: number,
): Uint8Array {
  const result = new Uint8Array(scanline.length);
  for (let i = 0; i < scanline.length; i++) {
    const raw = scanline[i];
    const a = i >= bpp ? result[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;

    switch (type) {
      case 0: result[i] = raw; break;
      case 1: result[i] = (raw + a) & 0xff; break;
      case 2: result[i] = (raw + b) & 0xff; break;
      case 3: result[i] = (raw + Math.floor((a + b) / 2)) & 0xff; break;
      case 4: result[i] = (raw + paethPredictor(a, b, c)) & 0xff; break;
      default: result[i] = raw;
    }
  }
  return result;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Apply circular mask: pixels outside the circle become white (255).
 */
function applyCircularMask(pixels: Uint8ClampedArray, size: number): void {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) {
        const idx = (y * size + x) * 4;
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = 255;
      }
    }
  }
}

/**
 * Convert RGBA pixels to grayscale Float32Array (0=white, 1=black).
 */
export function toGrayscale(pixels: Uint8ClampedArray, size: number): Float32Array {
  const gray = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    // Luminance formula, then invert (dark pixels = high values = need more strings)
    gray[i] = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return gray;
}

/**
 * Analyze edge density using a simple Sobel filter to recommend string count.
 * Returns a value between 0 and 1 representing edge density.
 */
export function analyzeEdgeDensity(gray: Float32Array, size: number): number {
  let edgeSum = 0;
  let count = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx =
        -gray[(y - 1) * size + (x - 1)] +
        gray[(y - 1) * size + (x + 1)] +
        -2 * gray[y * size + (x - 1)] +
        2 * gray[y * size + (x + 1)] +
        -gray[(y + 1) * size + (x - 1)] +
        gray[(y + 1) * size + (x + 1)];
      const gy =
        gray[(y - 1) * size + (x - 1)] +
        2 * gray[(y - 1) * size + x] +
        gray[(y - 1) * size + (x + 1)] +
        -gray[(y + 1) * size + (x - 1)] +
        -2 * gray[(y + 1) * size + x] +
        -gray[(y + 1) * size + (x + 1)];
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      count++;
    }
  }
  return Math.min(edgeSum / count / Math.SQRT2, 1);
}

/**
 * Recommend nail and string counts based on frame dimensions and image edge density.
 */
export function recommendCounts(
  perimeterCm: number,
  edgeDensity: number,
): { nails: number; strings: number } {
  const nails = Math.round(perimeterCm * 1.5);
  const strings = Math.round(1500 + edgeDensity * 3500);
  return {
    nails: Math.max(100, Math.min(400, nails)),
    strings: Math.max(1500, Math.min(5000, strings)),
  };
}

/**
 * Compute perimeter in cm for a given frame shape and dimensions.
 */
export function computePerimeter(
  shape: FrameShape,
  widthCm: number,
  heightCm: number,
): number {
  if (shape === 'circle') {
    return Math.PI * widthCm; // widthCm = diameter
  }
  return 2 * (widthCm + heightCm);
}
