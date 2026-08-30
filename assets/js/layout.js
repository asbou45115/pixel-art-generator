export function renderHeader() {
  return `
    <a href="#main-content" class="sr-only">Skip to main content</a>
    <div class="header-inner">
      <a href="/" class="logo" aria-label="Pixel Art Generator">Pixel Art Generator</a>
      <div class="header-actions">
        <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
          <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4" fill="currentColor"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
          </svg>
          <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" fill="currentColor"/>
          </svg>
        </button>
        <div id="header-editor-bar" class="header-editor-bar hidden"></div>
      </div>
    </div>
    <input type="file" id="header-file-input" class="sr-only" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/*" tabindex="-1">`;
}
