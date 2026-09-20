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

POST item dan size hanya menerima referensi, tanpa harga. POST item menerima `serviceId`, `name`, dan `sizes: [{ size }]` opsional; POST size menerima `itemId`, `itemVersion`, dan `size`. Harga dibuat terpisah melalui POST `/items/sizes/:itemSizeId/price`, menggunakan referensi size yang sama. Response daftar size tetap menyertakan harga untuk memudahkan pemilihan; sebelum harga dibuat nilainya null dan `priceStatus=UNAVAILABLE`. Harga kontrak company disimpan terpisah pada `company_contract_prices`; PATCH company mempertahankan seluruh ID kontrak dan harga yang terhubung tanpa menyalin atau mengubahnya.

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
| `/items` | POST | Membuat referensi item dan size opsional secara atomik, tanpa harga |
| `/items/sizes` | POST | Menambahkan referensi size; body wajib berisi `itemId`, `itemVersion`, dan `size` |
| `/items/sizes/:itemSizeId` | DELETE | Menonaktifkan satu item size dan menutup periode harga standar tanpa menonaktifkan item induk atau harga kontrak |
| `/items/:itemId` | DELETE | Menonaktifkan item, seluruh size aktif, dan harga standar; harga kontrak dipertahankan |

PATCH item tersedia untuk mengubah nama. Label size tidak dapat diubah; perubahan daftar size dilakukan dengan menambah referensi baru atau soft delete size lama. PATCH dan DELETE wajib mengirim `version` resource terbaru; POST penambahan size wajib `itemVersion` parent terbaru. Versi stale menghasilkan `409`. Perubahan harga menaikkan versi size dan item; perubahan contract price juga menaikkan versi kontrak. Semua operasi katalog menggunakan satu urutan lock branch bersama operasi company dan service, transaksi atomik, compare-and-swap, dan audit before/after pada `catalog_audit_logs`. API audit hanya menyediakan pembacaan; aplikasi selalu menambahkan snapshot baru tanpa mengubah atau menghapus snapshot lama. Soft delete item/size hanya menutup harga standar aktif; harga kontrak dipertahankan dan riwayat yang sudah nonaktif tetap utuh.

Saat POST harga, harga service primary, sister company, dan contract wajib dikirim; tidak memiliki default `0`. Nilai negatif, null untuk service price, boolean, string kosong, dan lebih dari dua desimal ditolak (`400`). Gunakan string desimal untuk nominal besar. Nilai `0` eksplisit valid. Maintenance price boleh null kecuali service memiliki maintenance, saat itu harga maintenance wajib lengkap. GET harga yang hilang tidak membuat harga nol: GET detail price mengembalikan `404`, daftar size mengembalikan `priceStatus=UNAVAILABLE` dan harga null.

`Item` dan `ItemSize` menggunakan `activeKey` internal yang dinormalisasi (Unicode NFKC, spasi, huruf kecil). Unique key `(serviceId, activeKey)` dan `(itemId, activeKey)` mencegah duplikasi referensi aktif. Soft delete mengosongkan activeKey agar nama dapat digunakan kembali dengan ID baru. `ItemSize` mempertahankan periode dan constraint `(itemId, size, effectiveFrom)` untuk histori reuse. `ItemPrice` tetap satu row per size dan `CompanyContractPrice` satu row per `(contractId, itemSizeId)`; setiap revisi disimpan sebagai snapshot audit immutable, bukan menimpa histori. Harga standar mendukung PATCH parsial: wajib `version` dan minimal satu field; nilai yang tidak dikirim dipertahankan. Harga standar nonaktif dapat diaktifkan kembali dengan `isActive=true` dan versi terbaru selama item serta size aktif. Harga kontrak tetap memerlukan field harga pada PATCH.

### Kontrak company dan pemilihan harga

Respons company (list, detail, create, update, delete) memiliki field `contract`: objek kontrak berstatus ACTIVE dan isActive=true, atau `null`. Contract ini dapat memiliki masa berlaku yang akan datang; pemilihan harga tetap memakai periode `effectiveFrom <= hari ini < effectiveUntil`. Kontrak nonaktif dan company revoked tidak menghasilkan contract pada respons. Ini adalah field hasil perhitungan, bukan kolom baru. CRUD kontrak tersedia melalui `/api/v1/marketing/company-contracts`: POST membuat, GET dengan `companyId` menampilkan daftar, serta GET/PATCH/DELETE `/:contractId` untuk detail, perubahan periode, dan penonaktifan. PATCH dan DELETE wajib membawa `version` kontrak terbaru.

