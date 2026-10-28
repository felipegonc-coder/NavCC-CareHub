-- Notices, part 3: up to 3 cards under a notice (SendNoticeInput.cards). `card` keeps the first,
-- so every notice sent before reads as it did; `extra_cards` holds the second and third, in order.

ALTER TABLE notices_notices
  ADD COLUMN extra_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT notices_notices_extra_cards_check CHECK (
    CASE
      WHEN jsonb_typeof(extra_cards) = 'array' THEN jsonb_array_length(extra_cards) <= 2
      ELSE false
    END
  ),
  -- More cards only after a first one.
  ADD CONSTRAINT notices_notices_extra_cards_first_check
    CHECK (card IS NOT NULL OR extra_cards = '[]'::jsonb);
