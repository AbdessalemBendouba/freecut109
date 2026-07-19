import { useLayoutEffect, useRef } from 'react'
import type {
  MotionPickWhipOverlaySnapshot,
  MotionPickWhipPresentation,
} from '@/shared/hooks/use-pick-whip-drag'

function getOverlayGeometry(drag: MotionPickWhipOverlaySnapshot) {
  const controlDistance = Math.max(48, Math.abs(drag.currentX - drag.startX) * 0.45)
  return {
    color: drag.valid ? 'rgb(251 146 60)' : 'rgb(148 163 184)',
    clipWidth: Math.max(0, drag.clipBounds.right - drag.clipBounds.left),
    clipHeight: Math.max(0, drag.clipBounds.bottom - drag.clipBounds.top),
    path: `M ${drag.startX} ${drag.startY} C ${drag.startX + controlDistance} ${drag.startY}, ${drag.currentX - controlDistance} ${drag.currentY}, ${drag.currentX} ${drag.currentY}`,
  }
}

export function PickWhipOverlay({
  presentation,
  testId,
}: {
  presentation: MotionPickWhipPresentation
  testId: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)
  const initialDrag = presentation.current
  const initialGeometry = getOverlayGeometry(initialDrag)

  useLayoutEffect(
    () =>
      presentation.subscribe((drag) => {
        const svg = svgRef.current
        const path = pathRef.current
        const circle = circleRef.current
        if (!svg || !path || !circle) return
        const geometry = getOverlayGeometry(drag)
        svg.setAttribute(
          'viewBox',
          `${drag.clipBounds.left} ${drag.clipBounds.top} ${geometry.clipWidth} ${geometry.clipHeight}`,
        )
        svg.style.left = `${drag.clipBounds.left}px`
        svg.style.top = `${drag.clipBounds.top}px`
        svg.style.width = `${geometry.clipWidth}px`
        svg.style.height = `${geometry.clipHeight}px`
        path.setAttribute('d', geometry.path)
        path.setAttribute('stroke', geometry.color)
        if (drag.valid) path.removeAttribute('stroke-dasharray')
        else path.setAttribute('stroke-dasharray', '4 4')
        circle.setAttribute('cx', String(drag.currentX))
        circle.setAttribute('cy', String(drag.currentY))
        circle.setAttribute('fill', geometry.color)
      }),
    [presentation],
  )

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none fixed z-[100] overflow-hidden"
      aria-hidden="true"
      data-testid={testId}
      viewBox={`${initialDrag.clipBounds.left} ${initialDrag.clipBounds.top} ${initialGeometry.clipWidth} ${initialGeometry.clipHeight}`}
      style={{
        left: initialDrag.clipBounds.left,
        top: initialDrag.clipBounds.top,
        width: initialGeometry.clipWidth,
        height: initialGeometry.clipHeight,
      }}
    >
      <path
        ref={pathRef}
        d={initialGeometry.path}
        fill="none"
        stroke={initialGeometry.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={initialDrag.valid ? undefined : '4 4'}
      />
      <circle
        ref={circleRef}
        cx={initialDrag.currentX}
        cy={initialDrag.currentY}
        r="4"
        fill={initialGeometry.color}
      />
    </svg>
  )
}
