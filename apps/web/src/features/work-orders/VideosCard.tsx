import {
  type Attachment,
  VIDEO_MAX_SECONDS,
  VIDEO_RETENTION_DAYS,
  VIDEO_UPLOAD_MIME_TYPES,
  videoMimeFromFileName,
  type VideoUploadMimeType,
  type WorkOrder,
} from '@oficinaos/shared';
import { Download, Images, Lock, Trash2, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { Spinner } from '../../components/ui/spinner';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatBytes } from '../../lib/image';
import { useFeature } from '../../lib/session';
import { useAttachments, useDeleteAttachment, useUploadVideo } from './api';

/** "0:42", "1:00" */
const duracao = (segundos: number) => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

/**
 * A duração lida no próprio aparelho, antes de subir: é o que evita esperar
 * 3 minutos de envio para descobrir que o vídeo tinha 2 minutos.
 *
 * `null` quando o navegador não sabe ler (HEVC do iPhone num Chrome de
 * computador, `webm` sem duração no cabeçalho). Aí o vídeo sobe assim mesmo:
 * o servidor corta em 60 s de qualquer jeito.
 */
function lerDuracao(arquivo: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const video = document.createElement('video');
    const fim = (valor: number | null) => {
      clearTimeout(relogio);
      URL.revokeObjectURL(url);
      resolve(valor);
    };
    const relogio = setTimeout(() => fim(null), 8000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => fim(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => fim(null);
    video.src = url;
  });
}

/** Celular e tablet: a câmera abre direto. Computador: só escolher o arquivo. */
const temCamera = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function prazoDoVideo(video: Attachment): string {
  if (video.status === 'EXPIRED') {
    return video.expiresAt
      ? `Apagado do servidor em ${formatDate(video.expiresAt)}, ${VIDEO_RETENTION_DAYS} dias depois da resposta do cliente.`
      : 'Apagado do servidor: ficou 30 dias sem resposta do cliente.';
  }
  if (video.expiresAt) return `Disponível até ${formatDate(video.expiresAt)}. Baixe se quiser guardar.`;
  return `Fica disponível até ${VIDEO_RETENTION_DAYS} dias depois que o cliente responder o orçamento.`;
}

/**
 * Vídeo na OS (E45). O mecânico grava o defeito, o vídeo vai junto no
 * orçamento, e o cliente vê o que a oficina viu — é o que tira o "será que
 * precisa mesmo?" da aprovação.
 */
