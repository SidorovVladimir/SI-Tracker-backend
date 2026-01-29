import { scopes } from '../models/scope.model';

export type ScopeEntity = typeof scopes.$inferSelect;
export type NewScope = typeof scopes.$inferInsert;
