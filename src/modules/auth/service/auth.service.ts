import { DrizzleDB } from '../../../db/client';
import { verifyPasword } from '../../../utils/auth';
import { AuthenticationError } from '../../../utils/errors';
import { CreateUserInput } from '../../user/dto/CreateUserDto';
import { UserService } from '../../user/service/user.service';
import { LoginInput } from '../dto/LoginDto';

export class AuthService {
  constructor(private db: DrizzleDB) {}

  async register(input: CreateUserInput) {
    return new UserService(this.db).createUser(input);
  }
  async Login(input: { email: string; password: string }) {
    const user = await new UserService(this.db).getByEmail(input.email);

    if (!user || !(await verifyPasword(input.password, user.passwordHash))) {
      throw new AuthenticationError('Неверная почта или пароль');
    }
    const { passwordHash, ...publicUser } = user;
    return publicUser;
  }
}
