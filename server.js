const express = require('express');
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
const OTP_API_URL = 'https://message.co.id/api/v1/whatsapp/otp/send';
const VIRTUSIM_URL = process.env.VIRTUSIM_API_URL || 'https://virtusim.com/api/json.php';
const VIRTUSIM_KEY = process.env.VIRTUSIM_API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_PHONE = String(process.env.ADMIN_PHONE || '').replace(/\D/g, '');
const MARKUP_PERCENT = Math.max(0, Math.min(200, Number(process.env.PRICE_MARKUP_PERCENT || 20)));
const rateWindows = new Map();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public', { extensions: ['html'] }));

function db() {
  if (!sql) throw new Error('Database belum dikonfigurasi. Tambahkan DATABASE_URL.');
  return sql;
}
function ensureConfig() {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET minimal 32 karakter belum dikonfigurasi.');
}
async function ensureSchema() {
  const statements = [
    'CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, phone VARCHAR(20) UNIQUE NOT NULL, role VARCHAR(20) NOT NULL DEFAULT \'user\', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), is_active BOOLEAN NOT NULL DEFAULT TRUE)',
    'CREATE TABLE IF NOT EXISTS otp_requests (id UUID PRIMARY KEY, phone VARCHAR(20) NOT NULL, otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip_hash TEXT)',
    'CREATE INDEX IF NOT EXISTS otp_phone_created_idx ON otp_requests(phone, created_at DESC)',
    'CREATE TABLE IF NOT EXISTS wallets (user_id BIGINT PRIMARY KEY REFERENCES users(id), balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    'CREATE TABLE IF NOT EXISTS wallet_ledger (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), entry_type VARCHAR(30) NOT NULL, amount BIGINT NOT NULL, reference_id TEXT NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(entry_type, reference_id))',
    'CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), service_id TEXT NOT NULL, service_name TEXT NOT NULL, provider_order_id TEXT, phone VARCHAR(30), price BIGINT NOT NULL, status VARCHAR(30) NOT NULL, sms TEXT, otp TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    'CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC)',
    'CREATE TABLE IF NOT EXISTS deposits (id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), amount BIGINT NOT NULL CHECK (amount > 0), note TEXT, status VARCHAR(20) NOT NULL DEFAULT \'pending\', reviewed_by BIGINT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)'
  ];
  for (const statement of statements) await db().query(statement, []);
}
function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('08')) phone = '62' + phone.slice(1);
  if (phone.startsWith('8')) phone = '62' + phone;
  return /^[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}
function allowRate(key, max, windowMs) {
  const now = Date.now();
  const recent = (rateWindows.get(key) || []).filter(t => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  rateWindows.set(key, recent);
  return true;
}
function hash(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(user.id), phone: user.phone, role: user.role,
    exp: Math.floor(Date.now() / 1000) + 30 * 86400
  })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function getCookie(req, name) {
  const parts = (req.headers.cookie || '').split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function readSession(req) {
  try {
    const token = getCookie(req, 'nokosid_session');
    if (!token) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.sub || data.exp < Date.now() / 1000) return null;
    return data;
  } catch (_) { return null; }
}
function setCookie(res, token) {
  res.setHeader('Set-Cookie', 'nokosid_session=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' + (isProd ? '; Secure' : ''));
}
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origin tidak diizinkan.' });
    } catch (_) { return res.status(403).json({ error: 'Origin tidak valid.' }); }
  }
  next();
}
async function auth(req, res, next) {
  try {
    ensureConfig();
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    const [user] = await db().query('SELECT id, phone, role, is_active FROM users WHERE id = $1', [session.sub]);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Akun tidak aktif atau sesi berakhir.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
}
function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Akses admin diperlukan.' });
  next();
}
async function provider(action, params = {}) {
  if (!VIRTUSIM_KEY) throw new Error('VirtuSIM belum dikonfigurasi.');
  const url = new URL(VIRTUSIM_URL);
  url.searchParams.set('api_key', VIRTUSIM_KEY);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== true) {
    const message = data?.data?.msg || data?.msg || 'Provider menolak permintaan.';
    throw new Error(message);
  }
  return data;
}
function money(value) { return Number(value || 0); }
function publicOrder(row) {
  return { id: row.id, serviceName: row.service_name, serviceId: row.service_id, phone: row.phone, price: Number(row.price), status: row.status, sms: row.sms, otp: row.otp, createdAt: row.created_at };
}
function extractOtp(text) {
  const match = String(text || '').match(/(?:^|\D)(\d{4,8})(?:\D|$)/);
  return match ? match[1] : null;
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, service: 'NokosID', databaseConfigured: Boolean(sql), whatsappConfigured: Boolean(process.env.MESSAGE_CO_ID_API_KEY), virtusimConfigured: Boolean(VIRTUSIM_KEY) });
});

