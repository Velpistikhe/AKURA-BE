# Marketing Service

Microservice untuk pengelolaan perusahaan serta katalog service, scope, dan item Akura.

## Endpoint

Swagger dan spesifikasi OpenAPI dipusatkan di API Gateway: `GET /api-docs` dan `GET /api-docs.json`. Marketing Service tidak lagi mengekspos endpoint dokumentasi sendiri.

- `GET /health`
- CRUD `/companies`
- CRUD `/company-staffs`
- CRUD `/services`
- Maintenance scope dikelola langsung sebagai bagian dari service melalui `maintenanceScopes` atau endpoint scope di bawah `/services/:serviceId/maintenance/scopes`.

`Company`, `Service`, dan `Item` menyimpan `officeBranchId` sebagai penanda branch pemilik data. Nilai tersebut berasal dari access token dan tidak dapat ditentukan melalui request body. Company staff dan scope mengikuti branch dari parent-nya. Seluruh operasi baca dan tulis otomatis dibatasi ke branch user yang sedang login; user tanpa office branch mendapat response `403`.

`Company` juga menyimpan `name`, `normalizeName`, `type`, `address`, `npwp`, `isSisterCompany`, `revoked`, dan `version`. Company staff menyimpan `name`, `normalizeName`, enum `title` (`mr` atau `mrs`), `telp`, `email`, `revoked`, serta `version`. Service tidak lagi dimiliki oleh company.

Nama dinormalisasi menjadi huruf kecil tanpa spasi sebelum insert atau pemeriksaan duplikasi. Hanya satu company dan satu company staff aktif (`revoked = false`) yang boleh memiliki nilai `normalizeName` yang sama.

Field `Company.type` menggunakan enum `CompanyType`: `PT`, `CV`, `FIRMA`, `KOPERASI`, dan `PERORANGAN`. POST/PATCH hanya menerima nilai tersebut dengan huruf kapital. Pencarian `search` tetap mendukung pencocokan sebagian nama type tanpa membedakan huruf besar/kecil. Sort `type` mengikuti urutan enum PostgreSQL.

Company memakai ID tetap. POST wajib berisi `name`, `type`, `address`, dan `npwp` (string non-null, tidak kosong setelah trim, maksimal 32 karakter). NPWP tidak memiliki default dan format/keunikan khusus tidak dipaksakan. PATCH wajib `version` terbaru dan minimal satu field perubahan; NPWP boleh tidak dikirim untuk mempertahankan nilai lama, tetapi null/kosong ditolak. PATCH memperbarui row yang sama, menaikkan versi, serta mempertahankan ID staff, kontrak, dan harga. DELETE soft-deletes company dan staff aktif tanpa menghapus history. Versi stale/nonaktif menghasilkan 409.

## History company

`CompanyHistory` menyimpan snapshot seluruh field profil company untuk setiap versi: CREATE mulai 0, UPDATE menaikkan versi, DEACTIVATE mencatat soft delete. Snapshot mencatat actor melalui `createdById` dan waktu `createdAt`. Update profil dan penulisan history berada dalam transaksi yang sama; kegagalan salah satunya membatalkan semua perubahan. `createdById` dan `createdAt` company asli tetap, sedangkan pengubah dicatat pada `updatedById`.

`GET /api/v1/marketing/companies/:companyId/history?page=1&limit=20` mengembalikan `{ companyId, history, pagination }`, urut versi terbaru. History tetap dapat dibaca setelah company dinonaktifkan, hanya dari branch token yang sesuai; branch lain atau ID tidak ditemukan menghasilkan 404. Aplikasi tidak menyediakan endpoint edit/hapus history. History staff dan audit kontrak tetap terpisah dari snapshot profil company.

Quotation menyimpan `companySnapshot` berisi `id`, `version`, `name`, `type`, `address`, `npwp` saat create atau penggantian kontak, selain `customerSnapshot` nama staff. Perubahan profil company dan update quotation tanpa penggantian kontak tidak mengubah snapshot tersebut. Gunakan snapshot saat menampilkan/cetak identitas customer pada quotation lama.

