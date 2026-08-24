const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) process.exit(2);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForNetmarbleArticle(window, url) {
  if (!/\/view\/\d+\/\d+(?:[/?#]|$)/.test(url)) return false;
  const deadline = Date.now() + Number(process.env.NETMARBLE_DETAIL_RENDER_WAIT_MS || 20000);
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(`Boolean(
      document.querySelector('#contentsDetail')
      && /20\\d{2}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}:\\d{2}/.test(document.querySelector('.contents_title .register_info')?.textContent || '')
    )`);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

app.commandLine.appendSwitch('disable-gpu');
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}
app.whenReady().then(async () => {
  const urls = JSON.parse(readFileSync(inputPath, 'utf8'));
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const results = [];
  for (const url of urls) {
    try {
      await window.loadURL(url);
      const articleReady = await waitForNetmarbleArticle(window, url);
      if (!articleReady) await sleep(Number(process.env.RENDER_WAIT_MS || 2500));
      const body = await window.webContents.executeJavaScript('document.documentElement.outerHTML');
      results.push({ url, finalUrl: window.webContents.getURL(), body });
    } catch (error) {
      results.push({ url, error: error.message });
    }
  }
  writeFileSync(outputPath, JSON.stringify(results));
  app.quit();
});
