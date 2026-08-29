import { getAllPalettes, loadCustomPalettes, saveCustomPalettes } from './palettes.js';
import { pixelateImage, scaleCanvas, downloadCanvas } from './pixelate.js';

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

function computeDisplayScale(availW, availH, width, height) {
  if (!width || !height || !availW || !availH) return 1;
  const fit = Math.min(availW / width, availH / height);
  if (fit >= 1) return Math.max(1, Math.floor(fit));
  return fit;
}

export function createEditor(imageSrc, preset = {}) {
  const state = { ...DEFAULTS, ...preset };
  if (preset.autoPalette || state.palette === 'from-image') {
    state.palette = 'from-image';
    state.autoPalette = true;
  } else {
    state.autoPalette = false;
  }
  let sourceImage = null;
  let result = null;
  let renderTimer = null;
  let displayScale = 1;

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
        </div>
      </div>
      <div class="preview-container" id="preview-container">
        <div class="preview-frame" id="preview-frame">
          <canvas id="preview-canvas" aria-label="Pixel art preview"></canvas>
          <canvas id="preview-grid" class="preview-grid hidden" aria-hidden="true"></canvas>
        </div>
        <div class="processing-overlay hidden" id="processing">Processing…</div>
      </div>
      <div class="export-bar">
        <div class="control-group">
          <label for="exportFormat">Format</label>
          <select id="exportFormat">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </div>
        <div class="control-group">
          <label for="exportSize">Output size</label>
          <select id="exportSize">
            <option value="pixel">Actual pixel size</option>
            <option value="source">Original image size</option>
            <option value="double">2× pixel size</option>
            <option value="quad">4× pixel size</option>
          </select>
        </div>
        <button type="button" class="btn-primary" id="download-btn">Download</button>
      </div>
    </div>`;

  const canvas = root.querySelector('#preview-canvas');
  const gridCanvas = root.querySelector('#preview-grid');
  const ctx = canvas.getContext('2d');
  const processing = root.querySelector('#processing');
  const previewContainer = root.querySelector('#preview-container');
  const paletteSelect = root.querySelector('#palette');

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

  function drawToCanvas() {
    if (!result) return;
    canvas.width = result.width;
    canvas.height = result.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(result.canvas, 0, 0);
    fitPreview();
    root.querySelector('#size-badge').textContent = `${result.pixelWidth} × ${result.pixelHeight} px`;
    root.querySelector('#pixel-badge').textContent = `Block: ${state.pixelSize}px · Preview ${result.width}×${result.height}`;
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 80);
  }

  async function render() {
    if (!sourceImage) return;
    processing.classList.remove('hidden');
    try {
      const paletteColors = getPaletteColors();
      const usePalette = state.autoPalette || (paletteColors && state.palette !== 'none');
      const dither = usePalette ? state.dither : 'none';
      result = await pixelateImage(sourceImage, {
        pixelSize: state.pixelSize,
        brightness: state.brightness,
        contrast: state.contrast,
        saturation: state.saturation,
        paletteColors: usePalette ? paletteColors : null,
        dither,
        ditherStrength: state.ditherStrength,
        autoPalette: state.autoPalette,
        paletteSize: state.paletteSize,
        colorDistance: state.colorDistance,
        outputWidth: state.outputWidth,
        outputHeight: state.outputHeight,
        outputFit: state.outputFit,
      });
      drawToCanvas();
    } finally {
      processing.classList.add('hidden');
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
  root.querySelector('#exportFormat').addEventListener('change', (e) => {
    state.exportFormat = e.target.value;
  });
  root.querySelector('#exportSize').addEventListener('change', (e) => {
    state.exportSize = e.target.value;
  });

  root.querySelector('#reset-all').addEventListener('click', () => {
    Object.assign(state, DEFAULTS, preset);
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
    root.querySelector('#exportFormat').value = state.exportFormat;
    root.querySelector('#exportSize').value = state.exportSize;
    updateDitherStrengthVisibility();
    root.querySelector('#showGrid').checked = state.showGrid;
    paletteSelect.value = state.palette;
    updatePaletteUI();
    scheduleRender();
  });

  root.querySelector('#download-btn').addEventListener('click', () => {
    if (!result) return;
    let out = result.pixelCanvas || result.canvas;
    if (state.exportSize === 'source') out = result.canvas;
    else if (state.exportSize === 'double') out = scaleCanvas(result.canvas, result.width * 2, result.height * 2);
    else if (state.exportSize === 'quad') out = scaleCanvas(result.canvas, result.width * 4, result.height * 4);
    const ext = state.exportFormat === 'jpeg' ? 'jpg' : state.exportFormat;
    downloadCanvas(out, `pixel-art.${ext}`, state.exportFormat, state.exportQuality);
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

  populatePalettes();

  if (preset.dither) {
    const method = typeof preset.dither === 'string' ? preset.dither : 'floyd-steinberg';
    state.dither = method === 'atkinson' ? 'floyd-steinberg' : method;
    root.querySelector('#ditherMethod').value = state.dither;
  }
  if (preset.palette && preset.palette !== 'from-image') paletteSelect.value = preset.palette;
  root.querySelector('#colorDistance').value = state.colorDistance;
  root.querySelector('#exportFormat').value = state.exportFormat;
  root.querySelector('#exportSize').value = state.exportSize;
  updateDitherStrengthVisibility();

  const resizeObserver = new ResizeObserver(() => fitPreview());
  resizeObserver.observe(previewContainer);
  window.addEventListener('resize', fitPreview);

  const img = new Image();
  img.onload = () => { sourceImage = img; render(); };
  img.src = imageSrc;

  return root;
}

export function mountEditor(container, imageSrc, preset) {
  container.innerHTML = '';
  container.classList.add('visible');
  container.appendChild(createEditor(imageSrc, preset));
}
