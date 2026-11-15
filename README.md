# NokosID

Dashboard demo untuk simulasi pemesanan nomor virtual dan kode OTP.

## Menjalankan lokal
1. Install Node.js 18 atau lebih baru.
2. Jalankan `npm install`.
3. Jalankan `npm start`.
4. Buka `http://localhost:3000`.

## Deploy ke Render
Hubungkan repository ini ke Render sebagai **Web Service**. Konfigurasi tersedia di `render.yaml`.

## Catatan penting
Versi ini hanya demo. Saldo, nomor, top-up, dan OTP dibuat secara simulasi di server. Tidak ada SMS sungguhan atau pembayaran nyata. Data pesanan disimpan di memori dan akan hilang saat server restart. Integrasikan penyedia SMS dan payment gateway resmi serta penyimpanan database sebelum penggunaan produksi.