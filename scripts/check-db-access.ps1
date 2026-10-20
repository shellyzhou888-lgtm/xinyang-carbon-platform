param(
    [ValidateSet('postgres', 'zyz')]
    [string]$User = 'zyz',
    [string]$HostName = '127.0.0.1',
    [int]$Port = 15432,
    [string]$Database = 'greensystem'
)

$ErrorActionPreference = 'Stop'
$psql = Get-Command psql -ErrorAction Stop
$sql = Join-Path $PSScriptRoot '..\database\access_audit.sql'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env'
$adminSecretPath = Join-Path (Join-Path $env:LOCALAPPDATA 'XinyangCarbonPlatform') 'postgres-password.dpapi'

if ($User -eq 'zyz' -and (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line -notmatch '^DATABASE_URL="([^"]+)"$') { throw 'Invalid DATABASE_URL in local .env.' }
    $connectionUri = [uri]$Matches[1]
    if ($connectionUri.UserInfo -notmatch '^zyz:(.+)$') { throw 'Local DATABASE_URL must use the zyz account.' }
    $password = [uri]::UnescapeDataString($Matches[1])
} elseif ($User -eq 'postgres' -and (Test-Path -LiteralPath $adminSecretPath -PathType Leaf)) {
    $securePassword = (Get-Content -LiteralPath $adminSecretPath -Raw).Trim() | ConvertTo-SecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}

$previousPassword = $env:PGPASSWORD
try {
    if ($password) {
        $env:PGPASSWORD = $password
        $passwordOption = '--no-password'
    } else {
        $passwordOption = '--password'
    }
    Write-Host "Checking $Database as $User via ${HostName}:$Port."
    & $psql.Source --no-psqlrc $passwordOption --set ON_ERROR_STOP=1 --pset pager=off --host $HostName --port $Port --username $User --dbname $Database --file $sql
    if ($LASTEXITCODE -ne 0) {
        throw "Database access check failed (psql exit code $LASTEXITCODE)."
    }
} finally {
    $env:PGPASSWORD = $previousPassword
}
