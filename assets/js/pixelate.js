import { hexToRgb, rgbToHex } from './palettes.js';

const MAX_EDGE = 2200;

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clampByte(v) {
  return clamp(Math.round(v), 0, 255);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function resizeImage(img, maxEdge) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  if (scale >= 1) return img;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildFilterString(brightness, contrast, saturation) {
  const parts = [];
  if (brightness !== 0) parts.push(`brightness(${100 + brightness}%)`);
  if (contrast !== 0) parts.push(`contrast(${100 + contrast}%)`);
  if (saturation !== 0) parts.push(`saturate(${100 + saturation}%)`);
  return parts.length ? parts.join(' ') : 'none';
}

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// CIE LAB conversion
const LAB = { XN: 0.95047, YN: 1, ZN: 1.08883, EPSILON: 0.008856, KAPPA: 903.3 };

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labF(t) {
  return t > LAB.EPSILON ? Math.cbrt(t) : (LAB.KAPPA * t + 16) / 116;
}

function rgbToLab(rgb) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  const fx = labF(x / LAB.XN);
  const fy = labF(y / LAB.YN);
  const fz = labF(z / LAB.ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function nearestPaletteIndex(r, g, b, palette, useLab, labPalette) {
  let best = 0;
  let bestD = Infinity;
  let lr, lg, lb;
  if (useLab) [lr, lg, lb] = rgbToLab([r, g, b]);
  for (let i = 0; i < palette.length; i++) {
    let d;
    if (useLab) {
      const [pr, pg, pb] = labPalette[i];
      const dr = lr - pr, dg = lg - pg, db = lb - pb;
      d = dr * dr + dg * dg + db * db;
    } else {
      const [pr, pg, pb] = palette[i];
      const dr = r - pr, dg = g - pg, db = b - pb;
      d = dr * dr + dg * dg + db * db;
    }
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function extractPalette(imageData, count) {
  const pixels = [];
  const d = imageData.data;
  const step = Math.max(1, Math.floor((d.length / 4) / 8000));
  for (let i = 0; i < d.length; i += 4 * step) {
    if (d[i + 3] < 128) continue;
    pixels.push([d[i], d[i + 1], d[i + 2]]);
  }
  if (!pixels.length) return [[0, 0, 0]];

  let centers = pixels.slice(0, count);
  for (let iter = 0; iter < 10; iter++) {
    const buckets = Array.from({ length: count }, () => []);
    for (const p of pixels) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const dr = p[0] - centers[j][0], dg = p[1] - centers[j][1], db = p[2] - centers[j][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bd) { bd = dist; bi = j; }
      }
      buckets[bi].push(p);
    }
    for (let j = 0; j < count; j++) {
      if (!buckets[j].length) continue;
      centers[j] = buckets[j].reduce(
        (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
        [0, 0, 0],
      ).map((v) => v / buckets[j].length);
    }
  }
  return centers.map((c) => c.map(clampByte));
}

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => (v + 0.5) / 16 - 0.5);

const BAYER_8X8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64 - 0.5);

function applyOrderedDither(d, out, w, h, x, y, palette, useLab, labPalette, matrix, size, strength) {
  const i = (y * w + x) * 4;
  if (d[i + 3] < 10) { out[i + 3] = d[i + 3]; return; }
  const threshold = matrix[(y & (size - 1)) * size + (x & (size - 1))] * 32 * strength;
  const r = clampByte(d[i] + threshold);
  const g = clampByte(d[i + 1] + threshold);
  const b = clampByte(d[i + 2] + threshold);
  const idx = nearestPaletteIndex(r, g, b, palette, useLab, labPalette);
  out[i] = palette[idx][0];
  out[i + 1] = palette[idx][1];
  out[i + 2] = palette[idx][2];
  out[i + 3] = d[i + 3];
}

function quantizeImageData(imageData, palette, options) {
  const { dither = 'none', ditherStrength = 100, colorDistance = 'rgb' } = options;
  const { width: w, height: h, data: d } = imageData;
  const out = new Uint8ClampedArray(d);
  const useLab = colorDistance === 'lab';
  const labPalette = useLab ? palette.map((c) => rgbToLab(c)) : null;
  const strength = clamp(ditherStrength, 0, 100) / 100;

  if (dither === 'none' || strength === 0) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) { out[i + 3] = d[i + 3]; continue; }
      const idx = nearestPaletteIndex(d[i], d[i + 1], d[i + 2], palette, useLab, labPalette);
      out[i] = palette[idx][0]; out[i + 1] = palette[idx][1]; out[i + 2] = palette[idx][2]; out[i + 3] = d[i + 3];
    }
    return new ImageData(out, w, h);
  }

  if (dither === 'ordered') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        applyOrderedDither(d, out, w, h, x, y, palette, useLab, labPalette, BAYER_4X4, 4, strength);
      }
    }
    return new ImageData(out, w, h);
  }

  if (dither === 'ordered-8x8') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        applyOrderedDither(d, out, w, h, x, y, palette, useLab, labPalette, BAYER_8X8, 8, strength);
      }
    }
    return new ImageData(out, w, h);
  }

  // Floyd-Steinberg error diffusion
  const buf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bi = (y * w + x) * 3;
      const i = (y * w + x) * 4;
      buf[bi] = d[i]; buf[bi + 1] = d[i + 1]; buf[bi + 2] = d[i + 2];
    }
  }

  const spread = (nx, ny, er, eg, eb, factor) => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    const ti = (ny * w + nx) * 3;
    buf[ti] += er * factor;
    buf[ti + 1] += eg * factor;
    buf[ti + 2] += eb * factor;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bi = (y * w + x) * 3;
      const i = (y * w + x) * 4;
      const oldR = buf[bi], oldG = buf[bi + 1], oldB = buf[bi + 2];
      const idx = nearestPaletteIndex(oldR, oldG, oldB, palette, useLab, labPalette);
      const [nr, ng, nb] = palette[idx];
      out[i] = nr; out[i + 1] = ng; out[i + 2] = nb; out[i + 3] = d[i + 3];

      const er = (oldR - nr) * strength;
      const eg = (oldG - ng) * strength;
      const eb = (oldB - nb) * strength;

      spread(x + 1, y, er, eg, eb, 7 / 16);
      spread(x - 1, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16);
      spread(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return new ImageData(out, w, h);
}

