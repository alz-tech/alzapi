# AlzAPI

**Free general-purpose API by Alz-Tech**
Live at: https://api.alz.name.ng

---

## Endpoints

| Category | Endpoint | Description |
|---|---|---|
| AI | `GET /api/ai/chat?q=` | AI chat (GPT-4o, Mistral, Claude, Llama) |
| AI | `GET /api/ai/image?prompt=` | Image generation (returns image bytes) |
| AI | `GET /api/ai/image/url?prompt=` | Image generation (returns JSON with URL) |
| AI | `GET /api/ai/models` | List available AI models |
| YouTube | `GET /api/yt/search?q=` | Search YouTube |
| YouTube | `GET /api/yt/info?url=` | Get video info + formats |
| YouTube | `GET /api/yt/link?url=&type=mp3\|mp4` | Get direct temp download URL |
| YouTube | `GET /api/yt/stream?url=&type=mp3\|mp4` | Stream bytes (proxy, no storage) |
| YouTube | `GET /api/yt/download?url=&type=mp3\|mp4` | Force download |
| Movies | `GET /api/movies/search?q=` | Search movies & TV |
| Movies | `GET /api/movies/trending` | Trending today |
| Movies | `GET /api/movies/popular` | Most popular |
| Movies | `GET /api/movies/:id?type=movie\|tv` | Full details, cast, trailer |
| Music | `GET /api/music/search?q=` | Search songs |
| Music | `GET /api/music/artist?q=` | Search artists |
| Music | `GET /api/music/track/:id` | Track details |
| Music | `GET /api/music/artist/:id/tracks` | Top tracks by artist |
| Music | `GET /api/music/preview?id=` | Stream 30s preview (proxy) |
| IP | `GET /api/ip` | Caller's own IP info |
| IP | `GET /api/ip/:address` | Look up any IP or domain |

---

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your TMDB key
npm start
```

**yt-dlp** must be installed on the server for YouTube features:
```bash
pip install yt-dlp
# or
pip3 install yt-dlp
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Default 3000 |
| `APP_URL` | No | Your domain |
| `TMDB_API_KEY` | Yes (for movies) | Free at themoviedb.org/settings/api |

---

## Rate Limit

30 requests/minute per IP. No API key needed.

---

## Deploy on Render

1. Push to GitHub
2. New Web Service on Render → connect repo
3. Build command: `npm install`
4. Start command: `node src/app.js`
5. Add `TMDB_API_KEY` in environment variables
6. Add custom domain: `api.alz.name.ng`

> For yt-dlp on Render: add `pip install yt-dlp --break-system-packages` to build command (already in render.yaml)

---

By Alz-Tech · Free forever
