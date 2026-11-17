import { NextFunction, Request, Response } from 'express';
import { createUserSchema, listUsersQuerySchema } from '../schemas/user.schema';
import { UserService } from '../services/user.service';

export class UserController {
  constructor(private readonly userService = new UserService()) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validatedBody = createUserSchema.parse(req.body);
      const user = await this.userService.createUser(validatedBody);

      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role } = listUsersQuerySchema.parse(req.query);
      const users = await this.userService.listUsers(role);

      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  };
}

