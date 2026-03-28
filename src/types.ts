// ─── FX Target / CC Mapping ──────────────────────────────────────────────────

export type FxTarget =
  | 'inputA'
  | 'inputB'
  | 'inputC'
  | 'inputD'
  | 'trackA'
  | 'trackB'
  | 'trackC'
  | 'trackD';

export const FX_TARGET_CC_MAP: Record<FxTarget, number> = {
  inputA: 1,
  inputB: 2,
  inputC: 3,
  inputD: 4,
  trackA: 5,
  trackB: 6,
  trackC: 7,
  trackD: 8,
};

// ─── Message Configs ─────────────────────────────────────────────────────────

export type MidiMessageConfig = {
  id: string;
  target: FxTarget;
  fxType: number; // 0-54, or -1 for None
};

export type FreeMidiMessage = {
  id: string;
  cc: number;   // 0-127
  value: number; // 0-127
};

// ─── Canvas Elements (discriminated union) ───────────────────────────────────

type BaseElement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  keybind: string;
  color?: string;
  textColor?: string;
  fontSize?: number;
  quantize?: QuantizeSetting;
};

export type FxButtonElement = BaseElement & {
  type: 'fx_button';
  messages: MidiMessageConfig[];
};

export type FreeButtonElement = BaseElement & {
  type: 'free_button';
  freeMessages: FreeMidiMessage[];
};

export type FaderKeybind = {
  id: string;
  key: string;           // keyboard key
  targetValue: number;   // 0-127
  quantize?: QuantizeSetting;
  glideMode: 'off' | 'ms' | 'musical';  // glide time mode
  glideMs: number;       // glide time in milliseconds (when glideMode === 'ms')
  glideValueIndex: number; // index into QUANTIZE_LENGTHS (when glideMode === 'musical')
};

export type FaderElement = BaseElement & {
  type: 'fader';
  cc: number;       // which CC to send
  minValue: number;  // 0-127
  maxValue: number;  // 0-127
  currentValue: number; // live value during perform
  faderKeybinds?: FaderKeybind[];
};

export type MemoryButtonElement = BaseElement & {
  type: 'memory_button';
  memoryNumber: number; // 1-99
};

export type CanvasElement = FxButtonElement | FreeButtonElement | MemoryButtonElement | FaderElement;

// ─── Legacy alias (for templates saved with old format) ──────────────────────
export type MacroButtonConfig = CanvasElement;

// ─── Quantization ────────────────────────────────────────────────────────────

export type QuantizeMode = 'immediate' | 'quantized' | 'delay';

export const QUANTIZE_LENGTHS = [
  { label: '16th Note', ticks: 6 },
  { label: '8th Note', ticks: 12 },
  { label: '1 Beat', ticks: 24 },
  { label: '2 Beats', ticks: 48 },
  { label: '1 Bar', bars: 1 },
  { label: '2 Bars', bars: 2 },
  { label: '3 Bars', bars: 3 },
  { label: '4 Bars', bars: 4 },
  { label: '5 Bars', bars: 5 },
  { label: '6 Bars', bars: 6 },
  { label: '7 Bars', bars: 7 },
  { label: '8 Bars', bars: 8 },
  { label: '9 Bars', bars: 9 },
  { label: '12 Bars', bars: 12 },
  { label: '16 Bars', bars: 16 },
];

export type QuantizeSetting = {
  mode: QuantizeMode;
  valueIndex: number; // Index into QUANTIZE_LENGTHS
};
