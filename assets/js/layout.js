export function renderHeader() {
  return `
    <a href="#main-content" class="sr-only">Skip to main content</a>
    <div class="header-inner">
      <a href="/" class="logo" aria-label="Pixel Art Generator">Pixel Art Generator</a>
      <button type="button" class="btn-secondary hidden" id="new-image-btn">New image</button>
    </div>`;
}
