$Targets = @($args)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$subject = "CN=Parts Manager PM Local Code Signing"
$friendlyName = "Parts Manager PM Local Code Signing"

$cert = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object {
    $_.Subject -eq $subject -and
    $_.HasPrivateKey -and
    ($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq "1.3.6.1.5.5.7.3.3" })
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -FriendlyName $friendlyName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(5)
}

$certFile = Join-Path $env:TEMP "parts-manager-pm-local-code-signing.cer"
Export-Certificate -Cert $cert -FilePath $certFile | Out-Null

Import-Certificate -FilePath $certFile -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Import-Certificate -FilePath $certFile -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null

if (-not $Targets.Count) {
  $Targets = @(
    (Join-Path $repoRoot "release\win-unpacked\Parts Manager PM.exe"),
    (Join-Path $repoRoot "release\Parts Manager PM Setup 1.0.0.exe")
  )
}

foreach ($target in $Targets) {
  if (Test-Path -LiteralPath $target) {
    $signature = Set-AuthenticodeSignature -FilePath $target -Certificate $cert -HashAlgorithm SHA256
    if ($signature.Status -ne "Valid") {
      throw "Failed to sign $target. Status: $($signature.Status) $($signature.StatusMessage)"
    }
  }
}

Remove-Item -LiteralPath $certFile -Force -ErrorAction SilentlyContinue

Get-AuthenticodeSignature $Targets |
  Select-Object Path, Status, StatusMessage
