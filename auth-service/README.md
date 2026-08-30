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
  "type": "access",
  "iss": "akura-auth",
  "aud": "akura-api"
}
```

Header access token berisi `alg: RS256` dan `kid` untuk memilih signing key yang benar. Endpoint public key tersedia melalui `/.well-known/jwks.json`. Private key tidak pernah dikirim kepada Gateway atau microservice.

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
| `/api/v1/auth/.well-known/jwks.json` | GET | Publik | Mempublikasikan RSA public signing keys |
| `/api/v1/auth/login` | POST | Publik | Membuat token session |
| `/api/v1/auth/refresh-token` | POST | Publik | Merotasi refresh token dan mencatat aktivitas terakhir; sesi idle ditolak |
| `/api/v1/auth/logout` | POST | Publik | Merevoke refresh token dan menghapus cookie |
| `/api/v1/auth/me` | GET | Access token | Mengambil profil saat ini |
| `/api/v1/auth/profile` | PUT | Access token | Memperbarui nama depan dan nama belakang |
| `/api/v1/auth/password` | PUT | Access token | Mengganti password |
| `/api/v1/auth/users` | GET | APP_MANAGER | Daftar dan filter user |
| `/api/v1/auth/users/:userId` | GET | APP_MANAGER | Detail user |
| `/api/v1/auth/users/:userId/role` | PATCH | APP_MANAGER | Mengubah role user |
| `/api/v1/auth/users/:userId/section` | PATCH | APP_MANAGER | Mengubah section user |
| `/api/v1/auth/users/:userId/status` | PATCH | APP_MANAGER | Mengaktifkan atau menonaktifkan user |

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
| `isActive` | `true` atau `false` | - |
| `sortBy` | `username`, `firstName`, `lastName`, `role`, `section`, `isActive`, `updatedAt` | - |
| `sortOrder` | `asc` atau `desc` | `desc` |

Jika `sortBy` tidak dikirim, hasil diurutkan berdasarkan `createdAt desc`. Field `createdAt` sengaja tidak tersedia bagi user sebagai nilai `sortBy`. Field filter dan sort menggunakan allowlist di atas; nilai di luar allowlist menghasilkan response `400`. Contoh: `/api/v1/auth/users?role=USER&isActive=true&sortBy=username&sortOrder=asc&page=1&limit=20`.

Token dapat dikirim melalui HTTP-only cookie. Access token juga dapat dikirim melalui header:

```http
Authorization: Bearer <access-token>
```

Refresh token untuk endpoint refresh dan logout dapat dikirim melalui cookie `refreshToken` atau body:

```json
{
  "refreshToken": "<refresh-token>"
}
```

Token tidak dikembalikan di response JSON. Endpoint register, login, dan refresh mengirim token melalui header `Set-Cookie`.

## Migrasi profil user

Setelah menghentikan service yang sedang menggunakan Prisma Client, jalankan migrasi profil satu kali:

```powershell
npm run db:migrate-user-profile
```

Migrasi ini memecah kolom lama `name` menjadi `first_name` dan `last_name`, lalu menghapus kolom `email` dan `bio`.

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
| `GATEWAY_SECRET` | Tidak ada | Secret bersama dengan API Gateway |
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

Gunakan salah satu `JWT_ACCESS_PRIVATE_KEY_PATH` atau `JWT_ACCESS_PRIVATE_KEY_BASE64`. Private key hanya boleh tersedia pada Auth Service. Gateway dan microservice mengambil public key melalui JWKS.

## Instalasi dan database

```powershell
npm install
npm run db:generate
npm run db:push
npm run keys:generate
```

Jalankan `npm run db:generate` setelah instalasi atau perubahan schema. Perintah `npm run dev` tidak melakukan generate ulang agar query engine Prisma yang sedang digunakan tidak ditimpa pada Windows.

`npm run keys:generate` membuat RSA private key 3072-bit pada `keys/access-private.pem` dan menolak menimpa key yang sudah ada. Folder `keys` diabaikan Git. Pada production, mount private key dari KMS atau secret manager dan jangan menyimpannya di image aplikasi.

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
  config/         Environment dan schema validasi request
  controllers/    HTTP request handler
  middlewares/    Gateway, access token, validasi, dan error middleware
  repositories/   Query Prisma dan row locking
  routes/         Definisi endpoint
  services/       Business logic dan transaksi
  types/          Shared TypeScript types
  utils/          Token, cookie, error, mapper, dan helper async
```
