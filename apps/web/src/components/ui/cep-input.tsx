import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { FieldValues, Path, UseFormRegisterReturn, UseFormSetValue } from 'react-hook-form';
import { buscarCep, cepCompleto, formatCep } from '../../lib/cep';
import { Input } from './input';

/**
 * Campo de CEP que preenche o resto do endereço (ROADMAP, integração de
 * Fase 1). Digitou os oito dígitos, ele busca; achou, preenche rua, bairro,
 * cidade e UF **sem apagar o que a pessoa já escreveu** e sem travar o
 * formulário — CEP fora da base é comum em bairro novo, e ali se digita à mão.
 *
 * O prefixo dos campos vem de fora porque os dois formulários que usam isto
 * (a oficina e o cliente) têm o endereço aninhado no mesmo lugar: `address.*`.
 */
export function CepInput<T extends FieldValues>({
  id,
  registro,
  setValue,
  prefixo = 'address',
  onErro,
}: {
  id: string;
  /** o `register('address.zip')` do React Hook Form */
  registro: UseFormRegisterReturn;
  setValue: UseFormSetValue<T>;
  prefixo?: string;
  onErro?: (mensagem: string) => void;
}) {
  const [buscando, setBuscando] = useState(false);

  async function preencher(valor: string) {
    if (!cepCompleto(valor)) return;
    setBuscando(true);
    try {
      const endereco = await buscarCep(valor);
      if (!endereco) {
        onErro?.('CEP não encontrado. Pode preencher à mão.');
        return;
      }
      const preencherCampo = (campo: string, conteudo: string) => {
        if (!conteudo) return;
        setValue(`${prefixo}.${campo}` as Path<T>, conteudo as never, { shouldDirty: true });
      };
      preencherCampo('street', endereco.street);
      preencherCampo('district', endereco.district);
      preencherCampo('city', endereco.city);
      preencherCampo('state', endereco.state);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        placeholder="00000-000"
        maxLength={9}
        {...registro}
        onChange={(event) => {
          const formatado = formatCep(event.target.value);
          event.target.value = formatado;
          void registro.onChange(event);
          // busca assim que o oitavo dígito entra: ninguém quer sair do campo
          // para o endereço aparecer
          if (cepCompleto(formatado)) void preencher(formatado);
        }}
        onBlur={(event) => {
          void registro.onBlur(event);
          void preencher(event.target.value);
        }}
      />
      {buscando && (
        <Loader2
          className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted"
          aria-hidden="true"
        />
      )}
      <span className="sr-only" role="status">
        {buscando ? 'Buscando o endereço do CEP' : ''}
      </span>
    </div>
  );
}
