interface LegacyFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface LegacyFileEntry extends LegacyFileSystemEntry {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface LegacyDirectoryReader {
  readEntries: (success: (entries: LegacyFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
}

interface LegacyDirectoryEntry extends LegacyFileSystemEntry {
  createReader: () => LegacyDirectoryReader;
}

const MEDIA_EXTENSIONS = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp|mkv|mov|mp4|m4v|avi|webm|mpeg|mpg|mp3|wav|m4a|aac|flac|ogg)$/i;

export function isMediaFile(file: File) {
  return /^(image|video|audio)\//.test(file.type) || MEDIA_EXTENSIONS.test(file.name);
}

async function readEntry(entry: LegacyFileSystemEntry, path = ''): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as LegacyFileEntry).file(resolve, reject)
    );
    Object.defineProperty(file, 'relativePath', { value: `${path}${file.name}`, configurable: true });
    return [file];
  }
  if (!entry.isDirectory) return [];

  const reader = (entry as LegacyDirectoryEntry).createReader();
  const entries: LegacyFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyFileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map(child => readEntry(child, `${path}${entry.name}/`)));
  return nested.flat();
}

/** 读取拖入的文件及目录；目录读取依赖 Chromium/WebKit 的 FileSystemEntry API。 */
export async function mediaFilesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: LegacyFileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => LegacyFileSystemEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry as LegacyFileSystemEntry);
  }
  const files = entries.length
    ? (await Promise.all(entries.map(entry => readEntry(entry)))).flat()
    : Array.from(dataTransfer.files);
  return files.filter(isMediaFile);
}

export function mediaTypeForFile(file: Pick<File, 'type' | 'name'>): 'image' | 'video' | 'audio' {
  if (file.type.startsWith('video/') || /\.(mkv|mov|mp4|m4v|avi|webm|mpeg|mpg)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name)) return 'audio';
  return 'image';
}