# Feature: File Browser — Folders, Entity Files & Sharing

## Summary

Build a full file management system with a browsable folder structure, drag-and-drop uploads, and deep integration with every entity in RVLT Flow. Files attached to models, projects, kits, etc. are automatically organised into virtual folders. Users can also create their own folder structure for general documents (rider specs, safety plans, contracts, insurance certificates). Files can be shared with external users and crew using the same token-based guest access pattern from the Project Sharing spec.

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [Data Model](#2-data-model)
3. [Folder Structure](#3-folder-structure)
4. [File Browser Page](#4-file-browser-page)
5. [Entity File Panels](#5-entity-file-panels)
6. [Upload Flow](#6-upload-flow)
7. [File Previews](#7-file-previews)
8. [File Sharing](#8-file-sharing)
9. [File Versioning](#9-file-versioning)
10. [Search Integration](#10-search-integration)
11. [Storage & S3 Changes](#11-storage--s3-changes)
12. [Server Actions](#12-server-actions)
13. [API Routes](#13-api-routes)
14. [Permissions](#14-permissions)
15. [Sidebar & Navigation](#15-sidebar--navigation)
16. [Project Sharing Integration](#16-project-sharing-integration)
17. [Activity Log Integration](#17-activity-log-integration)
18. [Organization Export/Import](#18-organization-exportimport)
19. [Mobile Considerations](#19-mobile-considerations)
20. [Implementation Phases](#20-implementation-phases)

---

## 1. Core Concepts

### Two Worlds of Files

RVLT Flow has two categories of files:

1. **Entity-attached files** — photos and documents linked to a specific model, asset, kit, project, client, location, etc. via the existing `{Entity}Media` join tables. These already exist and work via `MediaUploader`. They're tightly coupled to their parent entity.

2. **General files** — documents that don't belong to a single entity: rider specifications, insurance certificates, safety plans, standard operating procedures, contract templates, client briefs, venue maps, technical drawings. These need a proper folder structure and file browser.

The file browser unifies both worlds. Entity-attached files appear in auto-generated virtual folders (e.g. "Projects / Summer Festival / Files"), while general files live in user-created folders. One interface to browse everything.

### The `FileUpload` Model Is the Foundation

The existing `FileUpload` model stores every file uploaded to S3. The file browser builds on top of it — adding folders, metadata, and sharing — without changing how entity media attachments work today.

---

## 2. Data Model

### `Folder`

User-created folders for organising general files. Also used as virtual containers for entity files.

```prisma
model Folder {
  id              String   @id @default(cuid())
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  name            String
  parentId        String?              // Self-join for nesting
  parent          Folder?  @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children        Folder[] @relation("FolderTree")

  // Virtual folder link (for auto-generated entity folders)
  entityType      String?              // "project", "model", "kit", "client", "asset", etc.
  entityId        String?              // The entity this folder represents
  isVirtual       Boolean  @default(false)  // true = auto-generated from entity, not user-created

  // Metadata
  color           String?              // Optional folder colour for visual organisation
  icon            String?              // Optional Lucide icon name
  description     String?
  isPinned        Boolean  @default(false)  // Pin to top of file browser

  createdById     String?
  createdBy       User?    @relation(fields: [createdById], references: [id], onDelete: SetNull)
  sortOrder       Int      @default(0)

  files           FolderFile[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, parentId, name])  // No duplicate names in same parent
  @@unique([organizationId, entityType, entityId])  // One virtual folder per entity
  @@index([organizationId])
  @@index([parentId])
  @@index([organizationId, entityType])
}
```

### `FolderFile`

Links a `FileUpload` to a `Folder`. A file can exist in multiple folders (like a reference — not a copy). A file can also exist without any folder (legacy entity media attachments).

```prisma
model FolderFile {
  id              String   @id @default(cuid())
  folderId        String
  folder          Folder   @relation(fields: [folderId], references: [id], onDelete: Cascade)

  fileId          String
  file            FileUpload @relation(fields: [fileId], references: [id], onDelete: Cascade)

  // File-in-folder metadata
  displayName     String?              // Override file name for this folder context
  description     String?              // Per-folder file description
  tags            String[] @default([])
  sortOrder       Int      @default(0)
  addedById       String?
  addedBy         User?    @relation(fields: [addedById], references: [id], onDelete: SetNull)
  addedAt         DateTime @default(now())

  @@unique([folderId, fileId])  // No duplicate files in same folder
  @@index([folderId])
  @@index([fileId])
}
```

### `FileShare`

Sharing individual files or folders with external users. Reuses the same guest access pattern from the Project Sharing spec.

```prisma
model FileShare {
  id              String   @id @default(cuid())
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // What's shared (one of these is set)
  fileId          String?
  file            FileUpload? @relation(fields: [fileId], references: [id], onDelete: Cascade)
  folderId        String?
  folder          Folder?  @relation(fields: [folderId], references: [id], onDelete: Cascade)

  // Who shared it
  sharedById      String
  sharedBy        User     @relation(fields: [sharedById], references: [id], onDelete: Cascade)

  // Recipient
  recipientType   ShareRecipientType   // INTERNAL_USER, EXTERNAL_GUEST (reuse from project sharing)
  recipientUserId String?
  recipientUser   User?    @relation("FileSharedWith", fields: [recipientUserId], references: [id], onDelete: Cascade)
  recipientEmail  String?

  // Access
  accessLevel     FileShareAccess      // VIEW, DOWNLOAD, EDIT
  status          ShareStatus          // ACTIVE, REVOKED, EXPIRED (reuse enum)
  expiresAt       DateTime?
  password        String?              // Optional password protection (hashed)

  // Tracking
  message         String?
  lastAccessedAt  DateTime?
  accessCount     Int      @default(0)

  // Guest token (for external shares)
  shareToken      String?  @unique     // Hashed, plain sent via email
  tokenExpiresAt  DateTime?            // Link expiry (separate from share expiry)

  createdAt       DateTime @default(now())

  @@index([organizationId])
  @@index([fileId])
  @@index([folderId])
  @@index([recipientEmail])
}

enum FileShareAccess {
  VIEW        // Can preview in browser only
  DOWNLOAD    // Can preview and download
  EDIT        // Can replace/update the file (internal users only)
}
```

### `FileUpload` Enhancements

Add fields to the existing `FileUpload` model:

```prisma
model FileUpload {
  // ... existing fields ...

  // New fields
  description     String?              // File description
  tags            String[] @default([])
  isArchived      Boolean  @default(false)  // Soft-archived (hidden from browse, still accessible)

  // Versioning
  parentFileId    String?              // If this is a new version, points to the original
  parentFile      FileUpload? @relation("FileVersions", fields: [parentFileId], references: [id], onDelete: SetNull)
  versions        FileUpload[] @relation("FileVersions")
  versionNumber   Int      @default(1)
  isLatestVersion Boolean  @default(true)

  // Relations
  folderFiles     FolderFile[]
  shares          FileShare[]
}
```

---

## 3. Folder Structure

### Root-Level Organisation

The file browser root shows:

```
📁 My Files                          ← User-created top-level folders
├── 📁 Safety Documents
│   ├── 📁 Risk Assessments
│   ├── 📁 Insurance
│   └── 📄 OH&S Policy 2026.pdf
├── 📁 Rider Specs
│   ├── 📄 Behringer X32 Rider.pdf
│   └── 📄 L-Acoustics KARA Spec.pdf
├── 📁 Contract Templates
└── 📁 Training Materials

📁 Projects                           ← Auto-generated virtual folders
├── 📁 PRJ-0042 Summer Festival
│   ├── 📄 Site Map.pdf
│   ├── 📄 Bump In Schedule.xlsx
│   └── 📄 Client Brief.docx
├── 📁 PRJ-0043 Corporate Gala
└── 📁 PRJ-0044 Theatre Season

📁 Equipment                          ← Auto-generated virtual folders
├── 📁 Models
│   ├── 📁 Shure SM58
│   │   ├── 📄 User Manual.pdf
│   │   └── 📄 Spec Sheet.pdf
│   └── 📁 QSC K12.2
│       └── 📄 Quick Start Guide.pdf
└── 📁 Kits
    └── 📁 Drum Kit A
        └── 📄 Contents List.pdf

📁 Clients                            ← Auto-generated virtual folders
├── 📁 Acme Events
│   └── 📄 Master Services Agreement.pdf
└── 📁 Sydney Convention Centre
    └── 📄 Venue Technical Pack.pdf
```

### Virtual Folders

Virtual folders are auto-created when files are attached to entities. They're NOT created for every entity — only when an entity actually has files. This keeps the tree clean.

**When are virtual folders created?**
- When a file is uploaded via `MediaUploader` on an entity detail page, a virtual folder for that entity is created (if it doesn't exist) and the file is linked into it via `FolderFile`
- When browsing the file browser, entity folders only appear if they contain files

**Virtual folder naming:**
- Projects: `"{projectNumber} {name}"` → "PRJ-0042 Summer Festival"
- Models: `"{name}"` → "Shure SM58"
- Kits: `"{assetTag} {name}"` → "KIT-001 Drum Kit A"
- Clients: `"{name}"` → "Acme Events"
- Assets: `"{assetTag} {customName || model.name}"` → "GF-00042 SM58 #3"
- Locations: `"{name}"` → "Main Warehouse"

**Virtual folder auto-grouping:**
Virtual folders are grouped under category headers (Projects, Equipment, Clients, etc.) in the file browser sidebar tree. These category headers are UI-only — they're not `Folder` records.

### User-Created Folders

Users can create any folder structure they want for general files. Standard operations:
- Create folder (with optional colour and icon)
- Rename folder
- Move folder (drag-and-drop or move dialog)
- Delete folder (with confirmation — moves files to a "Deleted Files" area or deletes permanently)
- Nest folders up to 5 levels deep (practical limit for usability)

### Moving Files Between Folders

Files can be:
- **Moved** from one folder to another (the `FolderFile` record is updated)
- **Added to** an additional folder (a new `FolderFile` record is created — the file now appears in both folders, like a shortcut/reference)
- **Removed from** a folder (the `FolderFile` record is deleted — the `FileUpload` still exists if it's linked elsewhere)

This is important: a file uploaded to a project can ALSO be placed in a general "Safety Documents" folder if the user wants it accessible from both places.

---

## 4. File Browser Page

### Route: `/files`

The main file browser page.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  📁 Files                     [Upload] [New Folder] [⋮]  │
│──────────────────────────────────────────────────────────│
│                                                          │
│  Sidebar (tree)          │  Main area                    │
│                          │                               │
│  📁 My Files             │  Breadcrumb: Files / Safety   │
│  ├ Safety Documents      │                               │
│  ├ Rider Specs           │  [Grid View] [List View]      │
│  └ Contract Templates    │                               │
│                          │  ┌────┐  ┌────┐  ┌────┐      │
│  📁 Projects             │  │ 📄 │  │ 📄 │  │ 📁 │      │
│  ├ PRJ-0042 Summer...    │  │Risk│  │Ins.│  │2025│      │
│  └ PRJ-0043 Corporate    │  └────┘  └────┘  └────┘      │
│                          │                               │
│  📁 Equipment            │  ┌────┐  ┌────┐              │
│  └ Models                │  │ 📄 │  │ 📄 │              │
│    ├ Shure SM58          │  │OH&S│  │Fire│              │
│    └ QSC K12.2           │  └────┘  └────┘              │
│                          │                               │
│  📁 Clients              │                               │
│  └ Acme Events           │                               │
│                          │                               │
│  ★ Pinned                │                               │
│  └ Safety Documents      │                               │
│                          │                               │
└──────────────────────────────────────────────────────────┘
```

### View Modes

**Grid view (default):** File cards showing thumbnail (for images/PDFs), file name, size, date. Folders show as larger cards with the folder icon and item count.

**List view:** Table with columns: Name, Type, Size, Modified, Added By, Tags. Sortable by any column.

### Interactions

- **Click folder:** Navigate into it (breadcrumb updates)
- **Click file:** Open preview (see File Previews section)
- **Right-click / long-press:** Context menu with: Open, Download, Share, Move, Copy to folder, Rename, Details, Delete
- **Drag-and-drop:** Files onto folders to move them. Files from desktop onto the browser to upload.
- **Multi-select:** Shift-click or Ctrl-click to select multiple files for bulk actions (move, download as ZIP, delete, share)
- **Keyboard:** Arrow keys to navigate, Enter to open, Delete to delete, Ctrl+A to select all

### Breadcrumb Navigation

Top of the main area shows the current path:
```
Files / My Files / Safety Documents / Risk Assessments
```
Each segment is clickable to navigate back up.

### Search & Filter

- Search bar at the top filters by file name, description, and tags
- Filter chips: File type (Images, Documents, Spreadsheets, PDFs, Other), Date range, Tags, Uploaded by
- Search results show files across ALL folders (flattened), with the folder path shown as context

---

## 5. Entity File Panels

### How Entity Detail Pages Show Files

Every entity detail page that currently has a `MediaUploader` gets an enhanced files section:

**Current state:** The `MediaUploader` component shows photos/images with drag-to-reorder, primary marking, and upload.

**New state:** Below (or alongside) the `MediaUploader`, add a "Files & Documents" section that shows:
- All files attached to this entity (not just images — PDFs, spreadsheets, ZIPs, etc.)
- Upload button for new files
- Each file: thumbnail/icon, name, size, date, download button, share button, remove button
- "Open in File Browser" link that navigates to the entity's virtual folder in `/files`

The `MediaUploader` continues to handle photos/images specifically (with primary marking, ordering, etc.). The new files section handles all other file types. Together they cover everything.

### Files Tab on Projects

Projects get a dedicated "Files" tab (in addition to Equipment, Services, Crew, etc.):
- Shows all files attached to the project
- Allows sub-folder creation within the project's virtual folder
- Upload area with drag-and-drop
- Commonly attached file types: site maps, stage plots, risk assessments, run sheets, client briefs, venue technical packs, insurance certificates, power distribution plans

---

## 6. Upload Flow

### Enhanced Upload Endpoint

The existing `POST /api/uploads` endpoint is extended:

```typescript
// Existing: multipart form upload to S3
// New fields in the form data:
{
  file: File,               // The file (existing)
  folderId?: string,        // Target folder (new)
  entityType?: string,      // Entity to attach to (existing pattern)
  entityId?: string,        // Entity ID (existing pattern)
  description?: string,     // File description (new)
  tags?: string,            // Comma-separated tags (new)
  replaceFileId?: string,   // If uploading a new version of an existing file (new)
}
```

### Upload Destinations

When uploading, the file can be placed in:
1. **A specific folder** (folderId provided) — appears in that folder
2. **An entity** (entityType + entityId provided) — creates the entity media record AND adds to the entity's virtual folder
3. **Both** — attached to entity and also placed in a user folder
4. **Neither** — uploaded to an "Unfiled" area (appears in the browser but not in any folder)

### Drag-and-Drop

The file browser page supports:
- Drag files from desktop onto the main area → uploads to current folder
- Drag files from desktop onto a folder in the sidebar → uploads to that folder
- Drag existing files between folders → moves them

### Bulk Upload

Multiple files can be selected/dropped at once. Each gets its own `FileUpload` record. Progress bar shows overall and per-file progress.

---

## 7. File Previews

### In-Browser Preview

Clicking a file opens a preview overlay/lightbox:

| File Type | Preview |
|-----------|---------|
| Images (JPEG, PNG, WebP, GIF) | Full-size image with zoom |
| PDF | Embedded PDF viewer (browser native or `react-pdf`) |
| Video (MP4, WebM) | HTML5 video player |
| Audio (MP3, WAV) | HTML5 audio player |
| Text / Markdown / Code | Rendered text with syntax highlighting |
| Spreadsheets (XLSX, CSV) | Basic table preview (first 100 rows) |
| Other | File info card with download button (no inline preview) |

### Preview Overlay

The preview shows:
- File content (based on type)
- File name, size, type, upload date, uploaded by
- Tags and description
- Download button
- Share button
- Version history (if versions exist)
- "Open in File Browser" link (navigates to the file's location in `/files`)
- Left/right arrows to navigate between files in the same folder

---

## 8. File Sharing

### Share Individual Files

From the file browser or any entity file panel, users can share a file:

1. Click "Share" on a file
2. Enter recipient email (or select from crew/org members)
3. Choose access level:
   - **VIEW**: Can preview in browser only (no download button)
   - **DOWNLOAD**: Can preview and download
4. Optionally set:
   - Expiry date
   - Password protection
   - Personal message
5. Send → creates a `FileShare` record and sends an email

### Share Folders

Sharing a folder shares access to all files currently in it (and any files added later while the share is active). The recipient sees a read-only file browser view of that folder's contents.

### External Guest Access

Same pattern as the Project Sharing spec:
1. Guest receives email with a tokenised link
2. Link goes to `/shared/files/[shareToken]`
3. For VIEW/DOWNLOAD access to a single file, the link goes directly to a preview page — no email verification needed (the token is the auth, similar to how Google Drive share links work)
4. For folder shares, the link shows a minimal read-only file browser showing only the shared folder's contents
5. Password-protected shares prompt for the password before showing content

**Why no email verification for file shares (unlike project shares)?**

Project shares expose structured business data (financials, crew, schedules) that warrants the extra verification step. File shares are more like Google Drive links — the token is sufficient auth, and adding email verification for every shared PDF would be annoying. Password protection is available as an optional extra security layer.

### Share Link Format

```
https://flow.rvlt.app/shared/files/{shareToken}
```

The token is a cryptographically random string (32 bytes, URL-safe base64), stored hashed in `FileShare.shareToken`.

### Internal User Shares

For internal users (org members or RVLT Flow account holders), the shared file/folder appears in a "Shared with me" section in the file browser sidebar. No token needed — they access it via their authenticated session.

### Revoking Shares

From the file detail panel or the file browser:
- "Manage Sharing" shows all active shares for a file
- Each share can be revoked (immediate, invalidates the token)
- Expired shares are marked and can be re-enabled

---

## 9. File Versioning

### How Versioning Works

When a user uploads a new version of an existing file:

1. The new file is uploaded as a new `FileUpload` record with `parentFileId` pointing to the original
2. The original gets `isLatestVersion: false`
3. The new file gets `versionNumber = previous + 1` and `isLatestVersion: true`
4. All `FolderFile` records pointing to the old file are updated to point to the new file (so the file browser always shows the latest version)
5. Entity media join tables (`ModelMedia`, `ProjectMedia`, etc.) are also updated to point to the latest version

### Version History

On the file detail/preview panel:
- "Version History" section shows all versions with date, size, uploader, and version number
- Click a version to preview it
- "Restore" button on old versions makes that version the latest (creates a new version that's a copy of the old one)
- Download any version specifically

### When to Version vs Upload New

- **Replace/version:** Same conceptual document, updated content (new version of a risk assessment, updated site map)
- **New file:** Different document entirely

The UI encourages versioning by showing a "Replace with new version" option in the file context menu and upload dialog.

---

## 10. Search Integration

### Global Search (`src/server/search.ts`)

Add file search:
- Search by: fileName, description, tags, displayName (from FolderFile)
- Results show: file name, type icon, folder path, size, date
- Result links to the file preview or the file's location in the file browser

### Page Commands (`src/lib/page-commands.ts`)

```typescript
{
  label: "Files",
  href: "/files",
  aliases: ["documents", "uploads", "files", "file browser"],
  icon: "FolderOpen",
  description: "Browse and manage files",
  searchable: true,
  searchType: "file",
}
```

### Slash Commands (on `/files` page)

| Command | Aliases | Action | Description |
|---------|---------|--------|-------------|
| `/upload` | `add` | Open upload dialog | Upload files |
| `/new-folder` | `mkdir`, `create-folder` | Open new folder dialog | Create a new folder |
| `/search` | `find` | Focus search bar | Search files |

---

## 11. Storage & S3 Changes

### S3 Path Structure

The existing S3 path pattern is `{orgId}/{folder}/{entityId}/{uuid}-{filename}`. This continues to work. For general files (not attached to an entity), the path becomes:

```
{orgId}/files/{folderId}/{uuid}-{filename}
```

For files that are in a user folder AND attached to an entity, the file is stored once at the entity path. The `FolderFile` record just references the same `FileUpload` — no duplicate S3 objects.

### Storage Quota (optional, stretch goal)

Track total storage per org:
- Sum `FileUpload.fileSize` for all files in the org
- Display on the admin dashboard and org settings
- Optionally enforce a quota (configurable in `SiteSettings` or per-org)
- Warning at 80% usage, hard block at 100%

### Cleanup

When a `FileUpload` is deleted:
1. Delete the S3 object
2. Delete all `FolderFile` records referencing it
3. Delete all `FileShare` records referencing it
4. Delete all entity media join table records referencing it
5. If it has versions, decide: delete all versions or only this version

Implement a soft-delete pattern: `FileUpload.isArchived` hides the file from the browser but doesn't delete from S3. A "Trash" section in the file browser shows archived files. Permanent deletion happens manually or via a background cleanup job.

---

## 12. Server Actions

### `src/server/files.ts` — New File

```typescript
"use server";

// Folder CRUD
export async function createFolder(data: CreateFolderInput): Promise<Folder>;
export async function updateFolder(id: string, data: UpdateFolderInput): Promise<Folder>;
export async function deleteFolder(id: string): Promise<void>;
export async function moveFolder(id: string, newParentId: string | null): Promise<void>;
export async function getFolderTree(): Promise<FolderTreeNode[]>;
export async function getFolderContents(folderId: string | null, options?: { page, pageSize, sort, search, fileType }): Promise<FolderContents>;

// File operations
export async function getFileById(fileId: string): Promise<FileUpload>;
export async function updateFileMetadata(fileId: string, data: { description?, tags?, displayName? }): Promise<FileUpload>;
export async function moveFileToFolder(fileId: string, targetFolderId: string): Promise<void>;
export async function addFileToFolder(fileId: string, folderId: string): Promise<FolderFile>;
export async function removeFileFromFolder(fileId: string, folderId: string): Promise<void>;
export async function archiveFile(fileId: string): Promise<void>;
export async function permanentlyDeleteFile(fileId: string): Promise<void>;
export async function restoreFile(fileId: string): Promise<void>;
export async function getArchivedFiles(options?: PaginationOptions): Promise<PaginatedResult<FileUpload>>;

// Versioning
export async function uploadNewVersion(originalFileId: string, formData: FormData): Promise<FileUpload>;
export async function getFileVersions(fileId: string): Promise<FileUpload[]>;
export async function restoreFileVersion(versionId: string): Promise<FileUpload>;

// Sharing
export async function createFileShare(data: CreateFileShareInput): Promise<FileShare>;
export async function revokeFileShare(shareId: string): Promise<void>;
export async function getFileShares(fileId?: string, folderId?: string): Promise<FileShare[]>;
export async function getSharedWithMe(): Promise<SharedFile[]>;
export async function getSharedFileByToken(token: string, password?: string): Promise<SharedFileData>;

// Virtual folders
export async function getOrCreateEntityFolder(entityType: string, entityId: string): Promise<Folder>;
export async function getEntityFiles(entityType: string, entityId: string): Promise<FileUpload[]>;

// Search
export async function searchFiles(query: string, options?: { fileType?, folderId?, tags?, dateRange? }): Promise<FileUpload[]>;

// Bulk operations
export async function bulkMoveFiles(fileIds: string[], targetFolderId: string): Promise<void>;
export async function bulkDeleteFiles(fileIds: string[]): Promise<void>;
export async function bulkDownloadAsZip(fileIds: string[]): Promise<string>; // Returns download URL
```

---

## 13. API Routes

### Existing Routes (updated)

| Route | Changes |
|-------|---------|
| `POST /api/uploads` | Accept `folderId`, `description`, `tags`, `replaceFileId` in form data |
| `GET /api/files/[...path]` | No changes — continues to proxy S3 files with org validation |

### New Routes

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/files/download/[fileId]` | GET | Download file with proper Content-Disposition header (forces download vs inline) | Authenticated |
| `/api/files/bulk-download` | POST | Generate ZIP of multiple files, return download URL | Authenticated |
| `/shared/files/[shareToken]` | GET (page) | Shared file/folder view for external guests | Token-based |
| `/api/shared/files/[shareToken]/download` | GET | Download a shared file | Token + optional password |
| `/api/shared/files/[shareToken]/preview` | GET | Stream file for preview in browser | Token + optional password |

### Download vs Preview

- `GET /api/files/[...path]` — Inline streaming (for previews, images in UI)
- `GET /api/files/download/[fileId]` — Sets `Content-Disposition: attachment` for forced download

---

## 14. Permissions

### New Permission Resource

Add `files` to `src/lib/permissions.ts`:

```typescript
files: ["create", "read", "update", "delete"]
```

Role defaults:
- **owner/admin**: All CRUD
- **manager**: All CRUD
- **member**: Create, read, update own files. Cannot delete others' files.
- **viewer**: Read only (can browse and preview, cannot upload/modify/delete)

### Sharing Permissions

Sharing files externally requires `files: update` permission (same pattern as project sharing requiring `project: update`).

### Entity File Access

Files attached to entities inherit that entity's read permission. If a user can read a project, they can see the project's attached files. This doesn't change — the existing `{Entity}Media` join tables and file proxy already handle this.

---

## 15. Sidebar & Navigation

Add to the main sidebar:

```typescript
{
  title: "Files",
  url: "/files",
  icon: FolderOpen,
  resource: "files",
}
```

Position: after Crew, before Warehouse (or wherever makes sense in the nav flow — files are a supporting feature, not a primary workflow).

Add breadcrumb labels:
```typescript
files: "Files"
```

---

## 16. Project Sharing Integration

Add to `ShareScope` (from the Project Sharing spec):

```typescript
interface ShareScope {
  // ... existing fields ...
  showFiles: boolean;                  // Show the project's attached files
  allowFileDownload: boolean;          // Allow downloading project files
}
```

When `showFiles` is true on a shared project:
- The shared project view shows a "Files" section listing the project's attached files
- File names, types, and sizes are visible
- If `allowFileDownload` is true, download buttons appear
- File preview works for VIEW-able types (images, PDFs)
- Internal-only files (tagged as internal or in internal subfolders) are excluded

Update presets:
- **Client View**: `showFiles: true, allowFileDownload: true`
- **Crew View**: `showFiles: true, allowFileDownload: true` (crew need access to site maps, run sheets, etc.)
- **Equipment Only**: `showFiles: false, allowFileDownload: false`
- **Minimal**: `showFiles: false, allowFileDownload: false`

---

## 17. Activity Log Integration

Log:
- File uploaded (with folder, entity context)
- File moved between folders
- File archived / permanently deleted / restored
- File metadata updated (description, tags, rename)
- File version uploaded
- File share created / revoked
- Folder created / renamed / moved / deleted

---

## 18. Organization Export/Import

Add to export/import:
- `Folder` — remap `organizationId`, `parentId`, `createdById`, and `entityId` (for virtual folders, remap to new entity IDs)
- `FolderFile` — remap `folderId`, `fileId`, `addedById`
- `FileShare` — remap `organizationId`, `fileId`, `folderId`, `sharedById`, `recipientUserId`. Clear `shareToken` on import.
- `FileUpload` changes — handle new fields (`parentFileId` for versioning, `tags`, `description`)

S3 files are already handled by the existing export/import system (files are downloaded and re-uploaded under the new org prefix).

---

## 19. Mobile Considerations

### File Browser on Mobile

- **List view only** on small screens (grid view requires too much horizontal space for file cards)
- Folder tree collapses into a dropdown or slides in as a sheet
- Breadcrumb truncates with "..." for deep paths, tap to expand
- Long-press on file/folder for context menu
- Swipe actions: swipe right to share, swipe left to delete

### Upload on Mobile

- Camera capture available as a file source (useful for photographing site conditions, equipment damage, etc.)
- File picker supports the native OS file picker
- Drag-and-drop not available on mobile — use the upload button

### File Preview on Mobile

- Images: full-screen with pinch-to-zoom
- PDFs: native browser PDF viewer (or embedded viewer)
- Other files: download and open in native app

---

## 20. Implementation Phases

### Phase 1: Folder Model & File Browser Page
1. Create `Folder` and `FolderFile` models, run migration
2. Folder CRUD server actions
3. `/files` page with sidebar tree and main grid/list view
4. Create folder, rename, move, delete operations
5. Upload files into folders (extend `POST /api/uploads`)
6. Breadcrumb navigation

### Phase 2: Entity Integration & Virtual Folders
1. Virtual folder auto-creation for entities with files
2. `getOrCreateEntityFolder()` utility
3. Link existing `MediaUploader` uploads to virtual folders
4. "Files & Documents" section on entity detail pages
5. "Open in File Browser" links from entity pages
6. Projects: dedicated Files tab

### Phase 3: File Previews & Management
1. File preview overlay/lightbox for all supported types
2. File metadata editing (description, tags, rename)
3. Multi-select and bulk operations (move, delete, download ZIP)
4. Search within files (name, tags, description)
5. Archive/trash functionality with soft delete

### Phase 4: File Sharing
1. `FileShare` model and server actions
2. Share dialog UI (email, access level, expiry, password)
3. Shared file page (`/shared/files/[shareToken]`)
4. Shared folder view (read-only browser)
5. "Shared with me" section in file browser sidebar
6. Email notifications for shares
7. Manage sharing panel on files

### Phase 5: Versioning & Polish
1. File versioning (upload new version, version history, restore)
2. Storage quota tracking (optional)
3. Global search integration
4. Slash commands on the files page
5. Project sharing scope (`showFiles`, `allowFileDownload`)
6. Activity log integration
7. Mobile responsiveness pass

---

## Notes

- **The `FileUpload` model is the single source of truth for every file in S3.** Folders, entity media tables, and shares all reference it. A file is stored once in S3 regardless of how many folders or entities it's linked to.
- **Virtual folders are lazy.** They're only created when an entity actually has files attached. An entity with no files has no virtual folder — the file browser stays clean.
- **File sharing is simpler than project sharing.** No email verification for guest access — the share token is sufficient auth (same model as Google Drive share links). Password protection is available for extra security. This is a deliberate UX choice: requiring email verification for every shared PDF would be too heavy.
- **The existing `MediaUploader` is not replaced.** It continues to handle photos/images with primary marking and ordering. The new file browser and entity file panels handle general documents alongside it. They're complementary, not competing.
- **Consider adding a "Recent Files" section** to the dashboard (stretch goal) — the 10 most recently uploaded/accessed files across all entities.
- **Large file handling:** Set a reasonable upload size limit (50MB default, configurable per org). For very large files (video, CAD), consider a resumable upload library like `tus`. Out of scope for v1 — the standard multipart upload works for typical AV documents.
- **Files are org-scoped.** The existing S3 path pattern (`{orgId}/...`) and file proxy org validation ensure cross-tenant isolation. This doesn't change.
