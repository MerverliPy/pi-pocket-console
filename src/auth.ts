import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pi_pocket_session";
export const SESSION_COOKIE_SECURE = "__Secure-pi_pocket_session";

interface Session {
	id: string;
	token: string;
	csrfToken: string;
	expiresAt: number;
}

interface AttemptWindow {
	count: number;
	resetAt: number;
}

export class PairingError extends Error {
	readonly status: number;
	readonly retryAfterSeconds?: number;

	constructor(message: string, status: number, retryAfterSeconds?: number) {
		super(message);
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

function equalSecret(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header: string | undefined): Map<string, string> {
	const cookies = new Map<string, string>();
	if (!header) {
		return cookies;
	}
	for (const segment of header.split(";")) {
		const separator = segment.indexOf("=");
		if (separator === -1) {
			continue;
		}
		const name = segment.slice(0, separator).trim();
		const value = segment.slice(separator + 1).trim();
		if (name) {
			cookies.set(name, value);
		}
	}
	return cookies;
}

export class AuthManager {
	readonly pairingCode: string;

	private activePairingCode: string | undefined;
	private readonly pairingExpiresAt: number;
	private readonly sessions = new Map<string, Session>();
	private readonly attempts = new Map<string, AttemptWindow>();

	constructor(
		private readonly secureCookie: boolean,
		private readonly now: () => number = Date.now,
		private readonly pairingWindowMs = 10 * 60_000,
		private readonly sessionTtlMs = 12 * 60 * 60_000,
	) {
		this.pairingCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
		this.activePairingCode = this.pairingCode;
		this.pairingExpiresAt = this.now() + this.pairingWindowMs;
	}

	pair(code: string, address: string): Session {
		const now = this.now();
		const attempt = this.attempts.get(address);
		if (attempt && attempt.resetAt > now && attempt.count >= 5) {
			throw new PairingError("Too many pairing attempts", 429, Math.max(1, Math.ceil((attempt.resetAt - now) / 1_000)));
		}
		if (!this.activePairingCode || now > this.pairingExpiresAt) {
			throw new PairingError("Pairing code is no longer available", 410);
		}
		if (!equalSecret(code, this.activePairingCode)) {
			const window = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + this.pairingWindowMs };
			window.count += 1;
			this.attempts.set(address, window);
			throw new PairingError("Invalid pairing code", 401);
		}

		this.activePairingCode = undefined;
		this.attempts.clear();
		const session: Session = {
			id: randomUUID(),
			token: randomBytes(32).toString("base64url"),
			csrfToken: randomBytes(32).toString("base64url"),
			expiresAt: now + this.sessionTtlMs,
		};
		this.sessions.set(session.token, session);
		return session;
	}

	authenticate(cookieHeader: string | undefined): Session | undefined {
		const cookies = parseCookies(cookieHeader);
		const token = cookies.get(SESSION_COOKIE_SECURE) ?? cookies.get(SESSION_COOKIE);
		if (!token) {
			return undefined;
		}
		const session = this.sessions.get(token);
		if (!session) {
			return undefined;
		}
		if (session.expiresAt <= this.now()) {
			this.sessions.delete(token);
			return undefined;
		}
		return session;
	}

	verifyCsrf(session: Session, token: string | undefined): boolean {
		return token !== undefined && equalSecret(session.csrfToken, token);
	}

	revoke(session: Session): void {
		this.sessions.delete(session.token);
	}

	isSessionActive(sessionId: string): boolean {
		for (const [token, session] of this.sessions) {
			if (session.expiresAt <= this.now()) {
				this.sessions.delete(token);
				continue;
			}
			if (session.id === sessionId) {
				return true;
			}
		}
		return false;
	}

	private cookieName(): string {
		return this.secureCookie ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
	}

	sessionCookie(session: Session): string {
		const secure = this.secureCookie ? "; Secure" : "";
		return `${this.cookieName()}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
			this.sessionTtlMs / 1_000,
		)}${secure}`;
	}

	clearCookie(): string {
		const secure = this.secureCookie ? "; Secure" : "";
		return `${this.cookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
	}
}

export type AuthSession = ReturnType<AuthManager["authenticate"]> & {};
