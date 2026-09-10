# Marketing Service

Microservice untuk pengelolaan perusahaan serta katalog service, scope, dan item Akura.

## Endpoint

- `GET /health`
- CRUD `/companies`
- CRUD `/company-staffs`
- CRUD `/services`
- Maintenance scope dikelola langsung sebagai bagian dari service melalui `maintenanceScopes` atau endpoint scope di bawah `/services/:serviceId/maintenance/scopes`.

`Company`, `Service`, dan `Item` menyimpan `officeBranchId` sebagai penanda branch pemilik data. Nilai tersebut berasal dari access token dan tidak dapat ditentukan melalui request body. Company staff dan scope mengikuti branch dari parent-nya. Seluruh operasi baca dan tulis otomatis dibatasi ke branch user yang sedang login; user tanpa office branch mendapat response `403`.

`Company` juga menyimpan `name`, `normalizeName`, `type`, `address`, `hasContract`, `revoked`, dan `version`. Company staff menyimpan `name`, `normalizeName`, enum `title` (`mr` atau `mrs`), `telp`, `email`, `revoked`, serta `version`. Service tidak lagi dimiliki oleh company.

Nama dinormalisasi menjadi huruf kecil tanpa spasi sebelum insert atau pemeriksaan duplikasi. Hanya satu company dan satu company staff aktif (`revoked = false`) yang boleh memiliki nilai `normalizeName` yang sama.

Field `Company.type` menggunakan enum `CompanyType`: `PT`, `CV`, `FIRMA`, `KOPERASI`, dan `PERORANGAN`. POST/PATCH hanya menerima nilai tersebut dengan huruf kapital. Pencarian `search` tetap mendukung pencocokan sebagian nama type tanpa membedakan huruf besar/kecil. Sort `type` mengikuti urutan enum PostgreSQL.

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
| `ItemPrice` / `item_prices` | Harga service dan maintenance per item size untuk primary serta sister company; tepat satu row untuk setiap item size |
| `CompanyContractPrice` / `company_contract_prices` | Harga service dan maintenance khusus kontrak company per item size; unik berdasarkan pasangan company dan item size |

Relasi induk-anak dan tabel penghubung menggunakan `onDelete: Cascade`, sehingga scope, size, dan relasi item ikut terhapus ketika induknya dihapus.

Payload dan response endpoint item tetap menampilkan `priceServicePrimary`, `priceServiceSisterCompany`, `priceMaintenancePrimary`, dan `priceMaintenanceSisterCompany` di dalam setiap size agar kontrak API tetap kompatibel. Marketing Service menyimpan nilai tersebut secara atomik pada tabel `item_prices`. Harga kontrak company disimpan terpisah pada `company_contract_prices`; ketika PATCH company membuat versi company baru, seluruh harga kontraknya ikut disalin ke versi baru.

Kedua tabel harga memiliki `effectiveFrom`, `effectiveUntil`, dan `isActive` untuk periode berlaku. Tabel `items`, `item_sizes`, `item_prices`, dan `company_contract_prices` menyimpan `createdById` serta `createdByName`, sedangkan `updatedById` dan `updatedByName` nullable sampai record diubah. Field tersebut merupakan snapshot user audit; ID user tidak memakai foreign key lintas database dan nama diambil dari profil terkini hasil validasi Auth Service. Data historis yang tidak mempunyai informasi pembuat ditandai dengan ID nol dan nama `System Migration`.

Field `description` tidak digunakan pada service, service scope, maintenance scope, maupun item. Service dengan `hasMaintenance=true` wajib mempunyai minimal satu maintenance scope saat dibuat atau ketika maintenance diaktifkan melalui update.

Semua endpoint CRUD hanya menerima request dari API Gateway dan memerlukan user aktif dengan role `ADMIN`/`APP_MANAGER` atau section `MARKETING`. JWKS dan profil user Auth Service diakses melalui `API_GATEWAY_URL`; Marketing tidak menyimpan URL maupun secret Auth Service. `GATEWAY_SECRET` Marketing hanya berlaku untuk koneksi inbound Gateway ke Marketing dan harus berbeda dari secret service lain.

## Filter, sort, dan pagination

Endpoint daftar menerima `page` (default `1`), `limit` (default `20`, maksimum `100`), `sortBy`, dan `sortOrder` (`asc`/`desc`). Seluruh query filter dan sort menggunakan allowlist; query yang tidak dikenal menghasilkan response `400`.

