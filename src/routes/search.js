const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ── Simple cache ──────────────────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const e = cache.get(key);
  if (!e || Date.now() > e.expires) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data, ttlMs = 10 * 60 * 1000) {
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── Wikipedia REST API (free, no key) ─────────────────────────────────────

// GET /api/search/wiki?q=Elon+Musk&lang=en
router.get('/wiki', async (req, res) => {
  const { q, lang = 'en', sentences = 5 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  const cacheKey = `wiki_${lang}_${q.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ success: true, cached: true, ...cached });

  try {
    // Step 1: search for best match
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5&origin=*`;
    const searchRes = await fetch(searchUrl, { timeout: 10000 });
    const searchData = await searchRes.json();

    const hits = (searchData.query?.search || []);
    if (!hits.length) return res.json({ success: true, found: false, results: [] });

    const topTitle = hits[0].title;

    // Step 2: get summary + content
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
    const summaryRes = await fetch(summaryUrl, { timeout: 10000 });
    const summary = await summaryRes.json();

    // Step 3: get full sections (extract)
    const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(topTitle)}&prop=extracts|pageimages|info&exintro=true&explaintext=true&inprop=url&piprop=thumbnail&pithumbsize=500&format=json&origin=*`;
    const extractRes = await fetch(extractUrl, { timeout: 10000 });
    const extractData = await extractRes.json();
    const page = Object.values(extractData.query?.pages || {})[0] || {};

    const result = {
      found: true,
      title: summary.title,
      description: summary.description,
      extract: summary.extract,
      extract_html: summary.extract_html,
      thumbnail: summary.thumbnail?.source || page.thumbnail?.source || null,
      url: summary.content_urls?.desktop?.page || page.fullurl || null,
      mobile_url: summary.content_urls?.mobile?.page || null,
      language: lang,
      last_modified: summary.timestamp,
      related: hits.slice(1).map(h => ({
        title: h.title,
        snippet: h.snippet?.replace(/<[^>]*>/g, '') || '',
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
      })),
    };

    setCache(cacheKey, result, 30 * 60 * 1000); // 30 min
    res.json({ success: true, cached: false, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/search/wiki/search?q=...&limit=10 — search only, no full extract
router.get('/wiki/search', async (req, res) => {
  const { q, lang = 'en', limit = 10 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${Math.min(parseInt(limit) || 10, 20)}&origin=*`;
    const r = await fetch(url, { timeout: 10000 });
    const data = await r.json();

    const results = (data.query?.search || []).map(h => ({
      title: h.title,
      snippet: h.snippet?.replace(/<[^>]*>/g, '') || '',
      size: h.size,
      word_count: h.wordcount,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
    }));

    res.json({ success: true, query: q, count: results.length, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/search/wiki/random?lang=en — random Wikipedia article
router.get('/wiki/random', async (req, res) => {
  const { lang = 'en' } = req.query;
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`;
    const r = await fetch(url, { timeout: 10000 });
    const data = await r.json();
    res.json({
      success: true,
      title: data.title,
      description: data.description,
      extract: data.extract,
      thumbnail: data.thumbnail?.source || null,
      url: data.content_urls?.desktop?.page || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DuckDuckGo instant answers (free, no key) ─────────────────────────────

// GET /api/search/web?q=what+is+nodejs
router.get('/web', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  const cacheKey = `ddg_${q.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ success: true, cached: true, ...cached });

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetch(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'AlzAPI/1.0 (https://api.alz.name.ng)' },
    });
    const data = await r.json();

    // Related topics
    const related = (data.RelatedTopics || [])
      .filter(t => t.Text && t.FirstURL)
      .slice(0, 8)
      .map(t => ({ text: t.Text, url: t.FirstURL, icon: t.Icon?.URL || null }));

    // Results (from external sources)
    const results = (data.Results || []).slice(0, 5).map(r => ({
      title: r.Text,
      url: r.FirstURL,
      icon: r.Icon?.URL || null,
    }));

    const payload = {
      query: q,
      type: data.Type || 'A',
      instant_answer: data.AbstractText || data.Answer || null,
      answer_type: data.AnswerType || null,
      source: data.AbstractSource || null,
      source_url: data.AbstractURL || null,
      image: data.Image ? `https://duckduckgo.com${data.Image}` : null,
      definition: data.Definition || null,
      definition_source: data.DefinitionSource || null,
      entity: data.Heading || null,
      results,
      related,
    };

    setCache(cacheKey, payload, 15 * 60 * 1000); // 15 min
    res.json({ success: true, cached: false, ...payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/search/suggest?q=elon — autocomplete suggestions from DDG
router.get('/suggest', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= parameter.' });

  try {
    const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    res.json({
      success: true,
      query: q,
      suggestions: data[1] || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
