param([Parameter(Mandatory=$true)][string]$LiteralPath)
$ErrorActionPreference = 'Stop'
try {
  if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) { exit 2 }
  $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
  $result = [ordered]@{
    status = [string]$signature.Status
    signatureType = [string]$signature.SignatureType
    signerThumbprint = if ($null -eq $signature.SignerCertificate) { '' } else { $signature.SignerCertificate.Thumbprint }
    timestampThumbprint = if ($null -eq $signature.TimeStamperCertificate) { '' } else { $signature.TimeStamperCertificate.Thumbprint }
  }
  $result | ConvertTo-Json -Compress
  if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode' -or $null -eq $signature.TimeStamperCertificate) { exit 2 }
  exit 0
} catch {
  # Do not print exception text, input contents, environment or raw tool diagnostics.
  exit 2
}
