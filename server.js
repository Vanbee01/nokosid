const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MODE DEMO: saldo, nomor, dan OTP dibuat secara simulasi.
// Integrasikan provider SMS dan payment gateway resmi sebelum penggunaan produksi.
let userBalance = 50000;
let activeOrders = [];

const services = [
  { id: 'wa', name: 'WhatsApp', icon: '◉', basePrice: 3500 },
  { id: 'tg', name: 'Telegram', icon: '➤', basePrice: 2500 },
  { id: 'go', name: 'Google / Gmail', icon: 'G', basePrice: 2000 },
  { id: 'ig', name: 'Instagram', icon: '◎', basePrice: 1800 },
  { id: 'tt', name: 'TikTok', icon: '♪', basePrice: 2200 }
];

const countries = [
  { id: '6', name: 'Indonesia', code: '+62', flag: '🇮🇩', multiplier: 1.0 },
  { id: '7', name: 'Malaysia', code: '+60', flag: '🇲🇾', multiplier: 1.2 },
  { id: '0', name: 'Rusia', code: '+7', flag: '🇷🇺', multiplier: 0.9 },
  { id: '187', name: 'Amerika Serikat', code: '+1', flag: '🇺🇸', multiplier: 1.5 }
];

app.get('/api/init', (req, res) => {
  res.json({ balance: userBalance, services, countries, orders: activeOrders });
});

app.post('/api/topup', (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 10000000) {
    return res.status(400).json({ error: 'Nominal harus berupa angka Rp1.000 sampai Rp10.000.000.' });
  }
  userBalance += amount;
  res.json({ message: 'Saldo demo berhasil ditambahkan.', balance: userBalance });
});

app.post('/api/order', (req, res) => {
  const { serviceId, countryId } = req.body;
  const service = services.find(s => s.id === serviceId);
  const country = countries.find(c => c.id === countryId);
  if (!service || !country) return res.status(400).json({ error: 'Layanan atau negara tidak ditemukan.' });

  const price = Math.round(service.basePrice * country.multiplier);
  if (userBalance < price) return res.status(400).json({ error: 'Saldo tidak mencukupi. Silakan isi saldo demo terlebih dahulu.' });

  const orderId = 'NK-' + Math.floor(100000 + Math.random() * 900000);
  const phoneNumber = `${country.code}${Math.floor(8120000000 + Math.random() * 899999999)}`;
  userBalance -= price;

  const order = {
    id: orderId, serviceName: service.name, countryName: country.name,
    phoneNumber, price, status: 'WAITING', otpCode: null,
    createdAt: Date.now(), expiresAt: Date.now() + 15 * 60 * 1000
  };
  activeOrders.unshift(order);
  res.json({ order, balance: userBalance });
});

app.get('/api/order/:id/status', (req, res) => {
  const order = activeOrders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

  if (order.status === 'WAITING' && Date.now() > order.expiresAt) {
    order.status = 'EXPIRED';
    userBalance += order.price;
  } else if (order.status === 'WAITING' && (Date.now() - order.createdAt) > 10000) {
    // OTP acak ini hanya untuk demonstrasi UI, bukan SMS sungguhan.
    order.status = 'RECEIVED';
    order.otpCode = String(Math.floor(100000 + Math.random() * 900000));
  }
  res.json({ order, balance: userBalance });
});

app.post('/api/order/:id/cancel', (req, res) => {
  const order = activeOrders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
  if (order.status !== 'WAITING') return res.status(400).json({ error: 'Pesanan ini tidak dapat dibatalkan.' });

  order.status = 'CANCELLED';
  userBalance += order.price;
  res.json({ order, balance: userBalance });
});

app.listen(PORT, () => console.log(`NokosID berjalan di http://localhost:${PORT}`));
