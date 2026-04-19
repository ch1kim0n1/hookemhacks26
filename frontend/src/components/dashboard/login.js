import { html } from 'lit-html';
import { ref, createRef } from 'lit-html/directives/ref.js';
import QRCode from 'qrcode';
import { store } from './state.js';
import { Icon } from './icons.js';
import { cognitoConfigured } from '../../auth/cognito.js';

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Sign-in (credentials) --------------------------------------------------
const credentialsForm = () => {
  const emailRef = createRef();
  const passwordRef = createRef();
  const state = store.getState();

  const submit = (event) => {
    event.preventDefault();
    const email = (emailRef.value?.value || '').trim();
    const password = passwordRef.value?.value || '';
    if (!emailRx.test(email)) return store.loginFailed('Enter a valid email address.');
    if (password.length < 6) return store.loginFailed('Password must be at least 6 characters.');
    if (!cognitoConfigured) return store.loginFailed('Cognito is not configured.');
    store.beginSignIn({ email, password });
  };

  return html`
    <form class="login-form" @submit=${submit} novalidate>
      <label class="login-field">
        <span class="login-field-label">Work email</span>
        <input
          ${ref(emailRef)}
          class="login-input"
          type="email"
          name="email"
          autocomplete="username"
          placeholder="you@company.com"
          .value=${state.loginEmail || ''}
          required
          spellcheck="false"
          autofocus
          aria-required="true"
        />
      </label>
      <label class="login-field">
        <span class="login-field-label">
          Password
          <a class="login-link" href="#" @click=${(e) => { e.preventDefault(); store.toast('info', 'Use the signup flow to reset — full password reset ships next sprint.'); }}>Forgot?</a>
        </span>
        <input
          ${ref(passwordRef)}
          class="login-input"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="••••••••"
          required
          aria-required="true"
        />
      </label>
      ${state.loginError ? html`<p class="login-error" role="alert">${state.loginError}</p>` : ''}
      <button class="btn btn-primary login-submit" type="submit" ?disabled=${state.loginBusy}>
        ${state.loginBusy ? 'Signing in…' : 'Continue'}
        <span class="btn-icon" aria-hidden="true">${Icon.arrowRight}</span>
      </button>
      <p class="login-switch">
        New to ClawGuardian?
        <a href="#" @click=${(e) => { e.preventDefault(); store.setAuthMode('signup'); }}>Create an account</a>
      </p>
    </form>
  `;
};

// --- Sign-up (new account) --------------------------------------------------
const signupForm = () => {
  const emailRef = createRef();
  const nameRef = createRef();
  const passwordRef = createRef();
  const passwordConfirmRef = createRef();
  const state = store.getState();

  const submit = (event) => {
    event.preventDefault();
    const email = (emailRef.value?.value || '').trim();
    const name = (nameRef.value?.value || '').trim();
    const password = passwordRef.value?.value || '';
    const confirm = passwordConfirmRef.value?.value || '';
    if (!emailRx.test(email)) return store.loginFailed('Enter a valid email address.');
    if (!name) return store.loginFailed('What should we call you?');
    if (password.length < 8) return store.loginFailed('Password must be at least 8 characters.');
    if (password !== confirm) return store.loginFailed('Passwords do not match.');
    if (!cognitoConfigured) return store.loginFailed('Cognito is not configured.');
    store.beginSignUp({ email, password, name });
  };

  return html`
    <form class="login-form" @submit=${submit} novalidate>
      <label class="login-field">
        <span class="login-field-label">Full name</span>
        <input
          ${ref(nameRef)}
          class="login-input"
          type="text"
          name="name"
          autocomplete="name"
          placeholder="Jane Operator"
          required
          autofocus
        />
      </label>
      <label class="login-field">
        <span class="login-field-label">Work email</span>
        <input
          ${ref(emailRef)}
          class="login-input"
          type="email"
          name="email"
          autocomplete="email"
          placeholder="you@company.com"
          required
          spellcheck="false"
          .value=${state.loginEmail || ''}
        />
      </label>
      <label class="login-field">
        <span class="login-field-label">Password</span>
        <input
          ${ref(passwordRef)}
          class="login-input"
          type="password"
          name="new-password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
          minlength="8"
          required
        />
      </label>
      <label class="login-field">
        <span class="login-field-label">Confirm password</span>
        <input
          ${ref(passwordConfirmRef)}
          class="login-input"
          type="password"
          autocomplete="new-password"
          placeholder="Retype it"
          minlength="8"
          required
        />
      </label>
      ${state.loginError ? html`<p class="login-error" role="alert">${state.loginError}</p>` : ''}
      <button class="btn btn-primary login-submit" type="submit" ?disabled=${state.loginBusy}>
        ${state.loginBusy ? 'Creating account…' : 'Create account'}
        <span class="btn-icon" aria-hidden="true">${Icon.arrowRight}</span>
      </button>
      <p class="login-switch">
        Already have an account?
        <a href="#" @click=${(e) => { e.preventDefault(); store.setAuthMode('signin'); }}>Sign in</a>
      </p>
    </form>
  `;
};

