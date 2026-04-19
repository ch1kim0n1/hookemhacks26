// Minimal pub/sub store. Holds auth + route + drawer state for the dashboard.
// No framework — just a plain object + Set of listeners. The outer
// `dashboard.js` entry subscribes once and re-renders on every change.

import { INITIAL_VERDICTS } from './mock-data.js';
import { cognito, cognitoConfigured } from '../../auth/cognito.js';

const STORAGE_KEY = 'clawguardian.session.v1';

const loadSession = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistSession = (session) => {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — continue in-memory only */
  }
};

// Login flow has several steps depending on Cognito state:
//   mode = 'signin'  → credentials → [mfa_setup | mfa_totp] → done
//   mode = 'signup'  → details → confirm → signin
const initial = {
  session: loadSession(),
  authMode: 'signin', // 'signin' | 'signup'
  loginStep: 'credentials', // credentials | mfa_totp | mfa_setup | confirm_signup | signup_form
  loginEmail: '',
  loginError: '',
  loginBusy: false,
  pendingUser: null, // live CognitoUser object held across the signin flow
  mfaSecret: '',
  mfaQrUri: '',
  route: 'overview',
  drawer: null, // { type: 'verdict', payload: {...} } | null
  userMenuOpen: false,
  toast: null, // { id, tone, text }
  verdicts: [...INITIAL_VERDICTS],
  settingsSection: null, // anchor to scroll to after routing
};

let state = { ...initial };
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) fn(state);
};

const sessionFromCognito = ({ tokens, email, name }) => ({
  email,
  name: name || email,
  initials: initialsFrom(name || email),
  role: 'Operator',
  org: (email.split('@')[1] || '').toLowerCase(),
  issuedAt: Date.now(),
  // Tokens are stored in memory only; Cognito SDK persists them in localStorage.
  tokensExpire: tokens?.expires || 0,
});

const initialsFrom = (s) => {
  const parts = String(s).split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return '??';
  const first = parts[0][0] || '';
  const second = parts[1]?.[0] || parts[0][1] || '';
  return (first + second).toUpperCase();
};

