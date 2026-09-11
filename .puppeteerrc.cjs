const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Salva o navegador dentro do próprio projeto em vez de no diretório /opt/render/.cache
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};