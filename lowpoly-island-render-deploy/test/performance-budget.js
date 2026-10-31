'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function check(ok, message) { if (!ok) throw new Error(message); }
check(html.includes('renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))'), 'high-DPI render cap missing');
check(html.includes('sun.shadow.mapSize.set(1024, 1024)'), 'shadow map reduction missing');
check(html.includes('if (elapsed - lastWindSwayUpdate < 1/30) return;'), 'sway throttle missing');
check(html.includes('function shouldUpdateEnemyDetailAnimation(en, mesh, dt)'), 'distant pose scheduler missing');
check(html.includes('distSq < 34*34') && html.includes('distSq < 70*70'), 'distance tiers missing');
check(html.includes('en.dying || en.ph || en.atkT > 0 || en.hitFlash > 0 || en.hpBarTimer > 0'), 'combat animation priority missing');
check(/<div id="versionLabel"[^>]*>v70\.15<\/div>/.test(html), 'version label must display v70.15');
console.log('PASS performance safeguards and animation priorities');
