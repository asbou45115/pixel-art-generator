import { GIFEncoder, quantize, applyPalette } from './gifenc.js';
import { scaleCanvas } from './pixelate.js';
import { throwIfAborted, yieldToMain } from './progress.js';

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function pickExportCanvas(result, exportSize) {
  let out = result.pixelCanvas || result.canvas;
  if (exportSize === 'source') out = result.canvas;
  else if (exportSize === 'double') out = scaleCanvas(result.canvas, result.width * 2, result.height * 2);
  else if (exportSize === 'quad') out = scaleCanvas(result.canvas, result.width * 4, result.height * 4);
  return out;
}

export async function encodeGif(results, delays, exportSize = 'source', onProgress, signal) {
  const encoder = GIFEncoder();
  let width = 0;
  let height = 0;

  for (let i = 0; i < results.length; i++) {
    throwIfAborted(signal);
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
    onProgress?.(i + 1, results.length);
    await yieldToMain();
  }

  encoder.finish();
  return new Blob([encoder.bytesView()], { type: 'image/gif' });
}

function pickRecorderMimeType() {
  const types = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

async function encodeMp4WithWebCodecs(results, delays, exportSize, onProgress, signal) {
  const { Muxer, ArrayBufferTarget } = await import('./mp4-muxer.js');
  const first = pickExportCanvas(results[0], exportSize);
  const width = first.width;
  const height = first.height;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });

  encoder.configure({
    codec: 'avc1.42001E',
    width,
    height,
    bitrate: 4_000_000,
  });

  let timestampUs = 0;
  for (let i = 0; i < results.length; i++) {
    throwIfAborted(signal);
    const frameCanvas = pickExportCanvas(results[i], exportSize);
    const frame = new VideoFrame(frameCanvas, { timestamp: timestampUs });
    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
    timestampUs += (delays[i] || 100) * 1000;
    onProgress?.(i + 1, results.length);
    await yieldToMain();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

async function encodeMp4WithRecorder(results, delays, exportSize, onProgress, signal) {
  const mime = pickRecorderMimeType();
  if (!mime) throw new Error('This browser cannot encode MP4 video.');

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
    throwIfAborted(signal);
    const frameCanvas = pickExportCanvas(results[i], exportSize);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frameCanvas, 0, 0, width, height);
    onProgress?.(i + 1, results.length);
    await new Promise((r) => setTimeout(r, frameDelay));
  }

  recorder.stop();
  await stopped;
  const ext = mime.includes('mp4') ? 'video/mp4' : 'video/webm';
  return new Blob(chunks, { type: ext });
}

export async function encodeMp4(results, delays, exportSize = 'source', onProgress, signal) {
  if (!results.length) throw new Error('No frames to export.');
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
    try {
      return await encodeMp4WithWebCodecs(results, delays, exportSize, onProgress, signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }
  return encodeMp4WithRecorder(results, delays, exportSize, onProgress, signal);
}

export async function downloadGif(results, delays, exportSize, onProgress, signal) {
  const blob = await encodeGif(results, delays, exportSize, onProgress, signal);
  downloadBlob(blob, 'pixel-art.gif');
}

export async function downloadMp4(results, delays, exportSize, onProgress, signal) {
  const blob = await encodeMp4(results, delays, exportSize, onProgress, signal);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  downloadBlob(blob, `pixel-art.${ext}`);
}
