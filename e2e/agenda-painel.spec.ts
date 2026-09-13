import { api, captura, criarOficina, entrarNoPainel, expect, test, type Oficina } from './helpers';

/**
 * Agenda (E8). O que interessa provar no navegador é o que teste de API não
 * alcança: o bloco desenhado na grade, o aviso de conflito com "agendar mesmo
 * assim" e o check-in que abre a OS e leva para ela.
 *
 * O dia é fixo (14/09/2026, uma segunda) para a grade não depender de quando o
 * teste roda. 12:00Z é 09:00 no relógio de São Paulo, o fuso da oficina.
 */
const DIA = '2026-09-14';
const AS_NOVE = `${DIA}T12:00:00.000Z`;
const AS_DEZ = `${DIA}T13:00:00.000Z`;

interface Agendamento {
  id: string;
  title: string;
}

async function marcar(oficina: Oficina, userId: string, extra: Record<string, unknown> = {}) {
  return api<Agendamento>('/appointments', {
    token: oficina.token,
    payload: {
      customerId: oficina.clienteId,
      vehicleId: oficina.veiculoId,
      mechanicUserId: userId,
      title: 'Revisão dos 20.000 km',
      startsAt: AS_NOVE,
      endsAt: AS_DEZ,
      ...extra,
    },
  });
}

async function donoDaOficina(oficina: Oficina): Promise<string> {
  const me = await api<{ user: { id: string } }>('/auth/me', { token: oficina.token });
  return me.user.id;
}

test('a agenda mostra o compromisso, avisa do conflito e faz o check-in', async ({ page, ignorarErros }) => {
  // o cenário provoca o 422 do conflito de propósito; o navegador registra sozinho
  ignorarErros.push(/status of 422/);
  const oficina = await criarOficina('agenda', 'AGE1A23');
  const userId = await donoDaOficina(oficina);
  await marcar(oficina, userId);

  await entrarNoPainel(page, oficina.email);
  await page.goto(`/agenda?visao=dia&dia=${DIA}`);
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();

  // o bloco está na grade, no horário da oficina
  const bloco = page.getByRole('button', { name: /Revisão dos 20.000 km/ }).first();
  await expect(bloco).toBeVisible();
  await captura(page, 'agenda-dia');

  // semana e mês desenham o mesmo compromisso, cada uma do seu jeito
  await page.getByRole('button', { name: 'Semana' }).click();
  await expect(page.getByRole('button', { name: /Revisão dos 20.000 km/ }).first()).toBeVisible();
  await captura(page, 'agenda-semana');
  await page.getByRole('button', { name: 'Mês' }).click();
  await expect(page.getByRole('button', { name: /Revisão dos 20.000 km/ }).first()).toBeVisible();
  await captura(page, 'agenda-mes');
  await page.getByRole('button', { name: 'Dia' }).click();

  // a ficha abre com o horário escrito no relógio da oficina
  await bloco.click();
  // o nome do cliente também aparece no bloco atrás: a ficha é quem manda aqui
  const ficha = page.getByRole('dialog');
  await expect(ficha.getByText('segunda, 14/09, das 09:00 às 10:00')).toBeVisible();
  await expect(ficha.getByText('João Pereira')).toBeVisible();
  await page.keyboard.press('Escape');

  // conflito: mesmo mecânico, mesma hora — a tela avisa e deixa encaixar.
  // Tudo dentro do diálogo: "Mecânico" também é o filtro da barra da agenda.
  await page.getByRole('button', { name: 'Agendar', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Novo agendamento' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Buscar cliente').fill('João');
  await dialogo.getByRole('button', { name: /João Pereira/ }).click();
  await dialogo.getByLabel('O que vai ser feito').fill('Encaixe de emergência');
  await dialogo.getByLabel('Dia', { exact: true }).fill(DIA);
  await dialogo.getByLabel('Hora', { exact: true }).fill('09:30');
  await dialogo.getByLabel('Mecânico', { exact: true }).selectOption({ label: 'Gabriel Teste' });

  await dialogo.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dialogo.getByText('Horário já ocupado:')).toBeVisible();
  await expect(dialogo.getByText(/Revisão dos 20.000 km.*das 09:00 às 10:00/)).toBeVisible();
  await captura(page, 'agenda-conflito');

  await dialogo.getByRole('button', { name: 'Agendar mesmo assim' }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('button', { name: /Encaixe de emergência/ }).first()).toBeVisible();

  // arrastar e soltar: o encaixe das 09:30 desce cinco horas na grade.
  // A altura de uma hora é 56 px (CalendarGrid), e o passo do arrasto é 15 min.
  const encaixe = page.getByRole('button', { name: /Encaixe de emergência/ }).first();
  const caixa = (await encaixe.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 8);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 8 + 5 * 56, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText('Agendamento remarcado.')).toBeVisible();

  await page.getByRole('button', { name: /Encaixe de emergência/ }).first().click();
  await expect(page.getByRole('dialog').getByText('segunda, 14/09, das 14:30 às 15:30')).toBeVisible();
  await captura(page, 'agenda-arrastado');
  await page.keyboard.press('Escape');

  // o carro chegou: o check-in abre a OS e a tela vai para ela
  await page.getByRole('button', { name: /Revisão dos 20.000 km/ }).first().click();
  await page.getByLabel('Quilometragem').fill('48000');
  await page.getByRole('button', { name: 'Fazer check-in e abrir OS' }).click();
  await expect(page).toHaveURL(/\/ordens\/\d+$/);
  await expect(page.getByText('Aberta pelo agendamento de 14/09, das 09:00 às 10:00.')).toBeVisible();
  await captura(page, 'agenda-check-in');
});

/**
 * O critério da etapa: **o fuso da oficina é respeitado**. Aqui o navegador
 * está do outro lado da linha de data — se a grade usasse o relógio do
 * aparelho, o compromisso apareceria no dia seguinte, em outro horário.
 */
test.describe('com o navegador em outro fuso', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test('a grade continua no relógio da oficina', async ({ page }) => {
    const oficina = await criarOficina('fuso', 'FUS1A23');
    const userId = await donoDaOficina(oficina);
    await marcar(oficina, userId);

    await entrarNoPainel(page, oficina.email);
    await page.goto(`/agenda?visao=dia&dia=${DIA}`);
    await page.getByRole('button', { name: /Revisão dos 20.000 km/ }).first().click();
    await expect(page.getByRole('dialog').getByText('segunda, 14/09, das 09:00 às 10:00')).toBeVisible();
    await captura(page, 'agenda-fuso');
  });
});
