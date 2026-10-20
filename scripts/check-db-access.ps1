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

Write-Host "Checking $Database as $User via ${HostName}:$Port. psql will prompt for the password."
& $psql.Source --no-psqlrc --password --set ON_ERROR_STOP=1 --pset pager=off --host $HostName --port $Port --username $User --dbname $Database --file $sql
if ($LASTEXITCODE -ne 0) {
    throw "Database access check failed (psql exit code $LASTEXITCODE)."
}
