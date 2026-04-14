import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { Play, PencilSimple as Edit3, Plus, ArrowUUpLeft as Undo2, ArrowUUpRight as Redo2, MusicNotes as Music2, X, Gear as Settings, FloppyDisk as Save, FolderOpen, SlidersHorizontal, Lightning as Zap, ArrowSquareOut as ExternalLink, Image, Sun, Moon, GridFour as Grid, Magnet, ArrowsClockwise as RefreshCw, BookmarkSimple as Bookmark, FilePlus, DownloadSimple as Download, IconContext } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { save, open, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useMidi, MidiDevice } from './MidiContext';
import { CanvasElement, MidiLoopElement } from './types';
import ButtonCanvas, { ThemeStyle } from './ButtonCanvas';
import ConfigPanel from './ConfigPanel';
import { getContrastColor } from './lib/colorUtils';
import Tutorial, { STEPS } from './Tutorial';
import PianoRollEditor from './PianoRollEditor';

const loadSavedOption = <T,>(key: string, def: T): T => {
  const saved = localStorage.getItem(`505fx_${key}`);
  if (saved !== null) {
    try { return JSON.parse(saved); } catch { return def; }
  }
  return def;
};

function App() {
  const [mode, setMode] = useState<'perform' | 'edit'>('edit');
  const {
    inputs, outputs,
    selectedInputId, selectedOutputId,
    selectInput, selectOutput,
    tempo, beatFlash, currentBeat, timeSignature, timeDenominator,
    setTimeSignature, setTimeDenominator,
    refreshDevices, isRefreshing,
    ccMap, setCcMap,
    controlChannel, setControlChannel, drumkitChannel, setDrumkitChannel, notesChannel, setNotesChannel,
    resetMidiDefaults,
  } = useMidi();

  const [macros, setMacros] = useState<CanvasElement[]>([]);
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);
  const [lastSelectedMacro, setLastSelectedMacro] = useState<CanvasElement | null>(null);

  // ─── Undo / Redo ───────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<CanvasElement[][]>([]);
  const [redoStack, setRedoStack] = useState<CanvasElement[][]>([]);

  const commitSnapshot = useCallback((before: CanvasElement[]) => {
    setUndoStack(u => [...u, before]);
    setRedoStack([]);
  }, []);

  const macrosRef = useRef<CanvasElement[]>(macros);
  macrosRef.current = macros;

  const setMacrosWithHistory = useCallback((fn: (prev: CanvasElement[]) => CanvasElement[]) => {
    const snapshot = JSON.parse(JSON.stringify(macrosRef.current));
    setUndoStack(u => [...u, snapshot]);
    setRedoStack([]);
    setMacros(prev => fn(prev));
  }, []);

  const setMacrosLive = useCallback((fn: (prev: CanvasElement[]) => CanvasElement[]) => {
    setMacros(fn);
  }, []);

  const undo = useCallback(() => {
    const prevMacros = undoStack[undoStack.length - 1];
    if (!prevMacros) return;

    const currentSnapshot = JSON.parse(JSON.stringify(macrosRef.current));
    setRedoStack(r => [...r, currentSnapshot]);
    setUndoStack(u => u.slice(0, -1));
    setMacros(prevMacros);

    setSelectedMacroId(prev => {
      if (prev && !prevMacros.find(m => m.id === prev)) return null;
      return prev;
    });
  }, [undoStack]);

  const redo = useCallback(() => {
    const nextMacros = redoStack[redoStack.length - 1];
    if (!nextMacros) return;

    const currentSnapshot = JSON.parse(JSON.stringify(macrosRef.current));
    setUndoStack(u => [...u, currentSnapshot]);
    setRedoStack(r => r.slice(0, -1));
    setMacros(nextMacros);

    setSelectedMacroId(prev => {
      if (prev && !nextMacros.find(m => m.id === prev)) return null;
      return prev;
    });
  }, [redoStack]);

  // ─── Settings Modals ──────────────────────────────────────────────────
  const [showMidiModal, setShowMidiModal] = useState(false);
  const [showGeneralModal, setShowGeneralModal] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showPianoRoll, setShowPianoRoll] = useState(false);
  const [pianoRollElementId, setPianoRollElementId] = useState<string | null>(null);
  const [showAdvancedMidi, setShowAdvancedMidi] = useState(false);
  const [showBootPrompt, setShowBootPrompt] = useState(() => {
    return loadSavedOption<CanvasElement[]>('lastSessionMacros', []).length > 0;
  });

  // ─── Tutorial ─────────────────────────────────────────────────────────
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [tutorialCompleted, setTutorialCompleted] = useState(() => loadSavedOption('tutorialCompleted', false));

  useEffect(() => {
    localStorage.setItem('505fx_tutorialCompleted', JSON.stringify(tutorialCompleted));
  }, [tutorialCompleted]);

  const startTutorial = () => {
    setTutorialStep(0);
    setMode('edit');
  };

  const endTutorial = () => {
    setTutorialStep(null);
    setTutorialCompleted(true);
  };

  // Auto-start tutorial on fresh install if boot prompt wasn't shown
  useEffect(() => {
    if (!showBootPrompt && !tutorialCompleted) {
      startTutorial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Mode Toggle Key ─────────────────────────────────────────────────
  const [modeToggleKey, setModeToggleKey] = useState(() => loadSavedOption('modeToggleKey', 'Tab'));

  // ─── Theme ────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<ThemeStyle>(() => loadSavedOption('theme', 'wireframe'));
  const [colorMode, setColorMode] = useState<'dark' | 'light'>(() => loadSavedOption('colorMode', 'dark'));
  const [accentColor, setAccentColor] = useState(() => loadSavedOption('accentColor', '#00FF00'));
  const [bgImage, setBgImage] = useState<string>(() => loadSavedOption('bgImage', ''));
  const [bgBlur, setBgBlur] = useState(() => loadSavedOption('bgBlur', 0));
  const [bgOpacity, setBgOpacity] = useState(() => loadSavedOption('bgOpacity', 1.0));
   const [isAdjustingBg, setIsAdjustingBg] = useState(false);
   const [isAdjustingGrid, setIsAdjustingGrid] = useState(false);
  const [glowAmount, setGlowAmount] = useState(() => loadSavedOption('glowAmount', 1.0));
  const [snapToGrid, setSnapToGrid] = useState(() => loadSavedOption('snapToGrid', true));
  const [gridSize, setGridSize] = useState(() => loadSavedOption('gridSize', 50)); // in reference-space pixels
  const [gridOpacity, setGridOpacity] = useState(() => loadSavedOption('gridOpacity', 0.15));
  const [workspaceFlash, setWorkspaceFlash] = useState(() => loadSavedOption('workspaceFlash', true));
  const [elementShape, setElementShape] = useState<'square' | 'rounded' | 'circular'>(() => loadSavedOption('elementShape', 'rounded'));
  const [borderWidth, setBorderWidth] = useState(() => loadSavedOption('borderWidth', 2));

  // ─── Auto-Update ────────────────────────────────────────────────────
  const [autoUpdate, setAutoUpdate] = useState(() => loadSavedOption('autoUpdate', true));
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');

  // Auto-save session elements
  useEffect(() => {
    if (!showBootPrompt) {
      try {
        localStorage.setItem('505fx_lastSessionMacros', JSON.stringify(macros));
      } catch (e) {
        console.error('Failed to save session macros:', e);
      }
    }
  }, [macros, showBootPrompt]);

  // Save visual options
  useEffect(() => {
    try {
      localStorage.setItem('505fx_modeToggleKey', JSON.stringify(modeToggleKey));
      localStorage.setItem('505fx_theme', JSON.stringify(theme));
      localStorage.setItem('505fx_colorMode', JSON.stringify(colorMode));
      localStorage.setItem('505fx_accentColor', JSON.stringify(accentColor));
      localStorage.setItem('505fx_bgImage', JSON.stringify(bgImage));
      localStorage.setItem('505fx_bgBlur', JSON.stringify(bgBlur));
      localStorage.setItem('505fx_bgOpacity', JSON.stringify(bgOpacity));
      localStorage.setItem('505fx_glowAmount', JSON.stringify(glowAmount));
      localStorage.setItem('505fx_snapToGrid', JSON.stringify(snapToGrid));
      localStorage.setItem('505fx_gridSize', JSON.stringify(gridSize));
      localStorage.setItem('505fx_gridOpacity', JSON.stringify(gridOpacity));
      localStorage.setItem('505fx_workspaceFlash', JSON.stringify(workspaceFlash));
      localStorage.setItem('505fx_elementShape', JSON.stringify(elementShape));
      localStorage.setItem('505fx_borderWidth', JSON.stringify(borderWidth));
      localStorage.setItem('505fx_autoUpdate', JSON.stringify(autoUpdate));
    } catch (e) {
      console.error('Failed to save settings to localStorage (possibly quota exceeded):', e);
    }
  }, [modeToggleKey, theme, colorMode, accentColor, bgImage, bgBlur, bgOpacity, glowAmount, snapToGrid, gridSize, workspaceFlash, elementShape, borderWidth, autoUpdate]);

  const resetTheme = () => {
    setTheme('wireframe');
    setColorMode('dark');
    setAccentColor('#00FF00');
    setBgImage('');
    setBgBlur(0);
    setBgOpacity(1.0);
    setGlowAmount(1.0);
    setBorderWidth(2);
    setSnapToGrid(true);
    setGridSize(50);
    setGridOpacity(0.15);
    setWorkspaceFlash(true);
    setElementShape('rounded');
  };

  // ─── Update Logic ──────────────────────────────────────────────────
  const checkForUpdates = useCallback(async (silent = false) => {
    try {
      setUpdateStatus('checking');
      setUpdateError('');
      const update = await check();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateStatus('available');
      } else {
        setUpdateStatus('idle');
        if (!silent) {
          await message('You are running the latest version.', { title: 'No Updates', kind: 'info' });
        }
      }
    } catch (e: any) {
      console.error('Update check failed:', e);
      setUpdateStatus('error');
      setUpdateError(String(e?.message || e));
      if (!silent) {
        await message(`Failed to check for updates: ${e?.message || e}`, { title: 'Update Error', kind: 'error' });
      }
    }
  }, []);

  const installUpdate = useCallback(async () => {
    try {
      setUpdateStatus('downloading');
      setUpdateProgress(0);
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let contentLength = 1;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 1;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setUpdateProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            break;
          case 'Finished':
            setUpdateProgress(100);
            break;
        }
      });

      setUpdateStatus('ready');
      await relaunch();
    } catch (e: any) {
      console.error('Update install failed:', e);
      setUpdateStatus('error');
      setUpdateError(String(e?.message || e));
    }
  }, []);

  // ─── Global Zoom Prevention ──────────────────────────────────────────
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      // Prevent browser zoom (Cmd/Ctrl + Scroll)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handleGlobalWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, []);

  // Auto-check on startup
  useEffect(() => {
    if (autoUpdate) {
      const timeout = setTimeout(() => checkForUpdates(true), 3000);
      return () => clearTimeout(timeout);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply dark/light mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', colorMode);
  }, [colorMode]);

  // Apply shape to document
  useEffect(() => {
    document.documentElement.setAttribute('data-shape', elementShape);
  }, [elementShape]);

  // Apply accent color global CSS vars
  useEffect(() => {
    let hex = accentColor;
    if (hex.startsWith('#')) hex = hex.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    document.documentElement.style.setProperty('--accent-base', `#${hex}`);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    }
    document.documentElement.style.setProperty('--accent-contrast', getContrastColor(accentColor));
  }, [accentColor]);

  const importBgImage = async () => {
    try {
      const path = await open({
        title: 'Select Background Image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
        multiple: false,
      });
      if (path && typeof path === 'string') {
        const dataUrl: string = await invoke('read_file_base64', { path });
        setBgImage(dataUrl);
      }
    } catch (e) {
      console.error('Failed to import background image', e);
    }
  };

  // ─── Save / Import Templates ──────────────────────────────────────────
  const continueSession = () => {
    setShowBootPrompt(false);
    const session = loadSavedOption<CanvasElement[]>('lastSessionMacros', []);
    setMacros(session);
    setUndoStack([]);
    setRedoStack([]);
    if (!tutorialCompleted) startTutorial();
  };

  const newProject = async () => {
    if (macros.length > 0) {
      const result = await message('Do you want to save your current project before starting a new one?', {
        title: 'Save Project',
        kind: 'info',
        buttons: { yes: 'Save & New', no: 'Discard & New', cancel: 'Cancel' }
      });

      const res = String(result).toLowerCase();
      if (res.includes('cancel') || result === null) return;
      if (res.includes('save')) {
        const saved = await saveTemplate();
        if (!saved) return;
      }
    }
    setMacros([]);
    setUndoStack([]);
    setRedoStack([]);
    localStorage.removeItem('505fx_lastSessionMacros');
    setShowBootPrompt(false);
    if (!tutorialCompleted) startTutorial();
  };

  const saveTemplate = async () => {
    try {
      const path = await save({
        title: 'Save Template',
        defaultPath: 'my-template.505fx',
        filters: [{ name: '505FX Template', extensions: ['505fx'] }],
      });
      if (!path) return false;
      const data = JSON.stringify(macrosRef.current, null, 2);
      await invoke('save_template', { path, data });
      return true;
    } catch (e) {
      console.error('Failed to save template', e);
      return false;
    }
  };

  const importTemplate = async () => {
    try {
      const path = await open({
        title: 'Import Template',
        filters: [{ name: '505FX Template', extensions: ['505fx'] }],
        multiple: false,
      });
      if (!path) return;
      const data: string = await invoke('load_template', { path });
      const loaded: CanvasElement[] = JSON.parse(data);
      if (Array.isArray(loaded)) {
        setMacrosWithHistory(() => loaded);
        setSelectedMacroId(null);
        setShowBootPrompt(false);
      }
    } catch (e) {
      console.error('Failed to import template', e);
    }
  };

  // ─── Create Elements ──────────────────────────────────────────────────
  const createFxButton = () => {
    const id = `macro-${Date.now()}`;
    setMacrosWithHistory(prev => [...prev, {
      type: 'fx_button' as const,
      id, x: 80 + Math.random() * 200, y: 80 + Math.random() * 200,
      width: 140, height: 90, label: 'New FX', keybind: '', messages: [], color: accentColor,
    }]);
    setSelectedMacroId(id);
    setShowCreateMenu(false);
  };

  const createFreeButton = () => {
    const id = `macro-${Date.now()}`;
    setMacrosWithHistory(prev => [...prev, {
      type: 'free_button' as const,
      id, x: 80 + Math.random() * 200, y: 80 + Math.random() * 200,
      width: 140, height: 90, label: 'Free CC', keybind: '', freeMessages: [], color: accentColor,
    }]);
    setSelectedMacroId(id);
    setShowCreateMenu(false);
  };

  const createMemoryButton = () => {
    const id = `macro-${Date.now()}`;
    setMacrosWithHistory(prev => [...prev, {
      type: 'memory_button' as const,
      id, x: 80 + Math.random() * 200, y: 80 + Math.random() * 200,
      width: 140, height: 90, label: 'Memory', keybind: '', memoryNumber: 1, color: accentColor,
    }]);
    setSelectedMacroId(id);
    setShowCreateMenu(false);
  };

  const createFader = () => {
    const id = `macro-${Date.now()}`;
    setMacrosWithHistory(prev => [...prev, {
      type: 'fader' as const,
      id, x: 80 + Math.random() * 200, y: 80 + Math.random() * 200,
      width: 60, height: 180, label: 'Fader', keybind: '',
      cc: 11, minValue: 0, maxValue: 127, currentValue: 0, color: accentColor,
    }]);
    setSelectedMacroId(id);
    setShowCreateMenu(false);
  };

  const createMidiLoop = () => {
    const id = `macro-${Date.now()}`;
    setMacrosWithHistory(prev => [...prev, {
      type: 'midi_loop' as const,
      id, x: 80 + Math.random() * 200, y: 80 + Math.random() * 200,
      width: 200, height: 120, label: 'MIDI Loop', keybind: '',
      notes: [], loopLengthBars: 2, midiChannel: 0, color: accentColor,
    }]);
    setSelectedMacroId(id);
    setShowCreateMenu(false);
  };

  const deleteButton = useCallback((id: string) => {
    setMacrosWithHistory(prev => prev.filter(m => m.id !== id));
    setSelectedMacroId(null);
  }, [setMacrosWithHistory]);

  const duplicateButton = useCallback((id: string) => {
    setMacrosWithHistory(prev => {
      const source = prev.find(m => m.id === id);
      if (!source) return prev;
      const newId = `macro-${Date.now()}`;
      return [...prev, {
        ...JSON.parse(JSON.stringify(source)),
        id: newId, x: source.x + 20, y: source.y + 20, label: source.label + ' Copy',
      }];
    });
  }, [setMacrosWithHistory]);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down' | 'front' | 'back') => {
    setMacrosWithHistory(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx < 0) return prev;
      const newArr = [...prev];
      const [item] = newArr.splice(idx, 1);

      if (direction === 'up') {
        newArr.splice(Math.min(newArr.length, idx + 1), 0, item);
      } else if (direction === 'down') {
        newArr.splice(Math.max(0, idx - 1), 0, item);
      } else if (direction === 'front') {
        newArr.push(item);
      } else if (direction === 'back') {
        newArr.unshift(item);
      }
      return newArr;
    });
  }, [setMacrosWithHistory]);

  // ─── Global Key Listener ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;

      if (e.key === modeToggleKey) {
        e.preventDefault();
        setMode(prev => {
          if (prev === 'edit') { setSelectedMacroId(null); return 'perform'; }
          return 'edit';
        });
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }

      if (mode === 'perform') {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        
        const matchingMacros = macros.filter(m => m.keybind?.toLowerCase() === key);
        if (matchingMacros.length > 0) {
          e.preventDefault();
          matchingMacros.forEach(macro => {
            if (macro.type === 'midi_loop') {
              // Toggle MIDI loop via custom event
              window.dispatchEvent(new CustomEvent('midi-loop-toggle', { detail: macro.id }));
            } else {
              window.dispatchEvent(new CustomEvent('macro-trigger-down', { detail: macro.id }));
            }
          });
        } 
        
        // Also fire any fader keybinds matching this key
        const matchingFaders: { faderId: string; bindId: string }[] = [];
        for (const m of macros) {
          if (m.type === 'fader' && m.faderKeybinds) {
            const bind = m.faderKeybinds.find(b => b.key?.toLowerCase() === key);
            if (bind) matchingFaders.push({ faderId: m.id, bindId: bind.id });
          }
        }

        if (matchingFaders.length > 0) {
          e.preventDefault();
          matchingFaders.forEach(match => {
            window.dispatchEvent(new CustomEvent('fader-keybind-trigger', { detail: match }));
          });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (mode === 'perform') {
        const key = e.key.toLowerCase();
        const matchingMacros = macros.filter(m => m.keybind?.toLowerCase() === key);
        matchingMacros.forEach(macro => {
          window.dispatchEvent(new CustomEvent('macro-trigger-up', { detail: macro.id }));
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [macros, mode, undo, redo, modeToggleKey]);

  const handleUpdateMacro = (updated: CanvasElement) => {
    setMacrosWithHistory(prev => prev.map(m => m.id === updated.id ? updated : m));
    if (selectedMacroId === updated.id) {
      setLastSelectedMacro(updated);
    }
  };

  const selectedMacro = macros.find(m => m.id === selectedMacroId) || null;

  useEffect(() => {
    if (selectedMacro) setLastSelectedMacro(selectedMacro);
  }, [selectedMacro]);

  return (
    <IconContext.Provider value={{ color: accentColor, weight: "duotone" }}>
      <div className="app-container">
        <header className="header">
          <div className="header-left">
            <div data-tutorial="brand" className="header-brand" onClick={() => setShowCreditsModal(true)} style={{ cursor: 'pointer', border: '2px solid var(--accent-base)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }} title="About LPL505">LPL505</div>

            <div className={`header-toolbar ${mode !== 'edit' ? 'hidden' : ''}`}>
              <div data-tutorial="file-btns" style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={newProject} title="New Project">
                  <FilePlus size={21} /> New
                </button>
                <button className="btn" onClick={importTemplate} title="Load Template">
                  <FolderOpen size={21} /> Load
                </button>
                <button className="btn" onClick={saveTemplate} title="Save Template">
                  <Save size={21} /> Save
                </button>
              </div>

              <div className="toolbar-divider" />

              <button className="btn" onClick={undo} disabled={undoStack.length === 0} title="Undo (⌘Z)">
                <Undo2 size={21} />
              </button>
              <button className="btn" onClick={redo} disabled={redoStack.length === 0} title="Redo (⌘⇧Z)">
                <Redo2 size={21} />
              </button>
              {snapToGrid && (
                <button className="btn" title="Snap all elements to grid" onClick={() => {
                  setMacrosWithHistory(prev => prev.map(el => {
                    const g = gridSize;
                    const newX = Math.round(el.x / g) * g;
                    const newY = Math.round(el.y / g) * g;
                    const newRight = Math.round((el.x + el.width) / g) * g;
                    const newBottom = Math.round((el.y + el.height) / g) * g;
                    return {
                      ...el,
                      x: newX,
                      y: newY,
                      width: Math.max(g, newRight - newX),
                      height: Math.max(g, newBottom - newY),
                    };
                  }));
                }}>
                  <Magnet size={21} />
                </button>
              )}

              <div className="toolbar-divider" />

              {/* Create dropdown */}
              <div style={{ position: 'relative' }} data-tutorial="add-btn">
                <button className="btn btn-primary" onClick={() => setShowCreateMenu(v => !v)}>
                  <Plus size={21} weight="bold" color="var(--accent-contrast)" /> Add ▾
                </button>
                {showCreateMenu && (
                  <div className="create-dropdown">
                    <div className="create-dropdown-item" onClick={() => { createFxButton(); setShowCreateMenu(false); }}>
                      <Plus size={21} /> FX Button
                    </div>
                    <div className="create-dropdown-item" onClick={() => { createFreeButton(); setShowCreateMenu(false); }}>
                      <Zap size={21} /> Free Button
                    </div>
                    <div className="create-dropdown-item" onClick={() => { createMemoryButton(); setShowCreateMenu(false); }}>
                      <Bookmark size={21} /> Memory Button
                    </div>
                    <div className="create-dropdown-item" onClick={() => { createFader(); setShowCreateMenu(false); }}>
                      <SlidersHorizontal size={21} /> Fader
                    </div>
                    <div className="create-dropdown-item" onClick={() => { createMidiLoop(); setShowCreateMenu(false); }}>
                      <Music2 size={21} /> MIDI Loop
                    </div>
                  </div>
                )}
              </div>

              <div className="toolbar-divider" />

              <button data-tutorial="midi-btn" className="btn" onClick={() => { refreshDevices(); setShowMidiModal(true); }}>
                <Settings size={21} /> MIDI
              </button>
              <button data-tutorial="general-btn" className="btn" onClick={() => setShowGeneralModal(true)}>
                <Settings size={21} /> General
              </button>
            </div>
          </div>

          <div className="header-controls">
            <div className="status-indicator">
              <div
                className="beat-dot"
                style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: beatFlash === 'first' ? '#ffffff' : beatFlash === 'normal' ? 'var(--accent-base)' : (tempo ? 'var(--success)' : 'var(--danger)'),
                  boxShadow: beatFlash !== 'off' ? `0 0 12px ${beatFlash === 'first' ? '#ffffff' : 'var(--accent-glow)'}` : 'none',
                  transition: 'background 0.05s, box-shadow 0.05s',
                  transform: beatFlash !== 'off' ? 'scale(1.3)' : 'scale(1)',
                }}
              />
              <span>
                {selectedInputId === null ? 'No Sync Source' :
                  tempo && tempo > 0 ? `${tempo} BPM • ${timeSignature}/${timeDenominator}` : 'Waiting for Clock...'}
              </span>
              {tempo && tempo > 0 && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
                  {Array.from({ length: timeSignature }).map((_, i) => {
                    const beatNum = i + 1;
                    const isActive = currentBeat >= beatNum;
                    const isCurrent = currentBeat === beatNum;
                    return (
                      <div
                        key={i}
                        style={{
                          width: beatNum === 1 ? 8 : 6,
                          height: beatNum === 1 ? 8 : 6,
                          borderRadius: '50%',
                          background: isActive
                            ? (beatNum === 1 ? '#ffffff' : 'var(--accent-base)')
                            : 'rgba(255,255,255,0.15)',
                          boxShadow: isCurrent && beatFlash !== 'off'
                            ? `0 0 8px ${beatNum === 1 ? '#ffffff' : 'var(--accent-glow)'}` : 'none',
                          transition: 'background 0.06s, box-shadow 0.06s, transform 0.06s',
                          transform: isCurrent && beatFlash !== 'off' ? 'scale(1.3)' : 'scale(1)',
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div data-tutorial="mode-toggle" className={`segmented-control mode-${mode}`}>
              <div className="segmented-control-bg" />
              <div data-tutorial="edit-segment" className={`segment ${mode === 'edit' ? 'active' : ''}`} onClick={() => setMode('edit')}>
                <Edit3 size={21} weight="bold" color={mode === 'edit' ? 'var(--accent-contrast)' : undefined} style={{ marginRight: 4, verticalAlign: 'middle', transform: 'translateX(-1px)' }} /> Edit
              </div>
              <div data-tutorial="perform-segment" className={`segment ${mode === 'perform' ? 'active' : ''}`} onClick={() => { setMode('perform'); setSelectedMacroId(null); }}>
                <Play size={21} weight="bold" color={mode === 'perform' ? 'var(--accent-contrast)' : undefined} style={{ marginRight: 4, verticalAlign: 'middle', transform: 'translateX(-1px)' }} /> Perform
              </div>
            </div>
          </div>
        </header>

        <main className="main-content">
          <div className="canvas-area" data-tutorial="canvas">
            {bgImage && (
              <div className="canvas-bg-image" style={{
                backgroundImage: `url(${bgImage})`,
                filter: `blur(${Math.pow(bgBlur, 2)}px)`,
                opacity: bgOpacity,
                transform: 'scale(1.1)', // Always scaled to prevent edge issues and jitter
              }} />
            )}
            {workspaceFlash && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  zIndex: 0,
                  backgroundColor: beatFlash === 'first' ? (colorMode === 'dark' ? '#ffffff' : '#000000') : 'var(--accent-base)',
                  opacity: beatFlash !== 'off' ? (beatFlash === 'first' ? 0.1 : 0.08) : 0,
                  transition: beatFlash !== 'off' ? 'none' : 'opacity 0.25s ease-out',
                }}
              />
            )}
            <ButtonCanvas
              mode={mode}
              macros={macros}
              setMacrosLive={setMacrosLive}
              commitSnapshot={commitSnapshot}
              selectedMacroId={selectedMacroId}
              onSelectMacro={setSelectedMacroId}
              theme={theme}
              accentColor={accentColor}
              glowAmount={glowAmount}
              snapToGrid={snapToGrid}
              gridSize={gridSize}
              gridOpacity={gridOpacity}
              colorMode={colorMode}
              borderWidth={borderWidth}
              showGrid={isAdjustingGrid}
              onOpenPianoRoll={(elementId) => {
                setPianoRollElementId(elementId);
                setShowPianoRoll(true);
              }}
            />
          </div>

          {(() => {
            const activeMacro = selectedMacro || lastSelectedMacro;
            if (!activeMacro) return null;

            const showSidebar = mode === 'edit' && selectedMacro !== null;
            // Calculate the center of the button and compare to the center of the canvas (500)
            const buttonCenter = activeMacro.x + (activeMacro.width / 2);
            const isWidgetOnRight = buttonCenter > 500;
            const sidebarClassPosition = isWidgetOnRight ? 'left' : 'right';

            return (
              <aside className={`sidebar ${sidebarClassPosition} ${!showSidebar ? 'hidden' : ''}`}>
                <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 900 }}>Element Config</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {activeMacro.type === 'fx_button' && <><Plus size={14} weight="bold" /> FX Button</>}
                      {activeMacro.type === 'free_button' && <><Zap size={14} weight="bold" /> Free Button</>}
                      {activeMacro.type === 'memory_button' && <><Bookmark size={14} weight="bold" /> Memory Button</>}
                      {activeMacro.type === 'fader' && <><SlidersHorizontal size={14} weight="bold" /> Fader</>}
                      {activeMacro.type === 'midi_loop' && <><Music2 size={14} weight="bold" /> MIDI Loop</>}
                    </div>
                  </div>
                  <X size={20} weight="bold" style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setSelectedMacroId(null)} />
                </div>
                <ConfigPanel
                  element={activeMacro}
                  accentColor={accentColor}
                  theme={theme}
                  updateElement={handleUpdateMacro}
                  onDelete={() => deleteButton(activeMacro.id)}
                  onDuplicate={() => duplicateButton(activeMacro.id)}
                  onMoveLayer={(dir) => moveLayer(activeMacro.id, dir)}
                  onOpenPianoRoll={activeMacro.type === 'midi_loop' ? () => {
                    setPianoRollElementId(activeMacro.id);
                    setShowPianoRoll(true);
                  } : undefined}
                />
              </aside>
            );
          })()}
        </main>

        {/* ── MIDI Settings Modal ────────────────────────────────────────── */}
        {showMidiModal && (
          <div className={`modal-overlay ${tutorialStep !== null ? 'tutorial-active' : ''}`} onClick={() => setShowMidiModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2><Music2 size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />MIDI Settings</h2>
                <X size={24} weight="bold" style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowMidiModal(false)} />
              </div>

              <div className="input-group">
                <label>MIDI Input (Clock Sync)</label>
                <select className="select-input" value={selectedInputId !== null ? String(selectedInputId) : ''} onChange={e => selectInput(e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">None</option>
                  {inputs.map((d: MidiDevice) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </select>
              </div>

              <div className="input-group">
                <label>MIDI Output (Send CC)</label>
                <select className="select-input" value={selectedOutputId !== null ? String(selectedOutputId) : ''} onChange={e => selectOutput(e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">None</option>
                  {outputs.map((d: MidiDevice) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </select>
              </div>

              <div className="input-group">
                <label>Time Signature</label>
                <select className="select-input" value={`${timeSignature}/${timeDenominator}`} onChange={e => {
                  const [num, den] = e.target.value.split('/').map(Number);
                  setTimeSignature(num);
                  setTimeDenominator(den);
                }}>
                  <option value="2/4">2/4</option>
                  <option value="3/4">3/4</option>
                  <option value="4/4">4/4</option>
                  <option value="5/4">5/4</option>
                  <option value="6/4">6/4</option>
                  <option value="7/4">7/4</option>
                  <option value="5/8">5/8</option>
                  <option value="6/8">6/8</option>
                  <option value="7/8">7/8</option>
                  <option value="8/8">8/8</option>
                  <option value="9/8">9/8</option>
                  <option value="10/8">10/8</option>
                  <option value="11/8">11/8</option>
                  <option value="12/8">12/8</option>
                  <option value="13/8">13/8</option>
                  <option value="14/8">14/8</option>
                  <option value="15/8">15/8</option>
                </select>
              </div>

              <button className="btn" style={{ marginTop: 8 }} onClick={refreshDevices} disabled={isRefreshing}>
                {isRefreshing ? (
                  <>
                    <RefreshCw size={18} className="spin" style={{ marginRight: 6 }} /> Refreshing...
                  </>
                ) : (
                  'Refresh Devices'
                )}
              </button>

              <div className="modal-divider" />
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 0' }}
                onClick={() => setShowAdvancedMidi(prev => !prev)}
              >
                <div style={{ fontSize: '0.9rem', color: 'var(--accent-base)', fontWeight: 900, letterSpacing: '0.02em' }}>
                  Advanced MIDI Settings {showAdvancedMidi ? '▾' : '▸'}
                </div>
                {showAdvancedMidi && (
                  <button className="btn" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={(e) => { e.stopPropagation(); resetMidiDefaults(); }} title="Reset all advanced MIDI settings to defaults">
                    <RefreshCw size={14} /> Reset All Defaults
                  </button>
                )}
              </div>

              {showAdvancedMidi && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>

                  {/* ── MIDI Channels ─────────────────────────────── */}
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>MIDI Channels</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.75rem' }}>Control</label>
                      <input type="number" min={1} max={16} className="text-input" value={controlChannel + 1}
                        onChange={e => setControlChannel(Math.min(15, Math.max(0, (parseInt(e.target.value) || 1) - 1)))}
                        style={{ padding: '6px', fontSize: '0.9rem' }} />
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>FX, Free, Memory, Faders</span>
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.75rem' }}>MIDI Notes</label>
                      <input type="number" min={1} max={16} className="text-input" value={notesChannel + 1}
                        onChange={e => setNotesChannel(Math.min(15, Math.max(0, (parseInt(e.target.value) || 1) - 1)))}
                        style={{ padding: '6px', fontSize: '0.9rem' }} />
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>MIDI Loop notes</span>
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.75rem' }}>Drumkit</label>
                      <input type="number" min={1} max={16} className="text-input" value={drumkitChannel + 1}
                        onChange={e => setDrumkitChannel(Math.min(15, Math.max(0, (parseInt(e.target.value) || 1) - 1)))}
                        style={{ padding: '6px', fontSize: '0.9rem' }} />
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>Future feature</span>
                    </div>
                  </div>

                  {/* ── Default CCs ───────────────────────────────── */}
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>Default CCs</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {[
                      { key: 'inputA', label: 'Input FX A' }, { key: 'inputB', label: 'Input FX B' },
                      { key: 'inputC', label: 'Input FX C' }, { key: 'inputD', label: 'Input FX D' },
                      { key: 'trackA', label: 'Track FX A' }, { key: 'trackB', label: 'Track FX B' },
                      { key: 'trackC', label: 'Track FX C' }, { key: 'trackD', label: 'Track FX D' }
                    ].map((item) => (
                      <div className="input-group" key={item.key} style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '0.75rem' }}>{item.label}</label>
                        <input
                          type="number" min={0} max={127}
                          className="text-input"
                          value={ccMap[item.key as keyof typeof ccMap]}
                          onChange={e => setCcMap(prev => ({ ...prev, [item.key]: Math.min(127, Math.max(0, parseInt(e.target.value) || 0)) }))}
                          style={{ padding: '6px', fontSize: '0.9rem' }}
                        />
                      </div>
                    ))}
                  </div>

                </div>
              )}
            </div>
          </div>
        )}

        {/* ── General Settings Modal ──────────────────────────────────────── */}
        {showGeneralModal && (
          <div className={`modal-overlay ${isAdjustingBg ? 'adjusting' : ''} ${tutorialStep !== null ? 'tutorial-active' : ''}`}
            onClick={() => setShowGeneralModal(false)}
          >
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2><Settings size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} />General Settings</h2>
                <X size={24} weight="bold" style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowGeneralModal(false)} />
              </div>

              {/* Functionality Section */}
              <div className="input-group">
                <label>Toggle Mode Key (Edit ↔ Perform)</label>
                <input className="text-input" value={modeToggleKey} readOnly placeholder="Press a key..."
                  onKeyDown={(e) => { e.preventDefault(); setModeToggleKey(e.key); }}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Click the field above and press any key to rebind. Currently: <strong>{modeToggleKey}</strong>
                </span>
              </div>

              <div className="input-group">
                <label>Grid Mode</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn ${snapToGrid ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setSnapToGrid(true)}>
                    <Grid size={18} color={snapToGrid ? (colorMode === 'dark' ? '#000000' : '#ffffff') : accentColor} weight="bold" /> Grid
                  </button>
                  <button className={`btn ${!snapToGrid ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setSnapToGrid(false)}>
                    Free
                  </button>
                </div>
              </div>

              {snapToGrid && (
                <>
                  <div className="input-group">
                    <label>Grid Size ({gridSize}px)</label>
                    <input type="range" min="10" max="100" step="5" value={gridSize}
                      onChange={e => setGridSize(parseInt(e.target.value))}
                      onPointerDown={() => { setIsAdjustingBg(true); setIsAdjustingGrid(true); }}
                      onPointerUp={() => { setIsAdjustingBg(false); setIsAdjustingGrid(false); }}
                      style={{ width: '100%', accentColor: 'var(--accent-base)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                      <span>Fine</span><span>Medium</span><span>Coarse</span>
                    </div>
                  </div>

                  <div className="input-group" style={{ marginTop: 8 }}>
                    <label>Grid Line Intensity ({Math.round(gridOpacity * 100)}%)</label>
                    <input type="range" min="0" max="1" step="0.01" value={gridOpacity}
                      onChange={e => setGridOpacity(parseFloat(e.target.value))}
                      onPointerDown={() => { setIsAdjustingBg(true); setIsAdjustingGrid(true); }}
                      onPointerUp={() => { setIsAdjustingBg(false); setIsAdjustingGrid(false); }}
                      style={{ width: '100%', accentColor: 'var(--accent-base)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                      <span>Transparent</span><span>Opaque</span>
                    </div>
                  </div>
                </>
              )}

              <div className="modal-divider" />
              {/* Visual Section */}
              <div style={{ fontSize: '0.9rem', color: 'var(--accent-base)', fontWeight: 900, letterSpacing: '0.02em', marginBottom: 6, borderBottom: '1px solid var(--accent-base)', paddingBottom: 4 }}>Colors & Style</div>
              <div className="input-group" style={{ marginBottom: 12 }}>
                <label>Global Accent Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)}
                    style={{ width: 28, height: 28, border: 'none', padding: 0, cursor: 'pointer', borderRadius: '50%', background: 'transparent' }} />
                  <button className="btn" style={{ padding: '4px', minWidth: '32px', justifyContent: 'center' }} onClick={() => setAccentColor('#00FF00')} title="Reset to Default">
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label>Appearance</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn ${colorMode === 'dark' ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setColorMode('dark')}>
                    <Moon size={14} /> Dark
                  </button>
                  <button className={`btn ${colorMode === 'light' ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setColorMode('light')}>
                    <Sun size={14} /> Light
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label>Element Theme</label>
                <select className="select-input" value={theme} onChange={e => setTheme(e.target.value as ThemeStyle)}>
                  <option value="filled">Filled</option>
                  <option value="wireframe">Wireframe</option>
                  <option value="frost">Frost</option>
                  <option value="tinted_frost">Tinted Frost</option>
                  <option value="tinted">Tinted</option>
                </select>
              </div>

              <div className="input-group">
                <label>Element Shape</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn ${elementShape === 'square' ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setElementShape('square')}>
                    Square
                  </button>
                  <button className={`btn ${elementShape === 'rounded' ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setElementShape('rounded')}>
                    Rounded
                  </button>
                  <button className={`btn ${elementShape === 'circular' ? 'btn-primary' : ''}`} style={{ flex: 1 }} onClick={() => setElementShape('circular')}>
                    Circular
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label>Glow Intensity ({Math.round(glowAmount * 100)}%)</label>
                <input type="range" min="0" max="2" step="0.05" value={glowAmount}
                  onChange={e => setGlowAmount(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-base)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                  <span>Off</span><span>Normal</span><span>Max</span>
                </div>
              </div>

              <div className="input-group">
                <label>Border Thickness ({borderWidth}px)</label>
                <input type="range" min="0" max="10" step="1" value={borderWidth}
                  onChange={e => setBorderWidth(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-base)' }}
                />
              </div>

              <div style={{ fontSize: '0.9rem', color: 'var(--accent-base)', fontWeight: 900, letterSpacing: '0.02em', marginBottom: 6, borderBottom: '1px solid var(--accent-base)', paddingBottom: 4, marginTop: -4 }}>Canvas Backdrop</div>
              <div className="input-group" style={{ marginBottom: 12 }}>
                <label>Background Image</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={importBgImage}>
                    <Image size={14} /> Choose Image
                  </button>
                  {bgImage && (
                    <button className="btn" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setBgImage('')}>
                      <X size={14} /> Remove
                    </button>
                  )}
                </div>
                {bgImage && (
                  <>
                    <div style={{ marginTop: 10, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
                      <img src={bgImage} alt="Background preview" style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)' }} />
                    </div>
                    
                    <div style={{ marginTop: 12 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Image Blur</label>
                      <input type="range" min="0" max="6" step="0.1" value={bgBlur}
                        onChange={e => setBgBlur(parseFloat(e.target.value))}
                        onPointerDown={() => setIsAdjustingBg(true)}
                        onPointerUp={() => setIsAdjustingBg(false)}
                        style={{ width: '100%', accentColor: 'var(--accent-base)', marginTop: 4 }}
                      />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Image Opacity ({Math.round(bgOpacity * 100)}%)</label>
                      <input type="range" min="0" max="1" step="0.01" value={bgOpacity}
                        onChange={e => setBgOpacity(parseFloat(e.target.value))}
                        onPointerDown={() => setIsAdjustingBg(true)}
                        onPointerUp={() => setIsAdjustingBg(false)}
                        style={{ width: '100%', accentColor: 'var(--accent-base)', marginTop: 4 }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="input-group" style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--accent-base)', fontWeight: 900, letterSpacing: '0.02em', marginBottom: 6, borderBottom: '1px solid var(--accent-base)', paddingBottom: 4, marginTop: -4 }}>Metronome Visuals</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={workspaceFlash} onChange={e => setWorkspaceFlash(e.target.checked)} style={{ accentColor: 'var(--accent-base)' }} />
                    Metronome Background Flash
                  </label>
                </div>
              </div>

              <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <button className="btn" style={{ width: '100%', justifyContent: 'center', color: 'var(--text-primary)' }} onClick={resetTheme}>
                  <RefreshCw size={14} style={{ marginRight: 6 }} /> Reset Visuals to Default
                </button>
              </div>

              <div style={{ fontSize: '0.9rem', color: 'var(--accent-base)', fontWeight: 900, letterSpacing: '0.02em', marginBottom: 6, borderBottom: '1px solid var(--accent-base)', paddingBottom: 4, marginTop: 12 }}>System Updates</div>

              <div className="input-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} style={{ accentColor: 'var(--accent-base)' }} />
                  Check for updates automatically on launch
                </label>
              </div>

              <div className="input-group">
                <button
                  className="btn"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => checkForUpdates(false)}
                  disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                >
                  {updateStatus === 'checking' ? (
                    <><RefreshCw size={14} className="spin" style={{ marginRight: 6 }} /> Checking...</>
                  ) : (
                    <><Download size={14} style={{ marginRight: 6 }} /> Check for Updates</>
                  )}
                </button>

                {updateStatus === 'available' && (
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(var(--accent-rgb), 0.1)', border: '1px solid var(--accent-base)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, marginBottom: 6 }}>
                      🎉 Update v{updateVersion} available!
                    </div>
                    <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }} onClick={installUpdate}>
                      <Download size={14} style={{ marginRight: 6 }} /> Download & Install
                    </button>
                  </div>
                )}

                {updateStatus === 'downloading' && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Downloading update... {updateProgress}%
                    </div>
                    <div style={{ width: '100%', height: 6, background: 'var(--bg-panel)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${updateProgress}%`, height: '100%', background: 'var(--accent-base)', borderRadius: 3, transition: 'width 0.2s ease' }} />
                    </div>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--danger)' }}>
                    {updateError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Credits Modal ─────────────────────────────────────────────── */}
        {showCreditsModal && (
          <div className="modal-overlay" onClick={() => setShowCreditsModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 style={{ fontFamily: 'var(--font-logo)', fontWeight: 900 }}>LPL505</h2>
                <X size={18} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowCreditsModal(false)} />
              </div>

              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                <strong>Launchpadless505.</strong> Control your Boss RC-505mk2 FX without a Novation Launchpad Pro MK3.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://youtube.com/'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-base)', textDecoration: 'none', fontSize: '0.9rem' }}>
                  <ExternalLink size={18} /> View the YouTube Tutorial
                </a>

                <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://discord.gg/XNXjXU3jde'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-base)', textDecoration: 'none', fontSize: '0.9rem' }}>
                  <ExternalLink size={18} /> Found a bug? Report it here
                </a>

                <div className="modal-divider" />

                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Credits
                </div>

                <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://www.youtube.com/@JMakesMusicx'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem' }}>
                  <ExternalLink size={18} /> @JMakesMusicx on YouTube
                </a>
                <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://ko-fi.com/jmakesmusicx'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem' }}>
                  <ExternalLink size={18} weight="bold" /> Buy me a coffee (Ko-fi)
                </a>

                <div className="modal-divider" />

                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Help
                </div>
                <button className="btn" style={{ fontSize: '0.8rem', padding: '6px 10px', justifyContent: 'center', width: '100%' }} onClick={() => {
                  setShowCreditsModal(false);
                  // Long delay to ensure Credits modal has fully unmounted before tutorial mounts
                  setTimeout(() => startTutorial(), 200);
                }}>
                  <RefreshCw size={18} /> Restart Tutorial
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="disable-tutorial-checkbox"
                    checked={tutorialCompleted}
                    onChange={(e) => setTutorialCompleted(e.target.checked)}
                    style={{ accentColor: 'var(--accent-base)', cursor: 'pointer', marginBottom: 0 }}
                  />
                  <label htmlFor="disable-tutorial-checkbox" style={{ cursor: 'pointer', margin: 0 }}>Disable tutorial on startup</label>
                </div>

                <div className="modal-divider" />

                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Debug
                </div>
                <button className="btn" style={{ fontSize: '0.8rem', padding: '6px 10px', justifyContent: 'center' }} onClick={() => {
                  setShowCreditsModal(false);
                  setShowBootPrompt(true);
                }}>
                  <RefreshCw size={18} /> Return to Boot Screen
                </button>

                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 8 }}>
                  Build v2.0.0
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Close create menu on click outside */}
        {showCreateMenu && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowCreateMenu(false)} />
        )}

        {/* ── Boot Prompt Modal ──────────────────────────────────────── */}
        {showBootPrompt && (
          <div className="modal-overlay" style={{ background: 'var(--bg-base)' }}>
            <div className="modal" style={{ alignItems: 'center', padding: 40, textAlign: 'center', width: 500, maxWidth: '90vw' }}>
              <h1 style={{ fontFamily: 'var(--font-logo)', marginBottom: 8, fontSize: '2.5rem' }}>LPL<span style={{ color: 'var(--accent-base)' }}>505</span></h1>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.95rem' }}>
                Welcome back friend! Do you want to continue your last session or start fresh?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                <button className="btn btn-primary" style={{ width: '100%', padding: '14px 16px', justifyContent: 'center', fontSize: '1.05rem' }} onClick={continueSession}>
                  <Play size={18} color="var(--accent-contrast)" /> Continue Session
                </button>
                <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                  <button className="btn" style={{ flex: 1, padding: '12px 16px', justifyContent: 'center', fontSize: '0.95rem' }} onClick={importTemplate}>
                    <FolderOpen size={16} /> Load Preset
                  </button>
                  <button className="btn" style={{ flex: 1, padding: '12px 16px', justifyContent: 'center', fontSize: '0.95rem' }} onClick={newProject}>
                    <Plus size={16} /> New Project
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* ── Piano Roll Editor Modal ──────────────────────────────── */}
        {showPianoRoll && pianoRollElementId && (() => {
          const loopEl = macros.find(m => m.id === pianoRollElementId && m.type === 'midi_loop') as MidiLoopElement | undefined;
          if (!loopEl) return null;
          return (
            <PianoRollEditor
              element={loopEl}
              onUpdate={(updated) => handleUpdateMacro(updated)}
              onClose={() => setShowPianoRoll(false)}
              accentColor={accentColor}
              colorMode={colorMode}
              elementShape={elementShape}
            />
          );
        })()}
        {/* ── Tutorial Overlay ──────────────────────────────────────── */}
        {tutorialStep !== null && (
          <Tutorial
            step={tutorialStep}
            onNext={() => {
              setShowMidiModal(false);
              setShowGeneralModal(false);
              setShowCreditsModal(false);
              setShowCreateMenu(false);
              if (tutorialStep >= STEPS.length - 1) endTutorial();
              else setTutorialStep(tutorialStep + 1);
            }}
            onAdvanceOnly={() => {
              // If advancing from step 2 (index 1), make sure the create menu opens
              if (tutorialStep === 1) setShowCreateMenu(true);
              
              if (tutorialStep >= STEPS.length - 1) endTutorial();
              else setTutorialStep(tutorialStep + 1);
            }}
            onBack={() => {
              setShowMidiModal(false);
              setShowGeneralModal(false);
              setShowCreditsModal(false);
              setShowCreateMenu(false);
              if (tutorialStep > 0) setTutorialStep(tutorialStep - 1);
            }}
            onSkip={endTutorial}
          />
        )}
      </div>
    </IconContext.Provider>
  );
}

export default App;
