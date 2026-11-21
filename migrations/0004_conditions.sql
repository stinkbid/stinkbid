-- Conditions on when an order may fill. The contract only enforces the signed minimum; these decide when the
-- keeper fills and when /api/orders/open publishes the signature (active = 1).
ALTER TABLE orders ADD COLUMN fill_on TEXT NOT NULL DEFAULT 'pool';      -- pool | oracle (official price must confirm the drop)
ALTER TABLE orders ADD COLUMN oracle_level TEXT;                          -- Chainlink price, 8 decimals, at or under which an oracle order is active
ALTER TABLE orders ADD COLUMN session TEXT NOT NULL DEFAULT 'any';        -- any | closed (only outside the US regular session)
ALTER TABLE orders ADD COLUMN ladder TEXT;                                -- shared id for the rungs of one ladder
ALTER TABLE orders ADD COLUMN active INTEGER NOT NULL DEFAULT 1;         -- conditions met right now
