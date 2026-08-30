import { getAllPalettes, loadCustomPalettes, saveCustomPalettes } from './palettes.js';
import { pixelateImage, pixelateFrames, resolvePixelateOptions, downloadCanvas } from './pixelate.js';
import { downloadGif, downloadMp4, pickExportCanvas } from './media-export.js';

const DEFAULTS = {
  pixelSize: 8,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  palette: 'none',
  dither: 'none',
  ditherStrength: 100,
  autoPalette: false,
  paletteSize: 16,
  colorDistance: 'rgb',
  showGrid: false,
  exportFormat: 'png',
  exportSize: 'pixel',
  exportQuality: 0.92,
  outputWidth: 0,
  outputHeight: 0,
  outputFit: 'cover',
};

const THUMB_HEIGHT = 52;

function computeDisplayScale(availW, availH, width, height) {
  if (!width || !height || !availW || !availH) return 1;
  const fit = Math.min(availW / width, availH / height);
  if (fit >= 1) return Math.max(1, Math.floor(fit));
  return fit;
}

function buildPixelateOptions(state, paletteColors) {
  const usePalette = state.autoPalette || (paletteColors && state.palette !== 'none');
  return {
    pixelSize: state.pixelSize,
    brightness: state.brightness,
    contrast: state.contrast,
    saturation: state.saturation,
    paletteColors: usePalette ? paletteColors : null,
    dither: usePalette ? state.dither : 'none',
    ditherStrength: state.ditherStrength,
    autoPalette: state.autoPalette,
    paletteSize: state.paletteSize,
    colorDistance: state.colorDistance,
    outputWidth: state.outputWidth,
    outputHeight: state.outputHeight,
    outputFit: state.outputFit,
  };
}

function settingsKey(state) {
  return JSON.stringify({
    pixelSize: state.pixelSize,
    brightness: state.brightness,
    contrast: state.contrast,
    saturation: state.saturation,
    palette: state.palette,
    dither: state.dither,
    ditherStrength: state.ditherStrength,
    paletteSize: state.paletteSize,
    colorDistance: state.colorDistance,
  });
}

