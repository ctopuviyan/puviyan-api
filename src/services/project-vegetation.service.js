const { fail } = require('./partner-project-policy');

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/process/v1';

const ndviEvalscript = `//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "SCL", "dataMask"],
      units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"]
    }],
    output: { id: "default", bands: 4, sampleType: "AUTO" }
  };
}

function mix(a, b, amount) {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function evaluatePixel(sample) {
  const scl = sample.SCL;
  if (sample.dataMask === 0 || [1, 3, 7, 8, 9, 10, 11].includes(scl)) {
    return [0, 0, 0, 0];
  }
  const denominator = sample.B08 + sample.B04;
  if (denominator <= 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / denominator;
  const stops = [
    { value: 0.0, color: [0.55, 0.29, 0.11] },
    { value: 0.2, color: [0.90, 0.79, 0.49] },
    { value: 0.4, color: [0.72, 0.82, 0.48] },
    { value: 0.6, color: [0.29, 0.64, 0.34] },
    { value: 0.8, color: [0.02, 0.39, 0.20] }
  ];
  const value = Math.max(0, Math.min(0.8, ndvi));
  for (let index = 1; index < stops.length; index++) {
    if (value <= stops[index].value) {
      const lower = stops[index - 1];
      const upper = stops[index];
      const amount = (value - lower.value) / (upper.value - lower.value);
      return [...mix(lower.color, upper.color, amount), 1];
    }
  }
  return [...stops[stops.length - 1].color, 1];
}`;

function createProjectVegetation({ fetchImpl = global.fetch, env = process.env, now = () => Date.now() } = {}) {
  let token = null;
  let tokenExpiresAt = 0;
  const cache = new Map();

  async function accessToken() {
    if (!env.COPERNICUS_CLIENT_ID || !env.COPERNICUS_CLIENT_SECRET) {
      fail(503, 'Sentinel-2 imagery is not configured for this environment yet.');
    }
    if (token && tokenExpiresAt > now() + 60_000) return token;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.COPERNICUS_CLIENT_ID,
      client_secret: env.COPERNICUS_CLIENT_SECRET,
    });
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) fail(502, 'Could not authenticate with Copernicus Data Space.');
    const payload = await response.json();
    if (typeof payload.access_token !== 'string') {
      fail(502, 'Copernicus Data Space did not return an access token.');
    }
    token = payload.access_token;
    tokenExpiresAt = now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return token;
  }

  function boundaryBounds(boundary) {
    const latitude = Number(boundary?.center?.latitude);
    const longitude = Number(boundary?.center?.longitude);
    const radiusMeters = Number(boundary?.radiusMeters);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        !Number.isFinite(radiusMeters) || radiusMeters < 50 || radiusMeters > 10_000) {
      fail(409, 'Add a valid project boundary before requesting satellite vegetation imagery.');
    }
    const latitudeDelta = radiusMeters / 111_320;
    const longitudeDelta = radiusMeters / (111_320 * Math.max(0.1, Math.cos(latitude * Math.PI / 180)));
    if (latitude - latitudeDelta < -90 || latitude + latitudeDelta > 90 ||
        longitude - longitudeDelta < -180 || longitude + longitudeDelta > 180) {
      fail(400, 'Sentinel-2 imagery is not available for a boundary that crosses the map edge.');
    }
    const bounds = {
      west: longitude - longitudeDelta,
      south: latitude - latitudeDelta,
      east: longitude + longitudeDelta,
      north: latitude + latitudeDelta,
      radiusMeters,
    };
    const widthMeters = 2 * radiusMeters;
    const heightMeters = latitudeDelta * 2 * 111_320;
    const pixelSizeMeters = Math.max(10, widthMeters / 1024, heightMeters / 1024);
    return {
      bounds,
      width: Math.max(16, Math.min(1024, Math.ceil(widthMeters / pixelSizeMeters))),
      height: Math.max(16, Math.min(1024, Math.ceil(heightMeters / pixelSizeMeters))),
      pixelSizeMeters: Math.round(pixelSizeMeters * 10) / 10,
    };
  }

  function validateRange(from, to) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isRealDate = value => {
      if (!datePattern.test(value || '')) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isRealDate(from) || !isRealDate(to) || from > to) {
      fail(400, 'Choose a valid Sentinel-2 date range.');
    }
    const durationDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (durationDays > 365 || Date.parse(`${to}T00:00:00Z`) > now() + 86_400_000) {
      fail(400, 'Choose a date range within the past year and no later than tomorrow.');
    }
  }

  async function image({ projectId, boundary, from, to }) {
    validateRange(from, to);
    const spatial = boundaryBounds(boundary);
    const cacheKey = `${projectId}:${from}:${to}:${JSON.stringify(boundary)}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.value;

    const bearer = await accessToken();
    const request = {
      input: {
        bounds: {
          bbox: [spatial.bounds.west, spatial.bounds.south, spatial.bounds.east, spatial.bounds.north],
          properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
        },
        data: [{
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
            maxCloudCoverage: 60,
            mosaickingOrder: 'leastCC',
          },
        }],
      },
      output: {
        width: spatial.width,
        height: spatial.height,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript: ndviEvalscript,
    };
    const response = await fetchImpl(PROCESS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      if (response.status === 429) fail(429, 'Copernicus imagery quota reached. Try again later.');
      if (response.status === 404 || response.status === 400) {
        fail(404, 'No usable Sentinel-2 image was found for this project and date range. Try a wider range.');
      }
      fail(502, 'Sentinel-2 could not process this project image. Please try again later.');
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image/png')) fail(502, 'Sentinel-2 returned an unexpected image format.');
    const imageBytes = Buffer.from(await response.arrayBuffer());
    if (!imageBytes.length || imageBytes.length > 8 * 1024 * 1024) {
      fail(502, 'Sentinel-2 returned an unusable image size.');
    }
    const result = {
      provider: 'Copernicus Sentinel-2 L2A',
      index: 'NDVI',
      from,
      to,
      width: spatial.width,
      height: spatial.height,
      resolutionMeters: spatial.pixelSizeMeters,
      boundary: spatial.bounds,
      imageBase64: imageBytes.toString('base64'),
      note: 'Least-cloudy vegetation view for the selected period. Cloudy pixels are transparent; zooming cannot reveal detail below the source pixel resolution.',
    };
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { value: result, expiresAt: now() + 3 * 60 * 60 * 1000 });
    return result;
  }

  return { image };
}

module.exports = { createProjectVegetation };
