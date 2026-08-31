const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const DEFAULT_FRAME_DELAY = 100;
const MIN_FRAME_DELAY = 20;

export function detectMediaKind(file) {
  if (IMAGE_TYPES.has(file.type)) {
    return file.type === 'image/gif' ? 'gif' : 'image';
  }
  if (VIDEO_TYPES.has(file.type) || file.type.startsWith('video/')) return 'video';
  return null;
}

function canvasFromSource(source, w, h, target = null) {
  const canvas = target || document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  // 'copy' fully replaces the previous frame when the canvas is reused
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function releaseCanvas(canvas) {
  if (!canvas || typeof canvas.width !== 'number') return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Round-robin canvas pool. Frame walks allocate one canvas per frame otherwise,
 * which exhausts the browser's canvas memory on long media and silently yields
 * blank surfaces.
 */
function createFramePool(size, width, height) {
  const canvases = [];
  let next = 0;
  return {
    acquire() {
      let canvas = canvases[next];
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvases[next] = canvas;
      }
      next = (next + 1) % size;
      return canvas;
    },
    release() {
      for (const canvas of canvases) releaseCanvas(canvas);
      canvases.length = 0;
    },
  };
}

function createAccessLock() {
  let chain = Promise.resolve();
  return {
    run(fn) {
      const result = chain.then(() => fn());
      chain = result.catch(() => {});
      return result;
    },
  };
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('Could not seek video.'));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

function captureVideoFrameViaRvfc(video, onProgress, signal, { storeCanvas = false } = {}) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    throw new Error(
      'Full-frame video capture requires a modern browser (Chrome, Edge, Firefox, Safari 15.4+).',
    );
  }

  const duration = video.duration || 0;
  if (!duration || !video.videoWidth) throw new Error('Video has no readable frames.');

  const totalMs = Math.round(duration * 1000);
  const delays = [];
  const mediaTimes = [];
  const frames = storeCanvas ? [] : null;
  let prevMediaTime = null;

  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      video.pause();
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!mediaTimes.length) {
        reject(new Error('Video has no readable frames.'));
        return;
      }
      resolve({
        delays,
        mediaTimes,
        frames,
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        frameCount: mediaTimes.length,
      });
    };

    const fail = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    const onError = () => fail(new Error('Could not play video for frame capture.'));
    const onEnded = () => finish();

    const onFrame = (_now, metadata) => {
      if (signal?.aborted) {
        fail(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const mediaTime = metadata.mediaTime;
      if (mediaTimes.length > 0 && prevMediaTime !== null) {
        delays[delays.length - 1] = Math.max(
          MIN_FRAME_DELAY,
          (mediaTime - prevMediaTime) * 1000,
        );
      }
      prevMediaTime = mediaTime;
      delays.push(DEFAULT_FRAME_DELAY);
      mediaTimes.push(mediaTime);

      if (storeCanvas) {
        frames.push({
          canvas: canvasFromSource(video, video.videoWidth, video.videoHeight),
          delay: DEFAULT_FRAME_DELAY,
        });
      }

      const elapsedMs = Math.round(mediaTime * 1000);
      onProgress?.(
        storeCanvas ? `Capturing frame ${mediaTimes.length}…` : `Indexing frame ${mediaTimes.length}…`,
        elapsedMs,
        totalMs,
      );

      const epsilon = 0.001;
      if (video.ended || mediaTime >= duration - epsilon) {
        if (storeCanvas && frames.length > 0 && delays.length === frames.length) {
          frames[frames.length - 1].delay = delays[delays.length - 1];
        }
        finish();
        return;
      }

      video.requestVideoFrameCallback(onFrame);
    };

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.currentTime = 0;
    video.play().then(() => {
      video.requestVideoFrameCallback(onFrame);
    }).catch(onError);
  });
}

export class GifAnimationSource {
  constructor(file, decoder, frameCount) {
    this.label = 'GIF';
    this.file = file;
    this.decoder = decoder;
    this.frameCount = frameCount;
    this.width = 0;
    this.height = 0;
    this.delays = new Array(frameCount);
    this.indexed = true;
    this._accessLock = createAccessLock();
    this._ready = this._init();
  }

  async _init() {
    const { image } = await this.decoder.decode({ frameIndex: 0 });
    this.width = image.displayWidth;
    this.height = image.displayHeight;
    this.delays[0] = image.duration ? Math.max(MIN_FRAME_DELAY, image.duration / 1000) : DEFAULT_FRAME_DELAY;
    image.close();
  }

  async ready() {
    await this._ready;
  }

  getFrameCount() {
    return this.frameCount;
  }

  isIndexed() {
    return true;
  }

