# tabby-smart-upload (Smart Upload)

[**中文说明**](README.zh-CN.md) | English

A Tabby terminal plugin that fixes two everyday pains of remote file transfer:

1. **Uploads can't find the current directory** — no manual remote shell configuration needed.
   After an SSH session starts, the plugin configures OSC 1337 CWD reporting on the remote side
   so the built-in SFTP panel and "upload to current directory" land where you actually are.
2. **The transfer UI is poor** — a Transfer Center aggregates every transfer with per-file
   progress, speed, ETA, status, cancel and retry, newest first.

## Features

- **Automatic CWD setup (zero echo)**
  - On first connect, writes a managed block into remote `~/.bashrc` / `~/.zshrc` **via SFTP**
    (marker comments, `.tabby-smart-upload.bak` backup before the first change, original mode preserved)
  - Falls back to a compact single-line terminal injection only if SFTP is unavailable
  - Skips entirely when the remote already reports CWD
  - On-demand probe when you click upload, so a fresh session without the hook still works
  - Interactive guard (`case $- in *i*)`) keeps `ssh host cmd` output clean
  - tmux DCS passthrough (tmux ≥ 3.3 requires `set -g allow-passthrough on`)
- **Upload to current directory** — toolbar button / `Ctrl-Shift-U` / tab context menu
  - Resolution order: reported CWD → on-demand probe → per-host memory → prompt (defaults to profile cwd)
  - Uses the built-in `.tabby-upload` temp-file + rename semantics (a failed upload never corrupts the target)
- **Upload folder** — tab context menu, keeps the directory structure
- **Drag & drop upload** — drop files or folders onto an SSH terminal; works in split panes
  (targets the pane you dropped on); coexists with the SFTP panel's own drop zone
- **Download** — right-click a file or folder in the built-in SFTP panel:
  - "Download to local folder (no dialog)" — saves straight to the configured folder
  - Folders are downloaded recursively; per-file progress in the Transfer Center
- **Transfer Center** — toolbar button / `Ctrl-Shift-Y`
  - Subscribes to Tabby's `fileTransferStarted$`, so built-in panel, drag-and-drop and plugin
    transfers are all tracked
  - Total speed, per-file speed / ETA / status, cancel, retry failed items, clear finished
  - Newest transfers on top; optionally reorders Tabby's built-in transfer dropdown too
- **Conflict policy** — overwrite (default) / skip / auto-rename `name (1).ext`, for uploads and downloads
- **Settings page** — injection/silent switches, notifications, concurrency (1‑8), conflict policy,
  default download folder, copyable manual snippets

## Install

- **Tabby plugin market**: Settings → Plugins → search `tabby-smart-upload`
  (npm search indexing for new packages can lag; use the CLI install below if not found)
- **npm**: https://www.npmjs.com/package/tabby-smart-upload
- **CLI install** (equivalent to the market install, takes effect immediately):

```powershell
cd "$env:APPDATA\tabby\plugins"
npm install tabby-smart-upload@latest
```

Restart Tabby after installing or updating.

## Usage

| Action | How |
|---|---|
| Upload files to current dir | Toolbar upload button / `Ctrl-Shift-U` / tab context menu |
| Upload a folder | Tab context menu → "Upload folder to current directory" |
| Drag & drop upload | Drop files/folders onto the SSH terminal |
| Download | Built-in SFTP panel → right-click file/folder → "Download to local folder (no dialog)" |
| Transfer Center | Toolbar list button / `Ctrl-Shift-Y` |
| Retry a failed transfer | Transfer Center → ⟳ on the failed row (when the local path is known) |

## Known limitations

- **su / sudo does not carry over to SFTP.** The SFTP channel uses the *login* user's permissions.
  After `su - root` / `sudo -i`, writing `/root/...` fails with Permission denied — the plugin shows
  a clear message including the login user, then offers to pick another writable directory and continue.
  For root-owned directories, log in directly as root (or upload to a writable dir and `mv` as root).
- Automatic setup supports **bash / zsh**; fish requires the manual snippet from the settings page.
- tmux ≥ 3.3 needs `set -g allow-passthrough on` for CWD reporting.
- Requires Tabby ≥ 1.0.2xx (tested on 1.0.238). Tabby's own auto-update may briefly look like a
  crash while it installs on quit — that is expected.
- Downloads of files not readable by the login user are refused by the server (same reason as above).

## Build from source

```bash
npm install
npm run build     # outputs dist/index.js
npm run watch     # watch mode
```

Windows host (Junction deploy for development, restart Tabby to apply):

```powershell
.\use-in-tabby.ps1 -RestartTabby
```

## Links

- Repository: https://github.com/zhangqxgz/tabby-smart-upload
- Chinese README: [README.zh-CN.md](README.zh-CN.md)
- License: MIT
