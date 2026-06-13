const express = require('express');
const { execFile, spawn } = require('child_process');
const fetch = require('node-fetch');
const router = express.Router();

// Check yt-dlp is available
function ytdlpAvailable() {
  return new Promise(resolve => {
    execFile('yt-dlp', ['--version'], (err) => resolve(!err));
  });
}

function ytdlpInfo(url, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      ...extraArgs,
      url,
    ];
    execFile('yt-dlp', args, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error('Could not fetch video info. Video may be unavailable or geo-blocked.'));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error('Failed to parse video info.')); }
    });
  });
}

function ytSearchUrl(q, limit = 10) {
  // Use yt-dlp to search YouTube
  return new Promise((resolve, reject) => {
    const args = [
      `ytsearch${limit}:${q}`,
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--flat-playlist',
    ];
    let output = '';
    const proc = execFile('yt-dlp', args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(new Error('Search failed.'));
      const lines = stdout.trim().split('\n').filter(Boolean);
      const results = lines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      resolve(results);
    });
  });
}

function formatVideo(v) {
  return {
    id: v.id,
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    channel: v.channel || v.uploader,
    channel_url: v.channel_url || v.uploader_url,
    duration: v.duration,
    duration_str: v.duration_string,
    view_count: v.view_count,
    upload_date: v.upload_date,
    thumbnail: v.thumbnail || (v.thumbnails ? v.thumbnails[v.thumbnails.length - 1]?.url : null),
    description: v.description ? v.description.substring(0, 300) : null,
  };
}

// GET /api/yt/search?q=lofi+chill&limit=10
router.get('/search', async (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp is not installed on this server. Contact admin.' });
  }

  try {
    const results = await ytSearchUrl(q, Math.min(parseInt(limit) || 10, 20));
    res.json({
      success: true,
      query: q,
      count: results.length,
      results: results.map(formatVideo),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/yt/info?url=https://youtu.be/...
router.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url= parameter.' });

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp is not installed on this server.' });
  }

  try {
    const info = await ytdlpInfo(url);
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none'))
      .map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        quality: f.format_note || f.height ? `${f.height}p` : f.format_id,
        resolution: f.resolution,
        filesize: f.filesize || f.filesize_approx,
        has_video: f.vcodec !== 'none',
        has_audio: f.acodec !== 'none',
        url: f.url,
      }))
      .filter(f => f.url);

    res.json({
      success: true,
      ...formatVideo(info),
      formats,
      stream_url: `/api/yt/stream?url=${encodeURIComponent(url)}&type=mp3`,
      download_url: `/api/yt/download?url=${encodeURIComponent(url)}&type=mp4`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/yt/link?url=...&type=mp3|mp4|best  — returns direct temp URL only, no proxy
router.get('/link', async (req, res) => {
  const { url, type = 'mp3' } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url= parameter.' });

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp is not installed on this server.' });
  }

  try {
    const formatArg = type === 'mp3' || type === 'audio'
      ? 'bestaudio'
      : type === 'mp4' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      : 'best';

    const info = await ytdlpInfo(url, ['-f', formatArg]);

    // Find the best matching format URL
    const fmt = (info.formats || []).reverse().find(f =>
      type === 'mp3' ? f.acodec !== 'none' && f.vcodec === 'none'
      : f.ext === 'mp4'
    ) || info.formats?.[info.formats.length - 1];

    res.json({
      success: true,
      title: info.title,
      type,
      ext: fmt?.ext || (type === 'mp3' ? 'webm' : 'mp4'),
      filesize: fmt?.filesize || fmt?.filesize_approx,
      direct_url: fmt?.url || null,
      expires: 'Direct URLs expire in ~6 hours. Re-fetch when expired.',
      note: 'This is a raw CDN URL from the source. No storage on our servers.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/yt/stream?url=...&type=mp3|mp4  — proxy stream (no storage)
router.get('/stream', async (req, res) => {
  const { url, type = 'mp3' } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url= parameter.' });

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp is not installed on this server.' });
  }

  try {
    const info = await ytdlpInfo(url);
    const title = info.title?.replace(/[^\w\s-]/g, '').trim() || 'audio';

    const isAudio = type === 'mp3' || type === 'audio';
    const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
    const ext = isAudio ? 'mp3' : 'mp4';
    const formatArg = isAudio ? 'bestaudio' : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    res.set('Content-Type', mimeType);
    res.set('Content-Disposition', `inline; filename="${title}.${ext}"`);
    res.set('Transfer-Encoding', 'chunked');
    res.set('Cache-Control', 'no-cache');

    // Stream via yt-dlp piping
    const ytArgs = [
      '-f', formatArg,
      '--no-playlist',
      '--no-warnings',
      '-o', '-',
      url,
    ];

    const proc = spawn('yt-dlp', ytArgs);
    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {}); // suppress stderr noise
    proc.on('error', () => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Stream failed.' });
    });
    req.on('close', () => proc.kill());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/yt/download?url=...&type=mp3|mp4  — same as stream but forces download
router.get('/download', async (req, res) => {
  const { url, type = 'mp3' } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url= parameter.' });

  if (!await ytdlpAvailable()) {
    return res.status(503).json({ success: false, error: 'yt-dlp is not installed on this server.' });
  }

  try {
    const info = await ytdlpInfo(url);
    const title = info.title?.replace(/[^\w\s-]/g, '').trim() || 'file';

    const isAudio = type === 'mp3' || type === 'audio';
    const mimeType = isAudio ? 'audio/mpeg' : 'video/mp4';
    const ext = isAudio ? 'mp3' : 'mp4';
    const formatArg = isAudio ? 'bestaudio' : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    res.set('Content-Type', mimeType);
    res.set('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.set('Transfer-Encoding', 'chunked');

    const proc = spawn('yt-dlp', [
      '-f', formatArg,
      '--no-playlist',
      '--no-warnings',
      '-o', '-',
      url,
    ]);

    proc.stdout.pipe(res);
    proc.stderr.on('data', () => {});
    proc.on('error', () => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Download failed.' });
    });
    req.on('close', () => proc.kill());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
