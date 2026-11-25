import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { firebaseConfig } from './firebaseConfigFallback';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.send');

let isSigningIn = false;
// Store access token strictly in memory — never in localStorage or sessionStorage
let cachedAccessToken: string | null = null;

export function initGmailAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthDisconnected?: (user: User | null) => void
) {
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
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in did not return a Gmail send token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGmailAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGmail(): Promise<void> {
  await auth.signOut();
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
