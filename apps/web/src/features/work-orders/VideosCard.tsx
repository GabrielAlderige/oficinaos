import {
  type Attachment,
  VIDEO_MAX_SECONDS,
  VIDEO_RETENTION_DAYS,
  type VideoUploadMimeType,
  type WorkOrder,
} from '@oficinaos/shared';
import { Camera, Download, ImagePlus, Images, Lock, Share2, Trash2, Video } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatBytes } from '../../lib/image';
import { useFeature } from '../../lib/session';
import { useAttachments, useDeleteAttachment, useUploadVideo } from './api';
import { FotoMarcadaDialog } from './FotoMarcadaDialog';
import { duracao, lerDuracao, temCamera, tipoDoVideo } from './midia';

/**
 * O aparelho manda ARQUIVO de vídeo pela folha de compartilhar (WhatsApp,
 * Telegram, e-mail)? Celular Android e iPhone sim; boa parte dos navegadores
 * de computador não — lá fica só o "Baixar".
 */
function podeCompartilharVideo(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([], 'video.mp4', { type: 'video/mp4' })] })
    );
  } catch {
    return false;
  }
}

/**
 * Manda o vídeo como ARQUIVO pelo WhatsApp (E46): o cliente recebe o vídeo na
 * conversa e assiste ali, sem abrir link — e ele fica no celular dele depois
 * que o servidor apaga.
 *
 * O arquivo é baixado no toque. O Safari só abre a folha de compartilhar logo
 * depois de um toque: se o download demorar e ele recusar (`NotAllowedError`),
 * o arquivo já está em mãos e o botão pede um segundo toque, que abre na hora.
 */
function CompartilharVideo({ video, nome }: { video: Attachment; nome: string }) {
  const [estado, setEstado] = useState<'ocioso' | 'baixando' | 'pronto'>('ocioso');
  const arquivo = useRef<File | null>(null);

  async function compartilhar() {
    try {
      if (!arquivo.current) {
        setEstado('baixando');
        const resposta = await fetch(video.url!);
        if (!resposta.ok) throw new Error(`download ${resposta.status}`);
        arquivo.current = new File([await resposta.blob()], nome, { type: 'video/mp4' });
      }
      setEstado('ocioso');
      await navigator.share({ files: [arquivo.current], ...(video.caption ? { text: video.caption } : {}) });
    } catch (erro) {
      // fechou a folha sem escolher ninguém
      if (erro instanceof DOMException && erro.name === 'AbortError') return setEstado('ocioso');
      if (erro instanceof DOMException && erro.name === 'NotAllowedError' && arquivo.current) {
        setEstado('pronto');
        toast.info('Vídeo pronto. Toque em "Enviar agora".');
        return;
      }
      setEstado('ocioso');
      toast.error('Não deu para compartilhar o vídeo. Use "Baixar" e mande pelo WhatsApp.');
    }
  }

  return (
    <Button size="sm" variant="ghost" loading={estado === 'baixando'} onClick={() => void compartilhar()}>
      <Share2 />
      {estado === 'pronto' ? 'Enviar agora' : 'WhatsApp'}
    </Button>
  );
}

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
 * Fotos e vídeos do defeito (E45 e E47). O mecânico fotografa e marca, ou
 * grava o defeito; tudo vai junto no orçamento, e o cliente vê o que a
 * oficina viu — é o que tira o "será que precisa mesmo?" da aprovação.
 *
 * Foto marcada vale em todos os planos; vídeo, do Supercharger para cima. O
 * que é do check-in (a entrada do carro) fica fora daqui: é prova da oficina,
 * e aparece no cartão do check-in.
 */