Tes CRUD/history: `npm run test:company-history`.

## History company staff

`CompanyStaffHistory` (`company_staff_histories`) menyimpan snapshot seluruh field staff, versi, action, actor (`createdById`), dan waktu perubahan. CREATE dimulai pada versi 0; UPDATE dan DEACTIVATE menaikkan versi. Penonaktifan staff melalui DELETE company juga mencatat history staff dalam transaksi yang sama. Kegagalan penulisan history membatalkan perubahan terkait. ID staff tetap dan setiap pasangan staff/versi unik.

`GET /api/v1/marketing/company-staffs/:companyStaffId/history?page=1&limit=20` mengembalikan `{ companyStaffId, history, pagination }`, urut versi terbaru, maksimum limit 100. History tersedia setelah staff/company dinonaktifkan dan mengikuti branch company staff saat ini. Endpoint tidak menyediakan edit/hapus history.

Model `CompanyAuditLog` tidak lagi digunakan. Karena masih tahap development, tabel `company_audit_logs` beserta data audit lama boleh langsung dihapus tanpa migrasi atau backfill. Sinkronkan database dengan `npm run db:push -- --accept-data-loss`; perintah ini menerapkan seluruh perubahan pada schema Prisma. History baru tetap disimpan di `company_histories` dan `company_staff_histories`.

Tes staff/history: `npm run test:company-staff-history`.

## Model katalog

Model `MarketingService` dan tabel `marketing_services` sudah dihapus. Struktur katalog baru:

| Model / tabel | Fungsi dan relasi |
|---|---|
| `Service` / `services` | Katalog service; memiliki banyak `InspectionScope` dan `MaintenanceScope` |
| `InspectionScope` / `inspection_scopes` | Field `inspectionScope` milik tepat satu service; unik berdasarkan service dan inspection scope |
| `MaintenanceScope` / `maintenance_scopes` | Field `scope` maintenance milik tepat satu service; unik berdasarkan service dan scope |
| `Item` / `items` | Katalog item; memiliki banyak size dan satu service |
| `ItemSize` / `item_sizes` | Daftar size milik item; unik berdasarkan item, size, dan awal berlaku |
| `ItemPrice` / `item_prices` | Harga service dan maintenance per item size untuk primary serta sister company; tepat satu row untuk setiap item size |
| `CompanyContract` / `company_contracts` | Kontrak company, dengan `contractNumber`, `contractDate`, `effectiveFrom`, `effectiveUntil`, `isActive`, dan `version`; periode aktif tidak boleh tumpang tindih |
| `CompanyContractHistory` / `company_contract_histories` | Snapshot append-only setiap versi kontrak, termasuk `createdById` dan `createdByName` pelaku perubahan |
| `CompanyContractPrice` / `company_contract_prices` | Harga service dan maintenance khusus kontrak company per item size; unik berdasarkan pasangan contract dan item size; memakai `contractId` |

Relasi induk-anak dan tabel penghubung menggunakan `onDelete: Cascade`, sehingga scope, size, dan relasi item ikut terhapus ketika induknya dihapus.

Payload dan response endpoint item tetap menampilkan `priceServicePrimary`, `priceServiceSisterCompany`, `priceMaintenancePrimary`, dan `priceMaintenanceSisterCompany` di dalam setiap size agar kontrak API tetap kompatibel. Marketing Service menyimpan nilai tersebut secara atomik pada tabel `item_prices`. Harga kontrak company disimpan terpisah pada `company_contract_prices`; PATCH company mempertahankan seluruh ID kontrak dan harga yang terhubung tanpa menyalin atau mengubahnya.

Kedua tabel harga memiliki `effectiveFrom`, `effectiveUntil`, dan `isActive` untuk periode berlaku. Tabel `items`, `item_sizes`, `item_prices`, dan `company_contract_prices` menyimpan `createdById` serta `createdByName`, sedangkan `updatedById` dan `updatedByName` nullable sampai record diubah. Field tersebut merupakan snapshot user audit; ID user tidak memakai foreign key lintas database dan nama diambil dari profil terkini hasil validasi Auth Service. Data historis yang tidak mempunyai informasi pembuat ditandai dengan ID nol dan nama `System Migration`.

