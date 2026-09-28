# Local development through the API Gateway

Semua request frontend harus menggunakan `http://localhost:5000/api/v1`. Login, refresh token, dan akses modul menggunakan gateway yang sama dengan `credentials: include` / `withCredentials: true`.

Jalankan gateway (5000), Auth (5001), App Manager (5002), Marketing (5003), Finance (5004), dan Field Service (5005). `.env` dan `.env.example` lokal menggunakan topologi ini. Database dan secret yang sudah ada dipertahankan; secret gateway lokal disesuaikan dengan masing-masing service lokal.

Service selalu memeriksa `x-gateway-secret`, termasuk localhost, development, production, health dan preflight. Tidak ada bypass berdasarkan alamat loopback. Jangan berikan secret internal kepada frontend. JWT, akun aktif, section/role, dan cabang tetap diperiksa.

## Hybrid: auth di Vercel, Marketing lokal diakses langsung

Untuk development lokal yang memakai Auth pada Vercel:

- Shell (login, session, menu) memakai gateway Vercel `https://akura-api-gateway.vercel.app` (`VITE_API_BASE_URL` pada `akura-shell/.env.development`). Login mengembalikan `accessToken` pada body response (refresh token tetap cookie httpOnly) dan menyimpannya di memory, lalu meneruskannya ke MFE Marketing lewat prop.
- MFE Marketing memanggil Marketing Service lokal secara langsung (`VITE_API_BASE_URL=http://localhost:5003`) dengan `Authorization: Bearer <accessToken>`; endpoint auth MFE (`/auth/*`) tetap ke gateway Vercel dengan cookie. Route selain Marketing (mis. work order Field Service) tetap lewat gateway.
- Marketing Service lokal mengaktifkan `DIRECT_MFE_ACCESS=true` (hanya sah pada `NODE_ENV=development`, ditolak pada environment lain). Header `x-gateway-secret` yang hilang diterima hanya pada mode ini; secret yang salah tetap ditolak. Identitas (`x-user-id`, `x-user-role`, `x-office-branch-id`) disuntik dari JWT yang sudah diverifikasi.
- JWT diverifikasi lokal via JWKS dari `API_GATEWAY_URL=https://akura-api-gateway.vercel.app` (di-cache); cek profil/section/branch juga melalui gateway Vercel. Tidak ada autentikasi per request ke Vercel selain JWKS yang di-cache dan `auth/me` yang memang wajib.
- CORS Marketing Service memakai `origin: true` dan mengizinkan preflight lokal, tetapi tanpa secret internal; permintaan tetap wajib membawa JWT valid.

Topologi penuh lokal (semua service lokal di belakang gateway `localhost:5000`) tetap berlaku bila `DIRECT_MFE_ACCESS` di-set `false`.

Panggilan profil, JWKS, dan referensi antarservice menggunakan `API_GATEWAY_URL` dengan `x-service-name` dan `x-service-secret` milik service pemanggil (nilai `GATEWAY_SECRET`). Gateway memverifikasi pemanggil, memvalidasi JWT bila diperlukan, lalu menambahkan secret serta identitas pengguna untuk tujuan. Gateway sendiri mengambil JWKS dari Auth dengan secret Auth untuk menghindari siklus autentikasi.

Event pajak dikirim Finance ke `/api/v1/marketing/internal/taxes/events` pada gateway. Endpoint hanya menerima POST dengan kredensial Finance dan `x-tax-sync-secret`; tidak memerlukan sesi pengguna. Marketing tetap memverifikasi gateway secret dan tax sync secret.

Untuk deployment, gunakan URL gateway HTTPS pada `API_GATEWAY_URL` dan `TAX_DELIVERY_TARGETS`. Hanya gateway menyimpan URL service tujuan serta secret masing-masing tujuan. Atur variabel Vercel sesuai konfigurasi baru dan deploy ulang semua service; perubahan file lokal tidak mengubah environment Vercel otomatis.

Untuk kombinasi lokal/deployment, ubah URL tujuan hanya pada gateway. `AUTH_JWKS_URL` harus menunjuk Auth yang sama dengan `AUTH_SERVICE_URL`. Service deployment tidak dapat menghubungi localhost komputer developer; konfigurasi komunikasi balik harus menggunakan gateway yang dapat dijangkau service tersebut. Browser tetap mengakses satu gateway, bukan service langsung.

Uji aturan gateway dan komunikasi antarservice tanpa database: `node tests/local-access.cjs`.
