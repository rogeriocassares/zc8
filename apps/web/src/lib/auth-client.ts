/**
 * Authentication client for Next.js API routes
 * These routes proxy to Elysia backend with better-auth
 * Implements member-based RBAC (Organization → Members → Devices)
 */

// Auth endpoints go through Next.js API routes (which proxy to Elysia)
// Other endpoints can use the Elysia backend directly if needed
const AUTH_API_BASE = '/api/auth';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export interface LoginCredentials {
  email: string;
  password: string;
  organizationId?: string;
}

export interface AuthSession {
  userId: string;
  email: string;
  platformRole: 'superAdmin' | 'user';
  userPlan?: string;
  organizationId: number | null;
  organizationName: string | null;
  memberRole: 'owner' | 'admin' | 'member' | null;
  token: string;
  tokenExpires: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  organizations: Array<{
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'editor' | 'viewer';
  }>;
}

class AuthClient {
  private session: AuthSession | null = null;

  constructor() {
    this.loadSession();
  }

  private loadSession() {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('auth_session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.tokenExpires > Date.now()) {
          this.session = parsed;
        } else {
          localStorage.removeItem('auth_session');
        }
      } catch (e) {
        localStorage.removeItem('auth_session');
      }
    }
  }

  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const res = await fetch(`${AUTH_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });

    if (!res.ok) {
      try {
        const error = await res.json();
        throw new Error(error.message || 'Login failed');
      } catch {
        throw new Error(`Login failed: ${res.status} ${res.statusText}`);
      }
    }

    try {
      const session: AuthSession = await res.json();
      this.session = session;
      localStorage.setItem('auth_session', JSON.stringify(session));
      return session;
    } catch {
      throw new Error('Invalid response from server');
    }
  }

  async logout(): Promise<void> {
    if (this.session?.token) {
      await fetch(`${AUTH_API_BASE}/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.session.token}`,
        },
      }).catch(() => { });
    }
    this.session = null;
    localStorage.removeItem('auth_session');
  }

  async getUserOrganizations(): Promise<AuthUser> {
    if (!this.session?.token) {
      throw new Error('Not authenticated');
    }

    const res = await fetch(`${AUTH_API_BASE}/me`, {
      headers: {
        'Authorization': `Bearer ${this.session.token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
        throw new Error('Session expired');
      }
      throw new Error('Failed to fetch user');
    }

    return res.json();
  }

  async switchOrganization(organizationId: string): Promise<AuthSession> {
    if (!this.session?.token) {
      throw new Error('Not authenticated');
    }

    const res = await fetch(`${AUTH_API_BASE}/switch-org`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ organizationId }),
    });

    if (!res.ok) {
      throw new Error('Failed to switch organization');
    }

    const session: AuthSession = await res.json();
    this.session = session;
    localStorage.setItem('auth_session', JSON.stringify(session));
    return session;
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  getToken(): string | null {
    return this.session?.token || null;
  }

  isAuthenticated(): boolean {
    return !!this.session && this.session.tokenExpires > Date.now();
  }

  isSuperAdmin(): boolean {
    return this.session?.platformRole === 'superAdmin';
  }

  canRead(resource: string): boolean {
    if (this.isSuperAdmin()) return true;
    const allowedRoles = ['owner', 'admin', 'member'];
    return this.session?.memberRole ? allowedRoles.includes(this.session.memberRole) : false;
  }

  canWrite(resource: string): boolean {
    if (this.isSuperAdmin()) return true;
    const allowedRoles = ['owner', 'admin'];
    return this.session?.memberRole ? allowedRoles.includes(this.session.memberRole) : false;
  }

  canAdmin(): boolean {
    if (this.isSuperAdmin()) return true;
    return this.session?.memberRole === 'owner' || this.session?.memberRole === 'admin';
  }
}

export const authClient = new AuthClient();
