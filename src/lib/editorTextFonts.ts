export const EDITOR_TEXT_FONT_WEIGHT = 600;
export const EDITOR_TEXT_FONT_LOAD_SAMPLE = '안녕하세요 ABCD 1234';
export const EDITOR_TEXT_TROIKA_PRELOAD_CHARACTERS =
  '안녕하세요 가나다라마바사아자차카타파하 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,!?()[]+-=*/_';
export const DEFAULT_TEXT_TROIKA_FONT_URL = '/fonts/Pretendard-SemiBold.woff';
export const SYSTEM_SANS_TEXT_TROIKA_FONT_URL = '/fonts/AppleGothic.ttf';
export const SERIF_KR_TEXT_TROIKA_FONT_URL = '/fonts/AppleMyungjo.ttf';

export type EditorTextFontPreset = {
  id: string;
  label: string;
  family: string;
  loadFamily?: string;
  troikaFontUrl?: string;
};

export const EDITOR_TEXT_FONT_PRESETS: EditorTextFontPreset[] = [
  {
    id: 'pretendard',
    label: 'Pretendard',
    family:
      '"Pretendard Variable", "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    loadFamily: 'Pretendard Variable',
    troikaFontUrl: DEFAULT_TEXT_TROIKA_FONT_URL,
  },
  {
    id: 'system-sans',
    label: 'System Sans',
    family:
      '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
    loadFamily: 'AppleGothic',
    troikaFontUrl: SYSTEM_SANS_TEXT_TROIKA_FONT_URL,
  },
  {
    id: 'serif-kr',
    label: 'Serif KR',
    family: '"Noto Serif KR", "AppleMyungjo", "Batang", "Times New Roman", serif',
    loadFamily: 'AppleMyungjo',
    troikaFontUrl: SERIF_KR_TEXT_TROIKA_FONT_URL,
  },
];

export const DEFAULT_TEXT_FONT_FAMILY = EDITOR_TEXT_FONT_PRESETS[0].id;

export function getEditorTextFontPreset(fontFamily = DEFAULT_TEXT_FONT_FAMILY) {
  return EDITOR_TEXT_FONT_PRESETS.find((preset) => preset.id === fontFamily) ?? EDITOR_TEXT_FONT_PRESETS[0];
}

export function getEditorTextFontFamily(fontFamily = DEFAULT_TEXT_FONT_FAMILY) {
  return getEditorTextFontPreset(fontFamily).family;
}

export function getEditorTextCanvasFont(fontSize: number, fontFamily = DEFAULT_TEXT_FONT_FAMILY, fontWeight = EDITOR_TEXT_FONT_WEIGHT) {
  return `${fontWeight} ${fontSize}px ${getEditorTextFontFamily(fontFamily)}`;
}

export function getEditorTextTroikaFontUrl(fontFamily = DEFAULT_TEXT_FONT_FAMILY) {
  return getEditorTextFontPreset(fontFamily).troikaFontUrl ?? DEFAULT_TEXT_TROIKA_FONT_URL;
}

function getFontLoadFamilyValue(fontFamily: string) {
  if (fontFamily.includes(',') || fontFamily.startsWith('"') || fontFamily.startsWith("'")) {
    return fontFamily;
  }

  return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

export async function loadEditorTextFont(fontFamily = DEFAULT_TEXT_FONT_FAMILY) {
  if (typeof document === 'undefined' || !document.fonts) return;

  const preset = getEditorTextFontPreset(fontFamily);
  const loadFamily = preset.loadFamily ?? preset.family;
  await document.fonts.load(
    `${EDITOR_TEXT_FONT_WEIGHT} 32px ${getFontLoadFamilyValue(loadFamily)}`,
    EDITOR_TEXT_FONT_LOAD_SAMPLE,
  );
}

export async function preloadEditorTextFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;

  await Promise.all(EDITOR_TEXT_FONT_PRESETS.map((preset) => loadEditorTextFont(preset.id).catch(() => undefined)));
  await document.fonts.ready;
}
