import React, { useRef, useCallback, useState, useEffect } from 'react';
import { CanvasElement, FaderElement } from './types';
import { useMidi } from './MidiContext';
import { getContrastColor } from './lib/colorUtils';

export type ThemeStyle = 'filled' | 'wireframe' | 'frost' | 'tinted_frost' | 'tinted';

interface ButtonCanvasProps {
  mode: 'perform' | 'edit';
  macros: CanvasElement[];
  setMacrosLive: (fn: (prev: CanvasElement[]) => CanvasElement[]) => void;
  commitSnapshot: (before: CanvasElement[]) => void;
  selectedMacroId: string | null;
  onSelectMacro: (id: string | null) => void;
  theme: ThemeStyle;
  accentColor: string;
  glowAmount: number;
  snapToGrid: boolean;
  gridSize: number;
  gridOpacity: number;
  showGrid?: boolean;
  colorMode: 'dark' | 'light';
}

const MIN_WIDTH = 60;
const MIN_HEIGHT = 50;
const REF_W = 1000;
const REF_H = 700;

const ButtonCanvas: React.FC<ButtonCanvasProps> = ({
  mode, macros, setMacrosLive, commitSnapshot, selectedMacroId, onSelectMacro, theme, accentColor, glowAmount, snapToGrid, gridSize, gridOpacity, showGrid, colorMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { triggerElement, triggerFaderGlide, sendCC } = useMidi();
  const [heldIds, setHeldIds] = useState<Set<string>>(new Set());
  const isDragging = useRef(false);
  const isFaderDragging = useRef(false);
  const [isCanvasDragging, setIsCanvasDragging] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ─── Multi-select state ─────────────────────────────────────────────────
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Clear multi-select when switching modes
  useEffect(() => {
    if (mode === 'perform') setMultiSelected(new Set());
  }, [mode]);

  // ─── Grid snap helper ──────────────────────────────────────────────────
  const snap = useCallback((v: number) => {
    if (!snapToGrid || gridSize <= 0) return v;
    return Math.round(v / gridSize) * gridSize;
  }, [snapToGrid, gridSize]);

  // ─── Container size tracking ────────────────────────────────────────────
  const [containerSize, setContainerSize] = useState({ w: REF_W, h: REF_H });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ w: width, h: height });
        }
      }
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerSize({ w: rect.width, h: rect.height });
    }
    return () => obs.disconnect();
  }, []);

  const rawSx = containerSize.w / REF_W;
  const rawSy = containerSize.h / REF_H;
  const sx = Math.min(rawSx, rawSy);
  const sy = sx;

  // ─── Drag handler (edit mode, supports group drag) ─────────────────────
  const startDrag = (e: React.PointerEvent, elId: string) => {
    if (mode !== 'edit') return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    // Determine which elements to drag
    const isInMultiSelect = multiSelected.has(elId);
    const dragIds = isInMultiSelect && multiSelected.size > 1
      ? Array.from(multiSelected)
      : [elId];

    // Capture original positions
    const origPositions = new Map<string, { x: number; y: number }>();
    macros.forEach(m => {
      if (dragIds.includes(m.id)) {
        origPositions.set(m.id, { x: m.x, y: m.y });
      }
    });

    isDragging.current = false;
    setIsCanvasDragging(true);
    const beforeSnapshot = JSON.parse(JSON.stringify(macros));

    const onMove = (moveEvt: PointerEvent) => {
      isDragging.current = true;
      const dx = (moveEvt.clientX - startX) / sx;
      const dy = (moveEvt.clientY - startY) / sy;

      setMacrosLive(prev => prev.map(m => {
        const orig = origPositions.get(m.id);
        if (!orig) return m;
        return { ...m, x: snap(orig.x + dx), y: snap(orig.y + dy) };
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (isDragging.current) {
        commitSnapshot(beforeSnapshot);
      }
      setIsCanvasDragging(false);
      if (!isDragging.current) {
        // Click without drag: select this element (clear multi-select)
        onSelectMacro(elId);
        setMultiSelected(new Set());
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Rubber-band selection (edit mode, empty canvas drag) ──────────────
  const startRubberBand = (e: React.PointerEvent) => {
    if (mode !== 'edit') return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const originX = e.clientX - containerRect.left;
    const originY = e.clientY - containerRect.top;

    const onMove = (moveEvt: PointerEvent) => {
      const curX = moveEvt.clientX - containerRect.left;
      const curY = moveEvt.clientY - containerRect.top;
      const x = Math.min(originX, curX);
      const y = Math.min(originY, curY);
      const w = Math.abs(curX - originX);
      const h = Math.abs(curY - originY);
      setSelectionRect({ x, y, w, h });

      // Find elements inside the rect (in screen space)
      const selected = new Set<string>();
      macros.forEach(el => {
        const elLeft = el.x * sx;
        const elTop = el.y * sy;
        const elRight = elLeft + el.width * sx;
        const elBottom = elTop + el.height * sy;
        // Check overlap
        if (elRight > x && elLeft < x + w && elBottom > y && elTop < y + h) {
          selected.add(el.id);
        }
      });
      setMultiSelected(selected);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSelectionRect(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Resize handler ────────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent, elId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const el = macros.find(m => m.id === elId);
    if (!el) return;
    const startW = el.width;
    const startH = el.height;
    setIsCanvasDragging(true);
    const beforeSnapshot = JSON.parse(JSON.stringify(macros));

    const onMove = (moveEvt: PointerEvent) => {
      const dx = (moveEvt.clientX - startX) / sx;
      const dy = (moveEvt.clientY - startY) / sy;
      const newW = snap(Math.max(MIN_WIDTH, startW + dx));
      const newH = snap(Math.max(MIN_HEIGHT, startH + dy));
      setMacrosLive(prev => prev.map(m =>
        m.id === elId ? { ...m, width: newW, height: newH } : m
      ));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setIsCanvasDragging(false);
      commitSnapshot(beforeSnapshot);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Fader drag (perform mode) ─────────────────────────────────────────
  const startFaderDrag = (e: React.PointerEvent, fader: CanvasElement) => {
    if (fader.type !== 'fader') return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const trackHeight = rect.height - 20;

    const updateValue = (clientY: number) => {
      const relY = Math.max(0, Math.min(trackHeight, rect.bottom - 10 - clientY));
      const ratio = relY / trackHeight;
      const value = Math.round(fader.minValue + ratio * (fader.maxValue - fader.minValue));
      const clamped = Math.max(fader.minValue, Math.min(fader.maxValue, value));

      setMacrosLive(prev => prev.map(m =>
        m.id === fader.id && m.type === 'fader' ? { ...m, currentValue: clamped } : m
      ));
      sendCC(fader.cc, clamped);
    };

    updateValue(e.clientY);
    setHeldIds(prev => new Set(prev).add(fader.id));
    isFaderDragging.current = true;

    const onMove = (moveEvt: PointerEvent) => updateValue(moveEvt.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setHeldIds(prev => { const next = new Set(prev); next.delete(fader.id); return next; });
      isFaderDragging.current = false;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Trigger elements ──────────────────────────────────────────────────
  const executeElement = useCallback((el: CanvasElement) => {
    if (el.type === 'fader') return;
    triggerElement(el);
  }, [triggerElement]);

  const hasRealMessages = (el: CanvasElement) => {
    if (el.type === 'fx_button') return el.messages.some(m => m.fxType >= 0);
    if (el.type === 'free_button') return el.freeMessages.length > 0;
    if (el.type === 'memory_button') return true;
    return false;
  };

  const handlePerformPointerDown = (e: React.PointerEvent, el: CanvasElement) => {
    e.preventDefault();
    if (el.type === 'fader') {
      startFaderDrag(e, el);
      return;
    }
    setHeldIds(prev => new Set(prev).add(el.id));
    if (hasRealMessages(el)) executeElement(el);
  };

  const handlePerformPointerUp = (elId: string) => {
    setHeldIds(prev => { const next = new Set(prev); next.delete(elId); return next; });
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (mode === 'perform') return;
    // Only start rubber-band if clicking empty canvas (not an element)
    if (e.target === containerRef.current) {
      onSelectMacro(null);
      setMultiSelected(new Set());
      startRubberBand(e);
    }
  };

  const handleElementPointerDown = (e: React.PointerEvent, el: CanvasElement) => {
    if (mode === 'perform') handlePerformPointerDown(e, el);
    else startDrag(e, el.id);
  };

  // Keyboard triggers
  React.useEffect(() => {
    const handleTriggerDown = (e: CustomEvent) => {
      const el = macros.find(m => m.id === e.detail);
      if (el && el.type !== 'fader') {
        setHeldIds(prev => new Set(prev).add(el.id));
        if (hasRealMessages(el)) executeElement(el);
      }
    };
    const handleTriggerUp = (e: CustomEvent) => {
      setHeldIds(prev => { const next = new Set(prev); next.delete(e.detail); return next; });
    };
    window.addEventListener('macro-trigger-down', handleTriggerDown as EventListener);
    window.addEventListener('macro-trigger-up', handleTriggerUp as EventListener);

    // Fader keybind triggers
    const handleFaderKeybind = (e: CustomEvent) => {
      const { faderId, bindId } = e.detail;
      const fader = macros.find(m => m.id === faderId);
      if (!fader || fader.type !== 'fader' || !fader.faderKeybinds) return;
      const bind = fader.faderKeybinds.find(b => b.id === bindId);
      if (!bind) return;

      const updateFaderValue = (id: string, value: number) => {
        setMacrosLive(prev => prev.map(m =>
          m.id === id && m.type === 'fader' ? { ...m, currentValue: value } : m
        ));
      };

      triggerFaderGlide(fader as FaderElement, bind, updateFaderValue);
    };
    window.addEventListener('fader-keybind-trigger', handleFaderKeybind as EventListener);

    return () => {
      window.removeEventListener('macro-trigger-down', handleTriggerDown as EventListener);
      window.removeEventListener('macro-trigger-up', handleTriggerUp as EventListener);
      window.removeEventListener('fader-keybind-trigger', handleFaderKeybind as EventListener);
    };
  }, [macros, executeElement, triggerFaderGlide, setMacrosLive]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      onPointerDown={handleCanvasPointerDown}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: containerSize.w / sx,
        height: containerSize.h / sy,
        transform: `scale(${sx}, ${sy})`,
        transformOrigin: 'top left',
        zIndex: 0,
        pointerEvents: 'none'
      }}>
        {/* Grid overlay */}
        {(() => {
          const isVisible = showGrid || (snapToGrid && mode === 'edit');
          const gridColor = colorMode === 'light' ? '0,0,0' : '255,255,255';
          const targetOpacity = isVisible ? (showGrid ? Math.max(0.25, gridOpacity) : gridOpacity) : 0;
          return (
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
              backgroundImage:
                `linear-gradient(to right, rgba(${gridColor}, 1) 1px, transparent 1px),` +
                `linear-gradient(to bottom, rgba(${gridColor}, 1) 1px, transparent 1px)`,
              backgroundSize: `${gridSize}px ${gridSize}px`,
              backgroundPosition: '0 0',
              opacity: targetOpacity,
              transition: 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), background-image 0.4s ease',
            }} />
          );
        })()}
      </div>

      {/* Rubber-band selection rect */}
      {selectionRect && (
        <div style={{
          position: 'absolute',
          left: selectionRect.x,
          top: selectionRect.y,
          width: selectionRect.w,
          height: selectionRect.h,
          border: '1px solid var(--accent-base)',
          backgroundColor: 'rgba(var(--accent-rgb), 0.08)',
          pointerEvents: 'none',
          zIndex: 999,
          borderRadius: 2,
        }} />
      )}

      {macros.map(el => {
        const isSingleSelected = selectedMacroId === el.id;
        const isMultiSelected = multiSelected.has(el.id);
        const isSelected = isSingleSelected || isMultiSelected;
        const isHeld = heldIds.has(el.id);
        const color = el.color || accentColor;
        const isFrost = theme === 'frost';
        const isTintedFrost = theme === 'tinted_frost';
        const isTinted = theme === 'tinted';

        const actualTextColor = el.textColor || (theme === 'filled' ? getContrastColor(color) : color);
        const hasLightText = getContrastColor(actualTextColor) === '#000000';

        const screenX = el.x * sx;
        const screenY = el.y * sy;
        const screenW = el.width * sx;
        const screenH = el.height * sy;

        const isHovered = mode === 'edit' && hoveredId === el.id && !isCanvasDragging && !isFaderDragging.current;

        const transitionStr = (isCanvasDragging || isFaderDragging.current)
          ? 'box-shadow 0.08s ease-out, transform 0.08s ease-out, border 0.1s'
          : 'left 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), border 0.1s';

        // Multi-select highlight
        const borderStyle = isMultiSelected
          ? '2px solid var(--accent-base)'
          : isSingleSelected
            ? '2px solid #fff'
            : `2px solid ${theme === 'filled' ? 'rgba(255,255,255,0.15)' : color}`;

        const faderBg = theme === 'filled' ? 'var(--bg-panel)' : isFrost ? 'rgba(128,128,128,0.15)' : isTintedFrost ? `${color}33` : isTinted ? `${color}1A` : 'transparent';
        const btnBg = theme === 'filled' ? color : isFrost ? 'rgba(128,128,128,0.15)' : isTintedFrost ? `${color}33` : isTinted ? `${color}1A` : 'transparent';
        const backdropFilter = (isFrost || isTintedFrost) ? 'blur(10px)' : 'none';
        
        const shadowStyle = isHeld
          ? `0 0 ${Math.round(24 * glowAmount)}px ${Math.round(8 * glowAmount)}px ${color}, 0 0 ${Math.round(48 * glowAmount)}px ${Math.round(16 * glowAmount)}px ${color}80`
          : isHovered
            ? `0 20px 40px -10px rgba(0,0,0,0.6), 0 0 0 1px ${color}80, 0 0 24px ${color}40, 0 8px 16px ${color}20` // Premium drop shadow + soft unique hover glow
            : (theme === 'wireframe' ? 'none' : 'var(--shadow-sm)');

        const transformValue = isHeld 
          ? 'scale(0.97)' 
          : isHovered 
            ? 'scale(1.02) translateY(-4px)' 
            : 'scale(1) translateY(0)';

        if (el.type === 'fader') {
          const ratio = el.maxValue > el.minValue
            ? (el.currentValue - el.minValue) / (el.maxValue - el.minValue)
            : 0;

          return (
            <div
              key={el.id}
              id={`macro-btn-${el.id}`}
              onPointerDown={(e) => handleElementPointerDown(e, el)}
              onPointerEnter={() => setHoveredId(el.id)}
              onPointerLeave={() => setHoveredId(prev => prev === el.id ? null : prev)}
              style={{
                position: 'absolute', left: screenX, top: screenY, width: screenW, height: screenH,
                border: borderStyle,
                color: actualTextColor,
                borderRadius: 'var(--radius-md)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 4px',
                cursor: mode === 'edit' ? 'grab' : 'ns-resize',
                userSelect: 'none', touchAction: 'none', pointerEvents: 'auto',
                boxShadow: shadowStyle,
                transition: transitionStr,
                transform: transformValue,
                zIndex: isSelected || isHovered ? 10 : 1,
                overflow: 'hidden',
                WebkitFontSmoothing: 'antialiased',
                transformStyle: 'preserve-3d'
              }}
            >
              {/* Main Fader Base Layer */}
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: faderBg,
                backdropFilter,
                WebkitBackdropFilter: backdropFilter,
                borderRadius: 'inherit',
                zIndex: 0,
                pointerEvents: 'none',
                transform: 'translateZ(-1px)'
              }} />
              {/* Fader Fill Layer */}
              <div style={{
                position: 'absolute',
                left: -2, right: -2, bottom: -2,
                top: ratio >= 0.99 ? -2 : 'auto',
                height: ratio >= 0.99 ? 'auto' : `${ratio * 100}%`,
                background: theme === 'wireframe' ? `${color}30` : color,
                zIndex: 0,
                pointerEvents: 'none',
                transition: 'none' // Removed ease-out transition to allow zero-lag requestAnimationFrame updates
              }} />

              <div style={{ position: 'relative', zIndex: 1, fontSize: '0.65rem', opacity: 0.6, pointerEvents: 'none', transform: 'translateZ(0)' }}>
                {el.maxValue}
              </div>
              <div style={{ position: 'relative', zIndex: 1, fontSize: el.fontSize ? `${el.fontSize}rem` : '0.85rem', fontWeight: 900, pointerEvents: 'none', textShadow: hasLightText ? '0 1px 3px rgba(0,0,0,0.7)' : 'none', transform: 'translateZ(0)' }}>
                {el.currentValue}
              </div>
              <div style={{ position: 'relative', zIndex: 1, fontSize: '0.65rem', opacity: 0.6, pointerEvents: 'none', transform: 'translateZ(0)' }}>
                {el.minValue}
              </div>
              <div style={{ position: 'relative', zIndex: 1, fontSize: '0.7rem', opacity: 0.7, pointerEvents: 'none', marginTop: 2, transform: 'translateZ(0)' }}>
                {el.label}
              </div>

              {mode === 'edit' && isSingleSelected && (
                <div className="resize-handle" onPointerDown={(e) => startResize(e, el.id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="9" y1="1" x2="1" y2="9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
                    <line x1="9" y1="5" x2="5" y2="9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
                  </svg>
                </div>
              )}
            </div>
          );
        }

        // Button rendering (fx_button or free_button)
        return (
          <div
            key={el.id}
            id={`macro-btn-${el.id}`}
            onPointerDown={(e) => handleElementPointerDown(e, el)}
            onPointerUp={() => mode === 'perform' && handlePerformPointerUp(el.id)}
            onPointerEnter={() => setHoveredId(el.id)}
            onPointerLeave={() => {
              if (mode === 'perform') handlePerformPointerUp(el.id);
              setHoveredId(prev => prev === el.id ? null : prev);
            }}
            style={{
              position: 'absolute', left: screenX, top: screenY, width: screenW, height: screenH,
              border: borderStyle,
              color: actualTextColor,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
              cursor: mode === 'edit' ? 'grab' : 'pointer',
              boxShadow: shadowStyle,
              userSelect: 'none', touchAction: 'none', pointerEvents: 'auto',
              transition: transitionStr,
              transform: transformValue,
              zIndex: isSelected || isHovered ? 10 : 1,
              WebkitFontSmoothing: 'antialiased',
              transformStyle: 'preserve-3d'
            }}
          >
            {/* Base Background Layer */}
            <div style={{
              position: 'absolute', inset: 0,
              backgroundColor: btnBg,
              backdropFilter,
              WebkitBackdropFilter: backdropFilter,
              borderRadius: 'inherit',
              zIndex: 0,
              pointerEvents: 'none',
              transform: 'translateZ(-1px)'
            }} />

            <div style={{ 
              position: 'relative', zIndex: 1,
              fontWeight: 800, 
              fontSize: el.fontSize ? `${el.fontSize}rem` : '1rem', 
              textShadow: hasLightText ? '0 2px 4px rgba(0,0,0,0.5)' : 'none', 
              pointerEvents: 'none',
              transform: 'translateZ(0)'
            }}>
              {el.label}
            </div>
            <div style={{ position: 'relative', zIndex: 1, fontSize: '0.75rem', opacity: 0.8, marginTop: 4, pointerEvents: 'none', transform: 'translateZ(0)' }}>
              {el.keybind ? `[${el.keybind.toUpperCase()}]` : 'Unbound'}
            </div>

            {mode === 'edit' && isSingleSelected && (
              <div className="resize-handle" onPointerDown={(e) => startResize(e, el.id)}>
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <line x1="9" y1="1" x2="1" y2="9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
                  <line x1="9" y1="5" x2="5" y2="9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
                </svg>
              </div>
            )}
          </div>
        );
      })}
      {macros.length === 0 && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
          Click "Create" in the toolbar to add your first element.
        </div>
      )}
    </div>
  );
};

export default ButtonCanvas;
