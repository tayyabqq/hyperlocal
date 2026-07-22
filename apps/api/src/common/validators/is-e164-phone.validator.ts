import { registerDecorator, type ValidationOptions } from 'class-validator';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Accepts only fully-qualified E.164 numbers, e.g. +9715XXXXXXXX. */
export function IsE164Phone(options?: ValidationOptions) {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'isE164Phone',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !value.startsWith('+')) return false;
          return parsePhoneNumberFromString(value)?.isValid() === true;
        },
        defaultMessage(): string {
          return 'phoneE164 must be a valid international number, e.g. +971501234567';
        },
      },
    });
  };
}
