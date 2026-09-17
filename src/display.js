const fs = require('fs');

const X11_SOCKET_DIR = '/tmp/.X11-unix';

/**
 * Ensure DISPLAY is set before launching a HEADED browser.
 *
 * On WSL/WSLg an X server is running and its socket lives at
 * /tmp/.X11-unix/X<N>, but DISPLAY is not exported into every process
 * environment. An MCP server spawned by a client that itself has no DISPLAY
 * inherits an empty one, and Playwright then dies with a raw
 * "Missing X server or $DISPLAY" stack trace that names neither the cause nor
 * the fix. This recurs on every WSL restart.
 *
 * Detect the socket and set DISPLAY ourselves; report clearly when we cannot.
 *
 * @returns {{ok: boolean, display?: string, source?: string, reason?: string}}
 */
function ensureDisplay(opts = {}) {
  const socketDir = opts.socketDir ?? X11_SOCKET_DIR;
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;

  if (platform !== 'linux') return { ok: true, source: 'not-linux' };

  if (env.DISPLAY) {
    return { ok: true, display: env.DISPLAY, source: 'environment' };
  }

  let sockets = [];
  try {
    sockets = fs.readdirSync(socketDir).filter((f) => /^X\d+$/.test(f));
  } catch {
    sockets = [];
  }

  if (sockets.length === 0) {
    return {
      ok: false,
      reason: `DISPLAY is unset and no X<N> socket exists in ${socketDir}`,
    };
  }

  sockets.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const display = `:${sockets[0].slice(1)}`;
  env.DISPLAY = display;
  return { ok: true, display, source: 'detected' };
}

module.exports = { ensureDisplay, X11_SOCKET_DIR };