| Endpoint | Filter | Field pencarian `search` | Field `sortBy` | Default sort |
|---|---|---|---|---|
| `GET /companies` | `hasContract` | `name`, `type`, `address` | `name`, `type`, `address`, `hasContract`, `version`, `updatedAt` | `createdAt desc` |
| `GET /company-staffs` | `companyId`, `title` | `name`, `telp`, `email` | `companyId`, `name`, `title`, `version`, `updatedAt` | `createdAt desc` |
| `GET /services` | `isActive`, `name`, `type` | - | `name`, `type`, `isActive` | `createdAt desc` |
| `GET /items` | `name`, `serviceName` | - | `name`, `serviceName` | `createdAt desc` |
| `GET /items/sizes` | `itemId` (wajib), `size` | - | `size` | `createdAt desc` |

Jika `sortBy` tidak dikirim, hasil selalu memakai `createdAt desc`; `createdAt` tidak dapat dipilih secara eksplisit oleh user. Contoh: `/api/v1/marketing/services?isActive=true&sortBy=name&sortOrder=asc&page=1&limit=20`.

Filter tipe service menggunakan exact match `type=TUBULAR` atau `type=OCTG`; nilai lain (termasuk huruf kecil) ditolak dengan `400`. Contoh: `/api/v1/marketing/services?type=TUBULAR&sortBy=type&sortOrder=asc`. Sort tipe mengikuti urutan enum PostgreSQL: `asc` menempatkan TUBULAR sebelum OCTG, `desc` sebaliknya.

Endpoint katalog yang tersedia:

| Endpoint | Method | Fungsi |
|---|---|---|
| `/services` | GET | Daftar service beserta scope |
| `/services/:serviceId` | GET | Detail service beserta scope |
| `/services` | POST | Membuat service dan scope secara atomik |
| `/services/:serviceId` | PATCH | Memperbarui service dan mengganti daftar scope yang dikirim |
| `/services/:serviceId/maintenance/scopes` | POST | Menambah satu maintenance scope |
| `/services/:serviceId/maintenance/scopes/:scopeId` | DELETE | Menonaktifkan satu maintenance scope |
| `/items` | GET | Daftar item aktif beserta service, tanpa memuat size |
| `/items/:itemId` | GET | Detail item aktif beserta service tanpa memuat array size |
| `/items/sizes` | GET | Daftar size aktif; query `itemId` wajib, filter/sort yang diizinkan hanya `size`, default `createdAt desc`, dengan pagination |
| `/items` | POST | Membuat satu item beserta satu atau beberapa size dan harga secara atomik |
| `/items/sizes` | POST | Menambahkan satu size dan satu row harga secara atomik; body wajib berisi `itemId`, `size`, dan `priceServicePrimary` |
| `/items/sizes/:itemSizeId` | DELETE | Menonaktifkan satu item size dan menutup periode harga terkait tanpa menonaktifkan item induk |
| `/items/:itemId` | DELETE | Menonaktifkan item, seluruh size, serta harga terkait |

Endpoint PATCH Item tidak tersedia. Penambahan size dilakukan melalui `POST /items/sizes`. `priceServiceSisterCompany` pada endpoint tersebut opsional dengan default `0`; harga maintenance juga opsional.

Keunikan pasangan `itemId`/`size` hanya berlaku pada size aktif. Nama size nonaktif dapat digunakan lagi sebagai record baru beserta harga baru; histori size/harga lama tetap utuh. Duplikat aktif menghasilkan `409`. Partial unique index PostgreSQL didefinisikan di `prisma/constraints.sql` karena schema Prisma belum merepresentasikan index bersyarat tersebut. `npm run db:push` memasang index ini otomatis. Jangan memakai `prisma db push` langsung tanpa menerapkan `prisma/constraints.sql` setelahnya.

Contoh payload create service:

Field `type` menggunakan enum `ServiceType`: `TUBULAR` atau `OCTG` (huruf kapital). Field ini wajib pada POST dan opsional pada PATCH. PATCH tanpa `type` mempertahankan tipe sebelumnya; nilai di luar enum atau `null` ditolak dengan status `400`. Response daftar dan detail service menyertakan `type`.

