export const AUTH_SUSPICIOUS_LOGIN_EVENT = 'auth/suspicious-login' as const;

export interface AuthSuspiciousLoginData {
  userId: string;
  signinId: string;
}
