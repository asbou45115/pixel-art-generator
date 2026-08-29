const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function createUploadZone({ onFile }) {
  const zone = document.createElement('div');
  zone.className = 'upload-zone';
  zone.innerHTML = `
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Choose image file">
    <div class="upload-inner">
      <span class="upload-icon" aria-hidden="true">+</span>
      <span class="upload-label">Drop image or browse</span>
      <span class="upload-hint">Ctrl+V to paste</span>
    </div>
    <p class="sr-only" aria-live="polite"></p>`;

  const input = zone.querySelector('input');
  const live = zone.querySelector('[aria-live]');

  function handle(file) {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      live.textContent = 'Please upload a PNG, JPG, GIF, or WEBP file.';
      return;
    }
    if (file.size > MAX_SIZE) {
      live.textContent = 'File is too large. Maximum size is 10MB.';
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
    const file = [...(e.clipboardData?.files || [])].find((f) => ACCEPT.includes(f.type));
    if (file) handle(file);
  });

  return zone;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