```json
{
  "name": "Installation",
  "type": "TUBULAR",
  "hasMaintenance": true,
  "scopes": ["Survey lokasi", "Instalasi perangkat"],
  "maintenanceScopes": ["Inspection", "Cleaning"]
}
```

## Quotation

`quotations` menyimpan field dokumen: `no`, `date`, `inquiryMethod`, `inquiryDate`, `subject`, `termOfPayment`, `validity`, `tax`, `supplyAkura`, `supplyCustomer`, `location`, `accomplished`, `deliveryReports`, `staffId`, `userId`, `status`, `invoiceStatus`, `subTotal`, `taxAmount`, dan `total`. `no`/`date` boleh kosong untuk draft. Nomor yang terisi unik per office branch. `status` dan `invoiceStatus` tetap integer dengan default `1`; arti kode mengikuti aturan bisnis yang akan ditentukan.

`quotation_items` menyimpan referensi item size, snapshot nama service/tipe service/nama item/ukuran, quantity, harga satuan, dan subtotal. `quantity` menggunakan Decimal(18,3), nominal Decimal(18,2). Input quantity/harga berupa string desimal. `tax` diperlakukan sebagai persentase integer 0–100. Subtotal dibulatkan ke dua desimal per baris; subtotal quotation adalah jumlah baris aktif, pajak dihitung dari subtotal, dan total adalah subtotal + pajak. Nominal total dihitung oleh repository, tidak diterima dari input.

`createdById`/`updatedById` pada quotation dan item menyimpan ID user Auth Service tanpa foreign key lintas database. Pembuat diisi dari actor terautentikasi; pengubah bernilai null sampai record diubah. `userId` adalah user yang ditugaskan, terpisah dari actor audit. `customerSnapshot` mempertahankan data company/contact saat quotation dibuat atau kontak diganti.

Seluruh perubahan dilakukan melalui `quotationRepository`: `create`, `update`, dan `deactivate`. Update/deactivate wajib menyertakan `version` quotation terakhir. Compare-and-swap atomik menaikkan versi dan mengunci parent sebelum perubahan item; request stale/inactive mendapat `HttpError(409)`. Semua perubahan header, item, perhitungan total, dan snapshot riwayat berada dalam satu transaksi. Kegagalan membatalkan seluruh transaksi. Jangan melakukan write langsung ke quotation/item lewat Prisma karena akan melewati kontrol versi dan audit repository.

Saat `items` dikirim pada update, array menjadi daftar lengkap item aktif: sertakan `id` untuk mempertahankan baris, hilangkan `id` untuk menambah baris, dan baris lama yang tidak dikirim dinonaktifkan. Referensi katalog baris existing tidak dapat diganti; buat baris baru. Snapshot baris existing tetap utuh meskipun katalog berubah. Update header tanpa `items` mempertahankan baris sebelumnya.

`quotation_histories` menyimpan snapshot lengkap header dan seluruh baris setiap versi (termasuk baris nonaktif), actor, waktu, dan aksi CREATE/UPDATE/DEACTIVATE. Pasangan quotation/version unik. Repository hanya menambahkan riwayat, tidak mengubah atau menghapusnya. Relasi menggunakan `Restrict` untuk mencegah penghapusan berantai dokumen/riwayat akibat penghapusan data referensi. Deactivate menggunakan soft delete.

Tahap ini menambahkan tabel dan operasi repository; endpoint HTTP quotation belum ditambahkan. Verifikasi database lokal: `npm run test:quotation`. Harness memakai branch UUID khusus dan membersihkan hanya fixture miliknya setelah pengujian.

## Menjalankan aplikasi

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

Melalui gateway, endpoint tersedia pada `/api/v1/marketing/companies` dan `/api/v1/marketing/services`.

## Pengujian API dan concurrency

Dengan Auth Service, Marketing Service, dan API Gateway aktif, jalankan:

```powershell
npm run test:api
```

Harness menguji seluruh endpoint Marketing, race condition pada pembuatan company, request scope concurrent, perlindungan lost update untuk PATCH parsial, invariant row aktif, cleanup data, dan stress test request paralel.
Jumlah request stress default adalah `25` dengan concurrency `5`; keduanya dapat dinaikkan melalui `TEST_STRESS_TOTAL` dan `TEST_STRESS_CONCURRENCY` dengan memperhatikan konfigurasi rate limit Gateway.
