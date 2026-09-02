# Akura App Manager Service

Microservice administrasi menu dan menu item untuk Akura. Pengelolaan user dilayani langsung oleh Auth Service.

## Keamanan

Seluruh endpoint bisnis harus melewati API Gateway. Access token RS256 divalidasi melalui JWKS Auth Service, lalu status dan role user aktif diperiksa ke Auth Service.

Endpoint `menus/my-menus` dapat diakses semua user aktif. CRUD menu, menu access, dan menu item memerlukan role `APP_MANAGER`.

## Endpoint

Gateway meneruskan prefix `/api/v1/app-manager` ke service dan menghapus prefix tersebut.

| Endpoint gateway | Method | Fungsi |
|---|---|---|
| `/api/v1/app-manager/menus/my-menus` | GET | Menu milik user aktif |
| `/api/v1/app-manager/menus` | GET, POST | Daftar atau membuat menu |
| `/api/v1/app-manager/menus/:menuId` | GET, PATCH, DELETE | Detail, perubahan, atau penghapusan menu |
| `/api/v1/app-manager/menu-accesses` | GET, POST | Daftar atau membuat aturan akses menu |
| `/api/v1/app-manager/menu-accesses/:menuAccessId` | GET, PATCH, DELETE | Detail, perubahan, atau penghapusan aturan akses menu |
| `/api/v1/app-manager/menu-items` | GET, POST | Daftar atau membuat menu item |
| `/api/v1/app-manager/menu-items/:menuItemId` | GET, PATCH, DELETE | Detail, perubahan, atau penghapusan menu item |

Pengelolaan user tersedia di `/api/v1/auth/users`, bukan di App Manager Service.

## Filter, sort, dan pagination

Semua endpoint daftar menerima `page` (default `1`), `limit` (`1`–`100`), `sortBy`, dan `sortOrder` (`asc`/`desc`). Query filter dan field sort dibatasi dengan allowlist berikut; query yang tidak dikenal menghasilkan response `400`.

| Endpoint | Filter | Field pencarian `search` | Field `sortBy` | Default sort |
|---|---|---|---|---|
| `GET /menus` | `hasItem`, `isActive` | `key`, `label` | `key`, `label`, `hasItem`, `order`, `isActive`, `updatedAt` | `createdAt desc` |
| `GET /menu-accesses` | `menuItemId`, `role`, `section` | - | `menuItemId`, `role`, `section`, `updatedAt` | `createdAt desc` |
| `GET /menu-items` | `menuId`, `isActive` | `key`, `label` | `menuId`, `key`, `label`, `order`, `isActive`, `updatedAt` | `createdAt desc` |

Default `limit` adalah `20` untuk menu dan `50` untuk menu item. Jika `sortBy` tidak dikirim, hasil selalu memakai `createdAt desc`; `createdAt` tidak dapat dipilih secara eksplisit oleh user. Contoh: `/api/v1/app-manager/menu-items?isActive=true&sortBy=label&sortOrder=asc&page=1&limit=25`.

## Struktur data menu

Struktur API mengikuti model Prisma terbaru. Field `icon` dan `MenuItem.path` sudah tidak menjadi bagian dari request CRUD maupun response API.

### Menu

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | UUID | ID menu |
| `key` | string | Key unik menu |
| `label` | string | Nama menu yang ditampilkan |
| `hasItem` | boolean | Menentukan apakah menu mempunyai menu item |
| `order` | integer | Urutan menu, default `0` |
| `isActive` | boolean | Status menu, default `true` |
| `createdAt` | datetime | Waktu pembuatan |
| `updatedAt` | datetime | Waktu perubahan terakhir |

Jika `hasItem=true`, create menu wajib menerima minimal satu `items` dan membuat menu beserta item secara atomik. Jika `hasItem=false`, field `items` tidak diterima. Aturan akses dikelola terpisah melalui endpoint `menu-accesses`.

Payload untuk membuat menu:

```json
{
  "key": "app_manager",
  "label": "App Manager",
  "hasItem": true,
  "order": 1,
  "items": [
    {
      "key": "users_list",
      "label": "Daftar Pengguna",
      "order": 1
    }
  ]
}
```

### Menu access

Setiap aturan akses menghubungkan sebuah menu item dengan kombinasi `role` dan `section`. `role: null` berlaku untuk semua role dan `section: null` berlaku untuk semua section.

Payload untuk membuat menu access:

```json
{
  "menuItemId": "44c3fffd-1987-4935-bff4-07fd3cc72f1d",
  "role": "APP_MANAGER",
  "section": null
}
```

Kombinasi `menuItemId`, `role`, dan `section` harus unik. Nilai `role` dan `section` dapat diperbarui secara parsial melalui `PATCH /menu-accesses/:menuAccessId`.

