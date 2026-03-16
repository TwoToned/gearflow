# Project Structure

```
src/
├── app/
│   ├── (auth)/           # Public pages: login, register, onboarding, invite, no-org
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
│   ├── layout/           # Sidebar, TopBar, MobileNav, CommandSearch, Notifications, OrgSwitcher, UserNav, ThemeToggle
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
│   ├── assets.ts         # Serialized asset CRUD
│   ├── bulk-assets.ts    # Bulk asset CRUD
│   ├── models.ts         # Equipment model CRUD
│   ├── kits.ts           # Kit CRUD + item management
│   ├── categories.ts     # Category CRUD
│   ├── locations.ts      # Location CRUD
│   ├── suppliers.ts      # Supplier CRUD (paginated, with orders/assets/subhires)
│   ├── supplier-orders.ts # Supplier order CRUD + items
│   ├── clients.ts        # Client CRUD
│   ├── projects.ts       # Project CRUD, duplication, templates
│   ├── line-items.ts     # Line item CRUD, availability checks, auto-accessories
│   ├── warehouse.ts      # Checkout/checkin operations
│   ├── maintenance.ts    # Maintenance record CRUD
│   ├── search.ts         # globalSearch across all entities
│   ├── scan-lookup.ts    # Barcode → entity URL resolution
│   ├── notifications.ts  # Notification generation
│   ├── dashboard.ts      # Dashboard stats + activity
│   ├── reports.ts        # Business reports
│   ├── csv.ts            # CSV import/export
│   ├── settings.ts       # Org settings, asset tag config, branding
│   ├── tags.ts           # Org-wide tag autocomplete
│   ├── changelog.ts      # Version/build info
│   ├── site-admin.ts     # Platform admin operations
│   ├── org-members.ts    # Org member management
│   ├── custom-roles.ts   # Custom role CRUD
│   ├── user-profile.ts   # User account operations
│   ├── invitations.ts    # Invitation helpers
│   ├── document-templates.ts # Document template CRUD, publish, set default
│   ├── test-tag-assets.ts    # T&T asset CRUD
│   ├── test-tag-records.ts   # T&T test record CRUD
│   └── test-tag-reports.ts   # T&T report data + CSV
└── middleware.ts         # Auth check, route protection
```
