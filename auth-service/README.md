# Akura Auth Service

Layanan autentikasi Akura berbasis Express, TypeScript, Prisma, dan PostgreSQL. Service ini menangani akun, sesi JWT, profil, serta perubahan password dengan perlindungan terhadap request concurrent dan race condition.

## Fitur

- Registrasi dan login dengan username case-insensitive yang unik.
- Login menggunakan password bcrypt.
- Access token RS256 berdurasi 15 menit dengan public key JWKS.
- Refresh token berdurasi 7 hari dengan rotasi dan token-family reuse detection.
- HTTP-only cookie untuk access token dan refresh token.
- Profil pengguna dengan row locking dan optimistic versioning.
- Perubahan password atomik dan revokasi seluruh refresh token pengguna.
- Pembatasan akses langsung menggunakan internal gateway secret.

## Token

Access token ditandatangani menggunakan RSA private key yang hanya tersedia pada Auth Service. Public key dipublikasikan sebagai JWKS. Token memiliki claim berikut:

```json
{
  "sub": "user-uuid",
  "name": "John Doe",
  "username": "johndoe",
  "role": "USER",
  "officeBranchId": "44c3fffd-1987-4935-bff4-07fd3cc72f1d",
  "type": "access",
  "iss": "akura-auth",
  "aud": "akura-api"
}
```

`officeBranchId` selalu ada pada access token dan bernilai `null` jika user belum ditetapkan ke sebuah office branch.

Header access token berisi `alg: RS256` dan `kid` untuk memilih signing key yang benar. Endpoint public key tersedia melalui Gateway pada `/api/v1/auth/.well-known/jwks.json`; akses langsung ke `/.well-known/jwks.json` memerlukan secret khusus Gateway ke Auth. Private key tidak pernah dikirim kepada Gateway atau microservice.

Refresh token ditandatangani menggunakan `JWT_REFRESH_SECRET` dan memiliki claim berikut:

```json
{
  "id": "random-token-uuid",
  "sub": "user-uuid",
  "type": "refresh"
}
```

Endpoint protected hanya menerima token RS256 dengan signature valid, issuer dan audience yang sesuai, belum kedaluwarsa, memiliki `sub`, dan mempunyai `type: access`. Header identitas seperti `x-user-id` tidak dianggap sebagai kredensial.

## Endpoint

Gateway meneruskan prefix `/api/v1/auth` ke service ini dan menghapus prefix tersebut.

| Gateway endpoint | Method | Akses | Fungsi |
|---|---|---|---|
| `/api/v1/auth/register` | POST | Publik | Membuat akun tanpa membuat token session |
| `/api/v1/auth/.well-known/jwks.json` | GET | Publik melalui Gateway | Mempublikasikan RSA public signing keys |
| `/api/v1/auth/login` | POST | Publik | Membuat token session |
| `/api/v1/auth/refresh-token` | POST | Publik | Merotasi refresh token dan mencatat aktivitas terakhir; sesi idle ditolak |
| `/api/v1/auth/logout` | POST | Publik | Merevoke refresh token dan menghapus cookie |
| `/api/v1/auth/me` | GET | Access token | Mengambil profil saat ini |
| `/api/v1/auth/profile` | PUT | Access token | Memperbarui nama depan dan nama belakang |
| `/api/v1/auth/password` | PUT | Access token | Mengganti password |
| `/api/v1/auth/users` | GET | APP_MANAGER | Daftar dan filter user |
| `/api/v1/auth/users/:userId` | GET | APP_MANAGER | Detail user |
| `/api/v1/auth/users/:userId` | PATCH | APP_MANAGER | Mengubah role, section, pasangan office branch (`officeBranchId` + `branch`), email, telp, dan/atau status user |
| `/api/v1/auth/users/marketing-contacts` | GET | Access token | Daftar kontak ADMIN MARKETING aktif pada branch pemanggil (read-only legacy; Marketing kini membaca local read model yang disinkronkan lewat `POST /api/v1/marketing/internal/users/events`) |

- `POST /api/v1/marketing/internal/users/events` dan `POST /api/v1/fieldservice/internal/users/events` adalah endpoint internal yang menerima snapshot user dari Auth Service. Endpoint ini bukan endpoint frontend dan wajib melewati API Gateway dengan credential service serta `USER_SYNC_SECRET`. Marketing menerima semua event (event yang tidak eligible menghapus row lokal); Field Service hanya menerima event untuk user yang sebelum atau sesudah perubahan memenuhi syarat section `FIELD_SERVICE`, aktif dan memiliki branch, sehingga perpindahan section ikut menghapusnya dari read model Field Service.
- Enqueue outbox selalu membangunkan worker delivery setelah transaksi commit, sehingga event langsung dikirim tanpa menunggu restart Auth Service.

