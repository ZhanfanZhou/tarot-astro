import '@testing-library/jest-dom/vitest';

// jsdom 没有 ResizeObserver（抽牌器用它量舞台高度）——给个空壳,别让组件挂不上
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
