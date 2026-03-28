import React, { useEffect, useState, useRef, useCallback } from 'react';

// ─── Step Definitions ────────────────────────────────────────────────────────

interface TutorialStep {
  title: string;
  body: React.ReactNode;
  targetSelector: string | null;
  position?: 'bottom' | 'top' | 'left' | 'right' | 'center';
  clickThrough?: boolean;
  advanceOnClick?: boolean;
  pad?: number; // Optional custom padding for this step's spotlight
}

const STEPS: TutorialStep[] = [
  {
    title: 'Connect Your RC-505mk2',
    body: 'First, connect your Boss RC-505mk2. Click the MIDI button to open MIDI Settings, then select your device as the Input (for clock sync) and Output (to send CC messages).',
    targetSelector: '[data-tutorial="midi-btn"]',
    position: 'bottom',
    clickThrough: true,
  },
  {
    title: 'Create Your First Element',
    body: 'Click the "Add" button to create elements on your canvas. You can place buttons and faders anywhere to build your custom control surface.',
    targetSelector: '[data-tutorial="add-btn"]',
    position: 'bottom',
    clickThrough: true,
    advanceOnClick: true,
  },
  {
    title: 'Element Types',
    body: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
        <div><strong style={{ color: 'var(--accent-base)' }}>FX Button</strong>: Sends FX change commands to specific input/track channels on the RC-505mk2</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Free Button</strong>: Sends any CC/value message for generic MIDI control</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Memory Button</strong>: Triggers memory (patch) changes via Program Change messages</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Fader</strong>: A vertical slider that sends continuous CC values, with optional keybinds and glide</div>
      </div>
    ),
    targetSelector: '.create-dropdown',
    position: 'center',
  },
  {
    title: 'Edit Your Layout',
    body: 'In Edit mode, use this toggle to switch between customising and performing. Click any element to select it and open the Config Panel on the side. Drag elements to reposition them, and use the handle to resize.',
    targetSelector: '[data-tutorial="edit-segment"]',
    position: 'center',
    clickThrough: true,
    pad: 9, // Increased padding to match the container-height of step 5
  },
  {
    title: 'Go Live!',
    body: 'Switch to Perform mode to trigger your elements. Click buttons or use keyboard shortcuts to fire MIDI messages. Drag faders to send live CC values. The toolbar hides away so you can focus on performing.',
    targetSelector: '[data-tutorial="mode-toggle"]',
    position: 'bottom',
    clickThrough: true,
  },
  {
    title: 'Customise Your Workspace',
    body: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
        <div>Open General Settings to personalise LPL505:</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Grid / Free mode</strong> — Snap elements to a grid for precise layouts, or go freeform</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Element Shape</strong> — Choose between Square, Rounded or Circular corners</div>
        <div><strong style={{ color: 'var(--accent-base)' }}>Theme & Colors</strong> — Switch visual styles, accent colors, backgrounds, and glow</div>
      </div>
    ),
    targetSelector: '[data-tutorial="general-btn"]',
    position: 'right',
    clickThrough: true,
  },
  {
    title: 'Save Your Work',
    body: 'Save your layouts as .505fx template files so you can load them anytime. Your current session is also auto-saved, so you\'ll be prompted to continue where you left off next time you open the app.',
    targetSelector: '[data-tutorial="file-btns"]',
    position: 'bottom',
    clickThrough: true,
  },
  {
    title: "You're All Set!",
    body: 'Click the LPL505 logo anytime to find YouTube tutorials, report bugs, view the version number, and access credits. You can also restart this tutorial from there. Enjoy!',
    targetSelector: '[data-tutorial="brand"]',
    position: 'bottom',
    clickThrough: true,
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface TutorialProps {
  step: number;
  onNext: () => void;
  onAdvanceOnly: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface SpotlightPos {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const Tutorial: React.FC<TutorialProps> = ({ step, onNext, onAdvanceOnly, onBack, onSkip }) => {
  const [spotlight, setSpotlight] = useState<SpotlightPos | null>(null);
  const [cardTranslate, setCardTranslate] = useState({ x: 0, y: 0 });
  const [cardVisible, setCardVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  const currentStep = STEPS[step];
  const isFirstStep = step === 0;
  const isLastStep = step === STEPS.length - 1;

  const DEFAULT_PAD = 4;
  const CARD_W = 360;
  const GAP = 16;

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const modal = document.querySelector('.modal');
      const createMenu = document.querySelector('.create-dropdown');
      const isOpen = !!modal || !!createMenu;
      setModalOpen(isOpen);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const measure = useCallback(() => {
    let rect: DOMRect | null = null;
    const stepPad = currentStep.pad !== undefined ? currentStep.pad : DEFAULT_PAD;

    if (currentStep.targetSelector) {
      const selectors = currentStep.targetSelector.split(',').map(s => s.trim());
      const elements = selectors.map(s => document.querySelector(s)).filter((el): el is Element => !!el);

      if (elements.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          minX = Math.min(minX, r.left);
          minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right);
          maxY = Math.max(maxY, r.bottom);
        });

        if (minX !== Infinity) {
          const spotLeft = Math.max(0, minX - stepPad);
          const spotTop = Math.max(0, minY - stepPad);
          const spotRight = Math.min(window.innerWidth, maxX + stepPad);
          const spotBottom = Math.min(window.innerHeight, maxY + stepPad);
          const w = spotRight - spotLeft;
          const h = spotBottom - spotTop;
          if (w > 0 && h > 0) {
            setSpotlight({ cx: spotLeft + w / 2, cy: spotTop + h / 2, w, h });
            rect = { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY } as DOMRect;
          }
        }
      }
    } else {
      setSpotlight(null);
    }

    const posPreference = currentStep.position || 'bottom';
    if (posPreference === 'center' || (!currentStep.targetSelector && !document.querySelector('.modal'))) {
      setCardTranslate({ x: Math.round(window.innerWidth / 2 - CARD_W / 2), y: Math.round(window.innerHeight / 2 - 140) });
    } else {
      const modalEl = document.querySelector('.modal');
      if (modalEl) {
        const mRect = modalEl.getBoundingClientRect();
        const pref = currentStep.position === 'center' ? 'right' : currentStep.position || 'right';
        let top = mRect.top;
        let left = (pref === 'left') ? mRect.left - CARD_W - GAP : mRect.right + GAP;
        if (left + CARD_W > window.innerWidth - 20) left = mRect.left - CARD_W - GAP;
        left = Math.max(20, Math.min(window.innerWidth - CARD_W - 20, left));
        top = Math.max(20, Math.min(window.innerHeight - 320, top));
        setCardTranslate({ x: Math.round(left), y: Math.round(top) });
      } else if (rect) {
        let top = 0; let left = 0;
        if (posPreference === 'bottom') { top = rect.bottom + stepPad + GAP; left = rect.left + rect.width / 2 - CARD_W / 2; }
        else if (posPreference === 'top') { const cardH = cardRef.current?.offsetHeight || 260; top = rect.top - stepPad - GAP - cardH; left = rect.left + rect.width / 2 - CARD_W / 2; }
        else if (posPreference === 'left') { top = rect.top; left = rect.left - stepPad - CARD_W - GAP; }
        else if (posPreference === 'right') { top = rect.top; left = rect.right + stepPad + GAP; }
        left = Math.max(20, Math.min(window.innerWidth - CARD_W - 20, left));
        top = Math.max(20, Math.min(window.innerHeight - 320, top));
        setCardTranslate({ x: Math.round(left), y: Math.round(top) });
      } else {
        setCardTranslate({ x: Math.round(window.innerWidth / 2 - CARD_W / 2), y: Math.round(window.innerHeight / 2 - 140) });
      }
    }
  }, [currentStep]);

  useEffect(() => {
    if (isInitialMount) {
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            measure();
            setIsInitialMount(false);
            setCardVisible(true);
          });
        });
      }, 50);
      return () => clearTimeout(timer);
    } else {
      measure();
    }
  }, [step, measure, isInitialMount]);

  useEffect(() => {
    measure();
  }, [modalOpen, measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  const hasSpotlightTarget = !!currentStep.targetSelector;
  const hasMeasuredSpotlight = spotlight !== null && spotlight.w > 0 && spotlight.h > 0;

  return (
    <div className="tutorial-overlay" style={{ pointerEvents: 'none', opacity: isInitialMount ? 0 : 1 }}>
      {hasSpotlightTarget ? (
        <React.Fragment>
          <div
            className="tutorial-spotlight-hole"
            style={hasMeasuredSpotlight ? {
              width: spotlight!.w,
              height: spotlight!.h,
              transform: `translate3d(${spotlight!.cx - spotlight!.w / 2}px, ${spotlight!.cy - spotlight!.h / 2}px, 0)`,
            } : { opacity: 0 }}
          />
          <div
            className="tutorial-spotlight-ring"
            style={hasMeasuredSpotlight ? {
              position: 'fixed',
              top: 0, left: 0,
              width: spotlight!.w, height: spotlight!.h,
              transform: `translate3d(${spotlight!.cx - spotlight!.w / 2}px, ${spotlight!.cy - spotlight!.h / 2}px, 0)`,
            } : { opacity: 0 }}
          />
        </React.Fragment>
      ) : (
        <div className="tutorial-full-overlay" />
      )}

      {hasMeasuredSpotlight && currentStep.clickThrough && (
        <div
          className="tutorial-click-zone"
          style={{
            width: spotlight!.w,
            height: spotlight!.h,
            transform: `translate3d(${spotlight!.cx - spotlight!.w / 2}px, ${spotlight!.cy - spotlight!.h / 2}px, 0)`,
            pointerEvents: 'auto',
          }}
          onClick={(e) => {
            e.stopPropagation();
            const el = document.querySelector(currentStep.targetSelector!.split(',')[0].trim());
            if (currentStep.advanceOnClick) onAdvanceOnly();
            if (el instanceof HTMLElement) el.click();
          }}
        />
      )}

      <div
        ref={cardRef}
        className={`tutorial-card ${cardVisible ? 'visible' : ''}`}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: CARD_W,
          transform: `translate3d(${cardTranslate.x}px, ${cardTranslate.y}px, 0)`,
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tutorial-card-header">
          <span className="tutorial-step-label">Step {step + 1} of {STEPS.length}</span>
          <button className="tutorial-skip" onClick={onSkip}>Skip Tutorial</button>
        </div>

        <div key={step} className="tutorial-content-animate">
          <h3 className="tutorial-title">{currentStep.title}</h3>
          <div className="tutorial-body">{currentStep.body}</div>
        </div>

        <div className="tutorial-dots">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`tutorial-dot ${i === step ? 'active' : i < step ? 'completed' : ''}`}
            />
          ))}
        </div>

        <div className="tutorial-nav">
          {!isFirstStep && (
            <button className="btn" onClick={onBack} style={{ flex: 1 }}>
              Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={onNext}
            style={{ flex: isFirstStep ? undefined : 1, minWidth: isFirstStep ? 120 : undefined }}
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
export { STEPS };