  async getDelay(index) {
    await this.ready();
    if (this.delays[index] != null) return this.delays[index];
    return this._accessLock.run(async () => {
      if (this.delays[index] != null) return this.delays[index];
      const { image } = await this.decoder.decode({ frameIndex: index });
      this.delays[index] = image.duration ? Math.max(MIN_FRAME_DELAY, image.duration / 1000) : DEFAULT_FRAME_DELAY;
      image.close();
      return this.delays[index];
    });
  }

  async getSourceFrame(index, signal) {
    return this._accessLock.run(async () => {
      await this.ready();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { image } = await this.decoder.decode({ frameIndex: index });
      this.delays[index] = image.duration ? Math.max(MIN_FRAME_DELAY, image.duration / 1000) : DEFAULT_FRAME_DELAY;
      const canvas = canvasFromSource(image, image.displayWidth, image.displayHeight);
      image.close();
      return canvas;
    });
  }

  async forEachFrame(callback, onProgress, signal) {
    return this._accessLock.run(() => this._forEachFrameLoop(callback, onProgress, signal));
  }

  async _forEachFrameLoop(callback, onProgress, signal) {
    await this.ready();
    let frameCanvas = null;
    try {
      for (let i = 0; i < this.frameCount; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { image } = await this.decoder.decode({ frameIndex: i });
        this.delays[i] = image.duration ? Math.max(MIN_FRAME_DELAY, image.duration / 1000) : DEFAULT_FRAME_DELAY;
        frameCanvas = canvasFromSource(image, image.displayWidth, image.displayHeight, frameCanvas);
        image.close();
        await callback(frameCanvas, this.delays[i], i);
        onProgress?.(i + 1, this.frameCount);
      }
    } finally {
      releaseCanvas(frameCanvas);
    }
  }

  dispose() {
    this.decoder?.close();
  }
}

export class VideoAnimationSource {
  constructor(video, file, url) {
    this.label = 'Video';
    this.video = video;
    this.file = file;
    this.url = url;
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.duration = video.duration || 0;
    this.frameCount = 0;
    this.delays = [];
    this.mediaTimes = [];
    this.indexed = false;
    this._indexPromise = null;
    this._indexAbort = null;
    this._frame0Canvas = null;
    this._accessLock = createAccessLock();
    this._ready = this._captureFrame0();
  }

  async _captureFrame0() {
    await seekVideo(this.video, 0);
    this._frame0Canvas = canvasFromSource(this.video, this.width, this.height);
    this.frameCount = 1;
  }

  async ready() {
    await this._ready;
  }

  getFrameCount() {
    return this.frameCount || 1;
  }

  isIndexed() {
    return this.indexed;
  }

  startIndexing(onProgress, signal) {
    if (this.indexed) return Promise.resolve();
    if (this._indexPromise) return this._indexPromise;

    this._indexAbort = signal;
    this._indexPromise = this._runIndexing(onProgress, signal).finally(() => {
      this._indexAbort = null;
    });
    return this._indexPromise;
  }

  async _runIndexing(onProgress, signal) {
    const result = await captureVideoFrameViaRvfc(this.video, onProgress, signal, { storeCanvas: false });
    this.delays = result.delays;
    this.mediaTimes = result.mediaTimes;
    this.frameCount = result.frameCount;
    this.indexed = true;
    await seekVideo(this.video, 0);
    this._frame0Canvas = canvasFromSource(this.video, this.width, this.height);
  }

  async getDelay(index) {
    await this.ready();
    if (!this.indexed && index > 0) await this.startIndexing();
    if (this._indexPromise) await this._indexPromise;
    return this.delays[index] ?? DEFAULT_FRAME_DELAY;
  }

  async getSourceFrame(index, signal) {
    return this._accessLock.run(async () => {
      await this.ready();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      if (!this.indexed) {
        if (index === 0) return this._frame0Canvas;
        await this.startIndexing(null, signal);
        if (this._indexPromise) await this._indexPromise;
      }

      const time = this.mediaTimes[index];
      if (time == null) throw new Error(`Frame ${index + 1} is not available.`);
      await seekVideo(this.video, time);
      return canvasFromSource(this.video, this.width, this.height);
    });
  }

  async forEachFrame(callback, onProgress, signal) {
    return this._accessLock.run(() => this._forEachFramePlayback(callback, onProgress, signal));
  }

  async _forEachFramePlayback(callback, onProgress, signal) {
    await this.ready();
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      throw new Error(
        'Full-frame video capture requires a modern browser (Chrome, Edge, Firefox, Safari 15.4+).',
      );
    }

    const duration = this.duration;
    let prevMediaTime = null;
    let frameIndex = 0;
    const capturedDelays = [];
    const capturedTimes = [];
    let pendingCanvas = null;
    let pendingIndex = -1;
    // Two slots: the frame being handed to the callback and the one just captured.
    const pool = createFramePool(2, this.width, this.height);

