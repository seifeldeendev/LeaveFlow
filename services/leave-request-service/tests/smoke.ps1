# Quick end-to-end check of the Leave Request service running locally (npm run dev).
# Usage:  .\tests\smoke.ps1 [-Api http://<apiId>.execute-api.localhost.floci.io:4566]   (asks for the test password; nothing is saved)
param([string]$Api = 'http://localhost:3000')
$ErrorActionPreference = 'Stop'
$api = $Api.TrimEnd('/')
Write-Host "Testing $api"
$pw = if ($env:LEAVEFLOW_TEST_PASSWORD) { $env:LEAVEFLOW_TEST_PASSWORD } else { Read-Host 'Test password' }

function Call($method, $path, $token, $body) {
  $h = @{}; if ($token) { $h.Authorization = "Bearer $token" }
  try {
    $p = @{ Method = $method; Uri = "$api$path"; Headers = $h }
    if ($body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 5) }
    $r = Invoke-WebRequest @p -UseBasicParsing
    return @{ status = [int]$r.StatusCode; body = if ($r.Content) { $r.Content | ConvertFrom-Json } else { $null } }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $reader = New-Object IO.StreamReader($resp.GetResponseStream())
    return @{ status = [int]$resp.StatusCode; body = ($reader.ReadToEnd() | ConvertFrom-Json) }
  }
}
function Check($name, $res, $expected) {
  $ok = $res.status -eq $expected
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1}: got {2}, expected {3}" -f ($(if ($ok) {'PASS'} else {'FAIL'})), $name, $res.status, $expected) -ForegroundColor $color
  if (-not $ok -or $res.body.error) { $res.body | ConvertTo-Json -Depth 5 | Write-Host }
}
function Login($email) { (Call POST '/auth/login' $null @{ email = $email; password = $pw }).body.idToken }

$mona = Login 'mona.employee@leaveflow.test'
$omar = Login 'omar.employee@leaveflow.test'

# Next Sunday at least 8 days away, so the 7-day notice rule passes
$d = (Get-Date).AddDays(8); while ($d.DayOfWeek -ne 'Sunday') { $d = $d.AddDays(1) }
$start = $d.ToString('yyyy-MM-dd'); $end = $d.AddDays(2).ToString('yyyy-MM-dd')
$tomorrow = (Get-Date).AddDays(1).ToString('yyyy-MM-dd')

Check 'No token -> 401'                 (Call GET '/leave-requests' $null) 401
Check 'Preview working days'           (Call GET "/working-days?start=$start&end=$end&type=Annual" $mona) 200
Check 'Annual tomorrow -> notice rule'  (Call POST '/leave-requests' $mona @{ type='Annual'; start=$tomorrow; end=$tomorrow }) 422
Check 'Bad date -> 400'                 (Call POST '/leave-requests' $mona @{ type='Annual'; start='2026-02-30'; end='2026-03-01' }) 400
$sub = Call POST '/leave-requests' $mona @{ type='Annual'; start=$start; end=$end; reason='Family trip' }
Check "Submit Annual $start..$end"      $sub 201
$id = $sub.body.id
Check 'Same dates again -> overlap'     (Call POST '/leave-requests' $mona @{ type='Annual'; start=$start; end=$end }) 422
Check 'My profile (/me)'               (Call GET '/me' $mona) 200
Check 'My requests list'               (Call GET '/leave-requests?status=Pending' $mona) 200
Check 'Request details (owner)'        (Call GET "/leave-requests/$id" $mona) 200
Check "Omar opens Mona's request -> 404" (Call GET "/leave-requests/$id" $omar) 404
Check "Omar withdraws Mona's -> 404"     (Call PATCH "/leave-requests/$id/status" $omar @{ action='withdraw' }) 404
Check 'Mona withdraws her request'      (Call PATCH "/leave-requests/$id/status" $mona @{ action='withdraw' }) 200
Check 'Withdraw twice -> 409'           (Call PATCH "/leave-requests/$id/status" $mona @{ action='withdraw' }) 409
Check 'Not JSON -> 415'                 @{ status = try { (Invoke-WebRequest -Method Post -Uri "$api/leave-requests" -Headers @{Authorization="Bearer $mona"} -ContentType 'text/plain' -Body 'x' -UseBasicParsing).StatusCode } catch { [int]$_.Exception.Response.StatusCode } } 415