Company memiliki `isSisterCompany` (default false). Field `hasContract` sudah dihapus dari database, input, response, filter dan sort. Keberadaan kontrak ditentukan dari tabel `company_contracts`. `effectiveFrom` inklusif dan `effectiveUntil` eksklusif serta wajib diisi; akhir harus setelah awal. Ketiga tanggal kontrak (`contractDate`, `effectiveFrom`, `effectiveUntil`) memakai format `YYYY-MM-DD`. Kontrak aktif yang belum mulai atau sudah berakhir tidak dipakai untuk harga saat ini.

| Endpoint | Method | Input utama |
|---|---|---|
| `/company-contracts` | GET | `companyId` wajib; opsional `isActive`, `page`, `limit` |
| `/company-contracts` | POST | `companyId`, `contractNumber`, `contractDate`, `effectiveFrom`, `effectiveUntil` |
| `/company-contracts/:contractId` | GET / PATCH / DELETE | PATCH: `version` dan field kontrak/tanggal yang diubah; DELETE: `version` |
| `/items/:itemId` | PATCH | `version`, `name` |
| `/items/sizes/:itemSizeId` | GET / DELETE | DELETE: `version`; label size tidak dapat diubah |
| `/items/sizes/:itemSizeId/price` | GET / POST / PATCH / DELETE | Harga standar; PATCH/DELETE: versi harga |
| `/items/sizes/:itemSizeId/contract-prices` | POST / PUT | `contractId`, `priceService`, `priceMaintenance` |
| `/items/contract-prices/:contractPriceId` | PATCH / DELETE | Harga kontrak; PATCH/DELETE: versi harga |
| `/items/:itemId/history` | GET | History item dan seluruh size/harganya; `page`, `limit` |
| `/items/sizes/:itemSizeId/history` | GET | History size dan harganya; `page`, `limit` |
| `/items/sizes/:itemSizeId/price/history` | GET | History harga standar; `page`, `limit` |
| `/items/sizes/prices` | GET | `companyId` wajib; filter/sort/pagination sama dengan GET size |

Contoh endpoint harga: `/api/v1/marketing/items/sizes/prices?companyId=<UUID>&itemName=pipe&sortBy=size&sortOrder=asc`.

Quotation options (`GET /items/sizes/prices?companyId=...`) menampilkan katalog aktif yang tidak tercantum dalam kontrak ACTIVE dan berlaku saat ini milik company terpilih di cabang pengguna. Keanggotaan kontrak tetap mengecualikan size meskipun harga kontraknya nonaktif. Kontrak company/cabang lain tidak mengecualikan size. Harga option, create quotation, dan repricing item PATCH hanya PRIMARY atau SISTER_COMPANY berdasarkan isSisterCompany, tidak pernah harga kontrak. Snapshot quotation lama tetap dipertahankan. Filter membership berlaku pada options; itemSizeId yang dikirim langsung ke create tetap divalidasi katalog/harga standar dan tidak menggunakan harga kontrak.

### Status kontrak dan template Excel

`CompanyContract.status` memakai enum `CREATE`, `ACTIVE`, `EXPIRED`, `TERMINATED`, tetapi tidak diterima pada request POST maupun PATCH. POST oleh user membuat status `CREATE`; POST oleh ADMIN/APP_MANAGER membuat status `ACTIVE`. Admin dapat mengaktifkan kontrak CREATE lewat `POST /company-contracts/:contractId/approve`. PATCH hanya untuk admin dan merupakan revisi: kontrak lama menjadi `TERMINATED`, `isActive=false`, `effectiveUntil` diisi timestamp revisi, lalu kontrak ACTIVE pengganti dibuat. Scheduler berjalan setiap hari pukul 00:00:00 menurut timezone server untuk mengubah kontrak yang melewati `effectiveUntil` menjadi `EXPIRED` dan `isActive=false`. DELETE menetapkan `TERMINATED`. Filter daftar: `GET /company-contracts?companyId=<UUID>&status=CREATE`.

