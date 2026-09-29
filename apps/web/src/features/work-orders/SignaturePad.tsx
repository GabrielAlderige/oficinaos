import { Eraser } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '../../components/ui/button';

/**
 * Assinatura na tela (E28). O dedo no celular é o caso principal: por isso
 * `touch-none` no canvas (sem isso o navegador rola a página em vez de
 * desenhar) e Pointer Events, que atendem dedo, caneta e mouse com um código
 * só.
 *
 * O traço é guardado em memória e redesenhado quando o canvas muda de tamanho:
 * mexer no `width` de um canvas apaga o conteúdo, e girar o celular no meio da
 * assinatura não pode significar começar de novo.
 */
export function SignaturePad({
  canvasRef,
  onChange,
}: {
  /** do pai, que na hora de entregar transforma o desenho em PNG */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onChange(assinado: boolean): void;
}) {
  /** os traços em coordenadas CSS, para sobreviver ao redimensionamento */
  const tracos = useRef<{ x: number; y: number }[][]>([]);
  const desenhando = useRef(false);
  const [vazio, setVazio] = useState(true);

  const redesenhar = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const proporcao = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    if (canvas.width !== largura * proporcao || canvas.height !== altura * proporcao) {
      canvas.width = largura * proporcao;
      canvas.height = altura * proporcao;
    }
    ctx.setTransform(proporcao, 0, 0, proporcao, 0, 0);
    ctx.clearRect(0, 0, largura, altura);
    // fundo branco: o PNG vai virar comprovante impresso, e transparente vira
    // preto no papel de alguns visualizadores
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const traco of tracos.current) {
      if (traco.length < 2) {
        if (traco[0]) {
          ctx.beginPath();
          ctx.arc(traco[0].x, traco[0].y, 1, 0, Math.PI * 2);
          ctx.fillStyle = '#111827';
          ctx.fill();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(traco[0]!.x, traco[0]!.y);
      for (const ponto of traco.slice(1)) ctx.lineTo(ponto.x, ponto.y);
      ctx.stroke();
    }
  }, [canvasRef]);

  useEffect(() => {
    redesenhar();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => redesenhar());
    observador.observe(canvas);
    return () => observador.disconnect();
  }, [canvasRef, redesenhar]);

  function ponto(evento: React.PointerEvent<HTMLCanvasElement>) {
    const caixa = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top };
  }

  function limpar() {
    tracos.current = [];
    setVazio(true);
    onChange(false);
    redesenhar();
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="Área para assinar"
        role="img"
        className="h-36 w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={(evento) => {
          evento.currentTarget.setPointerCapture(evento.pointerId);
          desenhando.current = true;
          tracos.current.push([ponto(evento)]);
          if (vazio) {
            setVazio(false);
            onChange(true);
          }
        }}
        onPointerMove={(evento) => {
          if (!desenhando.current) return;
          tracos.current[tracos.current.length - 1]?.push(ponto(evento));
          redesenhar();
        }}
        onPointerUp={() => {
          desenhando.current = false;
          redesenhar();
        }}
        onPointerLeave={() => {
          desenhando.current = false;
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{vazio ? 'Peça para assinar no quadro acima.' : 'Assinado.'}</p>
        <Button type="button" variant="ghost" size="sm" disabled={vazio} onClick={limpar}>
          <Eraser />
          Apagar
        </Button>
      </div>
    </div>
  );
}

/** O PNG da assinatura, ou null se ninguém assinou. */
export async function assinaturaComoArquivo(canvas: HTMLCanvasElement | null): Promise<File | null> {
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new File([blob], 'assinatura.png', { type: 'image/png' }) : null;
}
