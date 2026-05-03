import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toastResult } from '@/lib/utils/action-toast';

// vi.mock is hoisted by Vitest so this runs before imports regardless of position
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('toastResult', () => {
  it('shows a success toast for ok:true result without message', () => {
    toastResult({ ok: true });
    expect(toast.success).toHaveBeenCalledWith(undefined);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the result message when ok:true has a message', () => {
    toastResult({ ok: true, message: 'Contatto eliminato' });
    expect(toast.success).toHaveBeenCalledWith('Contatto eliminato');
  });

  it('prefers the explicit successMessage over result.message', () => {
    toastResult({ ok: true, message: 'result message' }, 'override message');
    expect(toast.success).toHaveBeenCalledWith('override message');
  });

  it('uses successMessage param for ok:true even without result.message', () => {
    toastResult({ ok: true }, 'Saved!');
    expect(toast.success).toHaveBeenCalledWith('Saved!');
  });

  it('shows an error toast for ok:false result', () => {
    toastResult({ ok: false, message: 'Qualcosa è andato storto' });
    expect(toast.error).toHaveBeenCalledWith('Qualcosa è andato storto');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('returns the original result unchanged for ok:true', () => {
    const result = { ok: true as const, message: 'done' };
    const returned = toastResult(result);
    expect(returned).toBe(result);
  });

  it('returns the original result unchanged for ok:false', () => {
    const result = { ok: false as const, message: 'err' };
    const returned = toastResult(result);
    expect(returned).toBe(result);
  });
});
