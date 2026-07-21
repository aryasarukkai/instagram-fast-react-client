// Deterministic placeholder styling for accounts and media Instagram gave us no
// image for (private media, expired CDN URL, failed load).
const TONES = ['city', 'violet', 'ember', 'dusk', 'harbor', 'garden', 'transit', 'desert', 'studio', 'workshop', 'arcade', 'cobalt'];

// Deterministic placeholder tone so an account keeps the same colour whenever
// Instagram gives us no image (private media, expired CDN URL, failed load).
export const toneFor = (seed = '') => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return TONES[hash % TONES.length];
};

export const initialsFor = (username = '') => username
  .split(/[._-]/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();
