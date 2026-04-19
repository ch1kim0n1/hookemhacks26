# modules/cognito

Cognito user pool + hosted UI with required TOTP MFA.

## Shape

- **User pool**: email sign-in, email auto-verified, 12-char password minimum, required TOTP (authenticator app) MFA.
- **App client**: public SPA client (no secret), PKCE Authorization Code flow, scopes `email openid profile`, 60-min access/ID tokens, 30-day refresh, SRP auth flow only.
- **Hosted UI**: auto-assigned `<prefix>.auth.<region>.amazoncognito.com` domain. No custom domain (swap to one later by adding `aws_cognito_user_pool_domain` with a `certificate_arn`).
- **Self-signup enabled** so judges can register directly.

## Outputs

- `hosted_ui_login_url` — drop this in a Sign In button. Lands on Cognito's login screen.
- `hosted_ui_signup_url` — lands directly on the register screen; useful for a demo flow.

## Demo user flow

1. Click the signup URL.
2. Enter email + password (>=12 chars, upper/lower/digit).
3. Cognito emails a 6-digit code; enter it to verify the email.
4. Cognito prompts to set up TOTP — shows a QR, scan with Google Authenticator / 1Password / Authy.
5. Cognito redirects back to `callback_urls[0]` with `?code=...`.

## What's NOT here

- Identity Pool (AWS credentials for anonymous users) — not needed for a login demo.
- User groups / IAM role mapping — add later if the app needs authz tiers.
- SES for custom-branded emails — Cognito's default sender sandbox is fine for demo volumes (50/day).
