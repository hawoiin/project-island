// 性能計測UIは通常非表示で、F8を押した場合だけ表示する。
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
function check(name, ok) { if (!ok) throw new Error('FAIL ' + name); console.log('PASS ' + name); }
check('性能HUDはデフォルトでhidden', /<div id="performanceHud" hidden/.test(html));
check('F8で性能HUDを切り替える', /event\.code !== 'F8'/.test(html) && html.includes('performanceHudEnabled = !performanceHudEnabled'));
check('FPSを計測する', html.includes('performanceSampleFrames * 1000 / Math.max(1, elapsed)'));
check('フレーム処理時間を計測する', html.includes('Math.max(0, now - frameStartedAt)'));
check('実際のフレーム間隔を上限カット前に計測する', html.includes('const actualFrameGapMs = Math.max(0, now-last)') && html.includes('updatePerformanceHud(performanceFrameStartedAt, actualFrameGapMs)'));
check('描画コールと三角形数を表示する', html.includes('renderer.info.render') && html.includes('draw.triangles'));
check('敵/採集物/建築物数を表示する', html.includes('敵: ${enemies.length}') && html.includes('建築物: ${placedStructures.length}'));
check('HUDは描画完了後に計測する', html.indexOf('renderer.render(activeScene, camera);') < html.indexOf('updatePerformanceHud(performanceFrameStartedAt, actualFrameGapMs)'));
check('バージョンv70.5とキャッシュ更新が反映される', /<div id="versionLabel"[^>]*>v70\.5<\/div>/.test(html) && html.includes('shared.js?v=70.5-shade-beast'));
console.log('Performance HUD tests passed.');
