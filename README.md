# 🐺 Claude Usage Widget

A tiny, cartoon-styled floating desktop widget (Windows / Electron) that shows your **Claude plan usage** and **cost per model** — guarded by a cute Siberian Husky. วิดเจ็ตลอยบนเดสก์ท็อปแสดงการใช้งาน Claude แบบเรียลไทม์ พร้อมน้องหมาไซบีเรียนฮัสกี้เฝ้าการ์ดให้

<p align="center">
  <img src="docs/screenshot.png" width="210" alt="Widget (expanded)" />
  <img src="docs/screenshot-collapsed.png" width="210" alt="Widget (collapsed)" />
</p>

## Features

- **Plan limits** — Session (5h) / Weekly / per-model utilization bars with reset countdown, from the same `api.anthropic.com/api/oauth/usage` endpoint that Claude Code's `/usage` command uses
- **Cost per model** — computed locally from `~/.claude/projects/**/*.jsonl` (ccusage-style, deduped per streaming request), shown for today and the last 7 days
- **Thai Baht** — live USD→THB rate (open.er-api.com, cached 12h, fallback ฿36)
- **Privacy toggle** — click the totals row (👁) to mask all money as `฿•••`
- **Collapsible** — click `▾ Cost / Model` to shrink the card
- Transparent, frameless, always-on-top (screen-saver z-level with auto re-assert), draggable, remembers its position, tray menu, auto-refresh every 5 minutes
- OAuth token auto-refresh: if the Claude Code access token in `~/.claude/.credentials.json` has expired, the widget refreshes it and writes the rotated tokens back

Inspired by [PanithanNanti/claude-usage-widget](https://github.com/PanithanNanti/claude-usage-widget) (macOS / Übersicht) — rebuilt for Windows with Electron.

## Requirements

- Windows 10/11
- [Claude Code](https://claude.com/claude-code) installed and logged in (the widget reads its credentials and local usage logs)
- Node.js (only for building; the packaged exe runs standalone)

## Run from source

```powershell
npm install
npm start
```

## Build a portable exe

```powershell
npx electron-packager . ClaudeUsageWidget --platform=win32 --arch=x64 --out=dist --overwrite --icon=build\icon.ico
```

Then launch `dist\ClaudeUsageWidget-win32-x64\ClaudeUsageWidget.exe`. To start with Windows, drop a shortcut to it into `shell:startup`.

## Notes

- Cost figures are **API-equivalent value** (tokens × published API pricing). On a subscription plan (Pro/Max) this is the value consumed, not an actual bill.
- Pricing table lives in [usage.js](usage.js) — update it when model prices change.
- No data leaves your machine except the calls to Anthropic (usage API) and open.er-api.com (exchange rate).