Field `description` tidak digunakan pada service, inspection scope, maintenance scope, maupun item. Service dengan `hasMaintenance=true` wajib mempunyai minimal satu maintenance scope saat dibuat atau ketika maintenance diaktifkan melalui update.

Semua endpoint CRUD hanya menerima request dari API Gateway dan memerlukan user aktif dengan role `ADMIN`/`APP_MANAGER` atau section `MARKETING`. JWKS dan profil user Auth Service diakses melalui `API_GATEWAY_URL`; Marketing tidak menyimpan URL maupun secret Auth Service. `GATEWAY_SECRET` Marketing hanya berlaku untuk koneksi inbound Gateway ke Marketing dan harus berbeda dari secret service lain.

## Filter, sort, dan pagination

Endpoint daftar menerima `page` (default `1`), `limit` (default `20`, maksimum `100`), `sortBy`, dan `sortOrder` (`asc`/`desc`). Seluruh query filter dan sort menggunakan allowlist; query yang tidak dikenal menghasilkan response `400`.

| Endpoint | Filter | Field pencarian `search` | Field `sortBy` | Default sort |
|---|---|---|---|---|
| `GET /companies` | `isSisterCompany` | `name`, `type`, `address` | `name`, `type`, `address`, `npwp`, `isSisterCompany`, `version`, `updatedAt` | `createdAt desc` |
| `GET /company-staffs` | `companyId`, `title` | `name`, `telp`, `email` | `companyId`, `name`, `title`, `version`, `updatedAt` | `createdAt desc` |
| `GET /services` | `isActive`, `name`, `type` | - | `name`, `type`, `isActive` | `createdAt desc` |
| `GET /items` | `name`, `serviceName` | - | `name`, `serviceName` | `createdAt desc` |
| `GET /items/sizes` | `itemId` (opsional), `size`, `itemName`, `serviceName`, `notIn` | - | `size` | `createdAt desc` |
| `GET /items/sizes/contract-prices` | `companyId` (wajib), `itemId`, `size`, `itemName`, `serviceName`, `notIn` | - | `size` | `createdAt desc` |

Jika `sortBy` tidak dikirim, hasil selalu memakai `createdAt desc`; `createdAt` tidak dapat dipilih secara eksplisit oleh user. Contoh: `/api/v1/marketing/services?isActive=true&sortBy=name&sortOrder=asc&page=1&limit=20`.

Pada `GET /items/sizes`, `notIn` mengecualikan ID **item size** (bukan ID item): `?notIn=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222`. Parameter opsional ini menerima 1–100 UUID dipisahkan koma; hilangkan parameter jika tidak ada pengecualian. Filter digabung dengan filter lain menggunakan AND, tetap dibatasi branch pengguna, dan diterapkan juga pada total pagination. Nilai kosong atau UUID tidak valid menghasilkan `400`.

Filter tipe service menggunakan exact match `type=TUBULAR` atau `type=OCTG`; nilai lain (termasuk huruf kecil) ditolak dengan `400`. Contoh: `/api/v1/marketing/services?type=TUBULAR&sortBy=type&sortOrder=asc`. Sort tipe mengikuti urutan enum PostgreSQL: `asc` menempatkan TUBULAR sebelum OCTG, `desc` sebaliknya.

Endpoint katalog yang tersedia:

`GET /api/v1/marketing/items/sizes/contract-prices?companyId=<UUID>&itemName=pipe&sortBy=size&sortOrder=asc` mengembalikan `{ sizes, pagination }`. Setiap row memuat data size, harga standar, `item.service`, dan objek `contractPrice` (termasuk `priceService` dan `priceMaintenance`). Hanya size dengan harga kontrak aktif yang sudah mulai berlaku dan belum berakhir yang ditampilkan. Company harus belum revoked dan berada di branch pengguna; item, service, dan size harus aktif serta mengikuti pembatasan branch. Company atau `itemId` yang tidak ditemukan menghasilkan `404`; tanpa kontrak yang cocok hasilnya daftar kosong. Filter dan pagination sama dengan GET size biasa, termasuk `notIn` untuk mengecualikan ID size.

