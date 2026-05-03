import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver (used by cmdk and other UI libs)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement scrollIntoView (used by cmdk)
Element.prototype.scrollIntoView ??= () => {};