Status kontrak ditentukan oleh business logic saat kontrak dibuat atau diubah berdasarkan periode berlaku. Harga kontrak hanya dipakai jika status `ACTIVE`, `isActive=true`, dan tanggal berlaku sesuai. CREATE dapat diisi harga sebelum periode berlaku. EXPIRED/TERMINATED menolak perubahan dan impor harga. Benturan periode diperiksa saat kontrak berstatus ACTIVE. DELETE menetapkan TERMINATED dan isActive=false. Revisi profil company mempertahankan kontrak beserta status dan versinya.

Download template: `GET /api/v1/marketing/items/sizes/export`. Respons berupa file `akura-normal-prices.xlsx`, berisi Service, Item, Size, Service Price, dan Maintenance Price normal primary. Harga sister company dan harga kontrak tidak diekspor. Filter opsional: `companyId`, `itemId`, `itemName`, `serviceName`, `size`, `notIn`, `sortBy=size`, `sortOrder`; maksimal 2000 row tanpa pagination. Branch diambil dari token. Jika `companyId` dikirim, company harus belum revoked dan berada pada branch token yang sama; jika tidak, respons 404. Item dan service dibatasi ke branch tersebut. Tanpa `companyId`, ekspor langsung memakai branch token. `officeBranchId` dari query tidak diterima.

Template berbahasa Inggris, termasuk sheet `Instructions`. Item dengan maupun tanpa service ikut diekspor; item tanpa service memiliki kolom Service kosong dan tetap dapat memiliki harga kontrak. Urutan default: nama service ? nama item ? size ? ID ascending, dengan NULLS LAST PostgreSQL. Item tanpa service berada di bagian bawah, diurutkan berdasarkan nama item, size, lalu ID ascending. `sortBy=size` mengesampingkan urutan default.

Worksheet diproteksi dan hanya kolom `Service Price` serta `Maintenance Price` yang dapat diedit. Tidak ada kolom pilihan YES/NO: seluruh baris item dalam file diproses saat upload. Gunakan filter download untuk membatasi item. Harga normal yang tidak tersedia dibiarkan kosong dan wajib dilengkapi sebelum upload. Hanya `Item Size ID` dan `Size Version` yang disimpan sebagai kolom tersembunyi; `Price Version` tidak dibuat atau dibaca.

Upload melalui `POST /api/v1/marketing/company-contracts/:contractId/prices/import` dengan multipart/form-data: `file` (.xlsx maksimal 5 MB), `companyId`, dan `version` kontrak terbaru. Kontrak harus ACTIVE, isActive=true, dan sedang berlaku. Semua baris disimpan atomik sebagai harga kontrak baru tanpa mengubah harga normal. Service Price wajib; Maintenance Price wajib hanya jika service memiliki maintenance, dan opsional untuk item tanpa service. Duplikasi, template dari branch lain, formula harga, serta harga invalid ditolak sebelum penyimpanan. Perubahan `Size Version` menghasilkan 409 dan mengharuskan download ulang; perubahan harga normal tidak menyebabkan stale upload. Versi kontrak tetap divalidasi. Template format lama harus diunduh ulang. Respons sukses berisi `companyId`, `contractId`, `version` terbaru, dan jumlah `imported`.


Verifikasi download, upload, dan status: `npm run test:contract-excel`.

### Sinkronisasi database development

Jalankan `npm run db:push` untuk menyinkronkan schema dan generate Prisma Client. Tidak ada script SQL validasi tambahan. Validasi input berjalan melalui middleware/controller sebelum penyimpanan. Pemeriksaan yang membaca data, seperti size duplikat dan benturan periode kontrak, dilakukan oleh kode aplikasi dalam transaksi yang dipanggil controller dengan lock branch agar aman terhadap request bersamaan. Audit hanya memiliki endpoint baca; penulisan aplikasi selalu menambahkan snapshot baru.

Primary key, foreign key, tipe kolom, dan unique key relasi/histori tetap didefinisikan pada `schema.prisma`. Database tidak memasang CHECK bisnis, exclusion constraint, partial unique index size aktif, atau trigger audit. Perubahan langsung melalui SQL tidak melewati validasi aplikasi.

