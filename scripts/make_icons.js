// Draws the home-screen icons into apps/pages/icons/ (run once after changing a design: node scripts/make_icons.js).
// Full-bleed backgrounds with the mark inside the middle 60%, so the same file works as a maskable icon.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '../apps/pages/icons');

const WRENCH = 'M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z';
const coin = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f2b544"/>
  <path d="M${cx - r * 0.3} ${cy - r * 0.45} L${cx + r * 0.5} ${cy} L${cx - r * 0.3} ${cy + r * 0.45} Z" fill="#241800" stroke="#241800" stroke-width="${r * 0.12}" stroke-linejoin="round"/>`;
const badge = (cx, cy, s) => `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="${s * 0.26}" fill="#4cc9a4"/>
  <g transform="translate(${cx - s * 0.36} ${cy - s * 0.36}) scale(${s * 0.72 / 24})"><path d="${WRENCH}" fill="none" stroke="#062019" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const ICONS = {
  games: `<rect width="100" height="100" fill="#13151d"/>${coin(50, 50, 26)}`,
  tools: `<rect width="100" height="100" fill="#121816"/>${badge(50, 50, 50)}`,
  home: `<rect width="100" height="100" fill="#16140f"/>${coin(39, 40, 17)}${badge(61, 61, 32)}`,
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, body] of Object.entries(ICONS))
    for (const size of [512, 192, 180]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>*{margin:0}svg{display:block}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${body}</svg>`);
      await page.screenshot({ path: path.join(OUT, `${name}-${size}.png`) });
    }
  await browser.close();
  console.log('icons ->', OUT);
})();
