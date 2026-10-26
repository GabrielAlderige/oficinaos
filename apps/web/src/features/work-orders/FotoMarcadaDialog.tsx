import { VIDEO_MAX_SECONDS, VIDEO_RETENTION_DAYS, type WorkOrder } from '@oficinaos/shared';
import { Circle, Mic, MoveUpRight, PenLine, RotateCcw, Square, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Field, fieldA11y, Select } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../../components/ui/overlays';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useUploadFile, useUploadVideo } from './api';
import { duracao, tipoDoVideo } from './midia';

type Ferramenta = 'circulo' | 'seta' | 'livre';
type Ponto = [number, number];
interface Marca {
  ferramenta: Ferramenta;
  pontos: Ponto[];
}

/** O lado maior da foto marcada: nítida no celular do cliente e leve para gravar a tela. */
const LADO_MAIOR = 1280;
const VERMELHO = '#e11d48';

const FERRAMENTAS: {
  valor: Ferramenta;
  rotulo: string;
  icone: typeof Circle;
}[] = [
  { valor: 'circulo', rotulo: 'Círculo', icone: Circle },
  { valor: 'seta', rotulo: 'Seta', icone: MoveUpRight },
  { valor: 'livre', rotulo: 'À mão', icone: PenLine },
];

function carregarImagem(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(url);
      resolve(imagem);
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não deu para abrir esta foto. Tire de novo pela câmera.'));
    };
    imagem.src = url;
  });
}

/**
 * Desenha a foto e as marcas. Cada traço sai duas vezes — branco largo por
 * baixo, vermelho por cima — para a marca aparecer em peça escura, em peça
 * enferrujada e em pintura vermelha.
 */