Jika data development menghalangi perubahan schema, gunakan `npm run db:push -- --force-reset` untuk menghapus data dan membuat ulang schema. Tidak ada pemindahan data legacy atau pembuatan baseline audit.

Tes: `npm run test:catalog-pricing`, `npm run test:item-size-list`, dan `npm run test:item-size-reuse`. Tes menggunakan router asli dengan auth context yang diinjeksi, menguji PostgreSQL sungguhan, dan membersihkan fixture. Audit fixture tetap tersimpan sesuai aturan append-only.

## Quotation

`revision` dimulai dari 0 dan hanya bertambah ketika isi quotation approved direvisi. PATCH membuat dan mengembalikan quotation baru dengan ID baru, version=0, revision=lama+1, previousQuotationId=ID lama, status=REVISED, no=null, numberYear=null, dan pdfDocument=null. Quotation lama menjadi nonaktif tanpa mengubah isi, item, nomor, atau relasi PDF historis. Edit draft tidak menambah revision. Frontend wajib memakai ID/version yang dikembalikan PATCH. Approval revisi memakai nomor/tahun lama (contoh Q-1734 R1), tanpa menghabiskan nomor baru.

`quotations` menyimpan field dokumen: `no`, `numberYear`, `date`, `inquiryMethod`, `inquiryDate`, `subject`, `termOfPayment`, `validity`, `tax`, `supplyAkura`, `supplyCustomer`, `location`, `accomplished`, `deliveryReports`, `deliveryInvoice`, `staffId`, `status`, `invoiceStatus`, `subTotal`, `taxAmount`, dan `total`. `deliveryInvoice` opsional dan nullable; nilainya dapat dikirim saat create maupun update. `date` boleh kosong untuk draft. `no` dan `numberYear` otomatis dari server dan tidak diterima pada create/update. Draft memiliki no=null dan numberYear=null sampai approved. Nomor unik berdasarkan `(officeBranchId, numberYear, no, revision)`. `inquiryMethod` menggunakan enum `EMAIL`, `WHATSAPP`, `VERBAL`, atau `JOB_ORDER_REQUEST`. `status` dan `invoiceStatus` dikelola server dan hanya ditampilkan pada response. POST selalu menetapkan status CREATED dan invoiceStatus null. POST/PATCH umum menolak kedua field tersebut dengan 400, termasuk nilai null atau nilai default. Perubahan status berikutnya harus melalui business logic server, bukan input bebas dari frontend.

`quotation_sequences` menyimpan lastNumber per cabang/tahun approval (Asia/Jakarta). Create draft tidak menggunakan nomor. Approval pertama mengunci counter, memberi nomor, menghasilkan serta mengupload PDF, lalu menyimpan status APPROVED, metadata PDF, counter dan history dalam satu transaksi (timeout 60 detik). Kegagalan upload atau database me-rollback nomor sehingga tidak ada nomor terbuang. Revisi memakai nomor/tahun sebelumnya tanpa menaikkan counter. Nomor historis tidak digunakan ulang. File upload dari transaksi gagal dibersihkan hanya setelah dipastikan tidak terdaftar di metadata.

`quotation_items` menyimpan referensi item size, snapshot nama service/tipe service/nama item/ukuran, quantity, harga satuan, dan subtotal. Quantity inspection dan maintenance menggunakan Decimal(18,3), nominal Decimal(18,2). Input quantity berupa string desimal; harga dipilih oleh server. `tax` diperlakukan sebagai persentase integer 0–100. Subtotal dibulatkan ke dua desimal per baris; subtotal quotation adalah jumlah baris aktif, pajak dihitung dari subtotal, dan total adalah subtotal + pajak. Nominal total dihitung oleh repository, tidak diterima dari input.

`createdById`/`updatedById` pada quotation dan item menyimpan ID user Auth Service tanpa foreign key lintas database. Pembuat diisi dari actor terautentikasi; pengubah bernilai null sampai record diubah. `customerSnapshot` berupa string yang hanya menyimpan nama company staff saat quotation dibuat atau kontak diganti. Perubahan nama staff sesudahnya tidak mengubah snapshot yang sudah tersimpan.

