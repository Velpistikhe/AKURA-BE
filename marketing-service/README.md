# Marketing Service

Microservice untuk pengelolaan perusahaan serta katalog service, maintenance, scope, dan item Akura.

## Endpoint

- `GET /health`
- CRUD `/companies`
- CRUD `/company-staffs`
- CRUD `/services`
- Maintenance dibuat sebagai bagian dari `POST /services` ketika `hasService=true`; endpoint maintenance terpisah tidak tersedia.

`Company` menyimpan `name`, `normalizeName`, `type`, `address`, `hasContract`, `revoked`, dan `version`. Company staff menyimpan `name`, `normalizeName`, enum `title` (`mr` atau `mrs`), `telp`, `email`, `revoked`, serta `version`. Service tidak lagi dimiliki oleh company.

Nama dinormalisasi menjadi huruf kecil tanpa spasi sebelum insert atau pemeriksaan duplikasi. Hanya satu company dan satu company staff aktif (`revoked = false`) yang boleh memiliki nilai `normalizeName` yang sama.

`PATCH /companies/:companyId` bersifat insert-only: company dan staff aktif lama ditandai revoked, kemudian dibuat company baru dengan `version + 1`. Seluruh staff aktif disalin ke company baru dengan ID baru dan `version = 0`. `DELETE /company-staffs/:companyStaffId` tidak menghapus row; endpoint mengubah `revoked` menjadi `true` dan menaikkan `version`.

## Model katalog

Model `MarketingService` dan tabel `marketing_services` sudah dihapus. Struktur katalog baru:

| Model / tabel | Fungsi dan relasi |
|---|---|
| `Service` / `services` | Katalog service; memiliki banyak `ServiceScope` dan dapat (opsional) menyediakan satu maintenance |
| `ServiceScope` / `service_scopes` | Field `scope` milik tepat satu service; unik berdasarkan service dan scope |
| `Maintenance` / `maintenances` | Katalog maintenance; memiliki banyak `MaintenanceScope` |
| `MaintenanceScope` / `maintenance_scopes` | Field `scope` milik tepat satu maintenance; unik berdasarkan maintenance dan scope |
| `Item` / `items` | Katalog item; memiliki banyak size, service, dan maintenance |
| `ItemSize` / `item_sizes` | Daftar size milik item; unik berdasarkan item dan size |

Relasi induk-anak dan tabel penghubung menggunakan `onDelete: Cascade`, sehingga scope, size, dan relasi item ikut terhapus ketika induknya dihapus.

Field `description` tidak digunakan pada service, service scope, maintenance, maintenance scope, maupun item. Satu service boleh tidak memiliki maintenance.

Perubahan harga atau kuantitas bersifat insert-only. Gunakan `itemRelationRepository.createServiceVersion` atau `createMaintenanceVersion`; helper mengunci pasangan relasi dalam transaksi, membaca versi terakhir, lalu membuat row baru dengan `version + 1`. Row versi sebelumnya tidak diperbarui atau diganti.

Semua endpoint CRUD hanya menerima request dari API Gateway dan memerlukan user aktif dengan role `ADMIN`/`APP_MANAGER` atau section `MARKETING`.

## Filter, sort, dan pagination

Endpoint daftar menerima `page` (default `1`), `limit` (default `20`, maksimum `100`), `sortBy`, dan `sortOrder` (`asc`/`desc`). Seluruh query filter dan sort menggunakan allowlist; query yang tidak dikenal menghasilkan response `400`.

| Endpoint | Filter | Field pencarian `search` | Field `sortBy` | Default sort |
|---|---|---|---|---|
| `GET /companies` | `hasContract` | `name`, `type`, `address` | `name`, `type`, `address`, `hasContract`, `version`, `updatedAt` | `createdAt desc` |
| `GET /company-staffs` | `companyId`, `title` | `name`, `telp`, `email` | `companyId`, `name`, `title`, `version`, `updatedAt` | `createdAt desc` |
| `GET /services` | `isActive` | `code`, `name` | `code`, `name`, `isActive`, `updatedAt` | `createdAt desc` |
| `GET /maintenances` | `isActive` | `code`, `name` | `code`, `name`, `isActive`, `updatedAt` | `createdAt desc` |

Jika `sortBy` tidak dikirim, hasil selalu memakai `createdAt desc`; `createdAt` tidak dapat dipilih secara eksplisit oleh user. Contoh: `/api/v1/marketing/services?isActive=true&sortBy=name&sortOrder=asc&page=1&limit=20`.

Endpoint katalog yang tersedia:

| Endpoint | Method | Fungsi |
|---|---|---|
| `/services` | GET | Daftar service beserta scope |
| `/services/:serviceId` | GET | Detail service beserta scope |
| `/services` | POST | Membuat service dan scope secara atomik |
| `/maintenances` | GET | Daftar maintenance beserta scope |
| `/maintenances/:maintenanceId` | GET | Detail maintenance beserta scope |
| `/maintenances` | POST | Membuat maintenance dan scope secara atomik |

Contoh payload create service atau maintenance:

```json
{
  "code": "INSTALLATION",
  "name": "Installation",
  "scopes": ["Survey lokasi", "Instalasi perangkat"],
  "isActive": true
}
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
