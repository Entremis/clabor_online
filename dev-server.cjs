'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const publicFiles = new Set([...require('./public-files.cjs'), 'sw.js']);
const root = process.argv.includes('--preview') ? path.join(__dirname,'dist') : __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
const port = Number(process.env.PORT || 4177);
http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!publicFiles.has(file)) { response.writeHead(404); response.end('Not found'); return; }
    if (!fs.existsSync(path.join(root,file))) { response.writeHead(404); response.end('Run npm run build first'); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(fs.readFileSync(path.join(root, file)));
}).listen(port, '127.0.0.1', () => console.log('Клабор: http://127.0.0.1:' + port));
