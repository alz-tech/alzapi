// Automatically downloads yt-dlp binary after npm install
// Required for YouTube endpoints to function
const YTDlpWrap = require('yt-dlp-wrap');
const path = require('path');
const fs = require('fs');

async function install() {
  const binPath = path.join(__dirname, '..', 'bin', 'yt-dlp');
  const binDir = path.dirname(binPath);

  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  if (fs.existsSync(binPath)) {
    console.log('[yt-dlp] Binary already present at', binPath);
    return;
  }

  console.log('[yt-dlp] Downloading yt-dlp binary...');
  try {
    await YTDlpWrap.downloadFromGithub(binPath);
    fs.chmodSync(binPath, 0o755);
    console.log('[yt-dlp] Successfully installed to', binPath);
  } catch (err) {
    console.error('[yt-dlp] Download failed:', err.message);
    console.error('[yt-dlp] YouTube endpoints will not work until yt-dlp is installed.');
    console.error('[yt-dlp] Install manually: https://github.com/yt-dlp/yt-dlp/releases');
  }
}

install();
