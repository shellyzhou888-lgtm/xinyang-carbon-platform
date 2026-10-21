param([ValidateSet('amap','nasa')][string]$Source = 'amap')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $root 'storage\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir 'weather-sync.log'

function Test-LocalPort([int]$Port) {
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $socket.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(1500)) { return $false }
        $socket.EndConnect($attempt)
        return $true
    } catch { return $false } finally { $socket.Close() }
}

try {
    if (-not (Test-LocalPort 15432)) {
        $ssh = (Get-Command ssh -ErrorAction Stop).Source
        $key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
        if (-not (Test-Path -LiteralPath $key -PathType Leaf)) { throw 'SSH key unavailable' }
        $sshArgs = @('-N','-L','127.0.0.1:15432:127.0.0.1:5432','-p','2222','-i',('"' + $key + '"'),
            '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
            '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','administrator@218.197.118.49')
        Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden
        for ($i = 0; $i -lt 10 -and -not (Test-LocalPort 15432); $i++) { Start-Sleep -Seconds 1 }
        if (-not (Test-LocalPort 15432)) { throw 'Database tunnel unavailable' }
    }

    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $packageDir = Join-Path $root 'packages\ingest'
    Push-Location $packageDir
    try {
        & $npm run sync:weather -- "--source=$Source" 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw "Weather sync failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
} catch {
    ('{0:o} [{1}] ERROR {2}' -f (Get-Date), $Source, $_.Exception.Message) |
        Out-File -LiteralPath $logPath -Append -Encoding utf8
    throw
}
