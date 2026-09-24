import { Body, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z, ZodType } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** `@ValidBody(schema)` — validates the body with zod and documents it in OpenAPI. */
export function ValidBody(schema: ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    if (key !== undefined) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (descriptor) ApiBody({ schema: jsonSchemaOf(schema) as never })(target, key, descriptor);
    }
  };
}

/** `@ValidQuery(schema)` — validates the full query string with zod. */
export function ValidQuery(schema: ZodType): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}
