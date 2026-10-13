import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/public/', import.meta.url), { recursive: true });
for (const file of ['index.html', 'veiledning.html', 'style.css'])
  await copyFile(
    new URL('../public/' + file, import.meta.url),
    new URL('../dist/public/' + file, import.meta.url),
  );
