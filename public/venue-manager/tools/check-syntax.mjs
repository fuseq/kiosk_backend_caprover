/**
 * Derleyicisi olmayan bir proje icin en yakin guvenlik agi:
 *   1. Her modulu `node --check` ile ayristirir (sozdizimi).
 *   2. Tarayici API'sine dokunmayan modulleri gercekten import eder —
 *      boylece eksik/yanlis yazilmis export'lar yakalanir.
 *
 * Kullanim: npm run check
 */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(projectRoot, 'src');

/* Modul yuklenirken tarayici global'lerine dokunanlar — import edilmez,
 * yalnizca sozdizimi kontrol edilir. */
const PARSE_ONLY = new Set(['src/main.js']);

async function collect(dir) {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...await collect(full));
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files.sort();
}

const files = await collect(srcRoot);
const failures = [];

for (const file of files) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    try {
        await run(process.execPath, ['--check', file]);
    } catch (err) {
        failures.push(`${rel}\n    sözdizimi: ${(err.stderr || err.message).trim().split('\n')[0]}`);
        continue;
    }

    if (PARSE_ONLY.has(rel)) {
        console.log(`  ok (yalnızca sözdizimi)  ${rel}`);
        continue;
    }

    try {
        await import(pathToFileURL(file).href);
        console.log(`  ok                        ${rel}`);
    } catch (err) {
        failures.push(`${rel}\n    import: ${err.message}`);
    }
}

console.log(`\n${files.length} dosya denetlendi.`);

if (failures.length) {
    console.error(`\n${failures.length} sorun:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    process.exit(1);
}
console.log('Sorun yok.');