Endpoint `/users` dilayani langsung oleh Auth Service. Request wajib melewati API Gateway dan membawa access token milik `APP_MANAGER`. Seluruh pembacaan serta perubahan user dilakukan pada database Auth Service.

### Filter, sort, dan pagination user

`GET /api/v1/auth/users` menerima query berikut:

| Query | Nilai yang didukung | Default |
|---|---|---|
| `page` | Integer mulai dari `1` | `1` |
| `limit` | Integer `1`–`100` | `20` |
| `search` | Teks maksimal 100 karakter; mencari pada `username`, `firstName`, dan `lastName` | - |
| `role` | `USER`, `ADMIN`, atau `APP_MANAGER` | - |
| `section` | Enum `UserSection` | - |
| `officeBranchId` | UUID office branch | - |
| `isActive` | `true` atau `false` | - |
| `sortBy` | `username`, `firstName`, `lastName`, `role`, `section`, `officeBranchId`, `isActive`, `updatedAt` | - |
| `sortOrder` | `asc` atau `desc` | `desc` |

Jika `sortBy` tidak dikirim, hasil diurutkan berdasarkan `createdAt desc`. Field `createdAt` sengaja tidak tersedia bagi user sebagai nilai `sortBy`. Field filter dan sort menggunakan allowlist di atas; nilai di luar allowlist menghasilkan response `400`. Contoh: `/api/v1/auth/users?role=USER&isActive=true&sortBy=username&sortOrder=asc&page=1&limit=20`.

Update user menggunakan satu request `PATCH` atomik. `version` wajib dikirim dan minimal satu field perubahan harus disertakan:

```json
{
  "role": "USER",
  "section": "MARKETING",
  "officeBranchId": "44c3fffd-1987-4935-bff4-07fd3cc72f1d",
  "branch": "Kantor Pusat",
  "isActive": true,
  "version": 1
}
```

`section` dan pasangan `officeBranchId`/`branch` dapat diisi `null`. Auth Service menyimpan UUID office branch tanpa foreign key karena data office branch dimiliki database App Manager Service, dan menyimpan nama tampilan cabang pada kolom `office_branch_name` agar response selalu dapat menampilkan `branch`. `officeBranchId` dan `branch` wajib dikirim bersama (nullable pair): keduanya `null` untuk melepas penugasan, atau keduanya berisi nilai; pasangan yang tidak lengkap menghasilkan response `400`. Nilai `branch` dikirim oleh caller sebagai pasangan `officeBranchId`, sehingga id dan nama cabang yang tersimpan selalu konsisten.

### Profil dan daftar user

Seluruh response user (`GET /me`, `GET /users`, `GET /users/:userId`, `PATCH /users/:userId`, login) mempertahankan `officeBranchId` dan menambahkan field `branch` berisi nama office branch yang tersimpan (`null` bila user belum memiliki cabang).

### History user

Setiap perubahan data user dicatat atomik pada tabel `user_histories` (append-only, satu transaksi dengan mutasinya):

- `CREATE` saat registrasi, `beforeSnapshot` bernilai `null`.
- `UPDATE` pada perubahan profil sendiri dan seluruh update administratif `APP_MANAGER` (role, section, office branch, email, telp, status).
- `PASSWORD_CHANGE` pada perubahan password; nilai password tidak pernah disimpan (hanya action-nya).
- Setiap baris menyimpan `beforeSnapshot` (data lama), `snapshot` (data baru), `changes` (array per field: `field`, `before`, `after`), `version`, serta actor (`createdById`, `createdByName`).
- Perubahan cabang selalu terekam pada field `officeBranchId` dan `branch` sehingga riwayat menyimpan nama cabang lama dan baru, bukan hanya ID.

History tidak tersedia lewat endpoint API; bacanya langsung dari tabel `user_histories` atau tool observability internal.

Token dapat dikirim melalui HTTP-only cookie. Access token juga dapat dikirim melalui header:

```http
Authorization: Bearer <access-token>
```

Refresh token untuk endpoint refresh dan logout hanya dibaca dari cookie `refreshToken` atau header `x-refresh-token`. Request body tidak digunakan sebagai sumber token.

Refresh token tidak pernah dikembalikan di response JSON; token tersebut hanya dikirim melalui header `Set-Cookie`. Access token juga dikirim melalui `Set-Cookie` dan, untuk endpoint login dan refresh, kembali tersedia pada field `data.accessToken` di response body; `GET /me` mengecho token yang sudah diverifikasi pada field `accessToken` top-level. Hal ini memungkinkan MFE development mengirim `Authorization: Bearer` ke microservice yang diakses langsung tanpa cookie lintas domain.

## Validasi request

### Register

