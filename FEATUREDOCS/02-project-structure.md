# Project Structure

```
src/
├── app/
│   ├── (auth)/           # Public pages: login, register, onboarding, invite, pending-approval
│   ├── (app)/            # Protected pages: dashboard, assets, projects, warehouse, etc.
│   ├── (designer)/       # Full-screen template designer (no sidebar layout)
│   ├── (admin)/admin/    # Site admin panel
│   ├── api/              # API routes: auth, files, uploads, documents, reports, admin
│   ├── layout.tsx        # Root layout: fonts, theme, query provider, toaster
│   └── globals.css       # Theme variables, base styles, iOS PWA fixes
├── components/
│   ├── admin/            # AdminShell, IconPicker
│   ├── assets/           # Asset/Model/BulkAsset forms, tables, QR, CSV import
│   ├── auth/             # PermissionGate
│   ├── bookings/         # Availability calendar
│   ├── clients/          # Client forms, tables
│   ├── kits/             # Kit forms
│   ├── layout/           # Sidebar, TopBar, MobileNav, CommandSearch, Notifications, UserNav, ThemeToggle
│   ├── locations/        # Location forms, tables
│   ├── maintenance/      # Maintenance form
│   ├── media/            # MediaUploader, MediaThumbnail, MediaLightbox
│   ├── projects/         # ProjectForm, LineItemsPanel, AddEquipmentDialog, documents
│   ├── providers/        # ThemeProvider, QueryProvider, BrandingProvider
│   ├── settings/         # InviteMember, MemberList, RoleManager, PermissionMatrix, template-editor/, document-template-manager
│   ├── suppliers/        # Supplier forms, tables
│   ├── test-tag/         # TestTagTable, BatchCreateDialog
│   ├── ui/               # Base components: Button, Card, Dialog, Sheet, Table, BarcodeScanner, ComboboxPicker, etc.
│   └── warehouse/        # OnlinePickList
├── generated/prisma/     # Prisma generated client (do NOT edit)
├── hooks/                # use-mobile.ts
├── lib/
│   ├── auth.ts           # Better Auth server config
│   ├── auth-client.ts    # Better Auth client
│   ├── auth-server.ts    # getSession, requireSession, requireOrganization
│   ├── admin-auth.ts     # requireSiteAdminApi
│   ├── single-org.ts     # getTheOrg (cached singleton), invalidateOrgCache
│   ├── org-context.ts    # getOrgContext, orgWhere, requireRole, requirePermission
│   ├── permissions.ts    # rolePermissions map, hasPermission, Resource type
│   ├── prisma.ts         # Singleton Prisma client
│   ├── serialize.ts      # Decimal → number conversion for client
│   ├── storage.ts        # S3/MinIO: uploadToS3, getFromS3, deleteFromS3
│   ├── email.ts          # Resend SDK wrapper
│   ├── availability.ts   # computeOverbookedStatus (batch)
│   ├── media-utils.ts    # resolveModelPhotoUrl, resolveAssetPhotoUrl
│   ├── page-commands.ts  # PAGE_COMMANDS for @ navigation
│   ├── platform.ts       # getPlatformName, getSiteSettings
│   ├── use-permissions.ts    # Client-side useCurrentRole hook
│   ├── use-platform-name.ts  # Client-side usePlatformName, usePlatformBranding
│   ├── use-table-preferences.ts  # localStorage per-table sort/page/view
│   ├── validations/      # Zod schemas: asset, model, kit, project, client, etc.
│   ├── pdfme/            # pdfme PDF generation: plugins, templates, fonts, types, sample data, template settings
│   ├── org-export.ts     # Organization ZIP export
│   ├── org-import.ts     # Organization ZIP import
│   └── org-transfer-types.ts  # Export manifest types
├── server/               # Server actions (all "use server")
│   │
│   │  # ── Assets & Models ──
│   ├── assets.ts             # Serialized asset CRUD
│   ├── asset-accessories.ts  # Asset accessory assignments
│   ├── asset-media.ts        # Asset photo/document management
│   ├── bulk-assets.ts        # Bulk asset CRUD
│   ├── models.ts             # Equipment model CRUD
│   ├── model-accessories.ts  # Model default accessory config
│   ├── model-media.ts        # Model photo management
│   │
│   │  # ── Categories, Locations & Tags ──
│   ├── categories.ts         # Category CRUD + nested tree
│   ├── category-slots.ts     # Category slot rules
│   ├── locations.ts          # Location CRUD
│   ├── location-media.ts     # Location photo management
│   ├── tags.ts               # Org-wide tag autocomplete
│   │
│   │  # ── Check Items ──
│   ├── check-items.ts        # Model/kit check item CRUD
│   ├── check-records.ts      # Check record CRUD
│   │
│   │  # ── Clients & Suppliers ──
│   ├── clients.ts            # Client CRUD
│   ├── client-media.ts       # Client photo management
│   ├── suppliers.ts          # Supplier CRUD (paginated, with orders/assets/subhires)
│   ├── supplier-orders.ts    # Supplier order CRUD + items
│   │
│   │  # ── Crew ──
│   ├── crew.ts               # Crew member CRUD
│   ├── crew-assignments.ts   # Project crew assignments
│   ├── crew-availability.ts  # Crew availability management
│   ├── crew-calendar.ts      # Crew calendar views
│   ├── crew-communication.ts # Crew messaging/in-app
│   ├── crew-dashboard.ts     # Crew member dashboard
│   ├── crew-time.ts          # Crew timesheets
│   │
│   │  # ── Kits ──
│   ├── kits.ts               # Kit CRUD + item management
│   ├── kit-media.ts          # Kit photo management
│   │
│   │  # ── Maintenance & Damage ──
│   ├── maintenance.ts        # Maintenance record CRUD
│   ├── damage.ts             # Damage reporting
│   │
│   │  # ── Notifications ──
│   ├── notifications.ts          # Notification generation
│   ├── notification-preferences.ts # Per-user notification settings
│   ├── notification-email-sender.ts # Email notification delivery
│   │
│   │  # ── Projects & Line Items ──
│   ├── projects.ts           # Project CRUD, duplication, templates
│   ├── project-categories.ts # Project category assignments
│   ├── project-costs.ts      # Project cost tracking
│   ├── project-groups.ts     # Project group (sub-project) CRUD
│   ├── project-managers.ts   # Project manager assignments
│   ├── project-media.ts      # Project photo/document management
│   ├── project-services.ts   # Project service line items
│   ├── project-tasks.ts      # Project task management
│   ├── line-items.ts         # Line item CRUD, availability checks, auto-accessories
│   ├── documents.ts          # Document generation
│   ├── document-templates.ts # Document template CRUD, publish, set default
│   ├── section-presets.ts    # Document section presets
│   ├── brand-templates.ts    # Branded document template CRUD
│   ├── group-templates.ts    # Group template CRUD
│   ├── custom-fields.ts      # Custom field definitions
│   │
│   │  # ── Reporting & Search ──
│   ├── reports.ts            # Business reports
│   ├── dashboard.ts          # Dashboard stats + activity
│   ├── csv.ts                # CSV import/export
│   ├── utilization.ts        # Utilization metrics
│   ├── reorder.ts            # Reorder suggestions
│   ├── search.ts             # globalSearch across all entities
│   ├── scan-lookup.ts        # Barcode → entity URL resolution
│   │
│   │  # ── Saved Views & Calendar ──
│   ├── saved-views.ts        # Saved table view presets
│   ├── scheduled-reports.ts  # Scheduled report delivery
│   ├── org-calendar.ts       # Organization calendar
│   │
│   │  # ── Settings & Admin ──
│   ├── settings.ts           # Org settings, asset tag config, branding
│   ├── site-admin.ts         # Platform admin operations
│   ├── public-org.ts         # Public org info (no session required)
│   ├── org-members.ts        # Org member management
│   ├── custom-roles.ts       # Custom role CRUD
│   ├── invitations.ts        # Invitation helpers
│   ├── sso.ts                # Single Sign-On configuration
│   ├── user-profile.ts       # User account operations
│   ├── changelog.ts          # Version/build info
│   ├── activity-log.ts       # Audit trail queries
│   │
│   │  # ── Stocktake ──
│   ├── stocktake.ts          # Stocktake CRUD, scanning, reconciliation
│   │
│   │  # ── Sub-hires ──
│   ├── sub-hires.ts          # Sub-hire order management
│   │
│   │  # ── Test & Tag ──
│   ├── test-tag-assets.ts    # T&T asset CRUD
│   ├── test-tag-auditor.ts   # T&T auditor management
│   ├── test-tag-profiles.ts  # T&T test profiles
│   ├── test-tag-records.ts   # T&T test record CRUD
│   ├── test-tag-reports.ts   # T&T report data + CSV
│   ├── test-tag-reminders.ts # T&T due-date reminders
│   │
│   │  # ── Warehouse ──
│   ├── warehouse.ts          # Checkout/checkin operations
│   ├── warehouse-close.ts    # Project close-out
│   ├── warehouse-display.ts  # Warehouse display data
│   ├── bulk-checkin.ts       # Bulk check-in operations
│   │
│   │  # ── Utility ──
│   ├── availability.ts       # Asset availability queries
│   ├── reservation-conflicts.ts # Conflict detection
│   ├── split-sibling-collapse.ts # Line item split management
│   └── woocommerce.ts        # WooCommerce integration
└── middleware.ts         # Auth check, route protection
```
