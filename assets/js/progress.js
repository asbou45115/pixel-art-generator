export function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

let overlayEl = null;
let activeController = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'app-task-overlay';
  overlayEl.className = 'app-loading hidden';
  overlayEl.innerHTML = `
    <div class="app-loading-card app-task-card">
      <p id="app-task-text">Working…</p>
      <div class="progress-track" id="app-task-progress-wrap">
        <div class="progress-fill" id="app-task-progress"></div>
      </div>
      <button type="button" class="btn-secondary btn-cancel" id="app-task-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.querySelector('#app-task-cancel').addEventListener('click', () => {
    activeController?.abort();
  });
  return overlayEl;
}

export function createTaskRunner() {
  const el = ensureOverlay();
  const textEl = el.querySelector('#app-task-text');
  const progressWrap = el.querySelector('#app-task-progress-wrap');
  const progressFill = el.querySelector('#app-task-progress');
  const cancelBtn = el.querySelector('#app-task-cancel');

  return {
    async run(task, { label = 'Working…', cancellable = true, progress = false } = {}) {
      activeController = new AbortController();
      const { signal } = activeController;
      textEl.textContent = label;
      progressWrap.classList.toggle('hidden', !progress);
      progressFill.style.width = progress ? '0%' : '100%';
      cancelBtn.classList.toggle('hidden', !cancellable);
      el.classList.remove('hidden');

      const update = (message, value) => {
        if (message) textEl.textContent = message;
        if (typeof value === 'number') {
          progressFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
        }
      };

      try {
        return await task(signal, update);
      } catch (err) {
        if (err?.name === 'AbortError') return { cancelled: true };
        throw err;
      } finally {
        el.classList.add('hidden');
        activeController = null;
      }
    },
    cancel() {
      activeController?.abort();
    },
  };
}
