import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envio de e-mail atrás de uma interface (ARCHITECTURE §12). Os drivers reais
 * (SES, Resend) entram quando houver deploy; até lá:
 *   console → imprime no terminal da API (desenvolvimento)
 *   memory  → guarda em memória (testes leem o link dali)
 */
export interface EmailProvider {
  readonly driver: string;
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly driver = 'console';

  async send(message: EmailMessage): Promise<void> {
    const line = '─'.repeat(64);
    process.stdout.write(
      `\n${line}\n  E-MAIL (driver console: NÃO foi enviado de verdade)\n  Para: ${message.to}\n  Assunto: ${message.subject}\n${line}\n${message.text}\n${line}\n\n`,
    );
  }
}

export class MemoryEmailProvider implements EmailProvider {
  readonly driver = 'memory';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/**
 * E-mail de verdade, por SMTP (E21). Serve qualquer provedor que fale SMTP —
 * SES, Resend, Postmark, ou o Mailpit local — porque a diferença entre eles é
 * a URL de conexão, não o código.
 *
 * O transporte é criado uma vez e reaproveitado: abrir conexão por e-mail
 * derruba o limite de qualquer provedor no primeiro dia de uso.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly driver = 'smtp';
  private transporte: Transporter | null = null;

  constructor(
    private readonly url: string,
    private readonly from: string,
    private readonly criar: (url: string) => Transporter = (endereco) => createTransport(endereco),
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.transporte ??= this.criar(this.url);
    await this.transporte.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export function createEmailProvider(env: Env): EmailProvider {
  if (env.EMAIL_DRIVER === 'memory') return new MemoryEmailProvider();
  if (env.EMAIL_DRIVER === 'smtp') {
    if (!env.SMTP_URL) throw new Error('EMAIL_DRIVER=smtp exige SMTP_URL no ambiente');
    return new SmtpEmailProvider(env.SMTP_URL, env.EMAIL_FROM);
  }
  return new ConsoleEmailProvider();
}
