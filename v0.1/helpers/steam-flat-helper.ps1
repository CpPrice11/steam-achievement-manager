param(
  [Parameter(Mandatory = $true)]
  [int]$AppId,

  [ValidateSet('apply', 'states', 'diagnose')]
  [string]$Action = 'apply'
)

$ErrorActionPreference = 'Stop'

function Write-Result($result) {
  $result | ConvertTo-Json -Compress -Depth 6 | Write-Output
}

$inputJson = [Console]::In.ReadToEnd()
$inputData = @()
if (-not [string]::IsNullOrWhiteSpace($inputJson)) {
  $parsed = $inputJson | ConvertFrom-Json
  if ($parsed -is [array]) {
    $inputData = @($parsed)
  } elseif ($null -ne $parsed) {
    $inputData = $parsed
  }
}

$result = [ordered]@{
  action = $Action
  changed = @()
  failed = @()
  achievements = @()
  stored = $false
  helper = "steam-flat-helper"
  error = $null
}

try {
  $steamApiDll = [string]$env:STEAM_API_DLL
  if (-not (Test-Path -LiteralPath $steamApiDll)) {
    throw "steam_api64.dll was not found."
  }

  $dllDir = Split-Path -Parent $steamApiDll
  $env:PATH = "$dllDir;$env:PATH"

  $workDir = Join-Path ([IO.Path]::GetTempPath()) "my-sam-steam-flat\$AppId"
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  Set-Content -LiteralPath (Join-Path $workDir 'steam_appid.txt') -Value ([string]$AppId) -Encoding ASCII
  $env:SteamAppId = [string]$AppId
  $env:SteamGameId = [string]$AppId
  Set-Location -LiteralPath $workDir

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SteamFlatApi
{
    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, EntryPoint = "SteamAPI_InitSafe")]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_Init();

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    public static extern void SteamAPI_Shutdown();

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    public static extern void SteamAPI_RunCallbacks();

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr SteamAPI_SteamUserStats_v012();

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr SteamAPI_SteamApps_v008();

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamApps_BIsSubscribedApp(IntPtr self, uint appId);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamApps_BIsAppInstalled(IntPtr self, uint appId);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr SteamAPI_ISteamApps_GetCurrentGameLanguage(IntPtr self);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_RequestCurrentStats(IntPtr self);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_GetAchievement(IntPtr self, string achievement, [MarshalAs(UnmanagedType.I1)] out bool achieved);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_GetAchievementAndUnlockTime(IntPtr self, string achievement, [MarshalAs(UnmanagedType.I1)] out bool achieved, out uint unlockTime);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_SetAchievement(IntPtr self, string achievement);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_ClearAchievement(IntPtr self, string achievement);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_StoreStats(IntPtr self);

    public static string PtrToString(IntPtr value)
    {
        return value == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(value);
    }
}
'@

  if (-not [SteamFlatApi]::SteamAPI_Init()) {
    throw "Steam API could not initialize for this app."
  }

  $stats = [SteamFlatApi]::SteamAPI_SteamUserStats_v012()
  if ($stats -eq [IntPtr]::Zero) {
    throw "Steam did not return the user stats interface for this app."
  }
  $apps = [SteamFlatApi]::SteamAPI_SteamApps_v008()

  [SteamFlatApi]::SteamAPI_ISteamUserStats_RequestCurrentStats($stats) | Out-Null
  $first = $null
  if ($Action -eq 'apply' -or $Action -eq 'states') {
    $first = @($inputData | Where-Object { $_.id -or $_ } | Select-Object -First 1)[0]
  }
  for ($i = 0; $i -lt 80; $i++) {
    [SteamFlatApi]::SteamAPI_RunCallbacks()
    if ($null -eq $first) { break }
    $isAchieved = $false
    $firstId = if ($first.id) { [string]$first.id } else { [string]$first }
    if ([SteamFlatApi]::SteamAPI_ISteamUserStats_GetAchievement($stats, $firstId, [ref]$isAchieved)) {
      break
    }
    Start-Sleep -Milliseconds 100
  }

  if ($Action -eq 'diagnose') {
    $result.requestedAppId = $AppId
    $result.installed = $false
    $result.subscribed = $false
    $result.currentLanguage = ""
    if ($apps -ne [IntPtr]::Zero) {
      $result.installed = [SteamFlatApi]::SteamAPI_ISteamApps_BIsAppInstalled($apps, [uint32]$AppId)
      $result.subscribed = [SteamFlatApi]::SteamAPI_ISteamApps_BIsSubscribedApp($apps, [uint32]$AppId)
      $result.currentLanguage = [SteamFlatApi]::PtrToString([SteamFlatApi]::SteamAPI_ISteamApps_GetCurrentGameLanguage($apps))
    }
  } elseif ($Action -eq 'states') {
    foreach ($item in @($inputData)) {
      $id = if ($item.id) { [string]$item.id } else { [string]$item }
      if ([string]::IsNullOrWhiteSpace($id)) { continue }

      $isAchieved = $false
      $unlockTime = [uint32]0
      $ok = [SteamFlatApi]::SteamAPI_ISteamUserStats_GetAchievementAndUnlockTime($stats, $id, [ref]$isAchieved, [ref]$unlockTime)
      if (-not $ok) {
        $ok = [SteamFlatApi]::SteamAPI_ISteamUserStats_GetAchievement($stats, $id, [ref]$isAchieved)
      }

      if ($ok) {
        $result.achievements += [ordered]@{ id = $id; achieved = $isAchieved; unlockTime = [uint32]$unlockTime }
      } else {
        $result.achievements += [ordered]@{ id = $id; achieved = $false; unlockTime = 0; error = "Steam does not see this achievement API name in the current session." }
      }
    }
  } else {
  foreach ($change in @($inputData)) {
    $id = [string]$change.id
    if ([string]::IsNullOrWhiteSpace($id)) { continue }
    $achieved = [bool]$change.achieved
    $ok = if ($achieved) {
      [SteamFlatApi]::SteamAPI_ISteamUserStats_SetAchievement($stats, $id)
    } else {
      [SteamFlatApi]::SteamAPI_ISteamUserStats_ClearAchievement($stats, $id)
    }

    if ($ok) {
      $result.changed += [ordered]@{ id = $id; achieved = $achieved }
    } else {
      $existsValue = $false
      $exists = [SteamFlatApi]::SteamAPI_ISteamUserStats_GetAchievement($stats, $id, [ref]$existsValue)
      $reason = if ($exists) {
        "Steam rejected the change after stats were loaded."
      } else {
        "Steam does not see this achievement API name in the current session."
      }
      $result.failed += [ordered]@{ id = $id; achieved = $achieved; reason = $reason }
    }
  }

  if ($result.changed.Count -gt 0) {
    $result.stored = [SteamFlatApi]::SteamAPI_ISteamUserStats_StoreStats($stats)
  }
  }

  for ($i = 0; $i -lt 30; $i++) {
    [SteamFlatApi]::SteamAPI_RunCallbacks()
    Start-Sleep -Milliseconds 50
  }
} catch {
  $result.error = $_.Exception.Message
  foreach ($change in @($inputData)) {
    $id = [string]$change.id
    if ([string]::IsNullOrWhiteSpace($id)) { continue }
    $alreadyChanged = @($result.changed | Where-Object { $_.id -eq $id }).Count -gt 0
    if (-not $alreadyChanged) {
      $result.failed += [ordered]@{ id = $id; achieved = [bool]$change.achieved; reason = $_.Exception.Message }
    }
  }
} finally {
  try { [SteamFlatApi]::SteamAPI_Shutdown() } catch {}
}

Write-Result $result
