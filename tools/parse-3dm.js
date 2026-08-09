// 用法: node tools/parse-3dm.js <文件.3dm>
// 用 Rhino 官方开源库 rhino3dm 读取 3DM 内容清单
const fs = require('fs');
const rhino3dm = require('rhino3dm');

(async () => {
    const rhino = await rhino3dm();
    const file = process.argv[2];
    if (!file || !fs.existsSync(file)) {
        console.error('文件不存在: ' + file);
        process.exit(1);
    }
    const doc = rhino.File3dm.fromByteArray(new Uint8Array(fs.readFileSync(file)));
    if (!doc) {
        console.error('无法解析 3DM 文件');
        process.exit(1);
    }
    const objs = doc.objects();
    console.log('objsKeys:', Object.keys(objs).join(','));
    console.log('objsCtor:', objs.constructor.name);
    const getObj = (i) => (Array.isArray(objs) ? objs[i] : objs.get(i));
    const count = Array.isArray(objs) ? objs.length : (typeof objs.size === 'function' ? objs.size() : (objs.length || 0));
    console.log('3DM 对象总数: ' + count);
    const summary = {};
    for (let i = 0; i < count; i++) {
        let type = '?';
        let name = '';
        try {
            const g = getObj(i).geometry();
            type = g.constructor.name.replace('Rhino', '');
            try { name = getObj(i).attributes().name || ''; } catch (e) { }
        } catch (e) { }
        summary[type] = (summary[type] || 0) + 1;
        if (i < 60) console.log(i + ': ' + type + (name ? '  [' + name + ']' : ''));
    }
    console.log('类型统计:');
    Object.keys(summary).forEach(k => console.log('  ' + k + ': ' + summary[k]));
})();
