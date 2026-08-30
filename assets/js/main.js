import { renderHeader } from './layout.js';
import { createUploadZone } from './upload.js';
import { mountEditor } from './editor.js';
import { loadMediaFile, revokeMediaSource } from './media-source.js';

document.addEventListener('DOMContentLoaded', () => {
  const headerSlot = document.getElementById('site-header');
  if (headerSlot) headerSlot.innerHTML = renderHeader();

  const landing = document.getElementById('landing');
  const uploadMount = document.getElementById('upload-mount');
  const editorSection = document.getElementById('editor-section');
  const newImageBtn = document.getElementById('new-image-btn');

  let activeMedia = null;
  let activeEditor = null;

  if (!uploadMount) return;

  function showLanding() {
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
    try {
      const media = await loadMediaFile(file);
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
    }
  }

  const zone = createUploadZone({
    onFile: (file) => { showEditor(file); },
  });
  uploadMount.appendChild(zone);

  newImageBtn?.addEventListener('click', showLanding);
});
