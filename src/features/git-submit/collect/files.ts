/**
 * 资源 / 二进制：只记文件名，不读内容进 prompt（省 token）。
 * 代码与常见文本配置仍走 diff。
 */

const ASSET_EXT = new Set(
  [
    // 图片
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'icns',
    'tif',
    'tiff',
    'avif',
    'heic',
    'heif',
    'psd',
    'ai',
    'sketch',
    'fig',
    // 字体
    'ttf',
    'otf',
    'woff',
    'woff2',
    'eot',
    // 音视频
    'mp3',
    'wav',
    'flac',
    'aac',
    'ogg',
    'm4a',
    'mp4',
    'mov',
    'avi',
    'mkv',
    'webm',
    'flv',
    'm4v',
    // 压缩包 / 安装包
    'zip',
    'rar',
    '7z',
    'tar',
    'gz',
    'tgz',
    'bz2',
    'xz',
    'dmg',
    'iso',
    'apk',
    'ipa',
    // 文档 / 二进制产物
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'wasm',
    'so',
    'dylib',
    'dll',
    'exe',
    'bin',
    'class',
    'jar',
    'o',
    'a',
    'pyc',
    'pyo',
    // 地图 / 设计源
    'map',
  ].map((e) => e.toLowerCase()),
)

/** 资源目录习惯路径（即使扩展名像文本也只记名） */
const ASSET_DIR_RE =
  /(^|\/)(assets?|static|public\/(images?|img|fonts?|media|videos?|audio)|images?|img|fonts?|media|videos?|icons?)(\/|$)/i

export function fileExt(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || ''
  const i = base.lastIndexOf('.')
  if (i <= 0) return ''
  return base.slice(i + 1).toLowerCase()
}

/** 图片 / 字体 / 音视频 / 压缩包等：内容不进 diff */
export function isAssetPath(filePath: string): boolean {
  if (ASSET_EXT.has(fileExt(filePath))) return true
  if (ASSET_DIR_RE.test(filePath.replace(/\\/g, '/'))) return true
  return false
}
