import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./start-db-tunnel.mjs', import.meta.url));
function run(port, args = []) {
  return execute(process.execPath, [script, ...args], {
    env: { ...process.env, DB_TUNNEL_PORT: String(port), DB_SSH_KEY: `${script}.missing-key`, DATABASE_URL: 'postgresql://127.0.0.1:5432/unused' },
    timeout: 6000,
  });
}

async function listener(t, reply) {
  const server = createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (request) => {
      assert.equal(request.readInt32BE(0), 8);
      assert.equal(request.readInt32BE(4), 80877103);
      socket.end(reply);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('reuse a PostgreSQL responder without opening another SSH connection', async (t) => {
  const port = await listener(t, 'N');
  const result = await run(port, ['--background']);
  assert.match(result.stdout, /already available/);
});

test('refuse an unrelated listener instead of claiming a working tunnel', async (t) => {
  const port = await listener(t, 'X');
  await assert.rejects(run(port, ['--background']), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /occupied but PostgreSQL does not respond/);
    return true;
  });
});

test('non-tunnel DATABASE_URL skips SSH even when no key exists', async () => {
  const result = await run(15432, ['--background', '--if-needed']);
  assert.match(result.stdout, /skipping/);
});

test('report a missing key before starting SSH', async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await assert.rejects(run(port), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /SSH private key not found/);
    return true;
  });
});
