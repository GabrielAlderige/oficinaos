import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AuthHeader } from '../../app/layouts/AuthLayout';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/display';
import { api } from '../../lib/api-client';
import { errorMessage } from '../../lib/errors';

/**
 * Confirmação de e-mail (E29). A pessoa clicou no link do e-mail, muitas vezes
 * no celular, sem sessão aberta: a página confirma sozinha e diz o que fazer
 * em seguida. Não há formulário — pedir um clique a mais aqui só perde gente.
 */
export function VerifyEmailPage() {
  const { token = '' } = useParams();
  const [estado, setEstado] = useState<'confirmando' | 'pronto' | 'falhou'>('confirmando');
  const [erro, setErro] = useState('');
  // o StrictMode monta duas vezes em desenvolvimento, e o token é de uso único:
  // a segunda chamada apagaria o "deu certo" da primeira
  const jaTentou = useRef(false);

  useEffect(() => {
    if (jaTentou.current) return;
    jaTentou.current = true;
    api('/auth/verify-email', { method: 'POST', json: { token } })
      .then(() => setEstado('pronto'))
      .catch((falha) => {
        setErro(errorMessage(falha));
        setEstado('falhou');
      });
  }, [token]);

  if (estado === 'confirmando') {
    return <AuthHeader title="Confirmando seu e-mail…" description="Um instante." />;
  }

  if (estado === 'falhou') {
    return (
      <>
        <AuthHeader title="Não deu para confirmar" description="O link pode ter vencido ou já ter sido usado." />
        <Alert variant="danger">{erro}</Alert>
        <p className="mt-4 text-sm text-muted">
          Entre no sistema: o aviso no topo do painel tem o botão para mandar um link novo.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link to="/entrar">Entrar</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <AuthHeader
        title="E-mail confirmado"
        description="Pronto. Agora a recuperação de senha chega até você se um dia precisar."
      />
      <p className="flex items-center gap-2 text-sm text-success">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Tudo certo com o seu e-mail.
      </p>
      <Button asChild className="mt-4 w-full">
        <Link to="/entrar">Ir para o sistema</Link>
      </Button>
    </>
  );
}
