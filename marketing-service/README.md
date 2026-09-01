# Marketing Service

Microservice untuk pengelolaan perusahaan serta katalog service, scope, dan item Akura.

## Endpoint

- `GET /health`
- CRUD `/companies`
- CRUD `/company-staffs`
- CRUD `/services`
- Maintenance scope dikelola langsung sebagai bagian dari service melalui `maintenanceScopes` atau endpoint scope di bawah `/services/:serviceId/maintenance/scopes`.

`Company` menyimpan `name`, `normalizeName`, `type`, `address`, `hasContract`, `revoked`, dan `version`. Company staff menyimpan `name`, `normalizeName`, enum `title` (`mr` atau `mrs`), `telp`, `email`, `revoked`, serta `version`. Service tidak lagi dimiliki oleh company.

Nama dinormalisasi menjadi huruf kecil tanpa spasi sebelum insert atau pemeriksaan duplikasi. Hanya satu company dan satu company staff aktif (`revoked = false`) yang boleh memiliki nilai `normalizeName` yang sama.

`PATCH /companies/:companyId` bersifat insert-only: company dan staff aktif lama ditandai revoked, kemudian dibuat company baru dengan `version + 1`. Seluruh staff aktif disalin ke company baru dengan ID baru dan `version = 0`. `DELETE /company-staffs/:companyStaffId` tidak menghapus row; endpoint mengubah `revoked` menjadi `true` dan menaikkan `version`.

## Model katalog

Model `MarketingService` dan tabel `marketing_services` sudah dihapus. Struktur katalog baru:

| Model / tabel | Fungsi dan relasi |
|---|---|
| `Service` / `services` | Katalog service; memiliki banyak `ServiceScope` dan `MaintenanceScope` |
| `ServiceScope` / `service_scopes` | Field `scope` milik tepat satu service; unik berdasarkan service dan scope |
| `MaintenanceScope` / `maintenance_scopes` | Field `scope` maintenance milik tepat satu service; unik berdasarkan service dan scope |
| `Item` / `items` | Katalog item; memiliki banyak size dan satu service |
| `ItemSize` / `item_sizes` | Daftar size milik item; unik berdasarkan item dan size |

Relasi induk-anak dan tabel penghubung menggunakan `onDelete: Cascade`, sehingga scope, size, dan relasi item ikut terhapus ketika induknya dihapus.

Field `description` tidak digunakan pada service, service scope, maintenance scope, maupun item. Service dengan `hasMaintenance=true` wajib mempunyai minimal satu maintenance scope saat dibuat atau ketika maintenance diaktifkan melalui update.

Semua endpoint CRUD hanya menerima request dari API Gateway dan memerlukan user aktif dengan role `ADMIN`/`APP_MANAGER` atau section `MARKETING`.

## Filter, sort, dan pagination

Endpoint daftar menerima `page` (default `1`), `limit` (default `20`, maksimum `100`), `sortBy`, dan `sortOrder` (`asc`/`desc`). Seluruh query filter dan sort menggunakan allowlist; query yang tidak dikenal menghasilkan response `400`.

| Endpoint | Filter | Field pencarian `search` | Field `sortBy` | Default sort |
|---|---|---|---|---|
| `GET /companies` | `hasContract` | `name`, `type`, `address` | `name`, `type`, `address`, `hasContract`, `version`, `updatedAt` | `createdAt desc` |
| `GET /company-staffs` | `companyId`, `title` | `name`, `telp`, `email` | `companyId`, `name`, `title`, `version`, `updatedAt` | `createdAt desc` |
| `GET /services` | `isActive` | `code`, `name` | `code`, `name`, `isActive`, `updatedAt` | `createdAt desc` |

Jika `sortBy` tidak dikirim, hasil selalu memakai `createdAt desc`; `createdAt` tidak dapat dipilih secara eksplisit oleh user. Contoh: `/api/v1/marketing/services?isActive=true&sortBy=name&sortOrder=asc&page=1&limit=20`.

Endpoint katalog yang tersedia:

| Endpoint | Method | Fungsi |
|---|---|---|
| `/services` | GET | Daftar service beserta scope |
| `/services/:serviceId` | GET | Detail service beserta scope |
| `/services` | POST | Membuat service dan scope secara atomik |
| `/services/:serviceId` | PATCH | Memperbarui service dan mengganti daftar scope yang dikirim |
| `/services/:serviceId/maintenance/scopes` | POST | Menambah satu maintenance scope |
| `/services/:serviceId/maintenance/scopes/:scopeId` | DELETE | Menonaktifkan satu maintenance scope |

Contoh payload create service:

```json
{
  "code": "INSTALLATION",
  "name": "Installation",
  "hasMaintenance": true,
  "scopes": ["Survey lokasi", "Instalasi perangkat"],
  "maintenanceScopes": ["Inspection", "Cleaning"]
}
```

Untuk memindahkan data `maintenance_scopes` lama ke service terkait dan menghapus tabel `maintenances`, hentikan service lalu jalankan:

```powershell
npm run db:migrate-maintenance-scopes-to-services
```

Jika migrasi relasi maintenance scope sebelumnya sudah pernah dijalankan, rename kolom dapat dijalankan terpisah tanpa mengubah data boolean yang ada:

```powershell
npm run db:migrate-service-has-maintenance
```

Untuk menyelaraskan nama tabel lama `company_staff` dengan konvensi PostgreSQL plural `company_staffs`, hentikan service lalu jalankan:

```powershell
npm run db:migrate-postgresql-names
```

Untuk menambahkan field normalisasi, kontak, revoked, version, dan unique index aktif pada data lama, jalankan:

```powershell
npm run db:migrate-company-versioning
```

## Menjalankan

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

Melalui gateway, endpoint tersedia pada `/api/v1/marketing/companies` dan `/api/v1/marketing/services`.
