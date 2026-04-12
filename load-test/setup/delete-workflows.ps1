# ─────────────────────────────────────────────────────────────────
# 부하테스트용 워크플로우 삭제 스크립트 (PowerShell)
#
# 사용법:
#   .\setup\delete-workflows.ps1
#   .\setup\delete-workflows.ps1 -BaseUrl http://192.168.1.10:8080
#   .\setup\delete-workflows.ps1 -Password mypass
# ─────────────────────────────────────────────────────────────────

param(
    [string]$BaseUrl  = "http://localhost:8080",
    [string]$Password = "admin"
)

# UTF-8 콘솔 출력 강제 (한글 깨짐 방지)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  부하테스트 워크플로우 삭제"
Write-Host "  서버: $BaseUrl"
Write-Host "===================================================" -ForegroundColor Cyan

function Remove-Workflow {
    param(
        [string]$UnitId,
        [string]$DisplayName
    )

    Write-Host ""
    Write-Host "  [$UnitId] $DisplayName 삭제 중..." -ForegroundColor Yellow

    $bodyJson  = "{`"unitId`":`"$UnitId`",`"modifiedBy`":`"load-test-cleanup`",`"password`":`"$Password`"}"
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

    try {
        $response = Invoke-RestMethod `
            -Uri "$BaseUrl/synapse/workflow/units" `
            -Method Delete `
            -ContentType "application/json; charset=utf-8" `
            -Body $bodyBytes `
            -TimeoutSec 10

        if ($response.success -eq $true) {
            Write-Host "  v 삭제 완료" -ForegroundColor Green
        } else {
            Write-Host "  - 삭제 실패: $($response.message)" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  - 없거나 이미 삭제됨" -ForegroundColor DarkGray
    }
}

Remove-Workflow "lt-simple"    "[부하테스트] 최소 파이프라인"
Remove-Workflow "lt-pipeline"  "[부하테스트] 풀 파이프라인"
Remove-Workflow "lt-websocket" "[부하테스트] WebSocket 서버"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  v 삭제 완료" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan
