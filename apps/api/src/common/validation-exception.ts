import { HttpStatus, type ValidationError } from "@nestjs/common";
import { ApiException, type ApiErrorDetail } from "./api-exception";

function flattenValidationErrors(errors: ValidationError[], parentPath = ""): ApiErrorDetail[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      field: path,
      message,
    }));
    const nested = flattenValidationErrors(error.children ?? [], path);

    return [...own, ...nested];
  });
}

export function createValidationException(errors: ValidationError[]): ApiException {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    "VALIDATION_FAILED",
    "The request is invalid.",
    flattenValidationErrors(errors),
  );
}
