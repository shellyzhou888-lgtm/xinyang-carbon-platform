#!/usr/bin/env node
// Cross-platform SSH supervisor. No passwords are read by or passed to SSH.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const args = new Set(process.argv.slice(2));
const port = Number(process.env.DB_TUNNEL_PORT || 15432);
const sshPort = Number(process.env.DB_SSH_PORT || 2222);
const host = process.env.DB_SSH_HOST || '218.197.118.49';
const user = process.env.DB_SSH_USER || 'administrator';
const key = process.env.DB_SSH_KEY || join(homedir(), '.ssh', 'id_ed25519');
const logPath = join(root, 'storage', 'db-tunnel', 'tunnel.log');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .find((entry) => entry.startsWith('DATABASE_URL='));
  return line?.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') || '';
}

// A TCP listener alone does not prove that the forwarded PostgreSQL server responds.
// SSLRequest is unauthenticated and reads no business data (N/S is the PostgreSQL reply).
function probe() {
  return new Promise((resolveProbe) => {
    let connected = false;
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (state) => { socket.destroy(); resolveProbe(state); };
    socket.setTimeout(1500, () => finish(connected ? 'unhealthy' : 'absent'));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED' ? 'absent' : 'unhealthy'));
    socket.once('connect', () => {
      connected = true;
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4);
      socket.write(request);
    });
    socket.once('data', (data) => finish(data[0] === 78 || data[0] === 83 ? 'ready' : 'unhealthy'));
    socket.once('end', () => finish('unhealthy'));
  });
}

function log(message) { console.log(`[${new Date().toISOString()}] ${message}`); }

async function supervise() {
  let child;
  let stopping = false;
  let retry = 0;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(0);
  });
  const windowsSsh = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
  const ssh = process.platform === 'win32' && existsSync(windowsSsh) ? windowsSsh : 'ssh';
  while (!stopping) {
    const state = await probe();
    if (state === 'ready') { log(`PostgreSQL already available on 127.0.0.1:${port}.`); return; }
    if (state === 'unhealthy') throw new Error(`Port ${port} is occupied but PostgreSQL does not respond. Inspect its owner; no process was stopped.`);
    const started = Date.now();
    log(`Connecting ${user}@${host}:${sshPort}; local port ${port}; supervisor PID ${process.pid}.`);
    const code = await new Promise((resolveExit, reject) => {
      child = spawn(ssh, ['-N', '-L', `127.0.0.1:${port}:127.0.0.1:5432`, '-p', String(sshPort), '-i', key,
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=12', '-o', 'TCPKeepAlive=yes',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', `${user}@${host}`],
      { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
      child.once('error', reject);
      child.once('exit', resolveExit);
    });
    child = undefined;
    if (stopping) return;
    if (args.has('--once')) { process.exitCode = code ?? 1; return; }
    retry = Date.now() - started > 60_000 ? 1 : retry + 1;
    const seconds = Math.min(60, retry * 5);
    log(`SSH exited (${code}); reconnecting in ${seconds}s.`);
    await delay(seconds * 1000);
  }
}

async function main() {
  for (const value of [port, sshPort]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Invalid SSH or tunnel port.');
  if (args.has('--if-needed')) {
    const url = new URL(databaseUrl());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port || 5432) !== port) {
      log('DATABASE_URL does not use this local tunnel; skipping.');
      return;
    }
  }
  const state = await probe();
  if (state === 'ready') { log(`PostgreSQL already available on 127.0.0.1:${port}.`); return; }
  if (state === 'unhealthy') throw new Error(`Port ${port} is occupied but PostgreSQL does not respond. Inspect its owner; no process was stopped.`);
  if (!existsSync(key)) throw new Error(`SSH private key not found: ${key}`);
  if (!args.has('--background')) return supervise();

  mkdirSync(dirname(logPath), { recursive: true });
  const output = openSync(logPath, 'a', 0o600);
  const daemon = spawn(process.execPath, [script], {
    detached: true, stdio: ['ignore', output, output], windowsHide: true,
  });
  closeSync(output);
  let spawnError;
  daemon.once('error', (error) => { spawnError = error; });
  daemon.unref();
  for (let attempt = 0; attempt < 25; attempt++) {
    if (spawnError) throw spawnError;
    if (await probe() === 'ready') {
      log(`Database tunnel ready; supervisor PID ${daemon.pid}. Log: ${logPath}`);
      return;
    }
    if (daemon.exitCode !== null || daemon.signalCode !== null) break;
    await delay(1000);
  }
  // Stop only the supervisor created by this invocation; existing tunnels are never killed.
  daemon.kill('SIGTERM');
  throw new Error(`Tunnel did not become ready. Inspect ${logPath} (SSH key, host verification, network or remote PostgreSQL).`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
