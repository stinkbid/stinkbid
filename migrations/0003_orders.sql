-- Signed stink bids. The signature is the order: whoever holds it can fill it on-chain, within its terms only.
-- Amounts are decimal strings of base units (USDG 6 decimals, stock tokens 18).
CREATE TABLE orders (
  id             TEXT    PRIMARY KEY,          -- lower(maker):nonce, unique because Permit2 nonces are per owner
  maker          TEXT    NOT NULL,
  symbol         TEXT    NOT NULL,
  token_out      TEXT    NOT NULL,
  path           TEXT    NOT NULL,
  amount_in      TEXT    NOT NULL,
  min_amount_out TEXT    NOT NULL,
  nonce          TEXT    NOT NULL,
  deadline       INTEGER NOT NULL,
  signature      TEXT    NOT NULL,
  depth_bps      INTEGER NOT NULL,             -- depth under the quote at signing time
  ref_amount_out TEXT    NOT NULL,             -- that quote
  status         TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
  note           TEXT,                         -- why an open order cannot fill right now (unfunded, no_allowance)
  last_quote     TEXT,
  last_checked_at INTEGER,
  fill_tx        TEXT,
  amount_out     TEXT,
  filled_by      TEXT,
  closed_at      INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX orders_status ON orders (status, created_at);
CREATE INDEX orders_maker ON orders (maker, created_at);

-- One row per keeper run, so /status can show what the keeper actually did. Swept after 3 days.
CREATE TABLE keeper_runs (
  id          INTEGER PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  mode        TEXT    NOT NULL,                -- live | watch | waiting_for_contract
  block       INTEGER,
  checked     INTEGER NOT NULL DEFAULT 0,
  fillable    INTEGER NOT NULL DEFAULT 0,
  filled      INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX keeper_runs_started ON keeper_runs (started_at);
