// Local server for Stitch Pattern Studio. Serves the static site (editor and counter)
// from the project folder. Patterns and progress stay in the browser, so there is no API.
//
// Run with: node server/server.js
// Installed as a Windows service with: node scripts/install-service.js
// Other devices on the LAN can then browse to http://<this-pc's-IP>:3001

const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3001;

// project files that are not part of the website
const HIDDEN = /^\/(server|scripts|node_modules|\.git|\.vs|\.claude)(\/|$)|^\/(package(-lock)?\.json|web\.config|\.gitignore)$/i;

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path); } catch (e) { return res.status(400).end(); }
  p = path.posix.normalize(p.replace(/\\/g, '/')); // "/js/../server" and "\" separators
  if (HIDDEN.test(p)) return res.status(404).end();
  next();
});
app.use(express.static(ROOT, {
  index: 'index.html',
  dotfiles: 'ignore',
  // always check for a newer version, so the browser never mixes old and new script files
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
}));
app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Stitch Pattern Studio running at http://localhost:${PORT}`);
  console.log(`On your LAN: http://<this-PC's-IP>:${PORT}`);
});