// --- Confirm signup (email verification) ------------------------------------
const otpInputs = (onComplete, autoSubmit = true) => {
  const codeRefs = Array.from({ length: 6 }, () => createRef());
  const readCode = () => codeRefs.map((r) => (r.value?.value || '')).join('');

  const onDigitInput = (idx) => (event) => {
    const input = event.target;
    const digit = input.value.replace(/\D/g, '').slice(-1);
    input.value = digit;
    if (digit && idx < 5) codeRefs[idx + 1].value?.focus();
    if (autoSubmit && readCode().length === 6) onComplete(readCode());
  };

  const onDigitKeydown = (idx) => (event) => {
    if (event.key === 'Backspace' && !event.target.value && idx > 0) {
      codeRefs[idx - 1].value?.focus();
    }
  };

  const onPaste = (event) => {
    const pasted = (event.clipboardData || window.clipboardData)?.getData('text') ?? '';
    const digits = pasted.replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    codeRefs.forEach((r, i) => {
      if (r.value) r.value.value = digits[i] || '';
    });
    if (digits.length === 6 && autoSubmit) onComplete(digits);
    else codeRefs[digits.length]?.value?.focus();
  };

  return {
    readCode,
    markup: html`
      <div class="login-otp" @paste=${onPaste} role="group" aria-label="6-digit verification code">
        ${codeRefs.map(
          (r, i) => html`
            <input
              ${ref(r)}
              class="login-otp-cell"
              type="text"
              inputmode="numeric"
              maxlength="1"
              autocomplete=${i === 0 ? 'one-time-code' : 'off'}
              aria-label="Digit ${i + 1}"
              ?autofocus=${i === 0}
              @input=${onDigitInput(i)}
              @keydown=${onDigitKeydown(i)}
            />
          `,
        )}
      </div>
    `,
  };
};

const confirmSignUpForm = () => {
  const state = store.getState();
  const { markup, readCode } = otpInputs((code) => store.confirmSignUp({ code }));
  const submit = (event) => {
    event?.preventDefault();
    const code = readCode();
    if (!/^\d{6}$/.test(code)) return store.loginFailed('Enter all 6 digits.');
    store.confirmSignUp({ code });
  };
  return html`
    <form class="login-form" @submit=${submit} novalidate>
      <div class="login-mfa-head">
        <span class="login-chip">
          <span class="login-chip-dot"></span>
          Verify your email
        </span>
        <p class="login-mfa-text">
          We sent a 6-digit code to <strong>${state.loginEmail}</strong>.
          Enter it below to activate your account.
        </p>
      </div>
      ${markup}
      ${state.loginError ? html`<p class="login-error" role="alert">${state.loginError}</p>` : ''}
      <div class="login-mfa-actions">
        <button class="btn btn-primary" type="submit" ?disabled=${state.loginBusy}>
          ${state.loginBusy ? 'Verifying…' : 'Confirm email'}
        </button>
        <button class="btn btn-ghost" type="button" @click=${() => store.resendConfirmation()}>
          Resend code
        </button>
      </div>
      <p class="login-hint login-hint-mfa">Didn't arrive? Check spam, then resend.</p>
    </form>
  `;
};

// --- MFA totp for returning users -------------------------------------------
const mfaTotpForm = () => {
  const state = store.getState();
  const { markup, readCode } = otpInputs((code) => store.submitTotp({ code }));
  const submit = (event) => {
    event?.preventDefault();
    const code = readCode();
    if (!/^\d{6}$/.test(code)) return store.loginFailed('Enter all 6 digits.');
    store.submitTotp({ code });
  };
  return html`
    <form class="login-form" @submit=${submit} novalidate>
      <div class="login-mfa-head">
        <span class="login-chip">
          <span class="login-chip-dot"></span>
          2-step verification
        </span>
        <p class="login-mfa-text">
          Open your authenticator app and enter the 6-digit code for <strong>${state.loginEmail}</strong>.
        </p>
      </div>
      ${markup}
      ${state.loginError ? html`<p class="login-error" role="alert">${state.loginError}</p>` : ''}
      <div class="login-mfa-actions">
        <button class="btn btn-primary" type="submit" ?disabled=${state.loginBusy}>
          ${state.loginBusy ? 'Verifying…' : 'Verify and sign in'}
        </button>
        <button class="btn btn-ghost" type="button" @click=${() => store.resetLogin()}>
          Use a different email
        </button>
      </div>
    </form>
  `;
};

