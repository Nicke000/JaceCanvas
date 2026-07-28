# Security policy

## Do not report secrets publicly

Never put API keys, GitHub passwords, SSH passwords, tokens, private hostnames,
or personal server URLs in an Issue or pull request. If a credential was
exposed, revoke/rotate it immediately and contact the repository maintainer
through a private channel.

## Report a vulnerability

For security issues in the JaceCanvas source, use GitHub's private security
advisory feature when enabled, or contact the maintainer privately. Include a
minimal reproduction, affected version, impact and a suggested mitigation.

## Scope

Report credential leakage, unsafe local IPC behavior, arbitrary file execution,
path traversal, insecure update/installer behavior and accidental private
endpoint inclusion. Do not report third-party model quality or license issues
as source vulnerabilities; document those with the relevant upstream project.