# Distribution and release gates

Intake 0.3.0 is a public GitHub source release for local operators. Its npm manifest keeps `private: true` to prevent accidental registry publication. That flag does not make the GitHub repository private.

Install from the tagged checkout with Node.js 22.23.4+, 24.22.1+, or 26.12.1+ (supported release lines), `npm ci`, and `npm link`. The release also supplies a tracked-file package archive and checksum. Intake has no Kennel manifest or native Kujo entrypoint and is not enrolled in the Kennel registry.

## GitHub source release

Before tagging:

- Align package, lockfile, CLI, README, changelog, and release notes.
- Pass `npm run release:check` and Chromium verification.
- Confirm the intended commit passes the patched Node 22/24/26 CI matrix.
- Run `node scripts/check-package.mjs`; package only tracked, reviewed files.
- Record limitations and publish the tag, archive, and checksum together.

## Broader distribution

Publishing to npm, adding Kennel support, or claiming enterprise readiness requires a separate decision. Live email and Slack evidence, support expectations, deployment access controls, and recovery procedures must match the intended environment. The current local release gates do not establish those properties.

The app already supports policy-gated GitHub comment writeback. Jira, Linear, and ClickUp provide inbound normalization; do not imply equivalent provider-native writeback. Storage migration hooks exist, but no schema-changing migration has shipped.
