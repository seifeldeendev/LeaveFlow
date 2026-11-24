# LeaveFlow - Leave Request Service (owner: Sohaila)
# Deploys this service onto Floci: KMS key, private certificates bucket, Secrets Manager secret,
# IAM role (least privilege), Lambda requests-fn, log group, and the requests-api HTTP API with a Cognito JWT authorizer.
# Safe to run again: existing resources are reused and the Lambda code is updated.
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
#       add -SkipBalanceCheck only until Seif's balance-projection-fn is deployed.
param([switch]$SkipBalanceCheck)

$ErrorActionPreference = 'Stop'
$Endpoint = if ($env:AWS_ENDPOINT_URL) { $env:AWS_ENDPOINT_URL } else { 'http://localhost:4566' }
$Region   = 'us-east-1'
$env:AWS_DEFAULT_REGION = $Region
$Root     = Split-Path $PSScriptRoot -Parent
$Tmp      = Join-Path $env:TEMP 'leaveflow-deploy'
New-Item -ItemType Directory -Force $Tmp | Out-Null

# Inside Lambda containers "localhost" is the container itself; Docker Desktop reaches Floci via this name.
$InsideEndpoint = 'http://host.docker.internal:4566'
$FrontendOrigin = 'http://localhost:8080'
$FnName = 'requests-fn'; $RoleName = 'requests-fn-role'; $ApiName = 'requests-api'
$Bucket = 'leaveflow-certificates'; $KeyAlias = 'alias/leaveflow-certificates'; $SecretName = 'leaveflow/requests'

function Invoke-Aws {
    # Floci prepares the Lambda container while creating the function, which can take minutes the first time.
    $out = & aws --endpoint-url $Endpoint --cli-read-timeout 600 @args
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed: aws $($args -join ' ')" }
    return $out
}
function Invoke-AwsJson { (Invoke-Aws @args --output json) -join "`n" | ConvertFrom-Json }
# Quiet yes/no check. Windows PowerShell 5 turns any stderr text into a fatal error under 'Stop', so relax it here only.
function Test-Aws {
    $ErrorActionPreference = 'Continue'
    & aws --endpoint-url $Endpoint @args 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}
# JSON goes through files: Windows PowerShell 5 breaks quotes in JSON arguments. UTF-8 without BOM.
function JsonFile($name, $text) { $p = Join-Path $Tmp $name; [IO.File]::WriteAllText($p, $text); return "file://$p" }
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# Settings from the Cognito step
$cog = Get-Content (Join-Path $PSScriptRoot 'cognito-outputs.json') -Raw | ConvertFrom-Json
$PoolId = $cog.userPoolId; $ClientId = $cog.clientId
$Issuer = "http://localhost:4566/$PoolId"
$Account = Invoke-Aws sts get-caller-identity --query Account --output text

# ---------- 1. KMS key for medical certificates ----------
Step 'KMS key'
$KeyArn = Invoke-Aws kms list-aliases --query "Aliases[?AliasName=='$KeyAlias'].TargetKeyId | [0]" --output text
if (-not $KeyArn -or $KeyArn -eq 'None') {
    $KeyId = Invoke-Aws kms create-key --description 'LeaveFlow medical certificates' --query KeyMetadata.KeyId --output text
    Invoke-Aws kms create-alias --alias-name $KeyAlias --target-key-id $KeyId | Out-Null
    try { Invoke-Aws kms enable-key-rotation --key-id $KeyId | Out-Null } catch { Write-Warning 'Key rotation not supported by Floci' }
    Write-Host "Created key $KeyId"
} else { $KeyId = $KeyArn; Write-Host "Key exists: $KeyId" }
$KeyArn = Invoke-Aws kms describe-key --key-id $KeyId --query KeyMetadata.Arn --output text