function desenhar(ctx: CanvasRenderingContext2D, imagem: HTMLImageElement, marcas: Marca[]) {
  const { width, height } = ctx.canvas;
  ctx.drawImage(imagem, 0, 0, width, height);
  const grossura = Math.max(4, Math.round(Math.max(width, height) / 160));
  for (const camada of [
    { cor: '#ffffff', largura: grossura + 4 },
    { cor: VERMELHO, largura: grossura },
  ]) {
    ctx.strokeStyle = camada.cor;
    ctx.fillStyle = camada.cor;
    ctx.lineWidth = camada.largura;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const marca of marcas) {
      const [inicio, fim] = [marca.pontos[0]!, marca.pontos[marca.pontos.length - 1]!];
      ctx.beginPath();
      if (marca.ferramenta === 'circulo') {
        const raioX = Math.abs(fim[0] - inicio[0]) / 2;
        const raioY = Math.abs(fim[1] - inicio[1]) / 2;
        ctx.ellipse(
          (inicio[0] + fim[0]) / 2,
          (inicio[1] + fim[1]) / 2,
          Math.max(raioX, 1),
          Math.max(raioY, 1),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      } else if (marca.ferramenta === 'seta') {
        const angulo = Math.atan2(fim[1] - inicio[1], fim[0] - inicio[0]);
        const ponta = grossura * 4;
        ctx.moveTo(inicio[0], inicio[1]);
        ctx.lineTo(fim[0], fim[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(fim[0], fim[1]);
        ctx.lineTo(fim[0] - ponta * Math.cos(angulo - Math.PI / 7), fim[1] - ponta * Math.sin(angulo - Math.PI / 7));
        ctx.lineTo(fim[0] - ponta * Math.cos(angulo + Math.PI / 7), fim[1] - ponta * Math.sin(angulo + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.moveTo(inicio[0], inicio[1]);
        for (const [x, y] of marca.pontos.slice(1)) ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }
}

/**
 * Gravar a tela com a voz (E47): o navegador junta a foto (com as marcas sendo
 * desenhadas ao vivo) e o microfone num vídeo. O Safari grava MP4, o Chrome
 * WebM — o servidor converte os dois para o MP4 que toca em qualquer celular.
 */
function podeGravarATela(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function formatoDaGravacao(): string | undefined {
  return ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find((tipo) => MediaRecorder.isTypeSupported(tipo));
}

interface Gravacao {
  arquivo: File;
  url: string;
  segundos: number;
}

/**
 * Marcar a foto do defeito (E47): círculo, seta ou traço à mão, em vermelho,
 * antes de mandar. Para o cliente leigo, "a peça dentro do círculo" explica o
 * que três parágrafos não explicam.
 *
 * Com o vídeo no plano, dá também para gravar a explicação falando — a foto,
 * as marcas aparecendo e a voz viram um vídeo do defeito como outro qualquer.
 */
export function FotoMarcadaDialog({
  order,
  arquivo,
  podeGravarVoz,
  onClose,
}: {
  order: WorkOrder;
  arquivo: File;
  /** o plano tem vídeo (Supercharger e Nitro) */
  podeGravarVoz: boolean;
  onClose(): void;
}) {
  const enviarFoto = useUploadFile(order.id);
  const enviarVideo = useUploadVideo(order.id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [ferramenta, setFerramenta] = useState<Ferramenta>('circulo');
  const desenhando = useRef<Marca | null>(null);

  const [itemId, setItemId] = useState('');
  const [legenda, setLegenda] = useState('');
  const [paraOCliente, setParaOCliente] = useState(true);
  const [progresso, setProgresso] = useState(0);

  const [modo, setModo] = useState<'marcar' | 'gravando' | 'gravado'>('marcar');
  const [segundos, setSegundos] = useState(0);
  const [gravacao, setGravacao] = useState<Gravacao | null>(null);
  const gravador = useRef<{
    recorder: MediaRecorder;
    microfone: MediaStream;
    inicio: number;
  } | null>(null);
  const [suportaGravar] = useState(podeGravarATela);

  const enviando = enviarFoto.isPending || enviarVideo.isPending;

  useEffect(() => {
    carregarImagem(arquivo).then(setImagem, (erro: Error) => {
      toast.error(erro.message);
      onClose();
    });
  }, [arquivo, onClose]);

  // a foto no tamanho de trabalho; as marcas são guardadas nessas coordenadas
  useEffect(() => {
    if (!imagem || !canvas.current) return;
    const escala = Math.min(1, LADO_MAIOR / Math.max(imagem.width, imagem.height));
    // medida par: o vídeo gravado da tela exige
    canvas.current.width = Math.round((imagem.width * escala) / 2) * 2;
    canvas.current.height = Math.round((imagem.height * escala) / 2) * 2;
  }, [imagem]);

  const redesenhar = useCallback(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !imagem) return;
    desenhar(ctx, imagem, desenhando.current ? [...marcas, desenhando.current] : marcas);
  }, [imagem, marcas]);

  useEffect(redesenhar, [redesenhar]);

  // gravando: a tela é redesenhada o tempo todo, senão o vídeo sai com um
  // quadro só (o navegador só grava quando o canvas muda)
  useEffect(() => {
    if (modo !== 'gravando') return;
    let quadro = requestAnimationFrame(function laco() {
      redesenhar();
      const g = gravador.current;
      if (g) {
        const passados = (performance.now() - g.inicio) / 1000;
        setSegundos(Math.floor(passados));
        if (passados >= VIDEO_MAX_SECONDS) parar();
      }
      quadro = requestAnimationFrame(laco);
    });
    return () => cancelAnimationFrame(quadro);
  }, [modo, redesenhar]);

  // fechou a tela no meio da gravação: o microfone desliga
  useEffect(
    () => () => {
      gravador.current?.microfone.getTracks().forEach((faixa) => faixa.stop());
      if (gravador.current?.recorder.state === 'recording') gravador.current.recorder.stop();
    },
    [],
  );
  useEffect(() => () => void (gravacao && URL.revokeObjectURL(gravacao.url)), [gravacao]);

  function pontoDo(evento: React.PointerEvent<HTMLCanvasElement>): Ponto {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const { width, height } = evento.currentTarget;
    return [
      ((evento.clientX - caixa.left) / caixa.width) * width,
      ((evento.clientY - caixa.top) / caixa.height) * height,
    ];
  }

  function comecar(evento: React.PointerEvent<HTMLCanvasElement>) {
    if (modo === 'gravado' || enviando) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const ponto = pontoDo(evento);
    desenhando.current = { ferramenta, pontos: [ponto, ponto] };
    redesenhar();
  }

  function mover(evento: React.PointerEvent<HTMLCanvasElement>) {
    const atual = desenhando.current;
    if (!atual) return;
    const ponto = pontoDo(evento);
    if (atual.ferramenta === 'livre') atual.pontos.push(ponto);
    else atual.pontos[1] = ponto;
    redesenhar();
  }

  function soltar() {
    const atual = desenhando.current;
    desenhando.current = null;
    if (!atual) return;
    const [[x0, y0], [x1, y1]] = [atual.pontos[0]!, atual.pontos[atual.pontos.length - 1]!];
    // um toque sem arrastar não vira marca de 1 pixel
    if (atual.ferramenta !== 'livre' && Math.hypot(x1 - x0, y1 - y0) < 8) return redesenhar();
    setMarcas((anteriores) => [...anteriores, atual]);
  }

  async function gravar() {
    const tela = canvas.current;
    if (!tela) return;
    let microfone: MediaStream;
    try {
      microfone = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('O celular não liberou o microfone. Permita o microfone para este site e tente de novo.');
      return;
    }
    const fluxo = tela.captureStream(30);
    microfone.getAudioTracks().forEach((faixa) => fluxo.addTrack(faixa));
    const formato = formatoDaGravacao();
    const recorder = new MediaRecorder(fluxo, formato ? { mimeType: formato } : undefined);
    const pedacos: Blob[] = [];
    recorder.ondataavailable = (evento) => {
      if (evento.data.size) pedacos.push(evento.data);
    };
    recorder.onstop = () => {
      microfone.getTracks().forEach((faixa) => faixa.stop());
      const tipo = (recorder.mimeType || formato || 'video/webm').split(';')[0]!;
      const passados = gravador.current ? (performance.now() - gravador.current.inicio) / 1000 : 0;
      gravador.current = null;
      const blob = new Blob(pedacos, { type: tipo });
      if (!blob.size) {
        toast.error('A gravação saiu vazia. Tente de novo.');
        setModo('marcar');
        return;
      }
      const extensao = tipo.includes('mp4') ? 'mp4' : 'webm';
      setGravacao({
        arquivo: new File([blob], `explicacao-os-${order.number}.${extensao}`, {
          type: tipo,
        }),
        url: URL.createObjectURL(blob),
        segundos: Math.min(VIDEO_MAX_SECONDS, Math.round(passados)),
      });
      setModo('gravado');
    };
    gravador.current = { recorder, microfone, inicio: performance.now() };
    setSegundos(0);
    recorder.start(1000);
    setModo('gravando');
  }

  function parar() {
    const g = gravador.current;
    if (g && g.recorder.state === 'recording') g.recorder.stop();
  }

  function regravar() {
    setGravacao(null);
    setModo('marcar');
  }

  async function salvarFoto() {
    const tela = canvas.current;
    if (!tela) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Não deu para gerar a foto marcada.');
      await enviarFoto.mutateAsync({
        file: new File([blob], `foto-os-${order.number}.jpg`, {
          type: 'image/jpeg',
        }),
        workOrderItemId: itemId || null,
        caption: legenda,
        visibleToCustomer: paraOCliente,
      });
      toast.success(paraOCliente ? 'Foto salva. Ela vai junto no orçamento.' : 'Foto salva.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function enviarGravacao() {
    if (!gravacao) return;
    const mimeType = tipoDoVideo(gravacao.arquivo);
    if (!mimeType) {
      toast.error('Este celular gravou num formato que o sistema não reconhece. Use "Salvar foto".');
      return;
    }
    try {
      await enviarVideo.mutateAsync({
        file: gravacao.arquivo,
        mimeType,
        workOrderItemId: itemId || null,
        caption: legenda,
        visibleToCustomer: paraOCliente,
        onProgress: setProgresso,
      });
      toast.success('Explicação enviada. O vídeo fica pronto em instantes.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const gravando = modo === 'gravando';

  return (
    <Dialog open onOpenChange={(open) => !open && !enviando && !gravando && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title={modo === 'gravado' ? 'Sua explicação' : 'Marcar a foto'}
          description={
            modo === 'gravado'
              ? 'Confira antes de enviar. Ela vai para o cliente como um vídeo do defeito.'
              : 'Arraste o dedo sobre a foto para circular ou apontar o defeito.'
          }
        />

        {modo === 'gravado' && gravacao && (
          <video
            src={gravacao.url}
            controls
            playsInline
            className="max-h-[55vh] w-full rounded-lg bg-black object-contain"
            aria-label="Prévia da explicação gravada"
          />
        )}
        {/* o canvas fica montado na prévia (só escondido): "gravar de novo"
            volta para a mesma foto, com as mesmas marcas e no mesmo tamanho */}
        <div className={cn(modo === 'gravado' && 'hidden')}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Ferramenta" className="flex gap-1 rounded-lg border border-border p-1">
              {FERRAMENTAS.map(({ valor, rotulo, icone: Icone }) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={ferramenta === valor}
                  onClick={() => setFerramenta(valor)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    ferramenta === valor ? 'bg-danger-soft text-danger' : 'text-muted hover:bg-surface-muted',
                  )}
                >
                  <Icone className="size-4" aria-hidden="true" />
                  {rotulo}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={!marcas.length || enviando}
              onClick={() => setMarcas((anteriores) => anteriores.slice(0, -1))}
            >
              <Undo2 />
              Desfazer
            </Button>
            {gravando && (
              <span className="ml-auto inline-flex items-center gap-2 text-sm font-medium text-danger" role="status">
                <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                Gravando {duracao(segundos)} de {duracao(VIDEO_MAX_SECONDS)}
              </span>
            )}
          </div>
          {!imagem && (
            <div className="grid h-64 place-items-center rounded-lg bg-surface-muted text-sm text-muted">
              Abrindo a foto…
            </div>
          )}
          <canvas
            ref={canvas}
            aria-label="Foto para marcar o defeito"
            className={cn(
              'mx-auto block max-h-[55vh] max-w-full cursor-crosshair touch-none rounded-lg bg-black',
              !imagem && 'hidden',
              gravando && 'ring-4 ring-danger/60',
            )}
            onPointerDown={comecar}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
          />
        </div>

        {!gravando && (
          <div className="mt-4 grid gap-4">
            {order.items.length > 0 && (
              <Field label="De qual serviço ou peça é?" htmlFor="foto-item" hint="Aparece junto do item no orçamento.">
                <Select
                  id="foto-item"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                  disabled={enviando}
                >
                  <option value="">Da OS em geral</option>
                  {order.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.description}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Legenda (opcional)" htmlFor="foto-legenda">
              <Input
                {...fieldA11y('foto-legenda')}
                maxLength={200}
                value={legenda}
                onChange={(event) => setLegenda(event.target.value)}
                placeholder="Ex.: pastilha no fim, disco riscado"
                disabled={enviando}
              />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={paraOCliente}
                onChange={(event) => setParaOCliente(event.target.checked)}
                disabled={enviando}
              />
              <span>
                Mostrar para o cliente no orçamento
                {modo === 'gravado' && (
                  <span className="block text-xs text-muted">
                    Depois que ele responder, o vídeo fica disponível por {VIDEO_RETENTION_DAYS} dias e é apagado do
                    servidor.
                  </span>
                )}
              </span>
            </label>
            {modo === 'marcar' && podeGravarVoz && suportaGravar && (
              <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
                <span className="font-medium text-foreground">Explicar falando:</span> toque em "Gravar explicação",
                fale o que encontrou e vá marcando a foto enquanto fala. Vira um vídeo de até {VIDEO_MAX_SECONDS}{' '}
                segundos.
              </p>
            )}
            {modo === 'marcar' && !podeGravarVoz && (
              <p className="text-xs text-muted">
                Explicar com a sua voz em cima da foto: a partir do plano Supercharger.
              </p>
            )}
            {enviarVideo.isPending && (
              <div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-label="Envio da explicação"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progresso * 100)}
                >
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${Math.round(progresso * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {progresso < 1
                    ? `Enviando… ${Math.round(progresso * 100)}%. Não feche esta tela.`
                    : 'Conferindo o vídeo…'}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {modo === 'marcar' && (
            <>
              <Button variant="secondary" onClick={onClose} disabled={enviando}>
                Cancelar
              </Button>
              {podeGravarVoz && suportaGravar && (
                <Button variant="secondary" onClick={() => void gravar()} disabled={!imagem || enviando}>
                  <Mic />
                  Gravar explicação
                </Button>
              )}
              <Button loading={enviarFoto.isPending} disabled={!imagem} onClick={() => void salvarFoto()}>
                Salvar foto
              </Button>
            </>
          )}
          {gravando && (
            <Button variant="danger" onClick={parar}>
              <Square />
              Parar gravação
            </Button>
          )}
          {modo === 'gravado' && (
            <>
              <Button variant="secondary" onClick={regravar} disabled={enviando}>
                <RotateCcw />
                Gravar de novo
              </Button>
              <Button loading={enviarVideo.isPending} onClick={() => void enviarGravacao()}>
                Enviar explicação
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
