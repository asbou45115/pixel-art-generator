export const CURATED_PALETTES = {
  none: { name: 'None (original colors)', colors: null },
  'pico-8': {
    name: 'Pico-8',
    colors: ['#000000','#1D2B53','#7E2553','#008751','#AB5236','#5F574F','#C2C3C7','#FFF1E8','#FF004D','#FFA300','#FFEC27','#00E436','#29ADFF','#83769C','#FF77A8','#FFCCAA'],
  },
  'lost-century': {
    name: 'Lost Century',
    colors: ['#170e19','#352b42','#51475c','#6b5f62','#856f49','#9d9167','#b9a779','#d0c084','#e8e09b','#3e2731','#7a4841','#a5543c','#c27e37','#d6af84','#e8d5a2','#f3ead7'],
  },
  'sunset-8': {
    name: 'Sunset 8',
    colors: ['#2d1b2e','#4a1942','#7b2d8b','#c74b89','#f17f53','#ffb347','#ffe066','#fff8e7'],
  },
  'twilight-5': {
    name: 'Twilight 5',
    colors: ['#1a1c2c','#5d275d','#b13e53','#ef7d57','#ffcd75'],
  },
  'hollow': {
    name: 'Hollow',
    colors: ['#0f0f23','#262b44','#3f3f74','#6b6ba6','#9a9ad9','#c4c4f0','#e8e8ff','#ffffff'],
  },
  'gameboy': {
    name: 'Game Boy',
    colors: ['#0f380f','#306230','#8bac0f','#9bbc0f'],
  },
  'nes': {
    name: 'NES',
    colors: ['#7c7c7c','#0000fc','#0000bc','#4428bc','#940084','#a80020','#a81000','#881400','#503000','#007800','#006800','#005800','#004058','#000000','#000000','#000000','#bcbcbc','#0078f8','#0058f8','#6844fc','#d800cc','#e40058','#f83800','#e45c10','#ac7c00','#00b800','#00a800','#00a844','#008888','#000000','#000000','#000000','#f8f8f8','#3cbcfc','#6888fc','#9878f8','#f878f8','#f85898','#f87858','#fca044','#f8b800','#b8f818','#58d854','#58f898','#00e8d8','#787878','#000000','#000000','#000000','#fcfcfc','#a4e4fc','#b8b8f8','#d8b8f8','#f8b8f8','#f8a4c0','#f0d0b0','#fce0a8','#f8d878','#d8f878','#b8f8b8','#b8f8d8','#00fcfc','#f8d8f8','#000000','#000000','#000000'],
  },
  'cga': {
    name: 'CGA',
    colors: ['#000000','#55ffff','#ff55ff','#ffffff'],
  },
  'sweetie-16': {
    name: 'Sweetie 16',
    colors: ['#1a1c2c','#5d275d','#b13e53','#ef7d57','#ffcd75','#a7f070','#38b764','#257179','#29366f','#3b5dc9','#41a6f6','#73eff7','#f4f4f4','#94b0c2','#566c86','#333c57'],
  },
  'aap-64': {
    name: 'AAP-64',
    colors: ['#060608','#141013','#3b1725','#73172d','#b4202a','#df3e23','#fa6a0a','#f9a31b','#ffd541','#fffc40','#d6f264','#9cdb43','#59c135','#14a02e','#1a7a3e','#24523b','#122020','#143464','#285cc4','#249fde','#20d6c7','#a6fcdb','#ffffff','#fef3c0','#fad6b8','#f5a097','#e86a73','#bc4a9b','#793a80','#403353','#242234','#221c1a','#322b28','#71413b','#bb7547','#dba463','#f4d29c','#dae0ea','#b3b9d1','#8b93af','#6d758d','#4a5462','#333941','#422433','#5b3138','#8e5252','#ba756a','#e9b5a3','#e3e6ff','#b9bffb','#849be4','#588dbe','#477d85','#23674e','#328464','#5daf8d','#92dcba','#cdf7e2','#e4d2aa','#c7b08b','#a08662','#796755','#5a4e44','#423934'],
  },
};

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

const STORAGE_KEY = 'pixel-art-generator.custom-palettes';
const LEGACY_KEY = 'pixel-art-village.custom-palettes';

export function loadCustomPalettes() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomPalettes(palettes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
}

export function getAllPalettes() {
  const custom = loadCustomPalettes();
  const curated = Object.entries(CURATED_PALETTES).map(([id, p]) => ({ id, ...p }));
  return [...curated, ...custom.map((p, i) => ({ id: `custom-${i}`, ...p }))];
}
