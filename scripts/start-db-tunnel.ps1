param(
    [string]$HostName = '218.197.118.49',
    [int]$SshPort = 2222,
    [int]$LocalPort = 15432,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519')
)

$ErrorActionPreference = 'Stop'
$ssh = Get-Command ssh -ErrorAction Stop
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "SSH private key not found: $KeyPath"
}

Write-Host "Forwarding 127.0.0.1:$LocalPort to the server's 127.0.0.1:5432. Press Ctrl+C to stop."
& $ssh.Source -N -L "127.0.0.1:${LocalPort}:127.0.0.1:5432" -p $SshPort -i $KeyPath -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 "administrator@$HostName"
if ($LASTEXITCODE -ne 0) {
    throw "SSH tunnel failed (exit code $LASTEXITCODE)."
}
