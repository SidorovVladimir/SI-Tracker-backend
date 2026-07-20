import { ArshinVriResponseSchema } from '../dto/ArshinResponseDto';

export interface ArshinVerificationData {
  arshinId: string;
  protocolNumber: string;
  date: string;
  validUntil: string | null;
  isApplicable: boolean; // true = Годен, false = Брак
  organizationName: string;
}

export interface ArshinFlexibleVerificationData {
  arshinId: string;
  protocolNumber: string;
  date: string;
  validUntil: string | null;
  isApplicable: boolean;
  organizationName: string;
  documentUrl: string;
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

    const url = `https://fgis.gost.ru/fundmetrology/eapi/vri/?mit_number=${encodeURIComponent(
      cleanGrsi
    )}&mi_number=${encodeURIComponent(cleanSerial)}&rows=1`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let timeoutId: NodeJS.Timeout | null = null;

      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 7000);

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

        if (attempt === retries) {
          if (isTimeout) {
            throw new Error(
              'Сервер ФГИС Аршин временно недоступен или блокирует запросы. Повторите попытку позже или внесите данные вручную.'
            );
          }
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }
    return null;
  }

  async fetchFlexibleVerificationsFromArshin(
    grsiNumber: string,
    serialNumber: string,
    count = 3,
    requestDelayMs = 600
  ): Promise<ArshinFlexibleVerificationData[]> {
    const cleanGrsi = grsiNumber.trim();
    const cleanSerial = serialNumber.trim();

    const currentYear = new Date().getFullYear();
    const yearsToCheck = Array.from({ length: 6 }, (_, i) => currentYear - i);

    const baseUrl = 'https://fgis.gost.ru/fundmetrology/eapi/vri/';
    const results: any[] = [];

    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // Итерируемся последовательно по годам
    for (let i = 0; i < yearsToCheck.length; i++) {
      const year = yearsToCheck[i]!;

      // Если мы уже нашли достаточное количество записей, досрочно выходим из цикла!
      // (Экономим запросы и время пользователя)
      if (results.length >= count) {
        break;
      }

      // Делаем паузу перед каждым следующим запросом, чтобы не превысить лимит 2 запр/сек
      if (i > 0) {
        await delay(requestDelayMs);
      }

      const url = `${baseUrl}?mit_number=${encodeURIComponent(
        cleanGrsi
      )}&mi_number=${encodeURIComponent(cleanSerial)}&year=${year}&rows=10`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (response.status === 429) {
          // Если всё-таки поймали 429, делаем увеличенную паузу и пробуем этот же год еще раз
          await delay(2000);
          i--;
          continue;
        }

        if (!response.ok) continue;

        const rawData = await response.json();
        const parsed = ArshinVriResponseSchema.safeParse(rawData);

        if (parsed.success && parsed.data.result.items) {
          results.push(...parsed.data.result.items);
        }
      } catch (e) {
        console.error(`Ошибка запроса к Аршин за ${year} год:`, e);
      }
    }

    if (results.length === 0) {
      return [];
    }

    // Мапим и генерируем веб-ссылки
    const mappedVerifications = results.map((vri) => {
      const finalDocNum =
        vri.result_docnum && vri.result_docnum !== 'Нет данных'
          ? vri.result_docnum
          : `ФГИС № ${vri.vri_id}`;

      return {
        arshinId: vri.vri_id,
        protocolNumber: finalDocNum,
        date: vri.verification_date,
        validUntil: vri.valid_date || null,
        isApplicable: vri.applicability,
        organizationName: vri.org_title,
        documentUrl: `https://fgis.gost.ru/fundmetrology/cm/results/${vri.vri_id}`,
      };
    });

    mappedVerifications.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return mappedVerifications.slice(0, count);
  }

  async findSingleVerificationUrlByProtocol(
    protocolNumber: string
  ): Promise<string | null> {
    const cleanProtocol = protocolNumber.trim();

    const url = `https://fgis.gost.ru/fundmetrology/eapi/vri/?result_docnum=${encodeURIComponent(
      cleanProtocol
    )}&rows=1`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;

      const rawData = await response.json();
      const parsed = ArshinVriResponseSchema.safeParse(rawData);

      if (parsed.success && parsed.data.result.items?.length > 0) {
        const firstItem = parsed.data.result.items[0];
        if (firstItem) {
          return `https://fgis.gost.ru/fundmetrology/cm/results/${firstItem.vri_id}`;
        }
      }
    } catch {
      return null;
    }
    return null;
  }
}
