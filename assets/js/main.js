import { renderHeader } from './layout.js';
import { createUploadZone } from './upload.js';
import { mountEditor } from './editor.js';
import { loadMediaFile, revokeMediaSource, detectMediaKind } from './media-source.js';
import { createTaskRunner } from './progress.js';

function isAccepted(file) {
  return detectMediaKind(file) !== null;
}

document.addEventListener('DOMContentLoaded', () => {
  const headerSlot = document.getElementById('site-header');
  if (headerSlot) headerSlot.innerHTML = renderHeader();

  const landing = document.getElementById('landing');
  const uploadMount = document.getElementById('upload-mount');
  const editorSection = document.getElementById('editor-section');
  const headerEditorBar = document.getElementById('header-editor-bar');
  const headerFileInput = document.getElementById('header-file-input');
  const tasks = createTaskRunner();

  let activeMedia = null;
  let activeEditor = null;
  let loadGeneration = 0;

  if (!uploadMount) return;

  function setEditorMode(open) {
    landing.classList.toggle('hidden', open);
    editorSection.classList.toggle('visible', open);
    headerEditorBar?.classList.toggle('hidden', !open);
    document.body.classList.toggle('editor-open', open);
  }

  function cleanupEditor() {
    if (activeEditor?._cleanup) activeEditor._cleanup();
    activeEditor = null;
    editorSection.innerHTML = '';
    if (headerEditorBar) headerEditorBar.innerHTML = '';
  }

  async function openFile(file, { replace = false } = {}) {
    if (!isAccepted(file)) {
      alert('Please upload an image, GIF, or video file.');
      return;
    }

    const gen = ++loadGeneration;
    const result = await tasks.run(async (signal, update) => {
      const media = await loadMediaFile(file, (msg, done, total) => {
        const pct = done && total ? Math.round((done / total) * 100) : undefined;
        update(msg, pct);
      }, signal);
      return media;
    }, { label: 'Opening file…', cancellable: true, progress: true });

    if (result?.cancelled || gen !== loadGeneration) return;
    if (!result) return;

    if (replace && activeEditor) cleanupEditor();
    revokeMediaSource(activeMedia);
    activeMedia = result;

    setEditorMode(true);
    activeEditor = mountEditor(editorSection, activeMedia, {
      headerBar: headerEditorBar,
      onUploadFile: () => headerFileInput?.click(),
      tasks,
    });
  }

  function showLanding() {
    ++loadGeneration;
    tasks.cancel();
    cleanupEditor();
    revokeMediaSource(activeMedia);
    activeMedia = null;
    setEditorMode(false);
  }

  const zone = createUploadZone({
    onFile: (file) => { openFile(file, { replace: Boolean(activeEditor) }); },
  });
  uploadMount.appendChild(zone);

  headerFileInput?.addEventListener('change', () => {
    const file = headerFileInput.files?.[0];
    headerFileInput.value = '';
    if (!file) return;
    openFile(file, { replace: Boolean(activeEditor) });
  });

  document.querySelector('.logo')?.addEventListener('click', (e) => {
    if (activeEditor) {
      e.preventDefault();
      showLanding();
    }
  });
});
