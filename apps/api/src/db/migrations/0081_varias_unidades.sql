-- Várias unidades (E50): sai do "em desenvolvimento" e entra no Nitro. O
-- plan-features.test.ts compara esta lista com a do shared.
UPDATE plans SET features = array_append(features, 'multi_branch')
  WHERE code = 'NITRO' AND NOT ('multi_branch' = ANY (features));
