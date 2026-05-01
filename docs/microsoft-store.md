# Microsoft Store submission

This app should be submitted as a Microsoft Store AppX package when no paid code-signing certificate is available. Microsoft signs Store AppX/MSIX packages for free during Store certification.

The MSI/EXE package URL flow is not free for this app, because Microsoft requires the publisher to Authenticode-sign MSI/EXE installers before submission.

## Store package

Build the Store package:

```powershell
npm run build:store
```

The output is:

```text
release\<version>\Zinsrechner-Store-<version>-x64.appx
```

Upload this `.appx` file in Partner Center using the package upload flow. Do not use the MSI/EXE package URL page for the free signing path.

## Partner Center package identity

Before final submission, check the package identity values assigned by Partner Center after reserving the app name. If Partner Center rejects the package identity, update `electron-builder.microsoft-store.json`:

- `appx.identityName`
- `appx.publisher`
- `appx.publisherDisplayName`

The current config omits `appx.publisher` so electron-builder can generate a Store package without a local certificate. The Microsoft Store signs the uploaded package after certification.

## GitHub release

The release workflow creates this asset:

```text
https://github.com/JakobWl/Zinsrechner/releases/download/v1.1.9/Zinsrechner-Store-1.1.9-x64.appx
```

Use the downloaded `.appx` package for Partner Center upload. A versioned URL is not needed for the AppX upload flow.