Seluruh perubahan dilakukan melalui `quotationRepository`: `create`, `update`, dan `deactivate`. Update/deactivate wajib menyertakan `version` quotation terakhir. Compare-and-swap atomik menaikkan versi dan mengunci parent sebelum perubahan item; request stale/inactive mendapat `HttpError(409)`. Semua perubahan header, item, perhitungan total, dan snapshot riwayat berada dalam satu transaksi. Kegagalan membatalkan seluruh transaksi. Jangan melakukan write langsung ke quotation/item lewat Prisma karena akan melewati kontrol versi dan audit repository.

Saat `items` dikirim pada update, array menjadi daftar lengkap item aktif: sertakan `id` untuk mempertahankan baris, hilangkan `id` untuk menambah baris, dan baris lama yang tidak dikirim dinonaktifkan. Referensi katalog baris existing tidak dapat diganti; buat baris baru. Snapshot baris existing tetap utuh meskipun katalog berubah. Update header tanpa `items` mempertahankan baris sebelumnya.

`quotation_histories` menyimpan snapshot lengkap header dan seluruh baris setiap versi (termasuk baris nonaktif), actor, waktu, dan aksi CREATE/UPDATE/DEACTIVATE. Pasangan quotation/version unik. Repository hanya menambahkan riwayat, tidak mengubah atau menghapusnya. Relasi menggunakan `Restrict` untuk mencegah penghapusan berantai dokumen/riwayat akibat penghapusan data referensi. Deactivate menggunakan soft delete.

Endpoint melalui Gateway (akses Marketing dan office branch wajib):

| Endpoint | Method | Fungsi |
|---|---|---|
| `/api/v1/marketing/quotations` | GET | Daftar seluruh quotation dan item (aktif maupun nonaktif) dalam branch pengguna, `page` minimal 1 dan `limit` 1–100 (default 20), urut terbaru |
| `/api/v1/marketing/quotations/:quotationId` | GET | Detail quotation aktif dari branch pengguna |
| `/api/v1/marketing/quotations` | POST | Membuat quotation dan array `items` (1–100 baris) secara atomik |
| `/api/v1/marketing/quotations/:quotationId` | PATCH | Update header dan/atau daftar item; wajib `version` terbaru dan minimal satu field perubahan |
| `/api/v1/marketing/quotations/:quotationId` | DELETE | Soft delete quotation beserta item aktif; body wajib `{ "version": 0 }` sesuai versi terbaru |

GET daftar menampilkan quotation aktif maupun nonaktif beserta seluruh itemnya, dibatasi branch pengguna; pagination menghitung keduanya. Gunakan isActive untuk membedakan status. GET detail tetap tidak menampilkan quotation nonaktif. DELETE mempertahankan row dan histori, menambah versi, serta mengembalikan `409` untuk versi stale atau quotation yang sudah nonaktif. Contoh payload lengkap tersedia di Swagger pada tag `Quotations`.

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

### Audit dan pengujian item

History menampilkan `entityType`, `entityId`, `action`, `actionLabel`, `version`, `changedBy`, `changedAt`, dan `changes` berisi label bahasa Inggris serta nilai before/after. Histori tetap tersedia setelah soft delete dan dibatasi branch token. Pagination memakai snapshot database konsisten, urut waktu kemudian ID. Endpoint tidak menyediakan edit/hapus audit.

Soft delete item menonaktifkan seluruh size aktif dan harga standar terkait, tetapi mempertahankan harga kontrak, snapshot, status, serta versi kontrak. Soft delete service juga menonaktifkan harga standar terkait tanpa mengubah kontrak. Soft delete size tidak menonaktifkan item; versi item tetap naik sebagai penanda perubahan turunannya. Cascade menulis perubahan dan audit dalam transaksi yang sama, memproses penonaktifan secara batch, tanpa membuat atau merevisi kontrak otomatis. Kontrak hanya dibuat atau direvisi user setelah kesepakatan kedua pihak. Lock branch dipertahankan agar interoperabel dengan import Excel dan perubahan kontrak; penulisan pada branch yang sama tetap diserialisasi.

Jalankan `npm run test:catalog-pricing` untuk uji PostgreSQL melalui router Express (auth diinjeksi), termasuk duplikasi paralel, stale version, PATCH parsial, rollback saat audit gagal, isolasi branch, cascade, reuse, history, dan stress. Hasil tersimpan di `tests/reports/item-catalog.json`. Default 30 item, concurrency 12; `CATALOG_STRESS_ITEMS` dapat diatur 1?200. Fixture dibersihkan setelah tes. Angka latency merupakan pengukuran lokal, bukan jaminan kapasitas produksi.