| Endpoint | Method | Fungsi |
|---|---|---|
| `/services` | GET | Daftar service beserta scope |
| `/services/:serviceId` | GET | Detail service beserta scope |
| `/services` | POST | Membuat service dan scope secara atomik |
| `/services/:serviceId` | PATCH | Memperbarui service dan mengganti daftar scope yang dikirim |
| `/services/:serviceId/inspection/scopes` | POST | Menambah satu inspection scope |
| `/services/:serviceId/inspection/scopes/:inspectionScopeId` | DELETE | Menonaktifkan satu inspection scope |
| `/services/:serviceId/maintenance/scopes` | POST | Menambah satu maintenance scope |
| `/services/:serviceId/maintenance/scopes/:scopeId` | DELETE | Menonaktifkan satu maintenance scope |
| `/items` | GET | Daftar item aktif beserta service, tanpa memuat size |
| `/items/:itemId` | GET | Detail item aktif beserta service tanpa memuat array size |
| `/items/sizes` | GET | Daftar size aktif lintas item dalam branch pengguna; `itemId` opsional, filter `size`, `itemName`, `serviceName`, sort `size`, default `createdAt desc`, dengan pagination dan data `item.service` pada setiap row |
| `/items` | POST | Membuat satu item beserta satu atau beberapa size dan harga secara atomik |
| `/items/sizes` | POST | Menambahkan satu size dan satu row harga secara atomik; body wajib berisi `itemId`, `itemVersion`, `size`, `priceServicePrimary`, dan `priceServiceSisterCompany` |
| `/items/sizes/:itemSizeId` | DELETE | Menonaktifkan satu item size dan menutup periode harga terkait tanpa menonaktifkan item induk |
| `/items/:itemId` | DELETE | Menonaktifkan item, seluruh size, serta harga terkait |

PATCH item dan size tersedia untuk mengubah nama/label. PATCH dan DELETE wajib mengirim `version` resource terbaru; POST penambahan size wajib `itemVersion` parent terbaru. Versi stale menghasilkan `409`. Perubahan harga menaikkan versi size dan item; perubahan contract price juga menaikkan versi kontrak. Semua operasi katalog menggunakan satu urutan lock branch bersama operasi company dan service, transaksi atomik, compare-and-swap, dan audit before/after pada `catalog_audit_logs`. API audit hanya menyediakan pembacaan; aplikasi selalu menambahkan snapshot baru tanpa mengubah atau menghapus snapshot lama. Soft delete item/size hanya menutup harga aktif; riwayat yang sudah nonaktif tetap utuh.

Harga service primary, sister company, dan contract wajib dikirim; tidak memiliki default `0`. Nilai negatif, null untuk service price, boolean, string kosong, dan lebih dari dua desimal ditolak (`400`). Gunakan string desimal untuk nominal besar. Nilai `0` eksplisit valid. Maintenance price boleh null kecuali service memiliki maintenance, saat itu harga maintenance wajib lengkap. GET harga yang hilang tidak membuat harga nol: GET detail price mengembalikan `404`, daftar size mengembalikan `priceStatus=UNAVAILABLE` dan harga null.

`ItemSize` menggunakan `effectiveFrom` dan `effectiveUntil`; aplikasi memeriksa duplikasi size aktif per `(itemId, size)` sebelum menyimpan dalam transaksi dengan lock branch, sedangkan constraint `(itemId, size, effectiveFrom)` mempertahankan histori reuse. `ItemPrice` tetap satu row per size dan `CompanyContractPrice` satu row per `(contractId, itemSizeId)`; setiap revisi disimpan sebagai snapshot audit immutable, bukan menimpa histori. Harga nonaktif dapat diaktifkan kembali melalui PATCH dengan `isActive=true`, field harga lengkap, dan versi terbaru.

### Kontrak company dan pemilihan harga

