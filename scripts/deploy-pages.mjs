// Publica public/ no branch gh-pages e na raiz do main (fonte atual do GitHub Pages em ianf.droppfy.com)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.pages-tmp');
const notFound = '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><script>location.replace("/")</script>';

const sh = (c, cwd = root) => execSync(c, { stdio: 'inherit', cwd });

// 1) Raiz do main (fonte do Pages enquanto a fonte for main/root):
//    copia public/* para a raiz; o CNAME da raiz é preservado
cpSync(join(root, 'public'), root, { recursive: true, force: true });
writeFileSync(join(root, '404.html'), notFound);

const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
if (dirty) {
  sh('git add -A');
  sh('git -c user.name="IANF" -c user.email="ianf@users.noreply.github.com" commit -q -m "Deploy frontend IANF (raiz para Pages)"');
  sh('git push -q origin main');
  console.log('Frontend publicado na raiz do main (fonte atual do Pages).');
} else {
  console.log('Raiz do main já está atualizada.');
}

// 2) Branch gh-pages (fonte alternativa/futura do Pages)
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync(join(root, 'public'), tmp, { recursive: true });
if (existsSync(join(root, 'CNAME'))) cpSync(join(root, 'CNAME'), join(tmp, 'CNAME'));
writeFileSync(join(tmp, '404.html'), notFound);

sh('git init -q -b gh-pages', tmp);
sh('git add -A', tmp);
sh('git -c user.name="IANF" -c user.email="ianf@users.noreply.github.com" commit -q -m "Deploy frontend IANF" --allow-empty', tmp);

const origin = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
sh(`git push -qf ${origin} gh-pages`, tmp);
console.log('Frontend publicado no branch gh-pages.');
