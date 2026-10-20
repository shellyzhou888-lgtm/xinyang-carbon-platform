param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env'
$secretDirectory = Join-Path $env:LOCALAPPDATA 'XinyangCarbonPlatform'
$adminSecretPath = Join-Path $secretDirectory 'postgres-password.dpapi'

function Protect-LocalFile([string]$Path) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
    foreach ($sid in @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        $account = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($account, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

$appPassword = Read-Host 'Application account (zyz) password' -AsSecureString
$adminPassword = Read-Host 'Administrator account (postgres) password' -AsSecureString
if ($appPassword.Length -eq 0 -or $adminPassword.Length -eq 0) {
    throw 'Both passwords are required.'
}

$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($appPassword)
try {
    $encodedPassword = [uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer))
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

$databaseUrl = "postgresql://zyz:$encodedPassword@127.0.0.1:15432/greensystem"
Set-Content -LiteralPath $envPath -Value "DATABASE_URL=`"$databaseUrl`"" -Encoding utf8
Protect-LocalFile $envPath

New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
$adminPassword | ConvertFrom-SecureString | Set-Content -LiteralPath $adminSecretPath -Encoding ascii
Protect-LocalFile $adminSecretPath

Write-Host "Local application configuration: $envPath"
Write-Host "Encrypted administrator credential: $adminSecretPath"
Write-Host 'No password was added to Git.'
