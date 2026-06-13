const express = require('express');
const { execFile, spawn } = require('child_process');
const fetch = require('node-fetch');
const router = express.Router();

// ── Security: allowed domains ─────────────────────────────────────────────
const ALLOWED_HOSTS = [
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 't.co',
  'facebook.com', 'www.facebook.com', 'fb.watch', 'm.facebook.com',
  'youtu.be', 'youtube.com', 'www.youtube.com',
];

const PLATFORM_MAP = {
  'tiktok.com': 'tiktok', 'vm.tiktok.com': 'tiktok', 'vt.tiktok.com': 'tiktok',
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
  'twitter.com': 'twitter', 'x.com': 'twitter', 't.co': 'twitter', 'www.twitter.com': 'twitter', 'www.x.com': 'twitter',
  'facebook.com': 'facebook', 'www.facebook.com': 'facebook', 'fb.watch': 'facebook', 'm.facebook.com': 'facebook',
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'youtu.be': 'youtube',
};

// ── Security middleware for this router ──────────────────────────────────
function validateUrl(req, res, next) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url= parameter.' });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL format.' });
  }

  // Block non-http(s) schemes (file://, ftp://, etc)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ success: false, error: 'Only http/https URLs are allowed.' });
  }

  // Block private/local IPs (SSRF protection)
  const host = parsed.hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
    /^0\.0\.0\.0$/, /^::1$/, /^fc00:/, /^fe80:/,
  ];
  if (privatePatterns.some(p => p.test(host))) {
    return res.status(403).json({ success: false, error: 'Private/local URLs are not allowed.' });
  }

  // Only allow whitelisted social media domains
  const cleanHost = host.replace(/^www\./, '');
  const isAllowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (!isAllowed) {
    return res.status(403).json({ success: false, error: `Domain not supported. Allowed: TikTok, Instagram, Twitter/X, Facebook, YouTube.` });
  }

  req.parsedUrl = parsed;
  req.platform = PLATFORM_MAP[host] || PLATFORM_MAP[cleanHost] || 'unknown';
  next();
}

// ── yt-dlp availability check ─────────────────────────────────────────────
function ytdlpAvailable() {
  return new Promise(resolve => execFile('yt-dlp', ['--version'], err => resolve(!err)));
}

// ── yt-dlp JSON info ──────────────────────────────────────────────────────
function ytdlpInfo(url, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-playlist', '--no-warnings', '--no-check-certificates', ...extraArgs, url];
    execFile('yt-dlp', args, { timeout: 40000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error('Could not fetch video info. It may be private, deleted, or geo-blocked.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Failed to parse video info.')); }
    });
  });
}

// ── TikTok scraper fallback (tikwm.com public API) ────────────────────────
async function tikwmScrape(url) {
  const r = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body: `url=${encodeURIComponent(url)}&count=12&cursor=0&web=1&hd=1`,
    timeout: 15000,
  });
  const data = await r.json();
  if (data.code !== 0) throw new Error(data.msg || 'TikTok scrape failed.');
  const d = data.data;
  return {
    platform: 'tiktok',
    title: d.title,
    author: d.author?.nickname,
    cover: d.cover,
    duration: d.duration,
    play_count: d.play_count,
    like_count: d.digg_count,
    videos: [
      { quality: 'HD (no watermark)', url: d.hdplay || d.play, ext: 'mp4' },
      { quality: 'SD (no watermark)', url: d.play, ext: 'mp4' },
      { quality: 'Watermark version', url: d.wmplay, ext: 'mp4' },
    ].filter(v => v.url),
    audio: d.music_info ? {
      title: d.music_info.title,
      author: d.music_info.author,
      url: d.music,
      cover: d.music_info.cover,
    } : null,
    source: 'scraper',
  };
}

