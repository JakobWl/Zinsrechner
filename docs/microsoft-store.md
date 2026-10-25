# Microsoft Store submission

This app should be submitted as a Microsoft Store AppX package when no paid code-signing certificate is available. Microsoft signs Store AppX/MSIX packages for free during Store certification.

The MSI/EXE package URL flow is not free for this app, because Microsoft requires the publisher to Authenticode-sign MSI/EXE installers before submission.

## Store package

Build the Store package:

```powershell
npm run build:store
```

The Store build passes `--publish never` to electron-builder. This is required in CI because electron-builder otherwise detects GitHub Actions and tries to publish with the global GitHub release configuration.

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

`appx.publisher` is set to the Partner Center publisher ID (`CN=2FB3D10A-81DA-44DA-AA5D-0E9816DC9FB2`) and the AppX is not Authenticode-signed locally. The Microsoft Store signs the uploaded package during certification.

## Automated submission via GitHub Actions

The `store-publish` job in `.github/workflows/release.yml` submits the AppX package with the
[Microsoft Store Developer CLI](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/overview) (`msstore`).
It only runs on a manual `workflow_dispatch` run with `publish_to_store` enabled, and it is gated by the
`microsoft-store` GitHub Environment (required reviewers), so a normal push to `main` never touches the Store.

Required repository configuration:

| Name | Type | Value |
| --- | --- | --- |
| `PARTNER_CENTER_TENANT_ID` | Secret | Microsoft Entra tenant ID of the Partner Center account |
| `PARTNER_CENTER_SELLER_ID` | Secret | Partner Center seller ID |
| `PARTNER_CENTER_CLIENT_ID` | Secret | Application (client) ID of the Entra app registration |
| `PARTNER_CENTER_CLIENT_SECRET` | Secret | Client secret value of that app registration |
| `MSSTORE_APP_ID` | Variable | Partner Center product ID of the app (for example `9NBLGGH...`) |
| `microsoft-store` | Environment | Environment with required reviewers and optional deployment branch rule `main` |

Notes:

- A manual Store run rebuilds the package even when its GitHub release already exists. It does not create a duplicate GitHub release.

- The Store rejects packages whose version is not higher than the currently published one. Bump `version` in
  `package.json` before re-running the job.
- `npm run validate:store` is not part of this job: it verifies Authenticode signatures of the NSIS installer and
  `win-unpacked`, neither of which exists in the Store submission flow (the Store signs the AppX itself).
- For the first submission, publish manually in Partner Center. Automated submissions require the app to exist and
  the Entra app to be linked to the Partner Center account (see the guide in the repository docs / chat).
- `msstore publish` without `--noCommit` commits the submission, which sends it into certification. Add `--noCommit`
  to only upload the package into a draft submission.

## GitHub release

The release workflow creates this asset:

```text
https://github.com/JakobWl/Zinsrechner/releases/download/v1.1.9/Zinsrechner-Store-1.1.9-x64.appx
```

Use the downloaded `.appx` package for Partner Center upload. A versioned URL is not needed for the AppX upload flow.
