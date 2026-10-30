// Removes the "Stitch Pattern Studio" Windows service installed by install-service.js.
// Must be run from an elevated (Administrator) terminal:
//   node scripts/uninstall-service.js

const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'Stitch Pattern Studio',
  script: path.join(__dirname, '..', 'server', 'server.js')
});

svc.on('uninstall', () => {
  console.log('Service uninstalled.');
});
svc.on('error', err => {
  console.error('Service error:', err);
});

console.log('Uninstalling "Stitch Pattern Studio" service...');
svc.uninstall();
