const STORAGE_KEY = 'pag-theme';

export function getTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#12141c' : '#ffffff';
  return next;
}

export function initTheme() {
  return applyTheme(getTheme());
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || getTheme();
  return applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function bindThemeToggle(button) {
  if (!button) return;
  const sync = () => {
    const dark = (document.documentElement.dataset.theme || getTheme()) === 'dark';
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('title', dark ? 'Light mode' : 'Dark mode');
    button.classList.toggle('is-dark', dark);
  };
  button.addEventListener('click', () => {
    toggleTheme();
    sync();
  });
  sync();
}
