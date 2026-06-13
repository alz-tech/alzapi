const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// GET /api/ai/chat?q=your+question&model=openai
router.get('/chat', async (req, res) => {
  const { q, model = 'openai', system = 'You are a helpful assistant.' } = req.query;
  if (!q) return res.status(400).json({ success: false, error: 'Missing ?q= query parameter.' });

  try {
    const encoded = encodeURIComponent(q);
    const url = `https://text.pollinations.ai/${encoded}?model=${model}&system=${encodeURIComponent(system)}&json=false`;
    const response = await fetch(url, { timeout: 20000 });
    if (!response.ok) throw new Error(`Upstream error: ${response.status}`);
    const text = await response.text();
    res.json({
      success: true,
      model,
      query: q,
      response: text.trim(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ai/models — list available models
router.get('/models', async (req, res) => {
  try {
    const r = await fetch('https://text.pollinations.ai/models', { timeout: 10000 });
    const data = await r.json();
    res.json({ success: true, models: data });
  } catch (err) {
    // Fallback known models
    res.json({
      success: true,
      models: ['openai', 'mistral', 'claude', 'llama', 'gemini'],
      note: 'Could not fetch live list from upstream.',
    });
  }
});

// GET /api/ai/image?prompt=a+purple+galaxy&width=1024&height=1024&model=flux
router.get('/image', async (req, res) => {
  const { prompt, width = 1024, height = 1024, model = 'flux', seed } = req.query;
  if (!prompt) return res.status(400).json({ success: false, error: 'Missing ?prompt= parameter.' });

  try {
    const encoded = encodeURIComponent(prompt);
    let url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=${model}&nologo=true`;
    if (seed) url += `&seed=${seed}`;

    const response = await fetch(url, { timeout: 30000 });
    if (!response.ok) throw new Error(`Image generation failed: ${response.status}`);

    // Proxy the image bytes directly
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Prompt', prompt.substring(0, 100));
    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ai/image/url?prompt=...  — returns a JSON with the image URL instead of bytes
router.get('/image/url', async (req, res) => {
  const { prompt, width = 1024, height = 1024, model = 'flux', seed } = req.query;
  if (!prompt) return res.status(400).json({ success: false, error: 'Missing ?prompt= parameter.' });

  const encoded = encodeURIComponent(prompt);
  let url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=${model}&nologo=true`;
  if (seed) url += `&seed=${seed}`;

  res.json({
    success: true,
    prompt,
    model,
    width: parseInt(width),
    height: parseInt(height),
    url,
    note: 'Image is generated on-demand. Each call may produce a different result unless seed is set.',
  });
});

module.exports = router;