export function VideosCard({ order, canWrite, editable }: { order: WorkOrder; canWrite: boolean; editable: boolean }) {
  const temNoPlano = useFeature('work_order_video');
  const anexos = useAttachments(order.id);
  const remover = useDeleteAttachment(order.id);
  const [escolhido, setEscolhido] = useState<{ file: File; mimeType: VideoUploadMimeType; segundos: number | null } | null>(null);
  const [apagando, setApagando] = useState<Attachment | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  const videos = (anexos.data ?? []).filter((anexo) => anexo.kind === 'VIDEO');
  const podeGravar = temNoPlano && canWrite && editable;

  async function escolher(arquivos: FileList | null) {
    const file = arquivos?.[0];
    if (!file) return;
    // o Windows às vezes manda o .mov sem tipo: a extensão resolve
    const mimeType = (VIDEO_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)
      ? (file.type as VideoUploadMimeType)
      : videoMimeFromFileName(file.name);
    if (!mimeType) {
      toast.error('Esse arquivo não é um vídeo que o sistema reconheça (MP4, MOV ou WebM).');
      return;
    }
    const segundos = await lerDuracao(file);
    // meio segundo de folga: o celular arredonda a duração para cima
    if (segundos !== null && segundos > VIDEO_MAX_SECONDS + 0.5) {
      toast.error(`O vídeo tem ${duracao(Math.round(segundos))}. O limite é ${VIDEO_MAX_SECONDS} segundos: grave um mais curto.`);
      return;
    }
    setEscolhido({ file, mimeType, segundos });
  }

  if (!temNoPlano && videos.length === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          <div className="text-sm">
            <p className="font-medium">Vídeo do serviço no orçamento</p>
            <p className="text-muted">
              Grave o defeito e mande junto com o orçamento. Disponível a partir do plano Supercharger.{' '}
              <Link to="/configuracoes/plano" className="font-medium text-accent hover:underline">
                Ver planos
              </Link>
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Vídeos"
        description={`Mostre o defeito para o cliente: o vídeo vai junto no orçamento. Até ${VIDEO_MAX_SECONDS} segundos.`}
        action={
          podeGravar && (
            <span className="flex gap-2">
              {temCamera() && (
                <Button size="sm" variant="secondary" onClick={() => camera.current?.click()}>
                  <Video />
                  Gravar
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => galeria.current?.click()}>
                <Images />
                {temCamera() ? 'Da galeria' : 'Escolher vídeo'}
              </Button>
            </span>
          )
        }
      />
      {/* `capture` abre a câmera traseira direto no celular; sem ele, a galeria */}
      <input
        ref={camera}
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void escolher(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={galeria}
        type="file"
        accept="video/*,.mov,.mp4,.webm,.3gp,.m4v"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void escolher(event.target.files);
          event.target.value = '';
        }}
      />

      {videos.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted">
          {podeGravar ? 'Nenhum vídeo ainda. Um vídeo curto do defeito convence mais que qualquer explicação.' : 'Nenhum vídeo nesta OS.'}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {videos.map((video) => {
            const item = order.items.find((linha) => linha.id === video.workOrderItemId);
            return (
              <li key={video.id} className="space-y-2 px-5 py-4">
                {video.status === 'READY' && video.url ? (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    poster={video.posterUrl ?? undefined}
                    src={video.url}
                    className="max-h-[28rem] w-full rounded-lg bg-black object-contain"
                  />
                ) : video.status === 'PROCESSING' ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-6 text-sm text-muted">
                    <Spinner />
                    <span>
                      Preparando o vídeo para tocar em qualquer celular. Leva até um minuto, e você pode sair da tela.
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-surface-muted px-4 py-4 text-sm text-muted">
                    {video.status === 'FAILED'
                      ? 'Não deu para preparar este vídeo. Grave de novo; se acontecer outra vez, fale com o suporte.'
                      : video.status === 'PENDING_UPLOAD'
                        ? 'O envio deste vídeo não terminou.'
                        : 'Este vídeo já foi apagado do servidor.'}
                  </div>
                )}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {video.caption ?? (item ? item.description : 'Vídeo do serviço')}
                    </p>
                    <p className="text-xs text-muted">
                      {[
                        video.caption && item ? `Sobre: ${item.description}` : null,
                        video.durationSeconds ? duracao(video.durationSeconds) : null,
                        video.status === 'READY' ? formatBytes(video.sizeBytes) : null,
                        video.visibleToCustomer ? 'vai para o cliente' : 'só a oficina vê',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {(video.status === 'READY' || video.status === 'EXPIRED') && (
                      <p className="mt-0.5 text-xs text-muted">{prazoDoVideo(video)}</p>
                    )}
                  </div>
                  <span className="flex gap-1">
                    {video.downloadUrl && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={video.downloadUrl} download>
                          <Download />
                          Baixar
                        </a>
                      </Button>
                    )}
                    {canWrite && video.status !== 'EXPIRED' && (
                      <Button variant="ghost" size="icon" className="size-8" aria-label="Apagar vídeo" onClick={() => setApagando(video)}>
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {escolhido && <EnviarVideoDialog order={order} escolhido={escolhido} onClose={() => setEscolhido(null)} />}

      <ConfirmDialog
        open={apagando !== null}
        onOpenChange={(open) => !open && setApagando(null)}
        title="Apagar este vídeo?"
        description="Ele sai do servidor na hora e some do orçamento do cliente. Não dá para desfazer."
        confirmLabel="Apagar"
        destructive
        onConfirm={async () => {
          if (!apagando) return;
          try {
            await remover.mutateAsync(apagando.id);
            setApagando(null);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Card>
  );
}

function EnviarVideoDialog({
  order,
  escolhido,
  onClose,
}: {
  order: WorkOrder;
  escolhido: { file: File; mimeType: VideoUploadMimeType; segundos: number | null };
  onClose(): void;
}) {
  const enviar = useUploadVideo(order.id);
  const [itemId, setItemId] = useState('');
  const [legenda, setLegenda] = useState('');
  const [paraOCliente, setParaOCliente] = useState(true);
  const [progresso, setProgresso] = useState(0);

  async function confirmar() {
    try {
      await enviar.mutateAsync({
        file: escolhido.file,
        mimeType: escolhido.mimeType,
        workOrderItemId: itemId || null,
        caption: legenda,
        visibleToCustomer: paraOCliente,
        onProgress: setProgresso,
      });
      toast.success('Vídeo enviado. Ele fica pronto em instantes.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !enviar.isPending && onClose()}>
      <DialogContent>
        <DialogHeader
          title="Enviar vídeo"
          description={[
            escolhido.segundos !== null ? duracao(Math.round(escolhido.segundos)) : null,
            formatBytes(escolhido.file.size),
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        <div className="grid gap-4">
          {order.items.length > 0 && (
            <Field label="De qual serviço ou peça o vídeo fala?" htmlFor="video-item" hint="Aparece ao lado do vídeo para o cliente.">
              <Select id="video-item" value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={enviar.isPending}>
                <option value="">Da OS em geral</option>
                {order.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Legenda (opcional)" htmlFor="video-legenda">
            <Input
              {...fieldA11y('video-legenda')}
              maxLength={200}
              value={legenda}
              onChange={(event) => setLegenda(event.target.value)}
              placeholder="Ex.: barulho na roda dianteira ao frear"
              disabled={enviar.isPending}
            />
          </Field>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={paraOCliente}
              onChange={(event) => setParaOCliente(event.target.checked)}
              disabled={enviar.isPending}
            />
            <span>
              Mostrar para o cliente no orçamento
              <span className="block text-xs text-muted">
                Depois que ele responder, o vídeo fica disponível por {VIDEO_RETENTION_DAYS} dias e é apagado do servidor.
              </span>
            </span>
          </label>
          {enviar.isPending && (
            <div>
              <div
                className="h-2 overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-label="Envio do vídeo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progresso * 100)}
              >
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progresso * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {progresso < 1 ? `Enviando… ${Math.round(progresso * 100)}%. Não feche esta tela.` : 'Conferindo o vídeo…'}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={enviar.isPending}>
            Cancelar
          </Button>
          <Button loading={enviar.isPending} onClick={() => void confirmar()}>
            Enviar vídeo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
