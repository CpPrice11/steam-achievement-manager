# MY SAM

Compact Windows desktop manager for Steam achievements and game stats.

## What it does

- Detects the local Steam installation and whether `steam.exe` is running.
- Reads installed games from Steam library manifests.
- Opens any selected game through Steamworks by AppID.
- Lists achievements with checkboxes.
- Unlocks or locks achievements and immediately calls `StoreStats`.
- Uses Steam's local cached stats schema first, with Steam Web API as a fallback.
- Shows and edits integer stats when schema data exposes stat names.

## Requirements

- Windows.
- Steam client running and logged in.
- Node.js and npm for development.
- Network access for `npm install`; optional network access at runtime for Steam Web API schema metadata.

## Setup

```powershell
npm install
npm run start
```

Build a portable Windows executable:

```powershell
npm run dist
```

## Notes

Achievement changes use the local Steamworks API. Steam documents `SetAchievement`, `ClearAchievement`, and `StoreStats` as stats/achievements calls for the current user and app. Some games or communities may not support manual achievement/stat changes, so use this only on your own account and at your own risk.

Achievements and stats need schema data so the app knows the API names. The app first reads Steam's local `appcache\stats\UserGameStatsSchema_<appid>.bin` files. If the local cache is missing and Steam does not return Web API schema data without a key, add your Steam Web API key in the app settings field. The current npm release of `steamworks.js` supports integer stats but does not expose float stat methods.

## Credits

Inspired by [gibbed/SteamAchievementManager](https://github.com/gibbed/SteamAchievementManager) — the original Steam Achievement Manager (SAM) by Rick Gibbed, written in C#. MY SAM is an independent reimplementation in JavaScript / Electron and shares no code with the original; it only borrows the idea and the SAM name. All credit for the original concept goes to Rick Gibbed.

## License

[MIT](LICENSE)
