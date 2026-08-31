import { hexToRgb, rgbToHex } from './palettes.js';

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

/** Immediately drops a canvas' backing store instead of waiting for GC. */
export function releaseCanvas(canvas) {
  if (!canvas || typeof canvas.width !== 'number') return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Keeps one reusable canvas per role. Long exports allocate thousands of frames;
 * without reuse the browser hits its canvas memory ceiling and hands back blank
 * surfaces, which encode as solid black.
 */
export function createCanvasStore() {
  const canvases = new Map();
  return {
    get(key, w, h) {
      let canvas = canvases.get(key);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvases.set(key, canvas);
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return canvas;
    },
    release() {
      for (const canvas of canvases.values()) releaseCanvas(canvas);
      canvases.clear();
    },
  };
}

function prepareTarget(target, w, h) {
  if (!target) return createCanvas(w, h);
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  return target;
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

function downscaleSmooth(src, srcW, srcH, dw, dh, filterString, target = null) {
  const canvas = prepareTarget(target, dw, dh);
  const ctx = canvas.getContext('2d');
  ctx.filter = filterString;
  ctx.imageSmoothingEnabled = true;
  // 'copy' replaces whatever a reused canvas already held, so no separate clear pass
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, dw, dh);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  return canvas;
}

function upscaleNearest(src, sw, sh, tw, th, target = null) {
  const canvas = prepareTarget(target, tw, th);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function luminanceAt(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

function grayscaleFromImageData(imageData) {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      gray[y * w + x] = luminanceAt(data, i);
    }
  }
  return gray;
}

function gaussianBlur3x3(gray, w, h) {
  const out = new Float32Array(w * h);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const norm = 16;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = clamp(x + kx, 0, w - 1);
          const ny = clamp(y + ky, 0, h - 1);
          sum += gray[ny * w + nx] * k[ki++];
        }
      }
      out[y * w + x] = sum / norm;
    }
  }
  return out;
}

function sobelGradients(gray, w, h) {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)];
      const tc = gray[(y - 1) * w + x];
      const tr = gray[(y - 1) * w + (x + 1)];
      const ml = gray[y * w + (x - 1)];
      const mr = gray[y * w + (x + 1)];
      const bl = gray[(y + 1) * w + (x - 1)];
      const bc = gray[(y + 1) * w + x];
      const br = gray[(y + 1) * w + (x + 1)];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const idx = y * w + x;
      mag[idx] = Math.hypot(gx, gy);
      dir[idx] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir };
}

function detectSobelEdges(gray, w, h, threshold) {
  const { mag } = sobelGradients(gray, w, h);
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    edges[i] = mag[i] >= threshold ? 255 : 0;
  }
  return edges;
}

function detectCannyEdges(gray, w, h, threshold) {
  const blurred = gaussianBlur3x3(gray, w, h);
  const { mag, dir } = sobelGradients(blurred, w, h);
  const low = threshold * 0.4;
  const high = threshold;
  const suppressed = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const angle = dir[idx];
      const m = mag[idx];
      let q = 255;
      let r = 255;
      const a = ((angle + Math.PI) / Math.PI) * 4;
      const sector = Math.round(a) % 4;

      if (sector === 0) {
        q = mag[idx + 1];
        r = mag[idx - 1];
      } else if (sector === 1) {
        q = mag[(y + 1) * w + (x - 1)];
        r = mag[(y - 1) * w + (x + 1)];
      } else if (sector === 2) {
        q = mag[(y + 1) * w + x];
        r = mag[(y - 1) * w + x];
      } else {
        q = mag[(y - 1) * w + (x - 1)];
        r = mag[(y + 1) * w + (x + 1)];
      }

      suppressed[idx] = m >= q && m >= r ? m : 0;
    }
  }

  const edges = new Uint8Array(w * h);
  const STRONG = 2;
  const WEAK = 1;
  const labels = new Uint8Array(w * h);

  for (let i = 0; i < w * h; i++) {
    if (suppressed[i] >= high) labels[i] = STRONG;
    else if (suppressed[i] >= low) labels[i] = WEAK;
  }

  const queue = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (labels[idx] !== STRONG) continue;
      edges[idx] = 255;
      queue.push(idx);
    }
  }

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % w;
    const y = (idx - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (labels[ni] === WEAK) {
          labels[ni] = STRONG;
          edges[ni] = 255;
          queue.push(ni);
        }
      }
    }
  }

  return edges;
}

function dilateEdges(edges, w, h, thickness) {
  const radius = Math.max(0, Math.round(thickness) - 1);
  if (radius === 0) return edges;
  const out = new Uint8Array(edges);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          out[ny * w + nx] = 255;
        }
      }
    }
  }
  return out;
}

