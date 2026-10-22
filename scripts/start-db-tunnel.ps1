param(
    [string]$HostName = '218.197.118.49',
    [int]$SshPort = 2222,
    [int]$LocalPort = 15432,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [int]$RetrySeconds = 5,
    [switch]$Once                       # connect once and stop when the connection ends (no automatic reconnect)
)

# Forwards 127.0.0.1:<LocalPort> to the database server's 127.0.0.1:5432 over SSH.
# - If a tunnel already answers on the local port, it says so and exits (no "Address already in use" error).
# - If the server closes or drops the connection, it reconnects after a short pause until you press Ctrl+C.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts with the ANSI code page.

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "SSH private key not found: $KeyPath"
}

# Prefer the Windows OpenSSH client; fall back to whatever ssh is on PATH (Git, conda).
$windowsSsh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$ssh = if (Test-Path -LiteralPath $windowsSsh) { $windowsSsh } else { (Get-Command ssh -ErrorAction Stop).Source }

function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        return ($wait.AsyncWaitHandle.WaitOne(1500) -and $client.Connected)
    } catch { return $false } finally { $client.Close() }
}

if (Test-LocalPort $LocalPort) {
    Write-Host "A tunnel is already running on 127.0.0.1:$LocalPort - nothing to do."
    Write-Host "(To restart it, close the window or process that opened it, then run this script again.)"
    return
}

$sshArgs = @(
    '-N', '-L', "127.0.0.1:${LocalPort}:127.0.0.1:5432", '-p', $SshPort, '-i', $KeyPath,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=20', '-o', 'TCPKeepAlive=yes',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    "administrator@$HostName"
)

Write-Host "Forwarding 127.0.0.1:$LocalPort to the server's 127.0.0.1:5432 (ssh: $ssh). Press Ctrl+C to stop."
$attempt = 0
while ($true) {
    $attempt++
    $started = Get-Date
    Write-Host ("[{0:HH:mm:ss}] Connecting to {1}:{2} (attempt {3})..." -f $started, $HostName, $SshPort, $attempt)
    & $ssh @sshArgs
    $code = $LASTEXITCODE
    $lasted = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ("[{0:HH:mm:ss}] SSH ended with exit code {1} after {2} s." -f (Get-Date), $code, $lasted)
    if ($Once) {
        if ($code -ne 0) { throw "SSH tunnel failed (exit code $code)." }
        return
    }
    if (Test-LocalPort $LocalPort) {
        Write-Host "Another tunnel is now serving 127.0.0.1:$LocalPort - stopping this one."
        return
    }
    if ($lasted -gt 60) { $attempt = 0 }    # a long-lived connection resets the back-off
    $pause = [Math]::Min(60, $RetrySeconds * [Math]::Max(1, $attempt))
    Write-Host "Reconnecting in $pause s (server unreachable or connection closed by the server)."
    Start-Sleep -Seconds $pause
}
