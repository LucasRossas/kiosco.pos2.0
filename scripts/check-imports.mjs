import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const apiDir = path.resolve('api');
const filesToCheck = [];

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith('.js')) {
      filesToCheck.push(fullPath);
    }
  }
}

walk(apiDir);

let hasError = false;

console.log('Iniciando verificación de imports...');

for (const filePath of filesToCheck) {
  const relativePath = path.relative(process.cwd(), filePath);
  try {
    // Usamos pathToFileURL para asegurar compatibilidad con Windows en imports dinámicos
    await import(pathToFileURL(filePath).href);
    console.log(`OK: ${relativePath}`);
  } catch (error) {
    console.error(`FALLO: ${relativePath}`);
    console.error(`  Error: ${error.message}`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\nSe encontraron errores en los imports del backend.');
  process.exit(1);
} else {
  console.log('\nTodos los archivos se importaron correctamente.');
  process.exit(0);
}