function applyOutlinesToCanvas(canvas, edgeSourceData, options) {
  const {
    edges = 'none',
    edgeThreshold = 50,
    edgeThickness = 1,
  } = options;
  if (!edges || edges === 'none') return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const gray = grayscaleFromImageData(edgeSourceData);
  const threshold = clamp(edgeThreshold, 1, 255);
  let edgeMask = edges === 'canny'
    ? detectCannyEdges(gray, w, h, threshold)
    : detectSobelEdges(gray, w, h, threshold);
  edgeMask = dilateEdges(edgeMask, w, h, edgeThickness);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < w * h; i++) {
    if (!edgeMask[i]) continue;
    const pi = i * 4;
    d[pi] = 0;
    d[pi + 1] = 0;
    d[pi + 2] = 0;
    d[pi + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function fitToCanvas(img, targetW, targetH, fit, filterString, target = null) {
  const canvas = prepareTarget(target, targetW, targetH);
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
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.globalCompositeOperation = 'source-over';
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
    edges = 'none',
    edgeThreshold = 50,
    edgeThickness = 1,
    forExport = false,
    canvasStore = null,
  } = options;

  const filterString = buildFilterString(brightness, contrast, saturation);
  const quantizeOpts = { dither, ditherStrength, colorDistance };
  const edgeOpts = { edges, edgeThreshold, edgeThickness };

  const img = typeof source === 'string' ? await loadImage(source) : source;
  const sourceW = img.width || img.naturalWidth;
  const sourceH = img.height || img.naturalHeight;

  let pixelCanvas;
  let previewCanvas;
  let pixelW;
  let pixelH;

  if (outputWidth > 0 && outputHeight > 0) {
    pixelCanvas = fitToCanvas(
      img,
      outputWidth,
      outputHeight,
      outputFit === 'contain' ? 'contain' : 'cover',
      filterString,
      canvasStore?.get('pixel', outputWidth, outputHeight),
    );
    pixelW = pixelCanvas.width;
    pixelH = pixelCanvas.height;
    previewCanvas = pixelCanvas;
  } else if (pixelSize > 1) {
    pixelW = Math.max(1, Math.floor(sourceW / pixelSize));
    pixelH = Math.max(1, Math.floor(sourceH / pixelSize));
    // Smooth downscale first (averages colors per block), then quantize at pixel resolution
    pixelCanvas = downscaleSmooth(
      img,
      sourceW,
      sourceH,
      pixelW,
      pixelH,
      filterString,
      canvasStore?.get('pixel', pixelW, pixelH),
    );
    previewCanvas = forExport
      ? pixelCanvas
      : upscaleNearest(pixelCanvas, pixelW, pixelH, sourceW, sourceH, canvasStore?.get('preview', sourceW, sourceH));
  } else {
    pixelCanvas = prepareTarget(canvasStore?.get('pixel', sourceW, sourceH), sourceW, sourceH);
    const ctx = pixelCanvas.getContext('2d');
    ctx.filter = filterString;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    pixelW = sourceW;
    pixelH = sourceH;
    previewCanvas = pixelCanvas;
  }

  let palRgb = null;
  const edgeCtx = pixelCanvas.getContext('2d');
  const edgeSourceData = edgeOpts.edges !== 'none'
    ? edgeCtx.getImageData(0, 0, pixelW, pixelH)
    : null;

  if (paletteColors?.length) {
    palRgb = paletteColors.map(hexToRgb);
  } else if (autoPalette) {
    palRgb = extractPalette(edgeSourceData || edgeCtx.getImageData(0, 0, pixelW, pixelH), clamp(paletteSize, 2, 64));
  }

  if (palRgb) {
    applyPalette(pixelCanvas, palRgb, quantizeOpts);
    if (!forExport && previewCanvas !== pixelCanvas) {
      previewCanvas = upscaleNearest(pixelCanvas, pixelW, pixelH, sourceW, sourceH, previewCanvas);
    }
  }

  if (edgeSourceData) {
    applyOutlinesToCanvas(pixelCanvas, edgeSourceData, edgeOpts);
    if (!forExport && previewCanvas !== pixelCanvas) {
      previewCanvas = upscaleNearest(pixelCanvas, pixelW, pixelH, sourceW, sourceH, previewCanvas);
    }
  }

  const outCanvas = forExport ? pixelCanvas : previewCanvas;
  const outW = forExport ? sourceW : outCanvas.width;
  const outH = forExport ? sourceH : outCanvas.height;

  return {
    canvas: outCanvas,
    pixelCanvas,
    width: outW,
    height: outH,
    pixelWidth: pixelW,
    pixelHeight: pixelH,
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    pooled: !!canvasStore,
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
  const sourceW = img.width || img.naturalWidth;
  const sourceH = img.height || img.naturalHeight;

  let pixelCanvas;
  let pixelW;
  let pixelH;

  if (outputWidth > 0 && outputHeight > 0) {
    pixelCanvas = fitToCanvas(img, outputWidth, outputHeight, outputFit === 'contain' ? 'contain' : 'cover', filterString);
    pixelW = pixelCanvas.width;
    pixelH = pixelCanvas.height;
  } else if (pixelSize > 1) {
    pixelW = Math.max(1, Math.floor(sourceW / pixelSize));
    pixelH = Math.max(1, Math.floor(sourceH / pixelSize));
    pixelCanvas = downscaleSmooth(img, sourceW, sourceH, pixelW, pixelH, filterString);
  } else {
    pixelCanvas = createCanvas(sourceW, sourceH);
    const ctx = pixelCanvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(img, 0, 0);
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

export function scaleCanvas(src, targetW, targetH, target = null) {
  return upscaleNearest(src, src.width, src.height, targetW, targetH, target);
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
