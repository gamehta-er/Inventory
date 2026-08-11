import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { AppError } from './errors.js';
import type { AuthenticatedRequest, SessionUser } from './types.js';

const sessionCookie = 'inventory_session';
const csrfCookie = 'inventory_csrf';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function userFromSession(token: string): Promise<{ user: SessionUser; sessionId: string } | null> {
  const result = await pool.query(
    `SELECT s.id AS session_id,u.id,u.display_name,u.initials,
       COALESCE(array_agg(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL),'{}') AS roles,
       COALESCE(array_agg(DISTINCT p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL),'{}') AS permissions
     FROM application_sessions s
     JOIN application_users u ON u.id=s.user_id AND u.active
     LEFT JOIN application_user_roles ur ON ur.user_id=u.id
     LEFT JOIN roles r ON r.id=ur.role_id AND r.active
     LEFT JOIN role_permissions rp ON rp.role_id=r.id
     LEFT JOIN permissions p ON p.id=rp.permission_id
     WHERE s.token_hash=$1 AND s.expires_at > now()
     GROUP BY s.id,u.id,u.display_name,u.initials`,
    [hash(token)],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    sessionId: String(row.session_id),
    user: {
      id: Number(row.id),
      displayName: String(row.display_name),
      initials: String(row.initials),
      roles: row.roles as string[],
      permissions: row.permissions as string[],
    },
  };
}

export async function authenticate(request: FastifyRequest): Promise<SessionUser> {
  const signedToken = request.cookies[sessionCookie];
  if (!signedToken) throw new AppError(401, 'AUTH_REQUIRED', 'Select your name to continue.');
  const unsigned = request.unsignCookie(signedToken);
  if (!unsigned.valid || !unsigned.value) throw new AppError(401, 'SESSION_INVALID', 'Your session is invalid. Select your name again.');
  const token = unsigned.value;
  const session = await userFromSession(token);
  if (!session) throw new AppError(401, 'SESSION_EXPIRED', 'Your session expired. Select your name again.');
  (request as AuthenticatedRequest).inventoryUser = session.user;
  (request as AuthenticatedRequest).inventorySessionId = session.sessionId;
  return session.user;
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const user = await authenticate(request);
    if (!user.permissions.includes(permission)) {
      throw new AppError(403, 'FORBIDDEN', `Permission required: ${permission}`);
    }
  };
}

export async function verifyCsrf(request: FastifyRequest): Promise<void> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const sessionId = (request as AuthenticatedRequest).inventorySessionId;
  const header = request.headers['x-csrf-token'];
  if (!sessionId || typeof header !== 'string') throw new AppError(403, 'CSRF_INVALID', 'Security token is missing.');
  const result = await pool.query('SELECT 1 FROM application_sessions WHERE id=$1 AND csrf_token_hash=$2', [sessionId, hash(header)]);
  if (!result.rowCount) throw new AppError(403, 'CSRF_INVALID', 'Security token is invalid.');
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/auth/users', async () => {
    const result = await pool.query(
      `SELECT u.id,u.display_name,u.initials,COALESCE(array_agg(r.role_key ORDER BY r.role_key) FILTER (WHERE r.role_key IS NOT NULL),'{}') roles
       FROM application_users u LEFT JOIN application_user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
       WHERE u.active GROUP BY u.id ORDER BY u.display_name`,
    );
    return { users: result.rows.map((row) => ({ id: Number(row.id), displayName: row.display_name, initials: row.initials, roles: row.roles })) };
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = request.body as { userId?: number };
    if (!Number.isInteger(body?.userId)) throw new AppError(400, 'USER_REQUIRED', 'Select a user.');
    const user = await pool.query('SELECT id FROM application_users WHERE id=$1 AND active', [body.userId]);
    if (!user.rowCount) throw new AppError(404, 'USER_NOT_FOUND', 'The selected user is unavailable.');
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    await pool.query(
      `INSERT INTO application_sessions(token_hash,user_id,csrf_token_hash,expires_at)
       VALUES($1,$2,$3,now()+($4 || ' hours')::interval)`,
      [hash(token), body.userId, hash(csrf), config.SESSION_HOURS],
    );
    const options = { path: '/', sameSite: 'strict' as const, secure: config.cookieSecure, maxAge: config.SESSION_HOURS * 3600 };
    reply.setCookie(sessionCookie, token, { ...options, httpOnly: true, signed: true });
    reply.setCookie(csrfCookie, csrf, { ...options, httpOnly: false });
    return { authenticated: true };
  });

  app.get('/api/v1/auth/session', async (request) => {
    try {
      return { authenticated: true, user: await authenticate(request) };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) return { authenticated: false, user: null };
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    await verifyCsrf(request);
    const sessionId = (request as AuthenticatedRequest).inventorySessionId;
    await pool.query('DELETE FROM application_sessions WHERE id=$1', [sessionId]);
    reply.clearCookie(sessionCookie, { path: '/' }).clearCookie(csrfCookie, { path: '/' });
    return { authenticated: false };
  });
}
