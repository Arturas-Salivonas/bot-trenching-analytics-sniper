import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

async function main() {
  if (!existsSync('dist')) await mkdir('dist');
  await copyFile('manifest.json', 'dist/manifest.json');
  // ensure popup html path is at root dist if referenced
  if (existsSync('dist/src/popup/index.html')) {
    await copyFile('dist/src/popup/index.html', 'dist/popup.html');
  }
  if (existsSync('dist/src/overlay/index.html')) {
    await copyFile('dist/src/overlay/index.html', 'dist/overlay.html');
  }
  console.log('Manifest + popup prepared');
}
main();
