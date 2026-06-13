const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const FIELDS = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query';

async function lookupIP(ip) {
  const url = `http://ip-api.com/json/${ip}?fields=${FIELDS}`;
  const r = await fetch(url, { timeout: 8000 });
  const data = await r.json();
  if (data.status === 'fail') throw new Error(data.message || 'IP lookup failed.');
  return {
    ip: data.query,
    country: data.country,
    country_code: data.countryCode,
    region: data.regionName,
    region_code: data.region,
    city: data.city,
    zip: data.zip,
    lat: data.lat,
    lon: data.lon,
    timezone: data.timezone,
    isp: data.isp,
    org: data.org,
    asn: data.as,
    asname: data.asname,
    flags: {
      mobile: data.mobile,
      proxy: data.proxy,
      hosting: data.hosting,
    },
    map: `https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}#map=12/${data.lat}/${data.lon}`,
  };
}

// GET /api/ip  — caller's own IP
router.get('/', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
    const result = await lookupIP(ip);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ip/:address  — look up any IP or domain
router.get('/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const result = await lookupIP(address);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