### Menu item

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | UUID | ID menu item |
| `menuId` | UUID | ID menu induk |
| `key` | string | Key unik menu item |
| `label` | string | Nama menu item yang ditampilkan |
| `order` | integer | Urutan dalam menu, default `0` |
| `isActive` | boolean | Status menu item, default `true` |
| `createdAt` | datetime | Waktu pembuatan |
| `updatedAt` | datetime | Waktu perubahan terakhir |

Payload untuk membuat menu item:

```json
{
  "menuId": "44c3fffd-1987-4935-bff4-07fd3cc72f1d",
  "key": "users_list",
  "label": "Daftar Pengguna",
  "order": 1
}
```

### Response `my-menus`

Endpoint ini mengambil menu item aktif yang mempunyai `MenuAccess` sesuai dengan `role` serta `section` user, lalu menggabungkan item-item tersebut berdasarkan menu induknya. Menu item tanpa akses yang cocok tidak dikembalikan.

```json
{
  "status": 200,
  "success": true,
  "message": "Menus retrieved successfully",
  "data": [
    {
      "key": "app_manager",
      "label": "App Manager",
      "order": 1,
      "items": [
        {
          "key": "users_list",
          "label": "Daftar Pengguna",
          "order": 1
        }
      ]
    }
  ],
  "requestId": "9539c2ec-d85b-4fa1-94a1-ca7627f1fe6a"
}
```

## Database dan kepemilikan data user

Database App Manager hanya menyimpan data menu dan menu-item. Tabel `users`, `user_passwords`, dan `refresh_tokens` tidak berada di service ini.

Auth Service menjadi satu-satunya pemilik sekaligus penyedia endpoint pengelolaan user, optimistic versioning, invariant app-manager terakhir, dan revokasi refresh token saat deactivation.

## Migrasi akses menu

`role` dan `section` disimpan di tabel `menu_accesses` pada level menu item. Untuk mengubah data akses level-menu lama menjadi akses per item, hentikan App Manager Service lalu jalankan:

```powershell
npm run db:migrate-menu-item-accesses
```

Untuk menambahkan `menus.has_item`, menandai menu lama yang sudah mempunyai item, dan menghapus `menu_items.path`, jalankan:

```powershell
npm run db:migrate-menu-has-item
```

Migrasi menyalin setiap aturan akses menu lama ke seluruh menu item di bawah menu tersebut, lalu mengganti relasi menjadi `menuItemId`. Constraint unik juga dibuat untuk kombinasi `menuItemId`, `role`, dan `section`, termasuk kombinasi yang memiliki nilai `null`.

## Konfigurasi

Salin `.env.example` menjadi `.env`.

| Variable | Default | Keterangan |
|---|---|---|
| `PORT` | `5002` | Port App Manager Service |
| `NODE_ENV` | `development` | Environment runtime |
| `GATEWAY_SECRET` | Tidak ada | Harus sama dengan gateway |
| `DATABASE_URL` | Tidak ada | Database menu milik App Manager Service |
| `AUTH_JWKS_URL` | Tidak ada | Endpoint public key Auth Service |
| `AUTH_SERVICE_URL` | Tidak ada | Validasi profil user aktif melalui Auth Service |
| `JWT_ISSUER` | `akura-auth` | Issuer access token yang diterima |
| `JWT_AUDIENCE` | `akura-api` | Audience access token yang diterima |

## Instalasi

```powershell
npm install
npm run db:generate
```

Jalankan `npm run db:generate` setelah instalasi atau setelah mengubah `prisma/schema.prisma`. Perintah `npm run dev` tidak melakukan generate ulang agar Prisma query engine yang sedang dipakai proses development tidak ditimpa pada Windows.

Gunakan `npm run db:push` hanya untuk schema menu milik App Manager. Perubahan schema user dilakukan di Auth Service.

## Menjalankan service

```powershell
npm run dev
```

Build production:

```powershell
npm run build
npm start
```

Integration dan concurrency test dapat dijalankan ketika Gateway, Auth Service, dan App Manager aktif:

```powershell
npm run test:api
```

## Menambah modul

Buat folder baru di `src/modules/<nama-modul>` yang berisi schema, repository, service, controller, dan routes. Pasang routes modul tersebut di `src/routes/index.ts`. Infrastruktur autentikasi, otorisasi, validasi, logging, database, dan error handling dapat digunakan kembali oleh seluruh modul.

## Struktur

```text
src/
  config/             Environment dan database
  middlewares/        Gateway, JWT, admin authorization, validasi, dan error
  modules/
    menus/            Pengelolaan menu dan endpoint my-menus
    menu-items/       Pengelolaan item di dalam menu
  routes/             Registry modul
  utils/              Logger, HTTP error, dan async handler
```
