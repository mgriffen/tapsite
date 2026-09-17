import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureDisplay } from '../src/display.js';

function tmpSocketDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x11-test-'));
  for (const n of names) fs.writeFileSync(path.join(dir, n), '');
  return dir;
}

describe('ensureDisplay', () => {
  it('is a no-op off linux', () => {
    const env = {};
    const r = ensureDisplay({ platform: 'darwin', env, socketDir: '/nonexistent' });
    expect(r.ok).toBe(true);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('keeps an existing DISPLAY rather than overriding it', () => {
    const env = { DISPLAY: ':7' };
    const r = ensureDisplay({ platform: 'linux', env, socketDir: tmpSocketDir(['X0']) });
    expect(r).toMatchObject({ ok: true, display: ':7', source: 'environment' });
    expect(env.DISPLAY).toBe(':7');
  });

  it('detects DISPLAY from the X11 socket when unset', () => {
    const env = {};
    const r = ensureDisplay({ platform: 'linux', env, socketDir: tmpSocketDir(['X0']) });
    expect(r).toMatchObject({ ok: true, display: ':0', source: 'detected' });
    expect(env.DISPLAY).toBe(':0');
  });

  it('picks the lowest-numbered display when several exist', () => {
    const env = {};
    const r = ensureDisplay({ platform: 'linux', env, socketDir: tmpSocketDir(['X10', 'X2', 'X0']) });
    expect(r.display).toBe(':0');
  });

  it('ignores non-socket entries in the directory', () => {
    const env = {};
    const r = ensureDisplay({ platform: 'linux', env, socketDir: tmpSocketDir(['notasocket', 'X3']) });
    expect(r.display).toBe(':3');
  });

  it('fails clearly when there is no X server', () => {
    const env = {};
    const r = ensureDisplay({ platform: 'linux', env, socketDir: tmpSocketDir([]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no X<N> socket/);
    expect(env.DISPLAY).toBeUndefined();
  });

  it('fails clearly when the socket directory does not exist', () => {
    const r = ensureDisplay({ platform: 'linux', env: {}, socketDir: '/definitely/not/here' });
    expect(r.ok).toBe(false);
  });
});
