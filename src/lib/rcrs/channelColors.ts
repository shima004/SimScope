/** チャンネル番号ごとの色定義 (InfoPanel / SimMap で共有) */

/** CSS 色文字列 (InfoPanel 用) */
export const CHANNEL_COLORS_CSS: readonly string[] = [
  "#60c8ff", // ch 0 – 水色
  "#80e080", // ch 1 – 緑
  "#ffb840", // ch 2 – 橙
  "#d080ff", // ch 3 – 紫
  "#ff7070", // ch 4 – 赤
  "#40d8c8", // ch 5 – ティール
  "#f0e040", // ch 6 – 黄
  "#ff90c0", // ch 7 – ピンク
];

/** RGB タプル (deck.gl 用) */
export const CHANNEL_COLORS_RGB: readonly [number, number, number][] = [
  [96, 200, 255],
  [128, 224, 128],
  [255, 184, 64],
  [208, 128, 255],
  [255, 112, 112],
  [64, 216, 200],
  [240, 224, 64],
  [255, 144, 192],
];

export function channelColorCSS(ch: number): string {
  return CHANNEL_COLORS_CSS[ch % CHANNEL_COLORS_CSS.length];
}

export function channelColorRGB(ch: number): [number, number, number] {
  return CHANNEL_COLORS_RGB[ch % CHANNEL_COLORS_RGB.length];
}
