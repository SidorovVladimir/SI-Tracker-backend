import { ArshinVriResponseSchema } from '../dto/ArshinResponseDto';

export interface ArshinVerificationData {
  arshinId: string;
  protocolNumber: string;
  date: string;
  validUntil: string | null;
  isApplicable: boolean; // true = Годен, false = Брак
  organizationName: string;
}

export class ArshinService {
  constructor() {}

  async fetchLatestVerificationFromArshin(
    grsiNumber: string,
    serialNumber: string,
    retries = 3,
    delayMs = 2000
  ): Promise<ArshinVerificationData | null> {
    const cleanGrsi = grsiNumber.trim();
    const cleanSerial = serialNumber.trim();

    // Строим точный URL согласно разделу 3.1.1 (поиск по mit_number и mi_number)
    const url = `https://fgis.gost.ru/fundmetrology/eapi/vri/?mit_number=${encodeURIComponent(
      cleanGrsi
    )}&mi_number=${encodeURIComponent(cleanSerial)}&rows=1`;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error(
              'Превышен лимит запросов к ФГИС Аршин (более 2 запросов в секунду). Попробуйте позже.'
            );
          }
          throw new Error(
            `Ошибка ФГИС Аршин: сервер вернул статус ${response.status}`
          );
        }

        const rawData = await response.json();
        const parsed = ArshinVriResponseSchema.safeParse(rawData);

        if (!parsed.success) {
          console.error('Ошибка валидации схемы Аршина:', parsed.error);
          throw new Error(
            'Ответ ФГИС Аршин не соответствует ожидаемой структуре.'
          );
        }

        const { items, count } = parsed.data.result;

        if (count === 0 || !items || items.length === 0) {
          return null;
        }

        const latestVri = items[0];
        if (!latestVri) {
          return null;
        }

        // Обрабатываем номер документа. Если там "Нет данных", используем системный vri_id
        const finalDocNum =
          latestVri.result_docnum && latestVri.result_docnum !== 'Нет данных'
            ? latestVri.result_docnum
            : `ФГИС № ${latestVri.vri_id}`;

        return {
          arshinId: latestVri.vri_id,
          protocolNumber: finalDocNum,
          date: latestVri.verification_date,
          validUntil: latestVri.valid_date || null,
          isApplicable: latestVri.applicability,
          organizationName: latestVri.org_title,
        };
      } catch (error: any) {
        const isTimeout =
          error.name === 'AbortError' ||
          error.code === 'UND_ERR_CONNECT_TIMEOUT';

        console.warn(
          `⚠️ Попытка ${attempt} не удалась. Причина: ${
            error.message || 'Таймаут соединения'
          }`
        );
        if (attempt === retries) {
          if (isTimeout) {
            throw new Error(
              'Сервер ФГИС Аршин временно недоступен или блокирует запросы. Повторите попытку позже или внесите данные вручную.'
            );
          }
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }
}
