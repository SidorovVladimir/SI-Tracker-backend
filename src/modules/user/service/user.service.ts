import { DrizzleDB } from '../../../db/client';
import { users } from '../user.model';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../../utils/auth';
import type { User, NewUser } from '../user.types';
import { CreateUserInput } from '../dto/CreateUserDto';
import { UpdateUserInput } from '../dto/UpdateUserDto';
import { AuthenticationError } from '../../../utils/errors';

export class UserService {
  constructor(private db: DrizzleDB) {}
  async getUsers(): Promise<User[]> {
    return await this.db.select().from(users);
  }

  async getUser(userId: string): Promise<User> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!result[0]) {
      throw new Error(`Пользователь с ID ${userId} не найден`);
    }
    return result[0];
  }

  async getByEmail(email: string) {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!result[0]) {
      return null;
    }
    return result[0];
  }

  async createUser(input: CreateUserInput) {
    const existsUser = await this.getByEmail(input.email);

    if (existsUser)
      throw new AuthenticationError(
        'Пользователь с таким почтовым адресом существует'
      );
    const userData: NewUser = {
      firstName: input.firstName.toLowerCase(),
      lastName: input.lastName.toLowerCase(),
      email: input.email,
      passwordHash: await hashPassword(input.password),
    };

    const [user] = await this.db.insert(users).values(userData).returning();

    if (!user) {
      throw new Error('Failed to create user');
    }
    const { passwordHash, ...publicUser } = user;
    return publicUser;
  }

  async updateUser(userId: string, input: UpdateUserInput): Promise<User> {
    const newUser = {
      firstName: input.firstName.toLowerCase(),
      lastName: input.lastName.toLowerCase(),
    };
    const [user] = await this.db
      .update(users)
      .set({ ...newUser, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!user) {
      throw new Error('Failed to update user');
    }
    return user;
  }
  async deleteUser(userId: string): Promise<boolean> {
    await this.db.delete(users).where(eq(users.id, userId));
    return true;
  }
}
