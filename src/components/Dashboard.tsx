import { Group, Panel, Separator } from 'react-resizable-panels'
import { GraphPane } from './GraphPane'
import { EventStream } from './EventStream'
import { NodeDetails } from './NodeDetails'
import { HumanInteraction } from './HumanInteraction'

// ---------------------------------------------------------------------------
// localStorage helpers for pane persistence
// ---------------------------------------------------------------------------

type Layout = Record<string, number>

const STORAGE_KEY_VERTICAL = 'attractor-panels-vertical'
const STORAGE_KEY_TOP = 'attractor-panels-top'
const STORAGE_KEY_BOTTOM = 'attractor-panels-bottom'

function readLayout(key: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as Layout
  } catch {
    // ignore parse errors
  }
  return undefined
}

function saveLayout(key: string, layout: Layout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout))
  } catch {
    // ignore storage errors
  }
}

export function Dashboard() {
  const verticalLayout = readLayout(STORAGE_KEY_VERTICAL)
  const topLayout = readLayout(STORAGE_KEY_TOP)
  const bottomLayout = readLayout(STORAGE_KEY_BOTTOM)

  return (
    <Group
      orientation="vertical"
      className="flex-1"
      defaultLayout={verticalLayout}
      onLayoutChanged={(layout) => saveLayout(STORAGE_KEY_VERTICAL, layout)}
    >
      {/* Top row: GraphPane (80%) | EventStream (20%) */}
      <Panel defaultSize={80} minSize={10}>
        <Group
          orientation="horizontal"
          defaultLayout={topLayout}
          onLayoutChanged={(layout) => saveLayout(STORAGE_KEY_TOP, layout)}
        >
          <Panel defaultSize={80} minSize={10}>
            <div className="h-full bg-gray-950">
              <GraphPane />
            </div>
          </Panel>
          <Separator className="bg-gray-700 hover:bg-blue-500 w-px" />
          <Panel defaultSize={20} minSize={10}>
            <div className="h-full bg-gray-950">
              <EventStream />
            </div>
          </Panel>
        </Group>
      </Panel>

      {/* Vertical resize handle */}
      <Separator className="bg-gray-700 hover:bg-blue-500 h-px" />

      {/* Bottom row: NodeDetails (80%) | HumanInteraction (20%) */}
      <Panel defaultSize={20} minSize={5}>
        <Group
          orientation="horizontal"
          defaultLayout={bottomLayout}
          onLayoutChanged={(layout) => saveLayout(STORAGE_KEY_BOTTOM, layout)}
        >
          <Panel defaultSize={80} minSize={10}>
            <div className="h-full bg-gray-950">
              <NodeDetails />
            </div>
          </Panel>
          <Separator className="bg-gray-700 hover:bg-blue-500 w-px" />
          <Panel defaultSize={20} minSize={10}>
            <div className="h-full bg-gray-950">
              <HumanInteraction />
            </div>
          </Panel>
        </Group>
      </Panel>
    </Group>
  )
}
