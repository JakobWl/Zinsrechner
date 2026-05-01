# Microsoft Store submission

This app is submitted as a Win32 MSI/EXE app. Microsoft requires a versioned HTTPS URL that points to a standalone installer. For GitHub Releases, use the versioned release asset URL, not a `latest` URL.

## Required package URL

Use this format in Partner Center:

```text
https://github.com/JakobWl/Zinsrechner/releases/download/v1.1.9/Zinsrechner-Setup-1.1.9-x64.exe
```

Replace `1.1.9` with the version in `package.json`.

## Partner Center package fields

- Package URL: the GitHub Releases asset URL above
- Architecture: `x64`
- App type: `EXE`
- Installer parameters: `/S`
- Supported languages: at least `de` or `de-at`

## Release requirements

- The installer must be signed with a publicly trusted code-signing certificate.
- The installed EXE/DLL files must also be signed.
- The installer must be standalone/offline. It must not download app binaries during install.
- The release asset must not be replaced after Store submission. For updates, bump `package.json` and create a new release URL.

## Signing for GitHub Actions

The store release workflow expects these repository secrets:

- `WIN_CSC_LINK`: HTTPS URL, base64 value, or file reference for the `.pfx`/`.p12` code-signing certificate
- `WIN_CSC_KEY_PASSWORD`: password for the certificate

For an exportable PFX certificate, create the `WIN_CSC_LINK` value locally with PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\certificate.pfx"))
```

Add the output as a repository secret in GitHub: `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

After the workflow creates a release, copy the `Zinsrechner-Setup-<version>-x64.exe` asset URL into Partner Center.

## Common signing failure

If GitHub Actions fails with this message:

```text
App is not signed and "forceCodeSigning" is set to true
```

then the workflow did not receive a usable code-signing certificate. Check that `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are set correctly and that the certificate chains to a CA in the Microsoft Trusted Root Program.
