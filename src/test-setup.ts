import '@testing-library/jest-dom'

// ---------------------------------------------------------------------------
// ResizeObserver mock
//
// jsdom does not implement ResizeObserver.  react-virtuoso uses it internally
// to measure both the scroll container and individual item heights, then
// decides which subset of items to render.
//
// Strategy:
//   • The scroll container is always the FIRST element observed per
//     Virtuoso instance.  We report 600 px for it so Virtuoso has a
//     non-zero viewport to work with.
//   • Every subsequent observed element (individual rows) gets 36 px,
//     giving Virtuoso an item-height estimate of 36 px.
//
// With a 600 px container and 36 px items, Virtuoso renders ≈16 items,
// which is more than enough for the small test data sets used in existing
// tests while still being far less than 10 000 for the virtualization test.
// ---------------------------------------------------------------------------
class ResizeObserverMock {
  private callback: ResizeObserverCallback
  private observeCallCount = 0

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(element: Element) {
    this.observeCallCount++
    // First observed element per instance = the scroll container → 600 px.
    // All subsequent elements = list items → 36 px.
    const height = this.observeCallCount === 1 ? 600 : 36
    const width = 800

    // Call synchronously so the size is available before render completes.
    this.callback(
      [
        {
          target: element,
          contentRect: {
            x: 0,
            y: 0,
            width,
            height,
            top: 0,
            right: width,
            bottom: height,
            left: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [{ inlineSize: width, blockSize: height }],
          contentBoxSize: [{ inlineSize: width, blockSize: height }],
          devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
        },
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
