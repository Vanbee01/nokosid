const express = require('express');
const crypto = require('node:crypto');

const app = express();
const OTP_BASE_URL = (process.env.OTP_ID_BASE_URL || 'https://api.otp.id').replace(/\/$/, '');
const OTP_API_KEY = process.env.OTP_ID_API_KEY;
const OTP_BRAND = process.env.OTP_ID_BRAND || 'NokosID';
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public', { extensions: ['html'] }));

const pendingOtps = new Map();
const requestWindows = new Map();
const verifyAttempts = new Map();

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('08')) phone = '62' + phone.slice(1);
  if (phone.startsWith('8')) phone = '62' + phone;
  if (!/^62[0-9]{9,12}$/.test(phone)) return null;
  return phone;
}

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const recent = (requestWindows.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  requestWindows.set(key, recent);
  return true;
}

function signSession(phone) {
  const payload = Buffer.from(JSON.stringify({
    sub: phone,
    verifiedAt: Date.now(),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter(([k]) => k));
  const token = cookies.nokosid_session;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch (_) { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (_) { return null; }
}

function setSessionCookie(res, token) {
  const flags = ['nokosid_session=' + encodeURIComponent(token), 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' + (30 * 24 * 60 * 60)];
  if (IS_PRODUCTION) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

async function otpRequest(path, payload) {
  const response = await fetch(OTP_BASE_URL + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OTP_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || 'Penyedia SMS menolak permintaan.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'NokosID', smsConfigured: Boolean(OTP_API_KEY), timestamp: new Date().toISOString() });
});

app.post('/api/auth/request-otp', async (req, res) => {
  if (!OTP_API_KEY) return res.status(503).json({ error: 'Layanan SMS belum dikonfigurasi. API key belum dipasang di server.' });
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Masukkan nomor Indonesia yang valid, contoh 081234567890.' });

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!rateLimit('ip:' + ip, 8, 15 * 60 * 1000) || !rateLimit('phone:' + phone, 3, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.' });
  }

  try {
    const externalId = 'nokosid-' + crypto.randomUUID();
    const result = await otpRequest('/v3/request', {
      channel: 'sms',
      destination: phone,
      brand: OTP_BRAND,
      otp_length: 6,
      ttl: 300,
      external_id: externalId
    });
    const otpId = result?.data?.otp_id || result?.otp_id;
    const status = result?.data?.status || result?.status;
    if (!otpId || status === 'failed') {
      return res.status(502).json({ error: result?.error?.message || 'SMS belum dapat dikirim. Periksa saldo dan konfigurasi provider.' });
    }
    const requestId = crypto.randomUUID();
    pendingOtps.set(requestId, { phone, otpId, createdAt: Date.now() });
    setTimeout(() => pendingOtps.delete(requestId), 6 * 60 * 1000).unref?.();
    res.json({ ok: true, requestId, message: 'Kode verifikasi sedang dikirim melalui SMS.', expiresIn: 300 });
  } catch (error) {
    console.error('OTP request failed:', error.message);
    res.status(error.status === 429 ? 429 : 502).json({ error: 'Gagal mengirim SMS. Silakan coba lagi nanti.' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  if (!OTP_API_KEY) return res.status(503).json({ error: 'Layanan SMS belum dikonfigurasi.' });
  const requestId = String(req.body.requestId || '');
  const otp = String(req.body.otp || '').trim();
  const pending = pendingOtps.get(requestId);
  if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingOtps.delete(requestId);
    return res.status(400).json({ error: 'Sesi OTP sudah kedaluwarsa. Minta kode baru.' });
  }
  if (!/^[0-9]{4,8}$/.test(otp)) return res.status(400).json({ error: 'Masukkan kode angka yang valid.' });

  const attempts = (verifyAttempts.get(requestId) || 0) + 1;
  verifyAttempts.set(requestId, attempts);
  if (attempts > 5) {
    pendingOtps.delete(requestId);
    verifyAttempts.delete(requestId);
    return res.status(429).json({ error: 'Batas percobaan tercapai. Minta kode baru.' });
  }

  try {
    const result = await otpRequest('/v3/verify', { otp_id: pending.otpId, otp });
    const verified = result?.data?.verified === true || result?.verified === true;
    if (!verified) return res.status(400).json({ error: 'Kode salah atau sudah kedaluwarsa. Periksa SMS dan coba lagi.' });

    pendingOtps.delete(requestId);
    verifyAttempts.delete(requestId);
    const token = signSession(pending.phone);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { phone: pending.phone, verified: true }, message: 'Nomor berhasil diverifikasi.' });
  } catch (error) {
    console.error('OTP verification failed:', error.message);
    res.status(502).json({ error: 'Tidak dapat memverifikasi kode saat ini. Coba lagi.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: { phone: session.sub, verified: true } });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'nokosid_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (IS_PRODUCTION ? '; Secure' : ''));
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(require('node:path').join(process.cwd(), 'public', 'index.html')));

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn('SESSION_SECRET is missing or too short; authenticated routes will not work until configured.');
}

// Vercel imports this Express app as a serverless function; local Node runs it directly.
if (require.main === module) {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error('FATAL: Set SESSION_SECRET to a random secret with at least 32 characters.');
    process.exit(1);
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('NokosID listening on port ' + PORT));
}

module.exports = app;