# ---------- 2. Private, encrypted S3 bucket ----------
Step 'Certificates bucket'
if (Test-Aws s3api head-bucket --bucket $Bucket) { Write-Host "Bucket exists: $Bucket" }
else { Invoke-Aws s3api create-bucket --bucket $Bucket | Out-Null; Write-Host "Created bucket $Bucket" }
Invoke-Aws s3api put-public-access-block --bucket $Bucket --public-access-block-configuration `
    (JsonFile 'pab.json' '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}') | Out-Null
Invoke-Aws s3api put-bucket-encryption --bucket $Bucket --server-side-encryption-configuration `
    (JsonFile 'enc.json' "{`"Rules`":[{`"ApplyServerSideEncryptionByDefault`":{`"SSEAlgorithm`":`"aws:kms`",`"KMSMasterKeyID`":`"$KeyArn`"},`"BucketKeyEnabled`":true}]}") | Out-Null
Invoke-Aws s3api put-bucket-cors --bucket $Bucket --cors-configuration `
    (JsonFile 'cors.json' "{`"CORSRules`":[{`"AllowedOrigins`":[`"$FrontendOrigin`"],`"AllowedMethods`":[`"POST`",`"GET`"],`"AllowedHeaders`":[`"*`"],`"MaxAgeSeconds`":300}]}") | Out-Null
$bp = (Get-Content (Join-Path $PSScriptRoot 'policies\certificates-bucket-policy.json') -Raw).Replace('__ACCOUNT__', $Account)
Invoke-Aws s3api put-bucket-policy --bucket $Bucket --policy (JsonFile 'bucket-policy.json' $bp) | Out-Null
try { Invoke-Aws s3api put-bucket-versioning --bucket $Bucket --versioning-configuration Status=Enabled | Out-Null } catch {}
Write-Host 'Public access blocked, KMS encryption by default, CORS for the frontend, bucket policy applied'

# ---------- 3. Database URL in Secrets Manager ----------
Step 'Secret'
$envFile = Join-Path $Root '.env'
$dbUrl = $null
if (Test-Path $envFile) { $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1; if ($line) { $dbUrl = $line.Matches[0].Groups[1].Value.Trim() } }
if (-not $dbUrl) { $dbUrl = Read-Host 'Neon connection string' }
$secretFile = JsonFile 'secret.json' (@{ databaseUrl = $dbUrl } | ConvertTo-Json -Compress)
if (Test-Aws secretsmanager describe-secret --secret-id $SecretName) {
    Invoke-Aws secretsmanager put-secret-value --secret-id $SecretName --secret-string $secretFile | Out-Null; Write-Host 'Secret updated'
} else {
    Invoke-Aws secretsmanager create-secret --name $SecretName --description 'Neon URL for the leave request service' --secret-string $secretFile | Out-Null; Write-Host 'Secret created'
}
Remove-Item ($secretFile -replace '^file://', '') -Force   # never leave the password on disk

# ---------- 4. IAM role with least privilege ----------
Step 'IAM role'
if (-not (Test-Aws iam get-role --role-name $RoleName)) {
    Invoke-Aws iam create-role --role-name $RoleName --assume-role-policy-document ("file://" + (Join-Path $PSScriptRoot 'policies\lambda-trust.json')) | Out-Null
    Write-Host "Created role $RoleName"
} else { Write-Host "Role exists: $RoleName" }
$pol = (Get-Content (Join-Path $PSScriptRoot 'policies\requests-fn-policy.json') -Raw).Replace('__REGION__', $Region).Replace('__ACCOUNT__', $Account).Replace('__KMS_KEY_ARN__', $KeyArn)
Invoke-Aws iam put-role-policy --role-name $RoleName --policy-name requests-fn-least-privilege --policy-document (JsonFile 'role-policy.json' $pol) | Out-Null
$RoleArn = Invoke-Aws iam get-role --role-name $RoleName --query Role.Arn --output text

# ---------- 5. Build and deploy the Lambda ----------
Step 'Lambda build'
$build = Join-Path $Tmp 'build'; $zip = Join-Path $Tmp 'requests-fn.zip'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory $build | Out-Null
Copy-Item (Join-Path $Root 'src') $build -Recurse
Copy-Item (Join-Path $Root 'package.json'), (Join-Path $Root 'package-lock.json') $build
Push-Location $build
try { npm ci --omit=dev --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }
if (Test-Path $zip) { Remove-Item $zip -Force }
tar.exe -a -c -f $zip -C $build src node_modules package.json
Write-Host ("Package size: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

Step 'Lambda function'
$vars = [ordered]@{
    AWS_ENDPOINT_URL = $InsideEndpoint
    COGNITO_USER_POOL_ID = $PoolId; COGNITO_CLIENT_ID = $ClientId
    COGNITO_ISSUER = $Issuer; COGNITO_JWKS_URL = "$InsideEndpoint/$PoolId/.well-known/jwks.json"
    CORS_ORIGIN = $FrontendOrigin; SECRET_NAME = $SecretName; EVENT_BUS_NAME = 'leaveflow-bus'
    BALANCE_PROJECTION_FN = 'balance-projection-fn'; BALANCE_CHECK = $(if ($SkipBalanceCheck) { 'off' } else { 'on' })
    CERT_BUCKET = $Bucket; CERT_KMS_KEY_ID = $KeyArn; S3_PUBLIC_ENDPOINT = 'http://localhost:4566'; NODE_ENV = 'production'
}
$envArg = JsonFile 'lambda-env.json' (@{ Variables = $vars } | ConvertTo-Json -Compress)
if ($SkipBalanceCheck) { Write-Warning 'Balance check is OFF. Redeploy without -SkipBalanceCheck once Seif''s function exists.' }

if (Test-Aws lambda get-function --function-name $FnName) {
    Invoke-Aws lambda update-function-code --function-name $FnName --zip-file "fileb://$zip" | Out-Null
    try { Invoke-Aws lambda wait function-updated --function-name $FnName } catch {}
    Invoke-Aws lambda update-function-configuration --function-name $FnName --environment $envArg --timeout 30 --memory-size 512 | Out-Null
    Write-Host "Updated $FnName"
} else {
    Invoke-Aws lambda create-function --function-name $FnName --runtime nodejs20.x --handler src/handler.handler `
        --role $RoleArn --zip-file "fileb://$zip" --timeout 30 --memory-size 512 --environment $envArg | Out-Null
    Write-Host "Created $FnName"
}
try { Invoke-Aws lambda wait function-active-v2 --function-name $FnName } catch {}
$FnArn = Invoke-Aws lambda get-function --function-name $FnName --query Configuration.FunctionArn --output text

$logGroup = "/aws/lambda/$FnName"
if (Test-Aws logs create-log-group --log-group-name $logGroup) { Write-Host "Created log group $logGroup" }
Invoke-Aws logs put-retention-policy --log-group-name $logGroup --retention-in-days 14 | Out-Null

# ---------- 6. HTTP API with Cognito JWT authorizer ----------
Step 'API Gateway'
$api = (Invoke-AwsJson apigatewayv2 get-apis).Items | Where-Object Name -eq $ApiName | Select-Object -First 1
if (-not $api) { $api = Invoke-AwsJson apigatewayv2 create-api --name $ApiName --protocol-type HTTP; Write-Host "Created $ApiName" }
$ApiId = $api.ApiId

$auth = (Invoke-AwsJson apigatewayv2 get-authorizers --api-id $ApiId).Items | Where-Object Name -eq 'cognito-jwt' | Select-Object -First 1
$jwtCfg = JsonFile 'jwt.json' (@{ Audience = @($ClientId); Issuer = $Issuer } | ConvertTo-Json -Compress)
if (-not $auth) {
    $auth = Invoke-AwsJson apigatewayv2 create-authorizer --api-id $ApiId --name cognito-jwt --authorizer-type JWT `
        --identity-source '$request.header.Authorization' --jwt-configuration $jwtCfg
}
$AuthId = $auth.AuthorizerId

$int = (Invoke-AwsJson apigatewayv2 get-integrations --api-id $ApiId).Items | Where-Object IntegrationUri -eq $FnArn | Select-Object -First 1
if (-not $int) {
    $int = Invoke-AwsJson apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY `
        --integration-uri $FnArn --payload-format-version 2.0
}
$IntId = $int.IntegrationId

# Public routes: login steps (Cognito checks the password or token itself), health, CORS preflight.
$public = 'POST /auth/login', 'POST /auth/mfa', 'POST /auth/mfa/setup', 'POST /auth/mfa/verify', 'POST /auth/refresh', 'POST /auth/logout', 'GET /health', 'OPTIONS /{proxy+}'
# Protected routes: API Gateway rejects a missing or bad token with 401 before Lambda runs.
$protected = 'GET /auth/me', 'GET /me', 'GET /working-days', 'ANY /leave-requests', 'ANY /leave-requests/{proxy+}'
$existing = (Invoke-AwsJson apigatewayv2 get-routes --api-id $ApiId).Items
foreach ($rk in $public + $protected) {
    $isProtected = $protected -contains $rk
    $route = $existing | Where-Object RouteKey -eq $rk | Select-Object -First 1
    $authArgs = if ($isProtected) { @('--authorization-type', 'JWT', '--authorizer-id', $AuthId) } else { @('--authorization-type', 'NONE') }
    if ($route) { Invoke-Aws apigatewayv2 update-route --api-id $ApiId --route-id $route.RouteId --target "integrations/$IntId" @authArgs | Out-Null }
    else { Invoke-Aws apigatewayv2 create-route --api-id $ApiId --route-key $rk --target "integrations/$IntId" @authArgs | Out-Null }
    Write-Host ("  {0,-32} {1}" -f $rk, $(if ($isProtected) { 'JWT' } else { 'public' }))
}

$stages = (Invoke-AwsJson apigatewayv2 get-stages --api-id $ApiId).Items
if (-not ($stages | Where-Object StageName -eq '$default')) {
    Invoke-Aws apigatewayv2 create-stage --api-id $ApiId --stage-name '$default' --auto-deploy `
        --default-route-settings 'ThrottlingBurstLimit=20,ThrottlingRateLimit=10' | Out-Null
}

# Who may invoke the function: this API, and EventBridge rules on leaveflow-bus (Ammar's approved/rejected rules).
foreach ($p in @(
    @{ id = 'requests-api-invoke'; principal = 'apigateway.amazonaws.com'; arn = "arn:aws:execute-api:${Region}:${Account}:$ApiId/*/*" },
    @{ id = 'leaveflow-bus-rules'; principal = 'events.amazonaws.com';     arn = "arn:aws:events:${Region}:${Account}:rule/leaveflow-bus/*" })) {
    if (-not (Test-Aws lambda add-permission --function-name $FnName --statement-id $p.id --action lambda:InvokeFunction --principal $p.principal --source-arn $p.arn)) {
        Write-Host "  permission $($p.id) already present"
    }
}

# ---------- 7. Outputs and smoke test ----------
$ApiUrl = "http://$ApiId.execute-api.localhost.floci.io:4566"
@{ apiId = $ApiId; apiUrl = $ApiUrl; functionArn = $FnArn; kmsKeyArn = $KeyArn; bucket = $Bucket; secretName = $SecretName } |
    ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'requests-outputs.json')
Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

Step 'Smoke test'
Write-Host "API: $ApiUrl"
Write-Host 'First call can take ~30 s while Floci starts the Lambda container...'
try {
    $h = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 90
    Write-Host "GET /health -> $($h.status)" -ForegroundColor Green
} catch { Write-Warning "GET /health failed: $($_.Exception.Message)" }
try { Invoke-RestMethod "$ApiUrl/leave-requests" -TimeoutSec 30 | Out-Null; Write-Warning 'No token was accepted - check the JWT authorizer' }
catch {
    if ($_.Exception.Response) { Write-Host "GET /leave-requests without token -> $([int]$_.Exception.Response.StatusCode) (expected 401)" -ForegroundColor Green }
    else { Write-Warning "Could not reach the API: $($_.Exception.Message)" }
}
Write-Host "`nDone. Share apiUrl with the team: $ApiUrl"
