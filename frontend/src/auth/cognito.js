import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

const region = import.meta.env.VITE_COGNITO_REGION || 'us-east-1';
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || '';

export const cognitoConfigured = Boolean(userPoolId && clientId);

const userPool = cognitoConfigured
  ? new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId })
  : null;

const buildUser = (email) => new CognitoUser({ Username: email, Pool: userPool });

const friendly = (err) => {
  if (!err) return 'Unknown error.';
  const m = err.message || String(err);
  if (/UserLambdaValidationException/i.test(m)) return 'Sign-up rejected by policy.';
  if (/InvalidPasswordException/i.test(m)) return 'Password too weak — please strengthen it.';
  if (/UsernameExistsException/i.test(m)) return 'An account with that email already exists.';
  if (/CodeMismatchException/i.test(m)) return 'Verification code is incorrect.';
  if (/ExpiredCodeException/i.test(m)) return 'Verification code expired. Request a new one.';
  if (/NotAuthorizedException/i.test(m)) return m.includes('disabled') ? 'Account is disabled.' : 'Incorrect email or password.';
  if (/UserNotConfirmedException/i.test(m)) return 'Please confirm your email first.';
  if (/UserNotFoundException/i.test(m)) return 'No account with that email.';
  if (/LimitExceededException/i.test(m)) return 'Too many attempts. Try again in a moment.';
  if (/TooManyRequestsException/i.test(m)) return 'Too many requests. Slow down.';
  return m;
};

export const cognito = {
  configured: cognitoConfigured,
  region,

  // Sign up with email + password. Cognito emails a 6-digit confirmation code.
  signUp({ email, password, name }) {
    return new Promise((resolve, reject) => {
      if (!userPool) return reject(new Error('Cognito is not configured.'));
      const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })];
      if (name) attrs.push(new CognitoUserAttribute({ Name: 'name', Value: name }));
      userPool.signUp(email, password, attrs, null, (err, result) => {
        if (err) return reject(new Error(friendly(err)));
        resolve({ userSub: result.userSub, email });
      });
    });
  },

  // Confirm email with the 6-digit code from the verification email.
  confirmSignUp({ email, code }) {
    return new Promise((resolve, reject) => {
      buildUser(email).confirmRegistration(code, true, (err) => {
        if (err) return reject(new Error(friendly(err)));
        resolve(true);
      });
    });
  },

  resendConfirmation({ email }) {
    return new Promise((resolve, reject) => {
      buildUser(email).resendConfirmationCode((err) => {
        if (err) return reject(new Error(friendly(err)));
        resolve(true);
      });
    });
  },

  // Sign in. Resolves to one of:
  //   { status: 'success', session, tokens }
  //   { status: 'mfa_setup', user, secret, qrUri }     — user must scan QR and verify
  //   { status: 'mfa_totp',  user }                    — user enters an existing TOTP code
  //   { status: 'new_password', user, userAttributes } — forced reset
  signIn({ email, password }) {
    return new Promise((resolve, reject) => {
      const user = buildUser(email);
      const details = new AuthenticationDetails({ Username: email, Password: password });
      user.authenticateUser(details, {
        onSuccess(session) {
          resolve({ status: 'success', user, session, tokens: extractTokens(session) });
        },
        onFailure(err) {
          reject(new Error(friendly(err)));
        },
        totpRequired() {
          resolve({ status: 'mfa_totp', user });
        },
        mfaSetup() {
          // Brand new user — generate a TOTP secret and ask them to confirm.
          user.associateSoftwareToken({
            associateSecretCode(secret) {
              const qrUri = buildTotpUri({ email, secret });
              resolve({ status: 'mfa_setup', user, secret, qrUri });
            },
            onFailure(err) {
              reject(new Error(friendly(err)));
            },
          });
        },
        newPasswordRequired(userAttributes) {
          delete userAttributes.email_verified;
          delete userAttributes.email;
          resolve({ status: 'new_password', user, userAttributes });
        },
      });
    });
  },

  // Verify a 6-digit code during MFA setup.
  verifyTotpSetup({ user, code }) {
    return new Promise((resolve, reject) => {
      user.verifySoftwareToken(code, 'authenticator', {
        onSuccess(session) {
          // Ensure TOTP is the preferred MFA from now on.
          user.setUserMfaPreference(null, { PreferredMfa: true, Enabled: true }, (err) => {
            if (err) return reject(new Error(friendly(err)));
            resolve({ session, tokens: extractTokens(session) });
          });
        },
        onFailure(err) {
          reject(new Error(friendly(err)));
        },
      });
    });
  },

  // Submit a 6-digit TOTP for an already-set-up user.
  sendTotp({ user, code }) {
    return new Promise((resolve, reject) => {
      user.sendMFACode(
        code,
        {
          onSuccess(session) {
            resolve({ session, tokens: extractTokens(session) });
          },
          onFailure(err) {
            reject(new Error(friendly(err)));
          },
        },
        'SOFTWARE_TOKEN_MFA',
      );
    });
  },

  forgotPassword({ email }) {
    return new Promise((resolve, reject) => {
      buildUser(email).forgotPassword({
        onSuccess: () => resolve(true),
        onFailure: (err) => reject(new Error(friendly(err))),
        inputVerificationCode: () => resolve(true),
      });
    });
  },

  confirmNewPassword({ email, code, newPassword }) {
    return new Promise((resolve, reject) => {
      buildUser(email).confirmPassword(code, newPassword, {
        onSuccess: () => resolve(true),
        onFailure: (err) => reject(new Error(friendly(err))),
      });
    });
  },

  // Best-effort session restore — no network call, checks localStorage.
  restoreSession() {
    if (!userPool) return null;
    const current = userPool.getCurrentUser();
    if (!current) return null;
    return new Promise((resolve) => {
      current.getSession((err, session) => {
        if (err || !session || !session.isValid()) return resolve(null);
        const payload = session.getIdToken()?.payload || {};
        resolve({
          user: current,
          session,
          tokens: extractTokens(session),
          email: payload.email || current.getUsername(),
          name: payload.name || payload.email || current.getUsername(),
        });
      });
    });
  },

  signOutAll() {
    const current = userPool?.getCurrentUser();
    if (current) current.signOut();
  },
};

const extractTokens = (session) => ({
  id: session.getIdToken()?.getJwtToken() || '',
  access: session.getAccessToken()?.getJwtToken() || '',
  refresh: session.getRefreshToken()?.getToken() || '',
  expires: session.getAccessToken()?.getExpiration() * 1000 || 0,
});

const buildTotpUri = ({ email, secret }) => {
  const issuer = 'ClawGuardian';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
};
