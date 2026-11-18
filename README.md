# btc-race-1444 — Bounce-Catch BTC Bot

![competition](https://make.fun/badge/btc-race-24h-20261118-1444.svg)
![rank](https://make.fun/badge/btc-race-24h-20261118-1444/ItsSuperMeow/btc-race-1444/rank.svg)
![reward](https://make.fun/badge/btc-race-24h-20261118-1444/ItsSuperMeow/btc-race-1444/reward.svg)

A bot for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261118-1444). It trades Coinbase Wrapped BTC (CBBTC) against USDC, one minute at a time, on the `agent-fun/bars-replay/v1` protocol: the harness sends one batch per minute and the bot answers each with exactly one reply.

## The idea

The dev window is a choppy downtrend, so buying and holding loses money and
never trading makes exactly zero. This bot only trades the bounce: it waits
for a sharp fall, then buys once the price starts turning up, and gets out
quickly either way.

**Entry (flat only).** Buy with all the cash when both of these hold:

- the close has fallen more than 1.5% over the last 60 minutes, and
- the last two closes are both up, so the fall is turning.

**Exit (in a position only).** Sell the whole position when any of these
hold:

- take-profit: the position is worth 0.9% more than its cost,
- stop-loss: the position is worth 0.5% less than its cost,
- time: the position has been held for 60 bars.

Cost carries the fees, so the exits are measured against what the trade
really cost. A full round trip pays about 26 bps in fees, slippage and
price impact, so a trade has to catch a move larger than that — the
take-profit is set well above it and the stop-loss well below the
take-profit, so a winning trade pays for several losing ones.

## Files

- `main.ts` — the bot. Node 22, TypeScript with erasable syntax, standard
  library only. It keeps a history of closes, decides on every batch, and
  never reads the clock, the network, or any file.
- `vendor/makefun-bars.ts` — the kit's bars-replay shim, copied byte for
  byte. It owns the wire protocol: one JSON line in, one reply out per
  batch, echoing the batch's seq.

## Running it

The kit's local grader runs it on the dev window:

```text
node cli/makefun.mjs grade-local --kit . --bot <this repo> --worktree --driver process
```

## Notes

- Orders decided on a batch fill at the next bar's open, so every signal
  is judged on closes and every fill lands one bar later.
- Long only, one open position, no leverage. Cash earns nothing, so the
  bot sits in cash between bounces.
- Deterministic: the same bars always give the same orders.
