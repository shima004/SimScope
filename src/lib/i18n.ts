import { derived, writable } from "svelte/store";

export type Locale = "en" | "ja";

const STORAGE_KEY = "simscope.locale";

const en = {
  "app.title": "SimScope",
  "common.language": "Language",
  "language.en": "EN",
  "language.ja": "JA",
  "timeline.close": "Close timeline",
  "timeline.open": "Open timeline",
  "loading.downloading": "Downloading...",
  "loading.extracting": "Extracting...",
  "loading.parsing": "Parsing...",
  "loading.loading": "Loading...",
  "control.connection": "Load / Connect",
  "control.tcpServer": "TCP Server",
  "control.host": "host",
  "control.port": "port",
  "control.cut": "Cut",
  "control.connect": "Connect",
  "control.connected": "Connected",
  "control.connecting": "Connecting...",
  "control.or": "or",
  "control.logFile": "Log File",
  "control.openLogFile": "Open 7z tgz tar.gz xz log file",
  "control.load": "Load",
  "control.step": "Step",
  "control.speed": "Speed",
  "control.stepBack": "Back 1 step",
  "control.pause": "Pause",
  "control.play": "Play",
  "control.stepForward": "Forward 1 step",
  "control.loopOff": "Turn loop playback off",
  "control.loopOn": "Turn loop playback on",
  "control.loop": "Loop playback",
  "control.emojiMode": "Emoji mode (click to switch)",
  "control.circleMode": "Circle mode (click to switch)",
  "control.agentDisplay": "Toggle agent display",
  "control.loopRestart": "Loop restarts in {seconds}s",
  "control.kernelConfig": "Kernel Config",
  "control.follow": "Follow",
  "control.followTitle": "Follow the selected agent",
  "control.perception": "Perception",
  "control.perceptionTitle": "Show selected agent's perceived world",
  "control.value": "(value)",
  "score.score": "Score",
  "score.injuredInRefuge": "Injured in Refuge",
  "score.blockadeCleared": "Blockade Cleared",
  "channels.title": "Channels",
  "idle.title": "Idle Agents",
  "civilian.title": "Civilian Status",
  "civilian.perceived": "Perceived",
  "civilian.actual": "Actual",
  "section.carrying": "Carrying",
  "section.rescuing": "Rescuing",
  "section.injured": "Injured",
  "section.buried": "Buried",
  "info.position": "Position",
  "info.fieryness": "Fieryness",
  "info.brokenness": "Brokenness",
  "info.temperature": "Temperature",
  "info.floors": "Floors",
  "info.action": "Action",
  "info.dest": "Dest",
  "info.speak": "Speak",
  "info.subscribe": "Subscribe",
  "info.hp": "HP",
  "info.damage": "Damage",
  "info.buriedness": "Buriedness",
  "info.stamina": "Stamina",
  "info.inArea": "In Area",
  "info.beds": "Beds",
  "info.waiting": "Waiting",
  "info.noPassenger": "No passenger",
  "info.water": "Water",
  "info.repairCost": "Repair Cost",
  "info.onRoad": "On Road",
  "info.communications": "Communications",
  "info.selectCivilian": "Select civilian ->",
  "info.switchPin": "Switch pin to this entity",
  "info.unpin": "Unpin",
  "info.pin": "Pin",
  "common.close": "Close",
  "timeline.title": "Event Timeline",
  "timeline.noEvents": "No events",
  "timeline.now": "NOW",
  "timeline.agent": "Agent",
  "timeline.target": "Target",
  "timeline.event.rescue_start": "Rescue Start",
  "timeline.event.rescue_end": "Rescue End",
  "timeline.event.carry_start": "Carry Start",
  "timeline.event.carry_end": "Carry End",
  "entity.world": "World",
  "entity.road": "Road",
  "entity.blockade": "Blockade",
  "entity.building": "Building",
  "entity.refuge": "Refuge",
  "entity.hydrant": "Hydrant",
  "entity.gasStation": "Gas Station",
  "entity.fireStation": "Fire Station",
  "entity.ambulanceCentre": "Ambulance Centre",
  "entity.policeOffice": "Police Office",
  "entity.civilian": "Civilian",
  "entity.fireBrigade": "Fire Brigade",
  "entity.ambulanceTeam": "Ambulance Team",
  "entity.policeForce": "Police Force",
  "command.rest": "Rest",
  "command.move": "Move",
  "command.load": "Load",
  "command.unload": "Unload",
  "command.say": "Say",
  "command.tell": "Tell",
  "command.extinguish": "Extinguish",
  "command.rescue": "Rescue",
  "command.clear": "Clear",
  "command.clearArea": "Clear Area",
  "command.subscribe": "Subscribe",
  "command.speak": "Speak",
  "fieryness.0": "Unburned",
  "fieryness.1": "Heating",
  "fieryness.2": "Burning",
  "fieryness.3": "Inferno",
  "fieryness.4": "Water Damage",
  "fieryness.5": "Minor Damage",
  "fieryness.6": "Moderate Damage",
  "fieryness.7": "Severe Damage",
  "fieryness.8": "Completely Burned",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  "app.title": "SimScope",
  "common.language": "言語",
  "language.en": "EN",
  "language.ja": "JA",
  "timeline.close": "タイムラインを閉じる",
  "timeline.open": "タイムラインを開く",
  "loading.downloading": "ダウンロード中...",
  "loading.extracting": "展開中...",
  "loading.parsing": "解析中...",
  "loading.loading": "読み込み中...",
  "control.connection": "読み込み / 接続",
  "control.tcpServer": "TCP サーバー",
  "control.host": "ホスト",
  "control.port": "ポート",
  "control.cut": "切断",
  "control.connect": "接続",
  "control.connected": "接続済み",
  "control.connecting": "接続中...",
  "control.or": "または",
  "control.logFile": "ログファイル",
  "control.openLogFile": "7z tgz tar.gz xz log ファイルを開く",
  "control.load": "読み込み",
  "control.step": "ステップ",
  "control.speed": "速度",
  "control.stepBack": "1ステップ戻る",
  "control.pause": "一時停止",
  "control.play": "自動再生",
  "control.stepForward": "1ステップ進む",
  "control.loopOff": "ループ再生オフ",
  "control.loopOn": "ループ再生オン",
  "control.loop": "ループ再生",
  "control.emojiMode": "絵文字モード（クリックで切替）",
  "control.circleMode": "Circleモード（クリックで切替）",
  "control.agentDisplay": "エージェント表示切替",
  "control.loopRestart": "{seconds}s でループ再開",
  "control.kernelConfig": "Kernel Config",
  "control.follow": "追従",
  "control.followTitle": "選択中のエージェントに追従",
  "control.perception": "知覚",
  "control.perceptionTitle": "選択エージェントの知覚世界を表示",
  "control.value": "(値)",
  "score.score": "スコア",
  "score.injuredInRefuge": "避難所内の負傷者",
  "score.blockadeCleared": "除去済みの瓦礫",
  "channels.title": "チャンネル",
  "idle.title": "待機エージェント",
  "civilian.title": "市民ステータス",
  "civilian.perceived": "知覚",
  "civilian.actual": "実際",
  "section.carrying": "搬送中",
  "section.rescuing": "救助中",
  "section.injured": "負傷",
  "section.buried": "埋没",
  "info.position": "位置",
  "info.fieryness": "燃焼状態",
  "info.brokenness": "損壊度",
  "info.temperature": "温度",
  "info.floors": "階数",
  "info.action": "行動",
  "info.dest": "目的地",
  "info.speak": "発話",
  "info.subscribe": "購読",
  "info.hp": "HP",
  "info.damage": "ダメージ",
  "info.buriedness": "埋没度",
  "info.stamina": "スタミナ",
  "info.inArea": "所在エリア",
  "info.beds": "ベッド",
  "info.waiting": "待機",
  "info.noPassenger": "乗客なし",
  "info.water": "水量",
  "info.repairCost": "修復コスト",
  "info.onRoad": "道路",
  "info.communications": "通信",
  "info.selectCivilian": "市民を選択 ->",
  "info.switchPin": "こちらをピン止めに切り替え",
  "info.unpin": "ピン止め解除",
  "info.pin": "ピン止め",
  "common.close": "閉じる",
  "timeline.title": "イベントタイムライン",
  "timeline.noEvents": "イベントなし",
  "timeline.now": "現在",
  "timeline.agent": "エージェント",
  "timeline.target": "対象",
  "timeline.event.rescue_start": "救助開始",
  "timeline.event.rescue_end": "救助終了",
  "timeline.event.carry_start": "搬送開始",
  "timeline.event.carry_end": "搬送終了",
  "entity.world": "ワールド",
  "entity.road": "道路",
  "entity.blockade": "閉塞",
  "entity.building": "建物",
  "entity.refuge": "避難所",
  "entity.hydrant": "消火栓",
  "entity.gasStation": "ガスステーション",
  "entity.fireStation": "消防署",
  "entity.ambulanceCentre": "救急センター",
  "entity.policeOffice": "警察署",
  "entity.civilian": "市民",
  "entity.fireBrigade": "消防隊",
  "entity.ambulanceTeam": "救急隊",
  "entity.policeForce": "警察隊",
  "command.rest": "休む",
  "command.move": "移動",
  "command.load": "搭載",
  "command.unload": "降ろす",
  "command.say": "Say",
  "command.tell": "Tell",
  "command.extinguish": "消火",
  "command.rescue": "救助",
  "command.clear": "除去",
  "command.clearArea": "範囲除去",
  "command.subscribe": "購読",
  "command.speak": "発話",
  "fieryness.0": "未燃焼",
  "fieryness.1": "加熱中",
  "fieryness.2": "燃焼中",
  "fieryness.3": "猛火",
  "fieryness.4": "水損",
  "fieryness.5": "軽度損傷",
  "fieryness.6": "中度損傷",
  "fieryness.7": "重度損傷",
  "fieryness.8": "全焼",
};

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ja,
};

export const locale = writable<Locale>("en");

export const t = derived(locale, ($locale) => {
  const dict = dictionaries[$locale];
  return (
    key: TranslationKey,
    values: Record<string, string | number> = {},
  ) => {
    let text = dict[key] ?? en[key] ?? key;
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
});

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "ja";
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const storedLocale = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(storedLocale) ? storedLocale : null;
  } catch {
    return null;
  }
}

function applyLocale(nextLocale: Locale, persist: boolean) {
  locale.set(nextLocale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = nextLocale;
  }
  if (!persist || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
  } catch {
    // Ignore storage failures such as private browsing restrictions.
  }
}

export function initLocale() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const queryLocale = params.get("lang");
  const storedLocale = readStoredLocale();
  const browserLocale = window.navigator.language.toLowerCase().startsWith("ja")
    ? "ja"
    : "en";
  const nextLocale = isLocale(queryLocale)
    ? queryLocale
    : storedLocale ?? browserLocale;
  applyLocale(nextLocale, isLocale(queryLocale));
}

export function setLocale(nextLocale: Locale) {
  applyLocale(nextLocale, true);
}
