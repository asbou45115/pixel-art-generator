import { GIFEncoder, quantize, applyPalette } from './gifenc.js';
import { releaseCanvas, scaleCanvas } from './pixelate.js';
import { throwIfAborted, yieldToMain } from './progress.js';

const ENCODER_MAX_QUEUE = 2;

const CANVAS_MEMORY_MESSAGE =
  'The browser ran out of graphics memory during export. Try a larger pixel size, '
  + 'a smaller export size, or closing other tabs.';

function disposePixelateResult(result) {
  if (!result) return;
  if (!result.pooled) {
    releaseCanvas(result.pixelCanvas);
    if (result.canvas !== result.pixelCanvas) releaseCanvas(result.canvas);
  }
  result.canvas = null;
  result.pixelCanvas = null;
}

function releaseScratch(scratch) {
  if (!scratch) return;
  releaseCanvas(scratch.canvas);
  releaseCanvas(scratch.encodeCanvas);
  scratch.canvas = null;
  scratch.encodeCanvas = null;
}

/**
 * Watches every canvas the export owns for `contextlost`, which Chrome fires when
 * it reclaims canvas backing stores under memory pressure. Without this the
 * surfaces silently go blank and the encoder happily writes solid black frames.
 */
function createCanvasWatchdog() {
  const watched = new WeakSet();
  const state = { lost: false };
  state.watch = (canvas) => {
    if (!canvas || watched.has(canvas)) return canvas;
    watched.add(canvas);
    canvas.addEventListener('contextlost', () => { state.lost = true; });
    return canvas;
  };
  state.assertHealthy = () => {
    if (state.lost) throw new Error(CANVAS_MEMORY_MESSAGE);
  };
  return state;
}

async function waitForEncoder(encoder, maxQueued = ENCODER_MAX_QUEUE) {
  while (encoder.encodeQueueSize > maxQueued) {
    if (encoder.state === 'closed') {
      throw new Error('Video encoder closed unexpectedly.');
    }
    await yieldToMain();
  }
}

function evenDim(n) {
  return n + (n % 2);
}

/** Copy source into a dedicated canvas with H.264-safe even dimensions. */
function prepareEncodeCanvas(source, encW, encH, scratch, watchdog) {
  if (!scratch.encodeCanvas || scratch.encodeCanvas.width !== encW || scratch.encodeCanvas.height !== encH) {
    scratch.encodeCanvas = document.createElement('canvas');
    scratch.encodeCanvas.width = encW;
    scratch.encodeCanvas.height = encH;
    watchdog?.watch(scratch.encodeCanvas);
  }
  const ctx = scratch.encodeCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return scratch.encodeCanvas;
}

/**
 * Smallest H.264 level that can carry this frame size and rate. Hard-coding a low
 * level (the old `avc1.42001E` = level 3.0) makes encoders reject large frames.
 */
function h264LevelFor(width, height, fps) {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocks * Math.max(1, fps);
  const levels = [
    [0x1e, 1620, 40500],
    [0x1f, 3600, 108000],
    [0x20, 5120, 216000],
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x32, 22080, 589824],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600],
    [0x3c, 139264, 4177920],
    [0x3d, 139264, 8355840],
    [0x3e, 139264, 16711680],
  ];
  for (const [level, maxMacroblocks, maxRate] of levels) {
    if (macroblocks <= maxMacroblocks && macroblocksPerSecond <= maxRate) return level;
  }
  return 0x3e;
}

function estimateBitrate(width, height, fps) {
  const perSecond = width * height * Math.max(1, Math.min(60, fps)) * 0.07;
  return Math.round(Math.max(1_000_000, Math.min(40_000_000, perSecond)));
}

/** Probe profiles and hardware/software backends until the browser accepts one. */
async function resolveEncoderConfig(width, height, fps) {
  const level = h264LevelFor(width, height, fps).toString(16).padStart(2, '0');
  const bitrate = estimateBitrate(width, height, fps);
  const base = { width, height, bitrate, framerate: Math.max(1, Math.round(fps)) };
  const codecs = [
    `avc1.42e0${level}`,
    `avc1.4200${level}`,
    `avc1.4d00${level}`,
    `avc1.6400${level}`,
  ];
  const backends = ['prefer-hardware', 'no-preference', 'prefer-software'];

  for (const hardwareAcceleration of backends) {
    for (const codec of codecs) {
      const config = { ...base, codec, hardwareAcceleration };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported) return support.config || config;
      } catch {
        // unsupported combination, keep probing
      }
    }
  }
  // Probing can be pessimistic; let configure() have the final say.
  return { ...base, codec: codecs[0] };
}

