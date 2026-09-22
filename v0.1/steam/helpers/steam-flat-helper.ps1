param(
  [Parameter(Mandatory = $true)]
  [int]$AppId,

  [ValidateSet('apply', 'states', 'diagnose', 'stats-read', 'stats-set', 'stats-reset')]
  [string]$Action = 'apply'
)

$ErrorActionPreference = 'Stop'

function Write-Result($result) {
  $result | ConvertTo-Json -Compress -Depth 6 | Write-Output
}

function Clear-TemporarySteamRegistry($registryPath, $removeValue, $removeKey) {
  if ($removeValue) {
    try { Remove-ItemProperty -LiteralPath $registryPath -Name InstallPath -ErrorAction SilentlyContinue } catch {}
  }
  if ($removeKey) {
    try {
      $customValues = @((Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop).PSObject.Properties |
        Where-Object { $_.Name -notmatch '^PS' })
      $childKeys = @(Get-ChildItem -LiteralPath $registryPath -ErrorAction SilentlyContinue)
      if ($customValues.Count -eq 0 -and $childKeys.Count -eq 0) {
        Remove-Item -LiteralPath $registryPath -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
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
  stats = @()
  reset = $false
  stored = $false
  helper = "steam-flat-helper"
  error = $null
}
$temporarySteamRegistryValue = $false
$temporarySteamRegistryKey = $false
$steamRegistryMutex = $null
$steamRegistryMutexHeld = $false

try {
  $steamApiDll = [string]$env:STEAM_API_DLL
  if (-not (Test-Path -LiteralPath $steamApiDll)) {
    throw "steam_api64.dll was not found."
  }

  $dllDir = Split-Path -Parent $steamApiDll
  $steamInstallPath = [string]$env:STEAM_INSTALL_PATH

  $steamRegistryPath = 'HKCU:\Software\Valve\Steam'
  $steamRegistryMutex = New-Object System.Threading.Mutex($false, 'Local\MY-SAM-Steam-Registry-Bridge')
  $steamRegistryMutexHeld = $steamRegistryMutex.WaitOne(10000)
  if (-not $steamRegistryMutexHeld) {
    throw 'Timed out while preparing the Steam registry bridge.'
  }
  $registeredInstallPath = (Get-ItemProperty -LiteralPath $steamRegistryPath -Name InstallPath -ErrorAction SilentlyContinue).InstallPath
  if ([string]::IsNullOrWhiteSpace([string]$registeredInstallPath) -and (Test-Path -LiteralPath $steamInstallPath)) {
    if (-not (Test-Path -LiteralPath $steamRegistryPath)) {
      New-Item -Path $steamRegistryPath -Force | Out-Null
      $temporarySteamRegistryKey = $true
    }
    New-ItemProperty -LiteralPath $steamRegistryPath -Name InstallPath -Value $steamInstallPath -PropertyType String -Force | Out-Null
    $temporarySteamRegistryValue = $true
  }

  $workDir = Join-Path ([IO.Path]::GetTempPath()) "my-sam-steam-flat\$AppId"
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  $env:PATH = "$dllDir;$steamInstallPath;$env:PATH"
  Set-Content -LiteralPath (Join-Path $workDir 'steam_appid.txt') -Value ([string]$AppId) -Encoding ASCII
  $env:SteamAppId = [string]$AppId
  $env:SteamGameId = [string]$AppId
  Set-Location -LiteralPath $workDir

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SteamFlatApi
{
    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int SteamAPI_InitFlat(StringBuilder errorMessage);

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

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_GetStatInt32(IntPtr self, string name, out int value);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_GetStatFloat(IntPtr self, string name, out float value);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_SetStatInt32(IntPtr self, string name, int value);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_SetStatFloat(IntPtr self, string name, float value);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_UpdateAvgRateStat(IntPtr self, string name, float countThisSession, double sessionLength);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_ResetAllStats(IntPtr self, [MarshalAs(UnmanagedType.I1)] bool achievementsToo);

    [DllImport("steam_api64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool SteamAPI_ISteamUserStats_StoreStats(IntPtr self);

    public static string PtrToString(IntPtr value)
    {
        return value == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(value);
    }
}
'@

  $initError = New-Object System.Text.StringBuilder 1024
  $initResult = [SteamFlatApi]::SteamAPI_InitFlat($initError)
  if ($initResult -ne 0) {
    $message = $initError.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($message)) { $message = "unknown initialization error" }
    throw "Steam API could not initialize for this app: $message"
  }
  Clear-TemporarySteamRegistry $steamRegistryPath $temporarySteamRegistryValue $temporarySteamRegistryKey
  $temporarySteamRegistryValue = $false
  $temporarySteamRegistryKey = $false
  $steamRegistryMutex.ReleaseMutex()
  $steamRegistryMutexHeld = $false

  $stats = [SteamFlatApi]::SteamAPI_SteamUserStats_v012()
  if ($stats -eq [IntPtr]::Zero) {
    throw "Steam did not return the user stats interface for this app."
  }
  $apps = [SteamFlatApi]::SteamAPI_SteamApps_v008()

  [SteamFlatApi]::SteamAPI_ISteamUserStats_RequestCurrentStats($stats) | Out-Null
  $first = $null
  if ($Action -eq 'apply' -or $Action -eq 'states') {
    $first = @($inputData | Where-Object { $_.id -or $_ } | Select-Object -First 1)[0]
  } elseif ($Action -eq 'stats-read' -or $Action -eq 'stats-set' -or $Action -eq 'stats-reset') {
    $first = @($inputData | Where-Object { $_.name } | Select-Object -First 1)[0]
  }
  for ($i = 0; $i -lt 80; $i++) {
    [SteamFlatApi]::SteamAPI_RunCallbacks()
    if ($null -eq $first) { break }
    if ($Action -eq 'stats-read' -or $Action -eq 'stats-set' -or $Action -eq 'stats-reset') {
      $firstType = [string]$first.type
      if ($firstType -notin @('int', 'float', 'avgrate')) {
        break
      } elseif ($firstType -eq 'float' -or $firstType -eq 'avgrate') {
        $firstValue = [single]0
        if ([SteamFlatApi]::SteamAPI_ISteamUserStats_GetStatFloat($stats, [string]$first.name, [ref]$firstValue)) { break }
      } else {
        $firstValue = [int]0
        if ([SteamFlatApi]::SteamAPI_ISteamUserStats_GetStatInt32($stats, [string]$first.name, [ref]$firstValue)) { break }
      }
    } else {
      $isAchieved = $false
      $firstId = if ($first.id) { [string]$first.id } else { [string]$first }
      if ([SteamFlatApi]::SteamAPI_ISteamUserStats_GetAchievement($stats, $firstId, [ref]$isAchieved)) { break }
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
  } elseif ($Action -eq 'stats-read') {
    foreach ($item in @($inputData)) {
      $name = [string]$item.name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $type = [string]$item.type
      $readable = $false
      $value = $null

      if ($type -notin @('int', 'float', 'avgrate')) {
        $result.stats += [ordered]@{
          name = $name
          type = $type
          value = $null
          readable = $false
          writable = $false
          errorCode = 'unsupported-type'
        }
        continue
      } elseif ($type -eq 'float' -or $type -eq 'avgrate') {
        $floatValue = [single]0
        $readable = [SteamFlatApi]::SteamAPI_ISteamUserStats_GetStatFloat($stats, $name, [ref]$floatValue)
        if ($readable) { $value = [double]$floatValue }
      } else {
        $intValue = [int]0
        $readable = [SteamFlatApi]::SteamAPI_ISteamUserStats_GetStatInt32($stats, $name, [ref]$intValue)
        if ($readable) { $value = $intValue }
      }

      $result.stats += [ordered]@{
        name = $name
        type = $type
        value = $value
        readable = $readable
        writable = $readable -and -not [bool]$item.changeProtected
        errorCode = if ($readable) { $null } else { 'not-returned' }
      }
    }
  } elseif ($Action -eq 'stats-reset') {
    if (-not [SteamFlatApi]::SteamAPI_ISteamUserStats_ResetAllStats($stats, $false)) {
      throw 'Steam rejected the stat reset.'
    }
    $result.reset = $true
    $result.stored = [SteamFlatApi]::SteamAPI_ISteamUserStats_StoreStats($stats)
  } elseif ($Action -eq 'stats-set') {
    foreach ($change in @($inputData)) {
      $name = [string]$change.name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $type = [string]$change.type
      $ok = $false

      if ($type -eq 'avgrate') {
        $count = [single]$change.count
        $sessionLength = [double]$change.sessionLength
        if ($sessionLength -le 0) {
          $result.failed += [ordered]@{ name = $name; type = $type; reason = 'invalid-average-rate-session' }
          continue
        }
        $ok = [SteamFlatApi]::SteamAPI_ISteamUserStats_UpdateAvgRateStat($stats, $name, $count, $sessionLength)
      } elseif ($type -eq 'float') {
        $ok = [SteamFlatApi]::SteamAPI_ISteamUserStats_SetStatFloat($stats, $name, [single]$change.value)
      } else {
        $ok = [SteamFlatApi]::SteamAPI_ISteamUserStats_SetStatInt32($stats, $name, [int]$change.value)
      }

      if ($ok) {
        $result.changed += [ordered]@{
          name = $name
          type = $type
          value = if ($type -eq 'avgrate') { $null } else { $change.value }
          count = if ($type -eq 'avgrate') { $change.count } else { $null }
          sessionLength = if ($type -eq 'avgrate') { $change.sessionLength } else { $null }
        }
      } else {
        $result.failed += [ordered]@{ name = $name; type = $type; reason = 'steam-rejected-stat-change' }
      }
    }

    if ($result.changed.Count -gt 0) {
      $result.stored = [SteamFlatApi]::SteamAPI_ISteamUserStats_StoreStats($stats)
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
    if ($Action -eq 'stats-read' -or $Action -eq 'stats-set' -or $Action -eq 'stats-reset') {
      $name = [string]$change.name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $alreadyHandled = @($result.changed | Where-Object { $_.name -eq $name }).Count -gt 0
      if (-not $alreadyHandled) {
        $result.failed += [ordered]@{ name = $name; type = [string]$change.type; reason = $_.Exception.Message }
      }
    } else {
      $id = [string]$change.id
      if ([string]::IsNullOrWhiteSpace($id)) { continue }
      $alreadyChanged = @($result.changed | Where-Object { $_.id -eq $id }).Count -gt 0
      if (-not $alreadyChanged) {
        $result.failed += [ordered]@{ id = $id; achieved = [bool]$change.achieved; reason = $_.Exception.Message }
      }
    }
  }
} finally {
  try { [SteamFlatApi]::SteamAPI_Shutdown() } catch {}
  Clear-TemporarySteamRegistry $steamRegistryPath $temporarySteamRegistryValue $temporarySteamRegistryKey
  if ($steamRegistryMutexHeld) {
    try { $steamRegistryMutex.ReleaseMutex() } catch {}
  }
  if ($null -ne $steamRegistryMutex) { $steamRegistryMutex.Dispose() }
}

Write-Result $result
