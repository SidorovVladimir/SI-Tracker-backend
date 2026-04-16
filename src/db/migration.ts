import { db } from './client';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import {
  cities,
  companies,
  devices,
  productionSites,
  statuses,
  verifications,
} from './schema';
import { eq } from 'drizzle-orm';

// const parseSafeDate = (value: any) => {
//   if (!value) return null;
//   const date = new Date(value);
//   return isNaN(date.getTime()) ? null : date;
// };
const parseSafeDate = (value: string | undefined | null): Date | null => {
  if (!value) return null;

  const parts = value.split('.');

  if (parts.length === 3) {
    const [d, m, y] = parts;

    if (d && m && y) {
      const day = parseInt(d, 10);
      const month = parseInt(m, 10);
      const year = parseInt(y, 10);

      const date = new Date(year, month - 1, day);

      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      ) {
        return date;
      }
    }
  }

  const fallbackDate = new Date(value);
  return isNaN(fallbackDate.getTime()) ? null : fallbackDate;
};

async function start() {
  await migrate(db, { migrationsFolder: './drizzle' });
  const data = readFileSync('src/db/raw.json', 'utf-8');
  const dataParse = JSON.parse(data);

  for (const d of dataParse) {
    await db.transaction(async (tx) => {
      let currentCity;
      let currentCompany;
      let currentProductionSite;
      let currentStatus;
      let currentDevice;

      const existCity = await tx.query.cities.findFirst({
        where: eq(cities.name, d.city.toLowerCase()),
      });

      currentCity = existCity;

      if (!existCity) {
        const [city] = await tx
          .insert(cities)
          .values({ name: d.city.toLowerCase() })
          .returning();
        currentCity = city;
      }

      const existCompany = await tx.query.companies.findFirst({
        where: eq(companies.name, d.company.toLowerCase()),
      });

      currentCompany = existCompany;

      if (!existCompany) {
        const [company] = await tx
          .insert(companies)
          .values({ name: d.company.toLowerCase() })
          .returning();
        currentCompany = company;
      }

      const productionSite = `${d.production_site.toLowerCase()} `;

      const existProductionSite = await tx.query.productionSites.findFirst({
        where: eq(productionSites.name, productionSite),
      });

      currentProductionSite = existProductionSite;

      if (!existProductionSite) {
        const productionData = {
          name: productionSite,
          companyId: currentCompany?.id!,
          cityId: currentCity?.id!,
        };

        const [production] = await tx
          .insert(productionSites)
          .values(productionData)
          .returning();

        currentProductionSite = production;
      }

      const existStatus = await tx.query.statuses.findFirst({
        where: eq(statuses.name, d.status.toLowerCase()),
      });

      currentStatus = existStatus;

      if (!existStatus) {
        const [status] = await tx
          .insert(statuses)
          .values({ name: d.status.toLowerCase() })
          .returning();
        currentStatus = status;
      }

      const deviceData = {
        name: d.name.toLowerCase(),
        model: d.model.toLowerCase(),
        serialNumber: d.serial_number.toLowerCase(),
        releaseDate: parseSafeDate(d.release_data),
        grsiNumber: d.grsi_number?.toLowerCase() ?? null,
        measurementRange: d.measurement_range?.toLowerCase() ?? null,
        accuracy: d.accuracy?.toLowerCase() ?? null,
        inventoryNumber: d.inventory_number?.toLowerCase() ?? null,
        receiptDate: parseSafeDate(d.receiptDate) ?? null,
        manufacturer: d.manufacturer?.toLowerCase() ?? null,
        verificationInterval: d.verification_interval,
        archived: d.archived,
        nomenclature: d.nomenclature?.toLowerCase() ?? null,
        statusId: currentStatus?.id!,
        productionSiteId: currentProductionSite?.id!,
        equipmentTypeId: null,
        measurementTypeId: null,
      };

      const [newDevice] = await tx
        .insert(devices)
        .values(deviceData)
        .returning();

      currentDevice = newDevice;

      if (d.verifications && d.verifications.length > 0) {
        const verificationsData = d.verifications.map((verification: any) => ({
          ...verification,
          date: parseSafeDate(verification.date),
          validUntil: parseSafeDate(verification.valid_until),
          protocolNumber: verification.protocol_number,
          deviceId: currentDevice?.id!,
        }));

        await tx.insert(verifications).values(verificationsData);
      }
    });
  }
}

const action = process.argv[2];

if (action === 'migration') start();