function createVideoEncoder(muxer) {
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (encoderError) return;
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (err) {
        encoderError = err;
      }
    },
    error: (err) => {
      encoderError = err;
    },
  });
  encoder.getError = () => encoderError;
  return encoder;
}

function assertEncoderReady(encoder, watchdog) {
  watchdog?.assertHealthy();
  const err = encoder.getError?.();
  if (err) throw err;
  if (encoder.state === 'closed') {
    throw new Error('Video encoder closed unexpectedly.');
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function safeCloseEncoder(encoder) {
  if (!encoder || encoder.state === 'closed') return;
  try {
    encoder.close();
  } catch {
    // already closed
  }
}

async function shutdownEncoder(encoder) {
  if (!encoder || encoder.state === 'closed') return;
  try {
    await encoder.flush();
  } catch {
    // ignore flush errors on broken encoders
  }
  safeCloseEncoder(encoder);
}

/** @returns {Promise<{ kind: 'file', stream: FileSystemWritableFileStream, close(): Promise<void>, abort(): Promise<void> } | { kind: 'memory' }>} */
async function openExportFileSink(filename, types) {
  if (typeof window.showSaveFilePicker !== 'function') {
    return { kind: 'memory' };
  }
  const handle = await window.showSaveFilePicker({ suggestedName: filename, types });
  const stream = await handle.createWritable();
  return {
    kind: 'file',
    stream,
    async close() {
      await stream.close();
    },
    async abort() {
      try {
        await stream.abort();
      } catch {
        // ignore
      }
    },
  };
}

async function finishMemoryOrFileExport(fileSink, bytes, mimeType, filename) {
  if (fileSink.kind === 'file') {
    await fileSink.stream.write(bytes);
    await fileSink.close();
    return;
  }
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

function createMp4Muxer(muxerModule, width, height, fileSink) {
  const { Muxer, ArrayBufferTarget, StreamTarget } = muxerModule;
  const encW = evenDim(width);
  const encH = evenDim(height);

  if (fileSink.kind === 'file') {
    let writeQueue = Promise.resolve();
    const streamTarget = new StreamTarget({
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
      onData: (data, position) => {
        writeQueue = writeQueue.then(() =>
          fileSink.stream.write({ type: 'write', data, position }),
        );
      },
    });
    return {
      muxer: new Muxer({
        target: streamTarget,
        video: { codec: 'avc', width: encW, height: encH },
        fastStart: false,
      }),
      bufferTarget: null,
      encodeWidth: encW,
      encodeHeight: encH,
      drainWrites: () => writeQueue,
    };
  }
  const bufferTarget = new ArrayBufferTarget();
  return {
    muxer: new Muxer({
      target: bufferTarget,
      video: { codec: 'avc', width: encW, height: encH },
      fastStart: false,
    }),
    bufferTarget,
    encodeWidth: encW,
    encodeHeight: encH,
    drainWrites: () => Promise.resolve(),
  };
}

function scratchTarget(scratch, w, h, watchdog) {
  if (!scratch) return null;
  if (!scratch.canvas || scratch.canvas.width !== w || scratch.canvas.height !== h) {
    scratch.canvas = document.createElement('canvas');
    scratch.canvas.width = w;
    scratch.canvas.height = h;
    watchdog?.watch(scratch.canvas);
  }
  return scratch.canvas;
}

export function pickExportCanvas(result, exportSize, scratch = null, watchdog = null) {
  if (exportSize === 'source' && result.pixelCanvas && result.sourceWidth && result.sourceHeight) {
    if (result.pixelWidth < result.sourceWidth || result.pixelHeight < result.sourceHeight) {
      const w = result.sourceWidth;
      const h = result.sourceHeight;
      return scaleCanvas(result.pixelCanvas, w, h, scratchTarget(scratch, w, h, watchdog));
    }
  }
  if (exportSize === 'source') return result.canvas;
  if (exportSize === 'double') {
    const w = result.width * 2;
    const h = result.height * 2;
    return scaleCanvas(result.canvas, w, h, scratchTarget(scratch, w, h, watchdog));
  }
  if (exportSize === 'quad') {
    const w = result.width * 4;
    const h = result.height * 4;
    return scaleCanvas(result.canvas, w, h, scratchTarget(scratch, w, h, watchdog));
  }
  return result.pixelCanvas || result.canvas;
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

function writeGifFrame(encoder, result, exportSize, delay, first, scratch = null, watchdog = null) {
  const canvas = pickExportCanvas(result, exportSize, scratch, watchdog);
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);
  encoder.writeFrame(index, width, height, { palette, delay, first, repeat: 0 });
  return { width, height };
}

async function exportMp4ViaRecorder(animation, pixelateSource, exportSize, onProgress, signal, fileSink = null) {
  const mime = pickRecorderMimeType();
  if (!mime) throw new Error('This browser cannot encode MP4 video.');

  const ownsFileSink = !fileSink;
  fileSink = fileSink || await openExportFileSink('pixel-art.mp4', [
    { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
  ]);
  const scratch = { canvas: null, encodeCanvas: null };
  const watchdog = createCanvasWatchdog();
  let recorder;
  let canvas;
  let ctx;
  const chunks = fileSink.kind === 'memory' ? [] : null;
  let writeQueue = Promise.resolve();
  let stopped;
  let frameDelay = 33;
  let frameIndex = 0;

  try {
    await animation.forEachFrame(async (sourceCanvas, delay) => {
      throwIfAborted(signal);
      watchdog.assertHealthy();
      const result = await pixelateSource(sourceCanvas, frameIndex);
      const frameCanvas = pickExportCanvas(result, exportSize, scratch, watchdog);

      if (!recorder) {
        canvas = document.createElement('canvas');
        canvas.width = frameCanvas.width;
        canvas.height = frameCanvas.height;
        watchdog.watch(canvas);
        ctx = canvas.getContext('2d');
        const fps = Math.min(30, Math.max(1, Math.round(1000 / delay)));
        frameDelay = 1000 / fps;
        const stream = canvas.captureStream(fps);
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
          recorder.ondataavailable = (e) => {
            if (!e.data?.size) return;
            if (fileSink.kind === 'file') {
              writeQueue = writeQueue.then(() => fileSink.stream.write(e.data));
            } else {
              chunks.push(e.data);
            }
          };
        });
        recorder.start(100);
      }

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frameCanvas, 0, 0, canvas.width, canvas.height);
      disposePixelateResult(result);
      frameIndex++;
      onProgress?.(frameIndex, animation.getFrameCount() || frameIndex);
      await new Promise((r) => setTimeout(r, frameDelay));
    }, null, signal);

    if (!recorder) throw new Error('No frames to export.');
    watchdog.assertHealthy();
    recorder.stop();
    await stopped;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const contentType = mime.includes('mp4') ? 'video/mp4' : 'video/webm';
    if (fileSink.kind === 'file') {
      await writeQueue;
      await fileSink.close();
    } else {
      downloadBlob(new Blob(chunks, { type: contentType }), `pixel-art.${ext}`);
    }
  } catch (err) {
    if (ownsFileSink) await fileSink.abort?.();
    throw err;
  } finally {
    releaseScratch(scratch);
    releaseCanvas(canvas);
  }
}

async function exportMp4ViaWebCodecs(
  animation,
  pixelateSource,
  exportSize,
  onProgress,
  signal,
  fileSink = null,
  progressRef = null,
) {
  const ownsFileSink = !fileSink;
  fileSink = fileSink || await openExportFileSink('pixel-art.mp4', [
    { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } },
  ]);
  const muxerModule = await import('./mp4-muxer.js');
  const scratch = { canvas: null, encodeCanvas: null };
  const watchdog = createCanvasWatchdog();
  let muxerSetup = null;
  let encoder = null;
  let timestampUs = 0;
  let frameIndex = 0;

  try {
    await animation.forEachFrame(async (sourceCanvas, delay) => {
      throwIfAborted(signal);
      const result = await pixelateSource(sourceCanvas, frameIndex);
      const frameCanvas = pickExportCanvas(result, exportSize, scratch, watchdog);

      if (!encoder) {
        const fps = Math.max(1, Math.min(60, Math.round(1000 / Math.max(1, delay))));
        muxerSetup = createMp4Muxer(
          muxerModule,
          frameCanvas.width,
          frameCanvas.height,
          fileSink,
        );
        const config = await resolveEncoderConfig(
          muxerSetup.encodeWidth,
          muxerSetup.encodeHeight,
          fps,
        );
        encoder = createVideoEncoder(muxerSetup.muxer);
        try {
          encoder.configure(config);
        } catch (err) {
          throw new Error(
            `This browser cannot encode H.264 at ${muxerSetup.encodeWidth}×${muxerSetup.encodeHeight} `
            + `(${err?.message || err}). Try a smaller export size.`,
          );
        }
      }

      const encodeCanvas = prepareEncodeCanvas(
        frameCanvas,
        muxerSetup.encodeWidth,
        muxerSetup.encodeHeight,
        scratch,
        watchdog,
      );
      // Pixels are copied into the encode canvas by now, so the frame buffers
      // can go back immediately rather than piling up until GC runs.
      disposePixelateResult(result);

      assertEncoderReady(encoder, watchdog);
      await waitForEncoder(encoder);
      const frame = new VideoFrame(encodeCanvas, { timestamp: timestampUs });
      encoder.encode(frame, { keyFrame: frameIndex % 30 === 0 });
      frame.close();
      timestampUs += delay * 1000;
      frameIndex++;
      if (progressRef) progressRef.encodedFrames = frameIndex;
      onProgress?.(frameIndex, animation.getFrameCount() || frameIndex);
      await waitForEncoder(encoder);
      assertEncoderReady(encoder, watchdog);
      await yieldToMain();
    }, null, signal);

    if (!encoder) throw new Error('No frames to export.');
    assertEncoderReady(encoder, watchdog);
    await shutdownEncoder(encoder);
    encoder = null;
    watchdog.assertHealthy();
    await muxerSetup.drainWrites();
    muxerSetup.muxer.finalize();
    await muxerSetup.drainWrites();
    if (fileSink.kind === 'file') {
      await fileSink.close();
    } else {
      downloadBlob(
        new Blob([muxerSetup.bufferTarget.buffer], { type: 'video/mp4' }),
        'pixel-art.mp4',
      );
    }
  } catch (err) {
    if (ownsFileSink) await fileSink.abort?.();
    throw err;
  } finally {
    safeCloseEncoder(encoder);
    releaseScratch(scratch);
  }
}

