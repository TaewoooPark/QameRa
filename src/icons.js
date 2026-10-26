// Original geometric interface icons. No Apple artwork is distributed.
const paths = {
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  flash: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  flip: '<path d="M20 8a9 9 0 0 0-15-3L3 7m0-5v5h5M4 16a9 9 0 0 0 15 3l2-2m0 5v-5h-5"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  share: '<path d="M12 16V3m-4 4 4-4 4 4M8 10H5v11h14V10h-3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  focus: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/><circle cx="12" cy="12" r="3"/>',
  filter: '<circle cx="9" cy="9" r="6"/><circle cx="15" cy="9" r="6"/><circle cx="12" cy="15" r="6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  camera: '<path d="M3 7h5l2-3h4l2 3h5v14H3z"/><circle cx="12" cy="13" r="4"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.focus}</svg>`;
