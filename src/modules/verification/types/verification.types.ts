import { verifications } from '../models/verification.model';

export type VerificationEntity = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
