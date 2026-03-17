import { useEffect, useCallback, useRef, useState } from 'react'
import { instance } from '@viz-js/viz'
import { getGraph } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import { ErrorBanner } from './ErrorBanner'
import type { PipelineEvent } from '../api/types'

// ---------------------------------------------------------------------------
// GraphPane component — renders pipeline graph via WASM Graphviz
// ---------------------------------------------------------------------------

export function GraphPane() {
  const { activePipelineId, events, selectNode } = usePipelineStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgContent, setSvgContent] = useState<string>('')
  const [renderError, setRenderError] = useState<string | null>(null)

  // Fetch DOT source and render SVG using @viz-js/viz
  const renderDot = useCallback(async (pipelineId: string) => {
    setRenderError(null)
    const { dot } = await getGraph(pipelineId)
    const viz = await instance()
    const svg = viz.renderString(dot, { format: 'svg' })
    setSvgContent(svg)
  }, [])

  // Apply DOM-based color updates: find node <title> elements and color parent <g>
  const updateNodeColors = useCallback(
    (container: HTMLDivElement, pipelineEvents: PipelineEvent[]) => {
      for (const event of pipelineEvents) {
        let nodeId: string | null = null
        let color: string | null = null

        if (event.event === 'stage_completed') {
          nodeId = event.name
          color = 'green'
        } else if (event.event === 'stage_started') {
          nodeId = event.name
          color = 'yellow'
        } else if (event.event === 'stage_failed') {
          nodeId = event.name
          color = 'red'
        }

        if (nodeId && color) {
          const titles = container.querySelectorAll('title')
          for (const title of titles) {
            if (title.textContent === nodeId) {
              const g = title.closest('g')
              if (g) {
                g.style.fill = color
              }
            }
          }
        }
      }
    },
    [],
  )

  // Effect: fetch and render DOT when activePipelineId changes
  useEffect(() => {
    if (activePipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async setState in promise callbacks is intentional
      renderDot(activePipelineId).catch((err) => {
        setRenderError(err instanceof Error ? err.message : 'Failed to render graph')
      })
    } else {
      setSvgContent('')
      setRenderError(null)
    }
  }, [activePipelineId, renderDot])

  // Effect: apply node color updates when events or rendered SVG content changes
  useEffect(() => {
    if (!containerRef.current || !activePipelineId) return
    const pipelineEvents = events.get(activePipelineId) ?? []
    updateNodeColors(containerRef.current, pipelineEvents)
  }, [events, activePipelineId, updateNodeColors, svgContent])

  // Handle click: find the <g> node element and call selectNode with its title
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element
      const g = target.closest('g')
      if (g) {
        const title = g.querySelector('title')
        if (title?.textContent) {
          selectNode(title.textContent)
        }
      }
    },
    [selectNode],
  )

  if (!activePipelineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Select a pipeline
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col">
      {renderError && (
        <div className="p-2">
          <ErrorBanner message={renderError} variant="error" />
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: svgContent }}
        onClick={handleClick}
      />
    </div>
  )
}
