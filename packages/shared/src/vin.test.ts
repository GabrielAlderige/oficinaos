import { describe, expect, it } from 'vitest';
import { anosDoCodigo, lerChassi, pareceVin, resumoDoChassi } from './vin';

const AGORA = new Date('2026-09-30T12:00:00Z');

/**
 * Leitura do chassi (E43).
 *
 * O que precisa ficar provado: o que o chassi entrega de verdade (marca e ano)
 * e, principalmente, **o que ele NÃO entrega** — o modelo. Um teste que
 * aceitasse "adivinhar o modelo" abriria a porta para a tela mostrar a ficha do
 * carro errado, que é pior do que não mostrar ficha nenhuma.
 */
describe('leitura do chassi', () => {
  it('reconhece marca e ano de um chassi brasileiro', () => {
    // 9BG = GM do Brasil; a 10ª posição (F) é o ano-modelo
    const leitura = lerChassi('9BGKS48F0FG123456', AGORA)!;
    expect(leitura.make).toBe('Chevrolet');
    // 'F' é 1985 e 2015: os dois entram, porque nada no chassi desempata
    expect(leitura.years).toEqual([2015, 1985]);
    expect(leitura.wmi).toBe('9BG');
  });

  it('NÃO tenta adivinhar o modelo', () => {
    const leitura = lerChassi('9BWZZZ377VT004251', AGORA)!;
    expect(leitura.make).toBe('Volkswagen');
    // as posições 4 a 8 são proprietárias de cada montadora: não há tabela
    // pública que as traduza em "Gol 1.0". Quem escolhe o modelo é a pessoa
    expect(Object.keys(leitura)).not.toContain('model');
  });

  it('o que não parece chassi devolve null, e vira busca comum', () => {
    expect(lerChassi('corolla', AGORA)).toBeNull();
    expect(lerChassi('', AGORA)).toBeNull();
    // 16 caracteres: falta um
    expect(lerChassi('9BGKS48F0FG12345', AGORA)).toBeNull();
    // o chassi não usa I, O nem Q, para não confundir com 1 e 0
    expect(lerChassi('9BGKS48F0FG12345I', AGORA)).toBeNull();
    expect(lerChassi('9BGKS48F0FG12345O', AGORA)).toBeNull();
    expect(lerChassi('9BGKS48F0FG12345Q', AGORA)).toBeNull();
  });

  it('aceita minúscula e espaço em volta: é o que a pessoa cola', () => {
    const leitura = lerChassi('  9bgks48f0fg123456  ', AGORA)!;
    expect(leitura.vin).toBe('9BGKS48F0FG123456');
    expect(leitura.make).toBe('Chevrolet');
  });

  it('marca desconhecida não vira chute', () => {
    // WMI inventado: melhor dizer que não reconheceu do que mostrar a ficha de
    // outro carro
    const leitura = lerChassi('ZZZKS48F0FG123456', AGORA)!;
    expect(leitura.make).toBeNull();
    expect(leitura.years, 'o ano continua legível mesmo sem a marca').toContain(2015);
    expect(resumoDoChassi(leitura)).toContain('marca não reconhecida');
  });

  describe('o ano-modelo', () => {
    it('devolve os DOIS anos do ciclo, em vez de chutar um', () => {
      // 'F' é 1985 e também 2015, e o chassi não diz qual. Chutar 2015 e filtrar
      // por ele esconderia a ficha de um carro 1985 de quem tem um na oficina
      expect(anosDoCodigo('F', AGORA)).toEqual([2015, 1985]);
    });

    it('aceita o ano-modelo do ano que vem, porque a indústria adianta', () => {
      // em 2026, um carro 2027 já sai de fábrica — e 1997 também é 'V'
      expect(anosDoCodigo('V', AGORA)).toEqual([2027, 1997]);
    });

    it('não devolve ano que ainda não existe', () => {
      // 'Y' é 2000 e 2030; 2030 está longe demais para ser ano-modelo em 2026
      expect(anosDoCodigo('Y', AGORA)).toEqual([2000]);
      // 'W' seria 2028: dois anos à frente, ainda não
      expect(anosDoCodigo('W', AGORA)).toEqual([1998]);
    });

    it('pula as letras que o padrão não usa', () => {
      for (const proibida of ['I', 'O', 'Q', 'U', 'Z']) {
        expect(anosDoCodigo(proibida, AGORA), `${proibida} não é código de ano`).toEqual([]);
      }
    });

    it('os dígitos são de 2001 a 2009', () => {
      expect(anosDoCodigo('1', AGORA)).toEqual([2001]);
      expect(anosDoCodigo('9', AGORA)).toEqual([2009]);
    });

    it('o resumo mostra as duas datas, do mais antigo para o mais novo', () => {
      const leitura = lerChassi('9BWZZZ377VT004251', AGORA)!;
      expect(resumoDoChassi(leitura)).toBe('Volkswagen, ano-modelo 1997 ou 2027');
    });
  });

  it('pareceVin separa chassi de texto de busca', () => {
    expect(pareceVin('9BGKS48F0FG123456')).toBe(true);
    expect(pareceVin('onix 2015')).toBe(false);
  });
});
