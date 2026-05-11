# ArchiveSphinx User Manual

**Version:** 1.1.0  
**Product:** ArchiveSphinx  
**Author:** Richard Lesh / Glowing Cat Software

---

## Table of Contents

1. [Introduction](#introduction)
2. [Supported Platforms](#supported-platforms)
3. [Supported Archive Formats](#supported-archive-formats)
4. [Main Window Overview](#main-window-overview)
5. [Quick Start](#quick-start)
6. [Creating a New Archive](#creating-a-new-archive)
7. [Opening an Archive](#opening-an-archive)
8. [Browsing Archive Contents](#browsing-archive-contents)
9. [Selecting Entries](#selecting-entries)
10. [Adding Files and Folders](#adding-files-and-folders)
11. [Creating Folders](#creating-folders)
12. [Renaming Entries](#renaming-entries)
13. [Moving and Reordering Entries](#moving-and-reordering-entries)
14. [Deleting Entries](#deleting-entries)
15. [Extracting Files](#extracting-files)
16. [Saving Archives](#saving-archives)
17. [Save As and Format Conversion](#save-as-and-format-conversion)
18. [Testing Archive Integrity](#testing-archive-integrity)
19. [Cleaning macOS Metadata](#cleaning-macos-metadata)
20. [Settings](#settings)
21. [Helper Compression Tools](#helper-compression-tools)
22. [Read-Only Formats](#read-only-formats)
23. [License Key and Donation Prompt](#license-key-and-donation-prompt)
24. [Troubleshooting](#troubleshooting)
25. [Privacy and Data Notes](#privacy-and-data-notes)
26. [Keyboard and Mouse Shortcuts](#keyboard-and-mouse-shortcuts)

---

## Introduction

ArchiveSphinx is a cross-platform desktop archive management tool for macOS, Windows, and Linux.

It lets you:

- Create new archives.
- Open and browse existing archives.
- Add files and folders.
- Rename archive entries.
- Move entries within the archive.
- Delete entries.
- Extract selected files or entire archives.
- Test archive integrity.
- Remove common macOS metadata files.
- Save archives in supported writable formats.

ArchiveSphinx is designed for everyday archive management with a clean table interface and familiar toolbar actions.

---

## Supported Platforms

ArchiveSphinx supports:

- macOS
- Windows
- Linux

Build targets include x64 and ARM64 where supported.

---

## Supported Archive Formats

ArchiveSphinx can open and browse many common archive formats.

### Open / Browse Formats

- ZIP: `.zip`
- 7-Zip: `.7z`
- RAR: `.rar`
- JAR: `.jar`
- TAR: `.tar`
- gzip-compressed TAR: `.tar.gz`, `.tgz`
- bzip2-compressed TAR: `.tar.bz2`, `.tbz2`
- xz-compressed TAR: `.tar.xz`, `.txz`
- zstd-compressed TAR: `.tar.zst`, `.tzst`
- 7z-compressed TAR: `.tar.7z`, `.t7z`
- Debian packages: `.deb`
- RPM packages: `.rpm`
- macOS disk images: `.dmg`
- ISO disk images: `.iso`

### Writable Formats

Writable support depends on the format. Common writable formats include:

- ZIP
- JAR
- TAR and compressed TAR variants
- 7z

### Read-Only Formats

The following formats open in read-only mode:

- RAR
- DEB
- RPM
- DMG
- ISO

Read-only archives can be browsed, extracted, and tested, but cannot be modified directly.

---

## Main Window Overview

The main window has four major areas.

### Toolbar

The toolbar contains primary archive actions:

| Button | Purpose |
|---|---|
| **New** | Create a new archive. |
| **Open** | Open an existing archive. |
| **Save** | Save changes to the current archive. |
| **Save As…** | Save the current archive to a new file or format. |
| **Add** | Add files or folders to the archive. |
| **New Folder** | Create a folder entry in the archive. |
| **Delete** | Delete selected entries. |
| **Extract All / Extract Selected** | Extract archive contents. |
| **Test** | Test archive integrity. |
| **Clean macOS** | Remove macOS metadata entries. |

Buttons are automatically enabled or disabled depending on the current archive, current selection, read-only status, and save state.

### Path Bar

The path bar shows the current archive path. It also displays progress information during long operations such as loading, saving, adding, extracting, or cleaning.

### Archive Table

The archive table lists entries in the archive.

Default columns include:

- Name
- Modified
- Size
- Compressed
- Attributes
- Type
- Method

### Status Bar

The status bar shows basic archive totals, including the number of files and compressed size.

---

## Quick Start

### Open an Existing Archive

1. Click **Open** or choose **File → Open Archive…**.
2. Select an archive file.
3. Browse the contents in the table.
4. Select files or folders if you want to extract or manage specific entries.
5. Click **Extract All** or **Extract Selected** to extract contents.

### Create a New Archive

1. Click **New** or choose **File → New Archive**.
2. Choose a file name and archive type.
3. Click **Add** to add files or folders.
4. Click **Save** when finished.

---

## Creating a New Archive

To create a new archive:

1. Click **New** or choose **File → New Archive**.
2. Choose the destination filename.
3. Choose a supported save format from the save dialog.
4. ArchiveSphinx creates an empty archive.

If an archive is already open in the current window, the new archive opens in a new window.

### New Archive Save Formats

Available save formats include:

- ZIP
- 7z
- JAR
- TAR
- compressed TAR formats such as `.tgz`, `.tbz2`, `.txz`, `.tzst`, and `.t7z`

Some formats depend on helper tools being available. For example, zstd and 7z support may require configured helper executables.

---

## Opening an Archive

To open an archive:

1. Click **Open** or choose **File → Open Archive…**.
2. Select an archive file.
3. ArchiveSphinx loads the archive and displays its contents.

If the archive is already open in another ArchiveSphinx window, that existing window is focused instead of opening the same file twice.

If an archive is already open in the current window, the selected archive opens in a new window.

---

## Browsing Archive Contents

Archive entries are shown in a table/tree view. Folder entries can be expanded and collapsed.

### Expanding and Collapsing Folders

Click the triangle next to a folder name:

- `▼` means the folder is expanded.
- `▶` means the folder is collapsed.

Hold **Alt/Option** while toggling a folder to collapse or expand subfolders recursively.

### Columns

The table includes these columns:

| Column | Description |
|---|---|
| Name | Entry name and folder hierarchy. |
| Modified | Last modified date when available. |
| Size | Uncompressed size. |
| Compressed | Compressed size when available. |
| Attributes | Unix-style permissions when available. |
| Type | Folder or file type based on extension. |
| Method | Compression method when available. |

### Sorting

Click a column header to sort by that column. Click again to reverse the sort direction.

The Attributes column is not sortable.

### Reordering Columns

Drag column headers to rearrange the column order.

### Resizing Columns

Drag the resize handle at the right edge of a column header to change the column width.

Column order and widths are saved in settings.

---

## Selecting Entries

ArchiveSphinx supports single selection and multi-selection.

### Select One Entry

Click an entry row.

### Toggle Selection

Use **Cmd/Ctrl-click** to add or remove individual entries from the selection.

### Select a Range

Use **Shift-click** to select a range of visible entries.

### Clear Selection

Click an empty area of the archive table to clear the selection.

---

## Adding Files and Folders

Writable archives can accept added files and folders.

To add files or folders:

1. Open or create a writable archive.
2. Select the destination folder in the archive, if desired.
3. Click **Add** or choose **File → Add Files…**.
4. Select files and/or folders from your computer.

Folders are added recursively.

You can also drag files or folders from your file manager into the archive table.

### Adding to a Specific Folder

If a folder is selected, new files are added inside that folder. If a file is selected, new files are added to that file's parent folder.

### File Size Note

ArchiveSphinx skips individual files larger than 2 GB when adding them through file import, because they exceed the in-memory buffer limit used for those add operations. Skipped files are reported after the operation.

For very large archive workflows, TAR-based formats are generally recommended.

---

## Creating Folders

To create a folder inside a writable archive:

1. Select the destination folder, or clear the selection to create a top-level folder.
2. Click **New Folder** or choose **File → New Folder**.
3. A folder named `Untitled Folder` is created.
4. Rename it immediately if desired.

If a folder with the same name already exists, ArchiveSphinx automatically chooses a unique name such as `Untitled Folder 1`.

The **New Folder** command is available only when the current selection is empty or consists of folders.

---

## Renaming Entries

To rename an entry:

1. Double-click the entry row.
2. Edit the name.
3. Press **Enter** or click elsewhere to commit.

Press **Escape** while editing to cancel.

Renaming a folder updates the paths of entries inside the folder.

Renaming is disabled for read-only archive formats.

---

## Moving and Reordering Entries

Writable archives support drag-and-drop movement of entries within the archive.

### Move an Entry

1. Select one or more entries.
2. Drag the selection onto a destination folder.
3. Drop the entries.

If you drop on a file, ArchiveSphinx uses that file's parent folder as the destination.

ArchiveSphinx prevents invalid moves, such as moving a folder into itself.

### macOS Metadata Movement

When moving entries, ArchiveSphinx also attempts to move matching `__MACOSX` metadata entries where appropriate.

---

## Deleting Entries

To delete entries from a writable archive:

1. Select one or more entries.
2. Click **Delete** or choose **File → Delete**.

Deleting a folder deletes the folder and its contents from the archive.

After deletion, ArchiveSphinx prunes empty folder entries where possible.

Deleting entries marks the archive as modified. Click **Save** to write the changes.

---

## Extracting Files

ArchiveSphinx can extract the entire archive or only selected entries.

### Extract All

If no entries are selected, the extract button shows **Extract All**.

1. Click **Extract All** or choose **File → Extract…**.
2. Choose a destination folder.
3. ArchiveSphinx extracts the archive contents.

### Extract Selected

If one or more entries are selected, the extract button shows **Extract Selected**.

1. Select files and/or folders.
2. Click **Extract Selected**.
3. Choose a destination folder.

If a selected entry is a folder, ArchiveSphinx extracts that folder's contents.

---

## Saving Archives

When you modify a writable archive, the window title shows a dirty/modified indicator and **Save** becomes enabled.

To save changes:

- Click **Save**.
- Choose **File → Save Archive**.
- Press **Cmd/Ctrl+S**.

During save operations, ArchiveSphinx displays progress information and disables conflicting actions.

If you close a window with unsaved changes, ArchiveSphinx asks whether to save, discard, or cancel closing.

---

## Save As and Format Conversion

Use **Save As…** to write the current archive to a new file.

This can be used to:

- Save a copy under a different name.
- Save to a different writable archive format.
- Convert from one supported archive type to another where possible.

To use Save As:

1. Open an archive.
2. Choose **Save As…** or press **Cmd/Ctrl+Shift+S**.
3. Choose the output file and format.
4. ArchiveSphinx writes the new archive.

When converting formats, ArchiveSphinx may need to extract and recompress entries internally. Large archives can take time.

---

## Testing Archive Integrity

The **Test** command checks whether archive entries can be read successfully.

To test an archive:

1. Open an archive.
2. Click **Test** or choose **File → Test Integrity**.
3. Review the result message.

If no problems are found, ArchiveSphinx reports that all files are OK.

If problems are found, ArchiveSphinx reports the entries that failed.

---

## Cleaning macOS Metadata

Archives created or modified on macOS often contain metadata entries such as:

- `.DS_Store`
- `__MACOSX/`
- AppleDouble resource fork files beginning with `._`

To remove these entries:

1. Open a writable archive.
2. Click **Clean macOS** or choose **File → Clean macOS**.
3. ArchiveSphinx removes matching entries.
4. Save the archive.

The Clean macOS command is disabled for read-only archive formats.

---

## Settings

Open **Settings…** from the application menu.

Settings are saved locally in:

```text
~/.archivesphinx-settings.json
```

Settings include:

- Selection highlight color
- Button highlight color
- gzip executable path
- bzip2 executable path
- xz executable path
- zstd executable path
- 7-Zip executable path

ArchiveSphinx also saves:

- Window bounds
- Column order
- Column widths

---

## Helper Compression Tools

ArchiveSphinx can use external compression tools for some archive operations.

### gzip / pigz

Used for gzip-compressed TAR files, such as:

- `.tar.gz`
- `.tgz`

If `pigz` is available, it may be used as a faster gzip-compatible tool.

### bzip2

Used for bzip2-compressed TAR files, such as:

- `.tar.bz2`
- `.tbz2`

If the bzip2 command-line tool is not available, ArchiveSphinx may use a slower JavaScript fallback and show a performance warning.

### xz

Used for xz-compressed TAR files, such as:

- `.tar.xz`
- `.txz`

### zstd

Used for zstd-compressed TAR files, such as:

- `.tar.zst`
- `.tzst`

If zstd is not available, zstd save/open options may be limited.

### 7-Zip

Used for:

- `.7z`
- `.tar.7z`
- Reading some read-only package/image formats through 7-Zip-compatible extraction

Common executable names include `7z` and `7zz`.

### Configuring Tool Paths

In Settings, leave a tool path blank to let ArchiveSphinx auto-detect it, or use **Browse…** to select the executable manually.

---

## Read-Only Formats

Some formats are intentionally opened as read-only:

- RAR
- DEB
- RPM
- DMG
- ISO

For read-only formats, ArchiveSphinx disables actions that would modify the archive, including:

- Add
- New Folder
- Delete
- Rename
- Move
- Save
- Clean macOS

You can still:

- Browse contents.
- Select entries.
- Extract entries.
- Test integrity.
- Use Save As when available to create a writable copy in another format.

---

## License Key and Donation Prompt

ArchiveSphinx includes a license key window and donation reminder.

Open **License Key…** from the application menu to enter:

- Your email address
- Your license key

License information is saved locally in the settings file.

If no valid license is configured, ArchiveSphinx may occasionally show a donation reminder splash screen. The splash can be closed by clicking it or waiting for it to close automatically.

---

## Troubleshooting

### The Add, Delete, Rename, or Clean buttons are disabled

Possible causes:

- No archive is open.
- The archive is read-only.
- A save or load operation is already running.
- No entry is selected for delete.
- The current selection is not valid for creating a new folder.

### The Save button is disabled

The Save button is enabled only when:

- A writable archive is open.
- The archive has unsaved changes.
- No save operation is currently running.

### ArchiveSphinx cannot open an archive

Possible causes:

- The file extension is unsupported.
- The archive is damaged.
- A required helper tool is missing.
- The archive is too large for the format/backend.

For very large archives, TAR-based formats are recommended.

### Bzip2 performance warning appears

ArchiveSphinx could not find the bzip2 command-line tool and used a slower fallback. Install bzip2 or configure its path in Settings.

### zstd archives are not available

Install `zstd` and configure the path in Settings, or make sure `zstd` is available on your system `PATH`.

### 7z archives fail to open or save

Install 7-Zip and configure the 7-Zip executable path in Settings.

### Drag and drop does not add files

Check that:

- An archive is open.
- The archive is writable.
- You are dragging into the archive table.
- The app is not currently saving or loading.

### Files were skipped while adding

ArchiveSphinx skips files that exceed the add-operation size limit or files that cannot be read. The skipped files are shown in a warning message.

### A window will not close

If ArchiveSphinx is saving, closing is temporarily blocked to prevent corruption. Wait for the save operation to complete.

If there are unsaved changes, choose **Save**, **Don't Save**, or **Cancel** when prompted.

---

## Privacy and Data Notes

ArchiveSphinx runs locally on your computer.

It stores settings in:

```text
~/.archivesphinx-settings.json
```

This file may include:

- Window size and position
- Column settings
- Color preferences
- Helper executable paths
- License key information

ArchiveSphinx does not need to upload your archives to a server to manage them.

External helper tools such as gzip, bzip2, xz, zstd, and 7-Zip run locally on your machine.

---

## Keyboard and Mouse Shortcuts

| Shortcut / Action | Result |
|---|---|
| **Cmd/Ctrl+N** | New archive |
| **Cmd/Ctrl+O** | Open archive |
| **Cmd/Ctrl+S** | Save archive |
| **Cmd/Ctrl+Shift+S** | Save As |
| **Cmd/Ctrl+Shift+A** | Add files |
| **Cmd/Ctrl+Shift+N** | New folder |
| **Delete** | Delete selected entries |
| **Cmd/Ctrl+E** | Extract |
| **Cmd/Ctrl+T** | Test integrity |
| **Click row** | Select entry |
| **Cmd/Ctrl-click** | Toggle selection |
| **Shift-click** | Select range |
| **Double-click entry** | Rename entry, if writable |
| **Drag entries** | Move entries within a writable archive |
| **Drag files into table** | Add files to a writable archive |
| **Click folder triangle** | Expand or collapse folder |
| **Alt/Option-click folder triangle** | Expand or collapse subfolders recursively |
| **Drag column header** | Reorder columns |
| **Drag column edge** | Resize column |

---

## Best Practices

- Save a backup before modifying important archives.
- Use **Test Integrity** after creating or modifying archives.
- Use **Clean macOS** before sending archives to Windows or Linux users.
- Configure helper tools in Settings for best performance and format support.
- Use TAR-based formats for very large archives.
- Avoid closing the app while save or extract operations are in progress.
