export function renderHeader() {
  return `
    <a href="#main-content" class="sr-only">Skip to main content</a>
    <div class="header-inner">
      <a href="/" class="logo" aria-label="Pixel Art Generator">Pixel Art Generator</a>
      <div class="header-actions">
        <div id="header-editor-bar" class="header-editor-bar hidden"></div>
      </div>
    </div>
    <input type="file" id="header-file-input" class="sr-only" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/*" tabindex="-1">`;
}