export function VideosCard({ order, canWrite, editable }: { order: WorkOrder; canWrite: boolean; editable: boolean }) {
  const temNoPlano = useFeature('work_order_video');
  const anexos = useAttachments(order.id);
  const remover = useDeleteAttachment(order.id);
  const [escolhido, setEscolhido] = useState<{ file: File; mimeType: VideoUploadMimeType; segundos: number | null } | null>(null);
  const [fotoEscolhida, setFotoEscolhida] = useState<File | null>(null);
  const [apagando, setApagando] = useState<Attachment | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const cameraFoto = useRef<HTMLInputElement>(null);
  const galeriaFoto = useRef<HTMLInputElement>(null);

  const doDefeito = (anexos.data ?? []).filter((anexo) => !anexo.inspectionId);
  const videos = doDefeito.filter((anexo) => anexo.kind === 'VIDEO');
  const fotos = doDefeito.filter((anexo) => anexo.kind === 'PHOTO');
  const podeMexer = canWrite && editable;
  const podeGravar = temNoPlano && podeMexer;
  const [compartilha] = useState(podeCompartilharVideo);
  const celular = temCamera();
  const fecharFoto = useCallback(() => setFotoEscolhida(null), []);

  async function escolher(arquivos: FileList | null) {
    const file = arquivos?.[0];
    if (!file) return;
    const mimeType = tipoDoVideo(file);
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

  function escolherFoto(arquivos: FileList | null) {
    const file = arquivos?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Esse arquivo não é uma foto.');
      return;
    }
    setFotoEscolhida(file);
  }

  const vazio = videos.length === 0 && fotos.length === 0;

  return (
    <Card>
      <CardHeader
        title="Fotos e vídeos do defeito"
        description="Mostre ao cliente o que você encontrou: vai tudo junto no orçamento."
        action={
          podeMexer && (
            <span className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => (celular ? cameraFoto : galeriaFoto).current?.click()}>
                <Camera />
                Foto
              </Button>
              {podeGravar && (
                <Button size="sm" variant="secondary" onClick={() => (celular ? camera : galeria).current?.click()}>
                  <Video />
                  {celular ? 'Gravar vídeo' : 'Vídeo'}
                </Button>
              )}
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
      <input
        ref={cameraFoto}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          escolherFoto(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={galeriaFoto}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          escolherFoto(event.target.files);
          event.target.value = '';
        }}
      />

      {podeMexer && celular && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3 text-xs">
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            onClick={() => galeriaFoto.current?.click()}
          >
            <ImagePlus className="size-3.5" aria-hidden="true" />
            Foto da galeria
          </button>
          {podeGravar && (
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              onClick={() => galeria.current?.click()}
            >
              <Images className="size-3.5" aria-hidden="true" />
              Vídeo da galeria
            </button>
          )}
        </div>
      )}

      {vazio && (
        <p className="px-5 py-6 text-center text-sm text-muted">
          {podeMexer
            ? 'Nada ainda. Uma foto com o defeito circulado convence mais que qualquer explicação.'
            : 'Nenhuma foto nem vídeo nesta OS.'}
        </p>
      )}

      {fotos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3">
          {fotos.map((foto) => {
            const item = order.items.find((linha) => linha.id === foto.workOrderItemId);
            return (
              <li key={foto.id} className="min-w-0">
                <a href={foto.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block">
                  {foto.url ? (
                    <img
                      src={foto.url}
                      alt={foto.caption ?? (item ? `Foto: ${item.description}` : 'Foto do defeito')}
                      loading="lazy"
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span className="grid aspect-square w-full place-items-center rounded-lg border border-border bg-surface-muted text-xs text-muted">
                      enviando
                    </span>
                  )}
                </a>
                <div className="mt-1 flex items-start justify-between gap-1">
                  <p className="min-w-0 text-xs">
                    <span className="block truncate font-medium">{foto.caption ?? item?.description ?? 'Da OS em geral'}</span>
                    <span className="text-muted">{foto.visibleToCustomer ? 'vai para o cliente' : 'só a oficina vê'}</span>
                  </p>
                  {canWrite && (
                    <Button variant="ghost" size="icon" className="size-7" aria-label="Apagar foto" onClick={() => setApagando(foto)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {videos.length > 0 && (
        <ul className={cn('divide-y divide-border', fotos.length > 0 && 'border-t border-border')}>
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
                    {video.status === 'READY' && video.url && compartilha && (
                      <CompartilharVideo video={video} nome={`video-os-${order.number}.mp4`} />
                    )}
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

      {!temNoPlano && podeMexer && (
        <div className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Vídeo do defeito e explicação com a sua voz: a partir do plano Supercharger.{' '}
            <Link to="/configuracoes/plano" className="font-medium text-accent hover:underline">
              Ver planos
            </Link>
          </span>
        </div>
      )}

      {escolhido && <EnviarVideoDialog order={order} escolhido={escolhido} onClose={() => setEscolhido(null)} />}
      {fotoEscolhida && (
        <FotoMarcadaDialog order={order} arquivo={fotoEscolhida} podeGravarVoz={temNoPlano} onClose={fecharFoto} />
      )}

      <ConfirmDialog
        open={apagando !== null}
        onOpenChange={(open) => !open && setApagando(null)}
        title={apagando?.kind === 'PHOTO' ? 'Apagar esta foto?' : 'Apagar este vídeo?'}
        description={
          apagando?.kind === 'PHOTO'
            ? 'Ela sai desta OS e não vai nos próximos orçamentos. Um orçamento já enviado continua com ela: é o registro do que o cliente viu.'
            : 'Ele sai do servidor na hora e some do orçamento do cliente. Não dá para desfazer.'
        }
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
