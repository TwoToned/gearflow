<div align="center">

# RVLT Flow
[![Deploy RVLT Flow](https://github.com/gearflow-app/gearflow/actions/workflows/main.yml/badge.svg)](https://github.com/gearflow-app/gearflow/actions/workflows/main.yml)

### Equipment & Rental Management for Production Companies

Stop wrestling with spreadsheets and generic inventory tools.\
RVLT Flow is built from the ground up for AV, theatre, and live event companies\
who need to track gear, manage projects, and run a warehouse — not fight their software.

[Get Started](#-getting-started) · [Features](#-what-you-get) · [Tech Stack](#%EF%B8%8F-tech-stack) · [Environment Variables](#-environment-variables)

</div>

---

## The Problem

Production companies live and die by their gear. You need to know what's available, where it is, who has it, and when it's coming back — across dozens of projects running simultaneously. Most teams end up duct-taping together spreadsheets, whiteboards, and half-forgotten text messages.

RVLT Flow replaces all of that with a single platform that handles the **entire equipment lifecycle**: from the moment gear arrives in your warehouse to the moment it's checked back in, tested, and shelved for the next show.

---

## What You Get

### Inventory That Actually Works
Track every piece of gear with auto-generated asset tags, QR codes, and full lifecycle status. Handle both **serialized assets** (individual items like a console or projector) and **bulk assets** (cables, clamps, gaff tape) with stock levels and reorder alerts. Group gear into **Kits** — road cases and racks that check out as a single unit with one scan. Attach photos, manuals, and documents to any item. Tag everything with free-form labels for fast filtering. Import and export via CSV when you need to move data in bulk.

### Project & Rental Lifecycle
Take a project from **Enquiry → Quote → Confirmed → Checked Out → On Site → Returned → Invoiced**. Add line items for equipment, labour, transport, and services with per-day, weekly, flat, or hourly pricing. Drag-and-drop line item groups keep quotes organized. Real-time **availability checking** warns you before you double-book, with reduced-stock detection for gear that's in maintenance or marked lost. Overbooking is allowed with explicit confirmation when you need to make it work anyway. Save any project as a **template** to reuse equipment lists on future shows.

### Project Services & Scheduling
Attach structured operational tasks to projects — **deliveries, pickups, bump in/out, labour calls, and more**. Each service has its own status flow, date/time, location, and crew assignments. Create service templates so your standard show workflow is one click away. Services auto-sync with line items and crew schedules.

### Crew Management
Manage your team of **employees, freelancers, contractors, and volunteers** with roles, skills, and certification tracking. Assign crew to project services and see everyone's availability on a **14-day Gantt-style planner**. Send offers, track acceptances, log timesheets with approval workflows, and generate **Call Sheet PDFs**. Each crew member gets a personal **iCal feed** they can subscribe to. Expiring certifications trigger automatic notifications.

### Warehouse Floor, Meet Your Phone
Your crew gets a **PWA with barcode scanning** — scan an asset tag, hear the chime, move on. Check out to projects, check in with condition tracking (Good / Damaged / Missing). Pull sheets give pickers an interactive checklist. Kit barcodes check out the entire container and all its contents in one scan. Conflict detection blocks checkout if an asset is already out on another project. Works on any phone with a camera — no app store required.

### Professional Documents in Seconds
Generate **Quotes, Invoices, Packing Lists, Return Sheets, and Delivery Dockets** as polished PDFs with your org logo, grouped line items, kit breakdowns, line item notes, and overbooking badges. Kit contents render as indented children across all document types. Ready to email to clients or hand to the warehouse.

### Test & Tag Compliance (AS/NZS 3760:2022)
Full equipment register with visual inspection and electrical test records — earth continuity, insulation resistance, leakage current, polarity, and RCD trip time. Track test intervals per equipment class, get notified when items are due, and generate **10 report types** including full register, overdue items, test session logs, item history, due schedule, tester activity, and compliance certificates in PDF and CSV.

### Maintenance & Repairs
Schedule and track repairs, preventative maintenance, firmware updates, inspections, and cleaning across multiple assets in a single record. Track status from Scheduled through to Completed with pass/fail/conditional results. Overdue items surface automatically in your notification center.

### Clients, Suppliers & Locations
Manage **clients** (companies, individuals, venues, production houses) with contact details, billing info, and payment terms. Keep a **supplier directory** for purchase tracking and subhire, with full purchase order workflows from draft through to received. Organize **locations** in a hierarchy — warehouses, venues, vehicles, offsite storage — with address autocomplete, **interactive maps**, and get-directions links.

### Teams & Permissions
Multi-tenant from day one. Each organization gets isolated data, configurable branding, and a role hierarchy — **Owner, Admin, Manager, Member, Viewer** — with granular permissions across 14 resource types. Two-factor authentication with backup codes, passkey support, team invitations, and a full audit trail logging every write operation. Export and import entire organizations for backup or migration.

### Dashboard & Notifications
A live dashboard shows active projects, asset counts, upcoming shows, and recent activity. The **notification center** surfaces overdue returns, upcoming projects, maintenance due, low stock alerts, pending crew offers, expiring certifications, and submitted timesheets — so nothing slips through the cracks.

### Search That Gets Out of Your Way
A global command palette searches across every entity type. Type `@` to jump to any page with drill-down into children. Type a date to open the availability calendar. Use `/` for slash commands. Full keyboard navigation with `Shift+arrows`, `Tab`, and `Escape`.

### Mobile-First PWA
Installable on iOS and Android home screens. Proper safe area handling for notch, Dynamic Island, and home indicator. Bottom navigation with quick access to Home, Assets, Scan, Projects, and Warehouse. Touch-optimized with 44px minimum tap targets and responsive tables that progressively hide columns on smaller screens.

### Site Administration
A dedicated **admin panel** for platform-wide management — create and manage organizations, promote or ban users, force-disable 2FA, configure registration policies (open, invite-only, or disabled), set global tax rates and currency, and customize platform branding with your own name, icon, and logo.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** — App Router, Turbopack |
| Language | **TypeScript** — strict mode |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Base UI primitives) |
| Database | **PostgreSQL** + **Prisma v6** |
| Auth | **Better Auth** — Organizations, 2FA, Passkeys, Admin |
| State | **React Query** + **React Hook Form** + **Zod** |
| PDF | **@react-pdf/renderer** |
| Storage | **AWS S3** / **MinIO** |
| Email | **Resend** |
| PWA | **@ducanh2912/next-pwa** |
| Maps | **Leaflet** + **React Leaflet** |

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **Docker** (recommended — for PostgreSQL & MinIO) or bring your own Postgres + S3

### 1. Clone & install

```bash
git clone https://github.com/gearflow-app/gearflow.git
cd gearflow
npm install
```

### 2. Start the database & file storage

The included Docker Compose file spins up everything you need:

```bash
cd docker-db
docker compose up -d
cd ..
```

This gives you:

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5432` | `postgres` / `postgres` / db: `gearflow` |
| MinIO (S3) | `localhost:9000` | `minioadmin` / `minioadmin` |
| MinIO Console | `localhost:9001` | Same as above |

After MinIO starts, open [localhost:9001](http://localhost:9001), log in, and **create a bucket** called `gearflow-uploads`.

### 3. Configure your environment

Create a `.env` file in the project root. Here's a working local setup:

```env
# ── Database ──────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gearflow"

# ── Auth ──────────────────────────────────────────────────
BETTER_AUTH_SECRET="change-me-to-a-random-64-char-string"
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# ── File Storage (MinIO) ─────────────────────────────────
S3_BUCKET="gearflow-uploads"
S3_REGION="ap-southeast-2"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_ENDPOINT="http://localhost:9000"

# ── Email ─────────────────────────────────────────────────
RESEND_API_KEY="re_your_api_key"
EMAIL_FROM="onboarding@resend.dev"

# ── Admin Bootstrap ───────────────────────────────────────
SITE_ADMIN_REGISTRATION_ENABLED="true"
SITE_ADMIN_SECRET_TOKEN="pick-a-secret-token"
```

> **Tip:** Get a free Resend API key at [resend.com](https://resend.com). During development you can use their sandbox domain.

### 4. Set up the database

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Launch

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) and register your first account.

To make yourself a **site admin**, visit:
```
http://localhost:3000/register/admin?token=pick-a-secret-token
```
(Use whatever token you set in `SITE_ADMIN_SECRET_TOKEN`.)

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Session encryption key — use a long random string |
| `BETTER_AUTH_URL` | Base URL for auth callbacks (`http://localhost:3000` for dev) |
| `NEXT_PUBLIC_APP_URL` | Public-facing app URL |
| `S3_ACCESS_KEY_ID` | S3 or MinIO access key |
| `S3_SECRET_ACCESS_KEY` | S3 or MinIO secret key |
| `S3_BUCKET` | Storage bucket name |
| `S3_REGION` | S3 region (default: `ap-southeast-2`) |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) |
| `EMAIL_FROM` | Sender email address |

### Optional

| Variable | Description |
|---|---|
| `S3_ENDPOINT` | Custom S3 endpoint — set for MinIO, omit for AWS |
| `S3_PUBLIC_URL` | Public URL for uploaded files |
| `UPLOAD_MAX_SIZE_MB` | Max file upload size (default: `50`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth login |
| `PASSKEY_RP_ID` | WebAuthn relying party ID |
| `PLATFORM_NAME` | Custom platform display name |
| `SITE_ADMIN_REGISTRATION_ENABLED` | Enable admin registration route (`true` / `false`) |
| `SITE_ADMIN_SECRET_TOKEN` | Token for `/register/admin?token=...` |

---

## Development Commands

```bash
npm run dev                              # Dev server with Turbopack
npm run build                            # Production build + type check
npm run lint                             # ESLint

npx prisma migrate dev --name <name>     # Create + apply a migration
npx prisma generate                      # Regenerate Prisma client
npx prisma studio                        # Browse your data in the browser
```

### Project Structure

```
src/
├── app/
│   ├── (auth)/            # Login, register, onboarding
│   ├── (app)/             # Main app behind auth
│   │   ├── dashboard/     # Overview & activity
│   │   ├── assets/        # Inventory management
│   │   ├── projects/      # Rental lifecycle
│   │   ├── warehouse/     # Check out / check in
│   │   ├── kits/          # Container management
│   │   ├── maintenance/   # Repairs & scheduling
│   │   ├── test-and-tag/  # Compliance testing
│   │   ├── clients/       # Client directory
│   │   ├── suppliers/     # Vendor directory
│   │   ├── crew/          # Crew management
│   │   ├── reports/       # Analytics & reporting
│   │   └── settings/      # Org config & team
│   └── (admin)/           # Site admin panel
├── components/            # React components
├── lib/                   # Auth, validation, utilities
├── server/                # Server actions
└── generated/             # Prisma client (auto-generated)
```

---

## License

RVLT Flow is source-available under the [Business Source License 1.1](./LICENSE).

**You can** freely use, modify, and self-host RVLT Flow — including for commercial purposes (e.g., running your own rental business).

**You cannot** offer RVLT Flow as a hosted or managed service to third parties.

Each version converts to [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) four years after its release.
