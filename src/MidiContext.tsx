import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CanvasElement, FaderElement, FaderKeybind, FxTarget, QUANTIZE_LENGTHS } from './types';

export interface MidiDevice {
  id: number;
  name: string;
}

interface MidiContextType {
  inputs: MidiDevice[];
  outputs: MidiDevice[];
  selectedInputId: number | null;
  selectedOutputId: number | null;
  tempo: number | null;
  beatFlash: 'off' | 'normal' | 'first';
  currentBeat: number;
  selectInput: (id: number | null) => void;
  selectOutput: (id: number | null) => void;
  refreshDevices: () => void;
  triggerElement: (el: CanvasElement) => void;
  triggerFaderGlide: (fader: FaderElement, bind: FaderKeybind, updateFaderValue: (faderId: string, value: number) => void) => void;
  sendCC: (cc: number, value: number) => void;
  sendPC: (program: number) => void;
  sendNoteOn: (note: number, velocity: number) => void;
  sendNoteOff: (note: number) => void;
  isRefreshing: boolean;
  timeSignature: number;
  timeDenominator: number;
  setTimeSignature: (ts: number) => void;
  setTimeDenominator: (d: number) => void;
  totalTicksRef: React.MutableRefObject<number>;
  isPlayingRef: React.MutableRefObject<boolean>;
  timeSignatureRef: React.MutableRefObject<number>;
  timeDenominatorRef: React.MutableRefObject<number>;
  currentBar: number;
  currentBarRef: React.MutableRefObject<number>;
  ccMap: Record<FxTarget, number>;
  setCcMap: React.Dispatch<React.SetStateAction<Record<FxTarget, number>>>;
  controlChannel: number;
  setControlChannel: (ch: number) => void;
  drumkitChannel: number;
  setDrumkitChannel: (ch: number) => void;
  notesChannel: number;
  setNotesChannel: (ch: number) => void;
  resetMidiDefaults: () => void;
}

const MidiContext = createContext<MidiContextType | null>(null);

export const useMidi = () => {
  const ctx = useContext(MidiContext);
  if (!ctx) throw new Error('useMidi must be used within MidiProvider');
  return ctx;
};

