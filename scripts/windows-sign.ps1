param([string]$Path, [switch]$Initialize)

$ErrorActionPreference = 'Stop'
$signingDir = Join-Path $PSScriptRoot '../.signing'
$pfxPath = Join-Path $signingDir 'PulseSync.pfx'
$passwordPath = Join-Path $signingDir 'password.txt'

if ($env:PULSESYNC_WINDOWS_PFX_BASE64) {
    if (!$env:PULSESYNC_WINDOWS_PFX_PASSWORD) { throw 'PULSESYNC_WINDOWS_PFX_PASSWORD is required' }
    $pfxBytes = [Convert]::FromBase64String($env:PULSESYNC_WINDOWS_PFX_BASE64)
    $password = $env:PULSESYNC_WINDOWS_PFX_PASSWORD
} else {
    if ($env:PULSESYNC_WINDOWS_PFX_PASSWORD) { throw 'PULSESYNC_WINDOWS_PFX_BASE64 is required when a signing password is set' }
    if ($env:CI -and $env:CI -ne 'false') {
        throw 'CI requires a persistent PULSESYNC_WINDOWS_PFX_BASE64 and PULSESYNC_WINDOWS_PFX_PASSWORD. Run yarn signing:certificate locally once.'
    }
    if (!(Test-Path -LiteralPath $pfxPath)) {
        if (!$Initialize) { throw 'Run yarn signing:certificate once before building on Windows' }
        New-Item -ItemType Directory -Force -Path $signingDir | Out-Null
        $rsa = [System.Security.Cryptography.RSA]::Create(3072)
        try {
            $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
                'CN=Матвиенко Артём Евгеньевич', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
            $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
            $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new('DigitalSignature', $true))
            $eku = [System.Security.Cryptography.OidCollection]::new()
            $eku.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
            $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $true))
            $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(5))
            try {
                $password = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
                [IO.File]::WriteAllText($passwordPath, $password)
                [IO.File]::WriteAllBytes($pfxPath, $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password))
                [IO.File]::WriteAllBytes((Join-Path $signingDir 'PulseSync.cer'), $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
            } finally { $certificate.Dispose() }
        } finally { $rsa.Dispose() }
    }
    $pfxBytes = [IO.File]::ReadAllBytes($pfxPath)
    $password = [IO.File]::ReadAllText($passwordPath)
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $pfxBytes, $password, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
try {
    if (!$certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::Now -or $certificate.NotBefore -gt [DateTime]::Now) {
        throw 'Signing certificate must have a private key and be within its validity period'
    }
    if ($Initialize) {
        Write-Host "Windows signing certificate ready: $($certificate.Thumbprint)"
        exit 0
    }
    if (!$Path) { throw 'A file or directory -Path is required' }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PulseSyncSignature {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FileInfo {
        public uint size;
        [MarshalAs(UnmanagedType.LPWStr)] public string path;
        public IntPtr file, subject;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct TrustData {
        public uint size;
        public IntPtr policy, sip;
        public uint ui, revocation, choice;
        public IntPtr file;
        public uint stateAction;
        public IntPtr state, url;
        public uint flags, context;
    }
    [DllImport("wintrust.dll", ExactSpelling = true)]
    static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
    public static int Verify(string path) {
        var file = new FileInfo { size = (uint)Marshal.SizeOf<FileInfo>(), path = path };
        var pointer = Marshal.AllocHGlobal(Marshal.SizeOf<FileInfo>());
        try {
            Marshal.StructureToPtr(file, pointer, false);
            var data = new TrustData { size = (uint)Marshal.SizeOf<TrustData>(), ui = 2, choice = 1, file = pointer, flags = 0x1010 };
            var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
            return WinVerifyTrust(new IntPtr(-1), ref action, ref data);
        } finally {
            Marshal.DestroyStructure<FileInfo>(pointer);
            Marshal.FreeHGlobal(pointer);
        }
    }
}
'@
    $item = Get-Item -LiteralPath $Path
    $files = if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.node' }
    } else { @($item) }
    function Get-SignerThumbprint([string]$FilePath) {
        try {
            $signer = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($FilePath)
            try { return $signer.GetCertHashString() } finally { $signer.Dispose() }
        } catch { return $null }
    }
    foreach ($file in $files) {
        $verification = [PulseSyncSignature]::Verify($file.FullName)
        # CERT_E_UNTRUSTEDROOT is expected for self-signing; all other verification failures are fatal.
        if ((Get-SignerThumbprint $file.FullName) -ne $certificate.Thumbprint -or $verification -notin 0, -2146762487) {
            Set-AuthenticodeSignature -LiteralPath $file.FullName -Certificate $certificate -HashAlgorithm SHA256 -IncludeChain Signer | Out-Null
            $verification = [PulseSyncSignature]::Verify($file.FullName)
        }
        if ((Get-SignerThumbprint $file.FullName) -ne $certificate.Thumbprint -or $verification -notin 0, -2146762487) {
            throw "Signature verification failed for $($file.FullName): $verification"
        }
        Write-Host "Signed: $($file.FullName) [$($certificate.Thumbprint)]"
    }
} finally { $certificate.Dispose() }
