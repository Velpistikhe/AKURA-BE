# Akura API Gateway

API Gateway Akura berbasis Express dan TypeScript. Gateway menyediakan reverse proxy, validasi access token untuk downstream service protected, request tracing, rate limiting, serta dokumentasi OpenAPI.

## Fitur

- Reverse proxy menuju Auth, App Manager, Products, dan Orders service.
- Validasi JWT access token RS256 menggunakan public key JWKS untuk route service protected.
- Dukungan access token melalui Bearer header atau HTTP-only cookie.
- Penghapusan header identitas dari request klien sebelum proxy.
- Injeksi internal gateway secret dan metadata pengguna yang sudah diverifikasi.
- Global rate limiter, CORS, Helmet, dan request ID.
- Structured logging dan graceful shutdown.
- Swagger UI yang disusun dari spesifikasi OpenAPI statis.

## Endpoint gateway

| Endpoint         | Method | Fungsi                    |
| ---------------- | ------ | ------------------------- |
| `/health`        | GET    | Status dan uptime gateway |
| `/services`      | GET    | Daftar downstream service |
| `/api-docs`      | GET    | Swagger UI                |
| `/api-docs.json` | GET    | Spesifikasi OpenAPI JSON  |

## Route proxy

| Prefix                | Target default          | Access token di gateway                            | Fungsi                                    |
| --------------------- | ----------------------- | -------------------------------------------------- | ----------------------------------------- |
| `/api/v1/auth`        | `http://localhost:5001` | Diverifikasi auth-service untuk endpoint protected | Autentikasi dan profil                    |
| `/api/v1/app-manager` | `http://localhost:5002` | Wajib                                              | Administrasi aplikasi dan user management |
| `/api/v1/products`    | `http://localhost:5003` | Tidak wajib                                        | Product catalog                           |
| `/api/v1/orders`      | `http://localhost:5004` | Wajib                                              | Order dan checkout                        |

Route `/api/v1/auth` berisi campuran endpoint publik dan protected. Karena itu gateway meneruskannya tanpa middleware global, lalu auth-service memverifikasi access token pada `/me`, `/profile`, dan `/password`.

## Autentikasi

Access token yang diterima harus:

- Memiliki signature RS256 yang valid menggunakan public key Auth Service.
- Belum kedaluwarsa.
- Memiliki claim `sub`.
- Memiliki claim `type` dengan nilai `access`.
- Memiliki issuer dan audience yang sesuai konfigurasi.

Token dapat dikirim melalui:

```http
Authorization: Bearer <access-token>
```

atau cookie `accessToken`.

Gateway menghapus `X-User-ID`, `X-User-Role`, `X-User-Email` (legacy), dan `X-User-Username` yang berasal dari klien. Untuk route protected, nilai yang masih digunakan dibuat ulang dari access token yang telah diverifikasi.

Gateway mengambil public key dari `AUTH_JWKS_URL` dan menyimpannya dalam cache. Gateway tidak memiliki private signing key dan tidak melakukan transaksi validasi ke Auth Service pada setiap request. Ketika token membawa `kid` baru, verifier memperbarui JWKS dari Auth Service.

## Dokumentasi OpenAPI

Swagger UI tersedia di:

```text
http://localhost:5000/api-docs
```

Dokumen mentah tersedia di `http://localhost:5000/api-docs.json`.

Dokumentasi mencakup endpoint gateway, Auth Service, App Manager Service, dan Marketing Service; request schema; response aktual; autentikasi Bearer/cookie; status error; rotasi refresh token; serta perilaku HTTP-only cookie.

Endpoint daftar mendokumentasikan filter yang diizinkan, field pencarian, pagination `page`/`limit`, serta allowlist `sortBy` dan arah `sortOrder`. Tanpa `sortBy`, seluruh endpoint memakai urutan internal `createdAt desc`; field `createdAt` tidak tersedia dalam allowlist user. Nilai `sortBy` di luar enum Swagger dan query yang tidak dikenal ditolak oleh service dengan response `400`.

Kontrak App Manager mengikuti schema menu terbaru. `Menu` berisi `key`, `label`, `order`, dan daftar `items`. Setiap item berisi `key`, `label`, `path`, dan `order`. Field `icon` tidak lagi diterima atau dikembalikan oleh endpoint menu dan menu item.

## Konfigurasi

Salin `.env.example` menjadi `.env` dan ganti seluruh nilai secret.

| Variable                  | Default                                       | Keterangan                                         |
| ------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `PORT`                    | `5000`                                        | Port gateway                                       |
| `NODE_ENV`                | `development`                                 | Environment runtime                                |
| `GATEWAY_SECRET`          | Tidak ada                                     | Secret internal yang dibagikan dengan microservice |
| `CORS_ORIGIN`             | `*`                                           | Origin yang diizinkan                              |
| `AUTH_SERVICE_URL`        | `http://localhost:5001`                       | Target Auth Service                                |
| `AUTH_JWKS_URL`           | `http://localhost:5001/.well-known/jwks.json` | Endpoint public key Auth Service                   |
| `JWT_ISSUER`              | `akura-auth`                                  | Issuer access token yang diterima                  |
| `JWT_AUDIENCE`            | `akura-api`                                   | Audience access token yang diterima                |
| `APP_MANAGER_SERVICE_URL` | `http://localhost:5002`                       | Target App Manager Service                         |
| `PRODUCT_SERVICE_URL`     | `http://localhost:5003`                       | Target Products Service                            |
| `ORDER_SERVICE_URL`       | `http://localhost:5004`                       | Target Orders Service                              |
| `RATE_LIMIT_WINDOW_MS`    | `900000`                                      | Durasi window rate limiter                         |
| `RATE_LIMIT_MAX_REQUESTS` | `100`                                         | Maksimum request per IP per window                 |

Gateway tidak membutuhkan access-token secret atau private key. Nilai `JWT_ISSUER` dan `JWT_AUDIENCE` harus sama dengan Auth Service. `GATEWAY_SECRET` harus identik pada gateway dan seluruh downstream service.

## Instalasi dan penggunaan

```powershell
npm install
npm run dev
```

Build production:

```powershell
npm run build
npm start
```

Pemeriksaan TypeScript:

```powershell
npm run typecheck
```

## Menambah service

Tambahkan konfigurasi ke `src/config/services.config.ts` dengan prefix unik, target URL, aturan rewrite, deskripsi, dan nilai `authRequired`.

```ts
{
  prefix: '/api/v1/payments',
  target: 'http://localhost:5005',
  authRequired: true,
  pathRewrite: { '^/api/v1/payments': '' },
  description: 'Payment Service'
}
```

Service protected menerima metadata pengguna hanya setelah gateway memverifikasi access token.

## Struktur source

```text
src/
  config/         Environment, service registry, dan Swagger config
  docs/           Spesifikasi OpenAPI statis
  middlewares/    Access token, logging, rate limit, request ID, dan error
  routes/         Dynamic reverse proxy
  types/          Shared TypeScript types
  utils/          Token extraction, verification, logging, dan error helpers
```
