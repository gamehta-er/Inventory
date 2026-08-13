import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://inventory_test:inventory_test@127.0.0.1:5432/inventory_test';
process.env.COOKIE_SECRET = 'inventory-test-cookie-secret-32-characters';
process.env.UPLOAD_ROOT = './.test-uploads';
const maintenanceFlag = resolve('./.test-uploads/maintenance-test.flag');
process.env.MAINTENANCE_FLAG_PATH = maintenanceFlag;

let app: FastifyInstance;

before(async () => {
  const module = await import('../src/app.js');
  app = await module.buildApp();
  await app.ready();
});

after(async () => {
  await unlink(maintenanceFlag).catch(() => undefined);
  await app.close();
});

describe('public and protected API boundaries', () => {
  it('reports the API process as live without database access', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'live', service: 'inventory-api' });
  });

  it('returns the public unauthenticated session state', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { authenticated: false, user: null });
  });

  it('protects the application session endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/session' });
    const body = response.json();
    assert.equal(response.statusCode, 401);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(typeof body.requestId, 'string');
  });

  it('protects asset mutations before request validation', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/assets', payload: {} });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'AUTH_REQUIRED');
  });

  it('returns a structured not-found response', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    const body = response.json();
    assert.equal(response.statusCode, 404);
    assert.equal(body.code, 'ROUTE_NOT_FOUND');
    assert.match(body.message, /does-not-exist/);
  });

  it('keeps public recovery endpoints available during maintenance', async () => {
    await mkdir(resolve('./.test-uploads'), { recursive: true });
    await writeFile(maintenanceFlag, JSON.stringify({ enabled: true, reason: 'Planned service work', source: 'application' }));
    try {
      const health = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
      const authentication = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
      assert.equal(health.statusCode, 200);
      assert.equal(authentication.statusCode, 200);
    } finally {
      await unlink(maintenanceFlag).catch(() => undefined);
    }
  });

  it('blocks protected workflows with a structured maintenance response', async () => {
    await mkdir(resolve('./.test-uploads'), { recursive: true });
    await writeFile(maintenanceFlag, JSON.stringify({ enabled: true, reason: 'Database maintenance', source: 'application' }));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/session' });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().code, 'MAINTENANCE_ACTIVE');
      assert.match(response.json().message, /Database maintenance/);
    } finally {
      await unlink(maintenanceFlag).catch(() => undefined);
    }
  });
});
