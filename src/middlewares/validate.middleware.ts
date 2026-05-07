import { Request, Response, NextFunction } from "express";
import { ZodObject, ZodError } from "zod";
import { RequestValidationError } from "@teleshop/common";

export const validateZod = (schema: ZodObject<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((issue) => ({
          message: issue.message,
          field: issue.path[issue.path.length - 1].toString(),
        }));
        next(new RequestValidationError(formattedErrors));
      } else {
        next(error);
      }
    }
  };
};
