'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function verifyLocalNodeModules(root = path.resolve(__dirname, '..')) {
  const directory = path.join(root, 'node_modules');
  const message = 'Windows packaging requires a real local node_modules installed with npm ci.';
  let stat;
  try { stat = fs.lstatSync(directory); } catch (cause) { throw new Error(message, { cause }); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(message);
  if (process.platform === 'win32') {
    // Check all Windows reparse points, including tags Node does not treat as symlinks.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$item = Get-Item -LiteralPath node_modules -Force -ErrorAction Stop; if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }'
    ], { cwd: root, stdio: 'pipe' });
  }
  return directory;
}

if (require.main === module) {
  try {
    console.log(`Windows packaging preflight PASS: ${verifyLocalNodeModules()}`);
  } catch (_) {
    console.error('Windows packaging requires a real local node_modules installed with npm ci.');
    process.exitCode = 1;
  }
}

module.exports = { verifyLocalNodeModules };
