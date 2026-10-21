$ErrorActionPreference = 'Stop'
$runner = (Resolve-Path (Join-Path $PSScriptRoot 'run-weather-sync.ps1')).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$amapAction = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -File "{0}" -Source amap' -f $runner)
$nasaAction = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -File "{0}" -Source nasa' -f $runner)
$nextHour = (Get-Date).Date.AddHours((Get-Date).Hour + 1)
$amapTrigger = New-ScheduledTaskTrigger -Once -At $nextHour `
    -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$nasaTrigger = New-ScheduledTaskTrigger -Daily -At ((Get-Date).Date.AddHours(2))

Register-ScheduledTask -TaskName 'XinyangCarbonPlatform-AMapWeather' -Action $amapAction `
    -Trigger $amapTrigger -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName 'XinyangCarbonPlatform-NasaPower' -Action $nasaAction `
    -Trigger $nasaTrigger -Principal $principal -Settings $settings -Force | Out-Null

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dbLine = Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'DATABASE_URL missing from .env' }
$databaseUrl = $dbLine.Substring('DATABASE_URL='.Length).Trim().Trim('"')
$psql = (Get-Command psql -ErrorAction Stop).Source
& $psql $databaseUrl -X -q -v ON_ERROR_STOP=1 -c `
    "update raw.api_source set enabled=true, schedule_cron=case code when 'AMAP_WEATHER' then '0 * * * *' else '0 2 * * *' end where code in ('AMAP_WEATHER','NASA_POWER_DAILY','NASA_POWER_HOURLY')"
if ($LASTEXITCODE -ne 0) { throw 'Registered tasks, but could not enable database source metadata' }

Get-ScheduledTask -TaskName 'XinyangCarbonPlatform-AMapWeather','XinyangCarbonPlatform-NasaPower' |
    Select-Object TaskName, State