// ── Format yt-dlp result for social media ─────────────────────────────────
function formatYtdlp(info, platform) {
  const formats = (info.formats || [])
    .filter(f => f.url && f.ext !== 'mhtml')
    .map(f => ({
      quality: f.format_note || (f.height ? `${f.height}p` : f.format_id),
      ext: f.ext,
      filesize: f.filesize || f.filesize_approx,
      has_video: f.vcodec && f.vcodec !== 'none',
      has_audio: f.acodec && f.acodec !== 'none',
      url: f.url,
    }))
    .filter(f => f.has_video || f.has_audio);

  // Best video with audio
  const best = formats.filter(f => f.has_video && f.has_audio).pop()
    || formats.filter(f => f.has_video).pop()
    || formats[0];

  // Best audio only
  const audio = formats.filter(f => !f.has_video && f.has_audio).pop();

  return {
    platform,
    title: info.title,
    author: info.uploader || info.channel,
    author_url: info.uploader_url || info.channel_url,
    thumbnail: info.thumbnail,
    duration: info.duration,
    duration_str: info.duration_string,
    view_count: info.view_count,
    like_count: info.like_count,
    description: info.description ? info.description.substring(0, 200) : null,
    videos: formats.filter(f => f.has_video).slice(-5).reverse(),
    best_video: best || null,
    audio: audio || null,
    all_formats: formats,
    source: 'yt-dlp',
    note: 'Direct URLs expire in ~6 hours.',
  };
}

// ── GET /api/social/info?url=... ── get info without downloading ──────────
router.get('/info', validateUrl, async (req, res) => {
  const { url } = req.query;
  const { platform } = req;

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp not installed on server.' });
  }

  try {
    // TikTok: try scraper first (faster, no watermark guaranteed)
    if (platform === 'tiktok') {
      try {
        const result = await tikwmScrape(url);
        return res.json({ success: true, ...result });
      } catch (scrapeErr) {
        // Fall through to yt-dlp
      }
    }

    const info = await ytdlpInfo(url);
    res.json({ success: true, ...formatYtdlp(info, platform) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/social/download?url=...&type=video|audio ── stream the file ──
router.get('/download', validateUrl, async (req, res) => {
  const { url, type = 'video' } = req.query;
  const { platform } = req;

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp not installed on server.' });
  }

  try {
    // For TikTok, use scraper to get direct no-watermark URL, then proxy it
    if (platform === 'tiktok' && type !== 'audio') {
      try {
        const data = await tikwmScrape(url);
        const videoUrl = data.videos[0]?.url;
        if (videoUrl) {
          const title = (data.title || 'tiktok').replace(/[^\w\s-]/g, '').trim().substring(0, 60);
          const upstream = await fetch(videoUrl, {
            headers: { 'Referer': 'https://www.tiktok.com/', 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000,
          });
          if (upstream.ok) {
            res.set('Content-Type', 'video/mp4');
            res.set('Content-Disposition', `attachment; filename="${title}.mp4"`);
            if (upstream.headers.get('content-length')) {
              res.set('Content-Length', upstream.headers.get('content-length'));
            }
            return upstream.body.pipe(res);
          }
        }
      } catch { /* fall through to yt-dlp */ }
    }

    // yt-dlp stream for all other platforms
    const info = await ytdlpInfo(url);
    const title = (info.title || 'video').replace(/[^\w\s-]/g, '').trim().substring(0, 60);
    const isAudio = type === 'audio';
    const formatArg = isAudio
      ? 'bestaudio'
      : platform === 'instagram' || platform === 'tiktok' || platform === 'twitter'
        ? 'best'
        : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    const ext = isAudio ? 'mp3' : 'mp4';
    res.set('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    res.set('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.set('Transfer-Encoding', 'chunked');

    const proc = spawn('yt-dlp', [
      '-f', formatArg,
      '--no-playlist', '--no-warnings', '--no-check-certificates',
      '-o', '-', url,
    ]);
    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});
    proc.on('error', () => { if (!res.headersSent) res.status(500).json({ success: false, error: 'Download failed.' }); });
    req.on('close', () => proc.kill());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/social/platforms ── list supported platforms ─────────────────
router.get('/platforms', (req, res) => {
  res.json({
    success: true,
    platforms: [
      { name: 'TikTok', domains: ['tiktok.com', 'vm.tiktok.com'], watermark: false, note: 'HD no-watermark via scraper' },
      { name: 'Instagram', domains: ['instagram.com'], note: 'Posts, Reels, Stories (public only)' },
      { name: 'Twitter / X', domains: ['twitter.com', 'x.com'], note: 'Tweets with video/GIF' },
      { name: 'Facebook', domains: ['facebook.com', 'fb.watch'], note: 'Public videos only' },
      { name: 'YouTube', domains: ['youtube.com', 'youtu.be'], note: 'Use /api/yt for full YouTube features' },
    ],
  });
});

module.exports = router;
