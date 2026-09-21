/**
 * @file apps/api/src/auth/dto/register.dto.ts
 * @description 注册接口 POST /auth/register 的请求体 DTO（数据传输对象）与校验规则。
 *
 * 小白导读：
 * - 与 login.dto.ts 同一套机制：class + class-validator 装饰器描述请求体形状，
 *   main.ts 的全局 ValidationPipe 在请求进入控制器前自动校验，不合法直接返回 400。
 * - username/password 的规则刻意与登录完全一致：登录用的也是这套正则/长度约束，
 *   两边不一致会出现“注册成功却永远登不上”的诡异问题，所以契约必须对齐。
 * - displayName（昵称）是可选项：用户不填就落库为 null，前端展示时回退用用户名。
 */
// IsOptional：字段可以整个不传（undefined 跳过后续校验）；其余装饰器与登录侧同名同义。
import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator'

/** 注册请求体：用户名 + 密码 + 可选昵称。 */
export class RegisterDto {
  // 用户名：必填，3~32 位字母、数字或下划线（与登录 DTO 完全同规则）。
  @IsString()
  @IsNotEmpty({ message: '请输入用户名' })
  @Matches(/^[a-zA-Z0-9_]{3,32}$/, {
    message: '用户名只能包含 3~32 位字母、数字或下划线',
  })
  username!: string

  // 密码：必填，长度 6~64 位（与登录 DTO 完全同规则）。
  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  @Length(6, 64, { message: '密码长度需为 6~64 位' })
  password!: string

  // 昵称：可选；填了则要求 1~32 个字符（纯空格虽能过正则，Service 里会 trim 后再判）。
  // @IsOptional 表示“请求体里没有这个字段”是合法的；一旦传了就按下面规则校验。
  @IsOptional()
  @IsString({ message: '昵称必须是字符串' })
  @Length(1, 32, { message: '昵称长度需为 1~32 位' })
  displayName?: string
}
