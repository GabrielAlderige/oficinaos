import {
  SPEC_GROUP_LABELS,
  SPEC_GROUPS,
  SPEC_ITEM_BY_KEY,
  type CatalogVehicle,
  type SpecGroup,
} from '@oficinaos/shared';
import { Card, CardHeader } from '../../components/ui/display';

/** "Gol G6 1.0 · 2013–2016" */
export function nomeDoCarro(v: { make: string; model: string; version: string; yearFrom: number | null; yearTo: number | null }) {
  const anos = v.yearFrom && v.yearTo ? `${v.yearFrom}–${v.yearTo}` : (v.yearFrom ?? v.yearTo ?? null);
  return [`${v.make} ${v.model}`.trim(), v.version, anos].filter(Boolean).join(' · ');
}

/**
 * A ficha como a oficina lê (E31).
 *
 * Mostra SÓ o que foi preenchido. Listar os 23 itens da lista fixa com vinte
 * vazios faria a ficha parecer quebrada — e, pior, faria o mecânico procurar
 * uma informação que ninguém prometeu. O que falta some; o que existe aparece
 * com a data, porque especificação sem data é palpite com cara de certeza.
 */
export function VehicleSpecSheet({ ficha }: { ficha: CatalogVehicle }) {
  const porGrupo = SPEC_GROUPS.map((grupo) => ({
    grupo,
    itens: ficha.specs.filter((spec) => spec.group === grupo),
  })).filter((bloco) => bloco.itens.length > 0);

  return (
    <Card>
      <CardHeader
        title={nomeDoCarro(ficha)}
        description={ficha.notes || undefined}
      />

      {porGrupo.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          Esta ficha ainda não tem nenhum item preenchido.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {porGrupo.map(({ grupo, itens }) => (
            <section key={grupo} className="px-5 py-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {SPEC_GROUP_LABELS[grupo as SpecGroup]}
              </h3>
              <dl className="space-y-2">
                {itens.map((item, indice) => (
                  <div key={`${item.key}-${item.customLabel}-${indice}`} className="grid gap-1 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-sm text-muted">
                      {item.key ? (SPEC_ITEM_BY_KEY.get(item.key)?.label ?? item.key) : item.customLabel}
                    </dt>
                    <dd className="text-sm">
                      <span className="font-medium">{item.value}</span>
                      {item.note && <span className="block text-xs text-muted">{item.note}</span>}
                      {/* de onde veio (E35): quem está de macacão decide se
                          confia. "sem fonte" é aviso, não detalhe escondido */}
                      {item.source ? (
                        <span className="block text-xs text-muted">Fonte: {item.source}</span>
                      ) : (
                        <span className="block text-xs text-warning">Sem fonte — confirme antes de aplicar</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}

      {/* a oficina precisa saber de onde veio isto antes de despejar óleo num motor */}
      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        Informação de referência do OficinaOS, para consulta rápida na bancada. Confira sempre a embalagem e o manual
        do veículo antes de aplicar — especialmente óleo e fluido.
      </p>
    </Card>
  );
}
