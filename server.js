const express = require('express');
const crypto = require('node:crypto');

const app = express();
const MESSAGE_API_URL = 'https://message.co.id/api/v1/whatsapp/otp/send';
const MESSAGE_API_KEY = process.env.MESSAGE_CO_ID_API_KEY;
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
  if (!/^[1-9][0-9]{7,14}$/.test(phone)) return null;
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

function hashOtp(requestId, otp) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(requestId + ':' + otp).digest();
}

async function sendWhatsAppOtp(phone, otp, idempotencyKey) {
  const response = await fetch(MESSAGE_API_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': MESSAGE_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'Accept': 'application/json'
    },
    body: JSON.stringify({ to: phone, message: otp }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success !== true || data?.status !== 'accepted') {
    const error = new Error(data?.message || 'Message.co.id menolak pengiriman WhatsApp OTP.');
    error.status = response.status;
    throw error;
  }
  return data;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'NokosID',
    whatsappConfigured: Boolean(MESSAGE_API_KEY),
    provider: 'message.co.id-whatsapp-otp',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/auth/request-otp', async (req, res) => {
  if (!MESSAGE_API_KEY) return res.status(503).json({ error: 'Message.co.id belum dikonfigurasi. Pasang MESSAGE_CO_ID_API_KEY di server.' });
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return res.status(503).json({ error: 'Server belum memiliki SESSION_SECRET yang valid.' });

  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Masukkan nomor WhatsApp format internasional, contoh 628123456789.' });

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!rateLimit('ip:' + ip, 8, 15 * 60 * 1000) || !rateLimit('phone:' + phone, 3, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.' });
  }

  const requestId = crypto.randomUUID();
  const otp = String(crypto.randomInt(100000, 1000000));
  try {
    const result = await sendWhatsAppOtp(phone, otp, 'nokosid-' + requestId);
    const createdAt = Date.now();
    pendingOtps.set(requestId, {
      phone,
      otpHash: hashOtp(requestId, otp),
      createdAt,
      expiresAt: createdAt + 5 * 60 * 1000
    });
    setTimeout(() => {
      pendingOtps.delete(requestId);
      verifyAttempts.delete(requestId);
    }, 5 * 60 * 1000).unref?.();

    res.json({
      ok: true,
      requestId,
      message: 'Kode verifikasi telah diterima oleh layanan WhatsApp dan sedang diproses.',
      expiresIn: 300,
      providerMessageId: result.message_id
    });
  } catch (error) {
    console.error('Message.co.id WhatsApp OTP failed:', error.message);
    const status = error.status === 429 ? 429 : (error.status >= 400 && error.status < 500 ? 400 : 502);
    res.status(status).json({ error: 'Gagal mengirim WhatsApp OTP. Periksa nomor dan saldo WhatsApp, lalu coba lagi.' });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return res.status(503).json({ error: 'Server belum memiliki SESSION_SECRET yang valid.' });
  const requestId = String(req.body.requestId || '');
  const otp = String(req.body.otp || '').trim();
  const pending = pendingOtps.get(requestId);

  if (!pending || Date.now() > pending.expiresAt) {
    pendingOtps.delete(requestId);
    verifyAttempts.delete(requestId);
    return res.status(400).json({ error: 'Sesi OTP sudah kedaluwarsa. Minta kode baru.' });
  }
  if (!/^[0-9]{6}$/.test(otp)) return res.status(400).json({ error: 'Masukkan kode OTP enam angka.' });

  const attempts = (verifyAttempts.get(requestId) || 0) + 1;
  verifyAttempts.set(requestId, attempts);
  if (attempts > 5) {
    pendingOtps.delete(requestId);
    verifyAttempts.delete(requestId);
    return res.status(429).json({ error: 'Batas percobaan tercapai. Minta kode baru.' });
  }

  const supplied = hashOtp(requestId, otp);
  if (!crypto.timingSafeEqual(supplied, pending.otpHash)) {
    return res.status(400).json({ error: 'Kode OTP salah. Periksa kembali pesan WhatsApp Anda.' });
  }

  pendingOtps.delete(requestId);
  verifyAttempts.delete(requestId);
  const token = signSession(pending.phone);
  setSessionCookie(res, token);
  res.json({ ok: true, user: { phone: pending.phone, verified: true }, message: 'Nomor WhatsApp berhasil diverifikasi.' });
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

if (require.main === module) {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error('FATAL: Set SESSION_SECRET to a random secret with at least 32 characters.');
    process.exit(1);
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('NokosID listening on port ' + PORT));
}

module.exports = app;
