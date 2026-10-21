# Registers an hourly Windows scheduled task that runs semantic-catalog governance only when something changed
# (imports, direct writes, new tables: see migration 0034). Run once from PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-governance-task.ps1
# Remove with: Unregister-ScheduledTask -TaskName 'XinyangCarbonPlatform-Governance' -Confirm:$false
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$agentDir = Join-Path $root 'packages\db-agent'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$tsx = Join-Path $agentDir 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $tsx)) { throw "packages/db-agent dependencies are missing; run npm install in packages/db-agent first." }

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$action = New-ScheduledTaskAction -Execute $node -WorkingDirectory $agentDir `
    -Argument ('"{0}" src/govern-cli.ts --if-changed --trigger schedule --docs 12' -f $tsx)
$start = (Get-Date).Date.AddHours((Get-Date).Hour + 1).AddMinutes(15)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName 'XinyangCarbonPlatform-Governance' -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName 'XinyangCarbonPlatform-Governance' | Select-Object TaskName, State
