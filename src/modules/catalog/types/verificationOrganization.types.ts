import { verificationOrganizations } from '../models/verificationOrganization.model';

export type VerificationOrganizationEntity =
  typeof verificationOrganizations.$inferSelect;
export type NewVerificationOrganization =
  typeof verificationOrganizations.$inferInsert;