app.post('/api/auth/request-otp', sameOrigin, async (req, res, next) => {
  try {
    ensureConfig();
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Masukkan nomor WhatsApp yang valid, contoh 628123456789.' });
    const ip = req.ip || 'unknown';
    if (!allowRate('ip:' + ip, 8, 15 * 60 * 1000) || !allowRate('phone:' + phone, 3, 15 * 60 * 1000)) return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi 15 menit.' });
    if (!process.env.MESSAGE_CO_ID_API_KEY) return res.status(503).json({ error: 'WhatsApp OTP belum dikonfigurasi oleh admin.' });
    await ensureSchema();
    const recent = await db().query("SELECT COUNT(*)::int AS count FROM otp_requests WHERE phone = $1 AND created_at > NOW() - INTERVAL '15 minutes'", [phone]);
    if (recent[0].count >= 3) return res.status(429).json({ error: 'Batas permintaan OTP untuk nomor ini tercapai. Coba lagi 15 menit.' });
    const requestId = crypto.randomUUID();
    const otp = String(crypto.randomInt(100000, 1000000));
    const response = await fetch(OTP_API_URL, {
      method: 'POST',
      headers: { 'X-API-Key': process.env.MESSAGE_CO_ID_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'nokosid-' + requestId, Accept: 'application/json' },
      body: JSON.stringify({ to: phone, message: otp }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success !== true || result?.status !== 'accepted') return res.status(502).json({ error: 'WhatsApp OTP gagal dikirim. Periksa saldo dan konfigurasi provider.' });
    await db().query('INSERT INTO otp_requests(id, phone, otp_hash, expires_at, ip_hash) VALUES($1, $2, $3, NOW() + INTERVAL \'5 minutes\', $4)', [requestId, phone, hash(requestId + ':' + otp), hash(ip)]);
    res.json({ ok: true, requestId, expiresIn: 300, message: 'Kode verifikasi telah diminta melalui WhatsApp.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/verify-otp', sameOrigin, async (req, res, next) => {
  try {
    ensureConfig();
    await ensureSchema();
    const requestId = String(req.body.requestId || '');
    const otp = String(req.body.otp || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9]{6}$/.test(otp)) return res.status(400).json({ error: 'Request atau kode OTP tidak valid.' });
    const [pending] = await db().query('SELECT id, phone, otp_hash, attempts, expires_at, used_at FROM otp_requests WHERE id = $1', [requestId]);
    if (!pending || pending.used_at || new Date(pending.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Kode OTP kedaluwarsa. Minta kode baru.' });
    if (pending.attempts >= 5) return res.status(429).json({ error: 'Batas percobaan tercapai. Minta kode baru.' });
    await db().query('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1', [requestId]);
    const supplied = Buffer.from(hash(requestId + ':' + otp), 'hex');
    const expected = Buffer.from(pending.otp_hash, 'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(400).json({ error: 'Kode OTP salah.' });
    await db().query('UPDATE otp_requests SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [requestId]);
    const role = ADMIN_PHONE && pending.phone === ADMIN_PHONE ? 'admin' : 'user';
    const [user] = await db().query('INSERT INTO users(phone, role) VALUES($1, $2) ON CONFLICT(phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, phone, role, is_active', [pending.phone, role]);
    await db().query('INSERT INTO wallets(user_id, balance) VALUES($1, 0) ON CONFLICT(user_id) DO NOTHING', [user.id]);
    if (!user.is_active) return res.status(403).json({ error: 'Akun dinonaktifkan oleh admin.' });
    setCookie(res, makeSession(user));
    res.json({ ok: true, user: { id: user.id, phone: user.phone, role: user.role, verified: true } });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', auth, async (req, res) => res.json({ authenticated: true, user: { id: req.user.id, phone: req.user.phone, role: req.user.role } }));
app.post('/api/auth/logout', sameOrigin, (req, res) => {
  res.setHeader('Set-Cookie', 'nokosid_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (isProd ? '; Secure' : ''));
  res.json({ ok: true });
});

app.get('/api/wallet', auth, async (req, res, next) => {
  try {
    const [wallet] = await db().query('SELECT balance FROM wallets WHERE user_id = $1', [req.user.id]);
    const ledger = await db().query('SELECT entry_type, amount, note, created_at FROM wallet_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [req.user.id]);
    res.json({ balance: Number(wallet?.balance || 0), ledger });
  } catch (error) { next(error); }
});

app.post('/api/wallet/deposit', sameOrigin, auth, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body.amount));
    const note = String(req.body.note || '').slice(0, 300);
    if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 5000000) return res.status(400).json({ error: 'Nominal deposit minimal Rp10.000 dan maksimal Rp5.000.000.' });
    const id = crypto.randomUUID();
    await db().query('INSERT INTO deposits(id, user_id, amount, note) VALUES($1, $2, $3, $4)', [id, req.user.id, amount, note]);
    res.json({ ok: true, depositId: id, message: 'Permintaan deposit dicatat dan menunggu pemeriksaan admin.' });
  } catch (error) { next(error); }
});

app.get('/api/services', auth, async (req, res, next) => {
  try {
    const data = await provider('services', { country: 'indo' });
    const services = (data.data || []).map(item => {
      const base = money(item.price);
      return { id: String(item.id), name: String(item.name), available: money(item.tersedia), price: Math.ceil(base * (1 + MARKUP_PERCENT / 100)), category: item.category || 'OTP' };
    });
    res.json({ services });
  } catch (error) { next(error); }
});

app.post('/api/orders', sameOrigin, auth, async (req, res, next) => {
  let orderId;
  try {
    const serviceId = String(req.body.serviceId || '').slice(0, 40);
    const servicesData = await provider('services', { country: 'indo' });
    const service = (servicesData.data || []).find(item => String(item.id) === serviceId);
    if (!service) return res.status(400).json({ error: 'Layanan tidak ditemukan atau tidak tersedia.' });
    if (money(service.tersedia) < 1) return res.status(409).json({ error: 'Stok nomor untuk layanan ini sedang habis.' });
    const price = Math.ceil(money(service.price) * (1 + MARKUP_PERCENT / 100));
    if (!Number.isSafeInteger(price) || price < 1) return res.status(400).json({ error: 'Harga layanan tidak valid.' });
    orderId = crypto.randomUUID();
    const statements = [
      db().query('UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2 AND balance >= $1 RETURNING balance', [price, req.user.id]),
      db().query('INSERT INTO orders(id, user_id, service_id, service_name, price, status) VALUES($1, $2, $3, $4, $5, $6)', [orderId, req.user.id, serviceId, String(service.name), price, 'creating']),
      db().query('INSERT INTO wallet_ledger(user_id, entry_type, amount, reference_id, note) VALUES($1, $2, $3, $4, $5)', [req.user.id, 'PURCHASE', -price, orderId, 'Pembelian nomor ' + service.name])
    ];
    const results = await db().transaction(statements);
    if (!results[0]?.length) return res.status(402).json({ error: 'Saldo tidak mencukupi.' });
    const bought = await provider('order', { service: serviceId, operator: process.env.VIRTUSIM_OPERATOR || 'any' });
    const item = bought.data || {};
    await db().query('UPDATE orders SET provider_order_id = $1, phone = $2, status = $3, updated_at = NOW() WHERE id = $4', [String(item.id || ''), String(item.number || ''), 'pending', orderId]);
    const [row] = await db().query('SELECT * FROM orders WHERE id = $1', [orderId]);
    res.json({ ok: true, order: publicOrder(row), balance: Number(results[0][0].balance) });
  } catch (error) {
    if (orderId) {
      try {
        const [row] = await db().query('SELECT user_id, price, status FROM orders WHERE id = $1', [orderId]);
        if (row && row.status === 'creating') {
          await db().transaction([
            db().query('UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2', [row.price, row.user_id]),
            db().query('INSERT INTO wallet_ledger(user_id, entry_type, amount, reference_id, note) VALUES($1, $2, $3, $4, $5) ON CONFLICT(entry_type, reference_id) DO NOTHING', [row.user_id, 'REFUND', row.price, orderId, 'Refund otomatis karena order gagal']),
            db().query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', ['failed_refunded', orderId])
          ]);
        }
      } catch (refundError) { console.error('Order refund reconciliation failed:', refundError.message); }
    }
    next(error);
  }
});

app.get('/api/orders', auth, async (req, res, next) => {
  try {
    const rows = await db().query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json({ orders: rows.map(publicOrder) });
  } catch (error) { next(error); }
});

app.get('/api/orders/:id', auth, async (req, res, next) => {
  try {
    const [row] = await db().query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    if (row.provider_order_id && ['pending', 'processing'].includes(row.status)) {
      const statusData = await provider('status', { id: row.provider_order_id });
      const data = statusData.data || {};
      const sms = String(data.sms || data.otp || row.sms || '');
      const status = String(data.status || row.status).toLowerCase();
      const mapped = status.includes('success') || status.includes('otp received') ? 'success' : status.includes('error') ? 'failed' : status.includes('process') ? 'processing' : 'pending';
      await db().query('UPDATE orders SET status = $1, sms = $2, otp = $3, updated_at = NOW() WHERE id = $4', [mapped, sms, extractOtp(sms), row.id]);
      const [fresh] = await db().query('SELECT * FROM orders WHERE id = $1', [row.id]);
      return res.json({ order: publicOrder(fresh) });
    }
    res.json({ order: publicOrder(row) });
  } catch (error) { next(error); }
});

app.post('/api/orders/:id/cancel', sameOrigin, auth, async (req, res, next) => {
  try {
    const [row] = await db().query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    if (!['pending', 'processing'].includes(row.status)) return res.status(409).json({ error: 'Pesanan tidak dapat dibatalkan pada status ini.' });
    const result = await provider('set_status', { id: row.provider_order_id, status: 2 });
    if (result.status !== true) return res.status(502).json({ error: 'Provider belum mengonfirmasi pembatalan.' });
    await db().transaction([
      db().query('UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2', [row.price, req.user.id]),
      db().query('INSERT INTO wallet_ledger(user_id, entry_type, amount, reference_id, note) VALUES($1, $2, $3, $4, $5) ON CONFLICT(entry_type, reference_id) DO NOTHING', [req.user.id, 'REFUND', row.price, row.id, 'Refund pembatalan pesanan']),
      db().query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', ['cancelled', row.id])
    ]);
    res.json({ ok: true, message: 'Pesanan dibatalkan dan saldo dikembalikan.' });
  } catch (error) { next(error); }
});

app.get('/api/admin/deposits', auth, admin, async (req, res, next) => {
  try {
    const rows = await db().query("SELECT d.*, u.phone FROM deposits d JOIN users u ON u.id=d.user_id WHERE d.status='pending' ORDER BY d.created_at ASC LIMIT 100");
    res.json({ deposits: rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/deposits/:id/approve', sameOrigin, auth, admin, async (req, res, next) => {
  try {
    const [deposit] = await db().query("SELECT * FROM deposits WHERE id=$1 AND status='pending'", [req.params.id]);
    if (!deposit) return res.status(404).json({ error: 'Deposit tidak ditemukan atau sudah diproses.' });
    await db().transaction([
      db().query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE user_id=$2', [deposit.amount, deposit.user_id]),
      db().query('INSERT INTO wallet_ledger(user_id, entry_type, amount, reference_id, note) VALUES($1,$2,$3,$4,$5)', [deposit.user_id, 'DEPOSIT', deposit.amount, deposit.id, 'Deposit disetujui admin']),
      db().query("UPDATE deposits SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 AND status='pending'", [req.user.id, deposit.id])
    ]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/admin/summary', auth, admin, async (req, res, next) => {
  try {
    const [users] = await db().query('SELECT COUNT(*)::int AS total FROM users', []);
    const [orders] = await db().query('SELECT COUNT(*)::int AS total FROM orders', []);
    const [volume] = await db().query("SELECT COALESCE(SUM(amount),0)::bigint AS total FROM wallet_ledger WHERE entry_type='PURCHASE'", []);
    res.json({ users: users.total, orders: orders.total, volume: Number(volume.total) });
  } catch (error) { next(error); }
});

app.get('*', (req, res) => res.sendFile(require('node:path').join(process.cwd(), 'public', 'index.html')));
app.use((error, req, res, next) => {
  console.error('API error:', error.message);
  const message = error.message.includes('belum dikonfigurasi') ? error.message : 'Terjadi kesalahan server. Coba beberapa saat lagi.';
  res.status(500).json({ error: message });
});

module.exports = app;