function applyPalette(canvas, paletteRgb, options) {
  if (!paletteRgb?.length) return;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(quantizeImageData(imageData, paletteRgb, options), 0, 0);
}

function downscaleSmooth(src, srcW, srcH, dw, dh, filterString) {
  const canvas = createCanvas(dw, dh);
  const ctx = canvas.getContext('2d');
  ctx.filter = filterString;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, dw, dh);
  ctx.filter = 'none';
  return canvas;
}

function upscaleNearest(src, sw, sh, tw, th) {
  const canvas = createCanvas(tw, th);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.filter = 'none';
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
  return canvas;
}

function fitToCanvas(img, targetW, targetH, fit, filterString) {
  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  const sw = img.width || img.naturalWidth;
  const sh = img.height || img.naturalHeight;
  const scale = fit === 'contain'
    ? Math.min(targetW / sw, targetH / sh)
    : Math.max(targetW / sw, targetH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (targetW - dw) / 2;
  const dy = (targetH - dh) / 2;
  ctx.filter = filterString;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = 'none';
  return canvas;
}

export async function pixelateImage(source, options = {}) {
  const {
    pixelSize = 8,
    brightness = 0,
    contrast = 0,
    saturation = 0,
    paletteColors = null,
    dither = 'none',
    ditherStrength = 100,
    autoPalette = false,
    paletteSize = 16,
    colorDistance = 'rgb',
    outputWidth = 0,
    outputHeight = 0,
    outputFit = 'cover',
  } = options;

  const filterString = buildFilterString(brightness, contrast, saturation);
  const quantizeOpts = { dither, ditherStrength, colorDistance };

  const img = typeof source === 'string' ? await loadImage(source) : source;
  const resized = resizeImage(img, MAX_EDGE);
  const sourceW = resized.width || resized.naturalWidth;
  const sourceH = resized.height || resized.naturalHeight;

  let pixelCanvas;
  let previewCanvas;
  let pixelW;
  let pixelH;

  if (outputWidth > 0 && outputHeight > 0) {
    pixelCanvas = fitToCanvas(resized, outputWidth, outputHeight, outputFit === 'contain' ? 'contain' : 'cover', filterString);
    pixelW = pixelCanvas.width;
    pixelH = pixelCanvas.height;
    previewCanvas = pixelCanvas;
  } else if (pixelSize > 1) {
    pixelW = Math.max(1, Math.floor(sourceW / pixelSize));
    pixelH = Math.max(1, Math.floor(sourceH / pixelSize));
    // Smooth downscale first (averages colors per block), then quantize at pixel resolution
    pixelCanvas = downscaleSmooth(resized, sourceW, sourceH, pixelW, pixelH, filterString);
    previewCanvas = upscaleNearest(pixelCanvas, pixelW, pixelH, sourceW, sourceH);
  } else {
    pixelCanvas = createCanvas(sourceW, sourceH);
    const ctx = pixelCanvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(resized, 0, 0);
    ctx.filter = 'none';
    pixelW = sourceW;
    pixelH = sourceH;
    previewCanvas = pixelCanvas;
  }

  let palRgb = null;
  if (paletteColors?.length) {
    palRgb = paletteColors.map(hexToRgb);
  } else if (autoPalette) {
    const ctx = pixelCanvas.getContext('2d');
    palRgb = extractPalette(ctx.getImageData(0, 0, pixelW, pixelH), clamp(paletteSize, 2, 64));
  }

  if (palRgb) {
    applyPalette(pixelCanvas, palRgb, quantizeOpts);
    if (previewCanvas !== pixelCanvas) {
      previewCanvas = upscaleNearest(pixelCanvas, pixelW, pixelH, sourceW, sourceH);
    }
  }

  return {
    canvas: previewCanvas,
    pixelCanvas,
    width: previewCanvas.width,
    height: previewCanvas.height,
    pixelWidth: pixelW,
    pixelHeight: pixelH,
    sourceWidth: sourceW,
    sourceHeight: sourceH,
  };
}

async function prepareSourceFrame(source, options) {
  const {
    pixelSize = 8,
    brightness = 0,
    contrast = 0,
    saturation = 0,
    outputWidth = 0,
    outputHeight = 0,
    outputFit = 'cover',
  } = options;

  const filterString = buildFilterString(brightness, contrast, saturation);
  const img = typeof source === 'string' ? await loadImage(source) : source;
  const resized = resizeImage(img, MAX_EDGE);
  const sourceW = resized.width || resized.naturalWidth;
  const sourceH = resized.height || resized.naturalHeight;

  let pixelCanvas;
  let pixelW;
  let pixelH;

  if (outputWidth > 0 && outputHeight > 0) {
    pixelCanvas = fitToCanvas(resized, outputWidth, outputHeight, outputFit === 'contain' ? 'contain' : 'cover', filterString);
    pixelW = pixelCanvas.width;
    pixelH = pixelCanvas.height;
  } else if (pixelSize > 1) {
    pixelW = Math.max(1, Math.floor(sourceW / pixelSize));
    pixelH = Math.max(1, Math.floor(sourceH / pixelSize));
    pixelCanvas = downscaleSmooth(resized, sourceW, sourceH, pixelW, pixelH, filterString);
  } else {
    pixelCanvas = createCanvas(sourceW, sourceH);
    const ctx = pixelCanvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(resized, 0, 0);
    ctx.filter = 'none';
    pixelW = sourceW;
    pixelH = sourceH;
  }

  return { pixelCanvas, pixelW, pixelH };
}

export async function getAutoPaletteHexColors(source, options = {}) {
  const { paletteSize = 16 } = options;
  const { pixelCanvas, pixelW, pixelH } = await prepareSourceFrame(source, options);
  const ctx = pixelCanvas.getContext('2d');
  const palRgb = extractPalette(ctx.getImageData(0, 0, pixelW, pixelH), clamp(paletteSize, 2, 64));
  return palRgb.map((c) => rgbToHex(c[0], c[1], c[2]));
}

export async function resolvePixelateOptions(source, options = {}) {
  const { paletteColors, autoPalette } = options;
  if (paletteColors?.length) return options;
  if (!autoPalette) return options;
  const colors = await getAutoPaletteHexColors(source, options);
  return { ...options, autoPalette: false, paletteColors: colors };
}

export async function pixelateFrames(sources, options = {}, onProgress, signal) {
  const resolved = await resolvePixelateOptions(sources[0], options);
  const results = [];
  for (let i = 0; i < sources.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    results.push(await pixelateImage(sources[i], resolved));
    onProgress?.(i + 1, sources.length);
    if (i < sources.length - 1) await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}

export function scaleCanvas(src, targetW, targetH) {
  return upscaleNearest(src, src.width, src.height, targetW, targetH);
}

export function downloadCanvas(canvas, filename, format = 'png', quality = 0.92) {
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, mime, quality);
}
