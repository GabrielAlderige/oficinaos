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

export function createEmailProvider(env: Env): EmailProvider {
  return env.EMAIL_DRIVER === 'memory' ? new MemoryEmailProvider() : new ConsoleEmailProvider();
}
