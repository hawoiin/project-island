'use strict';
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const style = html.match(/#versionLabel\s*\{([^}]+)\}/);
if (!style) throw new Error('title-screen version label CSS is missing');
if (!/right\s*:\s*18px/.test(style[1]) || !/bottom\s*:\s*14px/.test(style[1])) {
  throw new Error('version label must be positioned at the bottom-right');
}
if (!/<div id="versionLabel"[^>]*>v69\.3<\/div>/.test(html)) {
  throw new Error('version label must display v69.3');
}
if (!/<div id="startOverlay">[\s\S]*?<div id="versionLabel"/.test(html)) {
  throw new Error('version label must be inside the title overlay');
}
console.log('PASS title screen shows v69.3 at bottom-right');
