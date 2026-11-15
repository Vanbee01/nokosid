const $ = id => document.getElementById(id);
const phoneForm = $('phone-form');
const otpForm = $('otp-form');
const notice = $('notice');
let currentRequestId = null;
let currentPhone = '';

function showNotice(message, type = 'error') {
  notice.textContent = message;
  notice.className = 'notice ' + type;
}
function clearNotice() {
  notice.textContent = '';
  notice.className = 'notice hidden';
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Terjadi kesalahan. Coba lagi.');
  return data;
}
function showAccount(phone) {
  $('auth-view').classList.add('hidden');
  $('account-view').classList.remove('hidden');
  $('account-phone').textContent = '+' + phone;
}
function normalizeInputPhone(value) {
  return value.replace(/[^0-9+]/g, '');
}

phoneForm.addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const button = $('send-button');
  const phone = normalizeInputPhone($('phone').value);
  button.disabled = true;
  button.textContent = 'Mengirim SMS...';
  try {
    const data = await api('/api/auth/request-otp', { phone });
    currentRequestId = data.requestId;
    currentPhone = phone;
    phoneForm.classList.add('hidden');
    otpForm.classList.remove('hidden');
    $('form-title').textContent = 'Cek SMS kamu';
    $('form-subtitle').textContent = 'Masukkan kode yang dikirim ke nomor ponsel kamu.';
    $('code-hint').textContent = data.message + ' Kode berlaku 5 menit.';
    $('otp').focus();
    showNotice('Permintaan SMS berhasil dibuat.', 'success');
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Kirim kode SMS <span>→</span>';
  }
});

otpForm.addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const button = $('verify-button');
  button.disabled = true;
  button.textContent = 'Memeriksa kode...';
  try {
    const data = await api('/api/auth/verify-otp', { requestId: currentRequestId, otp: $('otp').value.trim() });
    showAccount(data.user.phone);
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Verifikasi nomor <span>→</span>';
  }
});

$('back-button').addEventListener('click', () => {
  currentRequestId = null;
  otpForm.classList.add('hidden');
  phoneForm.classList.remove('hidden');
  $('form-title').textContent = 'Masuk atau daftar';
  $('form-subtitle').textContent = 'Masukkan nomor ponsel aktif untuk menerima kode verifikasi.';
  $('otp').value = '';
  clearNotice();
});
$('logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', {}); } catch (_) {}
  $('account-view').classList.add('hidden');
  $('auth-view').classList.remove('hidden');
  $('phone').value = '';
  currentRequestId = null;
  clearNotice();
});

(async function init() {
  try {
    const data = await api('/api/auth/me');
    if (data.authenticated) showAccount(data.user.phone);
  } catch (_) {}
})();
