// Registers server/server.js as a Windows service named "Stitch Pattern Studio" so it
// starts automatically at boot, before any user logs in.
//
// Must be run from an elevated (Administrator) terminal:
//   node scripts/install-service.js
//
// To remove it later: node scripts/uninstall-service.js

const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'Stitch Pattern Studio',
  description: 'Stitch Pattern Studio local server (pattern editor and stitch counter on port 3001).',
  script: path.join(__dirname, '..', 'server', 'server.js')
});

svc.on('install', () => {
  console.log('Service installed. Starting it now...');
  svc.start();
});
svc.on('start', () => {
  console.log('Service started. Stitch Pattern Studio will now run at http://localhost:3001 automatically on every boot.');
});
svc.on('alreadyinstalled', () => {
  console.log('A service named "Stitch Pattern Studio" is already installed.');
});
svc.on('error', err => {
  console.error('Service error:', err);
});

console.log('Installing "Stitch Pattern Studio" as a Windows service...');
svc.install();
