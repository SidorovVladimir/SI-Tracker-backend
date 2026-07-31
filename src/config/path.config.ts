import path from 'path';
import fs from 'fs';

export const DOCUMENTS_DIR = process.env.DOCUMENTS_PATH
  ? path.resolve(process.env.DOCUMENTS_PATH)
  : path.join(process.cwd(), '../../docs');

export const UPLOAD_DIR = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(process.cwd(), '../../uploads');

export const initStorageFolders = () => {
  if (!fs.existsSync(DOCUMENTS_DIR))
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
};
