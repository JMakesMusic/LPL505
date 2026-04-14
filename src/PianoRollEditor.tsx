import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { MidiNote, MidiLoopElement } from './types';
import { X, Play, Stop, Trash, MagnetStraight as Magnet, ArrowUUpLeft, ArrowUUpRight } from '@phosphor-icons/react';
import { useMidi } from './MidiContext';

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_NOTES = 128;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const TICKS_PER_BEAT = 24;

const SNAP_OPTIONS = [
  { label: '1 Bar', ticks: 96 },  // 4 beats × 24
  { label: '1/2', ticks: 48 },
  { label: '1/4', ticks: 24 },
  { label: '1/8', ticks: 12 },
  { label: '1/16', ticks: 6 },
  { label: '1/32', ticks: 3 },
  { label: '1/4T', ticks: 16 },  // Triplet quarter (24 * 2/3)
  { label: '1/8T', ticks: 8 },   // Triplet eighth  (12 * 2/3)
  { label: '1/16T', ticks: 4 },   // Triplet sixteenth
  { label: '1/4·5', ticks: 19 },  // Quintuplet quarter (~24/1.25)
  { label: '1/8·5', ticks: 10 },  // Quintuplet eighth
  { label: 'Free', ticks: 1 },   // No snapping
];

const MAX_TICK_WIDTH = 32;

const LOOP_BAR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

