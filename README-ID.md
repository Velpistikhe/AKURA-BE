# Akura — Cline + Claude Sonnet Setup

Panduan penggunaan Cline dengan Anthropic Claude Sonnet untuk pengembangan project Akura.

Setup ini dirancang untuk:

- Windows
- Visual Studio Code
- Cline
- Anthropic Claude Sonnet
- Node.js dan npm
- Express 4
- TypeScript dengan CommonJS runtime
- Enam service independen
- Repository berskala besar

Tidak memerlukan instalasi Serena, Python, uv, atau MCP server tambahan.

## 1. Arsitektur project

Akura terdiri dari enam npm service independen:

- `api-gateway`
- `auth-service`
- `app-manager-service`
- `fileservice-service`
- `finance-service`
- `marketing-service`

Tidak ada root `package.json` atau shared root npm scripts.

**Penting:**

- Jalankan perintah npm dari direktori service terkait.
- Jangan mengasumsikan seluruh service memiliki struktur internal yang sama.
- Periksa package.json service sebelum menjalankan command.
- Prisma/PostgreSQL digunakan pada domain services sesuai implementasi masing-masing.

## 2. Struktur AI context

```text
.ai-context/
├── INDEX.md
├── ARCHITECTURE.md
├── COMMANDS.md
├── DECISIONS.md
├── MODULE-MAP.md
├── PROJECT.md
└── TASK-STATE.md

.clinerules/
├── 00-core.md
├── 01-context-and-token.md
├── 02-node-express.md
├── 03-mixed-js-ts.md
├── 04-testing-and-safety.md
├── 05-memory-policy.md
└── workflows/
    ├── onboard-project.md
    ├── implement-feature.md
    ├── debug-targeted.md
    ├── refactor-safe.md
    ├── review-diff.md
    └── refresh-context.md

.project-map/
├── api-endpoints.md
├── architecture.md
├── database-schema.md
├── decisions.md
├── modules.md
├── security-model.md
├── service-dependencies.md
└── unknowns.md
```

File yang benar-benar tersedia di repository tetap menjadi acuan.

Jangan membuat ulang file yang sudah ada hanya karena tidak tercantum pada contoh struktur ini.

## 3. Fungsi setiap direktori

### `.clinerules/`

Berisi aturan perilaku Cline:

- Batasan penggunaan konteks dan token.
- Konvensi Node.js dan Express.
- Aturan JavaScript dan TypeScript.
- Validasi dan keamanan.
- Kebijakan project memory.
- Workflow pengembangan.

Rules inti diterapkan sesuai konfigurasi Cline. Workflow digunakan ketika tugas membutuhkannya.

### `.ai-context/`

Berisi ringkasan arsitektur dan navigasi project.

Prinsip:

- Baca INDEX.md terlebih dahulu.
- Baca hanya halaman yang relevan.
- Gunakan source code sebagai acuan utama.
- Jangan menyalin seluruh source code ke memory.
- Perbarui memory hanya untuk perubahan yang berdampak jangka panjang.

### `.project-map/`

Berisi peta modul, endpoint, database, keamanan, dan dependensi service.

Gunakan sebagai petunjuk navigasi, bukan pengganti verifikasi implementasi.

## 4. Setup Cline

1. Buka root repository Akura di Visual Studio Code.
2. Pastikan extension Cline tersedia.
3. Konfigurasikan provider Anthropic.
4. Masukkan API key Anthropic melalui pengaturan provider.
5. Pilih model Claude Sonnet yang tersedia pada akun/provider.
6. Pastikan Cline dapat membaca workspace dan `.clinerules/`.

Jangan menyimpan API key di repository atau file project yang di-commit.

Tidak perlu mengonfigurasi Serena atau MCP tambahan.

## 5. Workflow sehari-hari

Gunakan workflow yang sesuai dengan tugas:

| Tugas                      | Workflow            |
| -------------------------- | ------------------- |
| Memahami project           | `onboard-project`   |
| Implementasi fitur         | `implement-feature` |
| Debugging                  | `debug-targeted`    |
| Refactoring                | `refactor-safe`     |
| Review perubahan           | `review-diff`       |
| Memperbarui project memory | `refresh-context`   |

Contoh permintaan:

```text
Gunakan workflow implement-feature.

Pada finance-service, periksa alur pembuatan invoice.
Identifikasi route, controller, service, dan persistence
yang relevan sebelum membuat perubahan.

Gunakan pencarian terarah.
Jangan membaca seluruh repository.
Jangan mengubah service lain tanpa alasan teknis.
```

## 6. Command dan validasi

Command yang tersedia harus diperiksa dari package.json service terkait.

Command yang telah diverifikasi:

```powershell
npm ci
npm run dev
npm run build
npm start
npm run typecheck
```

Jalankan dari direktori service yang sesuai.

Catatan:

- `npm run dev` menggunakan `tsx watch`.
- `npm run build` menggunakan TypeScript compiler dan proses build terkait.
- `npm run typecheck` menjalankan `tsc --noEmit`.
- Tidak ada test, lint, atau format script yang terverifikasi tersedia.

Jangan mengasumsikan `npm test` atau `npm run lint` tersedia.

### Database

- Jangan menjalankan `npm run db:push` otomatis.
- Perintah tersebut dapat mengubah schema database.
- Jangan menjalankan database mutation pada production.
- Minta persetujuan sebelum melakukan perubahan database.

## 7. Token efficiency

Untuk menghemat token:

1. Mulai dari `.ai-context/INDEX.md`.
2. Identifikasi service pemilik fitur.
3. Baca maksimal 1–2 halaman memory yang relevan.
4. Cari symbol atau file target secara spesifik.
5. Periksa direct callers dan dependency yang benar-benar dibutuhkan.
6. Hindari full repository scan.
7. Hindari mengulang pembacaan file yang tidak berubah.
8. Periksa diff sebelum menyelesaikan tugas.

Jangan mengorbankan verifikasi kode hanya demi mengurangi token.

## 8. Serena dan MCP

Serena tidak menjadi dependensi setup ini.

Jika Serena tidak tersedia:

- Gunakan pencarian workspace bawaan Cline.
- Gunakan navigasi symbol VS Code.
- Gunakan pencarian references dan definisi.
- Gunakan Git untuk memeriksa perubahan.

Jangan memasang Python, uv, Serena, atau runtime tambahan secara otomatis.

## 9. Keamanan

- Jangan commit `.env`, API key, token, private key, atau credential.
- Jangan mengaktifkan auto-approve global untuk edit dan terminal.
- Periksa command sebelum menyetujui eksekusi.
- Periksa git diff sebelum menyelesaikan perubahan.
- Jangan mengubah dependency tanpa persetujuan.
- Jangan menjalankan database mutation tanpa persetujuan.
- Jangan mengubah kontrak API tanpa alasan dan persetujuan yang sesuai.

## 10. Prinsip utama

Cline membantu memahami dan mengubah Akura secara terarah.

Namun:

- Source code tetap menjadi sumber kebenaran.
- Memory adalah panduan, bukan fakta yang tidak boleh diperiksa.
- Setiap service memiliki batas tanggung jawab sendiri.
- Perubahan harus sekecil mungkin dan tetap kompatibel.
- Validasi harus menggunakan command yang benar-benar tersedia.
- Tidak boleh ada instalasi atau perubahan berisiko tanpa persetujuan.
