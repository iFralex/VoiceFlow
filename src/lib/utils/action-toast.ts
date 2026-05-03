/**
 * Helpers for surfacing Server Action results as Sonner toasts.
 *
 * Convention: every Server Action that can fail must return one of:
 *   { ok: true }
 *   { ok: true; message: string }
 *   { ok: false; message: string }
 *
 * Client components call `toastResult(result)` after awaiting the action.
 */
import { toast } from 'sonner';

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

/**
 * Shows a success or error toast based on the action result shape.
 * Returns the result unchanged so callers can chain additional logic.
 */
export function toastResult(
  result: ActionResult,
  successMessage?: string,
): ActionResult {
  if (result.ok) {
    toast.success(successMessage ?? result.message ?? 'Operazione completata');
  } else {
    toast.error(result.message);
  }
  return result;
}