export function createEditor(mediaSource, preset = {}, { headerBar, onUploadFile, tasks } = {}) {
  const state = { ...DEFAULTS, ...preset };
  const isAnimation = mediaSource.kind === 'animation';
  if (preset.autoPalette || state.palette === 'from-image') {
    state.palette = 'from-image';
    state.autoPalette = true;
  } else {
    state.autoPalette = false;
  }
  if (isAnimation) state.exportFormat = 'gif';

  let sourceImage = null;
  let sourceFrames = isAnimation ? mediaSource.frames.map((f) => f.canvas) : [];
  let frameDelays = isAnimation ? mediaSource.frames.map((f) => f.delay) : [];
  let selectedFrameIndex = 0;
  let result = null;
  let renderTimer = null;
  let renderGeneration = 0;
  let displayScale = 1;
  let isBusy = false;

  let playCacheKey = '';
  let playCacheFrames = [];
  let isPlaying = false;
  let animRaf = null;
  let animAccum = 0;
  let animLastTime = 0;
  let playFrameIndex = 0;

  const root = document.createElement('div');
  root.className = 'editor-layout';
  root.innerHTML = `
    <aside class="editor-panel" id="editor-controls">
      <fieldset class="control-block">
        <legend>Size</legend>
        <div class="control-group">
          <label>Pixel size <span id="val-pixelSize">${state.pixelSize}</span></label>
          <input type="range" id="pixelSize" min="1" max="64" value="${state.pixelSize}">
        </div>
      </fieldset>

      <fieldset class="control-block">
        <legend>Color</legend>
        <div class="control-group">
          <label>Brightness <span id="val-brightness">${state.brightness}</span></label>
          <input type="range" id="brightness" min="-100" max="100" value="${state.brightness}">
        </div>
        <div class="control-group">
          <label>Contrast <span id="val-contrast">${state.contrast}</span></label>
          <input type="range" id="contrast" min="-100" max="100" value="${state.contrast}">
        </div>
        <div class="control-group">
          <label>Saturation <span id="val-saturation">${state.saturation}</span></label>
          <input type="range" id="saturation" min="-100" max="100" value="${state.saturation}">
        </div>
        <div class="control-group">
          <label for="palette">Palette</label>
          <select id="palette"></select>
          <div class="palette-colors" id="palette-preview"></div>
        </div>
        <div class="control-group hidden" id="palette-size-group">
          <label>Palette size <span id="val-paletteSize">${state.paletteSize}</span></label>
          <input type="range" id="paletteSize" min="2" max="64" value="${state.paletteSize}">
        </div>
        <div class="control-group">
          <label for="colorDistance">Color distance</label>
          <select id="colorDistance">
            <option value="rgb">RGB</option>
            <option value="lab">LAB</option>
          </select>
        </div>
        <div class="control-group">
          <label for="ditherMethod">Dithering</label>
          <select id="ditherMethod">
            <option value="none">None</option>
            <option value="floyd-steinberg">Floyd-Steinberg</option>
            <option value="ordered">Ordered (Bayer 4×4)</option>
            <option value="ordered-8x8">Ordered (Bayer 8×8)</option>
          </select>
        </div>
        <div class="control-group" id="dither-strength-group">
          <label>Dither strength <span id="val-ditherStrength">${state.ditherStrength}%</span></label>
          <input type="range" id="ditherStrength" min="0" max="100" value="${state.ditherStrength}">
        </div>
      </fieldset>

      <fieldset class="control-block">
        <legend>Display</legend>
        <div class="control-row">
          <input type="checkbox" id="showGrid">
          <label for="showGrid">Show pixel grid</label>
        </div>
        <div class="btn-row">
          <button type="button" class="btn-sm" id="reset-all">Reset all</button>
        </div>
      </fieldset>

      <details class="control-block control-details">
        <summary>Import palette</summary>
        <div class="control-group">
          <input type="text" id="lospec-url" placeholder="Lospec palette URL">
          <div class="btn-row"><button type="button" class="btn-sm" id="import-lospec">Import</button></div>
        </div>
      </details>
    </aside>

    <div class="preview-panel">
      <div class="preview-toolbar">
        <div class="preview-badges">
          <span class="badge" id="size-badge">—</span>
          <span class="badge" id="pixel-badge">—</span>
          <span class="badge hidden" id="frame-badge">—</span>
        </div>
        <button type="button" class="btn-sm hidden" id="play-btn">Play</button>
      </div>
      <div class="preview-container" id="preview-container">
        <div class="preview-frame" id="preview-frame">
          <canvas id="preview-canvas" aria-label="Pixel art preview"></canvas>
          <canvas id="preview-grid" class="preview-grid hidden" aria-hidden="true"></canvas>
        </div>
        <div class="processing-overlay hidden" id="processing">Processing…</div>
      </div>
      <div class="frame-strip hidden" id="frame-strip">
        <div class="frame-strip-scroll" id="frame-strip-scroll"></div>
      </div>
    </div>`;

  const canvas = root.querySelector('#preview-canvas');
  const gridCanvas = root.querySelector('#preview-grid');
  const ctx = canvas.getContext('2d');
  const processing = root.querySelector('#processing');
  const previewContainer = root.querySelector('#preview-container');
  const paletteSelect = root.querySelector('#palette');
  const frameBadge = root.querySelector('#frame-badge');
  const frameStrip = root.querySelector('#frame-strip');
  const frameStripScroll = root.querySelector('#frame-strip-scroll');
  const playBtn = root.querySelector('#play-btn');

  let exportFormatSelect;
  let exportSizeSelect;
  let downloadBtn;
  let uploadBtn;

  function mountHeaderControls() {
    if (!headerBar) return;
    headerBar.innerHTML = `
      <button type="button" class="btn-secondary" id="header-upload-btn">Upload file</button>
      <label class="header-field">
        <span class="sr-only">Format</span>
        <select id="header-export-format" class="header-select"></select>
      </label>
      <label class="header-field">
        <span class="sr-only">Output size</span>
        <select id="header-export-size" class="header-select">
          <option value="pixel">Pixel size</option>
          <option value="source">Original size</option>
          <option value="double">2× size</option>
          <option value="quad">4× size</option>
        </select>
      </label>
      <button type="button" class="btn-primary" id="header-download-btn">Download</button>`;

    uploadBtn = headerBar.querySelector('#header-upload-btn');
    exportFormatSelect = headerBar.querySelector('#header-export-format');
    exportSizeSelect = headerBar.querySelector('#header-export-size');
    downloadBtn = headerBar.querySelector('#header-download-btn');

    uploadBtn.addEventListener('click', () => onUploadFile?.());
    exportFormatSelect.addEventListener('change', (e) => { state.exportFormat = e.target.value; });
    exportSizeSelect.addEventListener('change', (e) => { state.exportSize = e.target.value; });
    downloadBtn.addEventListener('click', handleDownload);
    populateExportFormats();
    exportSizeSelect.value = state.exportSize;
  }

  function populateExportFormats() {
    if (!exportFormatSelect) return;
    if (isAnimation) {
      exportFormatSelect.innerHTML = `
        <option value="gif">GIF</option>
        <option value="mp4">MP4 video</option>
        <option value="png">PNG (selected frame)</option>`;
      exportFormatSelect.value = ['gif', 'mp4', 'png'].includes(state.exportFormat) ? state.exportFormat : 'gif';
    } else {
      exportFormatSelect.innerHTML = `
        <option value="png">PNG</option>
        <option value="jpeg">JPEG</option>
        <option value="webp">WebP</option>`;
      exportFormatSelect.value = state.exportFormat;
    }
  }

  function setHeaderDisabled(disabled) {
    uploadBtn && (uploadBtn.disabled = disabled);
    exportFormatSelect && (exportFormatSelect.disabled = disabled);
    exportSizeSelect && (exportSizeSelect.disabled = disabled);
    downloadBtn && (downloadBtn.disabled = disabled);
    if (playBtn) playBtn.disabled = disabled;
  }

  function invalidatePlayCache() {
    playCacheKey = '';
    playCacheFrames = [];
    stopPlayback();
  }

  function stopPlayback() {
    isPlaying = false;
    if (animRaf) cancelAnimationFrame(animRaf);
    animRaf = null;
    animAccum = 0;
    if (playBtn) {
      playBtn.textContent = 'Play';
      playBtn.classList.remove('playing');
    }
  }

  function populatePalettes() {
    const curated = getAllPalettes()
      .map((p) => `<option value="${p.id}">${p.name}</option>`)
      .join('');
    paletteSelect.innerHTML = `<option value="from-image">From image (auto)</option>${curated}`;
    paletteSelect.value = state.palette;
    updatePaletteUI();
  }

  function updatePalettePreview() {
    const all = getAllPalettes();
    const p = all.find((x) => x.id === paletteSelect.value);
    const preview = root.querySelector('#palette-preview');
    preview.innerHTML = (p?.colors || [])
      .slice(0, 32)
      .map((c) => `<span class="palette-swatch" style="background:${c}" title="${c}"></span>`)
      .join('');
  }

  function updatePaletteUI() {
    const fromImage = state.palette === 'from-image';
    state.autoPalette = fromImage;
    root.querySelector('#palette-size-group').classList.toggle('hidden', !fromImage);
    const preview = root.querySelector('#palette-preview');
    if (fromImage) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    } else {
      preview.classList.remove('hidden');
      updatePalettePreview();
    }
  }

  function getPaletteColors() {
    if (state.autoPalette || state.palette === 'from-image') return null;
    const all = getAllPalettes();
    const p = all.find((x) => x.id === state.palette);
    return p?.colors || null;
  }

  function buildFrameStrip() {
    if (!isAnimation) {
      frameStrip.classList.add('hidden');
      playBtn.classList.add('hidden');
      return;
    }
    frameStrip.classList.remove('hidden');
    playBtn.classList.remove('hidden');
    frameStripScroll.innerHTML = '';

    sourceFrames.forEach((srcCanvas, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `frame-thumb${i === selectedFrameIndex ? ' active' : ''}`;
      btn.title = `Frame ${i + 1}`;
      btn.setAttribute('aria-label', `Frame ${i + 1}`);

      const thumbCanvas = document.createElement('canvas');
      const scale = THUMB_HEIGHT / srcCanvas.height;
      thumbCanvas.width = Math.max(1, Math.round(srcCanvas.width * scale));
      thumbCanvas.height = THUMB_HEIGHT;
      const tctx = thumbCanvas.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(srcCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

      const label = document.createElement('span');
      label.className = 'frame-thumb-num';
      label.textContent = String(i + 1);

      btn.append(thumbCanvas, label);
      btn.addEventListener('click', () => {
        if (selectedFrameIndex === i) return;
        stopPlayback();
        selectedFrameIndex = i;
        updateFrameStripActive();
        scheduleRender();
      });
      frameStripScroll.appendChild(btn);
    });
  }

  function updateFrameStripActive() {
    frameStripScroll.querySelectorAll('.frame-thumb').forEach((btn, i) => {
      const active = i === selectedFrameIndex;
      btn.classList.toggle('active', active);
      if (active) btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  function updateBadges(frameIndex = selectedFrameIndex) {
    if (!result) return;
    root.querySelector('#size-badge').textContent = `${result.pixelWidth} × ${result.pixelHeight} px`;
    const blockLabel = `Block: ${state.pixelSize}px · Preview ${result.width}×${result.height}`;
    if (isAnimation) {
      frameBadge.classList.remove('hidden');
      frameBadge.textContent = `Frame ${frameIndex + 1}/${sourceFrames.length}`;
      root.querySelector('#pixel-badge').textContent = `${mediaSource.label} · ${blockLabel}`;
    } else {
      frameBadge.classList.add('hidden');
      root.querySelector('#pixel-badge').textContent = blockLabel;
    }
  }

  function drawResultFrame(frameResult, frameIndex) {
    result = frameResult;
    canvas.width = frameResult.width;
    canvas.height = frameResult.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frameResult.canvas, 0, 0);
    fitPreview();
    updateBadges(frameIndex);
  }

  function fitPreview() {
    if (!root.isConnected || !result) return;
    const availW = previewContainer.clientWidth;
    const availH = previewContainer.clientHeight;
    displayScale = computeDisplayScale(availW, availH, result.width, result.height);
    const dispW = result.width * displayScale;
    const dispH = result.height * displayScale;
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    updateGridOverlay(dispW, dispH);
  }

  function updateGridOverlay(dispW, dispH) {
    if (!state.showGrid || !result) {
      gridCanvas.classList.add('hidden');
      return;
    }

    const blockDispW = (result.width / result.pixelWidth) * displayScale;
    const blockDispH = (result.height / result.pixelHeight) * displayScale;
    if (blockDispW < 2 || blockDispH < 2) {
      gridCanvas.classList.add('hidden');
      return;
    }

    const width = Math.round(dispW);
    const height = Math.round(dispH);
    const dpr = window.devicePixelRatio || 1;
    gridCanvas.width = Math.round(width * dpr);
    gridCanvas.height = Math.round(height * dpr);
    gridCanvas.style.width = `${width}px`;
    gridCanvas.style.height = `${height}px`;
    gridCanvas.classList.remove('hidden');

    const g = gridCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 1;

    for (let x = 0; x <= result.pixelWidth; x++) {
      const px = Math.round(x * blockDispW) + 0.5;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, height);
      g.stroke();
    }
    for (let y = 0; y <= result.pixelHeight; y++) {
      const py = Math.round(y * blockDispH) + 0.5;
      g.beginPath();
      g.moveTo(0, py);
      g.lineTo(width, py);
      g.stroke();
    }
  }

  function scheduleRender() {
    invalidatePlayCache();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, isAnimation ? 150 : 80);
  }

  function setLocalProcessing(active, message = 'Processing…') {
    processing.textContent = message;
    processing.classList.toggle('hidden', !active);
  }

  async function renderPreviewFrame() {
    const options = buildPixelateOptions(state, getPaletteColors());
    const source = isAnimation ? sourceFrames[selectedFrameIndex] : sourceImage;
    result = await pixelateImage(source, options);
    drawResultFrame(result, selectedFrameIndex);
    updateFrameStripActive();
  }

  async function ensurePlayCache(signal, update) {
    const key = settingsKey(state);
    if (playCacheKey === key && playCacheFrames.length) return playCacheFrames;

    let options = buildPixelateOptions(state, getPaletteColors());
    if (options.autoPalette) {
      options = await resolvePixelateOptions(sourceFrames[selectedFrameIndex], options);
    }

    const frames = await pixelateFrames(sourceFrames, options, (done, total) => {
      update(`Rendering preview ${done}/${total}…`, Math.round((done / total) * 100));
    }, signal);

    playCacheKey = key;
    playCacheFrames = frames.map((r, i) => ({ ...r, delay: frameDelays[i] || 100 }));
    return playCacheFrames;
  }

  async function togglePlayback() {
    if (!isAnimation || isBusy) return;

    if (isPlaying) {
      stopPlayback();
      await renderPreviewFrame();
      return;
    }

    isBusy = true;
    setHeaderDisabled(true);

    const cacheResult = await tasks.run(async (signal, update) => {
      return ensurePlayCache(signal, update);
    }, { label: 'Preparing playback…', cancellable: true, progress: true });

    isBusy = false;
    setHeaderDisabled(false);

    if (cacheResult?.cancelled || !cacheResult) {
      await renderPreviewFrame();
      return;
    }

    playCacheFrames = cacheResult;
    startPlayback();
  }

  function startPlayback() {
    if (!playCacheFrames.length) return;
    stopPlayback();
    isPlaying = true;
    playBtn.textContent = 'Stop';
    playBtn.classList.add('playing');
    playFrameIndex = 0;
    drawResultFrame(playCacheFrames[0], 0);
    updateFrameStripActive();
    animLastTime = performance.now();

    const tick = (now) => {
      if (!isPlaying) return;
      const delay = playCacheFrames[playFrameIndex]?.delay || 100;
      animAccum += now - animLastTime;
      animLastTime = now;
      if (animAccum >= delay) {
        animAccum = 0;
        playFrameIndex = (playFrameIndex + 1) % playCacheFrames.length;
        selectedFrameIndex = playFrameIndex;
        drawResultFrame(playCacheFrames[playFrameIndex], playFrameIndex);
        updateFrameStripActive();
      }
      animRaf = requestAnimationFrame(tick);
    };
    animRaf = requestAnimationFrame(tick);
  }

  async function renderAllFrames(signal, update) {
    let options = buildPixelateOptions(state, getPaletteColors());
    if (options.autoPalette) {
      options = await resolvePixelateOptions(sourceFrames[selectedFrameIndex], options);
    }
    return pixelateFrames(sourceFrames, options, (done, total) => {
      update(`Rendering frame ${done}/${total}…`, Math.round((done / total) * 100));
    }, signal);
  }

  async function render() {
    if (isAnimation ? !sourceFrames.length : !sourceImage) return;
    const generation = ++renderGeneration;
    setLocalProcessing(true, isAnimation ? 'Updating preview…' : 'Processing…');

    try {
      await renderPreviewFrame();
      if (generation !== renderGeneration) return;
    } finally {
      if (generation === renderGeneration) setLocalProcessing(false);
    }
  }

  async function handleDownload() {
    if (!result || isBusy) return;
    stopPlayback();
    isBusy = true;
    setHeaderDisabled(true);

    try {
      if (isAnimation && (state.exportFormat === 'gif' || state.exportFormat === 'mp4')) {
        const exportResult = await tasks.run(async (signal, update) => {
          const allFrames = await renderAllFrames(signal, update);
          if (state.exportFormat === 'gif') {
            update('Encoding GIF…', 95);
            await downloadGif(allFrames, frameDelays, state.exportSize, (done, total) => {
              update(`Encoding GIF ${done}/${total}…`, 95 + Math.round((done / total) * 5));
            }, signal);
          } else {
            update('Encoding MP4…', 95);
            await downloadMp4(allFrames, frameDelays, state.exportSize, (done, total) => {
              update(`Encoding video ${done}/${total}…`, 95 + Math.round((done / total) * 5));
            }, signal);
          }
          return true;
        }, { label: 'Preparing export…', cancellable: true, progress: true });

        if (exportResult?.cancelled) await renderPreviewFrame();
        return;
      }

      const out = pickExportCanvas(result, state.exportSize);
      if (isAnimation && state.exportFormat === 'png') {
        downloadCanvas(out, 'pixel-art.png', 'png', state.exportQuality);
        return;
      }
      const ext = state.exportFormat === 'jpeg' ? 'jpg' : state.exportFormat;
      downloadCanvas(out, `pixel-art.${ext}`, state.exportFormat, state.exportQuality);
    } finally {
      isBusy = false;
      setHeaderDisabled(false);
    }
  }

  function bindRange(id, key) {
    const el = root.querySelector(`#${id}`);
    const val = root.querySelector(`#val-${id}`);
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      if (val) val.textContent = id === 'ditherStrength' ? `${state[key]}%` : state[key];
      scheduleRender();
    });
  }

  ['pixelSize', 'brightness', 'contrast', 'saturation', 'paletteSize', 'ditherStrength'].forEach((k) => bindRange(k, k));

  function updateDitherStrengthVisibility() {
    const show = state.dither !== 'none';
    root.querySelector('#dither-strength-group').style.display = show ? 'block' : 'none';
  }

  root.querySelector('#palette').addEventListener('change', (e) => {
    state.palette = e.target.value;
    updatePaletteUI();
    scheduleRender();
  });
  root.querySelector('#colorDistance').addEventListener('change', (e) => {
    state.colorDistance = e.target.value;
    scheduleRender();
  });
  root.querySelector('#ditherMethod').addEventListener('change', (e) => {
    state.dither = e.target.value;
    updateDitherStrengthVisibility();
    scheduleRender();
  });
  root.querySelector('#showGrid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    fitPreview();
  });
  playBtn.addEventListener('click', togglePlayback);

  root.querySelector('#reset-all').addEventListener('click', () => {
    stopPlayback();
    Object.assign(state, DEFAULTS, preset);
    if (isAnimation) state.exportFormat = 'gif';
    if (preset.autoPalette) {
      state.palette = 'from-image';
      state.autoPalette = true;
    } else {
      state.autoPalette = state.palette === 'from-image';
    }
    root.querySelectorAll('input[type="range"]').forEach((el) => {
      if (!(el.id in state)) return;
      el.value = state[el.id];
      const val = root.querySelector(`#val-${el.id}`);
      if (val) val.textContent = el.id === 'ditherStrength' ? `${state[el.id]}%` : state[el.id];
    });
    root.querySelector('#ditherMethod').value = state.dither;
    root.querySelector('#colorDistance').value = state.colorDistance;
    if (exportSizeSelect) exportSizeSelect.value = state.exportSize;
    populateExportFormats();
    updateDitherStrengthVisibility();
    root.querySelector('#showGrid').checked = state.showGrid;
    paletteSelect.value = state.palette;
    updatePaletteUI();
    scheduleRender();
  });

  root.querySelector('#import-lospec').addEventListener('click', async () => {
    const url = root.querySelector('#lospec-url').value.trim();
    if (!url) return;
    try {
      const slug = url.match(/lospec\.com\/palette-list\/([^/?#]+)/i)?.[1];
      if (!slug) throw new Error('Unsupported palette URL');
      const res = await fetch(`https://lospec.com/palette-list/${slug}.json`);
      if (!res.ok) throw new Error('Lospec request failed');
      const data = await res.json();
      const colors = (data.colors || []).map((c) => c.hex || c);
      if (!colors.length) throw new Error('No colors found');
      const custom = loadCustomPalettes();
      custom.push({ name: data.name || slug, colors });
      saveCustomPalettes(custom);
      populatePalettes();
      paletteSelect.value = `custom-${custom.length - 1}`;
      state.palette = paletteSelect.value;
      updatePaletteUI();
      scheduleRender();
    } catch (err) {
      alert(err.message || 'Failed to import palette');
    }
  });

  mountHeaderControls();
  populatePalettes();
  buildFrameStrip();

  if (preset.dither) {
    const method = typeof preset.dither === 'string' ? preset.dither : 'floyd-steinberg';
    state.dither = method === 'atkinson' ? 'floyd-steinberg' : method;
    root.querySelector('#ditherMethod').value = state.dither;
  }
  if (preset.palette && preset.palette !== 'from-image') paletteSelect.value = preset.palette;
  root.querySelector('#colorDistance').value = state.colorDistance;
  updateDitherStrengthVisibility();

  const resizeObserver = new ResizeObserver(() => fitPreview());
  resizeObserver.observe(previewContainer);
  window.addEventListener('resize', fitPreview);

  root._cleanup = () => {
    stopPlayback();
    resizeObserver.disconnect();
    if (headerBar) headerBar.innerHTML = '';
  };

  if (isAnimation) {
    render();
  } else {
    const img = new Image();
    img.onload = () => { sourceImage = img; render(); };
    img.src = mediaSource.url;
  }

  return root;
}

export function mountEditor(container, mediaSource, options) {
  container.innerHTML = '';
  container.classList.add('visible');
  const editor = createEditor(mediaSource, {}, options);
  container.appendChild(editor);
  return editor;
}
