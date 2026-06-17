# Dashboard CSRF Posture

The dashboard is designed as a localhost operator surface.

Current controls:

- Binds to `127.0.0.1` by default.
- Refuses non-local binding unless `--allow-non-local` is explicitly passed.
- Requires `--tls-cert` and `--tls-key` for non-local binding.
- Requires `--token` or `INTAKE_DASHBOARD_TOKEN` for non-local binding.
- Requires non-local dashboard tokens to be at least 20 characters.
- Requires the dashboard token through `x-intake-token`, `Authorization: Bearer`, or the tokenized local URL.
- Compares dashboard tokens using constant-time string comparison.
- Uses `SameSite`-independent token checks rather than cookie authentication.
- Sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Sends `Cache-Control: no-store`.
- Exposes `/api/security-posture` for token-authenticated operator posture checks.

Operational guidance:

- Keep the dashboard localhost-only for normal use.
- Do not expose the dashboard directly to the internet.
- If remote access is needed, prefer an authenticated tunnel or VPN.
- Rotate `INTAKE_DASHBOARD_TOKEN` if the tokenized URL is shared accidentally.
- Use HTTPS cert/key only for explicit non-local operator deployments.
- Use a stable token from a secret manager or environment variable for any non-local deployment.