export const store = {
  getState: () => state,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // Auth: shared helpers ---------------------------------------------------
  setAuthMode(mode) {
    state = {
      ...state,
      authMode: mode,
      loginStep: mode === 'signup' ? 'signup_form' : 'credentials',
      loginError: '',
      loginBusy: false,
      pendingUser: null,
      mfaSecret: '',
      mfaQrUri: '',
    };
    emit();
  },

  loginFailed(message) {
    state = { ...state, loginError: message, loginBusy: false };
    emit();
  },

  resetLogin() {
    state = {
      ...state,
      authMode: 'signin',
      loginStep: 'credentials',
      loginEmail: '',
      loginError: '',
      loginBusy: false,
      pendingUser: null,
      mfaSecret: '',
      mfaQrUri: '',
    };
    emit();
  },

  async hydrateFromCognito() {
    if (!cognitoConfigured) return;
    const restored = await cognito.restoreSession();
    if (!restored) return;
    const session = sessionFromCognito({
      tokens: restored.tokens,
      email: restored.email,
      name: restored.name,
    });
    persistSession(session);
    state = { ...state, session, route: state.route || 'overview' };
    emit();
  },

  // Auth: sign in ----------------------------------------------------------
  async beginSignIn({ email, password }) {
    state = { ...state, loginBusy: true, loginError: '', loginEmail: email };
    emit();
    try {
      const result = await cognito.signIn({ email, password });
      if (result.status === 'success') {
        const session = sessionFromCognito({ tokens: result.tokens, email });
        persistSession(session);
        state = {
          ...initial,
          session,
          verdicts: state.verdicts,
          route: 'overview',
          toast: { id: Date.now(), tone: 'ok', text: `Welcome back, ${session.name}.` },
        };
        emit();
        return;
      }
      if (result.status === 'mfa_totp') {
        state = {
          ...state,
          loginStep: 'mfa_totp',
          pendingUser: result.user,
          loginBusy: false,
        };
        emit();
        return;
      }
      if (result.status === 'mfa_setup') {
        state = {
          ...state,
          loginStep: 'mfa_setup',
          pendingUser: result.user,
          mfaSecret: result.secret,
          mfaQrUri: result.qrUri,
          loginBusy: false,
        };
        emit();
        return;
      }
      throw new Error('Unexpected authentication state.');
    } catch (err) {
      state = { ...state, loginBusy: false, loginError: err.message };
      emit();
    }
  },

  async submitTotp({ code }) {
    if (!state.pendingUser) return;
    state = { ...state, loginBusy: true, loginError: '' };
    emit();
    try {
      const { tokens } = await cognito.sendTotp({ user: state.pendingUser, code });
      const session = sessionFromCognito({ tokens, email: state.loginEmail });
      persistSession(session);
      state = {
        ...initial,
        session,
        verdicts: state.verdicts,
        route: 'overview',
        toast: { id: Date.now(), tone: 'ok', text: `Welcome back, ${session.name}.` },
      };
      emit();
    } catch (err) {
      state = { ...state, loginBusy: false, loginError: err.message };
      emit();
    }
  },

  async submitTotpSetup({ code }) {
    if (!state.pendingUser) return;
    state = { ...state, loginBusy: true, loginError: '' };
    emit();
    try {
      const { tokens } = await cognito.verifyTotpSetup({ user: state.pendingUser, code });
      const session = sessionFromCognito({ tokens, email: state.loginEmail });
      persistSession(session);
      state = {
        ...initial,
        session,
        verdicts: state.verdicts,
        route: 'overview',
        toast: { id: Date.now(), tone: 'ok', text: 'Authenticator enrolled. You are signed in.' },
      };
      emit();
    } catch (err) {
      state = { ...state, loginBusy: false, loginError: err.message };
      emit();
    }
  },

  // Auth: sign up ----------------------------------------------------------
  async beginSignUp({ email, password, name }) {
    state = { ...state, loginBusy: true, loginError: '', loginEmail: email };
    emit();
    try {
      await cognito.signUp({ email, password, name });
      state = {
        ...state,
        loginStep: 'confirm_signup',
        loginBusy: false,
        toast: { id: Date.now(), tone: 'info', text: 'We sent you a 6-digit code — check your inbox.' },
      };
      emit();
    } catch (err) {
      state = { ...state, loginBusy: false, loginError: err.message };
      emit();
    }
  },

  async confirmSignUp({ code }) {
    state = { ...state, loginBusy: true, loginError: '' };
    emit();
    try {
      await cognito.confirmSignUp({ email: state.loginEmail, code });
      state = {
        ...state,
        authMode: 'signin',
        loginStep: 'credentials',
        loginBusy: false,
        toast: { id: Date.now(), tone: 'ok', text: 'Email confirmed. Sign in to set up 2FA.' },
      };
      emit();
    } catch (err) {
      state = { ...state, loginBusy: false, loginError: err.message };
      emit();
    }
  },

  async resendConfirmation() {
    if (!state.loginEmail) return;
    try {
      await cognito.resendConfirmation({ email: state.loginEmail });
      state = {
        ...state,
        toast: { id: Date.now(), tone: 'info', text: 'New code sent.' },
      };
      emit();
    } catch (err) {
      state = { ...state, loginError: err.message };
      emit();
    }
  },

  signOut() {
    if (cognitoConfigured) cognito.signOutAll();
    persistSession(null);
    state = {
      ...initial,
      session: null,
      route: 'overview',
      toast: { id: Date.now(), tone: 'info', text: 'Signed out.' },
    };
    emit();
  },

  // Routing ----------------------------------------------------------------
  goto(route, opts = {}) {
    state = {
      ...state,
      route,
      userMenuOpen: false,
      drawer: null,
      settingsSection: opts.section || null,
    };
    emit();
  },
  clearSettingsSection() {
    if (!state.settingsSection) return;
    state = { ...state, settingsSection: null };
    emit();
  },

  // Drawer -----------------------------------------------------------------
  openDrawer(drawer) {
    state = { ...state, drawer };
    emit();
  },
  closeDrawer() {
    state = { ...state, drawer: null };
    emit();
  },

  // User menu --------------------------------------------------------------
  toggleUserMenu() {
    state = { ...state, userMenuOpen: !state.userMenuOpen };
    emit();
  },
  closeUserMenu() {
    if (!state.userMenuOpen) return;
    state = { ...state, userMenuOpen: false };
    emit();
  },

  // Toast ------------------------------------------------------------------
  toast(tone, text) {
    state = { ...state, toast: { id: Date.now(), tone, text } };
    emit();
  },
  clearToast() {
    state = { ...state, toast: null };
    emit();
  },

  // Verdict stream ---------------------------------------------------------
  pushVerdict(v) {
    state = { ...state, verdicts: [v, ...state.verdicts.slice(0, 5)] };
    emit();
  },
};
