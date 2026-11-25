# LeaveFlow - Leave Request Service (owner: Sohaila)
# Creates the Cognito user pool, MFA settings, groups, app client and test users on Floci.
# Safe to run more than once: anything that already exists is reused, not duplicated.
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\deploy-cognito.ps1

$ErrorActionPreference = 'Stop'
$Endpoint = if ($env:AWS_ENDPOINT_URL) { $env:AWS_ENDPOINT_URL } else { 'http://localhost:4566' }

function Invoke-Aws {
    $out = & aws --endpoint-url $Endpoint @args
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed: aws $($args -join ' ')" }
    return $out
}

# Existence check that stays quiet (the CLI prints 'not found' in red otherwise)
# Windows PowerShell 5 turns stderr text into a fatal error under 'Stop', so relax it here only.
function Test-Aws {
    $ErrorActionPreference = 'Continue'
    & aws --endpoint-url $Endpoint @args 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# Test-user password: never stored in this file. Set LEAVEFLOW_TEST_PASSWORD or type it when asked.
$pw = $env:LEAVEFLOW_TEST_PASSWORD
if (-not $pw) {
    $sec = Read-Host 'Password for the test users (10+ chars, upper, lower, number)' -AsSecureString
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# 1. User pool
$poolName = 'leaveflow-users'
$pool = Invoke-Aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='$poolName'].Id | [0]" --output text
if (-not $pool -or $pool -eq 'None') {
    Write-Host 'Creating user pool...'
    $pool = Invoke-Aws cognito-idp create-user-pool --pool-name $poolName `
        --username-attributes email --auto-verified-attributes email `
        --policies 'PasswordPolicy={MinimumLength=10,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' `
        --schema 'Name=department,AttributeDataType=String,Mutable=true' 'Name=managerId,AttributeDataType=String,Mutable=true' 'Name=joinDate,AttributeDataType=String,Mutable=true' `
        --query UserPool.Id --output text
} else { Write-Host "User pool exists: $pool" }

# 2. MFA: optional at pool level; the login code requires it for Manager and HRAdmin
try {
    Invoke-Aws cognito-idp set-user-pool-mfa-config --user-pool-id $pool `
        --software-token-mfa-configuration Enabled=true --mfa-configuration OPTIONAL | Out-Null
    Write-Host 'MFA (authenticator app) enabled as OPTIONAL'
} catch { Write-Warning "MFA config not accepted by Floci: $_  (note this as a limitation)" }

# 3. Groups = roles
foreach ($g in 'Employee', 'Manager', 'HRAdmin') {
    if (Test-Aws cognito-idp get-group --user-pool-id $pool --group-name $g) { Write-Host "Group exists: $g" }
    else { Invoke-Aws cognito-idp create-group --user-pool-id $pool --group-name $g | Out-Null; Write-Host "Group created: $g" }
}

# 4. App client (no secret, short tokens)
$clientName = 'leaveflow-web'
$client = Invoke-Aws cognito-idp list-user-pool-clients --user-pool-id $pool --max-results 60 --query "UserPoolClients[?ClientName=='$clientName'].ClientId | [0]" --output text
if (-not $client -or $client -eq 'None') {
    $client = Invoke-Aws cognito-idp create-user-pool-client --user-pool-id $pool --client-name $clientName `
        --no-generate-secret --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH `
        --id-token-validity 15 --access-token-validity 15 --refresh-token-validity 8 `
        --token-validity-units 'IdToken=minutes,AccessToken=minutes,RefreshToken=hours' `
        --query UserPoolClient.ClientId --output text
    Write-Host "App client created: $client"
} else { Write-Host "App client exists: $client" }

# 5. Test users (managers first, so employees can point to them)
$users = @(
    @{ email='sara.manager@leaveflow.test';  group='Manager';  dept='Sales';       mgr='';                             join='2023-02-01' },
    @{ email='karim.manager@leaveflow.test'; group='Manager';  dept='Engineering'; mgr='';                             join='2022-09-15' },
    @{ email='hana.hr@leaveflow.test';       group='HRAdmin';  dept='HR';          mgr='';                             join='2021-05-10' },
    @{ email='mona.employee@leaveflow.test'; group='Employee'; dept='Sales';       mgr='sara.manager@leaveflow.test';  join='2024-03-01' },
    @{ email='omar.employee@leaveflow.test'; group='Employee'; dept='Sales';       mgr='sara.manager@leaveflow.test';  join='2026-07-16' },
    @{ email='ali.employee@leaveflow.test';  group='Employee'; dept='Engineering'; mgr='karim.manager@leaveflow.test'; join='2025-01-05' },
    @{ email='nour.employee@leaveflow.test'; group='Employee'; dept='Engineering'; mgr='karim.manager@leaveflow.test'; join='2024-11-20' }
)
$subs = @{}
foreach ($u in $users) {
    $exists = Test-Aws cognito-idp admin-get-user --user-pool-id $pool --username $u.email
    if (-not $exists) {
        $mgrSub = if ($u.mgr) { $subs[$u.mgr] } else { '' }
        Invoke-Aws cognito-idp admin-create-user --user-pool-id $pool --username $u.email --message-action SUPPRESS `
            --user-attributes "Name=email,Value=$($u.email)" 'Name=email_verified,Value=true' `
            "Name=custom:department,Value=$($u.dept)" "Name=custom:managerId,Value=$mgrSub" "Name=custom:joinDate,Value=$($u.join)" | Out-Null
        Invoke-Aws cognito-idp admin-set-user-password --user-pool-id $pool --username $u.email --password $pw --permanent | Out-Null
        Invoke-Aws cognito-idp admin-add-user-to-group --user-pool-id $pool --username $u.email --group-name $u.group | Out-Null
        Write-Host "User created: $($u.email) [$($u.group), $($u.dept)]"
    } else { Write-Host "User exists: $($u.email)" }
    $subs[$u.email] = Invoke-Aws cognito-idp admin-get-user --user-pool-id $pool --username $u.email --query "UserAttributes[?Name=='sub'].Value | [0]" --output text
}

# 6. Save the non-secret ids the team needs
$outFile = Join-Path $PSScriptRoot 'cognito-outputs.json'
@{ userPoolId = $pool; clientId = $client; region = 'us-east-1'; endpoint = $Endpoint } | ConvertTo-Json | Out-File -Encoding ascii $outFile
Write-Host ''
Write-Host "Saved $outFile  (pool id and client id are not secrets; share them with Ammar and Seif)"

# 7. Smoke test: log in as an employee (prints only whether it worked, never the token)
$auth = Invoke-Aws cognito-idp initiate-auth --client-id $client --auth-flow USER_PASSWORD_AUTH `
    --auth-parameters "USERNAME=mona.employee@leaveflow.test,PASSWORD=$pw" --query 'AuthenticationResult.IdToken' --output text
if ($auth -and $auth -ne 'None') { Write-Host "Login test OK for mona.employee (token length $($auth.Length))" }
else { Write-Warning 'Login test did not return a token' }

# 8. Show the token issuer URL Floci uses (needed for the API Gateway JWT authorizer)
try { Invoke-RestMethod "$Endpoint/$pool/.well-known/openid-configuration" | Select-Object issuer, jwks_uri | Format-List }
catch { Write-Warning "Could not read the OpenID configuration at $Endpoint/$pool/.well-known/openid-configuration" }
