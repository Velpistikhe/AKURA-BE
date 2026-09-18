# Local development through the API Gateway

Semua request frontend harus menggunakan `http://localhost:5000/api/v1`. Login, refresh token, dan akses modul menggunakan gateway yang sama dengan `credentials: include` / `withCredentials: true`.

Jalankan gateway (5000), Auth (5001), App Manager (5002), Marketing (5003), Finance (5004), dan Field Service (5005). `.env` dan `.env.example` lokal menggunakan topologi ini. Database dan secret yang sudah ada dipertahankan; secret gateway lokal disesuaikan dengan masing-masing service lokal.

Service selalu memeriksa `x-gateway-secret`, termasuk localhost, development, production, health dan preflight. Tidak ada bypass berdasarkan alamat loopback. Jangan berikan secret internal kepada frontend. JWT, akun aktif, section/role, dan cabang tetap diperiksa.

Panggilan profil, JWKS, dan referensi antarservice menggunakan `API_GATEWAY_URL` dengan `x-service-name` dan `x-service-secret` milik service pemanggil (nilai `GATEWAY_SECRET`). Gateway memverifikasi pemanggil, memvalidasi JWT bila diperlukan, lalu menambahkan secret serta identitas pengguna untuk tujuan. Gateway sendiri mengambil JWKS dari Auth dengan secret Auth untuk menghindari siklus autentikasi.

Event pajak dikirim Finance ke `/api/v1/marketing/internal/taxes/events` pada gateway. Endpoint hanya menerima POST dengan kredensial Finance dan `x-tax-sync-secret`; tidak memerlukan sesi pengguna. Marketing tetap memverifikasi gateway secret dan tax sync secret.

Untuk deployment, gunakan URL gateway HTTPS pada `API_GATEWAY_URL` dan `TAX_DELIVERY_TARGETS`. Hanya gateway menyimpan URL service tujuan serta secret masing-masing tujuan. Atur variabel Vercel sesuai konfigurasi baru dan deploy ulang semua service; perubahan file lokal tidak mengubah environment Vercel otomatis.

Untuk kombinasi lokal/deployment, ubah URL tujuan hanya pada gateway. `AUTH_JWKS_URL` harus menunjuk Auth yang sama dengan `AUTH_SERVICE_URL`. Service deployment tidak dapat menghubungi localhost komputer developer; konfigurasi komunikasi balik harus menggunakan gateway yang dapat dijangkau service tersebut. Browser tetap mengakses satu gateway, bukan service langsung.

Uji aturan gateway dan komunikasi antarservice tanpa database: `node tests/local-access.cjs`.
