param(
    [string[]]$Versions,                 # e.g. -Versions 0002,0003. Default: every file not yet in audit.schema_migration
    [switch]$DryRun,                     # run everything in one transaction, then roll back
    [string]$HostName = '127.0.0.1',
    [int]$Port = 15432,
    [string]$Database = 'greensystem'
)

# Applies database/migrations/*.sql as postgres. Each file does SET ROLE greensystem so that
# business objects are owned by the database owner and pick up the default privileges from 0001.
# Start the SSH tunnel first (scripts/start-db-tunnel.ps1).
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts with the ANSI code page.

$ErrorActionPreference = 'Stop'
$psql = Get-Command psql -ErrorAction Stop
$migrationDir = (Resolve-Path (Join-Path $PSScriptRoot '..\database\migrations')).Path
$adminSecretPath = Join-Path (Join-Path $env:LOCALAPPDATA 'XinyangCarbonPlatform') 'postgres-password.dpapi'

if (Test-Path -LiteralPath $adminSecretPath -PathType Leaf) {
    $securePassword = Get-Content -LiteralPath $adminSecretPath -Raw | ConvertTo-SecureString
} elseif ($env:PGPASSWORD) {
    $securePassword = ConvertTo-SecureString $env:PGPASSWORD -AsPlainText -Force
} else {
    $securePassword = Read-Host 'postgres password' -AsSecureString
}

$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$previousPassword = $env:PGPASSWORD
$previousEncoding = $env:PGCLIENTENCODING
try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:PGCLIENTENCODING = 'UTF8'
    $common = @('--no-psqlrc', '--no-password', '--host', $HostName, '--port', $Port, '--username', 'postgres', '--dbname', $Database)

    $applied = & $psql.Source @common -At -c 'select version from audit.schema_migration'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read audit.schema_migration. Is the tunnel running?' }

    $files = Get-ChildItem -LiteralPath $migrationDir -Filter '*.sql' | Sort-Object Name
    if ($Versions) {
        $files = @($files | Where-Object { $Versions -contains $_.Name.Substring(0, 4) })
    } else {
        $files = @($files | Where-Object { $applied -notcontains $_.Name.Substring(0, 4) })
    }
    if ($files.Count -eq 0) { Write-Host 'No pending migrations.'; return }

    # psql cannot reliably open files under non-ASCII paths on Windows, so the SQL text is
    # read here and piped to psql through stdin as UTF-8.
    $previousOutputEncoding = $OutputEncoding
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    try {
        if ($DryRun) {
            $sql = (@('\set ON_ERROR_STOP on', 'BEGIN;') +
                    ($files | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) +
                    @('ROLLBACK;')) -join "`n"
            Write-Host "Dry run, will roll back: $($files.Name -join ', ')"
            $sql | & $psql.Source @common -q -f -
            if ($LASTEXITCODE -ne 0) { throw "Dry run failed (psql exit code $LASTEXITCODE)." }
            Write-Host 'Dry run succeeded and was rolled back.'
        } else {
            foreach ($file in $files) {
                Write-Host "Applying $($file.Name)"
                [IO.File]::ReadAllText($file.FullName) | & $psql.Source @common -q --set ON_ERROR_STOP=1 --single-transaction -f -
                if ($LASTEXITCODE -ne 0) { throw "Migration $($file.Name) failed (psql exit code $LASTEXITCODE)." }
            }
        }
    } finally {
        $OutputEncoding = $previousOutputEncoding
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $env:PGPASSWORD = $previousPassword
    $env:PGCLIENTENCODING = $previousEncoding
}
