const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const extensionTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function supportedImageType(file) {
  const declaredType = String(file?.type || '').trim().toLowerCase();
  if (declaredType) return supportedTypes.has(declaredType) ? declaredType : '';
  // Some file pickers omit MIME metadata for otherwise normal camera/download
  // files. The provider and server still inspect the actual image bytes.
  const extension = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return Object.hasOwn(extensionTypes, extension) ? extensionTypes[extension] : '';
}