Respons company (list, detail, create, update, delete) memiliki field `contract`: objek kontrak berstatus ACTIVE dan isActive=true, atau `null`. Contract ini dapat memiliki masa berlaku yang akan datang; pemilihan harga tetap memakai periode `effectiveFrom <= hari ini < effectiveUntil`. Kontrak nonaktif dan company revoked tidak menghasilkan contract pada respons. Ini adalah field hasil perhitungan, bukan kolom baru. CRUD kontrak tersedia melalui `/api/v1/marketing/company-contracts`: POST membuat, GET dengan `companyId` menampilkan daftar, serta GET/PATCH/DELETE `/:contractId` untuk detail, perubahan periode, dan penonaktifan. PATCH dan DELETE wajib membawa `version` kontrak terbaru.

Company memiliki `isSisterCompany` (default false). Field `hasContract` sudah dihapus dari database, input, response, filter dan sort. Keberadaan kontrak ditentukan dari tabel `company_contracts`. `effectiveFrom` inklusif dan `effectiveUntil` eksklusif serta wajib diisi; akhir harus setelah awal. Ketiga tanggal kontrak (`contractDate`, `effectiveFrom`, `effectiveUntil`) memakai format `YYYY-MM-DD`. Kontrak aktif yang belum mulai atau sudah berakhir tidak dipakai untuk harga saat ini.

| Endpoint | Method | Input utama |
|---|---|---|
| `/company-contracts` | GET | `companyId` wajib; opsional `isActive`, `page`, `limit` |
| `/company-contracts` | POST | `companyId`, `contractNumber`, `contractDate`, `effectiveFrom`, `effectiveUntil` |
| `/company-contracts/:contractId` | GET / PATCH / DELETE | PATCH: `version` dan field kontrak/tanggal yang diubah; DELETE: `version` |
| `/items/:itemId` | PATCH | `version`, `name` |
| `/items/sizes/:itemSizeId` | GET / PATCH | PATCH: `version`, `size` |
| `/items/sizes/:itemSizeId/price` | GET / POST / PATCH / DELETE | Harga standar; PATCH/DELETE: versi harga |
| `/items/sizes/:itemSizeId/contract-prices` | POST | `contractId`, `priceService`, `priceMaintenance` |
| `/items/contract-prices/:contractPriceId` | GET / PATCH / DELETE | Harga kontrak; PATCH/DELETE: versi harga |
| `/items/history` | GET | `entityType`, `entityId`, opsional `page`, `limit` |
| `/items/sizes/prices` | GET | `companyId` wajib; filter/sort/pagination sama dengan GET size |

Contoh endpoint harga: `/api/v1/marketing/items/sizes/prices?companyId=<UUID>&itemName=pipe&sortBy=size&sortOrder=asc`.

Urutan harga: kontrak aktif dan berlaku saat ini, lalu harga standar sister company jika `isSisterCompany=true`, lalu harga primary. Jika ada kontrak yang berlaku tetapi harga suatu size tidak ada, respons memakai `UNAVAILABLE` tanpa fallback. Setiap row memuat `priceSource` (`CONTRACT`, `SISTER_COMPANY`, `PRIMARY`), `priceStatus`, `priceMessage`, `priceService`, `priceMaintenance`, `contractId`, dan `contractPrice`. Endpoint `/items/sizes/contract-prices` tetap tersedia untuk hanya menampilkan size yang memiliki harga kontrak saat ini. Semua relasi dibatasi branch pengguna. DELETE kontrak mengubah status menjadi TERMINATED dan menonaktifkan kontrak, mempertahankan data harganya, dan menghentikan pemakaiannya dalam pemilihan harga.

### Status kontrak dan template Excel

`CompanyContract.status` memakai enum `CREATE`, `ACTIVE`, `EXPIRED`, `TERMINATED`, tetapi tidak diterima pada request POST maupun PATCH. POST oleh user membuat status `CREATE`; POST oleh ADMIN/APP_MANAGER membuat status `ACTIVE`. Admin dapat mengaktifkan kontrak CREATE lewat `POST /company-contracts/:contractId/approve`. PATCH hanya untuk admin dan merupakan revisi: kontrak lama menjadi `TERMINATED`, `isActive=false`, `effectiveUntil` diisi timestamp revisi, lalu kontrak ACTIVE pengganti dibuat. Scheduler berjalan setiap hari pukul 00:00:00 menurut timezone server untuk mengubah kontrak yang melewati `effectiveUntil` menjadi `EXPIRED` dan `isActive=false`. DELETE menetapkan `TERMINATED`. Filter daftar: `GET /company-contracts?companyId=<UUID>&status=CREATE`.

