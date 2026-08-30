import { renderHeader } from './layout.js';
import { createUploadZone } from './upload.js';
import { mountEditor } from './editor.js';
import { loadMediaFile, revokeMediaSource } from './media-source.js';

function createLoadingOverlay() {
  let el = document.getElementById('app-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-loading';
    el.className = 'app-loading hidden';
    el.innerHTML = `
      <div class="app-loading-card">
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <p id="app-loading-text">Loading…</p>
      </div>`;
    document.body.appendChild(el);
  }
  const text = el.querySelector('#app-loading-text');
  return {
    show(message) {
      text.textContent = message;
      el.classList.remove('hidden');
    },
    update(message) {
      text.textContent = message;
    },
    hide() {
      el.classList.add('hidden');
    },
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const headerSlot = document.getElementById('site-header');
  if (headerSlot) headerSlot.innerHTML = renderHeader();

  const landing = document.getElementById('landing');
  const uploadMount = document.getElementById('upload-mount');
  const editorSection = document.getElementById('editor-section');
  const newImageBtn = document.getElementById('new-image-btn');
  const loading = createLoadingOverlay();

  let activeMedia = null;
  let activeEditor = null;

  if (!uploadMount) return;

  function showLanding() {
    loading.hide();
    if (activeEditor?._cleanup) activeEditor._cleanup();
    activeEditor = null;
    revokeMediaSource(activeMedia);
    activeMedia = null;
    editorSection.innerHTML = '';
    editorSection.classList.remove('visible');
    landing.classList.remove('hidden');
    newImageBtn?.classList.add('hidden');
    document.body.classList.remove('editor-open');
  }

  async function showEditor(file) {
    loading.show('Opening file…');
    try {
      const media = await loadMediaFile(file, (msg) => loading.update(msg));
      if (activeEditor?._cleanup) activeEditor._cleanup();
      revokeMediaSource(activeMedia);
      activeMedia = media;
      landing.classList.add('hidden');
      editorSection.classList.add('visible');
      newImageBtn?.classList.remove('hidden');
      document.body.classList.add('editor-open');
      activeEditor = mountEditor(editorSection, media);
    } catch (err) {
      alert(err.message || 'Could not open file.');
      landing.classList.remove('hidden');
    } finally {
      loading.hide();
    }
  }

  const zone = createUploadZone({
    onFile: (file) => { showEditor(file); },
  });
  uploadMount.appendChild(zone);

  newImageBtn?.addEventListener('click', showLanding);
});
