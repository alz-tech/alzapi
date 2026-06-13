require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname, '../public')));

// ── Global rate limit (no API key needed, but protected) ──────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many requests. Limit is 30 requests/minute per IP.',
      docs: `${process.env.APP_URL || 'https://api.alz.name.ng'}`,
    });
  },
});
app.use('/api', limiter);

// ── Security headers ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Powered-By', 'AlzAPI');
  res.set('Referrer-Policy', 'no-referrer');
  // Hide that we're proxying/scraping
  res.removeHeader('Server');
  next();
});

// ── Block suspicious user agents / bots on download routes ────────────────
const BLOCKED_UA = /sqlmap|nikto|masscan|zgrab|nmap|python-requests\/2\.[0-4]/i;
app.use('/api/social', (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (BLOCKED_UA.test(ua)) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/movies',   require('./routes/movies'));
app.use('/api/music',    require('./routes/music'));
app.use('/api/yt',       require('./routes/youtube'));
app.use('/api/ip',       require('./routes/ip'));
app.use('/api/social',   require('./routes/social'));
app.use('/api/currency', require('./routes/currency'));
app.use('/api/search',   require('./routes/search'));

// ── Root API info ──────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    success: true,
    name: 'AlzAPI',
    version: '1.0.0',
    by: 'Alz-Tech',
    base: process.env.APP_URL || 'https://api.alz.name.ng',
    endpoints: {
      ai: {
        chat:  '/api/ai/chat?q=hello',
        image: '/api/ai/image?prompt=a+purple+galaxy',
      },
      movies: {
        search: '/api/movies/search?q=avengers',
        info:   '/api/movies/:id',
        trending: '/api/movies/trending',
      },
      music: {
        search: '/api/music/search?q=Burna+Boy',
        info:   '/api/music/track/:id',
      },
      youtube: {
        search:   '/api/yt/search?q=lofi+chill',
        info:     '/api/yt/info?url=https://youtu.be/...',
        stream:   '/api/yt/stream?url=https://youtu.be/...&type=mp3',
        download: '/api/yt/download?url=https://youtu.be/...&type=mp4',
      },
      social: {
        platforms: '/api/social/platforms',
        info:      '/api/social/info?url=https://www.tiktok.com/...',
        download:  '/api/social/download?url=https://www.tiktok.com/...&type=video',
      },
      currency: {
        convert:        '/api/currency/convert?from=USD&to=NGN&amount=100',
        rates:          '/api/currency/rates?base=USD',
        list:           '/api/currency/list',
        history:        '/api/currency/history?from=USD&to=NGN&days=30',
        crypto:         '/api/currency/crypto?coins=bitcoin,ethereum&vs=usd',
        crypto_convert: '/api/currency/crypto/convert?from=bitcoin&to=ngn&amount=0.5',
      },
      search: {
        wiki:        '/api/search/wiki?q=Elon+Musk',
        wiki_search: '/api/search/wiki/search?q=quantum+physics&limit=10',
        wiki_random: '/api/search/wiki/random',
        web:         '/api/search/web?q=what+is+nodejs',
        suggest:     '/api/search/suggest?q=elon',
      },
    },
    rateLimit: '30 requests/minute per IP — completely free, no key needed',
  });
});

// ── Landing page ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found. See /api for available routes.' });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`AlzAPI running on port ${PORT}`);
});