// --- MFA setup (first sign-in after signup) ---------------------------------
const mfaSetupForm = () => {
  const state = store.getState();
  const qrRef = createRef();
  // Render the QR once the image node is available.
  queueMicrotask(async () => {
    const img = qrRef.value;
    if (!img || !state.mfaQrUri) return;
    try {
      img.src = await QRCode.toDataURL(state.mfaQrUri, {
        margin: 1,
        width: 192,
        color: { dark: '#1a1a1a', light: '#f3ead6' },
      });
    } catch {
      /* ignore */
    }
  });

  const { markup, readCode } = otpInputs((code) => store.submitTotpSetup({ code }));
  const submit = (event) => {
    event?.preventDefault();
    const code = readCode();
    if (!/^\d{6}$/.test(code)) return store.loginFailed('Enter all 6 digits.');
    store.submitTotpSetup({ code });
  };

  return html`
    <form class="login-form" @submit=${submit} novalidate>
      <div class="login-mfa-head">
        <span class="login-chip">
          <span class="login-chip-dot"></span>
          Set up 2-factor authentication
        </span>
        <p class="login-mfa-text">
          Scan the QR with <strong>Google Authenticator</strong>, <strong>1Password</strong>,
          <strong>Authy</strong>, or any TOTP app, then enter the 6-digit code below.
        </p>
      </div>
      <div class="login-qr">
        <img ${ref(qrRef)} alt="Scan with your authenticator app" width="192" height="192" />
        <div class="login-qr-fallback">
          <span class="login-qr-label">Can't scan? Enter this secret manually:</span>
          <code class="login-qr-secret">${state.mfaSecret}</code>
        </div>
      </div>
      ${markup}
      ${state.loginError ? html`<p class="login-error" role="alert">${state.loginError}</p>` : ''}
      <div class="login-mfa-actions">
        <button class="btn btn-primary" type="submit" ?disabled=${state.loginBusy}>
          ${state.loginBusy ? 'Activating…' : 'Activate 2FA'}
        </button>
        <button class="btn btn-ghost" type="button" @click=${() => store.resetLogin()}>
          Cancel
        </button>
      </div>
    </form>
  `;
};

// --- Shell ------------------------------------------------------------------
const stepTitle = (state) => {
  if (state.loginStep === 'signup_form') return { t: 'Create your account', s: 'Minutes to set up, 2FA required.' };
  if (state.loginStep === 'confirm_signup') return { t: 'Confirm your email', s: 'We sent a code to your inbox.' };
  if (state.loginStep === 'mfa_totp') return { t: 'Enter your code', s: '2FA is required for operator access.' };
  if (state.loginStep === 'mfa_setup') return { t: 'Enroll 2FA', s: 'One-time setup — required for all operators.' };
  return { t: 'Welcome back', s: 'Sign in with your work email to continue.' };
};

const renderStep = (state) => {
  switch (state.loginStep) {
    case 'signup_form': return signupForm();
    case 'confirm_signup': return confirmSignUpForm();
    case 'mfa_totp': return mfaTotpForm();
    case 'mfa_setup': return mfaSetupForm();
    default: return credentialsForm();
  }
};

export const loginView = () => {
  const state = store.getState();
  const { t, s } = stepTitle(state);
  return html`
    <div class="login-root">
      <aside class="login-aside">
        <a class="login-brand" href="/" aria-label="Back to the ClawGuardian landing page">
          <img class="login-brand-logo" src="/logo.png" alt="" width="40" height="40" />
          <span class="login-brand-name">ClawGuardian</span>
        </a>
        <div class="login-aside-body">
          <span class="login-kicker">Operator console</span>
          <h1 class="login-headline">
            Sign in to the threat<br />pipeline.
          </h1>
          <p class="login-lede">
            Every inbound payload is hashed, asked of Base Sepolia, scanned
            by rules, by a local classifier, and — if it is still ambiguous —
            judged by a small LLM. You will be looking at what the pipeline
            caught over the last 24 hours.
          </p>
          <ul class="login-bullets">
            <li><span class="login-bullet-dot"></span><span>Base Sepolia · chain id 84532</span></li>
            <li><span class="login-bullet-dot"></span><span>Three-layer detection, chain-first lookup</span></li>
            <li><span class="login-bullet-dot"></span><span>2FA enforced · TOTP via authenticator app</span></li>
          </ul>
        </div>
        <div class="login-aside-foot">
          <span>© 2026 ClawGuardian Labs</span>
          <span>v0.4.1 · Cognito ${cognitoConfigured ? 'live' : 'offline'}</span>
        </div>
      </aside>
      <main class="login-main">
        <div class="login-card" role="region" aria-label=${state.authMode === 'signup' ? 'Sign up' : 'Sign in'}>
          <header class="login-card-head">
            <h2 class="login-title">${t}</h2>
            <p class="login-sub">${s}</p>
          </header>
          ${renderStep(state)}
        </div>
        <p class="login-foot">
          ${state.authMode === 'signup'
            ? html`Already enrolled? <a href="#" @click=${(e) => { e.preventDefault(); store.setAuthMode('signin'); }}>Sign in</a>`
            : html`Trouble signing in? <a href="mailto:support@clawguard.io">support@clawguard.io</a>`}
        </p>
      </main>
    </div>
  `;
};
