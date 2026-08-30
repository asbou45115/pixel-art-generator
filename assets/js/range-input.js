export function initRangeSlider(input) {
  const update = () => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value);
    const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--range-pct', `${pct}%`);
  };
  input.addEventListener('input', update);
  update();
}

export function initRangeSliders(root = document) {
  root.querySelectorAll('input[type="range"]').forEach(initRangeSlider);
}