export async function downloadAnimationStream(animation, format, pixelateSource, exportSize, onProgress, signal) {
  if (format === 'gif') {
    const fileSink = await openExportFileSink('pixel-art.gif', [
      { description: 'GIF image', accept: { 'image/gif': ['.gif'] } },
    ]);
    const encoder = GIFEncoder();
    const scratch = { canvas: null, encodeCanvas: null };
    const watchdog = createCanvasWatchdog();
    let frameIndex = 0;

    try {
      await animation.forEachFrame(async (sourceCanvas, delay) => {
        throwIfAborted(signal);
        watchdog.assertHealthy();
        const result = await pixelateSource(sourceCanvas, frameIndex);
        writeGifFrame(encoder, result, exportSize, delay, frameIndex === 0, scratch, watchdog);
        disposePixelateResult(result);
        frameIndex++;
        onProgress?.(frameIndex, animation.getFrameCount() || frameIndex);
        await yieldToMain();
      }, null, signal);

      watchdog.assertHealthy();
      encoder.finish();
      await finishMemoryOrFileExport(
        fileSink,
        encoder.bytesView(),
        'image/gif',
        'pixel-art.gif',
      );
    } catch (err) {
      await fileSink.abort?.();
      throw err;
    } finally {
      releaseScratch(scratch);
    }
    return;
  }

  if (format !== 'mp4') throw new Error('Unsupported animation export format.');

  const mp4Types = [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }];
  let fileSink = await openExportFileSink('pixel-art.mp4', mp4Types);

  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    try {
      await exportMp4ViaRecorder(animation, pixelateSource, exportSize, onProgress, signal, fileSink);
    } catch (err) {
      await fileSink.abort?.();
      throw err;
    }
    return;
  }

  const progressRef = { encodedFrames: 0 };
  try {
    await exportMp4ViaWebCodecs(
      animation,
      pixelateSource,
      exportSize,
      onProgress,
      signal,
      fileSink,
      progressRef,
    );
  } catch (err) {
    await fileSink.abort?.();
    if (err?.name === 'AbortError') throw err;

    // A mid-export failure means the partial file is garbage. Retrying through
    // MediaRecorder would replay the whole source and can hand back a black
    // video, so surface the real problem instead of silently producing one.
    if (progressRef.encodedFrames > 0) {
      throw new Error(
        `MP4 export failed after ${progressRef.encodedFrames} frames: `
        + `${err?.message || err}`,
      );
    }

    console.warn('WebCodecs MP4 export unavailable, falling back to MediaRecorder:', err);
    fileSink = await openExportFileSink('pixel-art.mp4', mp4Types);
    try {
      await exportMp4ViaRecorder(
        animation,
        pixelateSource,
        exportSize,
        onProgress,
        signal,
        fileSink,
      );
    } catch (fallbackErr) {
      await fileSink.abort?.();
      if (fallbackErr?.name === 'AbortError') throw fallbackErr;
      throw new Error(
        fallbackErr?.message || err?.message || 'MP4 export failed.',
      );
    }
  }
}