const getNoteLabel = (pitch: number) => {
  const name = NOTE_NAMES[pitch % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface PianoRollEditorProps {
  element: MidiLoopElement;
  onUpdate: (el: MidiLoopElement) => void;
  onClose: () => void;
  accentColor: string;
  colorMode: 'dark' | 'light';
  elementShape: 'square' | 'rounded' | 'circular';
}

// ─── Component ───────────────────────────────────────────────────────────────

const PianoRollEditor: React.FC<PianoRollEditorProps> = ({ element, onUpdate, onClose, accentColor, colorMode, elementShape }) => {
  const { sendNoteOn, sendNoteOff, timeSignature, timeDenominator } = useMidi();

  // ─── State ──────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<MidiNote[]>(element.notes);
  const [loopLengthBars, setLoopLengthBars] = useState(element.loopLengthBars);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [snapIndex, setSnapIndex] = useState(2); // default 1/4
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState(0);

  const [tickWidth, setTickWidth] = useState(3);
  const [noteHeight, setNoteHeight] = useState(14);

  const gridRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const targetScrollLeftRef = useRef<number | null>(null);

  const didDragRef = useRef(false);
  const [rubberBand, setRubberBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Middle mouse panning
  const isPanningRef = useRef(false);

  const playIntervalRef = useRef<number | null>(null);
  const activePlayNotes = useRef<Set<number>>(new Set());
  const [previewActiveNoteIds, setPreviewActiveNoteIds] = useState<Set<string>>(new Set());

  // Clipboard & duplicate
  const clipboardRef = useRef<MidiNote[]>([]);
  const lastDuplicateOffsetRef = useRef<number>(0);
  const duplicateSourceRef = useRef<{ notes: MidiNote[]; span: number } | null>(null);

  // Right-click eraser
  const isErasingRef = useRef(false);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const [deletingNoteIds, setDeletingNoteIds] = useState<Set<string>>(new Set());

  // Mouse position tracking (for paste)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // ─── History (Undo/Redo) ────────────────────────────────────────────────
  const [history, setHistory] = useState<MidiNote[][]>([element.notes]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  const pushHistory = useCallback((newNotes: MidiNote[]) => {
    setHistory(prev => {
      const upToNow = prev.slice(0, historyIndexRef.current + 1);
      return [...upToNow, newNotes];
    });
    setHistoryIndex(prev => prev + 1);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIndex = historyIndexRef.current - 1;
      setHistoryIndex(newIndex);
      setHistory(prev => {
        setNotes(prev[newIndex]);
        return prev;
      });
      setSelectedNoteIds(new Set());
    }
  }, []);

  const redo = useCallback(() => {
    setHistory(prev => {
      if (historyIndexRef.current < prev.length - 1) {
        const newIndex = historyIndexRef.current + 1;
        setHistoryIndex(newIndex);
        setNotes(prev[newIndex]);
        setSelectedNoteIds(new Set());
      }
      return prev;
    });
  }, []);

  const beatsPerBar = timeSignature;
  const ticksPerBeat = timeDenominator === 8 ? 12 : TICKS_PER_BEAT;
  const totalTicks = loopLengthBars * beatsPerBar * ticksPerBeat;
  const snapTicks = SNAP_OPTIONS[snapIndex].ticks;

  const PIANO_WIDTH = 60;
  const VELOCITY_HEIGHT = 80;
  const TOOLBAR_HEIGHT = 48;
  const LOOP_SLIDER_HEIGHT = 28;

  const snapTicksRef = useRef(snapTicks);
  snapTicksRef.current = snapTicks;
  const totalTicksRef = useRef(totalTicks);
  totalTicksRef.current = totalTicks;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const tickWidthRef = useRef(tickWidth);
  tickWidthRef.current = tickWidth;
  const noteHeightRef = useRef(noteHeight);
  noteHeightRef.current = noteHeight;

  const targetScrollTopRef = useRef<number | null>(null);

  // Calculate min tick width so the total loop length fits perfectly
  const [gridContainerWidth, setGridContainerWidth] = useState(1100);
  const minTickWidth = Math.max(0.3, gridContainerWidth / totalTicks);
  const minTickWidthRef = useRef(minTickWidth);
  minTickWidthRef.current = minTickWidth;

  // Apply scheduled scroll top/left after React finishes rendering the newly sized grid
  useLayoutEffect(() => {
    if (gridRef.current) {
      if (targetScrollTopRef.current !== null) {
        gridRef.current.scrollTop = targetScrollTopRef.current;
        if (sidebarContentRef.current) {
          sidebarContentRef.current.style.top = `-${gridRef.current.scrollTop}px`;
        }
        targetScrollTopRef.current = null;
      }
      if (targetScrollLeftRef.current !== null) {
        gridRef.current.scrollLeft = targetScrollLeftRef.current;
        targetScrollLeftRef.current = null;
      }
    }
  }, [noteHeight, tickWidth]);

  // Track mouse position for paste-at-cursor
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Track grid container width for min zoom calculation
  useEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setGridContainerWidth(entry.contentRect.width - PIANO_WIDTH);
      }
    });
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, []);

  // Scroll to middle range on mount
  useEffect(() => {
    if (gridRef.current) {
      const targetNote = 60;
      const topOffset = (TOTAL_NOTES - targetNote - 12) * noteHeight;
      gridRef.current.scrollTop = Math.max(0, topOffset);
      if (sidebarContentRef.current) {
        sidebarContentRef.current.style.top = `-${gridRef.current.scrollTop}px`;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync back to parent ────────────────────────────────────────────────
  useEffect(() => {
    onUpdate({ ...element, notes, loopLengthBars });
  }, [notes, loopLengthBars]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Middle mouse pan ──────────────────────────────────────────────────
  useEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const handleMiddleDown = (e: PointerEvent) => {
      if (e.button !== 1) return; // middle mouse only
      e.preventDefault();
      isPanningRef.current = true;
      gridEl.style.cursor = 'grabbing';
      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = gridEl.scrollLeft;
      const startScrollTop = gridEl.scrollTop;

      const onMove = (moveEvt: PointerEvent) => {
        gridEl.scrollLeft = startScrollLeft - (moveEvt.clientX - startX);
        gridEl.scrollTop = startScrollTop - (moveEvt.clientY - startY);
      };
      const onUp = () => {
        isPanningRef.current = false;
        gridEl.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    gridEl.addEventListener('pointerdown', handleMiddleDown);
    return () => gridEl.removeEventListener('pointerdown', handleMiddleDown);
  }, []);

  // ─── Ctrl+Scroll zoom ─────────────────────────────────────────────────
  useEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const handleWheel = (e: WheelEvent) => {
      // 1. Alt + Scroll = Vertical Zoom (Note Height)
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();

        const currentHeight = noteHeightRef.current;
        // Use exponential zoom for smoother feel. Scale deltaY for sensitivity control.
        const zoomFactor = Math.pow(1.001, -e.deltaY * 0.5);
        const newHeight = Math.max(6, Math.min(64, currentHeight * zoomFactor));

        if (Math.abs(newHeight - currentHeight) > 0.01) {
          const rect = gridEl.getBoundingClientRect();
          const offsetY = e.clientY - rect.top;
          const virtualY = gridEl.scrollTop + offsetY;
          const newVirtualY = (virtualY / currentHeight) * newHeight;

          targetScrollTopRef.current = newVirtualY - offsetY;
          setNoteHeight(newHeight);
        }
        return;
      }

      // 2. Shift + Scroll = Horizontal Scroll
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        // Browser default shift+scroll is often sensitive. We'll manual-scroll for consistency.
        gridEl.scrollLeft += e.deltaY;
        return;
      }

      // 3. Ctrl/Cmd + Scroll = Horizontal Zoom (Tick Width)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const currentWidth = tickWidthRef.current;
        // Exponential zoom factor (less sensitive than linear increments)
        const zoomFactor = Math.pow(1.001, -e.deltaY * 0.5);
        const newWidth = Math.max(minTickWidthRef.current, Math.min(MAX_TICK_WIDTH, currentWidth * zoomFactor));

        if (Math.abs(newWidth - currentWidth) > 0.001) {
          const rect = gridEl.getBoundingClientRect();
          const offsetX = e.clientX - rect.left - PIANO_WIDTH;
          if (offsetX >= 0) {
            const virtualX = gridEl.scrollLeft + offsetX;
            const newVirtualX = (virtualX / currentWidth) * newWidth;
            targetScrollLeftRef.current = newVirtualX - offsetX;
          }
          setTickWidth(newWidth);
        }
        return;
      }
    };

    gridEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => gridEl.removeEventListener('wheel', handleWheel);
  }, []);

  // ─── Note helpers ───────────────────────────────────────────────────────

  const addNote = useCallback((pitch: number, startTick: number) => {
    const snap = snapTicksRef.current;
    const snapped = snap > 1 ? Math.floor(startTick / snap) * snap : startTick;
    const currentNotes = notesRef.current;

    const overlapping = currentNotes.find(n =>
      n.pitch === pitch && snapped >= n.startTick && snapped < n.startTick + n.duration
    );
    if (overlapping) {
      setNotes(prev => prev.filter(n => n.id !== overlapping.id));
      setSelectedNoteIds(new Set());
      return;
    }

    const duration = snap > 1 ? snap : 6; // Default to 1/16 when free mode
    const newNote: MidiNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pitch,
      startTick: snapped,
      duration,
      velocity: 100,
    };
    const newNotes = [...currentNotes, newNote];
    setNotes(newNotes);
    setSelectedNoteIds(new Set([newNote.id]));
    pushHistory(newNotes);

    sendNoteOn(pitch, 100);
    setTimeout(() => sendNoteOff(pitch), 150);
  }, [sendNoteOn, sendNoteOff]);

  const deleteSelectedNotes = useCallback(() => {
    if (selectedNoteIds.size === 0) return;
    const ids = Array.from(selectedNoteIds);
    setDeletingNoteIds(prev => new Set([...prev, ...ids]));
    
    setTimeout(() => {
      setNotes(prev => {
        const newNotes = prev.filter(n => !selectedNoteIds.has(n.id));
        pushHistory(newNotes);
        return newNotes;
      });
      setDeletingNoteIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      setSelectedNoteIds(new Set());
    }, 200);
  }, [selectedNoteIds, pushHistory]);

  const clearAllNotes = () => {
    const ids = notes.map(n => n.id);
    setDeletingNoteIds(new Set(ids));
    setTimeout(() => {
      setNotes([]);
      setSelectedNoteIds(new Set());
      pushHistory([]);
      setDeletingNoteIds(new Set());
    }, 200);
  };

  // ─── Clipboard: Copy ──────────────────────────────────────────────────
  const copySelectedNotes = useCallback(() => {
    const selected = notesRef.current.filter(n => selectedNoteIds.has(n.id));
    if (selected.length === 0) return;
    clipboardRef.current = selected.map(n => ({ ...n }));
  }, [selectedNoteIds]);

  // ─── Clipboard: Paste (at mouse position) ─────────────────────────────
  const pasteNotes = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const copied = clipboardRef.current;
    const minTick = Math.min(...copied.map(n => n.startTick));

    // Calculate the tick position from the current mouse position
    const gridEl = gridRef.current;
    let pasteTick = 0;
    if (gridEl) {
      const rect = gridEl.getBoundingClientRect();
      const mouseXInGrid = mousePosRef.current.x - rect.left + gridEl.scrollLeft;
      const snap = snapTicksRef.current;
      pasteTick = Math.max(0, snap > 1 ? Math.floor(mouseXInGrid / (tickWidthRef.current * snap)) * snap : Math.floor(mouseXInGrid / tickWidthRef.current));
    }

    const pastedNotes = copied.map(n => ({
      ...n,
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startTick: n.startTick - minTick + pasteTick,
    })).filter(n => n.startTick >= 0 && n.startTick < totalTicksRef.current);

    if (pastedNotes.length === 0) return;
    const newNotes = [...notesRef.current, ...pastedNotes];
    setNotes(newNotes);
    setSelectedNoteIds(new Set(pastedNotes.map(n => n.id)));
    pushHistory(newNotes);
  }, [pushHistory]);

  // ─── Duplicate (Ctrl+D): Ableton-style ────────────────────────────────
  const duplicateSelection = useCallback(() => {
    // On first press, capture the source notes and their span
    if (!duplicateSourceRef.current) {
      const selected = notesRef.current.filter(n => selectedNoteIds.has(n.id));
      if (selected.length === 0) return;
      const minTick = Math.min(...selected.map(n => n.startTick));
      const maxEnd = Math.max(...selected.map(n => n.startTick + n.duration));
      duplicateSourceRef.current = {
        notes: selected.map(n => ({ ...n })),
        span: maxEnd - minTick,
      };
      lastDuplicateOffsetRef.current = 0;
    }

    const { notes: sourceNotes, span } = duplicateSourceRef.current;

    // Advance by one span each press
    lastDuplicateOffsetRef.current += span;
    const offset = lastDuplicateOffsetRef.current;

    const duped = sourceNotes.map(n => ({
      ...n,
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startTick: n.startTick + offset,
    })).filter(n => n.startTick < totalTicksRef.current);

    if (duped.length === 0) return;
    const newNotes = [...notesRef.current, ...duped];
    setNotes(newNotes);
    // Only select the newly duplicated notes
    setSelectedNoteIds(new Set(duped.map(n => n.id)));
    pushHistory(newNotes);
  }, [selectedNoteIds, pushHistory]);

  // ─── Keyboard handler ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (playIntervalRef.current) stopPreview();
        else startPreview();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedNotes();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedNoteIds(new Set(notesRef.current.map(n => n.id)));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedNotes();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        pasteNotes();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedNotes, undo, redo, copySelectedNotes, pasteNotes, duplicateSelection]);

  // Reset duplicate chain when selection changes manually (click, rubber-band, etc.)
  useEffect(() => {
    // Clear the source ref so next Ctrl+D recalculates from new selection
    duplicateSourceRef.current = null;
    lastDuplicateOffsetRef.current = 0;
  }, [selectedNoteIds]);

  // ─── Note dragging (move / resize) — supports multi-select ────────────
  const startNoteDrag = useCallback((e: React.PointerEvent, noteId: string, dragType: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    didDragRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;

    let dragIds: Set<string>;
    if (selectedNoteIds.has(noteId)) {
      dragIds = new Set(selectedNoteIds);
    } else {
      dragIds = new Set([noteId]);
      setSelectedNoteIds(dragIds);
    }

    let sourceNotes = notesRef.current;

    // FL Studio style duplicate on shift+drag
    if (e.shiftKey && dragType === 'move') {
      const dupedNotes: MidiNote[] = [];
      const newDragIds = new Set<string>();
      
      sourceNotes.forEach(n => {
        if (dragIds.has(n.id)) {
          const newId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          dupedNotes.push({ ...n, id: newId });
          newDragIds.add(newId);
        }
      });
      
      sourceNotes = [...sourceNotes, ...dupedNotes];
      setNotes(sourceNotes);
      dragIds = newDragIds;
      setSelectedNoteIds(dragIds);
    }

    const originals = new Map<string, { startTick: number; duration: number; pitch: number }>();
    sourceNotes.forEach(n => {
      if (dragIds.has(n.id)) {
        originals.set(n.id, { startTick: n.startTick, duration: n.duration, pitch: n.pitch });
      }
    });

    let lastComputedNotes: MidiNote[] | null = null;
    const onMove = (moveEvt: PointerEvent) => {
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;
      const snap = snapTicksRef.current;
      const tw = tickWidthRef.current;
      const minDuration = snap > 1 ? snap : 1;

      if (dragType === 'resize') {
        const tickDelta = snap > 1
          ? Math.round(dx / tw / snap) * snap
          : Math.round(dx / tw);
        lastComputedNotes = sourceNotes.map(n => {
          if (!dragIds.has(n.id)) return n;
          const orig = originals.get(n.id)!;
          return { ...n, duration: Math.max(minDuration, orig.duration + tickDelta) };
        });
      } else {
        const tickDelta = snap > 1
          ? Math.round(dx / tw / snap) * snap
          : Math.round(dx / tw);
        const pitchDelta = -Math.round(dy / noteHeight);
        lastComputedNotes = sourceNotes.map(n => {
          if (!dragIds.has(n.id)) return n;
          const orig = originals.get(n.id)!;
          const newStart = Math.max(0, Math.min(totalTicksRef.current - minDuration, orig.startTick + tickDelta));
          const newPitch = Math.max(0, Math.min(127, orig.pitch + pitchDelta));
          return { ...n, startTick: newStart, pitch: newPitch };
        });
      }
      setNotes(lastComputedNotes);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setTimeout(() => { didDragRef.current = false; }, 50);
      if (lastComputedNotes) {
        pushHistory(lastComputedNotes);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [selectedNoteIds, noteHeight, pushHistory]);

  // ─── Preview playback ──────────────────────────────────────────────────
  const startPreview = () => {
    if (isPlaying) {
      stopPreview();
      return;
    }
    setIsPlaying(true);
    setPlayheadTick(0);
    let currentTick = 0;
    const msPerTick = (60000 / 120) / TICKS_PER_BEAT;
    const loopTotal = totalTicks;

    const playTick = () => {
      if (currentTick >= loopTotal) {
        currentTick = 0;
        activePlayNotes.current.forEach(pitch => sendNoteOff(pitch));
        activePlayNotes.current.clear();
      }
      setPlayheadTick(currentTick);

      const activeIds = new Set<string>();
      notesRef.current.forEach(n => {
        const isActive = currentTick >= n.startTick && currentTick < n.startTick + n.duration;
        if (isActive) activeIds.add(n.id);

        if (n.startTick === currentTick) {
          sendNoteOn(n.pitch, n.velocity);
          activePlayNotes.current.add(n.pitch);
        }
        if (n.startTick + n.duration === currentTick) {
          sendNoteOff(n.pitch);
          activePlayNotes.current.delete(n.pitch);
        }
      });
      setPreviewActiveNoteIds(activeIds);
      currentTick++;
    };

    playTick();
    playIntervalRef.current = window.setInterval(playTick, msPerTick);
  };

  const stopPreview = () => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    activePlayNotes.current.forEach(pitch => sendNoteOff(pitch));
    activePlayNotes.current.clear();
    setIsPlaying(false);
    setPlayheadTick(0);
    setPreviewActiveNoteIds(new Set());
  };

  useEffect(() => {
    return () => stopPreview();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Grid pointerdown handler (click-to-add + rubber-band select + right-click erase) ──────
  const handleGridPointerDown = useCallback((e: React.PointerEvent) => {
    // Right click: start eraser mode
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      isErasingRef.current = true;
      erasedIdsRef.current = new Set();

      const gridContentRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // Check if we clicked directly on a note at this position
      const clickX = e.clientX - gridContentRect.left;
      const clickY = e.clientY - gridContentRect.top;
      const tw = tickWidthRef.current;
      const clickedTick = clickX / tw;
      const clickedRow = Math.floor(clickY / noteHeight);
      const clickedPitch = TOTAL_NOTES - 1 - clickedRow;

      notesRef.current.forEach(n => {
        if (n.pitch === clickedPitch && clickedTick >= n.startTick && clickedTick < n.startTick + n.duration) {
          if (!erasedIdsRef.current.has(n.id)) {
            erasedIdsRef.current.add(n.id);
            setDeletingNoteIds(prev => new Set([...prev, n.id]));
          }
        }
      });

      const onMoveErase = (moveEvt: PointerEvent) => {
        const mx = moveEvt.clientX - gridContentRect.left;
        const my = moveEvt.clientY - gridContentRect.top;
        const moveTick = mx / tickWidthRef.current;
        const moveRow = Math.floor(my / noteHeight);
        const movePitch = TOTAL_NOTES - 1 - moveRow;
        
        notesRef.current.forEach(n => {
          if (!erasedIdsRef.current.has(n.id) && n.pitch === movePitch && moveTick >= n.startTick && moveTick < n.startTick + n.duration) {
            erasedIdsRef.current.add(n.id);
            setDeletingNoteIds(prev => new Set([...prev, n.id]));
          }
        });
      };
      const onUpErase = () => {
        window.removeEventListener('pointermove', onMoveErase);
        window.removeEventListener('pointerup', onUpErase);
        if (erasedIdsRef.current.size > 0) {
          const idsToRemove = new Set(erasedIdsRef.current);
          setTimeout(() => {
            setNotes(prev => {
              const newNotes = prev.filter(n => !idsToRemove.has(n.id));
              pushHistory(newNotes);
              return newNotes;
            });
            setDeletingNoteIds(prev => {
              const next = new Set(prev);
              idsToRemove.forEach(id => next.delete(id));
              return next;
            });
          }, 200);
          
          setSelectedNoteIds(prev => {
            const next = new Set(prev);
            erasedIdsRef.current.forEach(id => next.delete(id));
            return next;
          });
        }
        isErasingRef.current = false;
        erasedIdsRef.current = new Set();
      };
      window.addEventListener('pointermove', onMoveErase);
      window.addEventListener('pointerup', onUpErase);
      return;
    }

    if (e.button !== 0) return; // left click only
    if (isPanningRef.current) return;

    const gridContentRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickXInContent = e.clientX - gridContentRect.left;
    const clickYInContent = e.clientY - gridContentRect.top;

    const startX = e.clientX;
    const startY = e.clientY;
    let isRubberBanding = false;
    const DRAG_THRESHOLD = 5;

    const onMove = (moveEvt: PointerEvent) => {
      const dx = Math.abs(moveEvt.clientX - startX);
      const dy = Math.abs(moveEvt.clientY - startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isRubberBanding = true;
        didDragRef.current = true;

        const currentXInContent = moveEvt.clientX - gridContentRect.left;
        const currentYInContent = moveEvt.clientY - gridContentRect.top;

        const rx = Math.min(clickXInContent, currentXInContent);
        const ry = Math.min(clickYInContent, currentYInContent);
        const rw = Math.abs(currentXInContent - clickXInContent);
        const rh = Math.abs(currentYInContent - clickYInContent);
        setRubberBand({ x: rx, y: ry, w: rw, h: rh });
      }
    };

    const onUp = (upEvt: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (isRubberBanding) {
        const currentXInContent = upEvt.clientX - gridContentRect.left;
        const currentYInContent = upEvt.clientY - gridContentRect.top;

        const rx = Math.min(clickXInContent, currentXInContent);
        const ry = Math.min(clickYInContent, currentYInContent);
        const rw = Math.abs(currentXInContent - clickXInContent);
        const rh = Math.abs(currentYInContent - clickYInContent);

        const tw = tickWidthRef.current;
        const tickStart = rx / tw;
        const tickEnd = (rx + rw) / tw;
        const rowStart = ry / noteHeight;
        const rowEnd = (ry + rh) / noteHeight;
        const pitchHigh = TOTAL_NOTES - 1 - rowStart;
        const pitchLow = TOTAL_NOTES - 1 - rowEnd;

        const selected = new Set<string>();
        notesRef.current.forEach(n => {
          const noteEnd = n.startTick + n.duration;
          if (noteEnd > tickStart && n.startTick < tickEnd && n.pitch >= pitchLow && n.pitch <= pitchHigh) {
            selected.add(n.id);
          }
        });
        setSelectedNoteIds(selected);
        setRubberBand(null);
        setTimeout(() => { didDragRef.current = false; }, 50);
      } else {
        if (!didDragRef.current) {
          const tw = tickWidthRef.current;
          const clickedTick = Math.floor(clickXInContent / tw);
          const clickedRow = Math.floor(clickYInContent / noteHeight);
          const clickedPitch = TOTAL_NOTES - 1 - clickedRow;

          if (clickedPitch >= 0 && clickedPitch <= 127 && clickedTick >= 0 && clickedTick < totalTicksRef.current) {
            addNote(clickedPitch, clickedTick);
          }
        }
        didDragRef.current = false;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [noteHeight, addNote]);

  // ─── Velocity bar drag ─────────────────────────────────────────────────
  const handleVelocityDrag = (e: React.PointerEvent, noteId: string) => {
    e.stopPropagation();
    didDragRef.current = true;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const idsToUpdate = selectedNoteIds.has(noteId) ? selectedNoteIds : new Set([noteId]);

    let lastComputedNotes: MidiNote[] | null = null;
    const update = (clientY: number) => {
      const relY = rect.bottom - clientY;
      const ratio = Math.max(0, Math.min(1, relY / VELOCITY_HEIGHT));
      const vel = Math.round(ratio * 127);
      lastComputedNotes = notesRef.current.map(n => idsToUpdate.has(n.id) ? { ...n, velocity: Math.max(1, Math.min(127, vel)) } : n);
      setNotes(lastComputedNotes);
    };

    update(e.clientY);
    if (!selectedNoteIds.has(noteId)) setSelectedNoteIds(new Set([noteId]));

    const onMove = (moveEvt: PointerEvent) => update(moveEvt.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setTimeout(() => { didDragRef.current = false; }, 50);
      if (lastComputedNotes) pushHistory(lastComputedNotes);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Loop region slider ────────────────────────────────────────────────
  const handleLoopSliderClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const maxBars = LOOP_BAR_OPTIONS[LOOP_BAR_OPTIONS.length - 1];
    const clickedBars = Math.max(1, Math.round(ratio * maxBars));
    const nearest = LOOP_BAR_OPTIONS.reduce((prev, curr) =>
      Math.abs(curr - clickedBars) < Math.abs(prev - clickedBars) ? curr : prev
    );
    setLoopLengthBars(nearest);
  };

  // ─── Sidebar vertical zoom ──────────────────────────────────────────────
  const handleSidebarPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const startY = e.clientY;
    const startNoteHeight = noteHeightRef.current;
    const rect = gridEl.getBoundingClientRect();
    const offsetY = startY - rect.top;
    const startScrollTop = gridEl.scrollTop;
    const startVirtualY = startScrollTop + offsetY;

    const onMove = (moveEvt: PointerEvent) => {
      const dy = moveEvt.clientY - startY;
      const newHeight = Math.max(6, Math.min(64, startNoteHeight + dy * 0.15));

      const newVirtualY = (startVirtualY / startNoteHeight) * newHeight;
      targetScrollTopRef.current = newVirtualY - offsetY;

      setNoteHeight(newHeight);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────
  const gridWidth = totalTicks * tickWidth;
  const gridHeight = TOTAL_NOTES * noteHeight;

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '90vw', maxWidth: 1200, height: '85vh', maxHeight: 800,
          display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
        }}
      >
        {/* ── Toolbar ──────────────────────────────────────────────── */}
        <div style={{
          height: TOOLBAR_HEIGHT, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px', borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-panel)', flexShrink: 0,
        }}>
          <h3 style={{ fontWeight: 900, fontSize: '0.9rem', marginRight: 'auto' }}>
            Piano Roll - <span style={{ color: accentColor }}>{element.label}</span>
          </h3>

          {selectedNoteIds.size > 0 && (
            <div style={{ fontSize: '0.7rem', color: accentColor, fontWeight: 700 }}>
              {selectedNoteIds.size} selected
            </div>
          )}

          {/* Snap */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Magnet size={16} style={{ opacity: snapIndex === SNAP_OPTIONS.length - 1 ? 0.25 : 0.6 }} />
            <select
              className="select-input"
              style={{ padding: '4px 8px', fontSize: '0.75rem', minWidth: 70 }}
              value={snapIndex}
              onChange={e => setSnapIndex(parseInt(e.target.value))}
            >
              {SNAP_OPTIONS.map((opt, i) => (
                <option key={i} value={i}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Zoom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: 8 }}>
            Zoom
            <input type="range" min={minTickWidth} max={MAX_TICK_WIDTH} step={0.1} value={tickWidth}
              onChange={e => setTickWidth(parseFloat(e.target.value))}
              style={{ width: 180, accentColor }}
            />
          </div>

          {/* Undo/Redo */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            <button className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem', opacity: historyIndex === 0 ? 0.3 : 1 }} onClick={undo} disabled={historyIndex === 0}>
              <ArrowUUpLeft size={16} />
            </button>
            <button className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem', opacity: historyIndex >= history.length - 1 ? 0.3 : 1 }} onClick={redo} disabled={historyIndex >= history.length - 1}>
              <ArrowUUpRight size={16} />
            </button>
          </div>

          <div style={{ flex: 1 }} />

          {selectedNoteIds.size > 0 && (
            <button className="btn" style={{ padding: '4px 10px', fontSize: '0.75rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={deleteSelectedNotes}>
              <Trash size={14} /> Delete ({selectedNoteIds.size})
            </button>
          )}

          <button className={`btn ${isPlaying ? '' : 'btn-primary'}`} style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={startPreview}>
            {isPlaying ? (
              <>
                <Stop size={14} weight="fill" color={accentColor} /> Stop
              </>
            ) : (
              <>
                <Play size={14} weight="fill" color={colorMode === 'dark' ? '#000000' : '#ffffff'} /> Preview
              </>
            )}
          </button>

          <button className="btn" style={{ padding: '4px 10px', fontSize: '0.75rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={clearAllNotes}>
            <Trash size={14} /> Clear
          </button>

          <X size={20} weight="bold" style={{ cursor: 'pointer', color: 'var(--text-secondary)', marginLeft: 8 }} onClick={onClose} />
        </div>

        {/* ── Loop Region Slider (Ableton-style) ──────────────────── */}
        <div
          style={{
            height: LOOP_SLIDER_HEIGHT, display: 'flex', alignItems: 'center',
            padding: `0 ${PIANO_WIDTH + 100}px 0 16px`,
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-base)', flexShrink: 0, position: 'relative',
            cursor: 'pointer',
          }}
        >
          <div onClick={handleLoopSliderClick} style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
            {Array.from({ length: LOOP_BAR_OPTIONS[LOOP_BAR_OPTIONS.length - 1] + 1 }).map((_, i) => {
              const maxBars = LOOP_BAR_OPTIONS[LOOP_BAR_OPTIONS.length - 1];
              const left = ((i) / maxBars) * 100;
              return (
                <div key={i} style={{
                  position: 'absolute', left: `${left}%`,
                  fontSize: '0.6rem', color: 'var(--text-tertiary)',
                  transform: 'translateX(2px)', top: 2,
                }}>
                  {i}
                </div>
              );
            })}
            <div style={{
              position: 'absolute', left: 0,
              width: `${(loopLengthBars / LOOP_BAR_OPTIONS[LOOP_BAR_OPTIONS.length - 1]) * 100}%`,
              height: '60%', top: '20%',
              background: `${accentColor}40`, border: `1px solid ${accentColor}`,
              borderRadius: 4, transition: 'width 0.15s ease',
            }} />
            <span
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', right: -PIANO_WIDTH - 84, fontSize: '0.7rem', fontWeight: 800, color: accentColor, whiteSpace: 'nowrap', cursor: 'default'
              }}
            >
              {loopLengthBars} {loopLengthBars === 1 ? 'Bar' : 'Bars'}
            </span>
          </div>
        </div>

        {/* ── Main Grid Area ──────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Piano keys sidebar */}
          <div style={{
            width: PIANO_WIDTH, flexShrink: 0, overflow: 'hidden',
            borderRight: '1px solid var(--border-color)', position: 'relative',
            cursor: 'ns-resize',
          }}
            onPointerDown={handleSidebarPointerDown}
          >
            <div ref={sidebarContentRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}>
              {Array.from({ length: TOTAL_NOTES }).map((_, i) => {
                const pitch = TOTAL_NOTES - 1 - i;
                const isBlack = BLACK_KEYS.has(pitch % 12);
                const isC = pitch % 12 === 0;
                return (
                  <div
                    key={pitch}
                    style={{
                      height: noteHeight,
                      display: 'flex', alignItems: 'center',
                      padding: '0 6px',
                      background: isBlack ? 'rgba(0,0,0,0.3)' : 'transparent',
                      borderBottom: isC ? `1px solid ${accentColor}40` : '1px solid var(--border-color)',
                      justifyContent: 'flex-end',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{
                      fontSize: noteHeight >= 24 ? '0.65rem' : '0.55rem',
                      fontWeight: isC ? 800 : (noteHeight >= 24 ? 600 : 400),
                      color: isC ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      opacity: (isC || pitch === 127 || noteHeight >= 24) ? 1 : 0,
                      transition: 'opacity 0.2s, font-size 0.2s',
                      pointerEvents: 'none',
                    }}>
                      {getNoteLabel(pitch)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scrollable grid */}
          <div
            ref={gridRef}
            style={{ flex: 1, overflow: 'auto', position: 'relative' }}
            onScroll={(e) => {
              setScrollLeft(e.currentTarget.scrollLeft);
              if (sidebarContentRef.current) {
                sidebarContentRef.current.style.top = `-${e.currentTarget.scrollTop}px`;
              }
            }}
            onContextMenu={e => e.preventDefault()}
          >
            <div
              style={{
                width: gridWidth, height: gridHeight, position: 'relative',
                cursor: 'crosshair',
              }}
              onPointerDown={handleGridPointerDown}
              onContextMenu={e => e.preventDefault()}
            >
              {/* Background grid lines */}
              {Array.from({ length: TOTAL_NOTES }).map((_, i) => {
                const pitch = TOTAL_NOTES - 1 - i;
                const isBlack = BLACK_KEYS.has(pitch % 12);
                const isC = pitch % 12 === 0;
                return (
                  <div key={`row-${i}`} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: i * noteHeight, height: noteHeight,
                    background: isBlack ? 'rgba(255,255,255,0.02)' : 'transparent',
                    borderBottom: isC ? `1px solid ${accentColor}20` : '1px solid rgba(255,255,255,0.04)',
                  }} />
                );
              })}

              {/* Beat/bar vertical lines */}
              {Array.from({ length: Math.ceil(totalTicks / ticksPerBeat) + 1 }).map((_, i) => {
                const tick = i * ticksPerBeat;
                const isBar = tick % (beatsPerBar * ticksPerBeat) === 0;
                return (
                  <div key={`vline-${i}`} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: tick * tickWidth, width: 1,
                    background: isBar ? `${accentColor}50` : 'rgba(255,255,255,0.06)',
                  }} />
                );
              })}

              {/* Subdivision lines - only shown when snap is smaller than a beat */}
              {snapTicks > 1 && snapTicks < ticksPerBeat && Array.from({ length: Math.ceil(totalTicks / snapTicks) }).map((_, i) => {
                const tick = i * snapTicks;
                if (tick % ticksPerBeat === 0) return null;
                return (
                  <div key={`snap-${i}`} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: tick * tickWidth, width: 1,
                    background: 'rgba(255,255,255,0.02)',
                  }} />
                );
              })}

              {/* Notes */}
              {notes.map(note => {
                const row = TOTAL_NOTES - 1 - note.pitch;
                const isSelected = selectedNoteIds.has(note.id);
                const isDeleting = deletingNoteIds.has(note.id);
                const velocityAlpha = 0.4 + (note.velocity / 127) * 0.6;
                const isNotePlaying = isPlaying && previewActiveNoteIds.has(note.id);
                return (
                  <div
                    key={note.id}
                    className={isDeleting ? 'note-exit' : ''}
                    style={{
                      position: 'absolute',
                      left: note.startTick * tickWidth,
                      top: row * noteHeight + 1,
                      width: Math.max(4, note.duration * tickWidth - 1),
                      height: noteHeight - 2,
                      background: isNotePlaying ? '#ffffff' : accentColor,
                      opacity: isNotePlaying ? 1 : velocityAlpha,
                      borderRadius: elementShape === 'square' ? 0 : elementShape === 'circular' ? 9999 : 3,
                      border: isSelected ? '1.5px solid #fff' : isNotePlaying ? '1.5px solid #ffffff' : `1px solid ${accentColor}`,
                      cursor: 'grab',
                      zIndex: isNotePlaying ? 15 : isSelected ? 10 : 2,
                      display: 'flex', alignItems: 'center',
                      overflow: 'hidden',
                      boxShadow: isNotePlaying
                        ? `0 0 10px ${accentColor}, 0 0 20px ${accentColor}80`
                        : isSelected ? `0 0 8px ${accentColor}80` : 'none',
                      transition: 'background 0.04s, opacity 0.04s, box-shadow 0.04s',
                      transformOrigin: 'center',
                    }}
                    onPointerDown={e => {
                      // Right-click on note: erase it with animation
                      if (e.button === 2) {
                        e.stopPropagation();
                        e.preventDefault();
                        const noteId = note.id;
                        setDeletingNoteIds(prev => new Set([...prev, noteId]));
                        setTimeout(() => {
                          setNotes(prev => {
                            const newNotes = prev.filter(n => n.id !== noteId);
                            pushHistory(newNotes);
                            return newNotes;
                          });
                          setDeletingNoteIds(prev => { const next = new Set(prev); next.delete(noteId); return next; });
                          setSelectedNoteIds(prev => { const next = new Set(prev); next.delete(noteId); return next; });
                        }, 200);
                        return;
                      }
                      e.stopPropagation();
                      if (e.shiftKey) {
                        setSelectedNoteIds(prev => {
                          const next = new Set(prev);
                          if (next.has(note.id)) next.delete(note.id);
                          else next.add(note.id);
                          return next;
                        });
                      } else if (!selectedNoteIds.has(note.id)) {
                        setSelectedNoteIds(new Set([note.id]));
                      }
                      startNoteDrag(e, note.id, 'move');
                    }}
                    onContextMenu={e => e.preventDefault()}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      const newNotes = notesRef.current.filter(n => n.id !== note.id);
                      setNotes(newNotes);
                      pushHistory(newNotes);
                      setSelectedNoteIds(prev => { const next = new Set(prev); next.delete(note.id); return next; });
                    }}
                  >
                    <span style={{
                      fontSize: '0.5rem', fontWeight: 700, paddingLeft: 3,
                      color: 'rgba(0,0,0,0.7)', whiteSpace: 'nowrap', pointerEvents: 'none',
                    }}>
                      {note.duration * tickWidth > 30 ? getNoteLabel(note.pitch) : ''}
                    </span>

                    <div
                      style={{
                        position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
                        cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)',
                        borderRadius: '0 3px 3px 0',
                      }}
                      onPointerDown={e => {
                        e.stopPropagation();
                        startNoteDrag(e, note.id, 'resize');
                      }}
                    />
                  </div>
                );
              })}

              {/* Rubber-band selection rectangle */}
              {rubberBand && (
                <div style={{
                  position: 'absolute',
                  left: rubberBand.x, top: rubberBand.y,
                  width: rubberBand.w, height: rubberBand.h,
                  border: `1px solid ${accentColor}`,
                  background: `${accentColor}15`,
                  pointerEvents: 'none',
                  zIndex: 50, borderRadius: 2,
                }} />
              )}

              {/* Playhead — no transition so it teleports back to start on loop */}
              {isPlaying && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: playheadTick * tickWidth,
                  width: 2,
                  background: '#ffffff',
                  boxShadow: '0 0 8px rgba(255,255,255,0.5)',
                  zIndex: 20,
                  pointerEvents: 'none',
                }} />
              )}
            </div>
          </div>
        </div>

        {/* ── Velocity Editor Strip ───────────────────────────────── */}
        <div style={{
          height: VELOCITY_HEIGHT + 24, flexShrink: 0,
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-base)', display: 'flex',
        }}>
          <div style={{ width: PIANO_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              Velocity
            </span>
          </div>
          <div style={{
            flex: 1, overflow: 'hidden', position: 'relative',
            padding: '12px 0',
          }}>
            <div style={{
              position: 'absolute', left: -scrollLeft, bottom: 12, height: VELOCITY_HEIGHT,
              width: gridWidth,
            }}>
              {notes.map(note => {
                const ratio = note.velocity / 127;
                const isSelected = selectedNoteIds.has(note.id);
                return (
                  <div
                    key={`vel-${note.id}`}
                    style={{
                      position: 'absolute',
                      left: note.startTick * tickWidth,
                      bottom: 0,
                      width: Math.max(3, note.duration * tickWidth - 2),
                      height: `${ratio * 100}%`,
                      background: isSelected ? '#fff' : accentColor,
                      opacity: isSelected ? 1 : 0.6,
                      borderRadius: '2px 2px 0 0',
                      cursor: 'ns-resize',
                    }}
                    onPointerDown={e => handleVelocityDrag(e, note.id)}
                  />
                );
              })}
            </div>
            {[0.25, 0.5, 0.75, 1].map(ratio => (
              <div key={ratio} style={{
                position: 'absolute', left: 0, right: 0,
                bottom: 12 + ratio * VELOCITY_HEIGHT,
                height: 1,
                background: 'rgba(255,255,255,0.05)',
                pointerEvents: 'none',
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PianoRollEditor;
