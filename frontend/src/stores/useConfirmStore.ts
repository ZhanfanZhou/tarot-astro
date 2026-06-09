import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmState {
  request: (ConfirmOptions & { id: number }) | null;
  resolver: ((v: boolean) => void) | null;
  open: (o: ConfirmOptions) => Promise<boolean>;
  resolve: (v: boolean) => void;
}

let seq = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  resolver: null,
  open: (o) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is already open, resolve it false before replacing.
      const prev = get().resolver;
      if (prev) prev(false);
      set({ request: { ...o, id: ++seq }, resolver: resolve });
    }),
  resolve: (v) => {
    const { resolver } = get();
    if (resolver) resolver(v);
    set({ request: null, resolver: null });
  },
}));

/** Promise-based confirm — replaces window.confirm(). */
export const confirmDialog = (o: ConfirmOptions) => useConfirmStore.getState().open(o);