### Snapshot kontrak dan option quotation

`CompanyContractPrice.catalogSnapshot` adalah JSON wajib: `serviceName`, `serviceType`, `itemName`, `size`, dan `hasMaintenance`. POST harga kontrak maupun import Excel mengisinya dari katalog aktif dalam transaksi yang sama. PATCH harga tidak menyegarkan snapshot. Nominal tetap memakai kolom Decimal, dan `itemSizeId` tetap menjadi referensi.

GET `/items/sizes/prices?companyId=<UUID>` memilih harga berdasarkan perusahaan dan branch pengguna: kontrak berlaku per size, lalu sister company atau primary untuk size di luar kontrak. Response tetap berisi `company`, `sizes`, dan `pagination`. Size menampilkan `priceInspection` (alias `priceService`) serta `priceMaintenance`. Harga maintenance null berarti tidak tersedia. Metadata dan snapshot katalog tetap tersedia; frontend tidak perlu mengirimnya kembali. Parameter `exclude` tetap berlaku.

Create quotation dapat mengirim `companyId` tanpa kontak. `staffId` opsional; jika dikirim bersama companyId, kontak harus berasal dari perusahaan yang dipilih. StaffId saja masih diterima untuk kompatibilitas pemilihan perusahaan melalui kontak. Company/contact harus aktif dan dalam branch pengguna.

Setiap baris `items` mengirim `{ "itemSizeId": "<UUID>", "quantityInspection": "2", "quantityMaintenance": "0" }`. Maintenance boleh dihilangkan dan dianggap 0. Quantity menerima angka atau string desimal nonnegatif dengan maksimal 12 digit integer dan 3 desimal; null, boolean, negatif, dan kedua quantity nol ditolak. Satu size hanya boleh muncul sekali. Minimal salah satu quantity positif.

Backend mengambil harga terkini dalam transaksi dengan lock branch, menyimpan kedua quantity, `priceInspection`, `priceMaintenance`, metadata sumber harga (`priceSelection`), dan snapshot identitas. Client tidak mengirim unitPrice, priceKind, priceSelection atau harga. Harga inspection harus tersedia; maintenance positif memerlukan dukungan maintenance dan harga maintenance tersedia. Maintenance kosong/0 tetap diizinkan jika harga maintenance tidak tersedia. Harga quotation hanya normal/sister; katalog dan harga standar wajib tersedia.

Subtotal baris adalah inspection quantity ? inspection price ditambah maintenance quantity ? maintenance price; tiap komponen dibulatkan ke dua desimal sebelum dijumlahkan. Pajak/total dihitung server. PATCH yang menyertakan items menyegarkan harga seluruh baris yang dikirim. PATCH header/status tanpa items mempertahankan snapshot harga. Mengganti perusahaan/kontak mewajibkan daftar item lengkap. Update/delete tetap memakai version quotation. Riwayat dan snapshot dokumen Finance/Field Service yang sudah dibuat tidak ditulis ulang.

Schema menggunakan nama Prisma `quantityInspection` dan `priceInspection` dengan mapping ke kolom lama quantity/unit_price, ditambah quantity_maintenance dan price_maintenance. Setelah db:push pada lingkungan yang memiliki data lama, jalankan `node scripts/upgrade-quotation-quantities.cjs` sebelum menjalankan versi baru. Script idempotent memindahkan baris maintenance lama ke kolom maintenance tanpa mengubah subtotal; historical JSON snapshots mempertahankan format aslinya. Database lokal tidak memiliki baris lama saat perubahan ini diterapkan.

Jalankan `npm run test:quotation-price-options` untuk verifikasi opsi campuran, company-only create, optional maintenance, harga terkini, snapshot historis, exclude, dan pembuatan quotation paralel.

Teks buatan sistem untuk audit memakai kode bahasa Inggris (misalnya `CREATE`, `UPDATE`, `DEACTIVATE`) dan key snapshot berbahasa Inggris. Label history juga berbahasa Inggris, termasuk saat membaca audit lama. Nilai input user seperti nama perusahaan, service, item, dan size disimpan apa adanya; aplikasi tidak menerjemahkan isi kontrak atau identitas user.

