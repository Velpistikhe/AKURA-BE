# Local development through the API Gateway

Semua request frontend harus menggunakan `http://localhost:5000/api/v1`. Login, refresh token, dan akses modul menggunakan gateway yang sama dengan `credentials: include` / `withCredentials: true`.

Jalankan gateway (5000), Auth (5001), App Manager (5002), Marketing (5003), Finance (5004), dan Field Service (5005). `.env` dan `.env.example` lokal menggunakan topologi ini. Database dan secret yang sudah ada dipertahankan; secret gateway lokal disesuaikan dengan masing-masing service lokal.

Service selalu memeriksa `x-gateway-secret`, termasuk localhost, development, production, health dan preflight. Tidak ada bypass berdasarkan alamat loopback. Jangan berikan secret internal kepada frontend. JWT, akun aktif, section/role, dan cabang tetap diperiksa.

## Hybrid development: Auth di Vercel, MFE dan service lokal

Untuk mengembangkan Marketing, Field Service, atau Finance secara lokal dengan Auth pada gateway Vercel:

- Shell lokal menggunakan `VITE_API_BASE_URL` ke gateway deployment Development. Shell menyimpan access token hanya di memory dan meneruskannya ke MFE.
- MFE lokal mengirim request data langsung ke service lokal: Marketing `http://localhost:5003`, Finance `http://localhost:5004`, dan Field Service `http://localhost:5005`, memakai `Authorization: Bearer <accessToken>`.
- Route Auth (`/auth/*`) tetap menuju gateway Vercel agar refresh token cookie httpOnly berasal dari host yang sama. Finance juga tetap meneruskan referensi Marketing (`/marketing/*`) melalui gateway.
- Set `DIRECT_MFE_ACCESS=true` hanya pada `.env` lokal tiap service dan `DIRECT_MFE_ORIGIN=http://localhost:4173` (origin browser Shell, bukan port remote MFE). Akses langsung hanya berlaku di `NODE_ENV=development` dan tidak pernah di Vercel. Secret gateway yang salah tetap ditolak.
- Bypass secret hanya untuk route data Marketing, Finance (`/finance/*`, `/taxes/*`, `/invoices/*`, `/proforma-invoices/*`) dan Field Service (`/fieldservice/*`, `/work-orders/*`). Health dan endpoint internal tetap gateway-only. JWT, profil aktif, role/section, dan branch tetap diverifikasi.
- Jalankan Marketing (5003), Finance (5004), Field Service (5005), MFE remote (4175/4176/4177), Shell (4173), dan Auth/API Gateway Vercel Development. Restart Vite setelah mengubah `.env.development`.

Mode topologi penuh lokal tetap tersedia: arahkan MFE ke gateway `http://localhost:5000/api/v1` dan set `DIRECT_MFE_ACCESS=false` pada semua service.

## Aturan akses dan komunikasi service

Panggilan profil, JWKS, dan referensi antarservice menggunakan `API_GATEWAY_URL` dengan `x-service-name` dan `x-service-secret` milik service pemanggil. Browser tidak menerima atau mengirim secret internal. Gateway memverifikasi pemanggil, memvalidasi JWT bila diperlukan, lalu menambahkan secret serta identitas pengguna untuk service tujuan.

Event pajak Finance tetap dikirim ke Marketing melalui gateway `/api/v1/marketing/internal/taxes/events`; event internal tidak memakai bypass akses langsung.

Untuk deployment, set URL gateway HTTPS dan environment terpisah pada Vercel Development/Production. Jangan set `DIRECT_MFE_ACCESS=true` pada deployment Vercel. Perubahan file lokal tidak mengubah environment Vercel.

Jalankan test aturan gateway dan akses lokal tanpa database: `node tests/local-access.cjs`.
