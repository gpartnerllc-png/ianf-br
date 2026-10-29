// Publica public/ no branch gh-pages (fonte do GitHub Pages em ianf.droppfy.com)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.pages-tmp');

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync(join(root, 'public'), tmp, { recursive: true });
if (existsSync(join(root, 'CNAME'))) cpSync(join(root, 'CNAME'), join(tmp, 'CNAME'));
writeFileSync(
  join(tmp, '404.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><script>location.replace("/")</script>'
);

const sh = (c) => execSync(c, { stdio: 'inherit', cwd: tmp });
sh('git init -q -b gh-pages');
sh('git add -A');
sh('git -c user.name="IANF" -c user.email="ianf@users.noreply.github.com" commit -q -m "Deploy frontend IANF" --allow-empty');

const origin = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
sh(`git push -qf ${origin} gh-pages`);
console.log('Frontend publicado no branch gh-pages.');