export const MidiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [inputs, setInputs] = useState<MidiDevice[]>([]);
  const [outputs, setOutputs] = useState<MidiDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<number | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<number | null>(null);
  const [tempo, setTempo] = useState<number | null>(null);
  const [beatFlash, setBeatFlash] = useState<'off' | 'normal' | 'first'>('off');
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeSignature, setTimeSignature] = useState<number>(4);
  const [timeDenominator, setTimeDenominator] = useState<number>(4);
  const [currentBar, setCurrentBar] = useState(0);
  const currentBarRef = useRef(0);

  // ─── Persistent MIDI Config (channels + CC map) ────────────────────────────
  const DEFAULT_CC_MAP: Record<FxTarget, number> = { inputA: 1, inputB: 2, inputC: 3, inputD: 4, trackA: 5, trackB: 6, trackC: 7, trackD: 8 };
  const DEFAULT_CONTROL_CH = 0;   // 0-indexed (MIDI Ch 1)
  const DEFAULT_DRUMKIT_CH = 9;   // 0-indexed (MIDI Ch 10)
  const DEFAULT_NOTES_CH = 0;     // 0-indexed (MIDI Ch 1)

  const loadNum = (key: string, def: number) => { const s = localStorage.getItem(key); return s !== null ? Number(s) : def; };

  const [ccMap, setCcMap] = useState<Record<FxTarget, number>>(() => {
    const saved = localStorage.getItem('505fx_ccMap');
    if (saved) { try { return JSON.parse(saved); } catch { /* ignore */ } }
    return DEFAULT_CC_MAP;
  });
  const [controlChannel, setControlChannelState] = useState(() => loadNum('505fx_controlChannel', DEFAULT_CONTROL_CH));
  const [drumkitChannel, setDrumkitChannelState] = useState(() => loadNum('505fx_drumkitChannel', DEFAULT_DRUMKIT_CH));
  const [notesChannel, setNotesChannelState] = useState(() => loadNum('505fx_notesChannel', DEFAULT_NOTES_CH));

  // Refs for zero-latency reads in hot paths (never stale, never cause closure rebuilds)
  const ccMapRef = useRef(ccMap);
  const controlChannelRef = useRef(controlChannel);
  const notesChannelRef = useRef(notesChannel);

  // Keep refs in sync with state
  useEffect(() => { ccMapRef.current = ccMap; }, [ccMap]);
  useEffect(() => { controlChannelRef.current = controlChannel; }, [controlChannel]);
  useEffect(() => { notesChannelRef.current = notesChannel; }, [notesChannel]);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('505fx_ccMap', JSON.stringify(ccMap)); }, [ccMap]);
  useEffect(() => { localStorage.setItem('505fx_controlChannel', String(controlChannel)); }, [controlChannel]);
  useEffect(() => { localStorage.setItem('505fx_drumkitChannel', String(drumkitChannel)); }, [drumkitChannel]);
  useEffect(() => { localStorage.setItem('505fx_notesChannel', String(notesChannel)); }, [notesChannel]);

  const setControlChannel = useCallback((ch: number) => setControlChannelState(ch), []);
  const setDrumkitChannel = useCallback((ch: number) => setDrumkitChannelState(ch), []);
  const setNotesChannel = useCallback((ch: number) => setNotesChannelState(ch), []);

  const resetMidiDefaults = useCallback(() => {
    setCcMap(DEFAULT_CC_MAP);
    setControlChannelState(DEFAULT_CONTROL_CH);
    setDrumkitChannelState(DEFAULT_DRUMKIT_CH);
    setNotesChannelState(DEFAULT_NOTES_CH);
  }, []);

  const macroQueue = useRef<{ el: CanvasElement; queuedAtTicks: number }[]>([]);
  const faderQueue = useRef<{ fader: FaderElement; bind: FaderKeybind; updateFn: (id: string, val: number) => void; queuedAtTicks: number }[]>([]);
  const totalTicks = useRef(0);
  const totalBeats = useRef(0);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlaying = useRef(false);
  const prevBeatInBar = useRef(0);
  const timeSignatureRef = useRef(timeSignature);
  const timeDenominatorRef = useRef(timeDenominator);
  const activeGlides = useRef<Map<string, number>>(new Map()); // faderId -> animationFrameId
  const activeGlideTargets = useRef<Map<string, number>>(new Map()); // faderId -> targetValue

  useEffect(() => { timeSignatureRef.current = timeSignature; }, [timeSignature]);
  useEffect(() => { timeDenominatorRef.current = timeDenominator; }, [timeDenominator]);

  const refreshDevices = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const ins: MidiDevice[] = await invoke('list_midi_inputs');
      const outs: MidiDevice[] = await invoke('list_midi_outputs');
      setInputs(ins);
      setOutputs(outs);
    } catch (e) {
      console.error('Failed to list MIDI devices', e);
    }
    setTimeout(() => setIsRefreshing(false), 400); // Visual feedback duration
  }, []);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  useEffect(() => {
    // Tick-level listener for sub-beat queue processing, beat position & watchdog
    const unlisten1 = listen<number>('midi-clock-tick', (event) => {
      if (!isPlaying.current) return;
      totalTicks.current = event.payload;

      // Watchdog: auto-stop if no ticks for 600ms (cable disconnect, device crash)
      if (watchdogTimeout.current) clearTimeout(watchdogTimeout.current);
      watchdogTimeout.current = setTimeout(() => {
        isPlaying.current = false;
        setTempo(null); setBeatFlash('off'); setCurrentBeat(0);
        prevBeatInBar.current = 0;
        totalTicks.current = 0; totalBeats.current = 0;
        macroQueue.current = [];
        faderQueue.current = [];
      }, 600);

      // Compute beat position from ticks (supports both /4 and /8 time)
      const ticksPerBeat = timeDenominatorRef.current === 8 ? 12 : 24;
      const ticksPerBar = timeSignatureRef.current * ticksPerBeat;
      const tickPosition = totalTicks.current % ticksPerBar;
      const newBeatInBar = Math.floor(tickPosition / ticksPerBeat) + 1;

      if (newBeatInBar !== prevBeatInBar.current) {
        prevBeatInBar.current = newBeatInBar;
        setCurrentBeat(newBeatInBar);
        setBeatFlash(newBeatInBar === 1 ? 'first' : 'normal');
        if (flashTimeout.current) clearTimeout(flashTimeout.current);
        flashTimeout.current = setTimeout(() => setBeatFlash('off'), 100);

        // Update bar counter (1-indexed, increments when beat 1 is reached)
        if (newBeatInBar === 1) {
          const newBar = Math.floor(totalTicks.current / ticksPerBar) + 1;
          currentBarRef.current = newBar;
          setCurrentBar(newBar);
        }
      }

      // Process queue on every tick for sub-beat precision
      processQueue();
    });

    // Beat-level listener for BPM display only
    const unlisten2 = listen<{ bpm: number; beat: number; total_ticks: number }>('midi-beat', (event) => {
      const { bpm, beat } = event.payload;
      if (bpm > 0) setTempo(bpm);
      totalBeats.current = beat;
    });

    // Transport listener
    const unlisten3 = listen('midi-transport', (event) => {
      if (event.payload === 'stop') {
        isPlaying.current = false;
        setTempo(null); setBeatFlash('off'); setCurrentBeat(0);
        setCurrentBar(0); currentBarRef.current = 0;
        totalTicks.current = 0; totalBeats.current = 0; macroQueue.current = []; faderQueue.current = [];
        if (watchdogTimeout.current) clearTimeout(watchdogTimeout.current);
      } else if (event.payload === 'start') {
        isPlaying.current = true;
        totalTicks.current = -1; totalBeats.current = 0; macroQueue.current = []; faderQueue.current = [];
      } else if (event.payload === 'continue') {
        isPlaying.current = true;
      }
    });

    return () => {
      unlisten1.then(fn => fn());
      unlisten2.then(fn => fn());
      unlisten3.then(fn => fn());
      if (watchdogTimeout.current) clearTimeout(watchdogTimeout.current);
    };
  }, []);

  const selectInput = async (id: number | null) => {
    try {
      if (id === null) {
        await invoke('disconnect_midi_input');
        setSelectedInputId(null);
      } else {
        await invoke('connect_midi_input', { portIndex: id });
        setSelectedInputId(id);
      }
    } catch (e) {
      console.error('Failed to change MIDI input', e);
    }
  };

  const selectOutput = async (id: number | null) => {
    try {
      if (id === null) {
        await invoke('disconnect_midi_output');
        setSelectedOutputId(null);
      } else {
        await invoke('connect_midi_output', { portIndex: id });
        setSelectedOutputId(id);
      }
    } catch (e) {
      console.error('Failed to change MIDI output', e);
    }
  };

  // ─── Send functions (read channels from refs — zero allocation, no closure deps) ─
  const sendCC = useCallback(async (cc: number, value: number) => {
    try { await invoke('send_midi_cc', { channel: controlChannelRef.current, cc, value }); }
    catch (e) { console.error('Failed to send MIDI CC', e); }
  }, []);

  const sendPC = useCallback(async (program: number) => {
    try { await invoke('send_midi_pc', { channel: controlChannelRef.current, program }); }
    catch (e) { console.error('Failed to send MIDI PC', e); }
  }, []);

  const sendNoteOn = useCallback(async (note: number, velocity: number) => {
    try { await invoke('send_midi_note_on', { channel: notesChannelRef.current, note, velocity }); }
    catch (e) { console.error('Failed to send MIDI Note On', e); }
  }, []);

  const sendNoteOff = useCallback(async (note: number) => {
    try { await invoke('send_midi_note_off', { channel: notesChannelRef.current, note }); }
    catch (e) { console.error('Failed to send MIDI Note Off', e); }
  }, []);

  const executeElement = useCallback(async (el: CanvasElement) => {
    if (el.type === 'fx_button') {
      const map = ccMapRef.current; // read from ref — no closure dep
      for (const msg of el.messages) {
        if (msg.fxType < 0) continue;
        await sendCC(map[msg.target], msg.fxType);
      }
    } else if (el.type === 'free_button') {
      for (const msg of el.freeMessages) {
        await sendCC(msg.cc, msg.value);
      }
    } else if (el.type === 'memory_button') {
      await sendPC(el.memoryNumber - 1);
    }
    // Faders are handled live during drag, not on trigger
  }, [sendCC, sendPC]);

  const processQueue = () => {
    if (macroQueue.current.length > 0) {
      const remaining: typeof macroQueue.current = [];
      for (const entry of macroQueue.current) {
        const q = entry.el.quantize;
        if (!q || q.mode === 'immediate') {
          executeElement(entry.el);
          continue;
        }

        const conf = QUANTIZE_LENGTHS[q.valueIndex];
        const ticksPerBeat = timeDenominatorRef.current === 8 ? 12 : 24;
        const requiredTicks = conf.ticks || (conf.bars ? conf.bars * timeSignatureRef.current * ticksPerBeat : 0);

        let fire = false;
        if (q.mode === 'delay') {
          fire = (totalTicks.current - entry.queuedAtTicks) >= requiredTicks;
        } else if (q.mode === 'quantized') {
          fire = totalTicks.current > entry.queuedAtTicks && (totalTicks.current % requiredTicks === 0);
        }

        if (fire) executeElement(entry.el);
        else remaining.push(entry);
      }
      macroQueue.current = remaining;
    }

    // Process fader glide queue
    if (faderQueue.current.length > 0) {
      const faderRemaining: typeof faderQueue.current = [];
      for (const entry of faderQueue.current) {
        const q = entry.bind.quantize;
        if (!q || q.mode === 'immediate') {
          executeFaderGlide(entry.fader, entry.bind, entry.updateFn);
          continue;
        }
        const conf = QUANTIZE_LENGTHS[q.valueIndex];
        const ticksPerBeat = timeDenominatorRef.current === 8 ? 12 : 24;
        const requiredTicks = conf.ticks || (conf.bars ? conf.bars * timeSignatureRef.current * ticksPerBeat : 0);
        let fire = false;
        if (q.mode === 'delay') {
          fire = (totalTicks.current - entry.queuedAtTicks) >= requiredTicks;
        } else if (q.mode === 'quantized') {
          fire = totalTicks.current > entry.queuedAtTicks && (totalTicks.current % requiredTicks === 0);
        }
        if (fire) executeFaderGlide(entry.fader, entry.bind, entry.updateFn);
        else faderRemaining.push(entry);
      }
      faderQueue.current = faderRemaining;
    }
  };

  const executeFaderGlide = useCallback((fader: FaderElement, bind: FaderKeybind, updateFaderValue: (id: string, val: number) => void) => {
    // If the fader is already exactly at the target value, ignore the trigger entirely
    if (fader.currentValue === bind.targetValue) return;

    // If there's already an active glide headed to the exact same target value, ignore the trigger
    const activeTarget = activeGlideTargets.current.get(fader.id);
    if (activeTarget === bind.targetValue) return;

    // Cancel any existing glide on this fader (if headed to a DIFFERENT target value)
    const existingAnim = activeGlides.current.get(fader.id);
    if (existingAnim) cancelAnimationFrame(existingAnim);

    activeGlideTargets.current.set(fader.id, bind.targetValue);

    if (bind.glideMode === 'off') {
      // Instant jump
      updateFaderValue(fader.id, bind.targetValue);
      sendCC(fader.cc, bind.targetValue);
      activeGlideTargets.current.delete(fader.id);
      return;
    }

    // Calculate glide duration in ms
    let durationMs = bind.glideMs;
    if (bind.glideMode === 'musical' && tempo) {
      const conf = QUANTIZE_LENGTHS[bind.glideValueIndex];
      const ticksPerBeat = timeDenominatorRef.current === 8 ? 12 : 24;
      const totalGlideTicks = conf.ticks || (conf.bars ? conf.bars * timeSignatureRef.current * ticksPerBeat : 0);
      const msPerTick = (60000 / tempo) / 24; // 24 PPQN
      durationMs = totalGlideTicks * msPerTick;
    }

    if (durationMs <= 0) {
      updateFaderValue(fader.id, bind.targetValue);
      sendCC(fader.cc, bind.targetValue);
      activeGlideTargets.current.delete(fader.id);
      return;
    }

    const startValue = fader.currentValue;
    const endValue = bind.targetValue;
    const startTime = performance.now();
    let lastVal = startValue;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Linear glide
      const currentVal = Math.round(startValue + (endValue - startValue) * progress);

      if (currentVal !== lastVal || progress === 1) {
        updateFaderValue(fader.id, currentVal);
        sendCC(fader.cc, currentVal);
        lastVal = currentVal;
      }

      if (progress < 1) {
        const frameId = requestAnimationFrame(animate);
        activeGlides.current.set(fader.id, frameId);
      } else {
        activeGlides.current.delete(fader.id);
        activeGlideTargets.current.delete(fader.id);
      }
    };

    const frameId = requestAnimationFrame(animate);
    activeGlides.current.set(fader.id, frameId);
  }, [sendCC, tempo]);

  const triggerFaderGlide = useCallback((fader: FaderElement, bind: FaderKeybind, updateFaderValue: (id: string, val: number) => void) => {
    const mode = bind.quantize?.mode || 'immediate';
    if (mode === 'immediate' || !isPlaying.current) {
      executeFaderGlide(fader, bind, updateFaderValue);
    } else {
      faderQueue.current.push({ fader, bind, updateFn: updateFaderValue, queuedAtTicks: totalTicks.current });
    }
  }, [executeFaderGlide, tempo]);

  const triggerElement = useCallback((el: CanvasElement) => {
    const mode = el.quantize?.mode || 'immediate';
    if (mode === 'immediate' || !isPlaying.current) {
      executeElement(el);
    } else {
      macroQueue.current.push({ el, queuedAtTicks: totalTicks.current });
    }
  }, [executeElement, tempo]);

  return (
    <MidiContext.Provider value={{
      inputs, outputs, selectedInputId, selectedOutputId, tempo, beatFlash, currentBeat,
      selectInput, selectOutput, refreshDevices, triggerElement, triggerFaderGlide, sendCC, sendPC, sendNoteOn, sendNoteOff,
      isRefreshing, timeSignature, timeDenominator, setTimeSignature, setTimeDenominator,
      totalTicksRef: totalTicks, isPlayingRef: isPlaying, timeSignatureRef, timeDenominatorRef,
      currentBar, currentBarRef, ccMap, setCcMap,
      controlChannel, setControlChannel, drumkitChannel, setDrumkitChannel, notesChannel, setNotesChannel,
      resetMidiDefaults,
    }}>
      {children}
    </MidiContext.Provider>
  );
};
