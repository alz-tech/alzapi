const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w500';
const KEY = () => process.env.TMDB_API_KEY || '';

function tmdbFetch(path, params = {}) {
  const qs = new URLSearchParams({ api_key: KEY(), ...params }).toString();
  return fetch(`${TMDB_BASE}${path}?${qs}`, { timeout: 10000 });
}

function formatMovie(m) {
  return {
    id: m.id,
    title: m.title || m.name,
    type: m.media_type || (m.first_air_date ? 'tv' : 'movie'),
    overview: m.overview,
    release_date: m.release_date || m.first_air_date,
    rating: m.vote_average,
    votes: m.vote_count,
    popularity: m.popularity,
    poster: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null,
    genres: m.genre_ids || (m.genres ? m.genres.map(g => g.name) : []),
    language: m.original_language,
  };
}

// GET /api/movies/search?q=avengers&page=1
router.get('/search', async (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });
  if (!KEY()) return res.status(503).json({ success: false, error: 'TMDB API key not configured on server.' });

  try {
    const r = await tmdbFetch('/search/multi', { query: q, page, include_adult: false });
    const data = await r.json();
    res.json({
      success: true,
      query: q,
      page: data.page,
      total_results: data.total_results,
      total_pages: data.total_pages,
      results: (data.results || []).filter(m => m.media_type !== 'person').map(formatMovie),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/movies/trending?type=movie|tv&time=day|week
router.get('/trending', async (req, res) => {
  const { type = 'all', time = 'week' } = req.query;
  if (!KEY()) return res.status(503).json({ success: false, error: 'TMDB API key not configured on server.' });

  try {
    const r = await tmdbFetch(`/trending/${type}/${time}`);
    const data = await r.json();
    res.json({
      success: true,
      type,
      time_window: time,
      results: (data.results || []).map(formatMovie),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/movies/popular?type=movie|tv
router.get('/popular', async (req, res) => {
  const { type = 'movie', page = 1 } = req.query;
  if (!KEY()) return res.status(503).json({ success: false, error: 'TMDB API key not configured on server.' });

  try {
    const r = await tmdbFetch(`/${type}/popular`, { page });
    const data = await r.json();
    res.json({
      success: true,
      type,
      page: data.page,
      total_pages: data.total_pages,
      results: (data.results || []).map(formatMovie),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/movies/:id?type=movie|tv
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { type = 'movie' } = req.query;
  if (!KEY()) return res.status(503).json({ success: false, error: 'TMDB API key not configured on server.' });

  try {
    const [detailRes, creditsRes, videosRes] = await Promise.all([
      tmdbFetch(`/${type}/${id}`, { append_to_response: 'genres' }),
      tmdbFetch(`/${type}/${id}/credits`),
      tmdbFetch(`/${type}/${id}/videos`),
    ]);

    const detail  = await detailRes.json();
    const credits = await creditsRes.json();
    const videos  = await videosRes.json();

    if (detail.status_code === 34) {
      return res.status(404).json({ success: false, error: 'Movie/show not found.' });
    }

    const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');

    res.json({
      success: true,
      ...formatMovie(detail),
      tagline: detail.tagline,
      runtime: detail.runtime,
      status: detail.status,
      budget: detail.budget,
      revenue: detail.revenue,
      genres: (detail.genres || []).map(g => g.name),
      cast: (credits.cast || []).slice(0, 10).map(c => ({
        id: c.id,
        name: c.name,
        character: c.character,
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      })),
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      trailer_embed: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