    const walk = new Promise((resolve, reject) => {
      let finished = false;

      const cleanup = () => {
        this.video.pause();
        this.video.removeEventListener('ended', onEnded);
        this.video.removeEventListener('error', onError);
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        const finalize = pendingCanvas != null
          ? Promise.resolve(callback(pendingCanvas, capturedDelays[pendingIndex] ?? DEFAULT_FRAME_DELAY, pendingIndex))
          : Promise.resolve();
        finalize.then(() => {
          if (frameIndex > 0) {
            this.frameCount = frameIndex;
            if (!this.indexed) {
              this.delays = capturedDelays;
              this.mediaTimes = capturedTimes;
              this.indexed = true;
            }
          }
          resolve();
        }).catch(reject);
      };

      const fail = (err) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      };

      const onError = () => fail(new Error('Could not play video for frame capture.'));
      const onEnded = () => finish();

      const scheduleNext = () => {
        if (finished) return;
        this.video.play().then(() => {
          this.video.requestVideoFrameCallback(onFrame);
        }).catch(fail);
      };

      const onFrame = (_now, metadata) => {
        if (signal?.aborted) {
          fail(new DOMException('Aborted', 'AbortError'));
          return;
        }

        this.video.pause();
        const mediaTime = metadata.mediaTime;
        if (pendingCanvas != null && prevMediaTime !== null) {
          const delay = Math.max(MIN_FRAME_DELAY, (mediaTime - prevMediaTime) * 1000);
          capturedDelays[pendingIndex] = delay;
        }
        prevMediaTime = mediaTime;
        capturedDelays.push(DEFAULT_FRAME_DELAY);
        capturedTimes.push(mediaTime);

        const canvas = canvasFromSource(this.video, this.width, this.height, pool.acquire());
        const currentIndex = frameIndex;
        frameIndex++;

        const emitPrevious = pendingCanvas != null
          ? Promise.resolve(callback(
            pendingCanvas,
            capturedDelays[pendingIndex] ?? DEFAULT_FRAME_DELAY,
            pendingIndex,
          ))
          : Promise.resolve();

        pendingCanvas = canvas;
        pendingIndex = currentIndex;

        emitPrevious.then(() => {
          if (finished) return;
          onProgress?.(currentIndex + 1, this.frameCount || frameIndex);

          const epsilon = 0.001;
          if (this.video.ended || mediaTime >= duration - epsilon) {
            finish();
            return;
          }

          scheduleNext();
        }).catch(fail);
      };

      this.video.addEventListener('ended', onEnded);
      this.video.addEventListener('error', onError);
      this.video.currentTime = 0;
      scheduleNext();
    });

    try {
      await walk;
    } finally {
      pool.release();
    }
  }

  cancelIndexing() {
    this._indexAbort?.abort?.();
  }

  dispose() {
    this.cancelIndexing();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

async function openGifAnimation(file) {
  if (!('ImageDecoder' in window)) {
    throw new Error('Animated GIF requires a modern browser with ImageDecoder support.');
  }
  const buffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track.frameCount;
  if (!frameCount) throw new Error('Could not read GIF frames.');

  if (frameCount === 1) return null;

  const animation = new GifAnimationSource(file, decoder, frameCount);
  await animation.ready();
  return {
    animation,
    width: animation.width,
    height: animation.height,
    frameCount,
  };
}

function loadVideoElement(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Could not load video.'));
    video.src = url;
  });
}

async function openVideoAnimation(file, url) {
  const video = await loadVideoElement(url);
  if (!video.duration || !video.videoWidth) {
    throw new Error('Video has no readable frames.');
  }

  const animation = new VideoAnimationSource(video, file, url);
  await animation.ready();
  return {
    animation,
    width: animation.width,
    height: animation.height,
    duration: animation.duration,
    frameCount: 1,
  };
}

export async function loadMediaFile(file, onProgress, signal) {
  const kind = detectMediaKind(file);
  if (!kind) throw new Error('Unsupported file type.');

  onProgress?.('Reading file…');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = URL.createObjectURL(file);

  if (kind === 'image') {
    return {
      kind: 'image',
      file,
      url,
      label: 'Image',
    };
  }

  if (kind === 'gif') {
    onProgress?.('Opening GIF…');
    const gif = await openGifAnimation(file);
    if (!gif) {
      return {
        kind: 'image',
        file,
        url,
        label: 'Image',
      };
    }
    return {
      kind: 'animation',
      file,
      url,
      label: 'GIF',
      animation: gif.animation,
      width: gif.width,
      height: gif.height,
      frameCount: gif.frameCount,
    };
  }

  onProgress?.('Loading video…');
  const video = await openVideoAnimation(file, url);
  return {
    kind: 'animation',
    file,
    url,
    label: 'Video',
    animation: video.animation,
    width: video.width,
    height: video.height,
    duration: video.duration,
    frameCount: video.frameCount,
  };
}

export function revokeMediaSource(media) {
  media?.animation?.dispose?.();
  if (media?.url) URL.revokeObjectURL(media.url);
}