Status kontrak ditentukan oleh business logic saat kontrak dibuat atau diubah berdasarkan periode berlaku. Harga kontrak hanya dipakai jika status `ACTIVE`, `isActive=true`, dan tanggal berlaku sesuai. CREATE dapat diisi harga sebelum periode berlaku. EXPIRED/TERMINATED menolak perubahan dan impor harga. Benturan periode diperiksa saat kontrak berstatus ACTIVE. DELETE menetapkan TERMINATED dan isActive=false. Revisi profil company mempertahankan kontrak beserta status dan versinya.

Download template: `GET /api/v1/marketing/items/sizes/export`. Respons berupa file `akura-normal-prices.xlsx`, berisi Service, Item, Size, Harga Service, dan Harga Maintenance normal primary. Harga sister company dan harga kontrak tidak diekspor. Filter opsional: `companyId`, `itemId`, `itemName`, `serviceName`, `size`, `notIn`, `sortBy=size`, `sortOrder`; maksimal 2000 row tanpa pagination. Branch diambil dari token. Jika `companyId` dikirim, company harus belum revoked dan berada pada branch token yang sama; jika tidak, respons 404. Item dan service dibatasi ke branch tersebut. Tanpa `companyId`, ekspor langsung memakai branch token. `officeBranchId` dari query tidak diterima.

Edit harga pada Excel dan pilih `YA` untuk baris yang ingin diimpor. ID size dan versi disimpan di kolom tersembunyi; jangan diubah. Harga normal yang tidak tersedia dibiarkan kosong dan baris default `TIDAK` sampai diisi.

Upload melalui `POST /api/v1/marketing/company-contracts/:contractId/prices/import` dengan multipart/form-data: `file` (.xlsx maksimal 5 MB), `companyId`, dan `version` kontrak terbaru. Kontrak harus berstatus CREATE/ACTIVE, isActive=true, dan belum melewati tanggal akhir. Semua baris terpilih disimpan atomik sebagai harga kontrak baru tanpa mengubah harga normal. Duplikasi, template dari branch lain, versi stale, formula, harga invalid, atau maintenance wajib yang kosong ditolak sebelum penyimpanan. Respons sukses berisi `companyId`, `contractId`, `version` terbaru, dan jumlah `imported`.

Verifikasi download, upload, dan status: `npm run test:contract-excel`.

### Sinkronisasi database development

Jalankan `npm run db:push` untuk menyinkronkan schema dan generate Prisma Client. Tidak ada script SQL validasi tambahan. Validasi input berjalan melalui middleware/controller sebelum penyimpanan. Pemeriksaan yang membaca data, seperti size duplikat dan benturan periode kontrak, dilakukan oleh kode aplikasi dalam transaksi yang dipanggil controller dengan lock branch agar aman terhadap request bersamaan. Audit hanya memiliki endpoint baca; penulisan aplikasi selalu menambahkan snapshot baru.

Primary key, foreign key, tipe kolom, dan unique key relasi/histori tetap didefinisikan pada `schema.prisma`. Database tidak memasang CHECK bisnis, exclusion constraint, partial unique index size aktif, atau trigger audit. Perubahan langsung melalui SQL tidak melewati validasi aplikasi.

Jika data development menghalangi perubahan schema, gunakan `npm run db:push -- --force-reset` untuk menghapus data dan membuat ulang schema. Tidak ada pemindahan data legacy atau pembuatan baseline audit.

Tes: `npm run test:catalog-pricing`, `npm run test:item-size-list`, dan `npm run test:item-size-reuse`. Tes menggunakan router asli dengan auth context yang diinjeksi, menguji PostgreSQL sungguhan, dan membersihkan fixture. Audit fixture tetap tersimpan sesuai aturan append-only.

