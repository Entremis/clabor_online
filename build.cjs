'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const files = require('./public-files.cjs');
fs.mkdirSync(path.join(__dirname, 'vendor'), {recursive:true});
fs.copyFileSync(path.join(__dirname,'node_modules/dexie/dist/dexie.min.js'), path.join(__dirname,'vendor/dexie.min.js'));
fs.copyFileSync(path.join(__dirname,'node_modules/dexie/LICENSE'), path.join(__dirname,'vendor/DEXIE-LICENSE'));
fs.mkdirSync(path.join(__dirname,'icons'), {recursive:true});
// Small, code-native club icon. PNGs also work on iOS home screens.
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
    return Buffer.concat([size,name,data,crc]);
}
function icon(size, filename) {
    const pixels = Buffer.alloc(size*(1+size*4));
    for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
        let coverage = 0;
        for(let sy=0;sy<2;sy++) for(let sx=0;sx<2;sx++) {
            const u=(x+(sx+.5)/2)/size, v=(y+(sy+.5)/2)/size;
            if ([[.5,.35],[.36,.51],[.64,.51]].some(([cx,cy]) => (u-cx)**2+(v-cy)**2 < .135**2) ||
                (v>.48 && v<.75 && Math.abs(u-.5)<.035+(v-.48)*.25)) coverage++;
        }
        const at=y*(1+size*4)+1+x*4;
        [24,94,78].forEach((c,i)=>pixels[at+i]=Math.round(c+(255-c)*coverage/4)); pixels[at+3]=255;
    }
    const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
    fs.writeFileSync(path.join(__dirname,'icons',filename),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
icon(192,'icon-192.png'); icon(512,'icon-512.png'); icon(180,'apple-touch-icon.png');
if (!process.argv.includes('--prepare')) {
    const hash=crypto.createHash('sha256');
    for (const file of files) {
        const data=fs.readFileSync(path.join(__dirname,file)); hash.update(file).update(data);
        const target=path.join(__dirname,'dist',file); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,data);
    }
    const worker=fs.readFileSync(path.join(__dirname,'sw.js'),'utf8'); hash.update(worker);
    fs.writeFileSync(path.join(__dirname,'dist/sw.js'),worker.replace('__CACHE_VERSION__',hash.digest('hex').slice(0,16)));
    console.log('Готово: dist/');
}
