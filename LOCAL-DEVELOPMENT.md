# Menjalankan microservice lokal

Jalankan `npm install` lalu `npm run dev` dari direktori masing-masing service. Konfigurasi lokal dibaca dari `.env` melalui `dotenv.config()`; `.env.development` tidak diperlukan. Gunakan `.env.example` sebagai template dan isi database serta secret yang diperlukan.

File `.env.development` lama dipindahkan ke `.env.production` sebagai referensi konfigurasi deployment. File tersebut tidak dimuat otomatis. Pada Vercel, gunakan environment variables project dengan `NODE_ENV=production`. Environment variables proses selalu memiliki prioritas terhadap `.env`.

| Service | Base URL frontend lokal |
| --- | --- |
| API Gateway | `http://localhost:5000` |
| Auth | `http://localhost:5001` |
| App Manager | `http://localhost:5002` |
| Marketing | `http://localhost:5003` |
| Finance | `http://localhost:5004` |
| Field Service | `http://localhost:5005` |

Gunakan path service tanpa prefix gateway: login di `http://localhost:5001/login`, profil di `http://localhost:5001/me`, dan perusahaan di `http://localhost:5003/companies`.

Pada `.env`, gunakan `NODE_ENV=development`. `LOCAL_DIRECT_ACCESS` bernilai `true` secara default. Akses tanpa `x-gateway-secret` hanya berlaku untuk koneksi loopback (`localhost`, `127.0.0.1`, `::1`) pada development di luar Vercel. JWT, status akun, role/section, serta batasan cabang tetap diperiksa. Production tetap memerlukan gateway secret.

Komunikasi keluar menggunakan deployment Vercel, terpisah dari pengaturan akses frontend lokal. Gateway lokal meneruskan request ke URL service Vercel dari `.env`. Microservice mengambil JWKS dan profil langsung dari `AUTH_SERVICE_URL`; Finance dan Field Service mengambil referensi langsung dari `MARKETING_SERVICE_URL`. Pemilihan URL ini berlaku pada development maupun production, termasuk ketika `LOCAL_DIRECT_ACCESS=false`. Tidak ada fallback otomatis ke localhost atau gateway.

| Tujuan | URL |
| --- | --- |
| Auth | `https://akura-auth-service.vercel.app` |
| App Manager | `https://akura-app-manager-service.vercel.app` |
| Marketing | `https://akura-marketing-service.vercel.app` |
| Finance | `https://akura-finance-service.vercel.app` |
| Field Service | `https://akura-fieldservice-service.vercel.app` |

`GATEWAY_SECRET` melindungi request masuk ke service. Untuk request keluar, App Manager, Marketing, Finance, dan Field Service memakai `AUTH_SERVICE_GATEWAY_SECRET` milik deployment Auth. Finance dan Field Service juga memerlukan `MARKETING_SERVICE_GATEWAY_SECRET` milik deployment Marketing. Nilai ini hanya disimpan di backend. Request referensi Marketing membawa identitas dari JWT yang sudah diverifikasi, bukan header identitas kiriman frontend.

Sebelum deploy kode ini, tambahkan variabel tujuan dan secret tersebut di environment project Vercel masing-masing. `.env.production` hanya referensi lokal dan tidak otomatis mengubah environment project Vercel. `API_GATEWAY_URL` masih diterima untuk kompatibilitas konfigurasi, tetapi jalur panggilan antarservice ini tidak menggunakannya.

Frontend dapat login melalui gateway Vercel, kemudian mengirim access token ke service lokal menggunakan `Authorization: Bearer <token>`. Cookie dari domain Vercel tidak otomatis dikirim ke localhost. Token harus diterbitkan oleh Auth yang sesuai dengan JWKS Vercel. Auth lokal tidak perlu dijalankan untuk alur ini. Jika login melalui gateway lokal, cookie localhost dapat digunakan dengan `credentials: 'include'`, tetapi atribut Secure/SameSite cookie dari deployment perlu diperhatikan.

```js
// accessToken diperoleh dari login melalui API Vercel.
const response = await fetch('http://localhost:5003/companies', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

Uji akses lokal dan pembatasan production dari direktori `server` dengan `node tests/local-access.cjs`. Pengujian menggunakan auth HTTP stub dan JWT bertanda tangan tanpa akses database.
