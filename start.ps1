# Start both API and Web servers
Write-Host "Starting Agentic Stock Notifier..." -ForegroundColor Cyan

$apiJob = Start-Process powershell -ArgumentList "-NoExit -Command `"cd '$PSScriptRoot\apps\api'; npx tsx src/index.ts`"" -PassThru
$webJob = Start-Process powershell -ArgumentList "-NoExit -Command `"cd '$PSScriptRoot\apps\web'; npx next dev`"" -PassThru

Write-Host "API:  http://localhost:3001" -ForegroundColor Green
Write-Host "Web:  http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop..." -ForegroundColor Yellow

try {
  Wait-Process -Id $apiJob.Id, $webJob.Id
} finally {
  Stop-Process -Id $apiJob.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $webJob.Id -Force -ErrorAction SilentlyContinue
}
