const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const ITUNES = 'https://itunes.apple.com';

function formatTrack(t) {
  return {
    id: t.trackId,
    title: t.trackName,
    artist: t.artistName,
    artist_id: t.artistId,
    album: t.collectionName,
    album_id: t.collectionId,
    genre: t.primaryGenreName,
    duration_ms: t.trackTimeMillis,
    duration: t.trackTimeMillis ? `${Math.floor(t.trackTimeMillis / 60000)}:${String(Math.floor((t.trackTimeMillis % 60000) / 1000)).padStart(2, '0')}` : null,
    release_date: t.releaseDate,
    cover: t.artworkUrl100 ? t.artworkUrl100.replace('100x100', '600x600') : null,
    cover_sm: t.artworkUrl100 || null,
    preview_url: t.previewUrl || null,  // 30s preview, free
    store_url: t.trackViewUrl || null,
    explicit: t.trackExplicitness === 'explicit',
    country: t.country,
  };
}

function formatArtist(a) {
  return {
    id: a.artistId,
    name: a.artistName,
    genre: a.primaryGenreName,
    store_url: a.artistViewUrl,
  };
}

// GET /api/music/search?q=Burna+Boy&limit=20&country=NG
router.get('/search', async (req, res) => {
  const { q, limit = 20, country = 'US', media = 'music' } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  try {
    const qs = new URLSearchParams({ term: q, limit, country, media, entity: 'song' });
    const r = await fetch(`${ITUNES}/search?${qs}`, { timeout: 10000 });
    const data = await r.json();

    res.json({
      success: true,
      query: q,
      count: data.resultCount,
      results: (data.results || []).map(formatTrack),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/music/artist?q=Davido  — search for artists
router.get('/artist', async (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  try {
    const qs = new URLSearchParams({ term: q, limit, entity: 'musicArtist', media: 'music' });
    const r = await fetch(`${ITUNES}/search?${qs}`, { timeout: 10000 });
    const data = await r.json();

    res.json({
      success: true,
      query: q,
      results: (data.results || []).filter(a => a.wrapperType === 'artist').map(formatArtist),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/music/track/:id
router.get('/track/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`${ITUNES}/lookup?id=${id}&entity=song`, { timeout: 10000 });
    const data = await r.json();
    const track = (data.results || []).find(t => t.wrapperType === 'track');
    if (!track) return res.status(404).json({ success: false, error: 'Track not found.' });

    res.json({ success: true, track: formatTrack(track) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/music/artist/:id/tracks — top tracks by artist ID
router.get('/artist/:id/tracks', async (req, res) => {
  const { id } = req.params;
  const { limit = 20 } = req.query;
  try {
    const r = await fetch(`${ITUNES}/lookup?id=${id}&entity=song&limit=${limit}`, { timeout: 10000 });
    const data = await r.json();
    const tracks = (data.results || []).filter(t => t.wrapperType === 'track').map(formatTrack);

    res.json({ success: true, count: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/music/preview?id=:trackId — proxy the 30s preview audio
router.get('/preview', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: 'Missing ?id= parameter.' });

  try {
    const r = await fetch(`${ITUNES}/lookup?id=${id}&entity=song`, { timeout: 10000 });
    const data = await r.json();
    const track = (data.results || []).find(t => t.wrapperType === 'track');

    if (!track || !track.previewUrl) {
      return res.status(404).json({ success: false, error: 'No preview available for this track.' });
    }

    const audio = await fetch(track.previewUrl, { timeout: 15000 });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Disposition', `inline; filename="${track.trackName}.mp3"`);
    res.set('Cache-Control', 'public, max-age=86400');
    audio.body.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
