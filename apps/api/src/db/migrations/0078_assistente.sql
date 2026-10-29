-- Assistente com IA (E49): entra no Nitro. Cada pergunta é uma chamada paga ao
-- modelo; o plan-features.test.ts compara esta lista com a do shared.
UPDATE plans SET features = array_append(features, 'assistant')
  WHERE code = 'NITRO' AND NOT ('assistant' = ANY (features));
