const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 25 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];

function isAccepted(file) {
  if (IMAGE_TYPES.includes(file.type)) return true;
  if (VIDEO_TYPES.includes(file.type) || file.type.startsWith('video/')) return true;
  return false;
}

function maxSizeFor(file) {
  if (file.type.startsWith('video/') || VIDEO_TYPES.includes(file.type)) return MAX_VIDEO_SIZE;
  return MAX_IMAGE_SIZE;
}

export function createUploadZone({ onFile }) {
  const zone = document.createElement('div');
  zone.className = 'upload-zone';
  zone.innerHTML = `
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/*" aria-label="Choose image or video file">
    <div class="upload-inner">
      <span class="upload-icon" aria-hidden="true">+</span>
      <span class="upload-label">Drop image, GIF, or video</span>
      <span class="upload-hint">Ctrl+V to paste an image</span>
    </div>
    <p class="sr-only" aria-live="polite"></p>`;

  const input = zone.querySelector('input');
  const live = zone.querySelector('[aria-live]');

  function handle(file) {
    if (!file) return;
    if (!isAccepted(file)) {
      live.textContent = 'Please upload an image, GIF, or video file.';
      return;
    }
    const maxSize = maxSizeFor(file);
    if (file.size > maxSize) {
      live.textContent = `File is too large. Maximum size is ${Math.round(maxSize / (1024 * 1024))}MB.`;
      return;
    }
    live.textContent = `Selected ${file.name}`;
    onFile(file);
  }

  zone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') input.click();
  });
  input.addEventListener('change', () => handle(input.files[0]));

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handle(e.dataTransfer.files[0]);
  });

  document.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => IMAGE_TYPES.includes(f.type));
    if (file) handle(file);
  });

  return zone;
}
