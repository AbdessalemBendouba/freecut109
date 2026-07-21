import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { KeyframeMarqueeOverlay } from '../keyframe-marquee'
import { VerticalScrollbarOverlay } from '@/shared/ui/vertical-scrollbar-overlay'
import { PROPERTY_COLUMN_WIDTH, RULER_HEIGHT } from './dopesheet-constants'
import { DopesheetEmptyState } from './dopesheet-empty-state'

interface DopesheetSheetBodyProps {
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  hasRows: boolean
  emptyStateMessage: string
  showEmptyGuidance: boolean
  proceduralHint?: string
  rowElements: ReactNode
  marqueeOverlayRef: RefObject<HTMLDivElement | null>
  propertyColumnWidth?: number
  subtractRulerHeight?: boolean
  onTimelineBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function DopesheetSheetBody({
  scrollAreaRef,
  hasRows,
  emptyStateMessage,
  showEmptyGuidance,
  proceduralHint,
  rowElements,
  marqueeOverlayRef,
  propertyColumnWidth = PROPERTY_COLUMN_WIDTH,
  subtractRulerHeight = true,
  onTimelineBackgroundPointerDown,
}: DopesheetSheetBodyProps) {
  return (
    <div
      data-testid="dopesheet-scroll-shell"
      className="relative"
      style={{
        height: subtractRulerHeight ? `calc(100% - ${RULER_HEIGHT}px)` : '100%',
      }}
    >
      <div
        ref={scrollAreaRef}
        data-testid="dopesheet-scroll-area"
        data-dopesheet-scroll-viewport
        className={
          subtractRulerHeight ? 'absolute inset-y-0 left-0 overflow-auto' : 'overflow-hidden'
        }
        style={{
          right: subtractRulerHeight ? 12 : 0,
          height: subtractRulerHeight ? undefined : '100%',
          scrollbarWidth: subtractRulerHeight ? 'none' : undefined,
        }}
      >
        {!hasRows ? (
          <DopesheetEmptyState
            showGuidance={showEmptyGuidance}
            fallbackMessage={emptyStateMessage}
            proceduralHint={proceduralHint}
          />
        ) : (
          <div className="relative min-h-full">
            <div
              data-testid="dopesheet-selection-surface"
              className="absolute inset-y-0 right-0 z-0"
              style={{ left: propertyColumnWidth }}
              onPointerDown={onTimelineBackgroundPointerDown}
            />
            <div className="relative z-10">{rowElements}</div>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-20"
              style={{ left: propertyColumnWidth }}
            >
              <KeyframeMarqueeOverlay ref={marqueeOverlayRef} rect={null} persistent />
            </div>
          </div>
        )}
      </div>
      {subtractRulerHeight ? (
        <VerticalScrollbarOverlay
          scrollRef={scrollAreaRef}
          ariaLabel="Keyframe timeline scrollbar"
          className="absolute inset-y-0 right-0 w-3 bg-background/80"
          testId="dopesheet-scrollbar"
        />
      ) : null}
    </div>
  )
}
