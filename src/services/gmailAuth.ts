import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfigFallback';

const app = isFirebaseConfigured
  ? getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig)
  : null;
const auth: Auth | null = app ? getAuth(app) : null;

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.send');

let isSigningIn = false;
// Store access token strictly in memory — never in localStorage or sessionStorage
let cachedAccessToken: string | null = null;

export function initGmailAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthDisconnected?: (user: User | null) => void
) {
  if (!auth) {
    cachedAccessToken = null;
    onAuthDisconnected?.(null);
    return () => {};
  }

  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthDisconnected?.(user);
    }
  });
}

export async function signInWithGoogleForGmail(): Promise<{
  user: User;
  accessToken: string;
}> {
  if (!auth) {
    throw new Error(
      'Firebase is not configured for this host yet. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID in your environment variables (or provision Firebase in AI Studio) to enable Google Sign-In.'
    );
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in did not return a Gmail send token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
      throw new Error(
        'Firebase API key is invalid or missing. Check your Firebase config or VITE_FIREBASE_API_KEY environment variable.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `Domain "${host}" is not authorized for Google Sign-In. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Sign-in popup was blocked by your browser. Allow popups for this site and try again.');
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export function getGmailAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGmail(): Promise<void> {
  if (auth) {
    await auth.signOut();
  }
  cachedAccessToken = null;
}

export async function sendEmailViaGmailApi(params: {
  to: string;
  subject: string;
  bodyText: string;
  simulateFailure?: boolean;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  if (params.simulateFailure) {
    return {
      ok: false,
      error: 'Simulated delivery failure (testing retry schedule).',
    };
  }

  const token = cachedAccessToken;
  if (!token) {
    return {
      ok: false,
      error: 'Not signed in with Google yet. Click "Sign in with Google" to authorize Gmail alerts.',
    };
  }

  const response = await fetch('/api/gmail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: params.to,
      subject: params.subject,
      bodyText: params.bodyText,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    messageId?: string;
  };

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || `Email request failed (${response.status})`,
    };
  }

  return { ok: true, messageId: data.messageId };
}