## Quotation

`revision` menandai jumlah revisi isi dokumen, mulai dari `0`. Perubahan isi header atau daftar/urutan/quantity/harga item menaikkannya satu kali per transaksi. Perubahan status saja, pengiriman isi identik, dan soft delete tidak menaikkannya. `version` tetap menjadi token concurrency dan naik pada setiap update/delete. Nomor `no` tidak berubah saat direvisi; snapshot histori menyimpan revision tiap versi. `revision` diisi server dan tidak diterima dari request. Frontend menggunakan label `no 1` untuk no=1/revision=0, `no 1 revisi 1` untuk revision=1, dan seterusnya. GET daftar/detail mengembalikan revision terkini; snapshot versi sebelumnya tersedia melalui repository history.

`quotations` menyimpan field dokumen: `no`, `numberYear`, `date`, `inquiryMethod`, `inquiryDate`, `subject`, `termOfPayment`, `validity`, `tax`, `supplyAkura`, `supplyCustomer`, `location`, `accomplished`, `deliveryReports`, `staffId`, `status`, `invoiceStatus`, `subTotal`, `taxAmount`, dan `total`. `date` boleh kosong untuk draft. `no` dan `numberYear` otomatis dari server dan tidak diterima pada create/update. Nomor unik berdasarkan `(officeBranchId, numberYear, no)`. `inquiryMethod` menggunakan enum `EMAIL`, `WHATSAPP`, `VERBAL`, atau `JOB_ORDER_REQUEST`. `status` menggunakan enum `CREATED` (default), `SENT`, `REJECTED`, `APPROVED`, `REVISED`, `CONFIRMED`, `ON_PROGRESS`, `WORK_ORDER_COMPLETE`, atau `COMPLETE`. Nilai API wajib huruf kapital; angka dan nilai di luar enum ditolak. `invoiceStatus` menggunakan enum nullable `CREATED`, `SEND`, `APPROVED`, `COMPLETE`, `CANCELED`, atau `EXPIRED`. Jika tidak dikirim saat create, nilainya `null` sampai quotation menerbitkan invoice; request juga dapat mengirim `null`. Update tanpa field ini mempertahankan nilai sebelumnya.

`quotation_sequences` menyimpan `lastNumber` per `(officeBranchId, year)`. Tahun mengikuti waktu create dalam zona `Asia/Jakarta`, bukan tanggal dokumen. Create menginisialisasi counter jika belum ada dengan `INSERT ... ON CONFLICT DO NOTHING`, lalu membaca counter menggunakan pessimistic row lock `SELECT ... FOR UPDATE`. Nomor quotation diisi `lastNumber + 1`, kemudian counter diperbarui menggunakan nomor yang sama. Counter, quotation, item, dan histori berada dalam satu transaksi; kegagalan me-rollback semuanya. Tahun baru memakai counter baru mulai 1 untuk setiap cabang. Soft delete tidak mengurangi counter atau menggunakan ulang nomor lama. Nomor dan tahun penomoran tetap saat quotation diperbarui.

`quotation_items` menyimpan referensi item size, snapshot nama service/tipe service/nama item/ukuran, quantity, harga satuan, dan subtotal. `quantity` menggunakan Decimal(18,3), nominal Decimal(18,2). Input quantity/harga berupa string desimal. `tax` diperlakukan sebagai persentase integer 0–100. Subtotal dibulatkan ke dua desimal per baris; subtotal quotation adalah jumlah baris aktif, pajak dihitung dari subtotal, dan total adalah subtotal + pajak. Nominal total dihitung oleh repository, tidak diterima dari input.

`createdById`/`updatedById` pada quotation dan item menyimpan ID user Auth Service tanpa foreign key lintas database. Pembuat diisi dari actor terautentikasi; pengubah bernilai null sampai record diubah. `customerSnapshot` berupa string yang hanya menyimpan nama company staff saat quotation dibuat atau kontak diganti. Perubahan nama staff sesudahnya tidak mengubah snapshot yang sudah tersimpan.

