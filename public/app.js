const state = { balance: 0, services: [], countries: [], orders: [] };
const $ = id => document.getElementById(id);
const elBalance = $('user-balance'), elService = $('select-service'), elCountry = $('select-country');
const elPrice = $('estimated-price'), elOrdersList = $('orders-list'), elAlert = $('alert-box');
let toastTimer;

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function showAlert(message) {
  elAlert.textContent = message;
  elAlert.classList.remove('hidden');
}
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Terjadi kesalahan. Coba lagi.');
  return data;
}
function updateEstimatedPrice() {
  const service = state.services.find(s => s.id === elService.value);
  const country = state.countries.find(c => c.id === elCountry.value);
  if (service && country) elPrice.textContent = formatRupiah(Math.round(service.basePrice * country.multiplier));
}
function updateStats() {
  $('active-count').textContent = state.orders.filter(o => o.status === 'WAITING').length;
  $('received-count').textContent = state.orders.filter(o => o.status === 'RECEIVED').length;
  $('order-total').textContent = `${state.orders.length} PESANAN`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function renderOrders() {
  updateStats();
  if (!state.orders.length) {
    elOrdersList.innerHTML = '<div class="empty-state"><div class="empty-icon">▤</div><strong>Belum ada pesanan</strong><p>Nomor yang kamu pesan akan muncul di sini.</p></div>';
    return;
  }
  elOrdersList.innerHTML = state.orders.map(order => {
    let status = '';
    if (order.status === 'WAITING') status = `<div class="order-right"><span class="waiting">● Menunggu SMS</span><button class="btn-cancel" data-cancel="${escapeHtml(order.id)}">Batalkan</button></div>`;
    else if (order.status === 'RECEIVED') status = `<div class="order-right"><div class="otp-box"><div class="order-meta">KODE OTP MASUK</div><div class="otp-code" data-copy="${escapeHtml(order.otpCode)}">${escapeHtml(order.otpCode)}</div></div></div>`;
    else status = `<div class="order-right"><span class="cancelled">${order.status === 'EXPIRED' ? 'Kedaluwarsa · Refund' : 'Dibatalkan · Refund'}</span></div>`;
    return `<article class="order-item"><div><div class="order-meta">${escapeHtml(order.serviceName)} · ${escapeHtml(order.countryName)} · #${escapeHtml(order.id)}</div><div class="phone-display" data-copy="${escapeHtml(order.phoneNumber)}">${escapeHtml(order.phoneNumber)}　<span style="font-size:10px;color:#8093b7">▢ salin</span></div><div class="order-price">Biaya ${formatRupiah(order.price)}</div></div>${status}</article>`;
  }).join('');
}
async function refreshOrder(order) {
  try {
    const data = await api(`/api/order/${encodeURIComponent(order.id)}/status`);
    const index = state.orders.findIndex(o => o.id === order.id);
    if (index !== -1) state.orders[index] = data.order;
    state.balance = data.balance;
    elBalance.textContent = formatRupiah(state.balance);
  } catch (_) {}
}
elOrdersList.addEventListener('click', async event => {
  const copyTarget = event.target.closest('[data-copy]');
  if (copyTarget) {
    try { await navigator.clipboard.writeText(copyTarget.dataset.copy); showToast('Berhasil disalin ke clipboard'); }
    catch (_) { showToast('Tidak dapat mengakses clipboard di browser ini'); }
  }
  const cancelTarget = event.target.closest('[data-cancel]');
  if (cancelTarget) {
    cancelTarget.disabled = true;
    try {
      const data = await api(`/api/order/${encodeURIComponent(cancelTarget.dataset.cancel)}/cancel`, { method: 'POST' });
      state.balance = data.balance;
      const index = state.orders.findIndex(o => o.id === data.order.id);
      if (index !== -1) state.orders[index] = data.order;
      elBalance.textContent = formatRupiah(state.balance);
      renderOrders();
      showToast('Pesanan dibatalkan. Saldo demo dikembalikan.');
    } catch (error) { showToast(error.message); cancelTarget.disabled = false; }
  }
});
elService.addEventListener('change', updateEstimatedPrice);
elCountry.addEventListener('change', updateEstimatedPrice);
$('btn-order').addEventListener('click', async () => {
  const button = $('btn-order');
  button.disabled = true;
  elAlert.classList.add('hidden');
  try {
    const data = await api('/api/order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ serviceId: elService.value, countryId: elCountry.value }) });
    state.balance = data.balance;
    state.orders.unshift(data.order);
    elBalance.textContent = formatRupiah(state.balance);
    renderOrders();
    showToast('Nomor demo berhasil dibuat.');
  } catch (error) { showAlert(error.message); }
  finally { button.disabled = false; }
});
$('btn-topup').addEventListener('click', async () => {
  const raw = prompt('Masukkan nominal isi saldo demo (minimal Rp1.000):', '25000');
  if (raw === null) return;
  const amount = Number(raw);
  try {
    const data = await api('/api/topup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount }) });
    state.balance = data.balance;
    elBalance.textContent = formatRupiah(state.balance);
    showToast('Saldo demo berhasil ditambahkan.');
  } catch (error) { showAlert(error.message); }
});
async function initApp() {
  try {
    const data = await api('/api/init');
    Object.assign(state, data);
    elBalance.textContent = formatRupiah(state.balance);
    elService.innerHTML = state.services.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    elCountry.innerHTML = state.countries.map(c => `<option value="${escapeHtml(c.id)}">${c.flag} ${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`).join('');
    updateEstimatedPrice();
    renderOrders();
    $('today-date').textContent = new Intl.DateTimeFormat('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date());
  } catch (error) {
    showAlert('Tidak dapat terhubung ke server. Pastikan server Node.js sedang berjalan.');
  }
}
setInterval(async () => {
  const waiting = state.orders.filter(o => o.status === 'WAITING');
  if (!waiting.length) return;
  for (const order of waiting) await refreshOrder(order);
  renderOrders();
}, 3000);
initApp();