```json
{
  "username": "johndoe",
  "password": "securePassword123",
  "passwordConfirmation": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

Username minimal tiga karakter dan hanya boleh berisi huruf, angka, atau underscore. Password minimal enam karakter dan harus sama dengan `passwordConfirmation`. Nama depan dan nama belakang wajib diisi.

### Update profil

```json
{
  "firstName": "John",
  "lastName": "Doe"
}
```

### Ganti password

```json
{
  "oldPassword": "securePassword123",
  "newPassword": "newSecurePassword456",
  "newPasswordConfirmation": "newSecurePassword456"
}
```

`newPassword` harus sama dengan `newPasswordConfirmation`. Ketidaksesuaian konfirmasi password menghasilkan response `400` dengan pesan validasi yang spesifik.

## Concurrency dan race condition

- Unique constraint database memastikan hanya satu registrasi yang menang untuk username yang sama.
- `SELECT ... FOR UPDATE` menserialisasi rotasi refresh token, update profil, dan perubahan password.
- Kolom `version` mencegah lost update pada profil dan password.
- Setiap refresh token memiliki random ID sehingga login pada detik yang sama tidak menghasilkan JWT identik.
- Reuse token merevoke seluruh token family dan revokasi di-commit sebelum error `401` dikirim.
- Error database yang tidak terduga tetap me-rollback transaksi untuk menjaga integritas data.

## Konfigurasi

Salin `.env.example` menjadi `.env`, kemudian isi seluruh secret dengan nilai yang kuat.

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `5001` | Port auth service |
| `NODE_ENV` | `development` | Environment runtime |
| `GATEWAY_SECRET` | Tidak ada | Secret khusus koneksi API Gateway ke Auth Service; jangan digunakan service lain |
| `DATABASE_URL` | Tidak ada | PostgreSQL connection string Prisma |
| `JWT_ACCESS_PRIVATE_KEY_PATH` | Tidak ada | Path RSA private key PKCS#8 |
| `JWT_ACCESS_PRIVATE_KEY_BASE64` | Tidak ada | Alternatif private key base64 untuk secret manager |
| `JWT_ACCESS_KEY_ID` | `akura-access-key-1` | Identifier signing key pada JWT dan JWKS |
| `JWT_ISSUER` | `akura-auth` | Issuer access token |
| `JWT_AUDIENCE` | `akura-api` | Audience access token |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Masa berlaku access token |
| `JWT_REFRESH_SECRET` | Tidak ada | Secret refresh token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Masa berlaku refresh token |
| `JWT_REFRESH_IDLE_TIMEOUT_MINUTES` | `60` | Batas idle refresh-token session dalam menit |

Gunakan salah satu `JWT_ACCESS_PRIVATE_KEY_PATH` atau `JWT_ACCESS_PRIVATE_KEY_BASE64`. Private key hanya boleh tersedia pada Auth Service. Gateway mengambil JWKS menggunakan secret khusus Auth, sedangkan microservice lain mengambil JWKS melalui Gateway.

## Instalasi dan database

```powershell
npm install
npm run db:generate
npm run db:push
```

Jalankan `npm run db:generate` setelah instalasi atau perubahan schema. Perintah `npm run dev` tidak melakukan generate ulang agar query engine Prisma yang sedang digunakan tidak ditimpa pada Windows.

Sediakan RSA private key PKCS#8 melalui `JWT_ACCESS_PRIVATE_KEY_PATH` atau `JWT_ACCESS_PRIVATE_KEY_BASE64`. Pada production, gunakan KMS atau secret manager.

Database PostgreSQL yang dirujuk oleh `DATABASE_URL` harus sudah tersedia sebelum menjalankan `db:push` atau service.

## Menjalankan service

```powershell
npm run dev
```

Build production:

```powershell
npm run build
npm start
```

Perintah pemeriksaan TypeScript:

```powershell
npm run typecheck
```

## Pengujian API dan concurrency

Jalankan API Gateway dan Auth Service terlebih dahulu, lalu:

```powershell
npm run test:api
```

Harness tersebut menguji validasi, autentikasi, spoofed identity header, refresh-token reuse, idle timeout dan pencatatan aktivitas refresh token, registrasi concurrent, login concurrent, update profil, perubahan password, rate limiting, serta load test lokal. Akun yang dibuat oleh harness dibersihkan setelah pengujian.

## Struktur source

```text
src/
  config/         Environment, database, key, dan konfigurasi list
  middlewares/    Gateway, validasi, request ID, dan error middleware bersama
  modules/
    auth/          Routes, auth middleware, controller, service, schema, dan repository autentikasi
    user-management/ Routes, authorization middleware, controller, service, schema, dan repository user
  types/          Shared TypeScript types
  utils/          Token, cookie, error, mapper, dan helper async
```