Quotation Options menerima `exclude` berisi 1-100 UUID `itemSizeId` dipisahkan koma, misalnya `/items/sizes/prices?companyId=<UUID>&exclude=<SIZE_UUID_1>,<SIZE_UUID_2>`. Frontend mengirim ID size yang sudah dipilih pada list quotation. Filter berlaku untuk harga kontrak maupun standar sebelum pagination dan perhitungan total. Hilangkan parameter jika belum ada pilihan. UUID tidak valid, nilai kosong, atau lebih dari 100 entri menghasilkan 400. Parameter lama `notIn` tetap diterima; jika keduanya dikirim, gabungan ID dikecualikan.


### Quotation references for downstream documents

GET `/quotation-references/:quotationId` exposes an active quotation snapshot to MARKETING, FINANCE, ACCOUNTING and FIELD_SERVICE users (plus ADMIN/APP_MANAGER), restricted to the authenticated branch. Finance and Field Service use it to validate quotationId/version before saving their own documents. This read-only route does not grant access to Marketing CRUD. Run `node --test tests/quotation-reference-access.cjs` after compiling to verify section and branch restrictions.
# Quotation approval PDF

`POST /api/v1/marketing/quotations/:quotationId/approve` through the gateway, with authentication and JSON body `{"version": 0}` (use the latest quotation version).

Approves active `CREATED`, `SENT`, or `REVISED` quotations within the user's branch. The PDF uses saved customer/item prices, separate inspection and maintenance quantities, stored totals, and quotation terms. The supplied TRIDAYA PDF provides the letterhead and general terms assets in `assets/quotation`; customer-specific scope descriptions, job-start estimates, contact details, and preparer names absent from quotation data are not copied from the sample. Deploy the `assets` directory alongside `dist`.

PDF metadata is stored in `quotation_pdfs`. Unique `quotation_id` enforces a single optional 1:1 relation: a quotation may have no PDF, and every PDF belongs to exactly one quotation. Metadata includes bucket/key, filename, content type, byte size, SHA-256, version/revision, approval timestamp and actor. GET detail includes inactive quotations with `data.pdfDocument` and a fresh 15-minute `data.pdf.url`; old PDF links remain attached permanently. Approval retries use the latest active version without generating another PDF.

Editing approved content creates a new draft quotation and marks the old one inactive; its content, items and PDF remain intact. The revision draft has no number until approval, when it receives the original quotation number/year. New PDF objects are stored at `quotation/{officeBranchId}/{quotationId}/r{revision}/{uuid}.pdf` inside bucket `akura`. Existing historical files retain their original keys; they are never moved or deleted by revision.

Storage uses `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and optional `AWS_S3_BUCKET` (default `akura`). No public bucket policy is required. The quotation table changes have been applied directly to the configured database. `prisma/schema.prisma` defines the structure; no separate SQL update files are maintained. For a new development database, synchronize the schema and regenerate the client:

```sh
npm run db:push
npm run db:generate
npm run build
npm run test:quotation-approval
npm run test:quotation-number
```

The approval test uses temporary database fixtures with simulated storage failures. It does not upload to the real bucket.

## Tax cache from Finance

Finance owns tax. Marketing receives authenticated `POST /internal/taxes/events` requests directly using `x-tax-sync-secret` / `TAX_SYNC_SECRET`. Events carry eventId, branch, version and complete branch tax periods. Branch replacement and version advancement are atomic. Duplicate or older versions return success without modifying cache. No tax polling scheduler runs.

Configure the Marketing receiver URL in Finance `TAX_DELIVERY_TARGETS`. Apply the Prisma schema and restart both services. Bootstrap/recover using Finance `POST /api/v1/finance/taxes/resync` for each branch. This is required when a new consumer is added or its database is restored. Existing `tax_sync_state` is retained only for migration compatibility.

Quotation creation selects the locally cached period effective on its date (or today in Asia/Jakarta), snapshots tax and taxSourceId, and returns 503 if missing. Existing quotation snapshots and revisions retain their original tax. Cache delivery is eventually consistent; invoice tax is independently validated against Finance master data.
