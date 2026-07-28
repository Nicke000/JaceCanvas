# Contributing to JaceCanvas

## Before opening a pull request

- Do not include API keys, tokens, passwords, private URLs, databases, logs,
  personal workflows, uploaded media or `prompt-settings.json`.
- Do not add third-party binaries/models without checking redistribution terms.
- Keep JaceCanvas original code and third-party assets clearly separated.
- Explain UI, canvas, node and build changes in the pull request description.

## Local development

```powershell
cd desktop-app
npm install
npm run build:web
```

For the local service, install dependencies in `server`, run `npm run build`,
and copy the resulting `server/dist` into `desktop-app/server` for Electron
testing. The exact Windows packaging steps are in `开源使用说明.md`.

## Canvas and node development

New canvas nodes should declare their input/output types, handle missing
optional services, and show a clear status/error message. A node must not
silently invoke a user's globally installed binary when the feature promises
an application-bundled runtime.

## License

Contributions to JaceCanvas original source are released under the MIT License.
Contributors remain responsible for ensuring that contributed third-party code
and assets may be redistributed.