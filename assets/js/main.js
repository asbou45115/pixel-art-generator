import { renderHeader } from './layout.js';
import { createUploadZone, fileToDataUrl } from './upload.js';
import { mountEditor } from './editor.js';

document.addEventListener('DOMContentLoaded', () => {
  const headerSlot = document.getElementById('site-header');
  if (headerSlot) headerSlot.innerHTML = renderHeader();

  const landing = document.getElementById('landing');
  const uploadMount = document.getElementById('upload-mount');
  const editorSection = document.getElementById('editor-section');
  const newImageBtn = document.getElementById('new-image-btn');

  if (!uploadMount) return;

  function showLanding() {
    editorSection.innerHTML = '';
    editorSection.classList.remove('visible');
    landing.classList.remove('hidden');
    newImageBtn?.classList.add('hidden');
    document.body.classList.remove('editor-open');
  }

  function showEditor(dataUrl) {
    landing.classList.add('hidden');
    editorSection.classList.add('visible');
    newImageBtn?.classList.remove('hidden');
    document.body.classList.add('editor-open');
    mountEditor(editorSection, dataUrl);
  }

  const zone = createUploadZone({
    onFile: async (file) => {
      const dataUrl = await fileToDataUrl(file);
      showEditor(dataUrl);
    },
  });
  uploadMount.appendChild(zone);

  newImageBtn?.addEventListener('click', showLanding);
});
