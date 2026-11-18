// Bounce-catch bot for the BTC race: buy the dip after a sharp 60-minute fall
// once the last two closes turn up, then exit on a take-profit, a stop-loss,
// or a time limit. Long only, one position, full size, deterministic.
//
// How it works, bar by bar (agent-fun/bars-replay/v1, one batch per minute):
//   - Every batch carries the bar that just closed, the fills of the orders
//     decided on the previous batch, and the account. The bot answers every
//     batch with exactly one reply echoing its seq.
//   - An order decided on a batch fills at the next bar's open, so every
//     signal is judged on closes and every fill lands one bar later.
//   - Entry (flat only): the close has fallen more than DROP_BPS over the
//     last LOOKBACK_MS, and the last two closes are both up, which says the
//     fall is turning. Buy with all the cash.
//   - Exit (in a position only): sell everything when the position is up
//     TAKE_PROFIT_BPS over its cost, down STOP_LOSS_BPS under its cost, or
//     held for MAX_HOLD_BARS bars. Cost carries the fees, so the exits are
//     measured against what the trade really cost.
//   - No randomness, no wall clock, no network, no files: the same bars
//     always give the same orders.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Entry: a fall of more than 1.5% over the last 60 minutes, confirmed by
// the last two closes both rising.
const DROP_BPS = 150n;
const LOOKBACK_MS = 60 * 60_000;
const CONFIRM_BARS = 2;

// Exit: +0.9% take-profit, -0.5% stop-loss, or 60 bars held.
const TAKE_PROFIT_BPS = 90n;
const STOP_LOSS_BPS = 50n;
const MAX_HOLD_BARS = 60;

// Slippage allowance from the latest close, in bps. Buys may fill a little
// above the close; sells are given more room so an exit is not refused.
const BUY_SLIPPAGE_BPS = 200;
const SELL_SLIPPAGE_BPS = 300;

const BPS = 10_000n;

// Closes seen so far, oldest first. A bar can be absent from a batch, so
// the lookback is found by time, not by counting bars.
const closes: { t: number; c: bigint }[] = [];

// Seq of the batch where the current position first showed up in the
// account (-1 while flat). Counts the holding time for the time exit.
let entrySeq = -1;

function closeAtOrBefore(targetMs: number): bigint | null {
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i]!.t <= targetMs) return closes[i]!.c;
  }
  return null;
}

function risingCloses(count: number): boolean {
  if (closes.length < count + 1) return false;
  for (let i = 0; i < count; i++) {
    const now = closes[closes.length - 1 - i]!;
    const prev = closes[closes.length - 2 - i]!;
    if (now.c <= prev.c) return false;
  }
  return true;
}

function decide(state: BarsState): OrderInput[] {
  if (state.warmingUp) return [];

  const bar = state.latest.get(SYMBOL);
  if (bar !== undefined) {
    const last = closes[closes.length - 1];
    if (last === undefined || last.t !== bar.t) {
      closes.push({ t: bar.t, c: BigInt(bar.c) });
    }
  }

  const position = state.positions.get(SYMBOL);
  const qty = position?.qty ?? 0n;

  if (qty > 0n) {
    const cost = position!.cost;
    const value = state.value(SYMBOL, qty);
    if (entrySeq < 0) entrySeq = state.seq;

    // Take-profit: the position is worth TAKE_PROFIT_BPS over its cost.
    if (value * BPS >= cost * (BPS + TAKE_PROFIT_BPS)) {
      entrySeq = -1;
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SELL_SLIPPAGE_BPS }];
    }
    // Stop-loss: the position is worth STOP_LOSS_BPS under its cost.
    if (value * BPS <= cost * (BPS - STOP_LOSS_BPS)) {
      entrySeq = -1;
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SELL_SLIPPAGE_BPS }];
    }
    // Time exit: held for MAX_HOLD_BARS bars.
    if (state.seq - entrySeq >= MAX_HOLD_BARS) {
      entrySeq = -1;
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SELL_SLIPPAGE_BPS }];
    }
    return [];
  }

  entrySeq = -1;

  // Flat: look for the bounce. Need the last two closes up and a fall of
  // more than DROP_BPS over the last LOOKBACK_MS.
  if (!risingCloses(CONFIRM_BARS)) return [];
  const now = closes[closes.length - 1]!;
  const base = closeAtOrBefore(now.t - LOOKBACK_MS);
  if (base === null || base === 0n) return [];
  const dropBps = ((base - now.c) * BPS) / base;
  if (dropBps <= DROP_BPS) return [];

  // Full size: spend all the cash. A buy's fee is inside its notional, so
  // spending the whole cash balance is a valid order.
  if (state.cash <= 0n) return [];
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: BUY_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    return decide(state);
  },
});
