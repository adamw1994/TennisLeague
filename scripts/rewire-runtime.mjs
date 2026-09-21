import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function resolveRuntimeImport(fromFile, specifier) {
  if (specifier.startsWith('node:') || (!specifier.startsWith('.') && !specifier.startsWith('@/'))) {
    return specifier;
  }

  const sourceBase = specifier.startsWith('@/')
    ? join(dist, 'src', specifier.slice(2))
    : join(dirname(fromFile), specifier);
  const candidates = [sourceBase, `${sourceBase}.js`, join(sourceBase, 'index.js')];
  const target = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
  if (!target) return specifier;

  let rewritten = relative(dirname(fromFile), target).replaceAll('\\', '/');
  if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
  return rewritten;
}

const importPattern = /(\bfrom\s*['"]|\bimport\s*\(\s*['"]|\bimport\s*['"])([^'"]+)(['"])/g;
for (const file of filesIn(dist).filter(path => extname(path) === '.js')) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(importPattern, (full, prefix, specifier, suffix) => {
    return `${prefix}${resolveRuntimeImport(file, specifier)}${suffix}`;
  });
  if (rewritten !== source) writeFileSync(file, rewritten);
}
