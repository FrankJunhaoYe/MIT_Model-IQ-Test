$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '请先安装 Node.js 22 或更新版本。'
}
Write-Host '启动后请打开 http://127.0.0.1:8080；关闭此进程即停止服务。'
& node (Join-Path $PSScriptRoot 'server.cjs')