Seluruh perubahan dilakukan melalui `quotationRepository`: `create`, `update`, dan `deactivate`. Update/deactivate wajib menyertakan `version` quotation terakhir. Compare-and-swap atomik menaikkan versi dan mengunci parent sebelum perubahan item; request stale/inactive mendapat `HttpError(409)`. Semua perubahan header, item, perhitungan total, dan snapshot riwayat berada dalam satu transaksi. Kegagalan membatalkan seluruh transaksi. Jangan melakukan write langsung ke quotation/item lewat Prisma karena akan melewati kontrol versi dan audit repository.

Saat `items` dikirim pada update, array menjadi daftar lengkap item aktif: sertakan `id` untuk mempertahankan baris, hilangkan `id` untuk menambah baris, dan baris lama yang tidak dikirim dinonaktifkan. Referensi katalog baris existing tidak dapat diganti; buat baris baru. Snapshot baris existing tetap utuh meskipun katalog berubah. Update header tanpa `items` mempertahankan baris sebelumnya.

`quotation_histories` menyimpan snapshot lengkap header dan seluruh baris setiap versi (termasuk baris nonaktif), actor, waktu, dan aksi CREATE/UPDATE/DEACTIVATE. Pasangan quotation/version unik. Repository hanya menambahkan riwayat, tidak mengubah atau menghapusnya. Relasi menggunakan `Restrict` untuk mencegah penghapusan berantai dokumen/riwayat akibat penghapusan data referensi. Deactivate menggunakan soft delete.

Endpoint melalui Gateway (akses Marketing dan office branch wajib):

| Endpoint | Method | Fungsi |
|---|---|---|
| `/api/v1/marketing/quotations` | GET | Daftar quotation aktif beserta item aktif, `page` minimal 1 dan `limit` 1–100 (default 20), urut terbaru |
| `/api/v1/marketing/quotations/:quotationId` | GET | Detail quotation aktif dari branch pengguna |
| `/api/v1/marketing/quotations` | POST | Membuat quotation dan array `items` (1–100 baris) secara atomik |
| `/api/v1/marketing/quotations/:quotationId` | PATCH | Update header dan/atau daftar item; wajib `version` terbaru dan minimal satu field perubahan |
| `/api/v1/marketing/quotations/:quotationId` | DELETE | Soft delete quotation beserta item aktif; body wajib `{ "version": 0 }` sesuai versi terbaru |

GET tidak menampilkan quotation nonaktif. DELETE mempertahankan row dan histori, menambah versi, serta mengembalikan `409` untuk versi stale atau quotation yang sudah nonaktif. Contoh payload lengkap tersedia di Swagger pada tag `Quotations`.

Verifikasi database lokal: `npm run test:quotation` dan `npm run test:quotation-http`. Harness memakai branch UUID khusus dan membersihkan hanya fixture miliknya setelah pengujian. Pengujian HTTP memakai router asli dengan konteks user terautentikasi yang diinjeksi; tidak menguji ulang JWT/Gateway.

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

### Inspection scope

Service menggunakan relasi dan field request/response `inspectionScopes` (sebelumnya `scopes`).
POST `/services/:serviceId/inspection/scopes` menerima `{ "inspectionScope": "Visual inspection" }`.
Response detail memuat `inspectionScopes: [{ id, serviceId, inspectionScope, ... }]`, sedangkan response daftar memuat `inspectionScopes` sebagai teks dipisahkan koma.
DELETE `/services/:serviceId/inspection/scopes/:inspectionScopeId` menonaktifkan inspection scope.
Audit menggunakan `INSPECTION_SCOPE_ADD` dan `INSPECTION_SCOPE_REMOVE`; snapshot lama tetap dapat dibaca.

Sinkronkan database development langsung melalui Prisma tanpa file SQL rename:

```sh
npm run db:push
```

Jika data development boleh dikosongkan dan menghalangi perubahan schema, gunakan `npm run db:push -- --force-reset`. Perintah ini menghapus seluruh data pada database yang dikonfigurasi, menerapkan schema terbaru, dan generate ulang Prisma Client.
