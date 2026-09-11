import { describe, expect, it } from 'vitest';
import { maskDocument, maskEmail, maskPhone } from './mask';

describe('mascaramento de contato', () => {
  it('telefone mantém DDD e final', () => {
    expect(maskPhone('+5511987654321')).toBe('(11) •••••-4321');
    expect(maskPhone('+552134567890')).toBe('(21) ••••-7890');
    expect(maskPhone(null)).toBeNull();
  });

  it('documento mantém só os 2 últimos dígitos', () => {
    expect(maskDocument('52998224725')).toBe('•••.•••.•••-25');
    expect(maskDocument('11222333000181')).toBe('••.•••.•••/••••-81');
    expect(maskDocument('52998224725')).not.toContain('529');
  });

  it('e-mail mantém a primeira letra e o domínio', () => {
    expect(maskEmail('joao.silva@gmail.com')).toBe('j•••@gmail.com');
  });
});
