import type { FastifyRequest } from 'fastify';

export interface SessionUser {
  id: number;
  displayName: string;
  initials: string;
  roles: string[];
  permissions: string[];
}

export interface AuthenticatedRequest extends FastifyRequest {
  inventoryUser: SessionUser;
  inventorySessionId: string;
}

export interface FieldDefinition {
  id: number;
  fieldKey: string;
  label: string;
  definition: string;
  helpText: string;
  dataType: string;
  lookupKey?: string;
  lookupName?: string;
  storageTarget: string;
  aliases: string[];
  validationRules: Record<string, unknown>;
  uniqueWhenPopulated: boolean;
  required: boolean;
  displayOrder: number;
  surfaces: Record<string, boolean>;
  options: Array<{ id: number; value: string; label: string; description?: string; aliases?: string[] }>;
}
