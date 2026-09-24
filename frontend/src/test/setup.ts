import '@testing-library/jest-dom/vitest';

// jsdom 没有 ResizeObserver（抽牌器用它量舞台高度）——给个空壳,别让组件挂不上
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom 的 matchMedia 不能用（揭牌幕靠它认窄屏）——按 innerWidth 给个最小实现,
// 测试里改 window.innerWidth 就能切到手机那套排布
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? window.innerWidth <= Number(max[1]) : false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

// jsdom 没有 scrollIntoView（日签等解读时把舞台滚进视野）
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
