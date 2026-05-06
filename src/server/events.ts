/**
 * ── src/server/events.ts ────────────────────────────────
 * CHANGES:
 *  1. Added requestConfirm() — emits confirm_required SSE event and returns
 *     a Promise<boolean> that resolves when the user approves/denies.
 *  2. Added respondConfirm() — called by /api/confirm to resolve the pending promise.
 *  3. Auto-denies after 30s timeout if user doesn't respond.
 */
import { EventEmitter } from 'events';

class LogStream extends EventEmitter {
  private pendingConfirm: { resolve: (v: boolean) => void } | null = null;

  log(message: string) {
    this.emit('log', message);
  }

  requestConfirm(command: string): Promise<boolean> {
    // Auto-deny any previously pending confirmation
    if (this.pendingConfirm) this.pendingConfirm.resolve(false);

    this.log(JSON.stringify({ type: 'confirm_required', text: command }));

    return new Promise<boolean>((resolve) => {
      this.pendingConfirm = { resolve };
      // Auto-deny after 30 seconds
      setTimeout(() => {
        if (this.pendingConfirm?.resolve === resolve) {
          this.pendingConfirm = null;
          resolve(false);
          this.log(JSON.stringify({ type: 'stderr', text: '[Auto-denied after 30s timeout]' }));
        }
      }, 30_000);
    });
  }

  respondConfirm(approved: boolean) {
    if (this.pendingConfirm) {
      this.pendingConfirm.resolve(approved);
      this.pendingConfirm = null;
    }
  }

  get hasPendingConfirm() {
    return this.pendingConfirm !== null;
  }
}

export const globalLogStream = new LogStream();
