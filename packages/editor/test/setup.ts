// jsdom has no layout. ProseMirror only needs these to exist. Node-environment tests skip them.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof document !== 'undefined') {
  const emptyRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const noRects = (): DOMRectList =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;

  Range.prototype.getBoundingClientRect = emptyRect;
  Range.prototype.getClientRects = noRects;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
