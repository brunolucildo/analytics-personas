import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";

/** Valid only when the value equals the value of another property of the same object. */
export function SameAs(property: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "sameAs",
      target: target.constructor,
      propertyName: propertyKey as string,
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [other] = args.constraints as [string];

          return value === (args.object as Record<string, unknown>)[other];
        },
      },
    });
  };
}
