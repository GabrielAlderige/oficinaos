import { SYSTEM_CHECKLIST, type ChecklistTemplate } from '@oficinaos/shared';
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Alert, Card, CardHeader, Skeleton } from '../../components/ui/display';
import { Field, fieldA11y } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/list-parts';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { errorMessage } from '../../lib/errors';
import { useCan } from '../../lib/session';
import { useApagarChecklist, useChecklistTemplates, useOrdenarChecklists, useSalvarChecklist } from './api';

interface Rascunho {
  id: string | null;
  name: string;
  items: { chave: string; key?: string; label: string }[];
}

const novoItem = (label = '', key?: string) => ({ chave: crypto.randomUUID(), key, label });

/**
 * Checklists da oficina (E49): os modelos que o check-in oferece, na ordem
 * em que o mecânico percorre o carro. O primeiro da lista é o sugerido.
 */
export function ChecklistsSettingsPage() {
  const podeEditar = useCan('catalog:write');
  const modelos = useChecklistTemplates();
  const ordenar = useOrdenarChecklists();
  const apagar = useApagarChecklist();
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [apagando, setApagando] = useState<ChecklistTemplate | null>(null);

  const abrirNovo = (base?: Omit<ChecklistTemplate, 'id'> & { id: string | null }) =>
    setEditando({
      id: null,
      name: base ? base.name : '',
      items: base ? base.items.map((item) => novoItem(item.label, item.key)) : [novoItem()],
    });

  async function mover(indice: number, delta: number) {
    const lista = modelos.data ?? [];
    const ids = lista.map((modelo) => modelo.id);
    const [tirado] = ids.splice(indice, 1);
    ids.splice(indice + delta, 0, tirado!);
    try {
      await ordenar.mutateAsync(ids);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (modelos.isPending) return <Skeleton className="h-48 w-full" />;
  if (modelos.isError) return <Alert variant="danger">{errorMessage(modelos.error)}</Alert>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Checklists do check-in"
          description="Monte os checklists do jeito que a sua equipe confere o carro. O primeiro da lista é o que o check-in abre; os outros ficam para escolher."
          action={
            podeEditar && (
              <Button size="sm" onClick={() => abrirNovo()}>
                <Plus />
                Novo checklist
              </Button>
            )
          }
        />
        {!modelos.data.length ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={ListChecks}
              title="Usando o checklist padrão"
              description={`Enquanto a oficina não montar o seu, o check-in usa o padrão do sistema: ${SYSTEM_CHECKLIST.items
                .map((item) => item.label.toLowerCase())
                .join(', ')}.`}
              action={
                podeEditar && (
                  <Button variant="secondary" onClick={() => abrirNovo(SYSTEM_CHECKLIST)}>
                    Começar a partir do padrão
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {modelos.data.map((modelo, indice) => (
              <li key={modelo.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {modelo.name}
                    {indice === 0 && <span className="ml-2 text-xs font-normal text-muted">abre no check-in</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {modelo.items.length} {modelo.items.length === 1 ? 'item' : 'itens'}:{' '}
                    {modelo.items.map((item) => item.label).join(', ')}
                  </p>
                </div>
                {podeEditar && (
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Subir ${modelo.name}`}
                      disabled={indice === 0 || ordenar.isPending}
                      onClick={() => void mover(indice, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Descer ${modelo.name}`}
                      disabled={indice === modelos.data.length - 1 || ordenar.isPending}
                      onClick={() => void mover(indice, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Editar ${modelo.name}`}
                      onClick={() =>
                        setEditando({
                          id: modelo.id,
                          name: modelo.name,
                          items: modelo.items.map((item) => novoItem(item.label, item.key)),
                        })
                      }
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Apagar ${modelo.name}`}
                      onClick={() => setApagando(modelo)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editando && <EditorDeChecklist rascunho={editando} onClose={() => setEditando(null)} />}

      <ConfirmDialog
        open={apagando !== null}
        onOpenChange={(open) => !open && setApagando(null)}
        title={`Apagar o checklist “${apagando?.name ?? ''}”?`}
        description="Ele sai da lista do check-in. Os check-ins já feitos com ele continuam mostrando tudo o que foi conferido."
        confirmLabel="Apagar"
        destructive
        onConfirm={async () => {
          if (!apagando) return;
          try {
            await apagar.mutateAsync(apagando.id);
            setApagando(null);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

function EditorDeChecklist({ rascunho, onClose }: { rascunho: Rascunho; onClose(): void }) {
  const salvar = useSalvarChecklist();
  const [nome, setNome] = useState(rascunho.name);
  const [itens, setItens] = useState(rascunho.items);
  const [erro, setErro] = useState<string | null>(null);

  const mudar = (chave: string, label: string) =>
    setItens((atuais) => atuais.map((item) => (item.chave === chave ? { ...item, label } : item)));
  const mover = (indice: number, delta: number) =>
    setItens((atuais) => {
      const copia = [...atuais];
      const [tirado] = copia.splice(indice, 1);
      copia.splice(indice + delta, 0, tirado!);
      return copia;
    });

  async function confirmar() {
    setErro(null);
    const preenchidos = itens.filter((item) => item.label.trim());
    if (nome.trim().length < 2) return setErro('Dê um nome ao checklist.');
    if (!preenchidos.length) return setErro('Coloque pelo menos um item.');
    try {
      await salvar.mutateAsync({
        id: rascunho.id,
        input: { name: nome, items: preenchidos.map((item) => ({ key: item.key, label: item.label })) },
      });
      toast.success('Checklist salvo.');
      onClose();
    } catch (err) {
      setErro(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !salvar.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={rascunho.id ? 'Editar checklist' : 'Novo checklist'}
          description="Os itens na ordem em que a equipe confere o carro. Cada um é respondido com Ok, Problema ou Não se aplica."
        />
        <div className="grid gap-4">
          <Field label="Nome" htmlFor="ck-nome">
            <Input
              {...fieldA11y('ck-nome')}
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Ex.: Revisão, Ar-condicionado, Entrada de frota"
              maxLength={60}
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Itens</legend>
            <ol className="space-y-2">
              {itens.map((item, indice) => (
                <li key={item.chave} className="flex items-center gap-1.5">
                  <span className="w-6 text-right text-xs text-muted tabular">{indice + 1}.</span>
                  <Input
                    aria-label={`Item ${indice + 1}`}
                    value={item.label}
                    onChange={(event) => mudar(item.chave, event.target.value)}
                    maxLength={120}
                    placeholder="Ex.: Nível do óleo"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Subir item ${indice + 1}`}
                    disabled={indice === 0}
                    onClick={() => mover(indice, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Descer item ${indice + 1}`}
                    disabled={indice === itens.length - 1}
                    onClick={() => mover(indice, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Tirar item ${indice + 1}`}
                    disabled={itens.length === 1}
                    onClick={() => setItens((atuais) => atuais.filter((outro) => outro.chave !== item.chave))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={itens.length >= 40}
              onClick={() => setItens((atuais) => [...atuais, novoItem()])}
            >
              <Plus />
              Adicionar item
            </Button>
          </fieldset>
          {erro && <Alert variant="danger">{erro}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} onClick={() => void confirmar()}>
            Salvar checklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
