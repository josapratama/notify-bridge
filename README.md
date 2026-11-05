# 📣 NotifyBridge

> **Universal Multi-Channel Notification Gateway & Hub**  
> Satu pintu API untuk seluruh kebutuhan pengiriman pesan dan notifikasi di seluruh ekosistem: **WhatsApp**, **Email SMTP**, **Telegram Bot**, **Discord Webhook**, dan **Web Push Notifications**.

---

## 🎯 Mengapa NotifyBridge?

1. **Satu Endpoint API untuk Semua Saluran**:
   Aplikasi klien (`guidepath`, `minihost`, `payment-gateway`, dll.) tidak perlu lagi mengonfigurasi library SMTP, token WA, atau Telegram sendiri-sendiri. Cukup panggil `POST /api/v1/send`.
2. **Smart Cascade Fallback**:
   Jika pengiriman WhatsApp gagal (misal: nomor tujuan tidak aktif), sistem otomatis melakukan failover kirim via Email atau Telegram.
3. **Template Engine Dinamis**:
   Mendukung format variabel seperti `{{name}}`, `{{otp}}`, `{{amount}}`, `{{invoiceNumber}}`.
4. **Terintegrasi AuthHub SSO & YubiKey PIN**:
   Dashboard visual diamankan secara bawaan dengan standar WebAuthn / FIDO2 YubiKey Hardware Token.
5. **Ultra Ringan & Hemat Sumber Daya**:
   Backend Node.js Express + TypeScript dengan konsumsi RAM $< 35\text{ MB}$, optimal untuk VPS dan Raspberry Pi 5.

---

## 🚀 Cara Menjalankan

### Mode Pengembangan (Development):
```bash
# Backend (Port 4200)
cd backend
npm run dev

# Frontend Angular (Port 4201)
cd frontend
npm start
```

### Mode Produksi (Self-Contained):
```bash
npm run build
npm start
```
Buka browser di: **`http://localhost:4200`** (backend langsung melayani REST API dan dashboard Angular terkompilasi).

---

## 📡 REST API Reference

### 1. Kirim Notifikasi Universal
```http
POST /api/v1/send
Content-Type: application/json
X-API-Key: YOUR_API_KEY
```

```json
{
  "channel": "whatsapp",
  "recipient": "08123456789",
  "message": "Kode verifikasi Anda adalah 123456"
}
```

Atau menggunakan template & multi-channel:
```json
{
  "channels": ["whatsapp", "email"],
  "recipients": ["08123456789", "user@example.com"],
  "template": "payment_success",
  "data": {
    "name": "Budi",
    "invoiceNumber": "INV-2026-001",
    "amount": "Rp 250.000"
  },
  "fallbackChannels": ["telegram"]
}
```

---

## 🛠️ Tech Stack
* **Frontend**: Angular 18 (Standalone Components, Signals, Reactive Forms, Tailwind CSS).
* **Backend**: Node.js, Express, TypeScript, Nodemailer, Web-Push.
* **Security**: AuthHub SSO, FIDO2/YubiKey PIN, Asymmetric JWT, API Key Scopes.
