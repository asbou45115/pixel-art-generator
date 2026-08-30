import { GIFEncoder, quantize, applyPalette } from './gifenc.js';
import { scaleCanvas } from './pixelate.js';

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function pickExportCanvas(result, exportSize) {
  let out = result.pixelCanvas || result.canvas;
  if (exportSize === 'source') out = result.canvas;
  else if (exportSize === 'double') out = scaleCanvas(result.canvas, result.width * 2, result.height * 2);
  else if (exportSize === 'quad') out = scaleCanvas(result.canvas, result.width * 4, result.height * 4);
  return out;
}

export function encodeGif(results, delays, exportSize = 'pixel') {
  const encoder = GIFEncoder();
  let width = 0;
  let height = 0;

  for (let i = 0; i < results.length; i++) {
    const canvas = pickExportCanvas(results[i], exportSize);
    width = canvas.width;
    height = canvas.height;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, width, height, {
      palette,
      delay: delays[i] || 100,
      first: i === 0,
      repeat: 0,
    });
  }

  encoder.finish();
  return new Blob([encoder.bytesView()], { type: 'image/gif' });
}

function pickMimeType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

export async function encodeWebM(results, delays, exportSize = 'pixel', onProgress) {
  if (!results.length) throw new Error('No frames to export.');
  const first = pickExportCanvas(results[0], exportSize);
  const width = first.width;
  const height = first.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const avgDelay = delays.reduce((a, d) => a + d, 0) / delays.length;
  const fps = Math.min(30, Math.max(1, Math.round(1000 / avgDelay)));
  const frameDelay = 1000 / fps;

  const stream = canvas.captureStream(fps);
  const mime = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];

  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
  });

  recorder.start(100);

  for (let i = 0; i < results.length; i++) {
    const frameCanvas = pickExportCanvas(results[i], exportSize);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frameCanvas, 0, 0, width, height);
    onProgress?.(i + 1, results.length);
    await new Promise((r) => setTimeout(r, frameDelay));
  }

  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: mime.split(';')[0] });
}

export function downloadGif(results, delays, exportSize) {
  const blob = encodeGif(results, delays, exportSize);
  downloadBlob(blob, 'pixel-art.gif');
}

export async function downloadWebM(results, delays, exportSize, onProgress) {
  const blob = await encodeWebM(results, delays, exportSize, onProgress);
  downloadBlob(blob, 'pixel-art.webm');
}
