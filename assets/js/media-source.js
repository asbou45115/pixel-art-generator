const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const MAX_FRAMES = 150;
const MAX_VIDEO_DURATION = 15;
const VIDEO_SAMPLE_FPS = 15;

export function detectMediaKind(file) {
  if (IMAGE_TYPES.has(file.type)) {
    return file.type === 'image/gif' ? 'gif' : 'image';
  }
  if (VIDEO_TYPES.has(file.type) || file.type.startsWith('video/')) return 'video';
  return null;
}

function canvasFromSource(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

async function decodeGifFrames(file) {
  if (!('ImageDecoder' in window)) {
    throw new Error('Animated GIF requires a modern browser with ImageDecoder support.');
  }
  const buffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track.frameCount;
  if (!frameCount) throw new Error('Could not read GIF frames.');

  const take = Math.min(frameCount, MAX_FRAMES);
  const step = frameCount > MAX_FRAMES ? frameCount / take : 1;
  const frames = [];
  let width = 0;
  let height = 0;

  for (let i = 0; i < take; i++) {
    const index = Math.min(frameCount - 1, Math.floor(i * step));
    const { image } = await decoder.decode({ frameIndex: index });
    width = image.displayWidth;
    height = image.displayHeight;
    const delay = image.duration ? Math.max(20, image.duration / 1000) : 100;
    frames.push({ canvas: canvasFromSource(image, width, height), delay });
    image.close();
  }

  decoder.close();
  if (!frames.length) throw new Error('GIF has no frames.');
  return { frames, width, height };
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

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
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

async function extractVideoFrames(video) {
  const duration = Math.min(video.duration || 0, MAX_VIDEO_DURATION);
  if (!duration || !video.videoWidth) throw new Error('Video has no readable frames.');

  const interval = 1 / VIDEO_SAMPLE_FPS;
  const estimated = Math.ceil(duration / interval);
  const frameCount = Math.min(MAX_FRAMES, estimated);
  const frames = [];
  const delay = 1000 / VIDEO_SAMPLE_FPS;

  for (let i = 0; i < frameCount; i++) {
    const t = frameCount === 1 ? 0 : (i / (frameCount - 1)) * duration;
    await seekVideo(video, t);
    frames.push({
      canvas: canvasFromSource(video, video.videoWidth, video.videoHeight),
      delay,
    });
  }

  return {
    frames,
    width: video.videoWidth,
    height: video.videoHeight,
    duration,
  };
}

export async function loadMediaFile(file) {
  const kind = detectMediaKind(file);
  if (!kind) throw new Error('Unsupported file type.');

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
    const { frames, width, height } = await decodeGifFrames(file);
    if (frames.length === 1) {
      return {
        kind: 'image',
        file,
        url,
        label: 'Image',
        previewUrl: url,
      };
    }
    return {
      kind: 'animation',
      file,
      url,
      label: 'GIF',
      frames,
      width,
      height,
      frameCount: frames.length,
    };
  }

  const video = await loadVideoElement(url);
  const { frames, width, height, duration } = await extractVideoFrames(video);
  video.removeAttribute('src');
  video.load();

  return {
    kind: 'animation',
    file,
    url,
    label: 'Video',
    frames,
    width,
    height,
    duration,
    frameCount: frames.length,
  };
}

export function revokeMediaSource(media) {
  if (media?.url) URL.revokeObjectURL(media.url);
}
