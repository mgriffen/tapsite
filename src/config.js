const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  ROOT_DIR,
  PROFILE_DIR: path.join(ROOT_DIR, 'profiles', 'default'),
  OUTPUT_DIR: path.join(ROOT_DIR, 'output'),
  BROWSER_TYPE: 'chromium',
  VIEWPORT: { width: 1440, height: 900 },
  MAX_ELEMENTS: 200,
  MAX_DOM_LENGTH: 8000,
  MAX_COLORS: 50,
};
